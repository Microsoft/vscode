/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as strings from 'vs/base/common/strings';
import * as stringBuilder from 'vs/editor/common/core/stringBuilder';
import { Range } from 'vs/editor/common/core/range';
import { LanguageIdentifier } from 'vs/editor/common/modes';
import { CharacterPair } from 'vs/editor/common/modes/languageConfiguration';

interface InternalBracket {
	open: string[];
	close: string[];
}

export class RichEditBracket {
	_richEditBracketBrand: void;

	readonly languageIdentifier: LanguageIdentifier;
	readonly index: number;
	readonly open: string[];
	readonly close: string[];
	readonly forwardRegex: RegExp;
	readonly reversedRegex: RegExp;
	private readonly _openSet: Set<string>;
	private readonly _closeSet: Set<string>;

	constructor(languageIdentifier: LanguageIdentifier, index: number, open: string[], close: string[], forwardRegex: RegExp, reversedRegex: RegExp) {
		this.languageIdentifier = languageIdentifier;
		this.index = index;
		this.open = open;
		this.close = close;
		this.forwardRegex = forwardRegex;
		this.reversedRegex = reversedRegex;
		this._openSet = RichEditBracket._toSet(this.open);
		this._closeSet = RichEditBracket._toSet(this.close);
	}

	public isOpen(text: string) {
		return this._openSet.has(text);
	}

	public isClose(text: string) {
		return this._closeSet.has(text);
	}

	private static _toSet(arr: string[]): Set<string> {
		const result = new Set<string>();
		for (const element of arr) {
			result.add(element);
		}
		return result;
	}
}

function groupFuzzyBrackets(brackets: CharacterPair[]): InternalBracket[] {
	const N = brackets.length;

	brackets = brackets.map(b => [b[0].toLowerCase(), b[1].toLowerCase()]);

	const group: number[] = [];
	for (let i = 0; i < N; i++) {
		group[i] = i;
	}

	const areOverlapping = (a: CharacterPair, b: CharacterPair) => {
		const [aOpen, aClose] = a;
		const [bOpen, bClose] = b;
		return (aOpen === bOpen || aOpen === bClose || aClose === bOpen || aClose === bClose);
	};

	const mergeGroups = (g1: number, g2: number) => {
		const newG = Math.min(g1, g2);
		const oldG = Math.max(g1, g2);
		for (let i = 0; i < N; i++) {
			if (group[i] === oldG) {
				group[i] = newG;
			}
		}
	};

	// group together brackets that have the same open or the same close sequence
	for (let i = 0; i < N; i++) {
		const a = brackets[i];
		for (let j = i + 1; j < N; j++) {
			const b = brackets[j];
			if (areOverlapping(a, b)) {
				mergeGroups(group[i], group[j]);
			}
		}
	}

	const result: InternalBracket[] = [];
	for (let g = 0; g < N; g++) {
		let currentOpen: string[] = [];
		let currentClose: string[] = [];
		for (let i = 0; i < N; i++) {
			if (group[i] === g) {
				const [open, close] = brackets[i];
				currentOpen.push(open);
				currentClose.push(close);
			}
		}
		if (currentOpen.length > 0) {
			result.push({
				open: currentOpen,
				close: currentClose
			});
		}
	}
	return result;
}

export class RichEditBrackets {
	_richEditBracketsBrand: void;

	public readonly brackets: RichEditBracket[];
	public readonly forwardRegex: RegExp;
	public readonly reversedRegex: RegExp;
	public readonly maxBracketLength: number;
	public readonly textIsBracket: { [text: string]: RichEditBracket; };
	public readonly textIsOpenBracket: { [text: string]: boolean; };

	constructor(languageIdentifier: LanguageIdentifier, _brackets: CharacterPair[]) {
		const brackets = groupFuzzyBrackets(_brackets);

		this.brackets = brackets.map((b, index) => {
			return new RichEditBracket(
				languageIdentifier,
				index,
				b.open,
				b.close,
				getRegexForBracketPair(b.open, b.close, brackets, index),
				getReversedRegexForBracketPair(b.open, b.close, brackets, index)
			);
		});

		this.forwardRegex = getRegexForBrackets(this.brackets);
		this.reversedRegex = getReversedRegexForBrackets(this.brackets);

		this.textIsBracket = {};
		this.textIsOpenBracket = {};

		this.maxBracketLength = 0;
		for (const bracket of this.brackets) {
			for (const open of bracket.open) {
				this.textIsBracket[open] = bracket;
				this.textIsOpenBracket[open] = true;
				this.maxBracketLength = Math.max(this.maxBracketLength, open.length);
			}
			for (const close of bracket.close) {
				this.textIsBracket[close] = bracket;
				this.textIsOpenBracket[close] = false;
				this.maxBracketLength = Math.max(this.maxBracketLength, close.length);
			}
		}
	}
}

function collectSuperstrings(str: string, brackets: InternalBracket[], currentIndex: number, dest: string[]): void {
	for (let i = 0, len = brackets.length; i < len; i++) {
		if (i === currentIndex) {
			continue;
		}
		const bracket = brackets[i];
		for (const open of bracket.open) {
			if (open.indexOf(str) >= 0) {
				dest.push(open);
			}
		}
		for (const close of bracket.close) {
			if (close.indexOf(str) >= 0) {
				dest.push(close);
			}
		}
	}
}

function lengthcmp(a: string, b: string) {
	return a.length - b.length;
}

function unique(arr: string[]): string[] {
	if (arr.length <= 1) {
		return arr;
	}
	const result: string[] = [];
	const seen = new Set<string>();
	for (const element of arr) {
		if (seen.has(element)) {
			continue;
		}
		result.push(element);
		seen.add(element);
	}
	return result;
}

function getRegexForBracketPair(open: string[], close: string[], brackets: InternalBracket[], currentIndex: number): RegExp {
	// search in all brackets for other brackets that are a superstring of these brackets
	let pieces: string[] = [];
	pieces = pieces.concat(open);
	pieces = pieces.concat(close);
	for (let i = 0, len = pieces.length; i < len; i++) {
		collectSuperstrings(pieces[i], brackets, currentIndex, pieces);
	}
	pieces = unique(pieces);
	pieces.sort(lengthcmp);
	pieces.reverse();
	return createBracketOrRegExp(pieces);
}

function getReversedRegexForBracketPair(open: string[], close: string[], brackets: InternalBracket[], currentIndex: number): RegExp {
	// search in all brackets for other brackets that are a superstring of these brackets
	let pieces: string[] = [];
	pieces = pieces.concat(open);
	pieces = pieces.concat(close);
	for (let i = 0, len = pieces.length; i < len; i++) {
		collectSuperstrings(pieces[i], brackets, currentIndex, pieces);
	}
	pieces = unique(pieces);
	pieces.sort(lengthcmp);
	pieces.reverse();
	return createBracketOrRegExp(pieces.map(toReversedString));
}

function getRegexForBrackets(brackets: RichEditBracket[]): RegExp {
	let pieces: string[] = [];
	for (const bracket of brackets) {
		for (const open of bracket.open) {
			pieces.push(open);
		}
		for (const close of bracket.close) {
			pieces.push(close);
		}
	}
	pieces = unique(pieces);
	return createBracketOrRegExp(pieces);
}

function getReversedRegexForBrackets(brackets: RichEditBracket[]): RegExp {
	let pieces: string[] = [];
	for (const bracket of brackets) {
		for (const open of bracket.open) {
			pieces.push(open);
		}
		for (const close of bracket.close) {
			pieces.push(close);
		}
	}
	pieces = unique(pieces);
	return createBracketOrRegExp(pieces.map(toReversedString));
}

function prepareBracketForRegExp(str: string): string {
	// This bracket pair uses letters like e.g. "begin" - "end"
	const insertWordBoundaries = (/^[\w ]+$/.test(str));
	str = strings.escapeRegExpCharacters(str);
	return (insertWordBoundaries ? `\\b${str}\\b` : str);
}

function createBracketOrRegExp(pieces: string[]): RegExp {
	let regexStr = `(${pieces.map(prepareBracketForRegExp).join(')|(')})`;
	return strings.createRegExp(regexStr, true);
}

const toReversedString = (function () {

	function reverse(str: string): string {
		if (stringBuilder.hasTextDecoder) {
			// create a Uint16Array and then use a TextDecoder to create a string
			const arr = new Uint16Array(str.length);
			let offset = 0;
			for (let i = str.length - 1; i >= 0; i--) {
				arr[offset++] = str.charCodeAt(i);
			}
			return stringBuilder.getPlatformTextDecoder().decode(arr);
		} else {
			let result: string[] = [], resultLen = 0;
			for (let i = str.length - 1; i >= 0; i--) {
				result[resultLen++] = str.charAt(i);
			}
			return result.join('');
		}
	}

	let lastInput: string | null = null;
	let lastOutput: string | null = null;
	return function toReversedString(str: string): string {
		if (lastInput !== str) {
			lastInput = str;
			lastOutput = reverse(lastInput);
		}
		return lastOutput!;
	};
})();

export class BracketsUtils {

	private static _findPrevBracketInText(reversedBracketRegex: RegExp, lineNumber: number, reversedText: string, offset: number): Range | null {
		let m = reversedText.match(reversedBracketRegex);

		if (!m) {
			return null;
		}

		let matchOffset = reversedText.length - (m.index || 0);
		let matchLength = m[0].length;
		let absoluteMatchOffset = offset + matchOffset;

		return new Range(lineNumber, absoluteMatchOffset - matchLength + 1, lineNumber, absoluteMatchOffset + 1);
	}

	public static findPrevBracketInRange(reversedBracketRegex: RegExp, lineNumber: number, lineText: string, startOffset: number, endOffset: number): Range | null {
		// Because JS does not support backwards regex search, we search forwards in a reversed string with a reversed regex ;)
		const reversedLineText = toReversedString(lineText);
		const reversedSubstr = reversedLineText.substring(lineText.length - endOffset, lineText.length - startOffset);
		return this._findPrevBracketInText(reversedBracketRegex, lineNumber, reversedSubstr, startOffset);
	}

	public static findNextBracketInText(bracketRegex: RegExp, lineNumber: number, text: string, offset: number): Range | null {
		let m = text.match(bracketRegex);

		if (!m) {
			return null;
		}

		let matchOffset = m.index || 0;
		let matchLength = m[0].length;
		if (matchLength === 0) {
			return null;
		}
		let absoluteMatchOffset = offset + matchOffset;

		return new Range(lineNumber, absoluteMatchOffset + 1, lineNumber, absoluteMatchOffset + 1 + matchLength);
	}

	public static findNextBracketInRange(bracketRegex: RegExp, lineNumber: number, lineText: string, startOffset: number, endOffset: number): Range | null {
		const substr = lineText.substring(startOffset, endOffset);
		return this.findNextBracketInText(bracketRegex, lineNumber, substr, startOffset);
	}
}
