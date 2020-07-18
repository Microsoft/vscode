/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IResourceUndoRedoElement, UndoRedoElementType } from 'vs/platform/undoRedo/common/undoRedo';
import { URI } from 'vs/base/common/uri';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';

/**
 * It should not modify Undo/Redo stack
 */
export interface ITextCellEditingDelegate {
	insertCell?(index: number, cell: NotebookCellTextModel): void;
	deleteCell?(index: number): void;
	moveCell?(fromIndex: number, toIndex: number, beforeSelections: number[] | undefined, endSelections: number[] | undefined): void;
	emitSelections(selections: number[]): void;
}


export class InsertCellEdit implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
	label: string = 'Insert Cell';
	constructor(
		public resource: URI,
		private insertIndex: number,
		private cell: NotebookCellTextModel,
		private editingDelegate: ITextCellEditingDelegate,
		private beforedSelections: number[] | undefined,
		private endSelections: number[] | undefined
	) {
	}

	undo(): void | Promise<void> {
		if (!this.editingDelegate.deleteCell) {
			throw new Error('Notebook Delete Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.deleteCell(this.insertIndex);
		if (this.beforedSelections) {
			this.editingDelegate.emitSelections(this.beforedSelections);
		}
	}
	redo(): void | Promise<void> {
		if (!this.editingDelegate.insertCell) {
			throw new Error('Notebook Insert Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.insertCell(this.insertIndex, this.cell);
		if (this.endSelections) {
			this.editingDelegate.emitSelections(this.endSelections);
		}
	}
}

export class DeleteCellEdit implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
	label: string = 'Delete Cell';
	constructor(
		public resource: URI,
		private insertIndex: number,
		private _cell: NotebookCellTextModel,
		private editingDelegate: ITextCellEditingDelegate,
		private beforedSelections: number[] | undefined,
		private endSelections: number[] | undefined
	) {

		// save inmem text to `ICell`
		// no needed any more as the text buffer is transfered to `raw_cell`
		// this._rawCell.source = [cell.getText()];
	}

	undo(): void | Promise<void> {
		if (!this.editingDelegate.insertCell) {
			throw new Error('Notebook Insert Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.insertCell(this.insertIndex, this._cell);
		if (this.beforedSelections) {
			this.editingDelegate.emitSelections(this.beforedSelections);
		}
	}

	redo(): void | Promise<void> {
		if (!this.editingDelegate.deleteCell) {
			throw new Error('Notebook Delete Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.deleteCell(this.insertIndex);
		if (this.endSelections) {
			this.editingDelegate.emitSelections(this.endSelections);
		}
	}
}

export class MoveCellEdit implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
	label: string = 'Delete Cell';

	constructor(
		public resource: URI,
		private fromIndex: number,
		private toIndex: number,
		private editingDelegate: ITextCellEditingDelegate,
		private beforedSelections: number[] | undefined,
		private endSelections: number[] | undefined
	) {
	}

	undo(): void | Promise<void> {
		if (!this.editingDelegate.moveCell) {
			throw new Error('Notebook Move Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.moveCell(this.toIndex, this.fromIndex, this.endSelections, this.beforedSelections);
		if (this.beforedSelections) {
			this.editingDelegate.emitSelections(this.beforedSelections);
		}
	}

	redo(): void | Promise<void> {
		if (!this.editingDelegate.moveCell) {
			throw new Error('Notebook Move Cell not implemented for Undo/Redo');
		}

		this.editingDelegate.moveCell(this.fromIndex, this.toIndex, this.beforedSelections, this.endSelections);
		if (this.endSelections) {
			this.editingDelegate.emitSelections(this.endSelections);
		}
	}
}

export class SpliceCellsEdit implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
	label: string = 'Insert Cell';
	constructor(
		public resource: URI,
		private diffs: [number, NotebookCellTextModel[], NotebookCellTextModel[]][],
		private editingDelegate: ITextCellEditingDelegate,
		private beforeHandles: number[] | undefined,
		private endHandles: number[] | undefined
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

		if (this.beforeHandles) {
			this.editingDelegate.emitSelections(this.beforeHandles);
		}
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

		if (this.endHandles) {
			this.editingDelegate.emitSelections(this.endHandles);
		}
	}
}
