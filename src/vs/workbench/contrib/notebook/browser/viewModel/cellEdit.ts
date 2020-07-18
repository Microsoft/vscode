/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IResourceUndoRedoElement, UndoRedoElementType } from 'vs/platform/undoRedo/common/undoRedo';
import { URI } from 'vs/base/common/uri';
import { BaseCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/baseCellViewModel';
import { CellFocusMode } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { ITextCellEditingDelegate } from 'vs/workbench/contrib/notebook/common/model/cellEdit';


export interface IViewCellEditingDelegate extends ITextCellEditingDelegate {
	createCellViewModel?(cell: NotebookCellTextModel): BaseCellViewModel;
	createCell?(index: number, source: string | string[], language: string, type: CellKind): BaseCellViewModel;
}

export class JoinCellEdit implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
	label: string = 'Join Cell';
	private _deletedRawCell: NotebookCellTextModel;
	constructor(
		public resource: URI,
		private index: number,
		private direction: 'above' | 'below',
		private cell: BaseCellViewModel,
		private selections: Selection[],
		private inverseRange: Range,
		private insertContent: string,
		private removedCell: BaseCellViewModel,
		private editingDelegate: IViewCellEditingDelegate,
	) {
		this._deletedRawCell = this.removedCell.model;
	}

	async undo(): Promise<void> {
		if (!this.editingDelegate.insertCell || !this.editingDelegate.createCellViewModel) {
			throw new Error('Notebook Insert Cell not implemented for Undo/Redo');
		}

		await this.cell.resolveTextModel();

		this.cell.textModel?.applyEdits([
			{ range: this.inverseRange, text: '' }
		]);

		this.cell.setSelections(this.selections);

		const cell = this.editingDelegate.createCellViewModel(this._deletedRawCell);
		if (this.direction === 'above') {
			this.editingDelegate.insertCell(this.index, this._deletedRawCell);
			this.editingDelegate.emitSelections([cell.handle]);
			cell.focusMode = CellFocusMode.Editor;
		} else {
			this.editingDelegate.insertCell(this.index, cell.model);
			this.editingDelegate.emitSelections([this.cell.handle]);
			this.cell.focusMode = CellFocusMode.Editor;
		}
	}

	async redo(): Promise<void> {
		if (!this.editingDelegate.deleteCell) {
			throw new Error('Notebook Delete Cell not implemented for Undo/Redo');
		}

		await this.cell.resolveTextModel();
		this.cell.textModel?.applyEdits([
			{ range: this.inverseRange, text: this.insertContent }
		]);

		this.editingDelegate.deleteCell(this.index);
		this.editingDelegate.emitSelections([this.cell.handle]);
		this.cell.focusMode = CellFocusMode.Editor;
	}
}


export class SplitCellEdit implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
	label: string = 'Join Cell';
	constructor(
		public resource: URI,
		private index: number,
		private cell: BaseCellViewModel,
		private selections: Selection[],
		private cellContents: string[],
		private language: string,
		private cellKind: CellKind,
		private editingDelegate: IViewCellEditingDelegate
	) {

	}

	async undo(): Promise<void> {
		if (!this.editingDelegate.deleteCell) {
			throw new Error('Notebook Delete Cell not implemented for Undo/Redo');
		}

		await this.cell.resolveTextModel();
		this.cell.textModel!.applyEdits([
			{
				range: this.cell.textModel!.getFullModelRange(),
				text: this.cellContents.join('')
			}
		]);
		this.cell.setSelections(this.selections);

		for (let j = 1; j < this.cellContents.length; j++) {
			this.editingDelegate.deleteCell(this.index + 1);
		}

		this.editingDelegate.emitSelections([this.cell.handle]);
		this.cell.focusMode = CellFocusMode.Editor;
	}

	async redo(): Promise<void> {
		if (!this.editingDelegate.createCell) {
			throw new Error('Notebook Insert Cell not implemented for Undo/Redo');
		}

		await this.cell.resolveTextModel();
		this.cell.textModel!.applyEdits([
			{ range: this.cell.textModel!.getFullModelRange(), text: this.cellContents[0] }
		], false);

		let insertIndex = this.index + 1;
		let lastCell;
		for (let j = 1; j < this.cellContents.length; j++, insertIndex++) {
			lastCell = this.editingDelegate.createCell(insertIndex, this.cellContents[j], this.language, this.cellKind);
		}

		if (lastCell) {
			this.editingDelegate.emitSelections([lastCell.handle]);
			lastCell.focusMode = CellFocusMode.Editor;
		}
	}
}
