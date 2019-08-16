/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { onUnexpectedError } from 'vs/base/common/errors';
import * as strings from 'vs/base/common/strings';
import { ReplaceCommand, ReplaceCommandWithOffsetCursorState, ReplaceCommandWithoutChangingPosition } from 'vs/editor/common/commands/replaceCommand';
import { ShiftCommand } from 'vs/editor/common/commands/shiftCommand';
import { SurroundSelectionCommand } from 'vs/editor/common/commands/surroundSelectionCommand';
import { CursorColumns, CursorConfiguration, EditOperationResult, EditOperationType, ICursorSimpleModel, isQuote } from 'vs/editor/common/controller/cursorCommon';
import { WordCharacterClass, getMapForWordSeparators } from 'vs/editor/common/controller/wordCharacterClassifier';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ICommand, ICursorStateComputerData } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { EnterAction, IndentAction } from 'vs/editor/common/modes/languageConfiguration';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { IElectricAction } from 'vs/editor/common/modes/supports/electricCharacter';

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
				useTabStops: config.useTabStops
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
				useTabStops: config.useTabStops
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

			if (pasteOnNewLine && text.indexOf('\n') !== text.length - 1) {
				pasteOnNewLine = false;
			}
			if (pasteOnNewLine && selection.startLineNumber !== selection.endLineNumber) {
				pasteOnNewLine = false;
			}
			if (pasteOnNewLine && selection.startColumn === model.getLineMinColumn(selection.startLineNumber) && selection.endColumn === model.getLineMaxColumn(selection.startLineNumber)) {
				pasteOnNewLine = false;
			}

			if (pasteOnNewLine) {
				// Paste entire line at the beginning of line
				let typeSelection = new Range(position.lineNumber, 1, position.lineNumber, 1);
				commands[i] = new ReplaceCommand(typeSelection, text);
			} else {
				commands[i] = new ReplaceCommand(selection, text);
			}
		}
		return new EditOperationResult(EditOperationType.Other, commands, {
			shouldPushStackElementBefore: true,
			shouldPushStackElementAfter: true
		});
	}

	private static _distributePasteToCursors(selections: Selection[], text: string, pasteOnNewLine: boolean, multicursorText: string[]): string[] | null {
		if (pasteOnNewLine) {
			return null;
		}

		if (selections.length === 1) {
			return null;
		}

		if (multicursorText && multicursorText.length === selections.length) {
			return multicursorText;
		}

		// Remove trailing \n if present
		if (text.charCodeAt(text.length - 1) === CharCode.LineFeed) {
			text = text.substr(0, text.length - 1);
		}
		let lines = text.split(/\r\n|\r|\n/);
		if (lines.length === selections.length) {
			return lines;
		}

		return null;
	}

	public static paste(config: CursorConfiguration, model: ICursorSimpleModel, selections: Selection[], text: string, pasteOnNewLine: boolean, multicursorText: string[]): EditOperationResult {
		const distributedPaste = this._distributePasteToCursors(selections, text, pasteOnNewLine, multicursorText);

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

		let expectedIndentAction = config.autoIndent ? LanguageConfigurationRegistry.getInheritIndentForLine(model, lineNumber, false) : null;
		if (expectedIndentAction) {
			action = expectedIndentAction.action;
			indentation = expectedIndentAction.indentation;
		} else if (lineNumber > 1) {
			let lastLineNumber: number;
			for (lastLineNumber = lineNumber - 1; lastLineNumber >= 1; lastLineNumber--) {
				let lineText = model.getLineContent(lastLineNumber);
				let nonWhitespaceIdx = strings.lastNonWhitespaceIndex(lineText);
				if (nonWhitespaceIdx >= 0) {
					break;
				}
			}

			if (lastLineNumber < 1) {
				// No previous line with content found
				return null;
			}

			let maxColumn = model.getLineMaxColumn(lastLineNumber);
			let expectedEnterAction = LanguageConfigurationRegistry.getEnterAction(model, new Range(lastLineNumber, maxColumn, lastLineNumber, maxColumn));
			if (expectedEnterAction) {
				indentation = expectedEnterAction.indentation;
				action = expectedEnterAction.enterAction;
				if (action) {
					indentation += action.appendText;
				}
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
					if (!strings.startsWith(lineText, possibleTypeText)) {
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
					useTabStops: config.useTabStops
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
				// looks like https://github.com/Microsoft/vscode/issues/2773
				// where a cursor operation occurred before a canceled composition
				// => ignore composition
				commands[i] = null;
				continue;
			}
			let pos = selection.getPosition();
			let startColumn = Math.max(1, pos.column - replaceCharCnt);
			let range = new Range(pos.lineNumber, startColumn, pos.lineNumber, pos.column);
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
		if (!model.isCheapToTokenize(range.getStartPosition().lineNumber)) {
			let lineText = model.getLineContent(range.startLineNumber);
			let indentation = strings.getLeadingWhitespace(lineText).substring(0, range.startColumn - 1);
			return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(indentation), keepPosition);
		}

		let r = LanguageConfigurationRegistry.getEnterAction(model, range);
		if (r) {
			let enterAction = r.enterAction;
			let indentation = r.indentation;

			if (enterAction.indentAction === IndentAction.None) {
				// Nothing special
				return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(indentation + enterAction.appendText), keepPosition);

			} else if (enterAction.indentAction === IndentAction.Indent) {
				// Indent once
				return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(indentation + enterAction.appendText), keepPosition);

			} else if (enterAction.indentAction === IndentAction.IndentOutdent) {
				// Ultra special
				let normalIndent = config.normalizeIndentation(indentation);
				let increasedIndent = config.normalizeIndentation(indentation + enterAction.appendText);

				let typeText = '\n' + increasedIndent + '\n' + normalIndent;

				if (keepPosition) {
					return new ReplaceCommandWithoutChangingPosition(range, typeText, true);
				} else {
					return new ReplaceCommandWithOffsetCursorState(range, typeText, -1, increasedIndent.length - normalIndent.length, true);
				}
			} else if (enterAction.indentAction === IndentAction.Outdent) {
				let actualIndentation = TypeOperations.unshiftIndent(config, indentation);
				return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(actualIndentation + enterAction.appendText), keepPosition);
			}
		}

		// no enter rules applied, we should check indentation rules then.
		if (!config.autoIndent) {
			// Nothing special
			let lineText = model.getLineContent(range.startLineNumber);
			let indentation = strings.getLeadingWhitespace(lineText).substring(0, range.startColumn - 1);
			return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(indentation), keepPosition);
		}

		let ir = LanguageConfigurationRegistry.getIndentForEnter(model, range, {
			unshiftIndent: (indent) => {
				return TypeOperations.unshiftIndent(config, indent);
			},
			shiftIndent: (indent) => {
				return TypeOperations.shiftIndent(config, indent);
			},
			normalizeIndentation: (indent) => {
				return config.normalizeIndentation(indent);
			}
		}, config.autoIndent);

		let lineText = model.getLineContent(range.startLineNumber);
		let indentation = strings.getLeadingWhitespace(lineText).substring(0, range.startColumn - 1);

		if (ir) {
			let oldEndViewColumn = CursorColumns.visibleColumnFromColumn2(config, model, range.getEndPosition());
			let oldEndColumn = range.endColumn;

			let beforeText = '\n';
			if (indentation !== config.normalizeIndentation(ir.beforeEnter)) {
				beforeText = config.normalizeIndentation(ir.beforeEnter) + lineText.substring(indentation.length, range.startColumn - 1) + '\n';
				range = new Range(range.startLineNumber, 1, range.endLineNumber, range.endColumn);
			}

			let newLineContent = model.getLineContent(range.endLineNumber);
			let firstNonWhitespace = strings.firstNonWhitespaceIndex(newLineContent);
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

		} else {
			return TypeOperations._typeCommand(range, '\n' + config.normalizeIndentation(indentation), keepPosition);
		}
	}

	private static _isAutoIndentType(config: CursorConfiguration, model: ITextModel, selections: Selection[]): boolean {
		if (!config.autoIndent) {
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
		let currentIndentation = LanguageConfigurationRegistry.getIndentationAtPosition(model, range.startLineNumber, range.startColumn);
		let actualIndentation = LanguageConfigurationRegistry.getIndentActionForType(model, range, ch, {
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
			let firstNonWhitespace = model.getLineFirstNonWhitespaceColumn(range.startLineNumber);
			if (firstNonWhitespace === 0) {
				return TypeOperations._typeCommand(
					new Range(range.startLineNumber, 0, range.endLineNumber, range.endColumn),
					config.normalizeIndentation(actualIndentation) + ch,
					false
				);
			} else {
				return TypeOperations._typeCommand(
					new Range(range.startLineNumber, 0, range.endLineNumber, range.endColumn),
					config.normalizeIndentation(actualIndentation) +
					model.getLineContent(range.startLineNumber).substring(firstNonWhitespace - 1, range.startColumn - 1) + ch,
					false
				);
			}
		}

		return null;
	}

	private static _isAutoClosingCloseCharType(config: CursorConfiguration, model: ITextModel, selections: Selection[], autoClosedCharacters: Range[], ch: string): boolean {
		const autoCloseConfig = isQuote(ch) ? config.autoClosingQuotes : config.autoClosingBrackets;

		if (autoCloseConfig === 'never' || !config.autoClosingPairsClose.hasOwnProperty(ch)) {
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

			// Must over-type a closing character typed by the editor
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

		return true;
	}

	private static _countNeedlesInHaystack(haystack: string, needle: string): number {
		let cnt = 0;
		let lastIndex = -1;
		while ((lastIndex = haystack.indexOf(needle, lastIndex + 1)) !== -1) {
			cnt++;
		}
		return cnt;
	}

	private static _runAutoClosingCloseCharType(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], ch: string): EditOperationResult {
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

	private static _isBeforeClosingBrace(config: CursorConfiguration, ch: string, characterAfter: string) {
		const thisBraceIsSymmetric = (config.autoClosingPairsOpen[ch] === ch);
		let isBeforeCloseBrace = false;
		for (let otherCloseBrace in config.autoClosingPairsClose) {
			const otherBraceIsSymmetric = (config.autoClosingPairsOpen[otherCloseBrace] === otherCloseBrace);
			if (!thisBraceIsSymmetric && otherBraceIsSymmetric) {
				continue;
			}
			if (characterAfter === otherCloseBrace) {
				isBeforeCloseBrace = true;
				break;
			}
		}

		return isBeforeCloseBrace;
	}

	private static _isAutoClosingOpenCharType(config: CursorConfiguration, model: ITextModel, selections: Selection[], ch: string): boolean {
		const chIsQuote = isQuote(ch);
		const autoCloseConfig = chIsQuote ? config.autoClosingQuotes : config.autoClosingBrackets;

		if (autoCloseConfig === 'never' || !config.autoClosingPairsOpen.hasOwnProperty(ch)) {
			return false;
		}

		let shouldAutoCloseBefore = chIsQuote ? config.shouldAutoCloseBefore.quote : config.shouldAutoCloseBefore.bracket;

		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			if (!selection.isEmpty()) {
				return false;
			}

			const position = selection.getPosition();
			const lineText = model.getLineContent(position.lineNumber);

			// Do not auto-close ' or " after a word character
			if ((chIsQuote && position.column > 1) && autoCloseConfig !== 'always') {
				const wordSeparators = getMapForWordSeparators(config.wordSeparators);
				const characterBeforeCode = lineText.charCodeAt(position.column - 2);
				const characterBeforeType = wordSeparators.get(characterBeforeCode);
				if (characterBeforeType === WordCharacterClass.Regular) {
					return false;
				}
			}

			// Only consider auto closing the pair if a space follows or if another autoclosed pair follows
			const characterAfter = lineText.charAt(position.column - 1);
			if (characterAfter) {
				let isBeforeCloseBrace = TypeOperations._isBeforeClosingBrace(config, ch, characterAfter);

				if (!isBeforeCloseBrace && !shouldAutoCloseBefore(characterAfter)) {
					return false;
				}
			}

			if (!model.isCheapToTokenize(position.lineNumber)) {
				// Do not force tokenization
				return false;
			}

			model.forceTokenization(position.lineNumber);
			const lineTokens = model.getLineTokens(position.lineNumber);

			let shouldAutoClosePair = false;
			try {
				shouldAutoClosePair = LanguageConfigurationRegistry.shouldAutoClosePair(ch, lineTokens, position.column);
			} catch (e) {
				onUnexpectedError(e);
			}

			if (!shouldAutoClosePair) {
				return false;
			}
		}

		return true;
	}

	private static _runAutoClosingOpenCharType(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], ch: string): EditOperationResult {
		let commands: ICommand[] = [];
		for (let i = 0, len = selections.length; i < len; i++) {
			const selection = selections[i];
			const closeCharacter = config.autoClosingPairsOpen[ch];
			commands[i] = new TypeWithAutoClosingCommand(selection, ch, closeCharacter);
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

	private static _isIgnorableAutoCloseCommentElectricAction(config: CursorConfiguration, model: ITextModel, selection: Selection, electricAction: IElectricAction) {
		// Check whether this is an action which geenrates auto-closing text.
		if (!electricAction.appendText || !electricAction.matchOpenText) {
			return false;
		}
		// Check if it is a block comment which is being closed.
		if (!config.blockCommentPairsClose.hasOwnProperty(electricAction.matchOpenText)) {
			return false;
		}
		// TODO: Verify that appending text is the closing comment block.
		if (config.autoClosingComments === 'never') {
			return true;
		}
		const position = selection.getPosition();
		const lineText = model.getLineContent(position.lineNumber);
		const characterAfter = lineText.charAt(position.column - 1);
		if (characterAfter) {
			if (!config.shouldAutoCloseBefore.comment(characterAfter)) {
				return true;
			}
		}
		return false;
	}

	private static _isIgnorableElectricAction(config: CursorConfiguration, model: ITextModel, selection: Selection, electricAction: IElectricAction) {
		return this._isIgnorableAutoCloseCommentElectricAction(config, model, selection, electricAction);
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

		if (this._isIgnorableElectricAction(config, model, selection, electricAction)) {
			return null;
		}

		if (electricAction.appendText) {
			const command = new ReplaceCommandWithOffsetCursorState(selection, ch + electricAction.appendText, 0, -electricAction.appendText.length);
			return new EditOperationResult(EditOperationType.Typing, [command], {
				shouldPushStackElementBefore: false,
				shouldPushStackElementAfter: true
			});
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

	public static compositionEndWithInterceptors(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[]): EditOperationResult | null {
		if (config.autoClosingQuotes === 'never') {
			return null;
		}

		let commands: ICommand[] = [];

		for (let i = 0; i < selections.length; i++) {
			if (!selections[i].isEmpty()) {
				continue;
			}
			const position = selections[i].getPosition();
			const lineText = model.getLineContent(position.lineNumber);
			const ch = lineText.charAt(position.column - 2);

			if (config.autoClosingPairsClose.hasOwnProperty(ch)) { // first of all, it's a closing tag
				if (ch === config.autoClosingPairsClose[ch] /** isEqualPair */) {
					const lineTextBeforeCursor = lineText.substr(0, position.column - 2);
					const chCntBefore = this._countNeedlesInHaystack(lineTextBeforeCursor, ch);

					if (chCntBefore % 2 === 1) {
						continue; // it pairs with the opening tag.
					}
				}
			}

			// As we are not typing in a new character, so we don't need to run `_runAutoClosingCloseCharType`
			// Next step, let's try to check if it's an open char.
			if (config.autoClosingPairsOpen.hasOwnProperty(ch)) {
				if (isQuote(ch) && position.column > 2) {
					const wordSeparators = getMapForWordSeparators(config.wordSeparators);
					const characterBeforeCode = lineText.charCodeAt(position.column - 3);
					const characterBeforeType = wordSeparators.get(characterBeforeCode);
					if (characterBeforeType === WordCharacterClass.Regular) {
						continue;
					}
				}

				const characterAfter = lineText.charAt(position.column - 1);

				if (characterAfter) {
					let isBeforeCloseBrace = TypeOperations._isBeforeClosingBrace(config, ch, characterAfter);
					let shouldAutoCloseBefore = isQuote(ch) ? config.shouldAutoCloseBefore.quote : config.shouldAutoCloseBefore.bracket;
					if (isBeforeCloseBrace) {
						// In normal auto closing logic, we will auto close if the cursor is even before a closing brace intentionally.
						// However for composition mode, we do nothing here as users might clear all the characters for composition and we don't want to do a unnecessary auto close.
						// Related: microsoft/vscode#57250.
						continue;
					}
					if (!shouldAutoCloseBefore(characterAfter)) {
						continue;
					}
				}

				if (!model.isCheapToTokenize(position.lineNumber)) {
					// Do not force tokenization
					continue;
				}

				model.forceTokenization(position.lineNumber);
				const lineTokens = model.getLineTokens(position.lineNumber);

				let shouldAutoClosePair = false;

				try {
					shouldAutoClosePair = LanguageConfigurationRegistry.shouldAutoClosePair(ch, lineTokens, position.column - 1);
				} catch (e) {
					onUnexpectedError(e);
				}

				if (shouldAutoClosePair) {
					const closeCharacter = config.autoClosingPairsOpen[ch];
					commands[i] = new ReplaceCommandWithOffsetCursorState(selections[i], closeCharacter, 0, -closeCharacter.length);
				}
			}
		}

		return new EditOperationResult(EditOperationType.Typing, commands, {
			shouldPushStackElementBefore: true,
			shouldPushStackElementAfter: false
		});
	}

	public static typeWithInterceptors(prevEditOperationType: EditOperationType, config: CursorConfiguration, model: ITextModel, selections: Selection[], autoClosedCharacters: Range[], ch: string): EditOperationResult {

		if (ch === '\n') {
			let commands: ICommand[] = [];
			for (let i = 0, len = selections.length; i < len; i++) {
				commands[i] = TypeOperations._enter(config, model, false, selections[i]);
			}
			return new EditOperationResult(EditOperationType.Typing, commands, {
				shouldPushStackElementBefore: true,
				shouldPushStackElementAfter: false,
			});
		}

		if (this._isAutoIndentType(config, model, selections)) {
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

		if (this._isAutoClosingCloseCharType(config, model, selections, autoClosedCharacters, ch)) {
			return this._runAutoClosingCloseCharType(prevEditOperationType, config, model, selections, ch);
		}

		if (this._isAutoClosingOpenCharType(config, model, selections, ch)) {
			return this._runAutoClosingOpenCharType(prevEditOperationType, config, model, selections, ch);
		}

		if (this._isSurroundSelectionType(config, model, selections, ch)) {
			return this._runSurroundSelectionType(prevEditOperationType, config, model, selections, ch);
		}

		// Electric characters make sense only when dealing with a single cursor,
		// as multiple cursors typing brackets for example would interfer with bracket matching
		if (this._isTypeInterceptorElectricChar(config, model, selections)) {
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

	private _closeCharacter: string;
	public closeCharacterRange: Range | null;
	public enclosingRange: Range | null;

	constructor(selection: Selection, openCharacter: string, closeCharacter: string) {
		super(selection, openCharacter + closeCharacter, 0, -closeCharacter.length);
		this._closeCharacter = closeCharacter;
		this.closeCharacterRange = null;
		this.enclosingRange = null;
	}

	public computeCursorState(model: ITextModel, helper: ICursorStateComputerData): Selection {
		let inverseEditOperations = helper.getInverseEditOperations();
		let range = inverseEditOperations[0].range;
		this.closeCharacterRange = new Range(range.startLineNumber, range.endColumn - this._closeCharacter.length, range.endLineNumber, range.endColumn);
		this.enclosingRange = range;
		return super.computeCursorState(model, helper);
	}
}
