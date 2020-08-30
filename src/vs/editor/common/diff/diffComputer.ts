/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDiffChange, ISequence, LcsDiff, IDiffResult } from 'vs/base/common/diff/diff';
import * as strings from 'vs/base/common/strings';
import { ICharChange, ILineChange } from 'vs/editor/common/editorCommon';

const MINIMUM_MATCHING_CHARACTER_LENGTH = 3;

export interface IDiffComputerResult {
	quitEarly: boolean;
	changes: ILineChange[];
}

function computeDiff(originalSequence: ISequence, modifiedSequence: ISequence, continueProcessingPredicate: () => boolean, pretty: boolean): IDiffResult {
	const diffAlgo = new LcsDiff(originalSequence, modifiedSequence, continueProcessingPredicate);
	return diffAlgo.ComputeDiff(pretty);
}

class LineSequence implements ISequence {

	public readonly lines: string[];
	private readonly _startColumns: number[];
	private readonly _endColumns: number[];

	constructor(lines: string[]) {
		const startColumns: number[] = [];
		const endColumns: number[] = [];
		for (let i = 0, length = lines.length; i < length; i++) {
			startColumns[i] = getFirstNonBlankColumn(lines[i], 1);
			endColumns[i] = getLastNonBlankColumn(lines[i], 1);
		}
		this.lines = lines;
		this._startColumns = startColumns;
		this._endColumns = endColumns;
	}

	public getElements(): Int32Array | number[] | string[] {
		const elements: string[] = [];
		for (let i = 0, len = this.lines.length; i < len; i++) {
			elements[i] = this.lines[i].substring(this._startColumns[i] - 1, this._endColumns[i] - 1);
		}
		return elements;
	}

	public getStartLineNumber(i: number): number {
		return i + 1;
	}

	public getEndLineNumber(i: number): number {
		return i + 1;
	}

	public createCharSequence(shouldIgnoreTrimWhitespace: boolean, startIndex: number, endIndex: number): CharSequence {
		const charCodes: number[] = [];
		const lineNumbers: number[] = [];
		const columns: number[] = [];
		let len = 0;
		for (let index = startIndex; index <= endIndex; index++) {
			const lineContent = this.lines[index];
			const startColumn = (shouldIgnoreTrimWhitespace ? this._startColumns[index] : 1);
			const endColumn = (shouldIgnoreTrimWhitespace ? this._endColumns[index] : lineContent.length + 1);
			for (let col = startColumn; col < endColumn; col++) {
				charCodes[len] = lineContent.charCodeAt(col - 1);
				lineNumbers[len] = index + 1;
				columns[len] = col;
				len++;
			}
		}
		return new CharSequence(charCodes, lineNumbers, columns);
	}
}

class CharSequence implements ISequence {

	private readonly _charCodes: number[];
	private readonly _lineNumbers: number[];
	private readonly _columns: number[];

	constructor(charCodes: number[], lineNumbers: number[], columns: number[]) {
		this._charCodes = charCodes;
		this._lineNumbers = lineNumbers;
		this._columns = columns;
	}

	public getElements(): Int32Array | number[] | string[] {
		return this._charCodes;
	}

	public getStartLineNumber(i: number): number {
		return this._lineNumbers[i];
	}

	public getStartColumn(i: number): number {
		return this._columns[i];
	}

	public getEndLineNumber(i: number): number {
		return this._lineNumbers[i];
	}

	public getEndColumn(i: number): number {
		return this._columns[i] + 1;
	}
}

class CharChange implements ICharChange {

	public originalStartLineNumber: number;
	public originalStartColumn: number;
	public originalEndLineNumber: number;
	public originalEndColumn: number;

	public modifiedStartLineNumber: number;
	public modifiedStartColumn: number;
	public modifiedEndLineNumber: number;
	public modifiedEndColumn: number;

	constructor(
		originalStartLineNumber: number,
		originalStartColumn: number,
		originalEndLineNumber: number,
		originalEndColumn: number,
		modifiedStartLineNumber: number,
		modifiedStartColumn: number,
		modifiedEndLineNumber: number,
		modifiedEndColumn: number
	) {
		this.originalStartLineNumber = originalStartLineNumber;
		this.originalStartColumn = originalStartColumn;
		this.originalEndLineNumber = originalEndLineNumber;
		this.originalEndColumn = originalEndColumn;
		this.modifiedStartLineNumber = modifiedStartLineNumber;
		this.modifiedStartColumn = modifiedStartColumn;
		this.modifiedEndLineNumber = modifiedEndLineNumber;
		this.modifiedEndColumn = modifiedEndColumn;
	}

	public static createFromDiffChange(diffChange: IDiffChange, originalCharSequence: CharSequence, modifiedCharSequence: CharSequence): CharChange {
		let originalStartLineNumber: number;
		let originalStartColumn: number;
		let originalEndLineNumber: number;
		let originalEndColumn: number;
		let modifiedStartLineNumber: number;
		let modifiedStartColumn: number;
		let modifiedEndLineNumber: number;
		let modifiedEndColumn: number;

		if (diffChange.originalLength === 0) {
			originalStartLineNumber = 0;
			originalStartColumn = 0;
			originalEndLineNumber = 0;
			originalEndColumn = 0;
		} else {
			originalStartLineNumber = originalCharSequence.getStartLineNumber(diffChange.originalStart);
			originalStartColumn = originalCharSequence.getStartColumn(diffChange.originalStart);
			originalEndLineNumber = originalCharSequence.getEndLineNumber(diffChange.originalStart + diffChange.originalLength - 1);
			originalEndColumn = originalCharSequence.getEndColumn(diffChange.originalStart + diffChange.originalLength - 1);
		}

		if (diffChange.modifiedLength === 0) {
			modifiedStartLineNumber = 0;
			modifiedStartColumn = 0;
			modifiedEndLineNumber = 0;
			modifiedEndColumn = 0;
		} else {
			modifiedStartLineNumber = modifiedCharSequence.getStartLineNumber(diffChange.modifiedStart);
			modifiedStartColumn = modifiedCharSequence.getStartColumn(diffChange.modifiedStart);
			modifiedEndLineNumber = modifiedCharSequence.getEndLineNumber(diffChange.modifiedStart + diffChange.modifiedLength - 1);
			modifiedEndColumn = modifiedCharSequence.getEndColumn(diffChange.modifiedStart + diffChange.modifiedLength - 1);
		}

		return new CharChange(
			originalStartLineNumber, originalStartColumn, originalEndLineNumber, originalEndColumn,
			modifiedStartLineNumber, modifiedStartColumn, modifiedEndLineNumber, modifiedEndColumn,
		);
	}
}

function postProcessCharChanges(rawChanges: IDiffChange[]): IDiffChange[] {
	if (rawChanges.length <= 1) {
		return rawChanges;
	}

	const result = [rawChanges[0]];
	let prevChange = result[0];

	for (let i = 1, len = rawChanges.length; i < len; i++) {
		const currChange = rawChanges[i];

		const originalMatchingLength = currChange.originalStart - (prevChange.originalStart + prevChange.originalLength);
		const modifiedMatchingLength = currChange.modifiedStart - (prevChange.modifiedStart + prevChange.modifiedLength);
		// Both of the above should be equal, but the continueProcessingPredicate may prevent this from being true
		const matchingLength = Math.min(originalMatchingLength, modifiedMatchingLength);

		if (matchingLength < MINIMUM_MATCHING_CHARACTER_LENGTH) {
			// Merge the current change into the previous one
			prevChange.originalLength = (currChange.originalStart + currChange.originalLength) - prevChange.originalStart;
			prevChange.modifiedLength = (currChange.modifiedStart + currChange.modifiedLength) - prevChange.modifiedStart;
		} else {
			// Add the current change
			result.push(currChange);
			prevChange = currChange;
		}
	}

	return result;
}

class LineChange implements ILineChange {
	public originalStartLineNumber: number;
	public originalEndLineNumber: number;
	public modifiedStartLineNumber: number;
	public modifiedEndLineNumber: number;
	public charChanges: CharChange[] | undefined;

	constructor(
		originalStartLineNumber: number,
		originalEndLineNumber: number,
		modifiedStartLineNumber: number,
		modifiedEndLineNumber: number,
		charChanges: CharChange[] | undefined
	) {
		this.originalStartLineNumber = originalStartLineNumber;
		this.originalEndLineNumber = originalEndLineNumber;
		this.modifiedStartLineNumber = modifiedStartLineNumber;
		this.modifiedEndLineNumber = modifiedEndLineNumber;
		this.charChanges = charChanges;
	}

	public static createFromDiffResult(shouldIgnoreTrimWhitespace: boolean, diffChange: IDiffChange, originalLineSequence: LineSequence, modifiedLineSequence: LineSequence, continueCharDiff: () => boolean, shouldComputeCharChanges: boolean, shouldPostProcessCharChanges: boolean): LineChange {
		let originalStartLineNumber: number;
		let originalEndLineNumber: number;
		let modifiedStartLineNumber: number;
		let modifiedEndLineNumber: number;
		let charChanges: CharChange[] | undefined = undefined;

		if (diffChange.originalLength === 0) {
			originalStartLineNumber = originalLineSequence.getStartLineNumber(diffChange.originalStart) - 1;
			originalEndLineNumber = 0;
		} else {
			originalStartLineNumber = originalLineSequence.getStartLineNumber(diffChange.originalStart);
			originalEndLineNumber = originalLineSequence.getEndLineNumber(diffChange.originalStart + diffChange.originalLength - 1);
		}

		if (diffChange.modifiedLength === 0) {
			modifiedStartLineNumber = modifiedLineSequence.getStartLineNumber(diffChange.modifiedStart) - 1;
			modifiedEndLineNumber = 0;
		} else {
			modifiedStartLineNumber = modifiedLineSequence.getStartLineNumber(diffChange.modifiedStart);
			modifiedEndLineNumber = modifiedLineSequence.getEndLineNumber(diffChange.modifiedStart + diffChange.modifiedLength - 1);
		}

		if (shouldComputeCharChanges && diffChange.originalLength > 0 && diffChange.originalLength < 20 && diffChange.modifiedLength > 0 && diffChange.modifiedLength < 20 && continueCharDiff()) {
			// Compute character changes for diff chunks of at most 20 lines...
			const originalCharSequence = originalLineSequence.createCharSequence(shouldIgnoreTrimWhitespace, diffChange.originalStart, diffChange.originalStart + diffChange.originalLength - 1);
			const modifiedCharSequence = modifiedLineSequence.createCharSequence(shouldIgnoreTrimWhitespace, diffChange.modifiedStart, diffChange.modifiedStart + diffChange.modifiedLength - 1);

			let rawChanges = computeDiff(originalCharSequence, modifiedCharSequence, continueCharDiff, true).changes;

			if (shouldPostProcessCharChanges) {
				rawChanges = postProcessCharChanges(rawChanges);
			}

			charChanges = [];
			for (let i = 0, length = rawChanges.length; i < length; i++) {
				charChanges.push(CharChange.createFromDiffChange(rawChanges[i], originalCharSequence, modifiedCharSequence));
			}
		}

		return new LineChange(originalStartLineNumber, originalEndLineNumber, modifiedStartLineNumber, modifiedEndLineNumber, charChanges);
	}
}

export interface IDiffComputerOpts {
	shouldComputeCharChanges: boolean;
	shouldPostProcessCharChanges: boolean;
	shouldIgnoreTrimWhitespace: boolean;
	shouldMakePrettyDiff: boolean;
	maxComputationTime: number;
}

export class DiffComputer {

	private readonly shouldComputeCharChanges: boolean;
	private readonly shouldPostProcessCharChanges: boolean;
	private readonly shouldIgnoreTrimWhitespace: boolean;
	private readonly shouldMakePrettyDiff: boolean;
	private readonly originalLines: string[];
	private readonly modifiedLines: string[];
	private readonly original: LineSequence;
	private readonly modified: LineSequence;
	private readonly continueLineDiff: () => boolean;
	private readonly continueCharDiff: () => boolean;

	constructor(originalLines: string[], modifiedLines: string[], opts: IDiffComputerOpts) {
		this.shouldComputeCharChanges = opts.shouldComputeCharChanges;
		this.shouldPostProcessCharChanges = opts.shouldPostProcessCharChanges;
		this.shouldIgnoreTrimWhitespace = opts.shouldIgnoreTrimWhitespace;
		this.shouldMakePrettyDiff = opts.shouldMakePrettyDiff;
		this.originalLines = originalLines;
		this.modifiedLines = modifiedLines;
		this.original = new LineSequence(originalLines);
		this.modified = new LineSequence(modifiedLines);

		this.continueLineDiff = createContinueProcessingPredicate(opts.maxComputationTime);
		this.continueCharDiff = createContinueProcessingPredicate(opts.maxComputationTime === 0 ? 0 : Math.min(opts.maxComputationTime, 5000)); // never run after 5s for character changes...
	}

	public computeDiff(): IDiffComputerResult {

		if (this.original.lines.length === 1 && this.original.lines[0].length === 0) {
			// empty original => fast path
			return {
				quitEarly: false,
				changes: [{
					originalStartLineNumber: 1,
					originalEndLineNumber: 1,
					modifiedStartLineNumber: 1,
					modifiedEndLineNumber: this.modified.lines.length,
					charChanges: [{
						modifiedEndColumn: 0,
						modifiedEndLineNumber: 0,
						modifiedStartColumn: 0,
						modifiedStartLineNumber: 0,
						originalEndColumn: 0,
						originalEndLineNumber: 0,
						originalStartColumn: 0,
						originalStartLineNumber: 0
					}]
				}]
			};
		}

		if (this.modified.lines.length === 1 && this.modified.lines[0].length === 0) {
			// empty modified => fast path
			return {
				quitEarly: false,
				changes: [{
					originalStartLineNumber: 1,
					originalEndLineNumber: this.original.lines.length,
					modifiedStartLineNumber: 1,
					modifiedEndLineNumber: 1,
					charChanges: [{
						modifiedEndColumn: 0,
						modifiedEndLineNumber: 0,
						modifiedStartColumn: 0,
						modifiedStartLineNumber: 0,
						originalEndColumn: 0,
						originalEndLineNumber: 0,
						originalStartColumn: 0,
						originalStartLineNumber: 0
					}]
				}]
			};
		}

		const diffResult = computeDiff(this.original, this.modified, this.continueLineDiff, this.shouldMakePrettyDiff);
		const rawChanges = diffResult.changes;
		const quitEarly = diffResult.quitEarly;

		// The diff is always computed with ignoring trim whitespace
		// This ensures we get the prettiest diff

		if (this.shouldIgnoreTrimWhitespace) {
			const lineChanges: LineChange[] = [];
			for (let i = 0, length = rawChanges.length; i < length; i++) {
				lineChanges.push(LineChange.createFromDiffResult(this.shouldIgnoreTrimWhitespace, rawChanges[i], this.original, this.modified, this.continueCharDiff, this.shouldComputeCharChanges, this.shouldPostProcessCharChanges));
			}
			return {
				quitEarly: quitEarly,
				changes: lineChanges
			};
		}

		// Need to post-process and introduce changes where the trim whitespace is different
		// Note that we are looping starting at -1 to also cover the lines before the first change
		const result: LineChange[] = [];

		let originalLineIndex = 0;
		let modifiedLineIndex = 0;
		for (let i = -1 /* !!!! */, len = rawChanges.length; i < len; i++) {
			const nextChange = (i + 1 < len ? rawChanges[i + 1] : null);
			const originalStop = (nextChange ? nextChange.originalStart : this.originalLines.length);
			const modifiedStop = (nextChange ? nextChange.modifiedStart : this.modifiedLines.length);

			while (originalLineIndex < originalStop && modifiedLineIndex < modifiedStop) {
				const originalLine = this.originalLines[originalLineIndex];
				const modifiedLine = this.modifiedLines[modifiedLineIndex];

				if (originalLine !== modifiedLine) {
					// These lines differ only in trim whitespace

					// Check the leading whitespace
					{
						let originalStartColumn = getFirstNonBlankColumn(originalLine, 1);
						let modifiedStartColumn = getFirstNonBlankColumn(modifiedLine, 1);
						while (originalStartColumn > 1 && modifiedStartColumn > 1) {
							const originalChar = originalLine.charCodeAt(originalStartColumn - 2);
							const modifiedChar = modifiedLine.charCodeAt(modifiedStartColumn - 2);
							if (originalChar !== modifiedChar) {
								break;
							}
							originalStartColumn--;
							modifiedStartColumn--;
						}

						if (originalStartColumn > 1 || modifiedStartColumn > 1) {
							this._pushTrimWhitespaceCharChange(result,
								originalLineIndex + 1, 1, originalStartColumn,
								modifiedLineIndex + 1, 1, modifiedStartColumn
							);
						}
					}

					// Check the trailing whitespace
					{
						let originalEndColumn = getLastNonBlankColumn(originalLine, 1);
						let modifiedEndColumn = getLastNonBlankColumn(modifiedLine, 1);
						const originalMaxColumn = originalLine.length + 1;
						const modifiedMaxColumn = modifiedLine.length + 1;
						while (originalEndColumn < originalMaxColumn && modifiedEndColumn < modifiedMaxColumn) {
							const originalChar = originalLine.charCodeAt(originalEndColumn - 1);
							const modifiedChar = originalLine.charCodeAt(modifiedEndColumn - 1);
							if (originalChar !== modifiedChar) {
								break;
							}
							originalEndColumn++;
							modifiedEndColumn++;
						}

						if (originalEndColumn < originalMaxColumn || modifiedEndColumn < modifiedMaxColumn) {
							this._pushTrimWhitespaceCharChange(result,
								originalLineIndex + 1, originalEndColumn, originalMaxColumn,
								modifiedLineIndex + 1, modifiedEndColumn, modifiedMaxColumn
							);
						}
					}
				}
				originalLineIndex++;
				modifiedLineIndex++;
			}

			if (nextChange) {
				// Emit the actual change
				result.push(LineChange.createFromDiffResult(this.shouldIgnoreTrimWhitespace, nextChange, this.original, this.modified, this.continueCharDiff, this.shouldComputeCharChanges, this.shouldPostProcessCharChanges));

				originalLineIndex += nextChange.originalLength;
				modifiedLineIndex += nextChange.modifiedLength;
			}
		}

		return {
			quitEarly: quitEarly,
			changes: result
		};
	}

	private _pushTrimWhitespaceCharChange(
		result: LineChange[],
		originalLineNumber: number, originalStartColumn: number, originalEndColumn: number,
		modifiedLineNumber: number, modifiedStartColumn: number, modifiedEndColumn: number
	): void {
		if (this._mergeTrimWhitespaceCharChange(result, originalLineNumber, originalStartColumn, originalEndColumn, modifiedLineNumber, modifiedStartColumn, modifiedEndColumn)) {
			// Merged into previous
			return;
		}

		let charChanges: CharChange[] | undefined = undefined;
		if (this.shouldComputeCharChanges) {
			charChanges = [new CharChange(
				originalLineNumber, originalStartColumn, originalLineNumber, originalEndColumn,
				modifiedLineNumber, modifiedStartColumn, modifiedLineNumber, modifiedEndColumn
			)];
		}
		result.push(new LineChange(
			originalLineNumber, originalLineNumber,
			modifiedLineNumber, modifiedLineNumber,
			charChanges
		));
	}

	private _mergeTrimWhitespaceCharChange(
		result: LineChange[],
		originalLineNumber: number, originalStartColumn: number, originalEndColumn: number,
		modifiedLineNumber: number, modifiedStartColumn: number, modifiedEndColumn: number
	): boolean {
		const len = result.length;
		if (len === 0) {
			return false;
		}

		const prevChange = result[len - 1];

		if (prevChange.originalEndLineNumber === 0 || prevChange.modifiedEndLineNumber === 0) {
			// Don't merge with inserts/deletes
			return false;
		}

		if (prevChange.originalEndLineNumber + 1 === originalLineNumber && prevChange.modifiedEndLineNumber + 1 === modifiedLineNumber) {
			prevChange.originalEndLineNumber = originalLineNumber;
			prevChange.modifiedEndLineNumber = modifiedLineNumber;
			if (this.shouldComputeCharChanges && prevChange.charChanges) {
				prevChange.charChanges.push(new CharChange(
					originalLineNumber, originalStartColumn, originalLineNumber, originalEndColumn,
					modifiedLineNumber, modifiedStartColumn, modifiedLineNumber, modifiedEndColumn
				));
			}
			return true;
		}

		return false;
	}
}

function getFirstNonBlankColumn(txt: string, defaultValue: number): number {
	const r = strings.firstNonWhitespaceIndex(txt);
	if (r === -1) {
		return defaultValue;
	}
	return r + 1;
}

function getLastNonBlankColumn(txt: string, defaultValue: number): number {
	const r = strings.lastNonWhitespaceIndex(txt);
	if (r === -1) {
		return defaultValue;
	}
	return r + 2;
}

function createContinueProcessingPredicate(maximumRuntime: number): () => boolean {
	if (maximumRuntime === 0) {
		return () => true;
	}

	const startTime = Date.now();
	return () => {
		return Date.now() - startTime < maximumRuntime;
	};
}
