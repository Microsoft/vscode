/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { INotebookTextModel, NotebookCellRunState } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { BaseCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/baseCellViewModel';
import { NOTEBOOK_CELL_TYPE, NOTEBOOK_VIEW_TYPE, NOTEBOOK_CELL_EDITABLE, NOTEBOOK_CELL_RUNNABLE, NOTEBOOK_CELL_MARKDOWN_EDIT_MODE, NOTEBOOK_CELL_RUN_STATE, NOTEBOOK_CELL_HAS_OUTPUTS, CellViewModelStateChangeEvent, CellEditState, NOTEBOOK_CELL_CONTENT_COLLAPSED, CellCollapseState, NOTEBOOK_CELL_OUTPUT_COLLAPSED } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';

export class CellContextKeyManager extends Disposable {

	private cellType: IContextKey<string>;
	private viewType: IContextKey<string>;
	private cellEditable: IContextKey<boolean>;
	private cellRunnable: IContextKey<boolean>;
	private cellRunState: IContextKey<string>;
	private cellHasOutputs: IContextKey<boolean>;
	private cellContentCollapsed: IContextKey<boolean>;
	private cellOutputCollapsed: IContextKey<boolean>;

	private markdownEditMode: IContextKey<boolean>;

	private elementDisposables = new DisposableStore();

	constructor(
		private readonly contextKeyService: IContextKeyService,
		private readonly notebookTextModel: INotebookTextModel,
		private element: BaseCellViewModel
	) {
		super();

		this.cellType = NOTEBOOK_CELL_TYPE.bindTo(this.contextKeyService);
		this.viewType = NOTEBOOK_VIEW_TYPE.bindTo(this.contextKeyService);
		this.cellEditable = NOTEBOOK_CELL_EDITABLE.bindTo(this.contextKeyService);
		this.cellRunnable = NOTEBOOK_CELL_RUNNABLE.bindTo(this.contextKeyService);
		this.markdownEditMode = NOTEBOOK_CELL_MARKDOWN_EDIT_MODE.bindTo(this.contextKeyService);
		this.cellRunState = NOTEBOOK_CELL_RUN_STATE.bindTo(this.contextKeyService);
		this.cellHasOutputs = NOTEBOOK_CELL_HAS_OUTPUTS.bindTo(this.contextKeyService);
		this.cellContentCollapsed = NOTEBOOK_CELL_CONTENT_COLLAPSED.bindTo(this.contextKeyService);
		this.cellOutputCollapsed = NOTEBOOK_CELL_OUTPUT_COLLAPSED.bindTo(this.contextKeyService);

		this.updateForElement(element);
	}

	public updateForElement(element: BaseCellViewModel) {
		this.elementDisposables.clear();
		this.elementDisposables.add(element.onDidChangeState(e => this.onDidChangeState(e)));

		if (element instanceof CodeCellViewModel) {
			this.elementDisposables.add(element.onDidChangeOutputs(() => this.updateForOutputs()));
		}

		this.element = element;
		if (this.element instanceof MarkdownCellViewModel) {
			this.cellType.set('markdown');
		} else if (this.element instanceof CodeCellViewModel) {
			this.cellType.set('code');
		}

		this.updateForMetadata();
		this.updateForEditState();
		this.updateForCollapseState();
		this.updateForOutputs();

		this.viewType.set(this.element.viewType);
	}

	private onDidChangeState(e: CellViewModelStateChangeEvent) {
		if (e.metadataChanged) {
			this.updateForMetadata();
		}

		if (e.editStateChanged) {
			this.updateForEditState();
		}

		if (e.collapseStateChanged) {
			this.updateForCollapseState();
		}
	}

	private updateForMetadata() {
		const metadata = this.element.getEvaluatedMetadata(this.notebookTextModel.metadata);
		this.cellEditable.set(!!metadata.editable);
		this.cellRunnable.set(!!metadata.runnable);

		const runState = metadata.runState ?? NotebookCellRunState.Idle;
		this.cellRunState.set(NotebookCellRunState[runState]);
	}

	private updateForEditState() {
		if (this.element instanceof MarkdownCellViewModel) {
			this.markdownEditMode.set(this.element.editState === CellEditState.Editing);
		} else {
			this.markdownEditMode.set(false);
		}
	}

	private updateForCollapseState() {
		this.cellContentCollapsed.set(this.element.collapseState === CellCollapseState.Collapsed);
		this.cellOutputCollapsed.set(this.element.outputCollapseState === CellCollapseState.Collapsed);
	}

	private updateForOutputs() {
		if (this.element instanceof CodeCellViewModel) {
			this.cellHasOutputs.set(this.element.outputs.length > 0);
		} else {
			this.cellHasOutputs.set(false);
		}
	}
}
