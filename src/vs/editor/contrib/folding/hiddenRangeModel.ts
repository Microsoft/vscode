/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Range, IRange } from 'vs/editor/common/core/range';
import { FoldingModel, CollapseMemento } from 'vs/editor/contrib/folding/foldingModel';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Selection } from 'vs/editor/common/core/selection';
import { findFirstInSorted } from 'vs/base/common/arrays';

export class HiddenRangeModel {
	private readonly _foldingModel: FoldingModel;
	private _hiddenRanges: IRange[];
	private _foldingModelListener: IDisposable | null;
	private readonly _updateEventEmitter = new Emitter<IRange[]>();

	public get onDidChange(): Event<IRange[]> { return this._updateEventEmitter.event; }
	public get hiddenRanges() { return this._hiddenRanges; }

	public constructor(model: FoldingModel) {
		this._foldingModel = model;
		this._foldingModelListener = model.onDidChange(_ => this.updateHiddenRanges());
		this._hiddenRanges = [];
		if (model.regions.length) {
			this.updateHiddenRanges();
		}
	}

	private updateHiddenRanges(): void {
		let updateHiddenAreas = false;
		let newHiddenAreas: IRange[] = [];
		let i = 0; // index into hidden
		let k = 0;

		let lastCollapsedStart = Number.MAX_VALUE;
		let lastCollapsedEnd = -1;

		let ranges = this._foldingModel.regions;
		for (; i < ranges.length; i++) {
			if (!ranges.isCollapsed(i)) {
				continue;
			}

			let startLineNumber = ranges.getStartLineNumber(i) + 1; // the first line is not hidden
			let endLineNumber = ranges.getEndLineNumber(i);
			if (lastCollapsedStart <= startLineNumber && endLineNumber <= lastCollapsedEnd) {
				// ignore ranges contained in collapsed regions
				continue;
			}

			if (!updateHiddenAreas && k < this._hiddenRanges.length && this._hiddenRanges[k].startLineNumber === startLineNumber && this._hiddenRanges[k].endLineNumber === endLineNumber) {
				// reuse the old ranges
				newHiddenAreas.push(this._hiddenRanges[k]);
				k++;
			} else {
				updateHiddenAreas = true;
				newHiddenAreas.push(new Range(startLineNumber, 1, endLineNumber, 1));
			}
			lastCollapsedStart = startLineNumber;
			lastCollapsedEnd = endLineNumber;
		}
		if (updateHiddenAreas || k < this._hiddenRanges.length) {
			this.applyHiddenRanges(newHiddenAreas);
		}
	}

	public applyMemento(state: CollapseMemento): boolean {
		if (!Array.isArray(state) || state.length === 0) {
			return false;
		}
		let hiddenRanges: IRange[] = [];
		for (let r of state) {
			if (!r.startLineNumber || !r.endLineNumber) {
				return false;
			}
			hiddenRanges.push(new Range(r.startLineNumber + 1, 1, r.endLineNumber, 1));
		}
		this.applyHiddenRanges(hiddenRanges);
		return true;
	}

	/**
	 * Collapse state memento, for persistence only, only used if folding model is not yet initialized
	 */
	public getMemento(): CollapseMemento {
		return this._hiddenRanges.map(r => ({ startLineNumber: r.startLineNumber - 1, endLineNumber: r.endLineNumber }));
	}

	private applyHiddenRanges(newHiddenAreas: IRange[]) {
		this._hiddenRanges = newHiddenAreas;
		this._updateEventEmitter.fire(newHiddenAreas);
	}

	public hasRanges() {
		return this._hiddenRanges.length > 0;
	}

	public isHidden(line: number): boolean {
		return findRange(this._hiddenRanges, line) !== null;
	}

	public adjustSelections(selections: Selection[]): boolean {
		let hasChanges = false;
		let editorModel = this._foldingModel.textModel;
		let lastRange: IRange | null = null;

		let adjustLine = (line: number) => {
			if (!lastRange || !isInside(line, lastRange)) {
				lastRange = findRange(this._hiddenRanges, line);
			}
			if (lastRange) {
				return lastRange.startLineNumber - 1;
			}
			return null;
		};
		for (let i = 0, len = selections.length; i < len; i++) {
			let selection = selections[i];
			let adjustedStartLine = adjustLine(selection.startLineNumber);
			if (adjustedStartLine) {
				selection = selection.setStartPosition(adjustedStartLine, editorModel.getLineMaxColumn(adjustedStartLine));
				hasChanges = true;
			}
			let adjustedEndLine = adjustLine(selection.endLineNumber);
			if (adjustedEndLine) {
				selection = selection.setEndPosition(adjustedEndLine, editorModel.getLineMaxColumn(adjustedEndLine));
				hasChanges = true;
			}
			selections[i] = selection;
		}
		return hasChanges;
	}


	public dispose() {
		if (this.hiddenRanges.length > 0) {
			this._hiddenRanges = [];
			this._updateEventEmitter.fire(this._hiddenRanges);
		}
		if (this._foldingModelListener) {
			this._foldingModelListener.dispose();
			this._foldingModelListener = null;
		}
	}
}

function isInside(line: number, range: IRange) {
	return line >= range.startLineNumber && line <= range.endLineNumber;
}
function findRange(ranges: IRange[], line: number): IRange | null {
	let i = findFirstInSorted(ranges, r => line < r.startLineNumber) - 1;
	if (i >= 0 && ranges[i].endLineNumber >= line) {
		return ranges[i];
	}
	return null;
}
