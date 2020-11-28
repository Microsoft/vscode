/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { disposed } from 'vs/base/common/errors';
import { IDisposable, dispose, DisposableStore } from 'vs/base/common/lifecycle';
import { equals as objectEquals } from 'vs/base/common/objects';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IBulkEditService, ResourceEdit, ResourceFileEdit, ResourceTextEdit } from 'vs/editor/browser/services/bulkEditService';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IRange } from 'vs/editor/common/core/range';
import { ISelection } from 'vs/editor/common/core/selection';
import { IDecorationOptions, IDecorationRenderOptions, ILineChange } from 'vs/editor/common/editorCommon';
import { ISingleEditOperation } from 'vs/editor/common/model';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ITextEditorOptions, IResourceEditorInput, EditorActivation } from 'vs/platform/editor/common/editor';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { MainThreadDocumentsAndEditors } from 'vs/workbench/api/browser/mainThreadDocumentsAndEditors';
import { MainThreadTextEditor } from 'vs/workbench/api/browser/mainThreadEditor';
import { ExtHostContext, ExtHostEditorsShape, IApplyEditsOptions, IExtHostContext, ITextDocumentShowOptions, ITextEditorConfigurationUpdate, ITextEditorPositionData, IUndoStopOptions, MainThreadTextEditorsShape, TextEditorRevealType, IWorkspaceEditDto, WorkspaceEditType } from 'vs/workbench/api/common/extHost.protocol';
import { editorGroupToViewColumn, EditorGroupColumn, viewColumnToEditorGroup } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { revive } from 'vs/base/common/marshalling';
import { ResourceNotebookCellEdit } from 'vs/workbench/contrib/bulkEdit/browser/bulkCellEdits';

function reviveWorkspaceEditDto2(data: IWorkspaceEditDto | undefined): ResourceEdit[] {
	if (!data?.edits) {
		return [];
	}

	const result: ResourceEdit[] = [];
	for (let edit of revive<IWorkspaceEditDto>(data).edits) {
		if (edit._type === WorkspaceEditType.File) {
			result.push(new ResourceFileEdit(edit.oldUri, edit.newUri, edit.options, edit.metadata));
		} else if (edit._type === WorkspaceEditType.Text) {
			result.push(new ResourceTextEdit(edit.resource, edit.edit, edit.modelVersionId, edit.metadata));
		} else if (edit._type === WorkspaceEditType.Cell) {
			result.push(new ResourceNotebookCellEdit(edit.resource, edit.edit, edit.notebookVersionId, edit.metadata));
		}
	}
	return result;
}

export class MainThreadTextEditors implements MainThreadTextEditorsShape {

	private static INSTANCE_COUNT: number = 0;

	private readonly _instanceId: string;
	private readonly _proxy: ExtHostEditorsShape;
	private readonly _documentsAndEditors: MainThreadDocumentsAndEditors;
	private readonly _toDispose = new DisposableStore();
	private _textEditorsListenersMap: { [editorId: string]: IDisposable[]; };
	private _editorPositionData: ITextEditorPositionData | null;
	private _registeredDecorationTypes: { [decorationType: string]: boolean; };

	constructor(
		documentsAndEditors: MainThreadDocumentsAndEditors,
		extHostContext: IExtHostContext,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IBulkEditService private readonly _bulkEditService: IBulkEditService,
		@IEditorService private readonly _editorService: IEditorService,
		@IEditorGroupsService private readonly _editorGroupService: IEditorGroupsService
	) {
		this._instanceId = String(++MainThreadTextEditors.INSTANCE_COUNT);
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostEditors);
		this._documentsAndEditors = documentsAndEditors;

		this._textEditorsListenersMap = Object.create(null);
		this._editorPositionData = null;

		this._toDispose.add(documentsAndEditors.onTextEditorAdd(editors => editors.forEach(this._onTextEditorAdd, this)));
		this._toDispose.add(documentsAndEditors.onTextEditorRemove(editors => editors.forEach(this._onTextEditorRemove, this)));

		this._toDispose.add(this._editorService.onDidVisibleEditorsChange(() => this._updateActiveAndVisibleTextEditors()));
		this._toDispose.add(this._editorGroupService.onDidRemoveGroup(() => this._updateActiveAndVisibleTextEditors()));
		this._toDispose.add(this._editorGroupService.onDidMoveGroup(() => this._updateActiveAndVisibleTextEditors()));

		this._registeredDecorationTypes = Object.create(null);
	}

	public dispose(): void {
		Object.keys(this._textEditorsListenersMap).forEach((editorId) => {
			dispose(this._textEditorsListenersMap[editorId]);
		});
		this._textEditorsListenersMap = Object.create(null);
		this._toDispose.dispose();
		for (let decorationType in this._registeredDecorationTypes) {
			this._codeEditorService.removeDecorationType(decorationType);
		}
		this._registeredDecorationTypes = Object.create(null);
	}

	private _onTextEditorAdd(textEditor: MainThreadTextEditor): void {
		const id = textEditor.getId();
		const toDispose: IDisposable[] = [];
		toDispose.push(textEditor.onPropertiesChanged((data) => {
			this._proxy.$acceptEditorPropertiesChanged(id, data);
		}));

		this._textEditorsListenersMap[id] = toDispose;
	}

	private _onTextEditorRemove(id: string): void {
		dispose(this._textEditorsListenersMap[id]);
		delete this._textEditorsListenersMap[id];
	}

	private _updateActiveAndVisibleTextEditors(): void {

		// editor columns
		const editorPositionData = this._getTextEditorPositionData();
		if (!objectEquals(this._editorPositionData, editorPositionData)) {
			this._editorPositionData = editorPositionData;
			this._proxy.$acceptEditorPositionData(this._editorPositionData);
		}
	}

	private _getTextEditorPositionData(): ITextEditorPositionData {
		const result: ITextEditorPositionData = Object.create(null);
		for (let editorPane of this._editorService.visibleEditorPanes) {
			const id = this._documentsAndEditors.findTextEditorIdFor(editorPane);
			if (id) {
				result[id] = editorGroupToViewColumn(this._editorGroupService, editorPane.group);
			}
		}
		return result;
	}

	// --- from extension host process

	async $tryShowTextDocument(resource: UriComponents, options: ITextDocumentShowOptions): Promise<string | undefined> {
		const uri = URI.revive(resource);

		const editorOptions: ITextEditorOptions = {
			preserveFocus: options.preserveFocus,
			pinned: options.pinned,
			selection: options.selection,
			// preserve pre 1.38 behaviour to not make group active when preserveFocus: true
			// but make sure to restore the editor to fix https://github.com/microsoft/vscode/issues/79633
			activation: options.preserveFocus ? EditorActivation.RESTORE : undefined,
			override: false
		};

		const input: IResourceEditorInput = {
			resource: uri,
			options: editorOptions
		};

		const editor = await this._editorService.openEditor(input, viewColumnToEditorGroup(this._editorGroupService, options.position));
		if (!editor) {
			return undefined;
		}
		return this._documentsAndEditors.findTextEditorIdFor(editor);
	}

	async $tryShowEditor(id: string, position?: EditorGroupColumn): Promise<void> {
		const mainThreadEditor = this._documentsAndEditors.getEditor(id);
		if (mainThreadEditor) {
			const model = mainThreadEditor.getModel();
			await this._editorService.openEditor({
				resource: model.uri,
				options: { preserveFocus: false }
			}, viewColumnToEditorGroup(this._editorGroupService, position));
			return;
		}
	}

	async $tryHideEditor(id: string): Promise<void> {
		const mainThreadEditor = this._documentsAndEditors.getEditor(id);
		if (mainThreadEditor) {
			const editorPanes = this._editorService.visibleEditorPanes;
			for (let editorPane of editorPanes) {
				if (mainThreadEditor.matches(editorPane)) {
					return editorPane.group.closeEditor(editorPane.input);
				}
			}
		}
	}

	$trySetSelections(id: string, selections: ISelection[]): Promise<void> {
		const editor = this._documentsAndEditors.getEditor(id);
		if (!editor) {
			return Promise.reject(disposed(`TextEditor(${id})`));
		}
		editor.setSelections(selections);
		return Promise.resolve(undefined);
	}

	$trySetDecorations(id: string, key: string, ranges: IDecorationOptions[]): Promise<void> {
		key = `${this._instanceId}-${key}`;
		const editor = this._documentsAndEditors.getEditor(id);
		if (!editor) {
			return Promise.reject(disposed(`TextEditor(${id})`));
		}
		editor.setDecorations(key, ranges);
		return Promise.resolve(undefined);
	}

	$trySetDecorationsFast(id: string, key: string, ranges: number[]): Promise<void> {
		key = `${this._instanceId}-${key}`;
		const editor = this._documentsAndEditors.getEditor(id);
		if (!editor) {
			return Promise.reject(disposed(`TextEditor(${id})`));
		}
		editor.setDecorationsFast(key, ranges);
		return Promise.resolve(undefined);
	}

	$tryRevealRange(id: string, range: IRange, revealType: TextEditorRevealType): Promise<void> {
		const editor = this._documentsAndEditors.getEditor(id);
		if (!editor) {
			return Promise.reject(disposed(`TextEditor(${id})`));
		}
		editor.revealRange(range, revealType);
		return Promise.resolve();
	}

	$trySetOptions(id: string, options: ITextEditorConfigurationUpdate): Promise<void> {
		const editor = this._documentsAndEditors.getEditor(id);
		if (!editor) {
			return Promise.reject(disposed(`TextEditor(${id})`));
		}
		editor.setConfiguration(options);
		return Promise.resolve(undefined);
	}

	$tryApplyEdits(id: string, modelVersionId: number, edits: ISingleEditOperation[], opts: IApplyEditsOptions): Promise<boolean> {
		const editor = this._documentsAndEditors.getEditor(id);
		if (!editor) {
			return Promise.reject(disposed(`TextEditor(${id})`));
		}
		return Promise.resolve(editor.applyEdits(modelVersionId, edits, opts));
	}

	$tryApplyWorkspaceEdit(dto: IWorkspaceEditDto): Promise<boolean> {
		const edits = reviveWorkspaceEditDto2(dto);
		return this._bulkEditService.apply(edits).then(() => true, _err => false);
	}

	$tryInsertSnippet(id: string, template: string, ranges: readonly IRange[], opts: IUndoStopOptions): Promise<boolean> {
		const editor = this._documentsAndEditors.getEditor(id);
		if (!editor) {
			return Promise.reject(disposed(`TextEditor(${id})`));
		}
		return Promise.resolve(editor.insertSnippet(template, ranges, opts));
	}

	$registerTextEditorDecorationType(key: string, options: IDecorationRenderOptions): void {
		key = `${this._instanceId}-${key}`;
		this._registeredDecorationTypes[key] = true;
		this._codeEditorService.registerDecorationType(key, options);
	}

	$removeTextEditorDecorationType(key: string): void {
		key = `${this._instanceId}-${key}`;
		delete this._registeredDecorationTypes[key];
		this._codeEditorService.removeDecorationType(key);
	}

	$getDiffInformation(id: string): Promise<ILineChange[]> {
		const editor = this._documentsAndEditors.getEditor(id);

		if (!editor) {
			return Promise.reject(new Error('No such TextEditor'));
		}

		const codeEditor = editor.getCodeEditor();
		if (!codeEditor) {
			return Promise.reject(new Error('No such CodeEditor'));
		}

		const codeEditorId = codeEditor.getId();
		const diffEditors = this._codeEditorService.listDiffEditors();
		const [diffEditor] = diffEditors.filter(d => d.getOriginalEditor().getId() === codeEditorId || d.getModifiedEditor().getId() === codeEditorId);

		if (diffEditor) {
			return Promise.resolve(diffEditor.getLineChanges() || []);
		}

		const dirtyDiffContribution = codeEditor.getContribution('editor.contrib.dirtydiff');

		if (dirtyDiffContribution) {
			return Promise.resolve((dirtyDiffContribution as any).getChanges());
		}

		return Promise.resolve([]);
	}
}

// --- commands

CommandsRegistry.registerCommand('_workbench.revertAllDirty', async function (accessor: ServicesAccessor) {
	const environmentService = accessor.get(IEnvironmentService);
	if (!environmentService.extensionTestsLocationURI) {
		throw new Error('Command is only available when running extension tests.');
	}

	const workingCopyService = accessor.get(IWorkingCopyService);
	for (const workingCopy of workingCopyService.dirtyWorkingCopies) {
		await workingCopy.revert({ soft: true });
	}
});
