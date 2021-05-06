/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from 'vs/base/common/strings';
import { ReplaceCommand } from 'vs/editor/common/commands/replaceCommand';
import { EditorAutoClosingEditStrategy, EditorAutoClosingStrategy } from 'vs/editor/common/config/editorOptions';
import { CursorColumns, CursorConfiguration, EditOperationResult, EditOperationType, ICursorSimpleModel, isQuote } from 'vs/editor/common/controller/cursorCommon';
import { MoveOperations } from 'vs/editor/common/controller/cursorMoveOperations';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICommand } from 'vs/editor/common/editorCommon';
import { StandardAutoClosingPairConditional } from 'vs/editor/common/modes/languageConfiguration';
import { Position } from 'vs/editor/common/core/position';

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
		autoClosingDelete: EditorAutoClosingEditStrategy,
		autoClosingBrackets: EditorAutoClosingStrategy,
		autoClosingQuotes: EditorAutoClosingStrategy,
		autoClosingPairsOpen: Map<string, StandardAutoClosingPairConditional[]>,
		model: ICursorSimpleModel,
		selections: Selection[],
		autoClosedCharacters: Range[]
	): boolean {
		if (autoClosingBrackets === 'never' && autoClosingQuotes === 'never') {
			return false;
		}
		if (autoClosingDelete === 'never') {
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

			// Must delete the pair only if it was automatically inserted by the editor
			if (autoClosingDelete === 'auto') {
				let found = false;
				for (let j = 0, lenJ = autoClosedCharacters.length; j < lenJ; j++) {
					const autoClosedCharacter = autoClosedCharacters[j];
					if (position.lineNumber === autoClosedCharacter.startLineNumber && position.column === autoClosedCharacter.startColumn) {
						found = true;
						break;
					}
				}
				if (!found) {
					return false;
				}
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

	public static deleteLeft(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[], autoClosedCharacters: Range[]): [boolean, Array<ICommand | null>] {
		if (this.isAutoClosingPairDelete(config.autoClosingDelete, config.autoClosingBrackets, config.autoClosingQuotes, config.autoClosingPairs.autoClosingPairsOpenByEnd, model, selections, autoClosedCharacters)) {
			return this._runAutoClosingPairDelete(config, model, selections);
		}

		const commands: Array<ICommand | null> = [];
		let shouldPushStackElementBefore = (prevEditOperationType !== EditOperationType.DeletingLeft);
		for (let i = 0, len = selections.length; i < len; i++) {
			let deleteRange = DeleteOperations.getDeleteRange(selections[i], model, config);

			// Ignore empty delete ranges, as they have no effect
			// They happen if the cursor is at the beginning of the file.
			if (deleteRange.isEmpty()) {
				commands[i] = null;
				continue;
			}

			if (deleteRange.startLineNumber !== deleteRange.endLineNumber) {
				shouldPushStackElementBefore = true;
			}

			commands[i] = new ReplaceCommand(deleteRange, '');
		}
		return [shouldPushStackElementBefore, commands];

	}

	private static getDeleteRange(selection: Selection, model: ICursorSimpleModel, config: CursorConfiguration,): Range {
		if (!selection.isEmpty()) {
			return selection;
		}

		const position = selection.getPosition();

		// Unintend when using tab stops and cursor is within indentation
		if (config.useTabStops && position.column > 1) {
			const lineContent = model.getLineContent(position.lineNumber);

			const firstNonWhitespaceIndex = strings.firstNonWhitespaceIndex(lineContent);
			const lastIndentationColumn = (
				firstNonWhitespaceIndex === -1
					? /* entire string is whitespace */ lineContent.length + 1
					: firstNonWhitespaceIndex + 1
			);

			if (position.column <= lastIndentationColumn) {
				const fromVisibleColumn = CursorColumns.visibleColumnFromColumn2(config, model, position);
				const toVisibleColumn = CursorColumns.prevIndentTabStop(fromVisibleColumn, config.indentSize);
				const toColumn = CursorColumns.columnFromVisibleColumn2(config, model, position.lineNumber, toVisibleColumn);
				return new Range(position.lineNumber, toColumn, position.lineNumber, position.column);
			}
		}

		return Range.fromPositions(DeleteOperations.decreasePositionInModelBy1Column(position, model) || position, position);
	}

	private static decreasePositionInModelBy1Column(position: Position, model: ICursorSimpleModel): Position | undefined {
		if (position.column > 1) {
			return position.delta(0, -1);
		} else if (position.lineNumber > 1) {
			const newLine = position.lineNumber - 1;
			return new Position(newLine, model.getLineMaxColumn(newLine));
		} else {
			return undefined;
		}
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
