/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import * as strings from 'vs/base/common/strings';
import { WordCharacterClass, WordCharacterClassifier, getMapForWordSeparators } from 'vs/editor/common/controller/wordCharacterClassifier';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { EndOfLinePreference, FindMatch } from 'vs/editor/common/model';
import { TextModel } from 'vs/editor/common/model/textModel';

const LIMIT_FIND_COUNT = 999;

export class SearchParams {
	public readonly searchString: string;
	public readonly isRegex: boolean;
	public readonly matchCase: boolean;
	public readonly wordSeparators: string | null;

	constructor(searchString: string, isRegex: boolean, matchCase: boolean, wordSeparators: string | null) {
		this.searchString = searchString;
		this.isRegex = isRegex;
		this.matchCase = matchCase;
		this.wordSeparators = wordSeparators;
	}

	public parseSearchRequest(): SearchData | null {
		if (this.searchString === '') {
			return null;
		}

		// Try to create a RegExp out of the params
		let multiline: boolean;
		if (this.isRegex) {
			multiline = isMultilineRegexSource(this.searchString);
		} else {
			multiline = (this.searchString.indexOf('\n') >= 0);
		}

		let regex: RegExp | null = null;
		try {
			regex = strings.createRegExp(this.searchString, this.isRegex, {
				matchCase: this.matchCase,
				wholeWord: false,
				multiline: multiline,
				global: true,
				unicode: true
			});
		} catch (err) {
			return null;
		}

		if (!regex) {
			return null;
		}

		let canUseSimpleSearch = (!this.isRegex && !multiline);
		if (canUseSimpleSearch && this.searchString.toLowerCase() !== this.searchString.toUpperCase()) {
			// casing might make a difference
			canUseSimpleSearch = this.matchCase;
		}

		return new SearchData(regex, this.wordSeparators ? getMapForWordSeparators(this.wordSeparators) : null, canUseSimpleSearch ? this.searchString : null);
	}
}

export function isMultilineRegexSource(searchString: string): boolean {
	if (!searchString || searchString.length === 0) {
		return false;
	}

	for (let i = 0, len = searchString.length; i < len; i++) {
		const chCode = searchString.charCodeAt(i);

		if (chCode === CharCode.Backslash) {

			// move to next char
			i++;

			if (i >= len) {
				// string ends with a \
				break;
			}

			const nextChCode = searchString.charCodeAt(i);
			if (nextChCode === CharCode.n || nextChCode === CharCode.r || nextChCode === CharCode.W || nextChCode === CharCode.w) {
				return true;
			}
		}
	}

	return false;
}

export class SearchData {

	/**
	 * The regex to search for. Always defined.
	 */
	public readonly regex: RegExp;
	/**
	 * The word separator classifier.
	 */
	public readonly wordSeparators: WordCharacterClassifier | null;
	/**
	 * The simple string to search for (if possible).
	 */
	public readonly simpleSearch: string | null;

	constructor(regex: RegExp, wordSeparators: WordCharacterClassifier | null, simpleSearch: string | null) {
		this.regex = regex;
		this.wordSeparators = wordSeparators;
		this.simpleSearch = simpleSearch;
	}
}

export function createFindMatch(range: Range, rawMatches: RegExpExecArray, captureMatches: boolean): FindMatch {
	if (!captureMatches) {
		return new FindMatch(range, null);
	}
	let matches: string[] = [];
	for (let i = 0, len = rawMatches.length; i < len; i++) {
		matches[i] = rawMatches[i];
	}
	return new FindMatch(range, matches);
}

class LineFeedCounter {

	private readonly _lineFeedsOffsets: number[];

	constructor(text: string) {
		let lineFeedsOffsets: number[] = [];
		let lineFeedsOffsetsLen = 0;
		for (let i = 0, textLen = text.length; i < textLen; i++) {
			if (text.charCodeAt(i) === CharCode.LineFeed) {
				lineFeedsOffsets[lineFeedsOffsetsLen++] = i;
			}
		}
		this._lineFeedsOffsets = lineFeedsOffsets;
	}

	public findLineFeedCountBeforeOffset(offset: number): number {
		const lineFeedsOffsets = this._lineFeedsOffsets;
		let min = 0;
		let max = lineFeedsOffsets.length - 1;

		if (max === -1) {
			// no line feeds
			return 0;
		}

		if (offset <= lineFeedsOffsets[0]) {
			// before first line feed
			return 0;
		}

		while (min < max) {
			const mid = min + ((max - min) / 2 >> 0);

			if (lineFeedsOffsets[mid] >= offset) {
				max = mid - 1;
			} else {
				if (lineFeedsOffsets[mid + 1] >= offset) {
					// bingo!
					min = mid;
					max = mid;
				} else {
					min = mid + 1;
				}
			}
		}
		return min + 1;
	}
}

export class TextModelSearch {

	public static findMatches(model: TextModel, searchParams: SearchParams, searchRange: Range, captureMatches: boolean, limitResultCount: number): FindMatch[] {
		const searchData = searchParams.parseSearchRequest();
		if (!searchData) {
			return [];
		}

		if (searchData.regex.multiline) {
			return this._doFindMatchesMultiline(model, searchRange, new Searcher(searchData.wordSeparators, searchData.regex), captureMatches, limitResultCount);
		}
		return this._doFindMatchesLineByLine(model, searchRange, searchData, captureMatches, limitResultCount);
	}

	/**
	 * Multiline search always executes on the lines concatenated with \n.
	 * We must therefore compensate for the count of \n in case the model is CRLF
	 */
	private static _getMultilineMatchRange(model: TextModel, deltaOffset: number, text: string, lfCounter: LineFeedCounter | null, matchIndex: number, match0: string): Range {
		let startOffset: number;
		let lineFeedCountBeforeMatch = 0;
		if (lfCounter) {
			lineFeedCountBeforeMatch = lfCounter.findLineFeedCountBeforeOffset(matchIndex);
			startOffset = deltaOffset + matchIndex + lineFeedCountBeforeMatch /* add as many \r as there were \n */;
		} else {
			startOffset = deltaOffset + matchIndex;
		}

		let endOffset: number;
		if (lfCounter) {
			let lineFeedCountBeforeEndOfMatch = lfCounter.findLineFeedCountBeforeOffset(matchIndex + match0.length);
			let lineFeedCountInMatch = lineFeedCountBeforeEndOfMatch - lineFeedCountBeforeMatch;
			endOffset = startOffset + match0.length + lineFeedCountInMatch /* add as many \r as there were \n */;
		} else {
			endOffset = startOffset + match0.length;
		}

		const startPosition = model.getPositionAt(startOffset);
		const endPosition = model.getPositionAt(endOffset);
		return new Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column);
	}

	private static _doFindMatchesMultiline(model: TextModel, searchRange: Range, searcher: Searcher, captureMatches: boolean, limitResultCount: number): FindMatch[] {
		const deltaOffset = model.getOffsetAt(searchRange.getStartPosition());
		// We always execute multiline search over the lines joined with \n
		// This makes it that \n will match the EOL for both CRLF and LF models
		// We compensate for offset errors in `_getMultilineMatchRange`
		const text = model.getValueInRange(searchRange, EndOfLinePreference.LF);
		const lfCounter = (model.getEOL() === '\r\n' ? new LineFeedCounter(text) : null);

		const result: FindMatch[] = [];
		let counter = 0;

		let m: RegExpExecArray | null;
		searcher.reset(0);
		while ((m = searcher.next(text))) {
			result[counter++] = createFindMatch(this._getMultilineMatchRange(model, deltaOffset, text, lfCounter, m.index, m[0]), m, captureMatches);
			if (counter >= limitResultCount) {
				return result;
			}
		}

		return result;
	}

	private static _doFindMatchesLineByLine(model: TextModel, searchRange: Range, searchData: SearchData, captureMatches: boolean, limitResultCount: number): FindMatch[] {
		const result: FindMatch[] = [];
		let resultLen = 0;

		// Early case for a search range that starts & stops on the same line number
		if (searchRange.startLineNumber === searchRange.endLineNumber) {
			const text = model.getLineContent(searchRange.startLineNumber).substring(searchRange.startColumn - 1, searchRange.endColumn - 1);
			resultLen = this._findMatchesInLine(searchData, text, searchRange.startLineNumber, searchRange.startColumn - 1, resultLen, result, captureMatches, limitResultCount);
			return result;
		}

		// Collect results from first line
		const text = model.getLineContent(searchRange.startLineNumber).substring(searchRange.startColumn - 1);
		resultLen = this._findMatchesInLine(searchData, text, searchRange.startLineNumber, searchRange.startColumn - 1, resultLen, result, captureMatches, limitResultCount);

		// Collect results from middle lines
		for (let lineNumber = searchRange.startLineNumber + 1; lineNumber < searchRange.endLineNumber && resultLen < limitResultCount; lineNumber++) {
			resultLen = this._findMatchesInLine(searchData, model.getLineContent(lineNumber), lineNumber, 0, resultLen, result, captureMatches, limitResultCount);
		}

		// Collect results from last line
		if (resultLen < limitResultCount) {
			const text = model.getLineContent(searchRange.endLineNumber).substring(0, searchRange.endColumn - 1);
			resultLen = this._findMatchesInLine(searchData, text, searchRange.endLineNumber, 0, resultLen, result, captureMatches, limitResultCount);
		}

		return result;
	}

	private static _findMatchesInLine(searchData: SearchData, text: string, lineNumber: number, deltaOffset: number, resultLen: number, result: FindMatch[], captureMatches: boolean, limitResultCount: number): number {
		const wordSeparators = searchData.wordSeparators;
		if (!captureMatches && searchData.simpleSearch) {
			const searchString = searchData.simpleSearch;
			const searchStringLen = searchString.length;
			const textLength = text.length;

			let lastMatchIndex = -searchStringLen;
			while ((lastMatchIndex = text.indexOf(searchString, lastMatchIndex + searchStringLen)) !== -1) {
				if (!wordSeparators || isValidMatch(wordSeparators, text, textLength, lastMatchIndex, searchStringLen)) {
					result[resultLen++] = new FindMatch(new Range(lineNumber, lastMatchIndex + 1 + deltaOffset, lineNumber, lastMatchIndex + 1 + searchStringLen + deltaOffset), null);
					if (resultLen >= limitResultCount) {
						return resultLen;
					}
				}
			}
			return resultLen;
		}

		const searcher = new Searcher(searchData.wordSeparators, searchData.regex);
		let m: RegExpExecArray | null;
		// Reset regex to search from the beginning
		searcher.reset(0);
		do {
			m = searcher.next(text);
			if (m) {
				result[resultLen++] = createFindMatch(new Range(lineNumber, m.index + 1 + deltaOffset, lineNumber, m.index + 1 + m[0].length + deltaOffset), m, captureMatches);
				if (resultLen >= limitResultCount) {
					return resultLen;
				}
			}
		} while (m);
		return resultLen;
	}

	public static findNextMatch(model: TextModel, searchParams: SearchParams, searchStart: Position, captureMatches: boolean): FindMatch | null {
		const searchData = searchParams.parseSearchRequest();
		if (!searchData) {
			return null;
		}

		const searcher = new Searcher(searchData.wordSeparators, searchData.regex);

		if (searchData.regex.multiline) {
			return this._doFindNextMatchMultiline(model, searchStart, searcher, captureMatches);
		}
		return this._doFindNextMatchLineByLine(model, searchStart, searcher, captureMatches);
	}

	private static _doFindNextMatchMultiline(model: TextModel, searchStart: Position, searcher: Searcher, captureMatches: boolean): FindMatch | null {
		const searchTextStart = new Position(searchStart.lineNumber, 1);
		const deltaOffset = model.getOffsetAt(searchTextStart);
		const lineCount = model.getLineCount();
		// We always execute multiline search over the lines joined with \n
		// This makes it that \n will match the EOL for both CRLF and LF models
		// We compensate for offset errors in `_getMultilineMatchRange`
		const text = model.getValueInRange(new Range(searchTextStart.lineNumber, searchTextStart.column, lineCount, model.getLineMaxColumn(lineCount)), EndOfLinePreference.LF);
		const lfCounter = (model.getEOL() === '\r\n' ? new LineFeedCounter(text) : null);
		searcher.reset(searchStart.column - 1);
		let m = searcher.next(text);
		if (m) {
			return createFindMatch(
				this._getMultilineMatchRange(model, deltaOffset, text, lfCounter, m.index, m[0]),
				m,
				captureMatches
			);
		}

		if (searchStart.lineNumber !== 1 || searchStart.column !== 1) {
			// Try again from the top
			return this._doFindNextMatchMultiline(model, new Position(1, 1), searcher, captureMatches);
		}

		return null;
	}

	private static _doFindNextMatchLineByLine(model: TextModel, searchStart: Position, searcher: Searcher, captureMatches: boolean): FindMatch | null {
		const lineCount = model.getLineCount();
		const startLineNumber = searchStart.lineNumber;

		// Look in first line
		const text = model.getLineContent(startLineNumber);
		const r = this._findFirstMatchInLine(searcher, text, startLineNumber, searchStart.column, captureMatches);
		if (r) {
			return r;
		}

		for (let i = 1; i <= lineCount; i++) {
			const lineIndex = (startLineNumber + i - 1) % lineCount;
			const text = model.getLineContent(lineIndex + 1);
			const r = this._findFirstMatchInLine(searcher, text, lineIndex + 1, 1, captureMatches);
			if (r) {
				return r;
			}
		}

		return null;
	}

	private static _findFirstMatchInLine(searcher: Searcher, text: string, lineNumber: number, fromColumn: number, captureMatches: boolean): FindMatch | null {
		// Set regex to search from column
		searcher.reset(fromColumn - 1);
		const m: RegExpExecArray | null = searcher.next(text);
		if (m) {
			return createFindMatch(
				new Range(lineNumber, m.index + 1, lineNumber, m.index + 1 + m[0].length),
				m,
				captureMatches
			);
		}
		return null;
	}

	public static findPreviousMatch(model: TextModel, searchParams: SearchParams, searchStart: Position, captureMatches: boolean): FindMatch | null {
		const searchData = searchParams.parseSearchRequest();
		if (!searchData) {
			return null;
		}

		const searcher = new Searcher(searchData.wordSeparators, searchData.regex);

		if (searchData.regex.multiline) {
			return this._doFindPreviousMatchMultiline(model, searchStart, searcher, captureMatches);
		}
		return this._doFindPreviousMatchLineByLine(model, searchStart, searcher, captureMatches);
	}

	private static _doFindPreviousMatchMultiline(model: TextModel, searchStart: Position, searcher: Searcher, captureMatches: boolean): FindMatch | null {
		const matches = this._doFindMatchesMultiline(model, new Range(1, 1, searchStart.lineNumber, searchStart.column), searcher, captureMatches, 10 * LIMIT_FIND_COUNT);
		if (matches.length > 0) {
			return matches[matches.length - 1];
		}

		const lineCount = model.getLineCount();
		if (searchStart.lineNumber !== lineCount || searchStart.column !== model.getLineMaxColumn(lineCount)) {
			// Try again with all content
			return this._doFindPreviousMatchMultiline(model, new Position(lineCount, model.getLineMaxColumn(lineCount)), searcher, captureMatches);
		}

		return null;
	}

	private static _doFindPreviousMatchLineByLine(model: TextModel, searchStart: Position, searcher: Searcher, captureMatches: boolean): FindMatch | null {
		const lineCount = model.getLineCount();
		const startLineNumber = searchStart.lineNumber;

		// Look in first line
		const text = model.getLineContent(startLineNumber).substring(0, searchStart.column - 1);
		const r = this._findLastMatchInLine(searcher, text, startLineNumber, captureMatches);
		if (r) {
			return r;
		}

		for (let i = 1; i <= lineCount; i++) {
			const lineIndex = (lineCount + startLineNumber - i - 1) % lineCount;
			const text = model.getLineContent(lineIndex + 1);
			const r = this._findLastMatchInLine(searcher, text, lineIndex + 1, captureMatches);
			if (r) {
				return r;
			}
		}

		return null;
	}

	private static _findLastMatchInLine(searcher: Searcher, text: string, lineNumber: number, captureMatches: boolean): FindMatch | null {
		let bestResult: FindMatch | null = null;
		let m: RegExpExecArray | null;
		searcher.reset(0);
		while ((m = searcher.next(text))) {
			bestResult = createFindMatch(new Range(lineNumber, m.index + 1, lineNumber, m.index + 1 + m[0].length), m, captureMatches);
		}
		return bestResult;
	}
}

function leftIsWordBounday(wordSeparators: WordCharacterClassifier, text: string, textLength: number, matchStartIndex: number, matchLength: number): boolean {
	if (matchStartIndex === 0) {
		// Match starts at start of string
		return true;
	}

	const charBefore = text.charCodeAt(matchStartIndex - 1);
	if (wordSeparators.get(charBefore) !== WordCharacterClass.Regular) {
		// The character before the match is a word separator
		return true;
	}

	if (charBefore === CharCode.CarriageReturn || charBefore === CharCode.LineFeed) {
		// The character before the match is line break or carriage return.
		return true;
	}

	if (matchLength > 0) {
		const firstCharInMatch = text.charCodeAt(matchStartIndex);
		if (wordSeparators.get(firstCharInMatch) !== WordCharacterClass.Regular) {
			// The first character inside the match is a word separator
			return true;
		}
	}

	return false;
}

function rightIsWordBounday(wordSeparators: WordCharacterClassifier, text: string, textLength: number, matchStartIndex: number, matchLength: number): boolean {
	if (matchStartIndex + matchLength === textLength) {
		// Match ends at end of string
		return true;
	}

	const charAfter = text.charCodeAt(matchStartIndex + matchLength);
	if (wordSeparators.get(charAfter) !== WordCharacterClass.Regular) {
		// The character after the match is a word separator
		return true;
	}

	if (charAfter === CharCode.CarriageReturn || charAfter === CharCode.LineFeed) {
		// The character after the match is line break or carriage return.
		return true;
	}

	if (matchLength > 0) {
		const lastCharInMatch = text.charCodeAt(matchStartIndex + matchLength - 1);
		if (wordSeparators.get(lastCharInMatch) !== WordCharacterClass.Regular) {
			// The last character in the match is a word separator
			return true;
		}
	}

	return false;
}

export function isValidMatch(wordSeparators: WordCharacterClassifier, text: string, textLength: number, matchStartIndex: number, matchLength: number): boolean {
	return (
		leftIsWordBounday(wordSeparators, text, textLength, matchStartIndex, matchLength)
		&& rightIsWordBounday(wordSeparators, text, textLength, matchStartIndex, matchLength)
	);
}

export class Searcher {
	public readonly _wordSeparators: WordCharacterClassifier | null;
	private readonly _searchRegex: RegExp;
	private _prevMatchStartIndex: number;
	private _prevMatchLength: number;

	constructor(wordSeparators: WordCharacterClassifier | null, searchRegex: RegExp,) {
		this._wordSeparators = wordSeparators;
		this._searchRegex = searchRegex;
		this._prevMatchStartIndex = -1;
		this._prevMatchLength = 0;
	}

	public reset(lastIndex: number): void {
		this._searchRegex.lastIndex = lastIndex;
		this._prevMatchStartIndex = -1;
		this._prevMatchLength = 0;
	}

	public next(text: string): RegExpExecArray | null {
		const textLength = text.length;

		let m: RegExpExecArray | null;
		do {
			if (this._prevMatchStartIndex + this._prevMatchLength === textLength) {
				// Reached the end of the line
				return null;
			}

			m = this._searchRegex.exec(text);
			if (!m) {
				return null;
			}

			const matchStartIndex = m.index;
			const matchLength = m[0].length;
			if (matchStartIndex === this._prevMatchStartIndex && matchLength === this._prevMatchLength) {
				if (matchLength === 0) {
					// the search result is an empty string and won't advance `regex.lastIndex`, so `regex.exec` will stuck here
					// we attempt to recover from that by advancing by two if surrogate pair found and by one otherwise
					if (strings.getNextCodePoint(text, textLength, this._searchRegex.lastIndex) > 0xFFFF) {
						this._searchRegex.lastIndex += 2;
					} else {
						this._searchRegex.lastIndex += 1;
					}
					continue;
				}
				// Exit early if the regex matches the same range twice
				return null;
			}
			this._prevMatchStartIndex = matchStartIndex;
			this._prevMatchLength = matchLength;

			if (!this._wordSeparators || isValidMatch(this._wordSeparators, text, textLength, matchStartIndex, matchLength)) {
				return m;
			}

		} while (m);

		return null;
	}
}
