/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ICellViewModel, NOTEBOOK_HAS_RUNNING_CELL, NOTEBOOK_INTERRUPTIBLE_KERNEL, NOTEBOOK_KERNEL_COUNT, INotebookEditor, NOTEBOOK_KERNEL_SELECTED } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { NotebookCellExecutionState } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';

export class NotebookEditorContextKeys {

	private readonly _notebookKernelCount: IContextKey<number>;
	private readonly _notebookKernelSelected: IContextKey<boolean>;
	private readonly _interruptibleKernel: IContextKey<boolean>;
	private readonly _someCellRunning: IContextKey<boolean>;

	private readonly _disposables = new DisposableStore();
	private readonly _viewModelDisposables = new DisposableStore();
	private readonly _cellStateListeners: IDisposable[] = [];

	constructor(
		private readonly _editor: INotebookEditor,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		this._notebookKernelCount = NOTEBOOK_KERNEL_COUNT.bindTo(contextKeyService);
		this._notebookKernelSelected = NOTEBOOK_KERNEL_SELECTED.bindTo(contextKeyService);
		this._interruptibleKernel = NOTEBOOK_INTERRUPTIBLE_KERNEL.bindTo(contextKeyService);
		this._someCellRunning = NOTEBOOK_HAS_RUNNING_CELL.bindTo(contextKeyService);

		this._disposables.add(_editor.onDidChangeModel(this._handleDidChangeModel, this));
		this._disposables.add(_notebookKernelService.onDidAddKernel(this._updateKernelContext, this));
		this._disposables.add(_notebookKernelService.onDidChangeNotebookKernelBinding(this._updateKernelContext, this));
		this._handleDidChangeModel();
	}

	dispose(): void {
		this._disposables.dispose();
		this._viewModelDisposables.dispose();
		this._notebookKernelCount.reset();
		this._interruptibleKernel.reset();
		this._someCellRunning.reset();
	}

	private _handleDidChangeModel(): void {

		this._updateKernelContext();

		this._viewModelDisposables.clear();
		dispose(this._cellStateListeners);
		this._cellStateListeners.length = 0;

		if (!this._editor.hasModel()) {
			return;
		}

		let executionCount = 0;

		const addCellStateListener = (c: ICellViewModel) => {
			return (c as CellViewModel).onDidChangeState(e => {
				if (!e.runStateChanged) {
					return;
				}
				if (c.metadata?.runState === NotebookCellExecutionState.Pending) {
					executionCount++;
				} else if (c.metadata?.runState === NotebookCellExecutionState.Idle) {
					executionCount--;
				}
				this._someCellRunning.set(executionCount > 0);
			});
		};

		for (const cell of this._editor.viewModel.viewCells) {
			this._cellStateListeners.push(addCellStateListener(cell));
		}

		this._viewModelDisposables.add(this._editor.viewModel.onDidChangeViewCells(e => {
			e.splices.reverse().forEach(splice => {
				const [start, deleted, newCells] = splice;
				const deletedCells = this._cellStateListeners.splice(start, deleted, ...newCells.map(addCellStateListener));
				dispose(deletedCells);
			});
		}));
	}

	private _updateKernelContext(): void {
		if (!this._editor.hasModel()) {
			this._notebookKernelCount.reset();
			this._interruptibleKernel.reset();
			return;
		}

		const { selected, all } = this._notebookKernelService.getMatchingKernel(this._editor.viewModel.notebookDocument);
		this._notebookKernelCount.set(all.length);
		this._interruptibleKernel.set(selected?.implementsInterrupt ?? false);
		this._notebookKernelSelected.set(Boolean(selected));
	}
}
