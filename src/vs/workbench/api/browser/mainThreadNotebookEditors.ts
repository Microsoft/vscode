/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, dispose } from 'vs/base/common/lifecycle';
import { getNotebookEditorFromEditorPane, INotebookEditor, NotebookEditorOptions } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { INotebookEditorService } from 'vs/workbench/contrib/notebook/browser/notebookEditorService';
import { ExtHostContext, ExtHostNotebookShape, IExtHostContext, INotebookDocumentShowOptions, INotebookEditorViewColumnInfo, MainThreadNotebookEditorsShape, NotebookEditorRevealType } from '../common/extHost.protocol';
import { MainThreadNotebooksAndEditors } from 'vs/workbench/api/browser/mainThreadNotebookDocumentsAndEditors';
import { ICellEditOperation, INotebookDecorationRenderOptions } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ICellRange } from 'vs/workbench/contrib/notebook/common/notebookRange';
import { ILogService } from 'vs/platform/log/common/log';
import { URI, UriComponents } from 'vs/base/common/uri';
import { EditorActivation, EditorOverride } from 'vs/platform/editor/common/editor';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/common/notebookEditorInput';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { editorGroupToViewColumn } from 'vs/workbench/common/editor';
import { equals } from 'vs/base/common/objects';

class MainThreadNotebook {

	constructor(
		readonly editor: INotebookEditor,
		readonly disposables: DisposableStore
	) { }

	dispose() {
		this.disposables.dispose();
	}
}

export class MainThreadNotebookEditors implements MainThreadNotebookEditorsShape {

	private readonly _disposables = new DisposableStore();

	private readonly _proxy: ExtHostNotebookShape;
	private readonly _mainThreadEditors = new Map<string, MainThreadNotebook>();

	private _currentViewColumnInfo?: INotebookEditorViewColumnInfo;

	constructor(
		extHostContext: IExtHostContext,
		notebooksAndEditors: MainThreadNotebooksAndEditors,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IEditorService private readonly _editorService: IEditorService,
		@ILogService private readonly _logService: ILogService,
		@INotebookEditorService private readonly _notebookEditorService: INotebookEditorService,
		@IEditorGroupsService private readonly _editorGroupService: IEditorGroupsService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostNotebook);

		notebooksAndEditors.onDidAddEditors(this._handleEditorsAdded, this, this._disposables);
		notebooksAndEditors.onDidRemoveEditors(this._handleEditorsRemoved, this, this._disposables);

		this._editorService.onDidActiveEditorChange(() => this._updateEditorViewColumns(), this, this._disposables);
		this._editorGroupService.onDidRemoveGroup(() => this._updateEditorViewColumns(), this, this._disposables);
		this._editorGroupService.onDidMoveGroup(() => this._updateEditorViewColumns(), this, this._disposables);
	}

	dispose(): void {
		this._disposables.dispose();
		dispose(this._mainThreadEditors.values());
	}

	private _handleEditorsAdded(editors: readonly INotebookEditor[]): void {

		for (const editor of editors) {

			const editorDisposables = new DisposableStore();
			editorDisposables.add(editor.onDidChangeVisibleRanges(() => {
				this._proxy.$acceptEditorPropertiesChanged(editor.getId(), { visibleRanges: { ranges: editor.visibleRanges } });
			}));

			editorDisposables.add(editor.onDidChangeSelection(() => {
				this._proxy.$acceptEditorPropertiesChanged(editor.getId(), { selections: { selections: editor.getSelections() } });
			}));

			const wrapper = new MainThreadNotebook(editor, editorDisposables);
			this._mainThreadEditors.set(editor.getId(), wrapper);
		}
	}

	private _handleEditorsRemoved(editorIds: readonly string[]): void {
		for (const id of editorIds) {
			this._mainThreadEditors.get(id)?.dispose();
			this._mainThreadEditors.delete(id);
		}
	}

	private _updateEditorViewColumns(): void {
		const result: INotebookEditorViewColumnInfo = Object.create(null);
		for (let editorPane of this._editorService.visibleEditorPanes) {
			const candidate = getNotebookEditorFromEditorPane(editorPane);
			if (candidate && this._mainThreadEditors.has(candidate.getId())) {
				result[candidate.getId()] = editorGroupToViewColumn(this._editorGroupService, editorPane.group);
			}
		}
		if (!equals(result, this._currentViewColumnInfo)) {
			this._currentViewColumnInfo = result;
			this._proxy.$acceptEditorViewColumns(result);
		}
	}

	async $tryApplyEdits(editorId: string, modelVersionId: number, cellEdits: ICellEditOperation[]): Promise<boolean> {
		const wrapper = this._mainThreadEditors.get(editorId);
		if (!wrapper) {
			return false;
		}
		const { editor } = wrapper;
		if (!editor.textModel) {
			this._logService.warn('Notebook editor has NO model', editorId);
			return false;
		}
		if (editor.textModel.versionId !== modelVersionId) {
			return false;
		}
		//todo@jrieken use proper selection logic!
		return editor.textModel.applyEdits(cellEdits, true, undefined, () => undefined, undefined);
	}



	async $tryShowNotebookDocument(resource: UriComponents, viewType: string, options: INotebookDocumentShowOptions): Promise<string> {
		const editorOptions = new NotebookEditorOptions({
			cellSelections: options.selections,
			preserveFocus: options.preserveFocus,
			pinned: options.pinned,
			// selection: options.selection,
			// preserve pre 1.38 behaviour to not make group active when preserveFocus: true
			// but make sure to restore the editor to fix https://github.com/microsoft/vscode/issues/79633
			activation: options.preserveFocus ? EditorActivation.RESTORE : undefined,
			override: EditorOverride.DISABLED,
		});

		const input = NotebookEditorInput.create(this._instantiationService, URI.revive(resource), viewType);
		const editorPane = await this._editorService.openEditor(input, editorOptions, options.position);
		const notebookEditor = getNotebookEditorFromEditorPane(editorPane);

		if (notebookEditor) {
			return notebookEditor.getId();
		} else {
			throw new Error(`Notebook Editor creation failure for documenet ${resource}`);
		}
	}

	async $tryRevealRange(id: string, range: ICellRange, revealType: NotebookEditorRevealType): Promise<void> {
		const editor = this._notebookEditorService.getNotebookEditor(id);
		if (!editor) {
			return;
		}
		const notebookEditor = editor as INotebookEditor;
		if (!notebookEditor.hasModel()) {
			return;
		}
		const viewModel = notebookEditor.viewModel;
		const cell = viewModel.cellAt(range.start);
		if (!cell) {
			return;
		}

		switch (revealType) {
			case NotebookEditorRevealType.Default:
				return notebookEditor.revealCellRangeInView(range);
			case NotebookEditorRevealType.InCenter:
				return notebookEditor.revealInCenter(cell);
			case NotebookEditorRevealType.InCenterIfOutsideViewport:
				return notebookEditor.revealInCenterIfOutsideViewport(cell);
			case NotebookEditorRevealType.AtTop:
				return notebookEditor.revealInViewAtTop(cell);
		}
	}

	$registerNotebookEditorDecorationType(key: string, options: INotebookDecorationRenderOptions): void {
		this._notebookEditorService.registerEditorDecorationType(key, options);
	}

	$removeNotebookEditorDecorationType(key: string): void {
		this._notebookEditorService.removeEditorDecorationType(key);
	}

	$trySetDecorations(id: string, range: ICellRange, key: string): void {
		const editor = this._notebookEditorService.getNotebookEditor(id);
		if (editor) {
			const notebookEditor = editor as INotebookEditor;
			notebookEditor.setEditorDecorations(key, range);
		}
	}
}
