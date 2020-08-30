/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICommand, IEditOperationBuilder, ICursorStateComputerData } from 'vs/editor/common/editorCommon';
import { ITextModel, IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';

export class BlockCommentCommand implements ICommand {

	private readonly _selection: Selection;
	private readonly _insertSpace: boolean;
	private _usedEndToken: string | null;

	constructor(selection: Selection, insertSpace: boolean) {
		this._selection = selection;
		this._insertSpace = insertSpace;
		this._usedEndToken = null;
	}

	public static _haystackHasNeedleAtOffset(haystack: string, needle: string, offset: number): boolean {
		if (offset < 0) {
			return false;
		}
		const needleLength = needle.length;
		const haystackLength = haystack.length;
		if (offset + needleLength > haystackLength) {
			return false;
		}

		for (let i = 0; i < needleLength; i++) {
			const codeA = haystack.charCodeAt(offset + i);
			const codeB = needle.charCodeAt(i);

			if (codeA === codeB) {
				continue;
			}
			if (codeA >= CharCode.A && codeA <= CharCode.Z && codeA + 32 === codeB) {
				// codeA is upper-case variant of codeB
				continue;
			}
			if (codeB >= CharCode.A && codeB <= CharCode.Z && codeB + 32 === codeA) {
				// codeB is upper-case variant of codeA
				continue;
			}

			return false;
		}
		return true;
	}

	private _createOperationsForBlockComment(selection: Range, startToken: string, endToken: string, insertSpace: boolean, model: ITextModel, builder: IEditOperationBuilder): void {
		const startLineNumber = selection.startLineNumber;
		const startColumn = selection.startColumn;
		const endLineNumber = selection.endLineNumber;
		const endColumn = selection.endColumn;

		const startLineText = model.getLineContent(startLineNumber);
		const endLineText = model.getLineContent(endLineNumber);

		let startTokenIndex = startLineText.lastIndexOf(startToken, startColumn - 1 + startToken.length);
		let endTokenIndex = endLineText.indexOf(endToken, endColumn - 1 - endToken.length);

		if (startTokenIndex !== -1 && endTokenIndex !== -1) {

			if (startLineNumber === endLineNumber) {
				const lineBetweenTokens = startLineText.substring(startTokenIndex + startToken.length, endTokenIndex);

				if (lineBetweenTokens.indexOf(endToken) >= 0) {
					// force to add a block comment
					startTokenIndex = -1;
					endTokenIndex = -1;
				}
			} else {
				const startLineAfterStartToken = startLineText.substring(startTokenIndex + startToken.length);
				const endLineBeforeEndToken = endLineText.substring(0, endTokenIndex);

				if (startLineAfterStartToken.indexOf(endToken) >= 0 || endLineBeforeEndToken.indexOf(endToken) >= 0) {
					// force to add a block comment
					startTokenIndex = -1;
					endTokenIndex = -1;
				}
			}
		}

		let ops: IIdentifiedSingleEditOperation[];

		if (startTokenIndex !== -1 && endTokenIndex !== -1) {
			// Consider spaces as part of the comment tokens
			if (insertSpace && startTokenIndex + startToken.length < startLineText.length && startLineText.charCodeAt(startTokenIndex + startToken.length) === CharCode.Space) {
				// Pretend the start token contains a trailing space
				startToken = startToken + ' ';
			}

			if (insertSpace && endTokenIndex > 0 && endLineText.charCodeAt(endTokenIndex - 1) === CharCode.Space) {
				// Pretend the end token contains a leading space
				endToken = ' ' + endToken;
				endTokenIndex -= 1;
			}
			ops = BlockCommentCommand._createRemoveBlockCommentOperations(
				new Range(startLineNumber, startTokenIndex + startToken.length + 1, endLineNumber, endTokenIndex + 1), startToken, endToken
			);
		} else {
			ops = BlockCommentCommand._createAddBlockCommentOperations(selection, startToken, endToken, this._insertSpace);
			this._usedEndToken = ops.length === 1 ? endToken : null;
		}

		for (const op of ops) {
			builder.addTrackedEditOperation(op.range, op.text);
		}
	}

	public static _createRemoveBlockCommentOperations(r: Range, startToken: string, endToken: string): IIdentifiedSingleEditOperation[] {
		let res: IIdentifiedSingleEditOperation[] = [];

		if (!Range.isEmpty(r)) {
			// Remove block comment start
			res.push(EditOperation.delete(new Range(
				r.startLineNumber, r.startColumn - startToken.length,
				r.startLineNumber, r.startColumn
			)));

			// Remove block comment end
			res.push(EditOperation.delete(new Range(
				r.endLineNumber, r.endColumn,
				r.endLineNumber, r.endColumn + endToken.length
			)));
		} else {
			// Remove both continuously
			res.push(EditOperation.delete(new Range(
				r.startLineNumber, r.startColumn - startToken.length,
				r.endLineNumber, r.endColumn + endToken.length
			)));
		}

		return res;
	}

	public static _createAddBlockCommentOperations(r: Range, startToken: string, endToken: string, insertSpace: boolean): IIdentifiedSingleEditOperation[] {
		let res: IIdentifiedSingleEditOperation[] = [];

		if (!Range.isEmpty(r)) {
			// Insert block comment start
			res.push(EditOperation.insert(new Position(r.startLineNumber, r.startColumn), startToken + (insertSpace ? ' ' : '')));

			// Insert block comment end
			res.push(EditOperation.insert(new Position(r.endLineNumber, r.endColumn), (insertSpace ? ' ' : '') + endToken));
		} else {
			// Insert both continuously
			res.push(EditOperation.replace(new Range(
				r.startLineNumber, r.startColumn,
				r.endLineNumber, r.endColumn
			), startToken + '  ' + endToken));
		}

		return res;
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {
		const startLineNumber = this._selection.startLineNumber;
		const startColumn = this._selection.startColumn;

		model.tokenizeIfCheap(startLineNumber);
		const languageId = model.getLanguageIdAtPosition(startLineNumber, startColumn);
		const config = LanguageConfigurationRegistry.getComments(languageId);
		if (!config || !config.blockCommentStartToken || !config.blockCommentEndToken) {
			// Mode does not support block comments
			return;
		}

		this._createOperationsForBlockComment(this._selection, config.blockCommentStartToken, config.blockCommentEndToken, this._insertSpace, model, builder);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		const inverseEditOperations = helper.getInverseEditOperations();
		if (inverseEditOperations.length === 2) {
			const startTokenEditOperation = inverseEditOperations[0];
			const endTokenEditOperation = inverseEditOperations[1];

			return new Selection(
				startTokenEditOperation.range.endLineNumber,
				startTokenEditOperation.range.endColumn,
				endTokenEditOperation.range.startLineNumber,
				endTokenEditOperation.range.startColumn
			);
		} else {
			const srcRange = inverseEditOperations[0].range;
			const deltaColumn = this._usedEndToken ? -this._usedEndToken.length - 1 : 0; // minus 1 space before endToken
			return new Selection(
				srcRange.endLineNumber,
				srcRange.endColumn + deltaColumn,
				srcRange.endLineNumber,
				srcRange.endColumn + deltaColumn
			);
		}
	}
}
