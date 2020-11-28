/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import * as strings from 'vs/base/common/strings';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICommand, IEditOperationBuilder, ICursorStateComputerData } from 'vs/editor/common/editorCommon';
import { IIdentifiedSingleEditOperation, ITextModel } from 'vs/editor/common/model';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { BlockCommentCommand } from 'vs/editor/contrib/comment/blockCommentCommand';
import { Constants } from 'vs/base/common/uint';

export interface IInsertionPoint {
	ignore: boolean;
	commentStrOffset: number;
}

export interface ILinePreflightData {
	ignore: boolean;
	commentStr: string;
	commentStrOffset: number;
	commentStrLength: number;
}

export interface IPreflightDataSupported {
	supported: true;
	shouldRemoveComments: boolean;
	lines: ILinePreflightData[];
}
export interface IPreflightDataUnsupported {
	supported: false;
}
export type IPreflightData = IPreflightDataSupported | IPreflightDataUnsupported;

export interface ISimpleModel {
	getLineContent(lineNumber: number): string;
}

export const enum Type {
	Toggle = 0,
	ForceAdd = 1,
	ForceRemove = 2
}

export class LineCommentCommand implements ICommand {

	private readonly _selection: Selection;
	private readonly _tabSize: number;
	private readonly _type: Type;
	private readonly _insertSpace: boolean;
	private readonly _ignoreEmptyLines: boolean;
	private _selectionId: string | null;
	private _deltaColumn: number;
	private _moveEndPositionDown: boolean;
	private _ignoreFirstLine: boolean;

	constructor(
		selection: Selection,
		tabSize: number,
		type: Type,
		insertSpace: boolean,
		ignoreEmptyLines: boolean,
		ignoreFirstLine?: boolean
	) {
		this._selection = selection;
		this._tabSize = tabSize;
		this._type = type;
		this._insertSpace = insertSpace;
		this._selectionId = null;
		this._deltaColumn = 0;
		this._moveEndPositionDown = false;
		this._ignoreEmptyLines = ignoreEmptyLines;
		this._ignoreFirstLine = ignoreFirstLine || false;
	}

	/**
	 * Do an initial pass over the lines and gather info about the line comment string.
	 * Returns null if any of the lines doesn't support a line comment string.
	 */
	public static _gatherPreflightCommentStrings(model: ITextModel, startLineNumber: number, endLineNumber: number): ILinePreflightData[] | null {

		model.tokenizeIfCheap(startLineNumber);
		const languageId = model.getLanguageIdAtPosition(startLineNumber, 1);

		const config = LanguageConfigurationRegistry.getComments(languageId);
		const commentStr = (config ? config.lineCommentToken : null);
		if (!commentStr) {
			// Mode does not support line comments
			return null;
		}

		let lines: ILinePreflightData[] = [];
		for (let i = 0, lineCount = endLineNumber - startLineNumber + 1; i < lineCount; i++) {
			lines[i] = {
				ignore: false,
				commentStr: commentStr,
				commentStrOffset: 0,
				commentStrLength: commentStr.length
			};
		}

		return lines;
	}

	/**
	 * Analyze lines and decide which lines are relevant and what the toggle should do.
	 * Also, build up several offsets and lengths useful in the generation of editor operations.
	 */
	public static _analyzeLines(type: Type, insertSpace: boolean, model: ISimpleModel, lines: ILinePreflightData[], startLineNumber: number, ignoreEmptyLines: boolean, ignoreFirstLine: boolean): IPreflightData {
		let onlyWhitespaceLines = true;

		let shouldRemoveComments: boolean;
		if (type === Type.Toggle) {
			shouldRemoveComments = true;
		} else if (type === Type.ForceAdd) {
			shouldRemoveComments = false;
		} else {
			shouldRemoveComments = true;
		}

		for (let i = 0, lineCount = lines.length; i < lineCount; i++) {
			const lineData = lines[i];
			const lineNumber = startLineNumber + i;

			if (lineNumber === startLineNumber && ignoreFirstLine) {
				// first line ignored
				lineData.ignore = true;
				continue;
			}

			const lineContent = model.getLineContent(lineNumber);
			const lineContentStartOffset = strings.firstNonWhitespaceIndex(lineContent);

			if (lineContentStartOffset === -1) {
				// Empty or whitespace only line
				lineData.ignore = ignoreEmptyLines;
				lineData.commentStrOffset = lineContent.length;
				continue;
			}

			onlyWhitespaceLines = false;
			lineData.ignore = false;
			lineData.commentStrOffset = lineContentStartOffset;

			if (shouldRemoveComments && !BlockCommentCommand._haystackHasNeedleAtOffset(lineContent, lineData.commentStr, lineContentStartOffset)) {
				if (type === Type.Toggle) {
					// Every line so far has been a line comment, but this one is not
					shouldRemoveComments = false;
				} else if (type === Type.ForceAdd) {
					// Will not happen
				} else {
					lineData.ignore = true;
				}
			}

			if (shouldRemoveComments && insertSpace) {
				// Remove a following space if present
				const commentStrEndOffset = lineContentStartOffset + lineData.commentStrLength;
				if (commentStrEndOffset < lineContent.length && lineContent.charCodeAt(commentStrEndOffset) === CharCode.Space) {
					lineData.commentStrLength += 1;
				}
			}
		}

		if (type === Type.Toggle && onlyWhitespaceLines) {
			// For only whitespace lines, we insert comments
			shouldRemoveComments = false;

			// Also, no longer ignore them
			for (let i = 0, lineCount = lines.length; i < lineCount; i++) {
				lines[i].ignore = false;
			}
		}

		return {
			supported: true,
			shouldRemoveComments: shouldRemoveComments,
			lines: lines
		};
	}

	/**
	 * Analyze all lines and decide exactly what to do => not supported | insert line comments | remove line comments
	 */
	public static _gatherPreflightData(type: Type, insertSpace: boolean, model: ITextModel, startLineNumber: number, endLineNumber: number, ignoreEmptyLines: boolean, ignoreFirstLine: boolean): IPreflightData {
		const lines = LineCommentCommand._gatherPreflightCommentStrings(model, startLineNumber, endLineNumber);
		if (lines === null) {
			return {
				supported: false
			};
		}

		return LineCommentCommand._analyzeLines(type, insertSpace, model, lines, startLineNumber, ignoreEmptyLines, ignoreFirstLine);
	}

	/**
	 * Given a successful analysis, execute either insert line comments, either remove line comments
	 */
	private _executeLineComments(model: ISimpleModel, builder: IEditOperationBuilder, data: IPreflightDataSupported, s: Selection): void {

		let ops: IIdentifiedSingleEditOperation[];

		if (data.shouldRemoveComments) {
			ops = LineCommentCommand._createRemoveLineCommentsOperations(data.lines, s.startLineNumber);
		} else {
			LineCommentCommand._normalizeInsertionPoint(model, data.lines, s.startLineNumber, this._tabSize);
			ops = this._createAddLineCommentsOperations(data.lines, s.startLineNumber);
		}

		const cursorPosition = new Position(s.positionLineNumber, s.positionColumn);

		for (let i = 0, len = ops.length; i < len; i++) {
			builder.addEditOperation(ops[i].range, ops[i].text);
			if (Range.isEmpty(ops[i].range) && Range.getStartPosition(ops[i].range).equals(cursorPosition)) {
				const lineContent = model.getLineContent(cursorPosition.lineNumber);
				if (lineContent.length + 1 === cursorPosition.column) {
					this._deltaColumn = (ops[i].text || '').length;
				}
			}
		}

		this._selectionId = builder.trackSelection(s);
	}

	private _attemptRemoveBlockComment(model: ITextModel, s: Selection, startToken: string, endToken: string): IIdentifiedSingleEditOperation[] | null {
		let startLineNumber = s.startLineNumber;
		let endLineNumber = s.endLineNumber;

		let startTokenAllowedBeforeColumn = endToken.length + Math.max(
			model.getLineFirstNonWhitespaceColumn(s.startLineNumber),
			s.startColumn
		);

		let startTokenIndex = model.getLineContent(startLineNumber).lastIndexOf(startToken, startTokenAllowedBeforeColumn - 1);
		let endTokenIndex = model.getLineContent(endLineNumber).indexOf(endToken, s.endColumn - 1 - startToken.length);

		if (startTokenIndex !== -1 && endTokenIndex === -1) {
			endTokenIndex = model.getLineContent(startLineNumber).indexOf(endToken, startTokenIndex + startToken.length);
			endLineNumber = startLineNumber;
		}

		if (startTokenIndex === -1 && endTokenIndex !== -1) {
			startTokenIndex = model.getLineContent(endLineNumber).lastIndexOf(startToken, endTokenIndex);
			startLineNumber = endLineNumber;
		}

		if (s.isEmpty() && (startTokenIndex === -1 || endTokenIndex === -1)) {
			startTokenIndex = model.getLineContent(startLineNumber).indexOf(startToken);
			if (startTokenIndex !== -1) {
				endTokenIndex = model.getLineContent(startLineNumber).indexOf(endToken, startTokenIndex + startToken.length);
			}
		}

		// We have to adjust to possible inner white space.
		// For Space after startToken, add Space to startToken - range math will work out.
		if (startTokenIndex !== -1 && model.getLineContent(startLineNumber).charCodeAt(startTokenIndex + startToken.length) === CharCode.Space) {
			startToken += ' ';
		}

		// For Space before endToken, add Space before endToken and shift index one left.
		if (endTokenIndex !== -1 && model.getLineContent(endLineNumber).charCodeAt(endTokenIndex - 1) === CharCode.Space) {
			endToken = ' ' + endToken;
			endTokenIndex -= 1;
		}

		if (startTokenIndex !== -1 && endTokenIndex !== -1) {
			return BlockCommentCommand._createRemoveBlockCommentOperations(
				new Range(startLineNumber, startTokenIndex + startToken.length + 1, endLineNumber, endTokenIndex + 1), startToken, endToken
			);
		}

		return null;
	}

	/**
	 * Given an unsuccessful analysis, delegate to the block comment command
	 */
	private _executeBlockComment(model: ITextModel, builder: IEditOperationBuilder, s: Selection): void {
		model.tokenizeIfCheap(s.startLineNumber);
		let languageId = model.getLanguageIdAtPosition(s.startLineNumber, 1);
		let config = LanguageConfigurationRegistry.getComments(languageId);
		if (!config || !config.blockCommentStartToken || !config.blockCommentEndToken) {
			// Mode does not support block comments
			return;
		}

		const startToken = config.blockCommentStartToken;
		const endToken = config.blockCommentEndToken;

		let ops = this._attemptRemoveBlockComment(model, s, startToken, endToken);
		if (!ops) {
			if (s.isEmpty()) {
				const lineContent = model.getLineContent(s.startLineNumber);
				let firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(lineContent);
				if (firstNonWhitespaceIndex === -1) {
					// Line is empty or contains only whitespace
					firstNonWhitespaceIndex = lineContent.length;
				}
				ops = BlockCommentCommand._createAddBlockCommentOperations(
					new Range(s.startLineNumber, firstNonWhitespaceIndex + 1, s.startLineNumber, lineContent.length + 1),
					startToken,
					endToken,
					this._insertSpace
				);
			} else {
				ops = BlockCommentCommand._createAddBlockCommentOperations(
					new Range(s.startLineNumber, model.getLineFirstNonWhitespaceColumn(s.startLineNumber), s.endLineNumber, model.getLineMaxColumn(s.endLineNumber)),
					startToken,
					endToken,
					this._insertSpace
				);
			}

			if (ops.length === 1) {
				// Leave cursor after token and Space
				this._deltaColumn = startToken.length + 1;
			}
		}
		this._selectionId = builder.trackSelection(s);
		for (const op of ops) {
			builder.addEditOperation(op.range, op.text);
		}
	}

	public getEditOperations(model: ITextModel, builder: IEditOperationBuilder): void {

		let s = this._selection;
		this._moveEndPositionDown = false;

		if (s.startLineNumber === s.endLineNumber && this._ignoreFirstLine) {
			builder.addEditOperation(new Range(s.startLineNumber, model.getLineMaxColumn(s.startLineNumber), s.startLineNumber + 1, 1), s.startLineNumber === model.getLineCount() ? '' : '\n');
			this._selectionId = builder.trackSelection(s);
			return;
		}

		if (s.startLineNumber < s.endLineNumber && s.endColumn === 1) {
			this._moveEndPositionDown = true;
			s = s.setEndPosition(s.endLineNumber - 1, model.getLineMaxColumn(s.endLineNumber - 1));
		}

		const data = LineCommentCommand._gatherPreflightData(
			this._type,
			this._insertSpace,
			model,
			s.startLineNumber,
			s.endLineNumber,
			this._ignoreEmptyLines,
			this._ignoreFirstLine
		);

		if (data.supported) {
			return this._executeLineComments(model, builder, data, s);
		}

		return this._executeBlockComment(model, builder, s);
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		let result = helper.getTrackedSelection(this._selectionId!);

		if (this._moveEndPositionDown) {
			result = result.setEndPosition(result.endLineNumber + 1, 1);
		}

		return new Selection(
			result.selectionStartLineNumber,
			result.selectionStartColumn + this._deltaColumn,
			result.positionLineNumber,
			result.positionColumn + this._deltaColumn
		);
	}

	/**
	 * Generate edit operations in the remove line comment case
	 */
	public static _createRemoveLineCommentsOperations(lines: ILinePreflightData[], startLineNumber: number): IIdentifiedSingleEditOperation[] {
		let res: IIdentifiedSingleEditOperation[] = [];

		for (let i = 0, len = lines.length; i < len; i++) {
			const lineData = lines[i];

			if (lineData.ignore) {
				continue;
			}

			res.push(EditOperation.delete(new Range(
				startLineNumber + i, lineData.commentStrOffset + 1,
				startLineNumber + i, lineData.commentStrOffset + lineData.commentStrLength + 1
			)));
		}

		return res;
	}

	/**
	 * Generate edit operations in the add line comment case
	 */
	private _createAddLineCommentsOperations(lines: ILinePreflightData[], startLineNumber: number): IIdentifiedSingleEditOperation[] {
		let res: IIdentifiedSingleEditOperation[] = [];
		const afterCommentStr = this._insertSpace ? ' ' : '';


		for (let i = 0, len = lines.length; i < len; i++) {
			const lineData = lines[i];

			if (lineData.ignore) {
				continue;
			}

			res.push(EditOperation.insert(new Position(startLineNumber + i, lineData.commentStrOffset + 1), lineData.commentStr + afterCommentStr));
		}

		return res;
	}

	private static nextVisibleColumn(currentVisibleColumn: number, tabSize: number, isTab: boolean, columnSize: number): number {
		if (isTab) {
			return currentVisibleColumn + (tabSize - (currentVisibleColumn % tabSize));
		}
		return currentVisibleColumn + columnSize;
	}

	/**
	 * Adjust insertion points to have them vertically aligned in the add line comment case
	 */
	public static _normalizeInsertionPoint(model: ISimpleModel, lines: IInsertionPoint[], startLineNumber: number, tabSize: number): void {
		let minVisibleColumn = Constants.MAX_SAFE_SMALL_INTEGER;
		let j: number;
		let lenJ: number;

		for (let i = 0, len = lines.length; i < len; i++) {
			if (lines[i].ignore) {
				continue;
			}

			const lineContent = model.getLineContent(startLineNumber + i);

			let currentVisibleColumn = 0;
			for (let j = 0, lenJ = lines[i].commentStrOffset; currentVisibleColumn < minVisibleColumn && j < lenJ; j++) {
				currentVisibleColumn = LineCommentCommand.nextVisibleColumn(currentVisibleColumn, tabSize, lineContent.charCodeAt(j) === CharCode.Tab, 1);
			}

			if (currentVisibleColumn < minVisibleColumn) {
				minVisibleColumn = currentVisibleColumn;
			}
		}

		minVisibleColumn = Math.floor(minVisibleColumn / tabSize) * tabSize;

		for (let i = 0, len = lines.length; i < len; i++) {
			if (lines[i].ignore) {
				continue;
			}

			const lineContent = model.getLineContent(startLineNumber + i);

			let currentVisibleColumn = 0;
			for (j = 0, lenJ = lines[i].commentStrOffset; currentVisibleColumn < minVisibleColumn && j < lenJ; j++) {
				currentVisibleColumn = LineCommentCommand.nextVisibleColumn(currentVisibleColumn, tabSize, lineContent.charCodeAt(j) === CharCode.Tab, 1);
			}

			if (currentVisibleColumn > minVisibleColumn) {
				lines[i].commentStrOffset = j - 1;
			} else {
				lines[i].commentStrOffset = j;
			}
		}
	}
}
