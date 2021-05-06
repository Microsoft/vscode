/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import * as strings from 'vs/base/common/strings';
import { EditorAutoClosingEditStrategy, EditorAutoClosingStrategy } from 'vs/editor/common/config/editorOptions';
import { CursorConfiguration, ICursorSimpleModel, SingleCursorState } from 'vs/editor/common/controller/cursorCommon';
import { DeleteOperations } from 'vs/editor/common/controller/cursorDeleteOperations';
import { WordCharacterClass, WordCharacterClassifier, getMapForWordSeparators } from 'vs/editor/common/controller/wordCharacterClassifier';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { ITextModel, IWordAtPosition } from 'vs/editor/common/model';
import { AutoClosingPairs } from 'vs/editor/common/modes/languageConfiguration';

interface IFindWordResult {
	/**
	 * The index where the word starts.
	 */
	start: number;
	/**
	 * The index where the word ends.
	 */
	end: number;
	/**
	 * The word type.
	 */
	wordType: WordType;
	/**
	 * The reason the word ended.
	 */
	nextCharClass: WordCharacterClass;
}

const enum WordType {
	None = 0,
	Regular = 1,
	Separator = 2
}

export const enum WordNavigationType {
	WordStart = 0,
	WordStartFast = 1,
	WordEnd = 2,
	WordAccessibility = 3 // Respect chrome defintion of a word
}

export interface DeleteWordContext {
	wordSeparators: WordCharacterClassifier;
	model: ITextModel;
	selection: Selection;
	whitespaceHeuristics: boolean;
	autoClosingDelete: EditorAutoClosingEditStrategy;
	autoClosingBrackets: EditorAutoClosingStrategy;
	autoClosingQuotes: EditorAutoClosingStrategy;
	autoClosingPairs: AutoClosingPairs;
	autoClosedCharacters: Range[];
}

export class WordOperations {

	private static _createWord(lineContent: string, wordType: WordType, nextCharClass: WordCharacterClass, start: number, end: number): IFindWordResult {
		// console.log('WORD ==> ' + start + ' => ' + end + ':::: <<<' + lineContent.substring(start, end) + '>>>');
		return { start: start, end: end, wordType: wordType, nextCharClass: nextCharClass };
	}

	private static _findPreviousWordOnLine(wordSeparators: WordCharacterClassifier, model: ICursorSimpleModel, position: Position): IFindWordResult | null {
		let lineContent = model.getLineContent(position.lineNumber);
		return this._doFindPreviousWordOnLine(lineContent, wordSeparators, position);
	}

	private static _doFindPreviousWordOnLine(lineContent: string, wordSeparators: WordCharacterClassifier, position: Position): IFindWordResult | null {
		let wordType = WordType.None;
		for (let chIndex = position.column - 2; chIndex >= 0; chIndex--) {
			let chCode = lineContent.charCodeAt(chIndex);
			let chClass = wordSeparators.get(chCode);

			if (chClass === WordCharacterClass.Regular) {
				if (wordType === WordType.Separator) {
					return this._createWord(lineContent, wordType, chClass, chIndex + 1, this._findEndOfWord(lineContent, wordSeparators, wordType, chIndex + 1));
				}
				wordType = WordType.Regular;
			} else if (chClass === WordCharacterClass.WordSeparator) {
				if (wordType === WordType.Regular) {
					return this._createWord(lineContent, wordType, chClass, chIndex + 1, this._findEndOfWord(lineContent, wordSeparators, wordType, chIndex + 1));
				}
				wordType = WordType.Separator;
			} else if (chClass === WordCharacterClass.Whitespace) {
				if (wordType !== WordType.None) {
					return this._createWord(lineContent, wordType, chClass, chIndex + 1, this._findEndOfWord(lineContent, wordSeparators, wordType, chIndex + 1));
				}
			}
		}

		if (wordType !== WordType.None) {
			return this._createWord(lineContent, wordType, WordCharacterClass.Whitespace, 0, this._findEndOfWord(lineContent, wordSeparators, wordType, 0));
		}

		return null;
	}

	private static _findEndOfWord(lineContent: string, wordSeparators: WordCharacterClassifier, wordType: WordType, startIndex: number): number {
		let len = lineContent.length;
		for (let chIndex = startIndex; chIndex < len; chIndex++) {
			let chCode = lineContent.charCodeAt(chIndex);
			let chClass = wordSeparators.get(chCode);

			if (chClass === WordCharacterClass.Whitespace) {
				return chIndex;
			}
			if (wordType === WordType.Regular && chClass === WordCharacterClass.WordSeparator) {
				return chIndex;
			}
			if (wordType === WordType.Separator && chClass === WordCharacterClass.Regular) {
				return chIndex;
			}
		}
		return len;
	}

	private static _findNextWordOnLine(wordSeparators: WordCharacterClassifier, model: ICursorSimpleModel, position: Position): IFindWordResult | null {
		let lineContent = model.getLineContent(position.lineNumber);
		return this._doFindNextWordOnLine(lineContent, wordSeparators, position);
	}

	private static _doFindNextWordOnLine(lineContent: string, wordSeparators: WordCharacterClassifier, position: Position): IFindWordResult | null {
		let wordType = WordType.None;
		let len = lineContent.length;

		for (let chIndex = position.column - 1; chIndex < len; chIndex++) {
			let chCode = lineContent.charCodeAt(chIndex);
			let chClass = wordSeparators.get(chCode);

			if (chClass === WordCharacterClass.Regular) {
				if (wordType === WordType.Separator) {
					return this._createWord(lineContent, wordType, chClass, this._findStartOfWord(lineContent, wordSeparators, wordType, chIndex - 1), chIndex);
				}
				wordType = WordType.Regular;
			} else if (chClass === WordCharacterClass.WordSeparator) {
				if (wordType === WordType.Regular) {
					return this._createWord(lineContent, wordType, chClass, this._findStartOfWord(lineContent, wordSeparators, wordType, chIndex - 1), chIndex);
				}
				wordType = WordType.Separator;
			} else if (chClass === WordCharacterClass.Whitespace) {
				if (wordType !== WordType.None) {
					return this._createWord(lineContent, wordType, chClass, this._findStartOfWord(lineContent, wordSeparators, wordType, chIndex - 1), chIndex);
				}
			}
		}

		if (wordType !== WordType.None) {
			return this._createWord(lineContent, wordType, WordCharacterClass.Whitespace, this._findStartOfWord(lineContent, wordSeparators, wordType, len - 1), len);
		}

		return null;
	}

	private static _findStartOfWord(lineContent: string, wordSeparators: WordCharacterClassifier, wordType: WordType, startIndex: number): number {
		for (let chIndex = startIndex; chIndex >= 0; chIndex--) {
			let chCode = lineContent.charCodeAt(chIndex);
			let chClass = wordSeparators.get(chCode);

			if (chClass === WordCharacterClass.Whitespace) {
				return chIndex + 1;
			}
			if (wordType === WordType.Regular && chClass === WordCharacterClass.WordSeparator) {
				return chIndex + 1;
			}
			if (wordType === WordType.Separator && chClass === WordCharacterClass.Regular) {
				return chIndex + 1;
			}
		}
		return 0;
	}

	public static moveWordLeft(wordSeparators: WordCharacterClassifier, model: ICursorSimpleModel, position: Position, wordNavigationType: WordNavigationType): Position {
		let lineNumber = position.lineNumber;
		let column = position.column;

		if (column === 1) {
			if (lineNumber > 1) {
				lineNumber = lineNumber - 1;
				column = model.getLineMaxColumn(lineNumber);
			}
		}

		let prevWordOnLine = WordOperations._findPreviousWordOnLine(wordSeparators, model, new Position(lineNumber, column));

		if (wordNavigationType === WordNavigationType.WordStart) {
			return new Position(lineNumber, prevWordOnLine ? prevWordOnLine.start + 1 : 1);
		}

		if (wordNavigationType === WordNavigationType.WordStartFast) {
			if (
				prevWordOnLine
				&& prevWordOnLine.wordType === WordType.Separator
				&& prevWordOnLine.end - prevWordOnLine.start === 1
				&& prevWordOnLine.nextCharClass === WordCharacterClass.Regular
			) {
				// Skip over a word made up of one single separator and followed by a regular character
				prevWordOnLine = WordOperations._findPreviousWordOnLine(wordSeparators, model, new Position(lineNumber, prevWordOnLine.start + 1));
			}

			return new Position(lineNumber, prevWordOnLine ? prevWordOnLine.start + 1 : 1);
		}

		if (wordNavigationType === WordNavigationType.WordAccessibility) {
			while (
				prevWordOnLine
				&& prevWordOnLine.wordType === WordType.Separator
			) {
				// Skip over words made up of only separators
				prevWordOnLine = WordOperations._findPreviousWordOnLine(wordSeparators, model, new Position(lineNumber, prevWordOnLine.start + 1));
			}

			return new Position(lineNumber, prevWordOnLine ? prevWordOnLine.start + 1 : 1);
		}

		// We are stopping at the ending of words

		if (prevWordOnLine && column <= prevWordOnLine.end + 1) {
			prevWordOnLine = WordOperations._findPreviousWordOnLine(wordSeparators, model, new Position(lineNumber, prevWordOnLine.start + 1));
		}

		return new Position(lineNumber, prevWordOnLine ? prevWordOnLine.end + 1 : 1);
	}

	public static _moveWordPartLeft(model: ICursorSimpleModel, position: Position): Position {
		const lineNumber = position.lineNumber;
		const maxColumn = model.getLineMaxColumn(lineNumber);

		if (position.column === 1) {
			return (lineNumber > 1 ? new Position(lineNumber - 1, model.getLineMaxColumn(lineNumber - 1)) : position);
		}

		const lineContent = model.getLineContent(lineNumber);
		for (let column = position.column - 1; column > 1; column--) {
			const left = lineContent.charCodeAt(column - 2);
			const right = lineContent.charCodeAt(column - 1);

			if (left === CharCode.Underline && right !== CharCode.Underline) {
				// snake_case_variables
				return new Position(lineNumber, column);
			}

			if (strings.isLowerAsciiLetter(left) && strings.isUpperAsciiLetter(right)) {
				// camelCaseVariables
				return new Position(lineNumber, column);
			}

			if (strings.isUpperAsciiLetter(left) && strings.isUpperAsciiLetter(right)) {
				// thisIsACamelCaseWithOneLetterWords
				if (column + 1 < maxColumn) {
					const rightRight = lineContent.charCodeAt(column);
					if (strings.isLowerAsciiLetter(rightRight)) {
						return new Position(lineNumber, column);
					}
				}
			}
		}

		return new Position(lineNumber, 1);
	}

	public static moveWordRight(wordSeparators: WordCharacterClassifier, model: ICursorSimpleModel, position: Position, wordNavigationType: WordNavigationType): Position {
		let lineNumber = position.lineNumber;
		let column = position.column;

		let movedDown = false;
		if (column === model.getLineMaxColumn(lineNumber)) {
			if (lineNumber < model.getLineCount()) {
				movedDown = true;
				lineNumber = lineNumber + 1;
				column = 1;
			}
		}

		let nextWordOnLine = WordOperations._findNextWordOnLine(wordSeparators, model, new Position(lineNumber, column));

		if (wordNavigationType === WordNavigationType.WordEnd) {
			if (nextWordOnLine && nextWordOnLine.wordType === WordType.Separator) {
				if (nextWordOnLine.end - nextWordOnLine.start === 1 && nextWordOnLine.nextCharClass === WordCharacterClass.Regular) {
					// Skip over a word made up of one single separator and followed by a regular character
					nextWordOnLine = WordOperations._findNextWordOnLine(wordSeparators, model, new Position(lineNumber, nextWordOnLine.end + 1));
				}
			}
			if (nextWordOnLine) {
				column = nextWordOnLine.end + 1;
			} else {
				column = model.getLineMaxColumn(lineNumber);
			}
		} else if (wordNavigationType === WordNavigationType.WordAccessibility) {
			if (movedDown) {
				// If we move to the next line, pretend that the cursor is right before the first character.
				// This is needed when the first word starts right at the first character - and in order not to miss it,
				// we need to start before.
				column = 0;
			}

			while (
				nextWordOnLine
				&& (nextWordOnLine.wordType === WordType.Separator
					|| nextWordOnLine.start + 1 <= column
				)
			) {
				// Skip over a word made up of one single separator
				// Also skip over word if it begins before current cursor position to ascertain we're moving forward at least 1 character.
				nextWordOnLine = WordOperations._findNextWordOnLine(wordSeparators, model, new Position(lineNumber, nextWordOnLine.end + 1));
			}

			if (nextWordOnLine) {
				column = nextWordOnLine.start + 1;
			} else {
				column = model.getLineMaxColumn(lineNumber);
			}
		} else {
			if (nextWordOnLine && !movedDown && column >= nextWordOnLine.start + 1) {
				nextWordOnLine = WordOperations._findNextWordOnLine(wordSeparators, model, new Position(lineNumber, nextWordOnLine.end + 1));
			}
			if (nextWordOnLine) {
				column = nextWordOnLine.start + 1;
			} else {
				column = model.getLineMaxColumn(lineNumber);
			}
		}

		return new Position(lineNumber, column);
	}

	public static _moveWordPartRight(model: ICursorSimpleModel, position: Position): Position {
		const lineNumber = position.lineNumber;
		const maxColumn = model.getLineMaxColumn(lineNumber);

		if (position.column === maxColumn) {
			return (lineNumber < model.getLineCount() ? new Position(lineNumber + 1, 1) : position);
		}

		const lineContent = model.getLineContent(lineNumber);
		for (let column = position.column + 1; column < maxColumn; column++) {
			const left = lineContent.charCodeAt(column - 2);
			const right = lineContent.charCodeAt(column - 1);

			if (left !== CharCode.Underline && right === CharCode.Underline) {
				// snake_case_variables
				return new Position(lineNumber, column);
			}

			if (strings.isLowerAsciiLetter(left) && strings.isUpperAsciiLetter(right)) {
				// camelCaseVariables
				return new Position(lineNumber, column);
			}

			if (strings.isUpperAsciiLetter(left) && strings.isUpperAsciiLetter(right)) {
				// thisIsACamelCaseWithOneLetterWords
				if (column + 1 < maxColumn) {
					const rightRight = lineContent.charCodeAt(column);
					if (strings.isLowerAsciiLetter(rightRight)) {
						return new Position(lineNumber, column);
					}
				}
			}
		}

		return new Position(lineNumber, maxColumn);
	}

	protected static _deleteWordLeftWhitespace(model: ICursorSimpleModel, position: Position): Range | null {
		const lineContent = model.getLineContent(position.lineNumber);
		const startIndex = position.column - 2;
		const lastNonWhitespace = strings.lastNonWhitespaceIndex(lineContent, startIndex);
		if (lastNonWhitespace + 1 < startIndex) {
			return new Range(position.lineNumber, lastNonWhitespace + 2, position.lineNumber, position.column);
		}
		return null;
	}

	public static deleteWordLeft(ctx: DeleteWordContext, wordNavigationType: WordNavigationType): Range | null {
		const wordSeparators = ctx.wordSeparators;
		const model = ctx.model;
		const selection = ctx.selection;
		const whitespaceHeuristics = ctx.whitespaceHeuristics;

		if (!selection.isEmpty()) {
			return selection;
		}

		if (DeleteOperations.isAutoClosingPairDelete(ctx.autoClosingDelete, ctx.autoClosingBrackets, ctx.autoClosingQuotes, ctx.autoClosingPairs.autoClosingPairsOpenByEnd, ctx.model, [ctx.selection], ctx.autoClosedCharacters)) {
			const position = ctx.selection.getPosition();
			return new Range(position.lineNumber, position.column - 1, position.lineNumber, position.column + 1);
		}

		const position = new Position(selection.positionLineNumber, selection.positionColumn);

		let lineNumber = position.lineNumber;
		let column = position.column;

		if (lineNumber === 1 && column === 1) {
			// Ignore deleting at beginning of file
			return null;
		}

		if (whitespaceHeuristics) {
			let r = this._deleteWordLeftWhitespace(model, position);
			if (r) {
				return r;
			}
		}

		let prevWordOnLine = WordOperations._findPreviousWordOnLine(wordSeparators, model, position);

		if (wordNavigationType === WordNavigationType.WordStart) {
			if (prevWordOnLine) {
				column = prevWordOnLine.start + 1;
			} else {
				if (column > 1) {
					column = 1;
				} else {
					lineNumber--;
					column = model.getLineMaxColumn(lineNumber);
				}
			}
		} else {
			if (prevWordOnLine && column <= prevWordOnLine.end + 1) {
				prevWordOnLine = WordOperations._findPreviousWordOnLine(wordSeparators, model, new Position(lineNumber, prevWordOnLine.start + 1));
			}
			if (prevWordOnLine) {
				column = prevWordOnLine.end + 1;
			} else {
				if (column > 1) {
					column = 1;
				} else {
					lineNumber--;
					column = model.getLineMaxColumn(lineNumber);
				}
			}
		}

		return new Range(lineNumber, column, position.lineNumber, position.column);
	}

	public static deleteInsideWord(wordSeparators: WordCharacterClassifier, model: ITextModel, selection: Selection): Range {
		if (!selection.isEmpty()) {
			return selection;
		}

		const position = new Position(selection.positionLineNumber, selection.positionColumn);

		let r = this._deleteInsideWordWhitespace(model, position);
		if (r) {
			return r;
		}

		return this._deleteInsideWordDetermineDeleteRange(wordSeparators, model, position);
	}

	private static _charAtIsWhitespace(str: string, index: number): boolean {
		const charCode = str.charCodeAt(index);
		return (charCode === CharCode.Space || charCode === CharCode.Tab);
	}

	private static _deleteInsideWordWhitespace(model: ICursorSimpleModel, position: Position): Range | null {
		const lineContent = model.getLineContent(position.lineNumber);
		const lineContentLength = lineContent.length;

		if (lineContentLength === 0) {
			// empty line
			return null;
		}

		let leftIndex = Math.max(position.column - 2, 0);
		if (!this._charAtIsWhitespace(lineContent, leftIndex)) {
			// touches a non-whitespace character to the left
			return null;
		}

		let rightIndex = Math.min(position.column - 1, lineContentLength - 1);
		if (!this._charAtIsWhitespace(lineContent, rightIndex)) {
			// touches a non-whitespace character to the right
			return null;
		}

		// walk over whitespace to the left
		while (leftIndex > 0 && this._charAtIsWhitespace(lineContent, leftIndex - 1)) {
			leftIndex--;
		}

		// walk over whitespace to the right
		while (rightIndex + 1 < lineContentLength && this._charAtIsWhitespace(lineContent, rightIndex + 1)) {
			rightIndex++;
		}

		return new Range(position.lineNumber, leftIndex + 1, position.lineNumber, rightIndex + 2);
	}

	private static _deleteInsideWordDetermineDeleteRange(wordSeparators: WordCharacterClassifier, model: ICursorSimpleModel, position: Position): Range {
		const lineContent = model.getLineContent(position.lineNumber);
		const lineLength = lineContent.length;
		if (lineLength === 0) {
			// empty line
			if (position.lineNumber > 1) {
				return new Range(position.lineNumber - 1, model.getLineMaxColumn(position.lineNumber - 1), position.lineNumber, 1);
			} else {
				if (position.lineNumber < model.getLineCount()) {
					return new Range(position.lineNumber, 1, position.lineNumber + 1, 1);
				} else {
					// empty model
					return new Range(position.lineNumber, 1, position.lineNumber, 1);
				}
			}
		}

		const touchesWord = (word: IFindWordResult) => {
			return (word.start + 1 <= position.column && position.column <= word.end + 1);
		};
		const createRangeWithPosition = (startColumn: number, endColumn: number) => {
			startColumn = Math.min(startColumn, position.column);
			endColumn = Math.max(endColumn, position.column);
			return new Range(position.lineNumber, startColumn, position.lineNumber, endColumn);
		};
		const deleteWordAndAdjacentWhitespace = (word: IFindWordResult) => {
			let startColumn = word.start + 1;
			let endColumn = word.end + 1;
			let expandedToTheRight = false;
			while (endColumn - 1 < lineLength && this._charAtIsWhitespace(lineContent, endColumn - 1)) {
				expandedToTheRight = true;
				endColumn++;
			}
			if (!expandedToTheRight) {
				while (startColumn > 1 && this._charAtIsWhitespace(lineContent, startColumn - 2)) {
					startColumn--;
				}
			}
			return createRangeWithPosition(startColumn, endColumn);
		};

		const prevWordOnLine = WordOperations._findPreviousWordOnLine(wordSeparators, model, position);
		if (prevWordOnLine && touchesWord(prevWordOnLine)) {
			return deleteWordAndAdjacentWhitespace(prevWordOnLine);
		}
		const nextWordOnLine = WordOperations._findNextWordOnLine(wordSeparators, model, position);
		if (nextWordOnLine && touchesWord(nextWordOnLine)) {
			return deleteWordAndAdjacentWhitespace(nextWordOnLine);
		}
		if (prevWordOnLine && nextWordOnLine) {
			return createRangeWithPosition(prevWordOnLine.end + 1, nextWordOnLine.start + 1);
		}
		if (prevWordOnLine) {
			return createRangeWithPosition(prevWordOnLine.start + 1, prevWordOnLine.end + 1);
		}
		if (nextWordOnLine) {
			return createRangeWithPosition(nextWordOnLine.start + 1, nextWordOnLine.end + 1);
		}

		return createRangeWithPosition(1, lineLength + 1);
	}

	public static _deleteWordPartLeft(model: ICursorSimpleModel, selection: Selection): Range {
		if (!selection.isEmpty()) {
			return selection;
		}

		const pos = selection.getPosition();
		const toPosition = WordOperations._moveWordPartLeft(model, pos);
		return new Range(pos.lineNumber, pos.column, toPosition.lineNumber, toPosition.column);
	}

	private static _findFirstNonWhitespaceChar(str: string, startIndex: number): number {
		let len = str.length;
		for (let chIndex = startIndex; chIndex < len; chIndex++) {
			let ch = str.charAt(chIndex);
			if (ch !== ' ' && ch !== '\t') {
				return chIndex;
			}
		}
		return len;
	}

	protected static _deleteWordRightWhitespace(model: ICursorSimpleModel, position: Position): Range | null {
		const lineContent = model.getLineContent(position.lineNumber);
		const startIndex = position.column - 1;
		const firstNonWhitespace = this._findFirstNonWhitespaceChar(lineContent, startIndex);
		if (startIndex + 1 < firstNonWhitespace) {
			// bingo
			return new Range(position.lineNumber, position.column, position.lineNumber, firstNonWhitespace + 1);
		}
		return null;
	}

	public static deleteWordRight(ctx: DeleteWordContext, wordNavigationType: WordNavigationType): Range | null {
		const wordSeparators = ctx.wordSeparators;
		const model = ctx.model;
		const selection = ctx.selection;
		const whitespaceHeuristics = ctx.whitespaceHeuristics;

		if (!selection.isEmpty()) {
			return selection;
		}

		const position = new Position(selection.positionLineNumber, selection.positionColumn);

		let lineNumber = position.lineNumber;
		let column = position.column;

		const lineCount = model.getLineCount();
		const maxColumn = model.getLineMaxColumn(lineNumber);
		if (lineNumber === lineCount && column === maxColumn) {
			// Ignore deleting at end of file
			return null;
		}

		if (whitespaceHeuristics) {
			let r = this._deleteWordRightWhitespace(model, position);
			if (r) {
				return r;
			}
		}

		let nextWordOnLine = WordOperations._findNextWordOnLine(wordSeparators, model, position);

		if (wordNavigationType === WordNavigationType.WordEnd) {
			if (nextWordOnLine) {
				column = nextWordOnLine.end + 1;
			} else {
				if (column < maxColumn || lineNumber === lineCount) {
					column = maxColumn;
				} else {
					lineNumber++;
					nextWordOnLine = WordOperations._findNextWordOnLine(wordSeparators, model, new Position(lineNumber, 1));
					if (nextWordOnLine) {
						column = nextWordOnLine.start + 1;
					} else {
						column = model.getLineMaxColumn(lineNumber);
					}
				}
			}
		} else {
			if (nextWordOnLine && column >= nextWordOnLine.start + 1) {
				nextWordOnLine = WordOperations._findNextWordOnLine(wordSeparators, model, new Position(lineNumber, nextWordOnLine.end + 1));
			}
			if (nextWordOnLine) {
				column = nextWordOnLine.start + 1;
			} else {
				if (column < maxColumn || lineNumber === lineCount) {
					column = maxColumn;
				} else {
					lineNumber++;
					nextWordOnLine = WordOperations._findNextWordOnLine(wordSeparators, model, new Position(lineNumber, 1));
					if (nextWordOnLine) {
						column = nextWordOnLine.start + 1;
					} else {
						column = model.getLineMaxColumn(lineNumber);
					}
				}
			}
		}

		return new Range(lineNumber, column, position.lineNumber, position.column);
	}

	public static _deleteWordPartRight(model: ICursorSimpleModel, selection: Selection): Range {
		if (!selection.isEmpty()) {
			return selection;
		}

		const pos = selection.getPosition();
		const toPosition = WordOperations._moveWordPartRight(model, pos);
		return new Range(pos.lineNumber, pos.column, toPosition.lineNumber, toPosition.column);
	}

	private static _createWordAtPosition(model: ITextModel, lineNumber: number, word: IFindWordResult): IWordAtPosition {
		const range = new Range(lineNumber, word.start + 1, lineNumber, word.end + 1);
		return {
			word: model.getValueInRange(range),
			startColumn: range.startColumn,
			endColumn: range.endColumn
		};
	}

	public static getWordAtPosition(model: ITextModel, _wordSeparators: string, position: Position): IWordAtPosition | null {
		const wordSeparators = getMapForWordSeparators(_wordSeparators);
		const prevWord = WordOperations._findPreviousWordOnLine(wordSeparators, model, position);
		if (prevWord && prevWord.wordType === WordType.Regular && prevWord.start <= position.column - 1 && position.column - 1 <= prevWord.end) {
			return WordOperations._createWordAtPosition(model, position.lineNumber, prevWord);
		}
		const nextWord = WordOperations._findNextWordOnLine(wordSeparators, model, position);
		if (nextWord && nextWord.wordType === WordType.Regular && nextWord.start <= position.column - 1 && position.column - 1 <= nextWord.end) {
			return WordOperations._createWordAtPosition(model, position.lineNumber, nextWord);
		}
		return null;
	}

	public static word(config: CursorConfiguration, model: ICursorSimpleModel, cursor: SingleCursorState, inSelectionMode: boolean, position: Position): SingleCursorState {
		const wordSeparators = getMapForWordSeparators(config.wordSeparators);
		let prevWord = WordOperations._findPreviousWordOnLine(wordSeparators, model, position);
		let nextWord = WordOperations._findNextWordOnLine(wordSeparators, model, position);

		if (!inSelectionMode) {
			// Entering word selection for the first time
			let startColumn: number;
			let endColumn: number;

			if (prevWord && prevWord.wordType === WordType.Regular && prevWord.start <= position.column - 1 && position.column - 1 <= prevWord.end) {
				// isTouchingPrevWord
				startColumn = prevWord.start + 1;
				endColumn = prevWord.end + 1;
			} else if (nextWord && nextWord.wordType === WordType.Regular && nextWord.start <= position.column - 1 && position.column - 1 <= nextWord.end) {
				// isTouchingNextWord
				startColumn = nextWord.start + 1;
				endColumn = nextWord.end + 1;
			} else {
				if (prevWord) {
					startColumn = prevWord.end + 1;
				} else {
					startColumn = 1;
				}
				if (nextWord) {
					endColumn = nextWord.start + 1;
				} else {
					endColumn = model.getLineMaxColumn(position.lineNumber);
				}
			}

			return new SingleCursorState(
				new Range(position.lineNumber, startColumn, position.lineNumber, endColumn), 0,
				new Position(position.lineNumber, endColumn), 0
			);
		}

		let startColumn: number;
		let endColumn: number;

		if (prevWord && prevWord.wordType === WordType.Regular && prevWord.start < position.column - 1 && position.column - 1 < prevWord.end) {
			// isInsidePrevWord
			startColumn = prevWord.start + 1;
			endColumn = prevWord.end + 1;
		} else if (nextWord && nextWord.wordType === WordType.Regular && nextWord.start < position.column - 1 && position.column - 1 < nextWord.end) {
			// isInsideNextWord
			startColumn = nextWord.start + 1;
			endColumn = nextWord.end + 1;
		} else {
			startColumn = position.column;
			endColumn = position.column;
		}

		let lineNumber = position.lineNumber;
		let column: number;
		if (cursor.selectionStart.containsPosition(position)) {
			column = cursor.selectionStart.endColumn;
		} else if (position.isBeforeOrEqual(cursor.selectionStart.getStartPosition())) {
			column = startColumn;
			let possiblePosition = new Position(lineNumber, column);
			if (cursor.selectionStart.containsPosition(possiblePosition)) {
				column = cursor.selectionStart.endColumn;
			}
		} else {
			column = endColumn;
			let possiblePosition = new Position(lineNumber, column);
			if (cursor.selectionStart.containsPosition(possiblePosition)) {
				column = cursor.selectionStart.startColumn;
			}
		}

		return cursor.move(true, lineNumber, column, 0);
	}
}

export class WordPartOperations extends WordOperations {
	public static deleteWordPartLeft(ctx: DeleteWordContext): Range {
		const candidates = enforceDefined([
			WordOperations.deleteWordLeft(ctx, WordNavigationType.WordStart),
			WordOperations.deleteWordLeft(ctx, WordNavigationType.WordEnd),
			WordOperations._deleteWordPartLeft(ctx.model, ctx.selection)
		]);
		candidates.sort(Range.compareRangesUsingEnds);
		return candidates[2];
	}

	public static deleteWordPartRight(ctx: DeleteWordContext): Range {
		const candidates = enforceDefined([
			WordOperations.deleteWordRight(ctx, WordNavigationType.WordStart),
			WordOperations.deleteWordRight(ctx, WordNavigationType.WordEnd),
			WordOperations._deleteWordPartRight(ctx.model, ctx.selection)
		]);
		candidates.sort(Range.compareRangesUsingStarts);
		return candidates[0];
	}

	public static moveWordPartLeft(wordSeparators: WordCharacterClassifier, model: ICursorSimpleModel, position: Position): Position {
		const candidates = enforceDefined([
			WordOperations.moveWordLeft(wordSeparators, model, position, WordNavigationType.WordStart),
			WordOperations.moveWordLeft(wordSeparators, model, position, WordNavigationType.WordEnd),
			WordOperations._moveWordPartLeft(model, position)
		]);
		candidates.sort(Position.compare);
		return candidates[2];
	}

	public static moveWordPartRight(wordSeparators: WordCharacterClassifier, model: ICursorSimpleModel, position: Position): Position {
		const candidates = enforceDefined([
			WordOperations.moveWordRight(wordSeparators, model, position, WordNavigationType.WordStart),
			WordOperations.moveWordRight(wordSeparators, model, position, WordNavigationType.WordEnd),
			WordOperations._moveWordPartRight(model, position)
		]);
		candidates.sort(Position.compare);
		return candidates[0];
	}
}

function enforceDefined<T>(arr: Array<T | undefined | null>): T[] {
	return <T[]>arr.filter(el => Boolean(el));
}
