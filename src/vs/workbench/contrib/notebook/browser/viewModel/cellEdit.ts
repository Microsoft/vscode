/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICell } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IResourceUndoRedoElement, UndoRedoElementType } from 'vs/platform/undoRedo/common/undoRedo';
import { URI } from 'vs/base/common/uri';
import { BaseCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/baseCellViewModel';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';

/**
 * It should not modify Undo/Redo stack
 */
export interface ICellEditingDelegate {
	insertCell?(index: number, viewCell: BaseCellViewModel): void;
	deleteCell?(index: number): void;
	moveCell?(fromIndex: number, toIndex: number): void;
	createCellViewModel?(cell: ICell): BaseCellViewModel;
	setSelections(selections: number[]): void;
}

export class InsertCellEdit implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
	label: string = 'Insert Cell';
	constructor(
		public resource: URI,
		private insertIndex: number,
		private cell: BaseCellViewModel,
		private editingDelegate: ICellEditingDelegate,
		private beforedSelections: number[],
		private endSelections: number[]
	) {
	}

	undo(): void | Promise<void> {
		if (!this.editingDelegate.deleteCell) {
			throw new Error('Notebook Delete Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.deleteCell(this.insertIndex);
		this.editingDelegate.setSelections(this.beforedSelections);
	}
	redo(): void | Promise<void> {
		if (!this.editingDelegate.insertCell) {
			throw new Error('Notebook Insert Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.insertCell(this.insertIndex, this.cell);
		this.editingDelegate.setSelections(this.endSelections);
	}
}

export class DeleteCellEdit implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
	label: string = 'Delete Cell';

	private _rawCell: ICell;
	constructor(
		public resource: URI,
		private insertIndex: number,
		cell: BaseCellViewModel,
		private editingDelegate: ICellEditingDelegate,
		private beforedSelections: number[],
		private endSelections: number[]
	) {
		this._rawCell = cell.model;

		// save inmem text to `ICell`
		// no needed any more as the text buffer is transfered to `raw_cell`
		// this._rawCell.source = [cell.getText()];
	}

	undo(): void | Promise<void> {
		if (!this.editingDelegate.insertCell || !this.editingDelegate.createCellViewModel) {
			throw new Error('Notebook Insert Cell not implemented for Undo/Redo');
		}

		const cell = this.editingDelegate.createCellViewModel(this._rawCell);
		this.editingDelegate.insertCell(this.insertIndex, cell);
		this.editingDelegate.setSelections(this.beforedSelections);
	}

	redo(): void | Promise<void> {
		if (!this.editingDelegate.deleteCell) {
			throw new Error('Notebook Delete Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.deleteCell(this.insertIndex);
		this.editingDelegate.setSelections(this.endSelections);
	}
}

export class MoveCellEdit implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
	label: string = 'Delete Cell';

	constructor(
		public resource: URI,
		private fromIndex: number,
		private toIndex: number,
		private editingDelegate: ICellEditingDelegate,
		private beforedSelections: number[],
		private endSelections: number[]
	) {
	}

	undo(): void | Promise<void> {
		if (!this.editingDelegate.moveCell) {
			throw new Error('Notebook Move Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.moveCell(this.toIndex, this.fromIndex);
		this.editingDelegate.setSelections(this.beforedSelections);
	}

	redo(): void | Promise<void> {
		if (!this.editingDelegate.moveCell) {
			throw new Error('Notebook Move Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.moveCell(this.fromIndex, this.toIndex);
		this.editingDelegate.setSelections(this.endSelections);
	}
}

export class SpliceCellsEdit implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
	label: string = 'Insert Cell';
	constructor(
		public resource: URI,
		private diffs: [number, CellViewModel[], CellViewModel[]][],
		private editingDelegate: ICellEditingDelegate,
		private beforeHandles: number[],
		private endHandles: number[]
	) {
	}

	undo(): void | Promise<void> {
		if (!this.editingDelegate.deleteCell || !this.editingDelegate.insertCell) {
			throw new Error('Notebook Insert/Delete Cell not implemented for Undo/Redo');
		}

		this.diffs.forEach(diff => {
			for (let i = 0; i < diff[2].length; i++) {
				this.editingDelegate.deleteCell!(diff[0]);
			}

			diff[1].reverse().forEach(cell => {
				this.editingDelegate.insertCell!(diff[0], cell);
			});
		});
		this.editingDelegate.setSelections(this.beforeHandles);
	}

	redo(): void | Promise<void> {
		if (!this.editingDelegate.deleteCell || !this.editingDelegate.insertCell) {
			throw new Error('Notebook Insert/Delete Cell not implemented for Undo/Redo');
		}

		this.diffs.reverse().forEach(diff => {
			for (let i = 0; i < diff[1].length; i++) {
				this.editingDelegate.deleteCell!(diff[0]);
			}

			diff[2].reverse().forEach(cell => {
				this.editingDelegate.insertCell!(diff[0], cell);
			});
		});

		this.editingDelegate.setSelections(this.endHandles);
	}
}
