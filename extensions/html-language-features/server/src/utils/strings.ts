/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function getWordAtText(text: string, offset: number, wordDefinition: RegExp): { start: number, length: number } {
	let lineStart = offset;
	while (lineStart > 0 && !isNewlineCharacter(text.charCodeAt(lineStart - 1))) {
		lineStart--;
	}
	let offsetInLine = offset - lineStart;
	let lineText = text.substr(lineStart);

	// make a copy of the regex as to not keep the state
	let flags = wordDefinition.ignoreCase ? 'gi' : 'g';
	wordDefinition = new RegExp(wordDefinition.source, flags);

	let match = wordDefinition.exec(lineText);
	while (match && match.index + match[0].length < offsetInLine) {
		match = wordDefinition.exec(lineText);
	}
	if (match && match.index <= offsetInLine) {
		return { start: match.index + lineStart, length: match[0].length };
	}

	return { start: offset, length: 0 };
}

export function startsWith(haystack: string, needle: string): boolean {
	if (haystack.length < needle.length) {
		return false;
	}

	for (let i = 0; i < needle.length; i++) {
		if (haystack[i] !== needle[i]) {
			return false;
		}
	}

	return true;
}

export function endsWith(haystack: string, needle: string): boolean {
	let diff = haystack.length - needle.length;
	if (diff > 0) {
		return haystack.indexOf(needle, diff) === diff;
	} else if (diff === 0) {
		return haystack === needle;
	} else {
		return false;
	}
}

export function repeat(value: string, count: number) {
	let s = '';
	while (count > 0) {
		if ((count & 1) === 1) {
			s += value;
		}
		value += value;
		count = count >>> 1;
	}
	return s;
}

export function isWhitespaceOnly(str: string) {
	return /^\s*$/.test(str);
}

export function isEOL(content: string, offset: number) {
	return isNewlineCharacter(content.charCodeAt(offset));
}

const CR = '\r'.charCodeAt(0);
const NL = '\n'.charCodeAt(0);
export function isNewlineCharacter(charCode: number) {
	return charCode === CR || charCode === NL;
}
