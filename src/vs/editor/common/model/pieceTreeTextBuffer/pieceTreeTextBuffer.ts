/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import * as strings from 'vs/base/common/strings';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { ApplyEditsResult, EndOfLinePreference, FindMatch, IInternalModelContentChange, ISingleEditOperationIdentifier, ITextBuffer, ITextSnapshot, ValidAnnotatedEditOperation, IValidEditOperation } from 'vs/editor/common/model';
import { PieceTreeBase, StringBuffer } from 'vs/editor/common/model/pieceTreeTextBuffer/pieceTreeBase';
import { SearchData } from 'vs/editor/common/model/textModelSearch';
import { countEOL, StringEOL } from 'vs/editor/common/model/tokensStore';
import { TextChange } from 'vs/editor/common/model/textChange';
import { Disposable } from 'vs/base/common/lifecycle';

export interface IValidatedEditOperation {
	sortIndex: number;
	identifier: ISingleEditOperationIdentifier | null;
	range: Range;
	rangeOffset: number;
	rangeLength: number;
	text: string;
	eolCount: number;
	firstLineLength: number;
	lastLineLength: number;
	forceMoveMarkers: boolean;
	isAutoWhitespaceEdit: boolean;
}

export interface IReverseSingleEditOperation extends IValidEditOperation {
	sortIndex: number;
}

export class PieceTreeTextBuffer extends Disposable implements ITextBuffer {
	private _pieceTree: PieceTreeBase;
	private readonly _BOM: string;
	private _mightContainRTL: boolean;
	private _mightContainUnusualLineTerminators: boolean;
	private _mightContainNonBasicASCII: boolean;

	private readonly _onDidChangeContent: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;

	constructor(chunks: StringBuffer[], BOM: string, eol: '\r\n' | '\n', containsRTL: boolean, containsUnusualLineTerminators: boolean, isBasicASCII: boolean, eolNormalized: boolean) {
		super();
		this._BOM = BOM;
		this._mightContainNonBasicASCII = !isBasicASCII;
		this._mightContainRTL = containsRTL;
		this._mightContainUnusualLineTerminators = containsUnusualLineTerminators;
		this._pieceTree = new PieceTreeBase(chunks, eol, eolNormalized);
	}

	// #region TextBuffer
	public equals(other: ITextBuffer): boolean {
		if (!(other instanceof PieceTreeTextBuffer)) {
			return false;
		}
		if (this._BOM !== other._BOM) {
			return false;
		}
		if (this.getEOL() !== other.getEOL()) {
			return false;
		}
		return this._pieceTree.equal(other._pieceTree);
	}
	public mightContainRTL(): boolean {
		return this._mightContainRTL;
	}
	public mightContainUnusualLineTerminators(): boolean {
		return this._mightContainUnusualLineTerminators;
	}
	public resetMightContainUnusualLineTerminators(): void {
		this._mightContainUnusualLineTerminators = false;
	}
	public mightContainNonBasicASCII(): boolean {
		return this._mightContainNonBasicASCII;
	}
	public getBOM(): string {
		return this._BOM;
	}
	public getEOL(): '\r\n' | '\n' {
		return this._pieceTree.getEOL();
	}

	public createSnapshot(preserveBOM: boolean): ITextSnapshot {
		return this._pieceTree.createSnapshot(preserveBOM ? this._BOM : '');
	}

	public getOffsetAt(lineNumber: number, column: number): number {
		return this._pieceTree.getOffsetAt(lineNumber, column);
	}

	public getPositionAt(offset: number): Position {
		return this._pieceTree.getPositionAt(offset);
	}

	public getRangeAt(start: number, length: number): Range {
		let end = start + length;
		const startPosition = this.getPositionAt(start);
		const endPosition = this.getPositionAt(end);
		return new Range(startPosition.lineNumber, startPosition.column, endPosition.lineNumber, endPosition.column);
	}

	public getValueInRange(range: Range, eol: EndOfLinePreference = EndOfLinePreference.TextDefined): string {
		if (range.isEmpty()) {
			return '';
		}

		const lineEnding = this._getEndOfLine(eol);
		return this._pieceTree.getValueInRange(range, lineEnding);
	}

	public getValueLengthInRange(range: Range, eol: EndOfLinePreference = EndOfLinePreference.TextDefined): number {
		if (range.isEmpty()) {
			return 0;
		}

		if (range.startLineNumber === range.endLineNumber) {
			return (range.endColumn - range.startColumn);
		}

		let startOffset = this.getOffsetAt(range.startLineNumber, range.startColumn);
		let endOffset = this.getOffsetAt(range.endLineNumber, range.endColumn);
		return endOffset - startOffset;
	}

	public getCharacterCountInRange(range: Range, eol: EndOfLinePreference = EndOfLinePreference.TextDefined): number {
		if (this._mightContainNonBasicASCII) {
			// we must count by iterating

			let result = 0;

			const fromLineNumber = range.startLineNumber;
			const toLineNumber = range.endLineNumber;
			for (let lineNumber = fromLineNumber; lineNumber <= toLineNumber; lineNumber++) {
				const lineContent = this.getLineContent(lineNumber);
				const fromOffset = (lineNumber === fromLineNumber ? range.startColumn - 1 : 0);
				const toOffset = (lineNumber === toLineNumber ? range.endColumn - 1 : lineContent.length);

				for (let offset = fromOffset; offset < toOffset; offset++) {
					if (strings.isHighSurrogate(lineContent.charCodeAt(offset))) {
						result = result + 1;
						offset = offset + 1;
					} else {
						result = result + 1;
					}
				}
			}

			result += this._getEndOfLine(eol).length * (toLineNumber - fromLineNumber);

			return result;
		}

		return this.getValueLengthInRange(range, eol);
	}

	public getLength(): number {
		return this._pieceTree.getLength();
	}

	public getLineCount(): number {
		return this._pieceTree.getLineCount();
	}

	public getLinesContent(): string[] {
		return this._pieceTree.getLinesContent();
	}

	public getLineContent(lineNumber: number): string {
		return this._pieceTree.getLineContent(lineNumber);
	}

	public getLineCharCode(lineNumber: number, index: number): number {
		return this._pieceTree.getLineCharCode(lineNumber, index);
	}

	public getCharCode(offset: number): number {
		return this._pieceTree.getCharCode(offset);
	}

	public getLineLength(lineNumber: number): number {
		return this._pieceTree.getLineLength(lineNumber);
	}

	public getLineMinColumn(lineNumber: number): number {
		return 1;
	}

	public getLineMaxColumn(lineNumber: number): number {
		return this.getLineLength(lineNumber) + 1;
	}

	public getLineFirstNonWhitespaceColumn(lineNumber: number): number {
		const result = strings.firstNonWhitespaceIndex(this.getLineContent(lineNumber));
		if (result === -1) {
			return 0;
		}
		return result + 1;
	}

	public getLineLastNonWhitespaceColumn(lineNumber: number): number {
		const result = strings.lastNonWhitespaceIndex(this.getLineContent(lineNumber));
		if (result === -1) {
			return 0;
		}
		return result + 2;
	}

	private _getEndOfLine(eol: EndOfLinePreference): string {
		switch (eol) {
			case EndOfLinePreference.LF:
				return '\n';
			case EndOfLinePreference.CRLF:
				return '\r\n';
			case EndOfLinePreference.TextDefined:
				return this.getEOL();
			default:
				throw new Error('Unknown EOL preference');
		}
	}

	public setEOL(newEOL: '\r\n' | '\n'): void {
		this._pieceTree.setEOL(newEOL);
	}

	public applyEdits(rawOperations: ValidAnnotatedEditOperation[], recordTrimAutoWhitespace: boolean, computeUndoEdits: boolean): ApplyEditsResult {
		let mightContainRTL = this._mightContainRTL;
		let mightContainUnusualLineTerminators = this._mightContainUnusualLineTerminators;
		let mightContainNonBasicASCII = this._mightContainNonBasicASCII;
		let canReduceOperations = true;

		let operations: IValidatedEditOperation[] = [];
		for (let i = 0; i < rawOperations.length; i++) {
			let op = rawOperations[i];
			if (canReduceOperations && op._isTracked) {
				canReduceOperations = false;
			}
			let validatedRange = op.range;
			if (op.text) {
				let textMightContainNonBasicASCII = true;
				if (!mightContainNonBasicASCII) {
					textMightContainNonBasicASCII = !strings.isBasicASCII(op.text);
					mightContainNonBasicASCII = textMightContainNonBasicASCII;
				}
				if (!mightContainRTL && textMightContainNonBasicASCII) {
					// check if the new inserted text contains RTL
					mightContainRTL = strings.containsRTL(op.text);
				}
				if (!mightContainUnusualLineTerminators && textMightContainNonBasicASCII) {
					// check if the new inserted text contains unusual line terminators
					mightContainUnusualLineTerminators = strings.containsUnusualLineTerminators(op.text);
				}
			}

			let validText = '';
			let eolCount = 0;
			let firstLineLength = 0;
			let lastLineLength = 0;
			if (op.text) {
				let strEOL: StringEOL;
				[eolCount, firstLineLength, lastLineLength, strEOL] = countEOL(op.text);

				const bufferEOL = this.getEOL();
				const expectedStrEOL = (bufferEOL === '\r\n' ? StringEOL.CRLF : StringEOL.LF);
				if (strEOL === StringEOL.Unknown || strEOL === expectedStrEOL) {
					validText = op.text;
				} else {
					validText = op.text.replace(/\r\n|\r|\n/g, bufferEOL);
				}
			}

			operations[i] = {
				sortIndex: i,
				identifier: op.identifier || null,
				range: validatedRange,
				rangeOffset: this.getOffsetAt(validatedRange.startLineNumber, validatedRange.startColumn),
				rangeLength: this.getValueLengthInRange(validatedRange),
				text: validText,
				eolCount: eolCount,
				firstLineLength: firstLineLength,
				lastLineLength: lastLineLength,
				forceMoveMarkers: Boolean(op.forceMoveMarkers),
				isAutoWhitespaceEdit: op.isAutoWhitespaceEdit || false
			};
		}

		// Sort operations ascending
		operations.sort(PieceTreeTextBuffer._sortOpsAscending);

		let hasTouchingRanges = false;
		for (let i = 0, count = operations.length - 1; i < count; i++) {
			let rangeEnd = operations[i].range.getEndPosition();
			let nextRangeStart = operations[i + 1].range.getStartPosition();

			if (nextRangeStart.isBeforeOrEqual(rangeEnd)) {
				if (nextRangeStart.isBefore(rangeEnd)) {
					// overlapping ranges
					throw new Error('Overlapping ranges are not allowed!');
				}
				hasTouchingRanges = true;
			}
		}

		if (canReduceOperations) {
			operations = this._reduceOperations(operations);
		}

		// Delta encode operations
		let reverseRanges = (computeUndoEdits || recordTrimAutoWhitespace ? PieceTreeTextBuffer._getInverseEditRanges(operations) : []);
		let newTrimAutoWhitespaceCandidates: { lineNumber: number, oldContent: string }[] = [];
		if (recordTrimAutoWhitespace) {
			for (let i = 0; i < operations.length; i++) {
				let op = operations[i];
				let reverseRange = reverseRanges[i];

				if (op.isAutoWhitespaceEdit && op.range.isEmpty()) {
					// Record already the future line numbers that might be auto whitespace removal candidates on next edit
					for (let lineNumber = reverseRange.startLineNumber; lineNumber <= reverseRange.endLineNumber; lineNumber++) {
						let currentLineContent = '';
						if (lineNumber === reverseRange.startLineNumber) {
							currentLineContent = this.getLineContent(op.range.startLineNumber);
							if (strings.firstNonWhitespaceIndex(currentLineContent) !== -1) {
								continue;
							}
						}
						newTrimAutoWhitespaceCandidates.push({ lineNumber: lineNumber, oldContent: currentLineContent });
					}
				}
			}
		}

		let reverseOperations: IReverseSingleEditOperation[] | null = null;
		if (computeUndoEdits) {

			let reverseRangeDeltaOffset = 0;
			reverseOperations = [];
			for (let i = 0; i < operations.length; i++) {
				const op = operations[i];
				const reverseRange = reverseRanges[i];
				const bufferText = this.getValueInRange(op.range);
				const reverseRangeOffset = op.rangeOffset + reverseRangeDeltaOffset;
				reverseRangeDeltaOffset += (op.text.length - bufferText.length);

				reverseOperations[i] = {
					sortIndex: op.sortIndex,
					identifier: op.identifier,
					range: reverseRange,
					text: bufferText,
					textChange: new TextChange(op.rangeOffset, bufferText, reverseRangeOffset, op.text)
				};
			}

			// Can only sort reverse operations when the order is not significant
			if (!hasTouchingRanges) {
				reverseOperations.sort((a, b) => a.sortIndex - b.sortIndex);
			}
		}


		this._mightContainRTL = mightContainRTL;
		this._mightContainUnusualLineTerminators = mightContainUnusualLineTerminators;
		this._mightContainNonBasicASCII = mightContainNonBasicASCII;

		const contentChanges = this._doApplyEdits(operations);

		let trimAutoWhitespaceLineNumbers: number[] | null = null;
		if (recordTrimAutoWhitespace && newTrimAutoWhitespaceCandidates.length > 0) {
			// sort line numbers auto whitespace removal candidates for next edit descending
			newTrimAutoWhitespaceCandidates.sort((a, b) => b.lineNumber - a.lineNumber);

			trimAutoWhitespaceLineNumbers = [];
			for (let i = 0, len = newTrimAutoWhitespaceCandidates.length; i < len; i++) {
				let lineNumber = newTrimAutoWhitespaceCandidates[i].lineNumber;
				if (i > 0 && newTrimAutoWhitespaceCandidates[i - 1].lineNumber === lineNumber) {
					// Do not have the same line number twice
					continue;
				}

				let prevContent = newTrimAutoWhitespaceCandidates[i].oldContent;
				let lineContent = this.getLineContent(lineNumber);

				if (lineContent.length === 0 || lineContent === prevContent || strings.firstNonWhitespaceIndex(lineContent) !== -1) {
					continue;
				}

				trimAutoWhitespaceLineNumbers.push(lineNumber);
			}
		}

		this._onDidChangeContent.fire();

		return new ApplyEditsResult(
			reverseOperations,
			contentChanges,
			trimAutoWhitespaceLineNumbers
		);
	}

	/**
	 * Transform operations such that they represent the same logic edit,
	 * but that they also do not cause OOM crashes.
	 */
	private _reduceOperations(operations: IValidatedEditOperation[]): IValidatedEditOperation[] {
		if (operations.length < 1000) {
			// We know from empirical testing that a thousand edits work fine regardless of their shape.
			return operations;
		}

		// At one point, due to how events are emitted and how each operation is handled,
		// some operations can trigger a high amount of temporary string allocations,
		// that will immediately get edited again.
		// e.g. a formatter inserting ridiculous ammounts of \n on a model with a single line
		// Therefore, the strategy is to collapse all the operations into a huge single edit operation
		return [this._toSingleEditOperation(operations)];
	}

	_toSingleEditOperation(operations: IValidatedEditOperation[]): IValidatedEditOperation {
		let forceMoveMarkers = false;
		const firstEditRange = operations[0].range;
		const lastEditRange = operations[operations.length - 1].range;
		const entireEditRange = new Range(firstEditRange.startLineNumber, firstEditRange.startColumn, lastEditRange.endLineNumber, lastEditRange.endColumn);
		let lastEndLineNumber = firstEditRange.startLineNumber;
		let lastEndColumn = firstEditRange.startColumn;
		const result: string[] = [];

		for (let i = 0, len = operations.length; i < len; i++) {
			const operation = operations[i];
			const range = operation.range;

			forceMoveMarkers = forceMoveMarkers || operation.forceMoveMarkers;

			// (1) -- Push old text
			result.push(this.getValueInRange(new Range(lastEndLineNumber, lastEndColumn, range.startLineNumber, range.startColumn)));

			// (2) -- Push new text
			if (operation.text.length > 0) {
				result.push(operation.text);
			}

			lastEndLineNumber = range.endLineNumber;
			lastEndColumn = range.endColumn;
		}

		const text = result.join('');
		const [eolCount, firstLineLength, lastLineLength] = countEOL(text);

		return {
			sortIndex: 0,
			identifier: operations[0].identifier,
			range: entireEditRange,
			rangeOffset: this.getOffsetAt(entireEditRange.startLineNumber, entireEditRange.startColumn),
			rangeLength: this.getValueLengthInRange(entireEditRange, EndOfLinePreference.TextDefined),
			text: text,
			eolCount: eolCount,
			firstLineLength: firstLineLength,
			lastLineLength: lastLineLength,
			forceMoveMarkers: forceMoveMarkers,
			isAutoWhitespaceEdit: false
		};
	}

	private _doApplyEdits(operations: IValidatedEditOperation[]): IInternalModelContentChange[] {
		operations.sort(PieceTreeTextBuffer._sortOpsDescending);

		let contentChanges: IInternalModelContentChange[] = [];

		// operations are from bottom to top
		for (let i = 0; i < operations.length; i++) {
			let op = operations[i];

			const startLineNumber = op.range.startLineNumber;
			const startColumn = op.range.startColumn;
			const endLineNumber = op.range.endLineNumber;
			const endColumn = op.range.endColumn;

			if (startLineNumber === endLineNumber && startColumn === endColumn && op.text.length === 0) {
				// no-op
				continue;
			}

			if (op.text) {
				// replacement
				this._pieceTree.delete(op.rangeOffset, op.rangeLength);
				this._pieceTree.insert(op.rangeOffset, op.text, true);

			} else {
				// deletion
				this._pieceTree.delete(op.rangeOffset, op.rangeLength);
			}

			const contentChangeRange = new Range(startLineNumber, startColumn, endLineNumber, endColumn);
			contentChanges.push({
				range: contentChangeRange,
				rangeLength: op.rangeLength,
				text: op.text,
				rangeOffset: op.rangeOffset,
				forceMoveMarkers: op.forceMoveMarkers
			});
		}
		return contentChanges;
	}

	findMatchesLineByLine(searchRange: Range, searchData: SearchData, captureMatches: boolean, limitResultCount: number): FindMatch[] {
		return this._pieceTree.findMatchesLineByLine(searchRange, searchData, captureMatches, limitResultCount);
	}

	// #endregion

	// #region helper
	// testing purpose.
	public getPieceTree(): PieceTreeBase {
		return this._pieceTree;
	}

	public static _getInverseEditRange(range: Range, text: string) {
		let startLineNumber = range.startLineNumber;
		let startColumn = range.startColumn;
		const [eolCount, firstLineLength, lastLineLength] = countEOL(text);
		let resultRange: Range;

		if (text.length > 0) {
			// the operation inserts something
			const lineCount = eolCount + 1;

			if (lineCount === 1) {
				// single line insert
				resultRange = new Range(startLineNumber, startColumn, startLineNumber, startColumn + firstLineLength);
			} else {
				// multi line insert
				resultRange = new Range(startLineNumber, startColumn, startLineNumber + lineCount - 1, lastLineLength + 1);
			}
		} else {
			// There is nothing to insert
			resultRange = new Range(startLineNumber, startColumn, startLineNumber, startColumn);
		}

		return resultRange;
	}

	/**
	 * Assumes `operations` are validated and sorted ascending
	 */
	public static _getInverseEditRanges(operations: IValidatedEditOperation[]): Range[] {
		let result: Range[] = [];

		let prevOpEndLineNumber: number = 0;
		let prevOpEndColumn: number = 0;
		let prevOp: IValidatedEditOperation | null = null;
		for (let i = 0, len = operations.length; i < len; i++) {
			let op = operations[i];

			let startLineNumber: number;
			let startColumn: number;

			if (prevOp) {
				if (prevOp.range.endLineNumber === op.range.startLineNumber) {
					startLineNumber = prevOpEndLineNumber;
					startColumn = prevOpEndColumn + (op.range.startColumn - prevOp.range.endColumn);
				} else {
					startLineNumber = prevOpEndLineNumber + (op.range.startLineNumber - prevOp.range.endLineNumber);
					startColumn = op.range.startColumn;
				}
			} else {
				startLineNumber = op.range.startLineNumber;
				startColumn = op.range.startColumn;
			}

			let resultRange: Range;

			if (op.text.length > 0) {
				// the operation inserts something
				const lineCount = op.eolCount + 1;

				if (lineCount === 1) {
					// single line insert
					resultRange = new Range(startLineNumber, startColumn, startLineNumber, startColumn + op.firstLineLength);
				} else {
					// multi line insert
					resultRange = new Range(startLineNumber, startColumn, startLineNumber + lineCount - 1, op.lastLineLength + 1);
				}
			} else {
				// There is nothing to insert
				resultRange = new Range(startLineNumber, startColumn, startLineNumber, startColumn);
			}

			prevOpEndLineNumber = resultRange.endLineNumber;
			prevOpEndColumn = resultRange.endColumn;

			result.push(resultRange);
			prevOp = op;
		}

		return result;
	}

	private static _sortOpsAscending(a: IValidatedEditOperation, b: IValidatedEditOperation): number {
		let r = Range.compareRangesUsingEnds(a.range, b.range);
		if (r === 0) {
			return a.sortIndex - b.sortIndex;
		}
		return r;
	}

	private static _sortOpsDescending(a: IValidatedEditOperation, b: IValidatedEditOperation): number {
		let r = Range.compareRangesUsingEnds(a.range, b.range);
		if (r === 0) {
			return b.sortIndex - a.sortIndex;
		}
		return -r;
	}
	// #endregion
}
