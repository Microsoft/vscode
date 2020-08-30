/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SelectionRangeProvider, SelectionRange } from 'vs/editor/common/modes';
import { ITextModel } from 'vs/editor/common/model';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { LinkedList } from 'vs/base/common/linkedList';

export class BracketSelectionRangeProvider implements SelectionRangeProvider {

	async provideSelectionRanges(model: ITextModel, positions: Position[]): Promise<SelectionRange[][]> {
		const result: SelectionRange[][] = [];

		for (const position of positions) {
			const bucket: SelectionRange[] = [];
			result.push(bucket);

			const ranges = new Map<string, LinkedList<Range>>();
			await new Promise(resolve => BracketSelectionRangeProvider._bracketsRightYield(resolve, 0, model, position, ranges));
			await new Promise(resolve => BracketSelectionRangeProvider._bracketsLeftYield(resolve, 0, model, position, ranges, bucket));
		}

		return result;
	}

	private static readonly _maxDuration = 30;
	private static readonly _maxRounds = 2;

	private static _bracketsRightYield(resolve: () => void, round: number, model: ITextModel, pos: Position, ranges: Map<string, LinkedList<Range>>): void {
		const counts = new Map<string, number>();
		const t1 = Date.now();
		while (true) {
			if (round >= BracketSelectionRangeProvider._maxRounds) {
				resolve();
				break;
			}
			if (!pos) {
				resolve();
				break;
			}
			let bracket = model.findNextBracket(pos);
			if (!bracket) {
				resolve();
				break;
			}
			let d = Date.now() - t1;
			if (d > BracketSelectionRangeProvider._maxDuration) {
				setTimeout(() => BracketSelectionRangeProvider._bracketsRightYield(resolve, round + 1, model, pos, ranges));
				break;
			}
			const key = bracket.close[0];
			if (bracket.isOpen) {
				// wait for closing
				let val = counts.has(key) ? counts.get(key)! : 0;
				counts.set(key, val + 1);
			} else {
				// process closing
				let val = counts.has(key) ? counts.get(key)! : 0;
				val -= 1;
				counts.set(key, Math.max(0, val));
				if (val < 0) {
					let list = ranges.get(key);
					if (!list) {
						list = new LinkedList();
						ranges.set(key, list);
					}
					list.push(bracket.range);
				}
			}
			pos = bracket.range.getEndPosition();
		}
	}

	private static _bracketsLeftYield(resolve: () => void, round: number, model: ITextModel, pos: Position, ranges: Map<string, LinkedList<Range>>, bucket: SelectionRange[]): void {
		const counts = new Map<string, number>();
		const t1 = Date.now();
		while (true) {
			if (round >= BracketSelectionRangeProvider._maxRounds && ranges.size === 0) {
				resolve();
				break;
			}
			if (!pos) {
				resolve();
				break;
			}
			let bracket = model.findPrevBracket(pos);
			if (!bracket) {
				resolve();
				break;
			}
			let d = Date.now() - t1;
			if (d > BracketSelectionRangeProvider._maxDuration) {
				setTimeout(() => BracketSelectionRangeProvider._bracketsLeftYield(resolve, round + 1, model, pos, ranges, bucket));
				break;
			}
			const key = bracket.close[0];
			if (!bracket.isOpen) {
				// wait for opening
				let val = counts.has(key) ? counts.get(key)! : 0;
				counts.set(key, val + 1);
			} else {
				// opening
				let val = counts.has(key) ? counts.get(key)! : 0;
				val -= 1;
				counts.set(key, Math.max(0, val));
				if (val < 0) {
					let list = ranges.get(key);
					if (list) {
						let closing = list.shift();
						if (list.size === 0) {
							ranges.delete(key);
						}
						const innerBracket = Range.fromPositions(bracket.range.getEndPosition(), closing!.getStartPosition());
						const outerBracket = Range.fromPositions(bracket.range.getStartPosition(), closing!.getEndPosition());
						bucket.push({ range: innerBracket });
						bucket.push({ range: outerBracket });
						BracketSelectionRangeProvider._addBracketLeading(model, outerBracket, bucket);
					}
				}
			}
			pos = bracket.range.getStartPosition();
		}
	}

	private static _addBracketLeading(model: ITextModel, bracket: Range, bucket: SelectionRange[]): void {
		if (bracket.startLineNumber === bracket.endLineNumber) {
			return;
		}
		// xxxxxxxx {
		//
		// }
		const startLine = bracket.startLineNumber;
		const column = model.getLineFirstNonWhitespaceColumn(startLine);
		if (column !== 0 && column !== bracket.startColumn) {
			bucket.push({ range: Range.fromPositions(new Position(startLine, column), bracket.getEndPosition()) });
			bucket.push({ range: Range.fromPositions(new Position(startLine, 1), bracket.getEndPosition()) });
		}

		// xxxxxxxx
		// {
		//
		// }
		const aboveLine = startLine - 1;
		if (aboveLine > 0) {
			const column = model.getLineFirstNonWhitespaceColumn(aboveLine);
			if (column === bracket.startColumn && column !== model.getLineLastNonWhitespaceColumn(aboveLine)) {
				bucket.push({ range: Range.fromPositions(new Position(aboveLine, column), bracket.getEndPosition()) });
				bucket.push({ range: Range.fromPositions(new Position(aboveLine, 1), bracket.getEndPosition()) });
			}
		}
	}
}
