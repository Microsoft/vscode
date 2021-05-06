/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IPosition, Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';

/**
 * A selection in the editor.
 * The selection is a range that has an orientation.
 */
export interface ISelection {
	/**
	 * The line number on which the selection has started.
	 */
	readonly selectionStartLineNumber: number;
	/**
	 * The column on `selectionStartLineNumber` where the selection has started.
	 */
	readonly selectionStartColumn: number;
	/**
	 * The line number on which the selection has ended.
	 */
	readonly positionLineNumber: number;
	/**
	 * The column on `positionLineNumber` where the selection has ended.
	 */
	readonly positionColumn: number;
}

/**
 * The direction of a selection.
 */
export const enum SelectionDirection {
	/**
	 * The selection starts above where it ends.
	 */
	LTR,
	/**
	 * The selection starts below where it ends.
	 */
	RTL
}

/**
 * A selection in the editor.
 * The selection is a range that has an orientation.
 */
export class Selection extends Range {
	/**
	 * The line number on which the selection has started.
	 */
	public readonly selectionStartLineNumber: number;
	/**
	 * The column on `selectionStartLineNumber` where the selection has started.
	 */
	public readonly selectionStartColumn: number;
	/**
	 * The line number on which the selection has ended.
	 */
	public readonly positionLineNumber: number;
	/**
	 * The column on `positionLineNumber` where the selection has ended.
	 */
	public readonly positionColumn: number;

	constructor(selectionStartLineNumber: number, selectionStartColumn: number, positionLineNumber: number, positionColumn: number) {
		super(selectionStartLineNumber, selectionStartColumn, positionLineNumber, positionColumn);
		this.selectionStartLineNumber = selectionStartLineNumber;
		this.selectionStartColumn = selectionStartColumn;
		this.positionLineNumber = positionLineNumber;
		this.positionColumn = positionColumn;
	}

	/**
	 * Transform to a human-readable representation.
	 */
	public override toString(): string {
		return '[' + this.selectionStartLineNumber + ',' + this.selectionStartColumn + ' -> ' + this.positionLineNumber + ',' + this.positionColumn + ']';
	}

	/**
	 * Test if equals other selection.
	 */
	public equalsSelection(other: ISelection): boolean {
		return (
			Selection.selectionsEqual(this, other)
		);
	}

	/**
	 * Test if the two selections are equal.
	 */
	public static selectionsEqual(a: ISelection, b: ISelection): boolean {
		return (
			a.selectionStartLineNumber === b.selectionStartLineNumber &&
			a.selectionStartColumn === b.selectionStartColumn &&
			a.positionLineNumber === b.positionLineNumber &&
			a.positionColumn === b.positionColumn
		);
	}

	/**
	 * Get directions (LTR or RTL).
	 */
	public getDirection(): SelectionDirection {
		if (this.selectionStartLineNumber === this.startLineNumber && this.selectionStartColumn === this.startColumn) {
			return SelectionDirection.LTR;
		}
		return SelectionDirection.RTL;
	}

	/**
	 * Create a new selection with a different `positionLineNumber` and `positionColumn`.
	 */
	public override setEndPosition(endLineNumber: number, endColumn: number): Selection {
		if (this.getDirection() === SelectionDirection.LTR) {
			return new Selection(this.startLineNumber, this.startColumn, endLineNumber, endColumn);
		}
		return new Selection(endLineNumber, endColumn, this.startLineNumber, this.startColumn);
	}

	/**
	 * Get the position at `positionLineNumber` and `positionColumn`.
	 */
	public getPosition(): Position {
		return new Position(this.positionLineNumber, this.positionColumn);
	}

	/**
	 * Create a new selection with a different `selectionStartLineNumber` and `selectionStartColumn`.
	 */
	public override setStartPosition(startLineNumber: number, startColumn: number): Selection {
		if (this.getDirection() === SelectionDirection.LTR) {
			return new Selection(startLineNumber, startColumn, this.endLineNumber, this.endColumn);
		}
		return new Selection(this.endLineNumber, this.endColumn, startLineNumber, startColumn);
	}

	// ----

	/**
	 * Create a `Selection` from one or two positions
	 */
	public static override fromPositions(start: IPosition, end: IPosition = start): Selection {
		return new Selection(start.lineNumber, start.column, end.lineNumber, end.column);
	}

	/**
	 * Create a `Selection` from an `ISelection`.
	 */
	public static liftSelection(sel: ISelection): Selection {
		return new Selection(sel.selectionStartLineNumber, sel.selectionStartColumn, sel.positionLineNumber, sel.positionColumn);
	}

	/**
	 * `a` equals `b`.
	 */
	public static selectionsArrEqual(a: ISelection[], b: ISelection[]): boolean {
		if (a && !b || !a && b) {
			return false;
		}
		if (!a && !b) {
			return true;
		}
		if (a.length !== b.length) {
			return false;
		}
		for (let i = 0, len = a.length; i < len; i++) {
			if (!this.selectionsEqual(a[i], b[i])) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Test if `obj` is an `ISelection`.
	 */
	public static isISelection(obj: any): obj is ISelection {
		return (
			obj
			&& (typeof obj.selectionStartLineNumber === 'number')
			&& (typeof obj.selectionStartColumn === 'number')
			&& (typeof obj.positionLineNumber === 'number')
			&& (typeof obj.positionColumn === 'number')
		);
	}

	/**
	 * Create with a direction.
	 */
	public static createWithDirection(startLineNumber: number, startColumn: number, endLineNumber: number, endColumn: number, direction: SelectionDirection): Selection {

		if (direction === SelectionDirection.LTR) {
			return new Selection(startLineNumber, startColumn, endLineNumber, endColumn);
		}

		return new Selection(endLineNumber, endColumn, startLineNumber, startColumn);
	}
}
