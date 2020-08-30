/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CharCode } from 'vs/base/common/charCode';
import { ITextBuffer } from 'vs/editor/common/model';

class SpacesDiffResult {
	public spacesDiff: number = 0;
	public looksLikeAlignment: boolean = false;
}

/**
 * Compute the diff in spaces between two line's indentation.
 */
function spacesDiff(a: string, aLength: number, b: string, bLength: number, result: SpacesDiffResult): void {

	result.spacesDiff = 0;
	result.looksLikeAlignment = false;

	// This can go both ways (e.g.):
	//  - a: "\t"
	//  - b: "\t    "
	//  => This should count 1 tab and 4 spaces

	let i: number;

	for (i = 0; i < aLength && i < bLength; i++) {
		let aCharCode = a.charCodeAt(i);
		let bCharCode = b.charCodeAt(i);

		if (aCharCode !== bCharCode) {
			break;
		}
	}

	let aSpacesCnt = 0, aTabsCount = 0;
	for (let j = i; j < aLength; j++) {
		let aCharCode = a.charCodeAt(j);
		if (aCharCode === CharCode.Space) {
			aSpacesCnt++;
		} else {
			aTabsCount++;
		}
	}

	let bSpacesCnt = 0, bTabsCount = 0;
	for (let j = i; j < bLength; j++) {
		let bCharCode = b.charCodeAt(j);
		if (bCharCode === CharCode.Space) {
			bSpacesCnt++;
		} else {
			bTabsCount++;
		}
	}

	if (aSpacesCnt > 0 && aTabsCount > 0) {
		return;
	}
	if (bSpacesCnt > 0 && bTabsCount > 0) {
		return;
	}

	let tabsDiff = Math.abs(aTabsCount - bTabsCount);
	let spacesDiff = Math.abs(aSpacesCnt - bSpacesCnt);

	if (tabsDiff === 0) {
		// check if the indentation difference might be caused by alignment reasons
		// sometime folks like to align their code, but this should not be used as a hint
		result.spacesDiff = spacesDiff;

		if (spacesDiff > 0 && 0 <= bSpacesCnt - 1 && bSpacesCnt - 1 < a.length && bSpacesCnt < b.length) {
			if (b.charCodeAt(bSpacesCnt) !== CharCode.Space && a.charCodeAt(bSpacesCnt - 1) === CharCode.Space) {
				if (a.charCodeAt(a.length - 1) === CharCode.Comma) {
					// This looks like an alignment desire: e.g.
					// const a = b + c,
					//       d = b - c;
					result.looksLikeAlignment = true;
				}
			}
		}
		return;
	}
	if (spacesDiff % tabsDiff === 0) {
		result.spacesDiff = spacesDiff / tabsDiff;
		return;
	}
}

/**
 * Result for a guessIndentation
 */
export interface IGuessedIndentation {
	/**
	 * If indentation is based on spaces (`insertSpaces` = true), then what is the number of spaces that make an indent?
	 */
	tabSize: number;
	/**
	 * Is indentation based on spaces?
	 */
	insertSpaces: boolean;
}

export function guessIndentation(source: ITextBuffer, defaultTabSize: number, defaultInsertSpaces: boolean): IGuessedIndentation {
	// Look at most at the first 10k lines
	const linesCount = Math.min(source.getLineCount(), 10000);

	let linesIndentedWithTabsCount = 0;				// number of lines that contain at least one tab in indentation
	let linesIndentedWithSpacesCount = 0;			// number of lines that contain only spaces in indentation

	let previousLineText = '';						// content of latest line that contained non-whitespace chars
	let previousLineIndentation = 0;				// index at which latest line contained the first non-whitespace char

	const ALLOWED_TAB_SIZE_GUESSES = [2, 4, 6, 8, 3, 5, 7];	// prefer even guesses for `tabSize`, limit to [2, 8].
	const MAX_ALLOWED_TAB_SIZE_GUESS = 8;			// max(ALLOWED_TAB_SIZE_GUESSES) = 8

	let spacesDiffCount = [0, 0, 0, 0, 0, 0, 0, 0, 0];		// `tabSize` scores
	let tmp = new SpacesDiffResult();

	for (let lineNumber = 1; lineNumber <= linesCount; lineNumber++) {
		let currentLineLength = source.getLineLength(lineNumber);
		let currentLineText = source.getLineContent(lineNumber);

		// if the text buffer is chunk based, so long lines are cons-string, v8 will flattern the string when we check charCode.
		// checking charCode on chunks directly is cheaper.
		const useCurrentLineText = (currentLineLength <= 65536);

		let currentLineHasContent = false;			// does `currentLineText` contain non-whitespace chars
		let currentLineIndentation = 0;				// index at which `currentLineText` contains the first non-whitespace char
		let currentLineSpacesCount = 0;				// count of spaces found in `currentLineText` indentation
		let currentLineTabsCount = 0;				// count of tabs found in `currentLineText` indentation
		for (let j = 0, lenJ = currentLineLength; j < lenJ; j++) {
			let charCode = (useCurrentLineText ? currentLineText.charCodeAt(j) : source.getLineCharCode(lineNumber, j));

			if (charCode === CharCode.Tab) {
				currentLineTabsCount++;
			} else if (charCode === CharCode.Space) {
				currentLineSpacesCount++;
			} else {
				// Hit non whitespace character on this line
				currentLineHasContent = true;
				currentLineIndentation = j;
				break;
			}
		}

		// Ignore empty or only whitespace lines
		if (!currentLineHasContent) {
			continue;
		}

		if (currentLineTabsCount > 0) {
			linesIndentedWithTabsCount++;
		} else if (currentLineSpacesCount > 1) {
			linesIndentedWithSpacesCount++;
		}

		spacesDiff(previousLineText, previousLineIndentation, currentLineText, currentLineIndentation, tmp);

		if (tmp.looksLikeAlignment) {
			// if defaultInsertSpaces === true && the spaces count == tabSize, we may want to count it as valid indentation
			//
			// - item1
			//   - item2
			//
			// otherwise skip this line entirely
			//
			// const a = 1,
			//       b = 2;

			if (!(defaultInsertSpaces && defaultTabSize === tmp.spacesDiff)) {
				continue;
			}
		}

		let currentSpacesDiff = tmp.spacesDiff;
		if (currentSpacesDiff <= MAX_ALLOWED_TAB_SIZE_GUESS) {
			spacesDiffCount[currentSpacesDiff]++;
		}

		previousLineText = currentLineText;
		previousLineIndentation = currentLineIndentation;
	}

	let insertSpaces = defaultInsertSpaces;
	if (linesIndentedWithTabsCount !== linesIndentedWithSpacesCount) {
		insertSpaces = (linesIndentedWithTabsCount < linesIndentedWithSpacesCount);
	}

	let tabSize = defaultTabSize;

	// Guess tabSize only if inserting spaces...
	if (insertSpaces) {
		let tabSizeScore = (insertSpaces ? 0 : 0.1 * linesCount);

		// console.log("score threshold: " + tabSizeScore);

		ALLOWED_TAB_SIZE_GUESSES.forEach((possibleTabSize) => {
			let possibleTabSizeScore = spacesDiffCount[possibleTabSize];
			if (possibleTabSizeScore > tabSizeScore) {
				tabSizeScore = possibleTabSizeScore;
				tabSize = possibleTabSize;
			}
		});

		// Let a tabSize of 2 win even if it is not the maximum
		// (only in case 4 was guessed)
		if (tabSize === 4 && spacesDiffCount[4] > 0 && spacesDiffCount[2] > 0 && spacesDiffCount[2] >= spacesDiffCount[4] / 2) {
			tabSize = 2;
		}
	}


	// console.log('--------------------------');
	// console.log('linesIndentedWithTabsCount: ' + linesIndentedWithTabsCount + ', linesIndentedWithSpacesCount: ' + linesIndentedWithSpacesCount);
	// console.log('spacesDiffCount: ' + spacesDiffCount);
	// console.log('tabSize: ' + tabSize + ', tabSizeScore: ' + tabSizeScore);

	return {
		insertSpaces: insertSpaces,
		tabSize: tabSize
	};
}
