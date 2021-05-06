/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, DisposableStore, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { Action2, registerAction2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { getNotebookEditorFromEditorPane, ICellViewModel, INotebookEditor, INotebookEditorContribution } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { registerNotebookContribution } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

export class TroubleshootController extends Disposable implements INotebookEditorContribution {
	static id: string = 'workbench.notebook.troubleshoot';

	private readonly _localStore = this._register(new DisposableStore());
	private _cellStateListeners: IDisposable[] = [];
	private _logging: boolean = false;

	constructor(private readonly _notebookEditor: INotebookEditor) {
		super();

		this._register(this._notebookEditor.onDidChangeModel(() => {
			this._localStore.clear();
			this._cellStateListeners.forEach(listener => listener.dispose());

			if (!this._notebookEditor.viewModel) {
				return;
			}

			this._updateListener();
		}));

		this._updateListener();
	}

	toggleLogging(): void {
		this._logging = !this._logging;
	}

	private _log(cell: ICellViewModel, e: any) {
		if (this._logging) {
			const oldHeight = this._notebookEditor.getViewHeight(cell);
			console.log(`cell#${cell.handle}`, e, `${oldHeight} -> ${cell.layoutInfo.totalHeight}`);
		}
	}

	private _updateListener() {
		if (!this._notebookEditor.viewModel) {
			return;
		}

		const viewModel = this._notebookEditor.viewModel;

		for (let i = 0; i < viewModel.length; i++) {
			const cell = viewModel.viewCells[i];

			this._cellStateListeners.push(cell.onDidChangeLayout(e => {
				this._log(cell, e);
			}));
		}

		this._localStore.add(viewModel.onDidChangeViewCells(e => {
			e.splices.reverse().forEach(splice => {
				const [start, deleted, newCells] = splice;
				const deletedCells = this._cellStateListeners.splice(start, deleted, ...newCells.map(cell => {
					return cell.onDidChangeLayout(e => {
						this._log(cell, e);
					});
				}));

				dispose(deletedCells);
			});
		}));
	}

	override dispose() {
		dispose(this._cellStateListeners);
		super.dispose();
	}
}

registerNotebookContribution(TroubleshootController.id, TroubleshootController);

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.toggleLayoutTroubleshoot',
			title: 'Toggle Notebook Layout Troubleshoot',
			category: CATEGORIES.Developer,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editor = getNotebookEditorFromEditorPane(editorService.activeEditorPane);

		if (!editor) {
			return;
		}

		const controller = editor.getContribution<TroubleshootController>(TroubleshootController.id);
		controller?.toggleLogging();
	}
});

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'notebook.inspectLayout',
			title: 'Inspect Notebook Layout',
			category: CATEGORIES.Developer,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const editor = getNotebookEditorFromEditorPane(editorService.activeEditorPane);

		if (!editor || !editor.viewModel) {
			return;
		}

		editor.viewModel.viewCells.forEach(cell => {
			console.log(`cell#${cell.handle}`, cell.layoutInfo);
		});
	}
});
