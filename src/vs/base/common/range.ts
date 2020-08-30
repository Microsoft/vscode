/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface IRange {
	start: number;
	end: number;
}

export interface IRangedGroup {
	range: IRange;
	size: number;
}

export namespace Range {

	/**
	 * Returns the intersection between two ranges as a range itself.
	 * Returns `{ start: 0, end: 0 }` if the intersection is empty.
	 */
	export function intersect(one: IRange, other: IRange): IRange {
		if (one.start >= other.end || other.start >= one.end) {
			return { start: 0, end: 0 };
		}

		const start = Math.max(one.start, other.start);
		const end = Math.min(one.end, other.end);

		if (end - start <= 0) {
			return { start: 0, end: 0 };
		}

		return { start, end };
	}

	export function isEmpty(range: IRange): boolean {
		return range.end - range.start <= 0;
	}

	export function intersects(one: IRange, other: IRange): boolean {
		return !isEmpty(intersect(one, other));
	}

	export function relativeComplement(one: IRange, other: IRange): IRange[] {
		const result: IRange[] = [];
		const first = { start: one.start, end: Math.min(other.start, one.end) };
		const second = { start: Math.max(other.end, one.start), end: one.end };

		if (!isEmpty(first)) {
			result.push(first);
		}

		if (!isEmpty(second)) {
			result.push(second);
		}

		return result;
	}
}
