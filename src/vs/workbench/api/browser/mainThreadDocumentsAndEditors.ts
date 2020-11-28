/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable, combinedDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ICodeEditor, isCodeEditor, isDiffEditor, IActiveCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IEditor } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { IModelService, shouldSynchronizeModel } from 'vs/editor/common/services/modelService';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IFileService } from 'vs/platform/files/common/files';
import { extHostCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { MainThreadDocuments } from 'vs/workbench/api/browser/mainThreadDocuments';
import { MainThreadTextEditor } from 'vs/workbench/api/browser/mainThreadEditor';
import { MainThreadTextEditors } from 'vs/workbench/api/browser/mainThreadEditors';
import { ExtHostContext, ExtHostDocumentsAndEditorsShape, IDocumentsAndEditorsDelta, IExtHostContext, IModelAddedData, ITextEditorAddData, MainContext } from 'vs/workbench/api/common/extHost.protocol';
import { BaseTextEditor } from 'vs/workbench/browser/parts/editor/textEditor';
import { editorGroupToViewColumn, EditorGroupColumn, IEditorPane } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IPathService } from 'vs/workbench/services/path/common/pathService';

namespace delta {

	export function ofSets<T>(before: Set<T>, after: Set<T>): { removed: T[], added: T[] } {
		const removed: T[] = [];
		const added: T[] = [];
		for (let element of before) {
			if (!after.has(element)) {
				removed.push(element);
			}
		}
		for (let element of after) {
			if (!before.has(element)) {
				added.push(element);
			}
		}
		return { removed, added };
	}

	export function ofMaps<K, V>(before: Map<K, V>, after: Map<K, V>): { removed: V[], added: V[] } {
		const removed: V[] = [];
		const added: V[] = [];
		for (let [index, value] of before) {
			if (!after.has(index)) {
				removed.push(value);
			}
		}
		for (let [index, value] of after) {
			if (!before.has(index)) {
				added.push(value);
			}
		}
		return { removed, added };
	}
}

class TextEditorSnapshot {

	readonly id: string;

	constructor(
		readonly editor: IActiveCodeEditor,
	) {
		this.id = `${editor.getId()},${editor.getModel().id}`;
	}
}

class DocumentAndEditorStateDelta {

	readonly isEmpty: boolean;

	constructor(
		readonly removedDocuments: ITextModel[],
		readonly addedDocuments: ITextModel[],
		readonly removedEditors: TextEditorSnapshot[],
		readonly addedEditors: TextEditorSnapshot[],
		readonly oldActiveEditor: string | null | undefined,
		readonly newActiveEditor: string | null | undefined,
	) {
		this.isEmpty = this.removedDocuments.length === 0
			&& this.addedDocuments.length === 0
			&& this.removedEditors.length === 0
			&& this.addedEditors.length === 0
			&& oldActiveEditor === newActiveEditor;
	}

	toString(): string {
		let ret = 'DocumentAndEditorStateDelta\n';
		ret += `\tRemoved Documents: [${this.removedDocuments.map(d => d.uri.toString(true)).join(', ')}]\n`;
		ret += `\tAdded Documents: [${this.addedDocuments.map(d => d.uri.toString(true)).join(', ')}]\n`;
		ret += `\tRemoved Editors: [${this.removedEditors.map(e => e.id).join(', ')}]\n`;
		ret += `\tAdded Editors: [${this.addedEditors.map(e => e.id).join(', ')}]\n`;
		ret += `\tNew Active Editor: ${this.newActiveEditor}\n`;
		return ret;
	}
}

class DocumentAndEditorState {

	static compute(before: DocumentAndEditorState | undefined, after: DocumentAndEditorState): DocumentAndEditorStateDelta {
		if (!before) {
			return new DocumentAndEditorStateDelta(
				[], [...after.documents.values()],
				[], [...after.textEditors.values()],
				undefined, after.activeEditor
			);
		}
		const documentDelta = delta.ofSets(before.documents, after.documents);
		const editorDelta = delta.ofMaps(before.textEditors, after.textEditors);
		const oldActiveEditor = before.activeEditor !== after.activeEditor ? before.activeEditor : undefined;
		const newActiveEditor = before.activeEditor !== after.activeEditor ? after.activeEditor : undefined;

		return new DocumentAndEditorStateDelta(
			documentDelta.removed, documentDelta.added,
			editorDelta.removed, editorDelta.added,
			oldActiveEditor, newActiveEditor
		);
	}

	constructor(
		readonly documents: Set<ITextModel>,
		readonly textEditors: Map<string, TextEditorSnapshot>,
		readonly activeEditor: string | null | undefined,
	) {
		//
	}
}

const enum ActiveEditorOrder {
	Editor, Panel
}

class MainThreadDocumentAndEditorStateComputer {

	private readonly _toDispose = new DisposableStore();
	private _toDisposeOnEditorRemove = new Map<string, IDisposable>();
	private _currentState?: DocumentAndEditorState;
	private _activeEditorOrder: ActiveEditorOrder = ActiveEditorOrder.Editor;

	constructor(
		private readonly _onDidChangeState: (delta: DocumentAndEditorStateDelta) => void,
		@IModelService private readonly _modelService: IModelService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IEditorService private readonly _editorService: IEditorService,
		@IPanelService private readonly _panelService: IPanelService
	) {
		this._modelService.onModelAdded(this._updateStateOnModelAdd, this, this._toDispose);
		this._modelService.onModelRemoved(_ => this._updateState(), this, this._toDispose);
		this._editorService.onDidActiveEditorChange(_ => this._updateState(), this, this._toDispose);

		this._codeEditorService.onCodeEditorAdd(this._onDidAddEditor, this, this._toDispose);
		this._codeEditorService.onCodeEditorRemove(this._onDidRemoveEditor, this, this._toDispose);
		this._codeEditorService.listCodeEditors().forEach(this._onDidAddEditor, this);

		this._panelService.onDidPanelOpen(_ => this._activeEditorOrder = ActiveEditorOrder.Panel, undefined, this._toDispose);
		this._panelService.onDidPanelClose(_ => this._activeEditorOrder = ActiveEditorOrder.Editor, undefined, this._toDispose);
		this._editorService.onDidVisibleEditorsChange(_ => this._activeEditorOrder = ActiveEditorOrder.Editor, undefined, this._toDispose);

		this._updateState();
	}

	dispose(): void {
		this._toDispose.dispose();
	}

	private _onDidAddEditor(e: ICodeEditor): void {
		this._toDisposeOnEditorRemove.set(e.getId(), combinedDisposable(
			e.onDidChangeModel(() => this._updateState()),
			e.onDidFocusEditorText(() => this._updateState()),
			e.onDidFocusEditorWidget(() => this._updateState(e))
		));
		this._updateState();
	}

	private _onDidRemoveEditor(e: ICodeEditor): void {
		const sub = this._toDisposeOnEditorRemove.get(e.getId());
		if (sub) {
			this._toDisposeOnEditorRemove.delete(e.getId());
			sub.dispose();
			this._updateState();
		}
	}

	private _updateStateOnModelAdd(model: ITextModel): void {
		if (!shouldSynchronizeModel(model)) {
			// ignore
			return;
		}

		if (!this._currentState) {
			// too early
			this._updateState();
			return;
		}

		// small (fast) delta
		this._currentState = new DocumentAndEditorState(
			this._currentState.documents.add(model),
			this._currentState.textEditors,
			this._currentState.activeEditor
		);

		this._onDidChangeState(new DocumentAndEditorStateDelta(
			[], [model],
			[], [],
			undefined, undefined
		));
	}

	private _updateState(widgetFocusCandidate?: ICodeEditor): void {

		// models: ignore too large models
		const models = new Set<ITextModel>();
		for (const model of this._modelService.getModels()) {
			if (shouldSynchronizeModel(model)) {
				models.add(model);
			}
		}

		// editor: only take those that have a not too large model
		const editors = new Map<string, TextEditorSnapshot>();
		let activeEditor: string | null = null; // Strict null work. This doesn't like being undefined!

		for (const editor of this._codeEditorService.listCodeEditors()) {
			if (editor.isSimpleWidget) {
				continue;
			}
			const model = editor.getModel();
			if (editor.hasModel() && model && shouldSynchronizeModel(model)
				&& !model.isDisposed() // model disposed
				&& Boolean(this._modelService.getModel(model.uri)) // model disposing, the flag didn't flip yet but the model service already removed it
			) {
				const apiEditor = new TextEditorSnapshot(editor);
				editors.set(apiEditor.id, apiEditor);
				if (editor.hasTextFocus() || (widgetFocusCandidate === editor && editor.hasWidgetFocus())) {
					// text focus has priority, widget focus is tricky because multiple
					// editors might claim widget focus at the same time. therefore we use a
					// candidate (which is the editor that has raised an widget focus event)
					// in addition to the widget focus check
					activeEditor = apiEditor.id;
				}
			}
		}

		// active editor: if none of the previous editors had focus we try
		// to match output panels or the active workbench editor with
		// one of editor we have just computed
		if (!activeEditor) {
			let candidate: IEditor | undefined;
			if (this._activeEditorOrder === ActiveEditorOrder.Editor) {
				candidate = this._getActiveEditorFromEditorPart() || this._getActiveEditorFromPanel();
			} else {
				candidate = this._getActiveEditorFromPanel() || this._getActiveEditorFromEditorPart();
			}

			if (candidate) {
				for (const snapshot of editors.values()) {
					if (candidate === snapshot.editor) {
						activeEditor = snapshot.id;
					}
				}
			}
		}

		// compute new state and compare against old
		const newState = new DocumentAndEditorState(models, editors, activeEditor);
		const delta = DocumentAndEditorState.compute(this._currentState, newState);
		if (!delta.isEmpty) {
			this._currentState = newState;
			this._onDidChangeState(delta);
		}
	}

	private _getActiveEditorFromPanel(): IEditor | undefined {
		const panel = this._panelService.getActivePanel();
		if (panel instanceof BaseTextEditor && isCodeEditor(panel.getControl())) {
			return panel.getControl();
		} else {
			return undefined;
		}
	}

	private _getActiveEditorFromEditorPart(): IEditor | undefined {
		let activeTextEditorControl = this._editorService.activeTextEditorControl;
		if (isDiffEditor(activeTextEditorControl)) {
			activeTextEditorControl = activeTextEditorControl.getModifiedEditor();
		}
		return activeTextEditorControl;
	}
}

@extHostCustomer
export class MainThreadDocumentsAndEditors {

	private readonly _toDispose = new DisposableStore();
	private readonly _proxy: ExtHostDocumentsAndEditorsShape;
	private readonly _mainThreadDocuments: MainThreadDocuments;
	private readonly _textEditors = new Map<string, MainThreadTextEditor>();

	private readonly _onTextEditorAdd = new Emitter<MainThreadTextEditor[]>();
	private readonly _onTextEditorRemove = new Emitter<string[]>();
	private readonly _onDocumentAdd = new Emitter<ITextModel[]>();
	private readonly _onDocumentRemove = new Emitter<URI[]>();

	readonly onTextEditorAdd: Event<MainThreadTextEditor[]> = this._onTextEditorAdd.event;
	readonly onTextEditorRemove: Event<string[]> = this._onTextEditorRemove.event;
	readonly onDocumentAdd: Event<ITextModel[]> = this._onDocumentAdd.event;
	readonly onDocumentRemove: Event<URI[]> = this._onDocumentRemove.event;

	constructor(
		extHostContext: IExtHostContext,
		@IModelService private readonly _modelService: IModelService,
		@ITextFileService private readonly _textFileService: ITextFileService,
		@IEditorService private readonly _editorService: IEditorService,
		@ICodeEditorService codeEditorService: ICodeEditorService,
		@IFileService fileService: IFileService,
		@ITextModelService textModelResolverService: ITextModelService,
		@IEditorGroupsService private readonly _editorGroupService: IEditorGroupsService,
		@IBulkEditService bulkEditService: IBulkEditService,
		@IPanelService panelService: IPanelService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IClipboardService private readonly _clipboardService: IClipboardService,
		@IPathService pathService: IPathService
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostDocumentsAndEditors);

		this._mainThreadDocuments = this._toDispose.add(new MainThreadDocuments(this, extHostContext, this._modelService, this._textFileService, fileService, textModelResolverService, environmentService, uriIdentityService, workingCopyFileService, pathService));
		extHostContext.set(MainContext.MainThreadDocuments, this._mainThreadDocuments);

		const mainThreadTextEditors = this._toDispose.add(new MainThreadTextEditors(this, extHostContext, codeEditorService, bulkEditService, this._editorService, this._editorGroupService));
		extHostContext.set(MainContext.MainThreadTextEditors, mainThreadTextEditors);

		// It is expected that the ctor of the state computer calls our `_onDelta`.
		this._toDispose.add(new MainThreadDocumentAndEditorStateComputer(delta => this._onDelta(delta), _modelService, codeEditorService, this._editorService, panelService));

		this._toDispose.add(this._onTextEditorAdd);
		this._toDispose.add(this._onTextEditorRemove);
		this._toDispose.add(this._onDocumentAdd);
		this._toDispose.add(this._onDocumentRemove);
	}

	dispose(): void {
		this._toDispose.dispose();
	}

	private _onDelta(delta: DocumentAndEditorStateDelta): void {

		let removedDocuments: URI[];
		const removedEditors: string[] = [];
		const addedEditors: MainThreadTextEditor[] = [];

		// removed models
		removedDocuments = delta.removedDocuments.map(m => m.uri);

		// added editors
		for (const apiEditor of delta.addedEditors) {
			const mainThreadEditor = new MainThreadTextEditor(apiEditor.id, apiEditor.editor.getModel(),
				apiEditor.editor, { onGainedFocus() { }, onLostFocus() { } }, this._mainThreadDocuments, this._modelService, this._clipboardService);

			this._textEditors.set(apiEditor.id, mainThreadEditor);
			addedEditors.push(mainThreadEditor);
		}

		// removed editors
		for (const { id } of delta.removedEditors) {
			const mainThreadEditor = this._textEditors.get(id);
			if (mainThreadEditor) {
				mainThreadEditor.dispose();
				this._textEditors.delete(id);
				removedEditors.push(id);
			}
		}

		const extHostDelta: IDocumentsAndEditorsDelta = Object.create(null);
		let empty = true;
		if (delta.newActiveEditor !== undefined) {
			empty = false;
			extHostDelta.newActiveEditor = delta.newActiveEditor;
		}
		if (removedDocuments.length > 0) {
			empty = false;
			extHostDelta.removedDocuments = removedDocuments;
		}
		if (removedEditors.length > 0) {
			empty = false;
			extHostDelta.removedEditors = removedEditors;
		}
		if (delta.addedDocuments.length > 0) {
			empty = false;
			extHostDelta.addedDocuments = delta.addedDocuments.map(m => this._toModelAddData(m));
		}
		if (delta.addedEditors.length > 0) {
			empty = false;
			extHostDelta.addedEditors = addedEditors.map(e => this._toTextEditorAddData(e));
		}

		if (!empty) {
			// first update ext host
			this._proxy.$acceptDocumentsAndEditorsDelta(extHostDelta);
			// second update dependent state listener
			this._onDocumentRemove.fire(removedDocuments);
			this._onDocumentAdd.fire(delta.addedDocuments);
			this._onTextEditorRemove.fire(removedEditors);
			this._onTextEditorAdd.fire(addedEditors);
		}
	}

	private _toModelAddData(model: ITextModel): IModelAddedData {
		return {
			uri: model.uri,
			versionId: model.getVersionId(),
			lines: model.getLinesContent(),
			EOL: model.getEOL(),
			modeId: model.getLanguageIdentifier().language,
			isDirty: this._textFileService.isDirty(model.uri)
		};
	}

	private _toTextEditorAddData(textEditor: MainThreadTextEditor): ITextEditorAddData {
		const props = textEditor.getProperties();
		return {
			id: textEditor.getId(),
			documentUri: textEditor.getModel().uri,
			options: props.options,
			selections: props.selections,
			visibleRanges: props.visibleRanges,
			editorPosition: this._findEditorPosition(textEditor)
		};
	}

	private _findEditorPosition(editor: MainThreadTextEditor): EditorGroupColumn | undefined {
		for (const editorPane of this._editorService.visibleEditorPanes) {
			if (editor.matches(editorPane)) {
				return editorGroupToViewColumn(this._editorGroupService, editorPane.group);
			}
		}
		return undefined;
	}

	findTextEditorIdFor(editorPane: IEditorPane): string | undefined {
		for (const [id, editor] of this._textEditors) {
			if (editor.matches(editorPane)) {
				return id;
			}
		}
		return undefined;
	}

	getEditor(id: string): MainThreadTextEditor | undefined {
		return this._textEditors.get(id);
	}
}
