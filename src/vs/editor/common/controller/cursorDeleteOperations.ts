/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from 'vs/base/common/strings';
import { ReplaceCommand } from 'vs/editor/common/commands/replaceCommand';
import { EditorAutoClosingStrategy } from 'vs/editor/common/config/editorOptions';
import { CursorColumns, CursorConfiguration, EditOperationResult, EditOperationType, ICursorSimpleModel, isQuote } from 'vs/editor/common/controller/cursorCommon';
import { MoveOperations } from 'vs/editor/common/controller/cursorMoveOperations';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICommand } from 'vs/editor/common/editorCommon';
import { StandardAutoClosingPairConditional } from 'vs/editor/common/modes/languageConfiguration';

export class DeleteOperations {

	public static deleteRight(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[]): [boolean, Array<ICommand | null>] {
		let commands: Array<ICommand | null> = [];
		let shouldPushStackElementBefore = (prevEditOperationType !== EditOperationType.DeletingRight);
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];

			let deleteSelection: Range = selection;

			if (deleteSelection.isEmpty()) {
				let position = selection.getPosition();
				let rightOfPosition = MoveOperations.right(config, model, position.lineNumber, position.column);
				deleteSelection = new Range(
					rightOfPosition.lineNumber,
					rightOfPosition.column,
					position.lineNumber,
					position.column
				);
			}

			if (deleteSelection.isEmpty()) {
				// Probably at end of file => ignore
				commands[i] = null;
				continue;
			}

			if (deleteSelection.startLineNumber !== deleteSelection.endLineNumber) {
				shouldPushStackElementBefore = true;
			}

			commands[i] = new ReplaceCommand(deleteSelection, '');
		}
		return [shouldPushStackElementBefore, commands];
	}

	public static isAutoClosingPairDelete(
		autoClosingBrackets: EditorAutoClosingStrategy,
		autoClosingQuotes: EditorAutoClosingStrategy,
		autoClosingPairsOpen: Map<string, StandardAutoClosingPairConditional[]>,
		model: ICursorSimpleModel,
		selections: Selection[]
	): boolean {
		if (autoClosingBrackets === 'never' && autoClosingQuotes === 'never') {
			return false;
		}

		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			const position = selection.getPosition();

			if (!selection.isEmpty()) {
				return false;
			}

			const lineText = model.getLineContent(position.lineNumber);
			if (position.column < 2 || position.column >= lineText.length + 1) {
				return false;
			}
			const character = lineText.charAt(position.column - 2);

			const autoClosingPairCandidates = autoClosingPairsOpen.get(character);
			if (!autoClosingPairCandidates) {
				return false;
			}

			if (isQuote(character)) {
				if (autoClosingQuotes === 'never') {
					return false;
				}
			} else {
				if (autoClosingBrackets === 'never') {
					return false;
				}
			}

			const afterCharacter = lineText.charAt(position.column - 1);

			let foundAutoClosingPair = false;
			for (const autoClosingPairCandidate of autoClosingPairCandidates) {
				if (autoClosingPairCandidate.open === character && autoClosingPairCandidate.close === afterCharacter) {
					foundAutoClosingPair = true;
				}
			}
			if (!foundAutoClosingPair) {
				return false;
			}
		}

		return true;
	}

	private static _runAutoClosingPairDelete(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[]): [boolean, ICommand[]] {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const position = selections[i].getPosition();
			const deleteSelection = new Range(
				position.lineNumber,
				position.column - 1,
				position.lineNumber,
				position.column + 1
			);
			commands[i] = new ReplaceCommand(deleteSelection, '');
		}
		return [true, commands];
	}

	public static deleteLeft(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[]): [boolean, Array<ICommand | null>] {

		if (this.isAutoClosingPairDelete(config.autoClosingBrackets, config.autoClosingQuotes, config.autoClosingPairs.autoClosingPairsOpenByEnd, model, selections)) {
			return this._runAutoClosingPairDelete(config, model, selections);
		}

		let commands: Array<ICommand | null> = [];
		let shouldPushStackElementBefore = (prevEditOperationType !== EditOperationType.DeletingLeft);
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];

			let deleteSelection: Range = selection;

			if (deleteSelection.isEmpty()) {
				let position = selection.getPosition();

				if (config.useTabStops && position.column > 1) {
					let lineContent = model.getLineContent(position.lineNumber);

					let firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(lineContent);
					let lastIndentationColumn = (
						firstNonWhitespaceIndex === -1
							? /* entire string is whitespace */lineContent.length + 1
							: firstNonWhitespaceIndex + 1
					);

					if (position.column <= lastIndentationColumn) {
						let fromVisibleColumn = CursorColumns.visibleColumnFromColumn2(config, model, position);
						let toVisibleColumn = CursorColumns.prevIndentTabStop(fromVisibleColumn, config.indentSize);
						let toColumn = CursorColumns.columnFromVisibleColumn2(config, model, position.lineNumber, toVisibleColumn);
						deleteSelection = new Range(position.lineNumber, toColumn, position.lineNumber, position.column);
					} else {
						deleteSelection = new Range(position.lineNumber, position.column - 1, position.lineNumber, position.column);
					}
				} else {
					let leftOfPosition = MoveOperations.left(config, model, position.lineNumber, position.column);
					deleteSelection = new Range(
						leftOfPosition.lineNumber,
						leftOfPosition.column,
						position.lineNumber,
						position.column
					);
				}
			}

			if (deleteSelection.isEmpty()) {
				// Probably at beginning of file => ignore
				commands[i] = null;
				continue;
			}

			if (deleteSelection.startLineNumber !== deleteSelection.endLineNumber) {
				shouldPushStackElementBefore = true;
			}

			commands[i] = new ReplaceCommand(deleteSelection, '');
		}
		return [shouldPushStackElementBefore, commands];
	}

	public static cut(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[]): EditOperationResult {
		let commands: Array<ICommand | null> = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];

			if (selection.isEmpty()) {
				if (config.emptySelectionClipboard) {
					// This is a full line cut

					let position = selection.getPosition();

					let startLineNumber: number,
						startColumn: number,
						endLineNumber: number,
						endColumn: number;

					if (position.lineNumber < model.getLineCount()) {
						// Cutting a line in the middle of the model
						startLineNumber = position.lineNumber;
						startColumn = 1;
						endLineNumber = position.lineNumber + 1;
						endColumn = 1;
					} else if (position.lineNumber > 1) {
						// Cutting the last line & there are more than 1 lines in the model
						startLineNumber = position.lineNumber - 1;
						startColumn = model.getLineMaxColumn(position.lineNumber - 1);
						endLineNumber = position.lineNumber;
						endColumn = model.getLineMaxColumn(position.lineNumber);
					} else {
						// Cutting the single line that the model contains
						startLineNumber = position.lineNumber;
						startColumn = 1;
						endLineNumber = position.lineNumber;
						endColumn = model.getLineMaxColumn(position.lineNumber);
					}

					let deleteSelection = new Range(
						startLineNumber,
						startColumn,
						endLineNumber,
						endColumn
					);

					if (!deleteSelection.isEmpty()) {
						commands[i] = new ReplaceCommand(deleteSelection, '');
					} else {
						commands[i] = null;
					}
				} else {
					// Cannot cut empty selection
					commands[i] = null;
				}
			} else {
				commands[i] = new ReplaceCommand(selection, '');
			}
		}
		return new EditOperationResult(EditOperationType.Other, commands, {
			shouldPushStackElementBefore: true,
			shouldPushStackElementAfter: true
		});
	}
}
