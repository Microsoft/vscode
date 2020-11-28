/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { onUnexpectedError } from 'vs/base/common/errors';
import * as strings from 'vs/base/common/strings';
import { ReplaceCommand, ReplaceCommandWithOffsetCursorState, ReplaceCommandWithoutChangingPosition, ReplaceCommandThatPreservesSelection } from 'vs/editor/common/commands/replaceCommand';
import { ShiftCommand } from 'vs/editor/common/commands/shiftCommand';
import { SurroundSelectionCommand } from 'vs/editor/common/commands/surroundSelectionCommand';
import { CursorColumns, CursorConfiguration, EditOperationResult, EditOperationType, ICursorSimpleModel, isQuote } from 'vs/editor/common/controller/cursorCommon';
import { WordCharacterClass, getMapForWordSeparators } from 'vs/editor/common/controller/wordCharacterClassifier';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { Position } from 'vs/editor/common/core/position';
import { ICommand, ICursorStateComputerData } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { EnterAction, IndentAction, StandardAutoClosingPairConditional } from 'vs/editor/common/modes/languageConfiguration';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { IElectricAction } from 'vs/editor/common/modes/supports/electricCharacter';
import { EditorAutoIndentStrategy } from 'vs/editor/common/config/editorOptions';

export class TypeOperations {

	public static indent(config: CursorConfiguration, model: ICursorSimpleModel | null, selections: Selection[] | null): ICommand[] {
		if (model === null || selections === null) {
			return [];
		}

		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			commands[i] = new ShiftCommand(selections[i], {
				isUnshift: false,
				tabSize: config.tabSize,
				indentSize: config.indentSize,
				insertSpaces: config.insertSpaces,
				useTabStops: config.useTabStops,
				autoIndent: config.autoIndent
			});
		}
		return commands;
	}

	public static outdent(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[]): ICommand[] {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			commands[i] = new ShiftCommand(selections[i], {
				isUnshift: true,
				tabSize: config.tabSize,
				indentSize: config.indentSize,
				insertSpaces: config.insertSpaces,
				useTabStops: config.useTabStops,
				autoIndent: config.autoIndent
			});
		}
		return commands;
	}

	public static shiftIndent(config: CursorConfiguration, indentation: string, count?: number): string {
		count = count || 1;
		return ShiftCommand.shiftIndent(indentation, indentation.length + count, config.tabSize, config.indentSize, config.insertSpaces);
	}

	public static unshiftIndent(config: CursorConfiguration, indentation: string, count?: number): string {
		count = count || 1;
		return ShiftCommand.unshiftIndent(indentation, indentation.length + count, config.tabSize, config.indentSize, config.insertSpaces);
	}

	private static _distributedPaste(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[], text: string[]): EditOperationResult {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			commands[i] = new ReplaceCommand(selections[i], text[i]);
		}
		return new EditOperationResult(EditOperationType.Other, commands, {
			shouldPushStackElementBefore: true,
			shouldPushStackElementAfter: true
		});
	}

	private static _simplePaste(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[], text: string, pasteOnNewLine: boolean): EditOperationResult {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			let position = selection.getPosition();

			if (pasteOnNewLine && !selection.isEmpty()) {
				pasteOnNewLine = false;
			}
			if (pasteOnNewLine && text.indexOf('\n') !== text.length - 1) {
				pasteOnNewLine = false;
			}

			if (pasteOnNewLine) {
				// Paste entire line at the beginning of line
				let typeSelection = new Range(position.lineNumber, 1, position.lineNumber, 1);
				commands[i] = new ReplaceCommandThatPreservesSelection(typeSelection, text, selection, true);
			} else {
				commands[i] = new ReplaceCommand(selection, text);
			}
		}
		return new EditOperationResult(EditOperationType.Other, commands, {
			shouldPushStackElementBefore: true,
			shouldPushStackElementAfter: true
		});
	}

	private static _distributePasteToCursors(config: CursorConfiguration, selections: Selection[], text: string, pasteOnNewLine: boolean, multicursorText: string[]): string[] | null {
		if (pasteOnNewLine) {
			return null;
		}

		if (selections.length === 1) {
			return null;
		}

		if (multicursorText && multicursorText.length === selections.length) {
			return multicursorText;
		}

		if (config.multiCursorPaste === 'spread') {
			// Try to spread the pasted text in case the line count matches the cursor count
			// Remove trailing \n if present
			if (text.charCodeAt(text.length - 1) === CharCode.LineFeed) {
				text = text.substr(0, text.length - 1);
			}
			// Remove trailing \r if present
			if (text.charCodeAt(text.length - 1) === CharCode.CarriageReturn) {
				text = text.substr(0, text.length - 1);
			}
			let lines = strings.splitLines(text);
			if (lines.length === selections.length) {
				return lines;
			}
		}

		return null;
	}

	public static paste(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[], text: string, pasteOnNewLine: boolean, multicursorText: string[]): EditOperationResult {
		const distributedPaste = this._distributePasteToCursors(config, selections, text, pasteOnNewLine, multicursorText);

		if (distributedPaste) {
			selections = selections.sort(Range.compareRangesUsingStarts);
			return this._distributedPaste(config, model, selections, distributedPaste);
		} else {
			return this._simplePaste(config, model, selections, text, pasteOnNewLine);
		}
	}

	private static _goodIndentForLine(config: CursorConfiguration, model: ITextModel, lineNumber: number): string | null {
		let action: IndentAction | EnterAction | null = null;
		let indentation: string = '';

		const expectedIndentAction = LanguageConfigurationRegistry.getInheritIndentForLine(config.autoIndent, model, lineNumber, false);
		if (expectedIndentAction) {
			action = expectedIndentAction.action;
			indentation = expectedIndentAction.indentation;
		} else if (lineNumber > 1) {
			let lastLineNumber: number;
			for (lastLineNumber = lineNumber - 1; lastLineNumber >= 1; lastLineNumber--) {
				const lineText = model.getLineContent(lastLineNumber);
				const nonWhitespaceIdx = strings.lastNonWhitespaceIndex(lineText);
				if (nonWhitespaceIdx >= 0) {
					break;
				}
			}

			if (lastLineNumber < 1) {
				// No previous line with content found
				return null;
			}

			const maxColumn = model.getLineMaxColumn(lastLineNumber);
			const expectedEnterAction = LanguageConfigurationRegistry.getEnterAction(config.autoIndent, model, new Range(lastLineNumber, maxColumn, lastLineNumber, maxColumn));
			if (expectedEnterAction) {
				indentation = expectedEnterAction.indentation + expectedEnterAction.appendText;
			}
		}

		if (action) {
			if (action === IndentAction.Indent) {
				indentation = TypeOperations.shiftIndent(config, indentation);
			}

			if (action === IndentAction.Outdent) {
				indentation = TypeOperations.unshiftIndent(config, indentation);
			}

			indentation = config.normalizeIndentation(indentation);
		}

		if (!indentation) {
			return null;
		}

		return indentation;
	}

	private static _replaceJumpToNextIndent(config: CursorConfiguration, model: ICursorSimpleModel, selection: Selection, insertsAutoWhitespace: boolean): ReplaceCommand {
		let typeText = '';

		let position = selection.getStartPosition();
		if (config.insertSpaces) {
			let visibleColumnFromColumn = CursorColumns.visibleColumnFromColumn2(config, model, position);
			let indentSize = config.indentSize;
			let spacesCnt = indentSize - (visibleColumnFromColumn % indentSize);
			for (let i = 0; i < spacesCnt; i++) {
				typeText += ' ';
			}
		} else {
			typeText = '\t';
		}

		return new ReplaceCommand(selection, typeText, insertsAutoWhitespace);
	}

	public static tab(config: CursorConfiguration, model: ITextModel, selections: Selection[]): ICommand[] {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];

			if (selection.isEmpty()) {

				let lineText = model.getLineContent(selection.startLineNumber);

				if (/^\s*$/.test(lineText) && model.isCheapToTokenize(selection.startLineNumber)) {
					let goodIndent = this._goodIndentForLine(config, model, selection.startLineNumber);
					goodIndent = goodIndent || '\t';
					let possibleTypeText = config.normalizeIndentation(goodIndent);
					if (!lineText.startsWith(possibleTypeText)) {
						commands[i] = new ReplaceCommand(new Range(selection.startLineNumber, 1, selection.startLineNumber, lineText.length + 1), possibleTypeText, true);
						continue;
					}
				}

				commands[i] = this._replaceJumpToNextIndent(config, model, selection, true);
			} else {
				if (selection.startLineNumber === selection.endLineNumber) {
					let lineMaxColumn = model.getLineMaxColumn(selection.startLineNumber);
					if (selection.startColumn !== 1 || selection.endColumn !== lineMaxColumn) {
						// This is a single line selection that is not the entire line
						commands[i] = this._replaceJumpToNextIndent(config, model, selection, false);
						continue;
					}
				}

				commands[i] = new ShiftCommand(selection, {
					isUnshift: false,
					tabSize: config.tabSize,
					indentSize: config.indentSize,
					insertSpaces: config.insertSpaces,
					useTabStops: config.useTabStops,
					autoIndent: config.autoIndent
				});
			}
		}
		return commands;
	}

	public static replacePreviousChar(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], txt: string, replaceCharCnt: number): EditOperationResult {
		let commands: Array<ICommand | null> = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			if (!selection.isEmpty()) {
				// looks like https://github.com/microsoft/vscode/issues/2773
				// where a cursor operation occurred before a canceled composition
				// => ignore composition
				commands[i] = null;
				continue;
			}
			const pos = selection.getPosition();
			const startColumn = Math.max(1, pos.column - replaceCharCnt);
			const range = new Range(pos.lineNumber, startColumn, pos.lineNumber, pos.column);
			const oldText = model.getValueInRange(range);
			if (oldText === txt) {
				// => ignore composition that doesn't do anything
				commands[i] = null;
				continue;
			}
			commands[i] = new ReplaceCommand(range, txt);
		}
		return new EditOperationResult(EditOperationType.Typing, commands, {
			shouldPushStackElementBefore: (prevEditOperationType !== EditOperationType.Typing),
			shouldPushStackElementAfter: false
		});
	}

	private static _typeCommand(range: Range, text: string, keepPosition: boolean): ICommand {
		if (keepPosition) {
			return new ReplaceCommandWithoutChangingPosition(range, text, true);
		} else {
			return new ReplaceCommand(range, text, true);
		}
	}

	private static _enter(config: CursorConfiguration, model: ITextModel, keepPosition: boolean, range: Range): ICommand {
		if (config.autoIndent === EditorAutoIndentStrategy.None) {
			return TypeOperations._typeCommand(range, '\n', keepPosition);
		}
		if (!model.isCheapToTokenize(range.getStartPosition().lineNumber) || config.autoIndent === EditorAutoIndentStrategy.Keep) {
			let lineText = model.getLineContent(range.startLineNumber);
			let indentation = strings.getLeadingWhitespace(lineText).substring(0, range.startColumn - 1);
			return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(indentation), keepPosition);
		}

		const r = LanguageConfigurationRegistry.getEnterAction(config.autoIndent, model, range);
		if (r) {
			if (r.indentAction === IndentAction.None) {
				// Nothing special
				return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(r.indentation + r.appendText), keepPosition);

			} else if (r.indentAction === IndentAction.Indent) {
				// Indent once
				return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(r.indentation + r.appendText), keepPosition);

			} else if (r.indentAction === IndentAction.IndentOutdent) {
				// Ultra special
				const normalIndent = config.normalizeIndentation(r.indentation);
				const increasedIndent = config.normalizeIndentation(r.indentation + r.appendText);

				const typeText = '\n' + increasedIndent + '\n' + normalIndent;

				if (keepPosition) {
					return new ReplaceCommandWithoutChangingPosition(range, typeText, true);
				} else {
					return new ReplaceCommandWithOffsetCursorState(range, typeText, -1, increasedIndent.length - normalIndent.length, true);
				}
			} else if (r.indentAction === IndentAction.Outdent) {
				const actualIndentation = TypeOperations.unshiftIndent(config, r.indentation);
				return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(actualIndentation + r.appendText), keepPosition);
			}
		}

		const lineText = model.getLineContent(range.startLineNumber);
		const indentation = strings.getLeadingWhitespace(lineText).substring(0, range.startColumn - 1);

		if (config.autoIndent >= EditorAutoIndentStrategy.Full) {
			const ir = LanguageConfigurationRegistry.getIndentForEnter(config.autoIndent, model, range, {
				unshiftIndent: (indent) => {
					return TypeOperations.unshiftIndent(config, indent);
				},
				shiftIndent: (indent) => {
					return TypeOperations.shiftIndent(config, indent);
				},
				normalizeIndentation: (indent) => {
					return config.normalizeIndentation(indent);
				}
			});

			if (ir) {
				let oldEndViewColumn = CursorColumns.visibleColumnFromColumn2(config, model, range.getEndPosition());
				const oldEndColumn = range.endColumn;

				let beforeText = '\n';
				if (indentation !== config.normalizeIndentation(ir.beforeEnter)) {
					beforeText = config.normalizeIndentation(ir.beforeEnter) + lineText.substring(indentation.length, range.startColumn - 1) + '\n';
					range = new Range(range.startLineNumber, 1, range.endLineNumber, range.endColumn);
				}

				const newLineContent = model.getLineContent(range.endLineNumber);
				const firstNonWhitespace = strings.firstNonWhitespaceIndex(newLineContent);
				if (firstNonWhitespace >= 0) {
					range = range.setEndPosition(range.endLineNumber, Math.max(range.endColumn, firstNonWhitespace + 1));
				} else {
					range = range.setEndPosition(range.endLineNumber, model.getLineMaxColumn(range.endLineNumber));
				}

				if (keepPosition) {
					return new ReplaceCommandWithoutChangingPosition(range, beforeText + config.normalizeIndentation(ir.afterEnter), true);
				} else {
					let offset = 0;
					if (oldEndColumn <= firstNonWhitespace + 1) {
						if (!config.insertSpaces) {
							oldEndViewColumn = Math.ceil(oldEndViewColumn / config.indentSize);
						}
						offset = Math.min(oldEndViewColumn + 1 - config.normalizeIndentation(ir.afterEnter).length - 1, 0);
					}
					return new ReplaceCommandWithOffsetCursorState(range, beforeText + config.normalizeIndentation(ir.afterEnter), 0, offset, true);
				}
			}
		}

		return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(indentation), keepPosition);
	}

	private static _isAutoIndentType(config: CursorConfiguration, model: ITextModel, selections: Selection[]): boolean {
		if (config.autoIndent < EditorAutoIndentStrategy.Full) {
			return false;
		}

		for (let i = 0, len = selections.length; i < len; i++) {
			if (!model.isCheapToTokenize(selections[i].getEndPosition().lineNumber)) {
				return false;
			}
		}

		return true;
	}

	private static _runAutoIndentType(config: CursorConfiguration, model: ITextModel, range: Range, ch: string): ICommand | null {
		const currentIndentation = LanguageConfigurationRegistry.getIndentationAtPosition(model, range.startLineNumber, range.startColumn);
		const actualIndentation = LanguageConfigurationRegistry.getIndentActionForType(config.autoIndent, model, range, ch, {
			shiftIndent: (indentation) => {
				return TypeOperations.shiftIndent(config, indentation);
			},
			unshiftIndent: (indentation) => {
				return TypeOperations.unshiftIndent(config, indentation);
			},
		});

		if (actualIndentation === null) {
			return null;
		}

		if (actualIndentation !== config.normalizeIndentation(currentIndentation)) {
			const firstNonWhitespace = model.getLineFirstNonWhitespaceColumn(range.startLineNumber);
			if (firstNonWhitespace === 0) {
				return TypeOperations._typeCommand(
					new Range(range.startLineNumber, 1, range.endLineNumber, range.endColumn),
					config.normalizeIndentation(actualIndentation) + ch,
					false
				);
			} else {
				return TypeOperations._typeCommand(
					new Range(range.startLineNumber, 1, range.endLineNumber, range.endColumn),
					config.normalizeIndentation(actualIndentation) +
					model.getLineContent(range.startLineNumber).substring(firstNonWhitespace - 1, range.startColumn - 1) + ch,
					false
				);
			}
		}

		return null;
	}

	private static _isAutoClosingOvertype(config: CursorConfiguration, model: ITextModel, selections: Selection[], autoClosedCharacters: Range[], ch: string): boolean {
		if (config.autoClosingOvertype === 'never') {
			return false;
		}

		if (!config.autoClosingPairs.autoClosingPairsCloseSingleChar.has(ch)) {
			return false;
		}

		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];

			if (!selection.isEmpty()) {
				return false;
			}

			const position = selection.getPosition();
			const lineText = model.getLineContent(position.lineNumber);
			const afterCharacter = lineText.charAt(position.column - 1);

			if (afterCharacter !== ch) {
				return false;
			}

			// Do not over-type quotes after a backslash
			const chIsQuote = isQuote(ch);
			const beforeCharacter = position.column > 2 ? lineText.charCodeAt(position.column - 2) : CharCode.Null;
			if (beforeCharacter === CharCode.Backslash && chIsQuote) {
				return false;
			}

			// Must over-type a closing character typed by the editor
			if (config.autoClosingOvertype === 'auto') {
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

	private static _runAutoClosingOvertype(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], ch: string): EditOperationResult {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			const position = selection.getPosition();
			const typeSelection = new Range(position.lineNumber, position.column, position.lineNumber, position.column + 1);
			commands[i] = new ReplaceCommand(typeSelection, ch);
		}
		return new EditOperationResult(EditOperationType.Typing, commands, {
			shouldPushStackElementBefore: (prevEditOperationType !== EditOperationType.Typing),
			shouldPushStackElementAfter: false
		});
	}

	private static _isBeforeClosingBrace(config: CursorConfiguration, lineAfter: string) {
		// If the start of lineAfter can be interpretted as both a starting or ending brace, default to returning false
		const nextChar = lineAfter.charAt(0);
		const potentialStartingBraces = config.autoClosingPairs.autoClosingPairsOpenByStart.get(nextChar) || [];
		const potentialClosingBraces = config.autoClosingPairs.autoClosingPairsCloseByStart.get(nextChar) || [];

		const isBeforeStartingBrace = potentialStartingBraces.some(x => lineAfter.startsWith(x.open));
		const isBeforeClosingBrace = potentialClosingBraces.some(x => lineAfter.startsWith(x.close));

		return !isBeforeStartingBrace && isBeforeClosingBrace;
	}

	private static _findAutoClosingPairOpen(config: CursorConfiguration, model: ITextModel, positions: Position[], ch: string): StandardAutoClosingPairConditional | null {
		const autoClosingPairCandidates = config.autoClosingPairs.autoClosingPairsOpenByEnd.get(ch);
		if (!autoClosingPairCandidates) {
			return null;
		}

		// Determine which auto-closing pair it is
		let autoClosingPair: StandardAutoClosingPairConditional | null = null;
		for (const autoClosingPairCandidate of autoClosingPairCandidates) {
			if (autoClosingPair === null || autoClosingPairCandidate.open.length > autoClosingPair.open.length) {
				let candidateIsMatch = true;
				for (const position of positions) {
					const relevantText = model.getValueInRange(new Range(position.lineNumber, position.column - autoClosingPairCandidate.open.length + 1, position.lineNumber, position.column));
					if (relevantText + ch !== autoClosingPairCandidate.open) {
						candidateIsMatch = false;
						break;
					}
				}

				if (candidateIsMatch) {
					autoClosingPair = autoClosingPairCandidate;
				}
			}
		}
		return autoClosingPair;
	}

	private static _findSubAutoClosingPairClose(config: CursorConfiguration, autoClosingPair: StandardAutoClosingPairConditional): string {
		if (autoClosingPair.open.length <= 1) {
			return '';
		}
		const lastChar = autoClosingPair.close.charAt(autoClosingPair.close.length - 1);
		// get candidates with the same last character as close
		const subPairCandidates = config.autoClosingPairs.autoClosingPairsCloseByEnd.get(lastChar) || [];
		let subPairMatch: StandardAutoClosingPairConditional | null = null;
		for (const x of subPairCandidates) {
			if (x.open !== autoClosingPair.open && autoClosingPair.open.includes(x.open) && autoClosingPair.close.endsWith(x.close)) {
				if (!subPairMatch || x.open.length > subPairMatch.open.length) {
					subPairMatch = x;
				}
			}
		}
		if (subPairMatch) {
			return subPairMatch.close;
		} else {
			return '';
		}
	}

	private static _getAutoClosingPairClose(config: CursorConfiguration, model: ITextModel, selections: Selection[], ch: string, insertOpenCharacter: boolean): string | null {
		const chIsQuote = isQuote(ch);
		const autoCloseConfig = chIsQuote ? config.autoClosingQuotes : config.autoClosingBrackets;
		if (autoCloseConfig === 'never') {
			return null;
		}

		const autoClosingPair = this._findAutoClosingPairOpen(config, model, selections.map(s => s.getPosition()), ch);
		if (!autoClosingPair) {
			return null;
		}

		const subAutoClosingPairClose = this._findSubAutoClosingPairClose(config, autoClosingPair);
		let isSubAutoClosingPairPresent = true;

		const shouldAutoCloseBefore = chIsQuote ? config.shouldAutoCloseBefore.quote : config.shouldAutoCloseBefore.bracket;

		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			if (!selection.isEmpty()) {
				return null;
			}

			const position = selection.getPosition();
			const lineText = model.getLineContent(position.lineNumber);
			const lineAfter = lineText.substring(position.column - 1);

			if (!lineAfter.startsWith(subAutoClosingPairClose)) {
				isSubAutoClosingPairPresent = false;
			}

			// Only consider auto closing the pair if an allowed character follows or if another autoclosed pair closing brace follows
			if (lineText.length > position.column - 1) {
				const characterAfter = lineText.charAt(position.column - 1);
				const isBeforeCloseBrace = TypeOperations._isBeforeClosingBrace(config, lineAfter);

				if (!isBeforeCloseBrace && !shouldAutoCloseBefore(characterAfter)) {
					return null;
				}
			}

			if (!model.isCheapToTokenize(position.lineNumber)) {
				// Do not force tokenization
				return null;
			}

			// Do not auto-close ' or " after a word character
			if (autoClosingPair.open.length === 1 && chIsQuote && autoCloseConfig !== 'always') {
				const wordSeparators = getMapForWordSeparators(config.wordSeparators);
				if (insertOpenCharacter && position.column > 1 && wordSeparators.get(lineText.charCodeAt(position.column - 2)) === WordCharacterClass.Regular) {
					return null;
				}
				if (!insertOpenCharacter && position.column > 2 && wordSeparators.get(lineText.charCodeAt(position.column - 3)) === WordCharacterClass.Regular) {
					return null;
				}
			}

			model.forceTokenization(position.lineNumber);
			const lineTokens = model.getLineTokens(position.lineNumber);

			let shouldAutoClosePair = false;
			try {
				shouldAutoClosePair = LanguageConfigurationRegistry.shouldAutoClosePair(autoClosingPair, lineTokens, insertOpenCharacter ? position.column : position.column - 1);
			} catch (e) {
				onUnexpectedError(e);
			}

			if (!shouldAutoClosePair) {
				return null;
			}
		}

		if (isSubAutoClosingPairPresent) {
			return autoClosingPair.close.substring(0, autoClosingPair.close.length - subAutoClosingPairClose.length);
		} else {
			return autoClosingPair.close;
		}
	}

	private static _runAutoClosingOpenCharType(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], ch: string, insertOpenCharacter: boolean, autoClosingPairClose: string): EditOperationResult {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			commands[i] = new TypeWithAutoClosingCommand(selection, ch, insertOpenCharacter, autoClosingPairClose);
		}
		return new EditOperationResult(EditOperationType.Typing, commands, {
			shouldPushStackElementBefore: true,
			shouldPushStackElementAfter: false
		});
	}

	private static _shouldSurroundChar(config: CursorConfiguration, ch: string): boolean {
		if (isQuote(ch)) {
			return (config.autoSurround === 'quotes' || config.autoSurround === 'languageDefined');
		} else {
			// Character is a bracket
			return (config.autoSurround === 'brackets' || config.autoSurround === 'languageDefined');
		}
	}

	private static _isSurroundSelectionType(config: CursorConfiguration, model: ITextModel, selections: Selection[], ch: string): boolean {
		if (!TypeOperations._shouldSurroundChar(config, ch) || !config.surroundingPairs.hasOwnProperty(ch)) {
			return false;
		}

		const isTypingAQuoteCharacter = isQuote(ch);

		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];

			if (selection.isEmpty()) {
				return false;
			}

			let selectionContainsOnlyWhitespace = true;

			for (let lineNumber = selection.startLineNumber; lineNumber <= selection.endLineNumber; lineNumber++) {
				const lineText = model.getLineContent(lineNumber);
				const startIndex = (lineNumber === selection.startLineNumber ? selection.startColumn - 1 : 0);
				const endIndex = (lineNumber === selection.endLineNumber ? selection.endColumn - 1 : lineText.length);
				const selectedText = lineText.substring(startIndex, endIndex);
				if (/[^ \t]/.test(selectedText)) {
					// this selected text contains something other than whitespace
					selectionContainsOnlyWhitespace = false;
					break;
				}
			}

			if (selectionContainsOnlyWhitespace) {
				return false;
			}

			if (isTypingAQuoteCharacter && selection.startLineNumber === selection.endLineNumber && selection.startColumn + 1 === selection.endColumn) {
				const selectionText = model.getValueInRange(selection);
				if (isQuote(selectionText)) {
					// Typing a quote character on top of another quote character
					// => disable surround selection type
					return false;
				}
			}
		}

		return true;
	}

	private static _runSurroundSelectionType(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], ch: string): EditOperationResult {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			const closeCharacter = config.surroundingPairs[ch];
			commands[i] = new SurroundSelectionCommand(selection, ch, closeCharacter);
		}
		return new EditOperationResult(EditOperationType.Other, commands, {
			shouldPushStackElementBefore: true,
			shouldPushStackElementAfter: true
		});
	}

	private static _isTypeInterceptorElectricChar(config: CursorConfiguration, model: ITextModel, selections: Selection[]) {
		if (selections.length === 1 && model.isCheapToTokenize(selections[0].getEndPosition().lineNumber)) {
			return true;
		}
		return false;
	}

	private static _typeInterceptorElectricChar(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selection: Selection, ch: string): EditOperationResult | null {
		if (!config.electricChars.hasOwnProperty(ch) || !selection.isEmpty()) {
			return null;
		}

		let position = selection.getPosition();
		model.forceTokenization(position.lineNumber);
		let lineTokens = model.getLineTokens(position.lineNumber);

		let electricAction: IElectricAction | null;
		try {
			electricAction = LanguageConfigurationRegistry.onElectricCharacter(ch, lineTokens, position.column);
		} catch (e) {
			onUnexpectedError(e);
			return null;
		}

		if (!electricAction) {
			return null;
		}

		if (electricAction.matchOpenBracket) {
			let endColumn = (lineTokens.getLineContent() + ch).lastIndexOf(electricAction.matchOpenBracket) + 1;
			let match = model.findMatchingBracketUp(electricAction.matchOpenBracket, {
				lineNumber: position.lineNumber,
				column: endColumn
			});

			if (match) {
				if (match.startLineNumber === position.lineNumber) {
					// matched something on the same line => no change in indentation
					return null;
				}
				let matchLine = model.getLineContent(match.startLineNumber);
				let matchLineIndentation = strings.getLeadingWhitespace(matchLine);
				let newIndentation = config.normalizeIndentation(matchLineIndentation);

				let lineText = model.getLineContent(position.lineNumber);
				let lineFirstNonBlankColumn = model.getLineFirstNonWhitespaceColumn(position.lineNumber) || position.column;

				let prefix = lineText.substring(lineFirstNonBlankColumn - 1, position.column - 1);
				let typeText = newIndentation + prefix + ch;

				let typeSelection = new Range(position.lineNumber, 1, position.lineNumber, position.column);

				const command = new ReplaceCommand(typeSelection, typeText);
				return new EditOperationResult(EditOperationType.Typing, [command], {
					shouldPushStackElementBefore: false,
					shouldPushStackElementAfter: true
				});
			}
		}

		return null;
	}

	/**
	 * This is very similar with typing, but the character is already in the text buffer!
	 */
	public static compositionEndWithInterceptors(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selectionsWhenCompositionStarted: Selection[] | null, selections: Selection[], autoClosedCharacters: Range[]): EditOperationResult | null {
		if (!selectionsWhenCompositionStarted || Selection.selectionsArrEqual(selectionsWhenCompositionStarted, selections)) {
			// no content was typed
			return null;
		}

		let ch: string | null = null;
		// extract last typed character
		for (const selection of selections) {
			if (!selection.isEmpty()) {
				return null;
			}
			const position = selection.getPosition();
			const currentChar = model.getValueInRange(new Range(position.lineNumber, position.column - 1, position.lineNumber, position.column));
			if (ch === null) {
				ch = currentChar;
			} else if (ch !== currentChar) {
				return null;
			}
		}

		if (!ch) {
			return null;
		}

		if (this._isAutoClosingOvertype(config, model, selections, autoClosedCharacters, ch)) {
			// Unfortunately, the close character is at this point "doubled", so we need to delete it...
			const commands = selections.map(s => new ReplaceCommand(new Range(s.positionLineNumber, s.positionColumn, s.positionLineNumber, s.positionColumn + 1), '', false));
			return new EditOperationResult(EditOperationType.Typing, commands, {
				shouldPushStackElementBefore: true,
				shouldPushStackElementAfter: false
			});
		}

		const autoClosingPairClose = this._getAutoClosingPairClose(config, model, selections, ch, false);
		if (autoClosingPairClose !== null) {
			return this._runAutoClosingOpenCharType(prevEditOperationType, config, model, selections, ch, false, autoClosingPairClose);
		}

		return null;
	}

	public static typeWithInterceptors(isDoingComposition: boolean, prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], autoClosedCharacters: Range[], ch: string): EditOperationResult {

		if (!isDoingComposition && ch === '\n') {
			let commands: ICommand[] = [];
			for (let i = 0, len = selections.length; i < len; i++) {
				commands[i] = TypeOperations._enter(config, model, false, selections[i]);
			}
			return new EditOperationResult(EditOperationType.Typing, commands, {
				shouldPushStackElementBefore: true,
				shouldPushStackElementAfter: false,
			});
		}

		if (!isDoingComposition && this._isAutoIndentType(config, model, selections)) {
			let commands: Array<ICommand | null> = [];
			let autoIndentFails = false;
			for (let i = 0, len = selections.length; i < len; i++) {
				commands[i] = this._runAutoIndentType(config, model, selections[i], ch);
				if (!commands[i]) {
					autoIndentFails = true;
					break;
				}
			}
			if (!autoIndentFails) {
				return new EditOperationResult(EditOperationType.Typing, commands, {
					shouldPushStackElementBefore: true,
					shouldPushStackElementAfter: false,
				});
			}
		}

		if (!isDoingComposition && this._isAutoClosingOvertype(config, model, selections, autoClosedCharacters, ch)) {
			return this._runAutoClosingOvertype(prevEditOperationType, config, model, selections, ch);
		}

		if (!isDoingComposition) {
			const autoClosingPairClose = this._getAutoClosingPairClose(config, model, selections, ch, true);
			if (autoClosingPairClose) {
				return this._runAutoClosingOpenCharType(prevEditOperationType, config, model, selections, ch, true, autoClosingPairClose);
			}
		}

		if (this._isSurroundSelectionType(config, model, selections, ch)) {
			return this._runSurroundSelectionType(prevEditOperationType, config, model, selections, ch);
		}

		// Electric characters make sense only when dealing with a single cursor,
		// as multiple cursors typing brackets for example would interfer with bracket matching
		if (!isDoingComposition && this._isTypeInterceptorElectricChar(config, model, selections)) {
			const r = this._typeInterceptorElectricChar(prevEditOperationType, config, model, selections[0], ch);
			if (r) {
				return r;
			}
		}

		// A simple character type
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			commands[i] = new ReplaceCommand(selections[i], ch);
		}
		let shouldPushStackElementBefore = (prevEditOperationType !== EditOperationType.Typing);
		if (ch === ' ') {
			shouldPushStackElementBefore = true;
		}
		return new EditOperationResult(EditOperationType.Typing, commands, {
			shouldPushStackElementBefore: shouldPushStackElementBefore,
			shouldPushStackElementAfter: false
		});
	}

	public static typeWithoutInterceptors(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], str: string): EditOperationResult {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			commands[i] = new ReplaceCommand(selections[i], str);
		}
		return new EditOperationResult(EditOperationType.Typing, commands, {
			shouldPushStackElementBefore: (prevEditOperationType !== EditOperationType.Typing),
			shouldPushStackElementAfter: false
		});
	}

	public static lineInsertBefore(config: CursorConfiguration, model: ITextModel | null, selections: Selection[] | null): ICommand[] {
		if (model === null || selections === null) {
			return [];
		}

		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			let lineNumber = selections[i].positionLineNumber;

			if (lineNumber === 1) {
				commands[i] = new ReplaceCommandWithoutChangingPosition(new Range(1, 1, 1, 1), '\n');
			} else {
				lineNumber--;
				let column = model.getLineMaxColumn(lineNumber);

				commands[i] = this._enter(config, model, false, new Range(lineNumber, column, lineNumber, column));
			}
		}
		return commands;
	}

	public static lineInsertAfter(config: CursorConfiguration, model: ITextModel | null, selections: Selection[] | null): ICommand[] {
		if (model === null || selections === null) {
			return [];
		}

		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const lineNumber = selections[i].positionLineNumber;
			let column = model.getLineMaxColumn(lineNumber);
			commands[i] = this._enter(config, model, false, new Range(lineNumber, column, lineNumber, column));
		}
		return commands;
	}

	public static lineBreakInsert(config: CursorConfiguration, model: ITextModel, selections: Selection[]): ICommand[] {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			commands[i] = this._enter(config, model, true, selections[i]);
		}
		return commands;
	}
}

export class TypeWithAutoClosingCommand extends ReplaceCommandWithOffsetCursorState {

	private readonly _openCharacter: string;
	private readonly _closeCharacter: string;
	public closeCharacterRange: Range | null;
	public enclosingRange: Range | null;

	constructor(selection: Selection, openCharacter: string, insertOpenCharacter: boolean, closeCharacter: string) {
		super(selection, (insertOpenCharacter ? openCharacter : '') + closeCharacter, 0, -closeCharacter.length);
		this._openCharacter = openCharacter;
		this._closeCharacter = closeCharacter;
		this.closeCharacterRange = null;
		this.enclosingRange = null;
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		let inverseEditOperations = helper.getInverseEditOperations();
		let range = inverseEditOperations[0].range;
		this.closeCharacterRange = new Range(range.startLineNumber, range.endColumn - this._closeCharacter.length, range.endLineNumber, range.endColumn);
		this.enclosingRange = new Range(range.startLineNumber, range.endColumn - this._openCharacter.length - this._closeCharacter.length, range.endLineNumber, range.endColumn);
		return super.computeCursorState(model, helper);
	}
}
