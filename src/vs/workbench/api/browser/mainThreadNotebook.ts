/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { MainContext, MainThreadNotebookShape, NotebookExtensionDescription, IExtHostContext, ExtHostNotebookShape, ExtHostContext, INotebookDocumentsAndEditorsDelta, INotebookModelAddedData } from '../common/extHost.protocol';
import { Disposable, IDisposable, combinedDisposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { INotebookService, IMainNotebookController } from 'vs/workbench/contrib/notebook/common/notebookService';
import { INotebookTextModel, INotebookMimeTypeSelector, NOTEBOOK_DISPLAY_ORDER, NotebookCellOutputsSplice, NotebookDocumentMetadata, NotebookCellMetadata, ICellEditOperation, ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER, CellEditType, CellKind, INotebookKernelInfo, INotebookKernelInfoDto, INotebookTextModelBackup, IEditor, INotebookRendererInfo, IOutputRenderRequest, IOutputRenderResponse, INotebookDocumentFilter } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IRelativePattern } from 'vs/base/common/glob';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IUndoRedoService, UndoRedoElementType } from 'vs/platform/undoRedo/common/undoRedo';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { Emitter } from 'vs/base/common/event';

export class MainThreadNotebookDocument extends Disposable {
	private _textModel: NotebookTextModel;

	get textModel() {
		return this._textModel;
	}

	constructor(
		private readonly _proxy: ExtHostNotebookShape,
		public handle: number,
		public viewType: string,
		public supportBackup: boolean,
		public uri: URI,
		@INotebookService readonly notebookService: INotebookService,
		@IUndoRedoService readonly undoRedoService: IUndoRedoService,
		@ITextModelService modelService: ITextModelService

	) {
		super();

		this._textModel = new NotebookTextModel(handle, viewType, supportBackup, uri, undoRedoService, modelService);
		this._register(this._textModel.onDidModelChangeProxy(e => {
			this._proxy.$acceptModelChanged(this.uri, e);
			this._proxy.$acceptEditorPropertiesChanged(uri, { selections: { selections: this._textModel.selections }, metadata: null });
		}));
		this._register(this._textModel.onDidSelectionChange(e => {
			const selectionsChange = e ? { selections: e } : null;
			this._proxy.$acceptEditorPropertiesChanged(uri, { selections: selectionsChange, metadata: null });
		}));
	}

	async applyEdit(modelVersionId: number, edits: ICellEditOperation[], emitToExtHost: boolean, synchronous: boolean): Promise<boolean> {
		await this.notebookService.transformEditsOutputs(this.textModel, edits);
		if (synchronous) {
			return this._textModel.$applyEdit(modelVersionId, edits, emitToExtHost, synchronous);
		} else {
			return new Promise(resolve => {
				this._register(DOM.scheduleAtNextAnimationFrame(() => {
					const ret = this._textModel.$applyEdit(modelVersionId, edits, emitToExtHost, true);
					resolve(ret);
				}));
			});
		}
	}

	async spliceNotebookCellOutputs(cellHandle: number, splices: NotebookCellOutputsSplice[]) {
		await this.notebookService.transformSpliceOutputs(this.textModel, splices);
		this._textModel.$spliceNotebookCellOutputs(cellHandle, splices);
	}

	handleEdit(editId: number, label: string | undefined): void {
		this.undoRedoService.pushElement({
			type: UndoRedoElementType.Resource,
			resource: this._textModel.uri,
			label: label ?? nls.localize('defaultEditLabel', "Edit"),
			undo: async () => {
				await this._proxy.$undoNotebook(this._textModel.viewType, this._textModel.uri, editId, this._textModel.isDirty);
			},
			redo: async () => {
				await this._proxy.$redoNotebook(this._textModel.viewType, this._textModel.uri, editId, this._textModel.isDirty);
			},
		});
		this._textModel.setDirty(true);
	}

	dispose() {
		this._textModel.dispose();
		super.dispose();
	}
}

class DocumentAndEditorState {
	static ofSets<T>(before: Set<T>, after: Set<T>): { removed: T[], added: T[] } {
		const removed: T[] = [];
		const added: T[] = [];
		before.forEach(element => {
			if (!after.has(element)) {
				removed.push(element);
			}
		});
		after.forEach(element => {
			if (!before.has(element)) {
				added.push(element);
			}
		});
		return { removed, added };
	}

	static ofMaps<K, V>(before: Map<K, V>, after: Map<K, V>): { removed: V[], added: V[] } {
		const removed: V[] = [];
		const added: V[] = [];
		before.forEach((value, index) => {
			if (!after.has(index)) {
				removed.push(value);
			}
		});
		after.forEach((value, index) => {
			if (!before.has(index)) {
				added.push(value);
			}
		});
		return { removed, added };
	}

	static compute(before: DocumentAndEditorState | undefined, after: DocumentAndEditorState): INotebookDocumentsAndEditorsDelta {
		if (!before) {
			const apiEditors = [];
			for (let id in after.textEditors) {
				const editor = after.textEditors.get(id)!;
				apiEditors.push({ id, documentUri: editor.uri!, selections: editor!.textModel!.selections });
			}

			return {
				addedDocuments: [],
				addedEditors: apiEditors,
				visibleEditors: [...after.visibleEditors].map(editor => editor[0])
			};
		}
		const documentDelta = DocumentAndEditorState.ofSets(before.documents, after.documents);
		const editorDelta = DocumentAndEditorState.ofMaps(before.textEditors, after.textEditors);
		const addedAPIEditors = editorDelta.added.map(add => ({
			id: add.getId(),
			documentUri: add.uri!,
			selections: add.textModel!.selections || []
		}));

		const removedAPIEditors = editorDelta.removed.map(removed => removed.getId());

		// const oldActiveEditor = before.activeEditor !== after.activeEditor ? before.activeEditor : undefined;
		const newActiveEditor = before.activeEditor !== after.activeEditor ? after.activeEditor : undefined;

		const visibleEditorDelta = DocumentAndEditorState.ofMaps(before.visibleEditors, after.visibleEditors);

		return {
			addedDocuments: documentDelta.added.map(e => {
				return {
					viewType: e.viewType,
					handle: e.handle,
					uri: e.uri,
					metadata: e.metadata,
					versionId: e.versionId,
					cells: e.cells.map(cell => ({
						handle: cell.handle,
						uri: cell.uri,
						source: cell.textBuffer.getLinesContent(),
						eol: cell.textBuffer.getEOL(),
						language: cell.language,
						cellKind: cell.cellKind,
						outputs: cell.outputs,
						metadata: cell.metadata
					})),
					// attachedEditor: editorId ? {
					// 	id: editorId,
					// 	selections: document.textModel.selections
					// } : undefined
				};
			}),
			removedDocuments: documentDelta.removed.map(e => e.uri),
			addedEditors: addedAPIEditors,
			removedEditors: removedAPIEditors,
			newActiveEditor: newActiveEditor,
			visibleEditors: visibleEditorDelta.added.length === 0 && visibleEditorDelta.removed.length === 0
				? undefined
				: [...after.visibleEditors].map(editor => editor[0])
		};
	}

	constructor(
		readonly documents: Set<NotebookTextModel>,
		readonly textEditors: Map<string, IEditor>,
		readonly activeEditor: string | null | undefined,
		readonly visibleEditors: Map<string, IEditor>
	) {
		//
	}
}

@extHostNamedCustomer(MainContext.MainThreadNotebook)
export class MainThreadNotebooks extends Disposable implements MainThreadNotebookShape {
	private readonly _notebookProviders = new Map<string, MainThreadNotebookController>();
	private readonly _notebookKernels = new Map<string, MainThreadNotebookKernel>();
	private readonly _notebookKernelProviders = new Map<number, { extension: NotebookExtensionDescription, emitter: Emitter<void>, provider: IDisposable }>();
	private readonly _notebookRenderers = new Map<string, MainThreadNotebookRenderer>();
	private readonly _proxy: ExtHostNotebookShape;
	private _toDisposeOnEditorRemove = new Map<string, IDisposable>();
	private _currentState?: DocumentAndEditorState;

	constructor(
		extHostContext: IExtHostContext,
		@INotebookService private _notebookService: INotebookService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService

	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostNotebook);
		this.registerListeners();
	}

	async $tryApplyEdits(viewType: string, resource: UriComponents, modelVersionId: number, edits: ICellEditOperation[], renderers: number[]): Promise<boolean> {
		let controller = this._notebookProviders.get(viewType);

		if (controller) {
			return controller.tryApplyEdits(resource, modelVersionId, edits, renderers);
		}

		return false;
	}

	private _isDeltaEmpty(delta: INotebookDocumentsAndEditorsDelta) {
		if (delta.addedDocuments !== undefined && delta.addedDocuments.length > 0) {
			return false;
		}

		if (delta.removedDocuments !== undefined && delta.removedDocuments.length > 0) {
			return false;
		}

		if (delta.addedEditors !== undefined && delta.addedEditors.length > 0) {
			return false;
		}

		if (delta.removedEditors !== undefined && delta.removedEditors.length > 0) {
			return false;
		}

		if (delta.visibleEditors !== undefined && delta.visibleEditors.length > 0) {
			return false;
		}

		if (delta.newActiveEditor !== undefined) {
			return false;
		}

		return true;
	}

	private _emitDelta(delta: INotebookDocumentsAndEditorsDelta) {
		if (this._isDeltaEmpty(delta)) {
			return;
		}

		return this._proxy.$acceptDocumentAndEditorsDelta(delta);
	}

	registerListeners() {
		this._notebookService.listNotebookEditors().forEach((e) => {
			this._addNotebookEditor(e);
		});

		this._register(this._notebookService.onDidChangeActiveEditor(e => {
			this._updateState();
		}));

		this._register(this._notebookService.onDidChangeVisibleEditors(e => {
			if (this._notebookProviders.size > 0) {
				if (!this._currentState) {
					// no current state means we didn't even create editors in ext host yet.
					return;
				}

				// we can't simply update visibleEditors as we need to check if we should create editors first.
				this._updateState();
			}
		}));

		this._register(this._notebookService.onNotebookEditorAdd(editor => {
			this._addNotebookEditor(editor);
		}));

		this._register(this._notebookService.onNotebookEditorsRemove(editors => {
			this._removeNotebookEditor(editors);
		}));

		this._register(this._notebookService.onNotebookDocumentAdd(() => {
			this._updateState();
		}));

		this._register(this._notebookService.onNotebookDocumentRemove(() => {
			this._updateState();
		}));

		this._register(this._notebookService.onDidChangeNotebookActiveKernel(e => {
			this._proxy.$acceptNotebookActiveKernelChange(e);
		}));

		const updateOrder = () => {
			let userOrder = this.configurationService.getValue<string[]>('notebook.displayOrder');
			this._proxy.$acceptDisplayOrder({
				defaultOrder: this.accessibilityService.isScreenReaderOptimized() ? ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER : NOTEBOOK_DISPLAY_ORDER,
				userOrder: userOrder
			});
		};

		updateOrder();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectedKeys.indexOf('notebook.displayOrder') >= 0) {
				updateOrder();
			}
		}));

		this._register(this.accessibilityService.onDidChangeScreenReaderOptimized(() => {
			updateOrder();
		}));

		const activeEditorPane = this.editorService.activeEditorPane as any | undefined;
		const notebookEditor = activeEditorPane?.isNotebookEditor ? activeEditorPane.getControl() : undefined;
		this._updateState(notebookEditor);
	}

	async addNotebookDocument(data: INotebookModelAddedData) {
		this._updateState();
	}

	private _addNotebookEditor(e: IEditor) {
		this._toDisposeOnEditorRemove.set(e.getId(), combinedDisposable(
			e.onDidChangeModel(() => this._updateState()),
			e.onDidFocusEditorWidget(() => {
				this._updateState(e);
			}),
		));

		const activeEditorPane = this.editorService.activeEditorPane as any | undefined;
		const notebookEditor = activeEditorPane?.isNotebookEditor ? activeEditorPane.getControl() : undefined;
		this._updateState(notebookEditor);
	}

	private _removeNotebookEditor(editors: IEditor[]) {
		editors.forEach(e => {
			const sub = this._toDisposeOnEditorRemove.get(e.getId());
			if (sub) {
				this._toDisposeOnEditorRemove.delete(e.getId());
				sub.dispose();
			}
		});

		this._updateState();
	}

	private async _updateState(focusedNotebookEditor?: IEditor) {
		let activeEditor: string | null = null;

		const activeEditorPane = this.editorService.activeEditorPane as any | undefined;
		if (activeEditorPane?.isNotebookEditor) {
			const notebookEditor = (activeEditorPane.getControl() as INotebookEditor);
			activeEditor = notebookEditor && notebookEditor.hasModel() ? notebookEditor!.getId() : null;
		}

		const documentEditorsMap = new Map<string, IEditor>();

		const editors = new Map<string, IEditor>();
		this._notebookService.listNotebookEditors().forEach(editor => {
			if (editor.hasModel()) {
				editors.set(editor.getId(), editor);
				documentEditorsMap.set(editor.textModel!.uri.toString(), editor);
			}
		});

		const visibleEditorsMap = new Map<string, IEditor>();
		this.editorService.visibleEditorPanes.forEach(editor => {
			if ((editor as any).isNotebookEditor) {
				const nbEditorWidget = (editor as any).getControl() as INotebookEditor;
				if (nbEditorWidget && editors.has(nbEditorWidget.getId())) {
					visibleEditorsMap.set(nbEditorWidget.getId(), nbEditorWidget);
				}
			}
		});

		const documents = new Set<NotebookTextModel>();
		this._notebookService.listNotebookDocuments().forEach(document => {
			documents.add(document);
		});

		if (!activeEditor && focusedNotebookEditor && focusedNotebookEditor.hasModel()) {
			activeEditor = focusedNotebookEditor.getId();
		}

		// editors always have view model attached, which means there is already a document in exthost.
		const newState = new DocumentAndEditorState(documents, editors, activeEditor, visibleEditorsMap);
		const delta = DocumentAndEditorState.compute(this._currentState, newState);
		// const isEmptyChange = (!delta.addedDocuments || delta.addedDocuments.length === 0)
		// 	&& (!delta.removedDocuments || delta.removedDocuments.length === 0)
		// 	&& (!delta.addedEditors || delta.addedEditors.length === 0)
		// 	&& (!delta.removedEditors || delta.removedEditors.length === 0)
		// 	&& (delta.newActiveEditor === undefined)

		// if (!isEmptyChange) {
		this._currentState = newState;
		await this._emitDelta(delta);
		// }
	}

	async $registerNotebookRenderer(extension: NotebookExtensionDescription, type: string, selectors: INotebookMimeTypeSelector, preloads: UriComponents[]): Promise<void> {
		const renderer = new MainThreadNotebookRenderer(this._proxy, type, extension.id, URI.revive(extension.location), selectors, preloads.map(uri => URI.revive(uri)));
		this._notebookRenderers.set(type, renderer);
		this._notebookService.registerNotebookRenderer(type, renderer);
	}

	async $unregisterNotebookRenderer(id: string): Promise<void> {
		this._notebookService.unregisterNotebookRenderer(id);
	}

	async $registerNotebookProvider(extension: NotebookExtensionDescription, viewType: string, supportBackup: boolean, kernel: INotebookKernelInfoDto | undefined): Promise<void> {
		let controller = new MainThreadNotebookController(this._proxy, this, viewType, supportBackup, kernel, this._notebookService, this._instantiationService);
		this._notebookProviders.set(viewType, controller);
		this._notebookService.registerNotebookController(viewType, extension, controller);
		return;
	}

	async $onNotebookChange(viewType: string, uri: UriComponents): Promise<void> {
		let controller = this._notebookProviders.get(viewType);
		if (controller) {
			controller.handleNotebookChange(uri);
		}
	}

	async $unregisterNotebookProvider(viewType: string): Promise<void> {
		this._notebookProviders.delete(viewType);
		this._notebookService.unregisterNotebookProvider(viewType);
		return;
	}

	async $registerNotebookKernel(extension: NotebookExtensionDescription, id: string, label: string, selectors: (string | IRelativePattern)[], preloads: UriComponents[]): Promise<void> {
		const kernel = new MainThreadNotebookKernel(this._proxy, id, label, selectors, extension.id, URI.revive(extension.location), preloads.map(preload => URI.revive(preload)));
		this._notebookKernels.set(id, kernel);
		this._notebookService.registerNotebookKernel(kernel);
		return;
	}

	async $unregisterNotebookKernel(id: string): Promise<void> {
		this._notebookKernels.delete(id);
		this._notebookService.unregisterNotebookKernel(id);
		return;
	}

	async $registerNotebookKernelProvider(extension: NotebookExtensionDescription, handle: number, documentFilter: INotebookDocumentFilter): Promise<void> {
		const emitter = new Emitter<void>();
		const that = this;
		const provider = this._notebookService.registerNotebookKernelProvider({
			onDidChangeKernels: emitter.event,
			selector: documentFilter,
			provideKernels: async (uri: URI, token: CancellationToken) => {
				const kernels = await that._proxy.$provideNotebookKernels(handle, uri, token);
				return kernels.map(kernel => {
					return {
						...kernel,
						providerHandle: handle
					};
				});
			},
			resolveKernel: (editorId: string, uri: URI, kernelId: string, token: CancellationToken) => {
				return that._proxy.$resolveNotebookKernel(handle, editorId, uri, kernelId, token);
			},
			executeNotebook: (uri: URI, kernelId: string, cellHandle: number | undefined, token: CancellationToken) => {
				return that._proxy.$executeNotebookKernelFromProvider(handle, uri, kernelId, cellHandle, token);
			}
		});
		this._notebookKernelProviders.set(handle, {
			extension,
			emitter,
			provider
		});

		return;
	}

	async $unregisterNotebookKernelProvider(handle: number): Promise<void> {
		const entry = this._notebookKernelProviders.get(handle);

		if (entry) {
			entry.emitter.dispose();
			entry.provider.dispose();
			this._notebookKernelProviders.delete(handle);
		}
	}

	$onNotebookKernelChange(handle: number): void {
		const entry = this._notebookKernelProviders.get(handle);

		entry?.emitter.fire();
	}

	async $updateNotebookLanguages(viewType: string, resource: UriComponents, languages: string[]): Promise<void> {
		let controller = this._notebookProviders.get(viewType);

		if (controller) {
			controller.updateLanguages(resource, languages);
		}
	}

	async $updateNotebookMetadata(viewType: string, resource: UriComponents, metadata: NotebookDocumentMetadata): Promise<void> {
		let controller = this._notebookProviders.get(viewType);

		if (controller) {
			controller.updateNotebookMetadata(resource, metadata);
		}
	}

	async $updateNotebookCellMetadata(viewType: string, resource: UriComponents, handle: number, metadata: NotebookCellMetadata): Promise<void> {
		let controller = this._notebookProviders.get(viewType);

		if (controller) {
			controller.updateNotebookCellMetadata(resource, handle, metadata);
		}
	}

	async $spliceNotebookCellOutputs(viewType: string, resource: UriComponents, cellHandle: number, splices: NotebookCellOutputsSplice[], renderers: number[]): Promise<void> {
		let controller = this._notebookProviders.get(viewType);
		await controller?.spliceNotebookCellOutputs(resource, cellHandle, splices, renderers);
	}

	async executeNotebookByAttachedKernel(viewType: string, uri: URI, token: CancellationToken): Promise<void> {
		return this._proxy.$executeNotebookByAttachedKernel(viewType, uri, undefined, token);
	}

	async $postMessage(editorId: string, forRendererId: string | undefined, value: any): Promise<boolean> {
		const editor = this._notebookService.getNotebookEditor(editorId) as INotebookEditor | undefined;
		if (editor?.isNotebookEditor) {
			editor.postMessage(forRendererId, value);
			return true;
		}

		return false;
	}

	$onDidEdit(resource: UriComponents, viewType: string, editId: number, label: string | undefined): void {
		let controller = this._notebookProviders.get(viewType);
		controller?.handleEdit(resource, editId, label);
	}

	$onContentChange(resource: UriComponents, viewType: string): void {
		let controller = this._notebookProviders.get(viewType);
		controller?.handleNotebookChange(resource);
	}
}

export class MainThreadNotebookController implements IMainNotebookController {
	private _mapping: Map<string, MainThreadNotebookDocument> = new Map();
	static documentHandle: number = 0;

	constructor(
		private readonly _proxy: ExtHostNotebookShape,
		private _mainThreadNotebook: MainThreadNotebooks,
		private _viewType: string,
		private _supportBackup: boolean,
		readonly kernel: INotebookKernelInfoDto | undefined,
		readonly notebookService: INotebookService,
		readonly _instantiationService: IInstantiationService

	) {
	}

	async createNotebook(viewType: string, uri: URI, backup: INotebookTextModelBackup | undefined, forceReload: boolean, editorId?: string, backupId?: string): Promise<NotebookTextModel | undefined> {
		let mainthreadNotebook = this._mapping.get(URI.from(uri).toString());

		if (mainthreadNotebook) {
			if (forceReload) {
				const data = await this._proxy.$resolveNotebookData(viewType, uri);
				if (!data) {
					return;
				}

				mainthreadNotebook.textModel.languages = data.languages;
				mainthreadNotebook.textModel.metadata = data.metadata;
				await mainthreadNotebook.applyEdit(mainthreadNotebook.textModel.versionId, [
					{ editType: CellEditType.Delete, count: mainthreadNotebook.textModel.cells.length, index: 0 },
					{ editType: CellEditType.Insert, index: 0, cells: data.cells }
				], true, false);
			}
			return mainthreadNotebook.textModel;
		}

		let document = this._instantiationService.createInstance(MainThreadNotebookDocument, this._proxy, MainThreadNotebookController.documentHandle++, viewType, this._supportBackup, uri);
		this._mapping.set(document.uri.toString(), document);

		if (backup) {
			// trigger events
			document.textModel.metadata = backup.metadata;
			document.textModel.languages = backup.languages;

			// restored from backup, update the text model without emitting any event to exthost
			await document.applyEdit(document.textModel.versionId, [
				{
					editType: CellEditType.Insert,
					index: 0,
					cells: backup.cells || []
				}
			], false, true);

			// create document in ext host with cells data
			await this._mainThreadNotebook.addNotebookDocument({
				viewType: document.viewType,
				handle: document.handle,
				uri: document.uri,
				metadata: document.textModel.metadata,
				versionId: document.textModel.versionId,
				cells: document.textModel.cells.map(cell => ({
					handle: cell.handle,
					uri: cell.uri,
					source: cell.textBuffer.getLinesContent(),
					eol: cell.textBuffer.getEOL(),
					language: cell.language,
					cellKind: cell.cellKind,
					outputs: cell.outputs,
					metadata: cell.metadata
				})),
				attachedEditor: editorId ? {
					id: editorId,
					selections: document.textModel.selections
				} : undefined
			});

			return document.textModel;
		}

		// open notebook document
		const data = await this._proxy.$resolveNotebookData(viewType, uri, backupId);
		if (!data) {
			return;
		}

		document.textModel.languages = data.languages;
		document.textModel.metadata = data.metadata;

		if (data.cells.length) {
			document.textModel.initialize(data!.cells);
		} else {
			const mainCell = document.textModel.createCellTextModel([''], document.textModel.languages.length ? document.textModel.languages[0] : '', CellKind.Code, [], undefined);
			document.textModel.insertTemplateCell(mainCell);
		}

		await this._mainThreadNotebook.addNotebookDocument({
			viewType: document.viewType,
			handle: document.handle,
			uri: document.uri,
			metadata: document.textModel.metadata,
			versionId: document.textModel.versionId,
			cells: document.textModel.cells.map(cell => ({
				handle: cell.handle,
				uri: cell.uri,
				source: cell.textBuffer.getLinesContent(),
				eol: cell.textBuffer.getEOL(),
				language: cell.language,
				cellKind: cell.cellKind,
				outputs: cell.outputs,
				metadata: cell.metadata
			})),
			attachedEditor: editorId ? {
				id: editorId,
				selections: document.textModel.selections
			} : undefined
		});

		this._proxy.$acceptEditorPropertiesChanged(uri, { selections: null, metadata: document.textModel.metadata });

		return document.textModel;
	}

	async resolveNotebookEditor(viewType: string, uri: URI, editorId: string) {
		await this._proxy.$resolveNotebookEditor(viewType, uri, editorId);
	}

	async tryApplyEdits(resource: UriComponents, modelVersionId: number, edits: ICellEditOperation[], renderers: number[]): Promise<boolean> {
		let mainthreadNotebook = this._mapping.get(URI.from(resource).toString());

		if (mainthreadNotebook) {
			return await mainthreadNotebook.applyEdit(modelVersionId, edits, true, true);
		}

		return false;
	}

	async spliceNotebookCellOutputs(resource: UriComponents, cellHandle: number, splices: NotebookCellOutputsSplice[], renderers: number[]): Promise<void> {
		let mainthreadNotebook = this._mapping.get(URI.from(resource).toString());
		await mainthreadNotebook?.spliceNotebookCellOutputs(cellHandle, splices);
	}

	async executeNotebookByAttachedKernel(viewType: string, uri: URI, token: CancellationToken): Promise<void> {
		return this._mainThreadNotebook.executeNotebookByAttachedKernel(viewType, uri, token);
	}

	onDidReceiveMessage(editorId: string, rendererType: string | undefined, message: unknown): void {
		this._proxy.$onDidReceiveMessage(editorId, rendererType, message);
	}

	async removeNotebookDocument(notebook: INotebookTextModel): Promise<void> {
		let document = this._mapping.get(URI.from(notebook.uri).toString());

		if (!document) {
			return;
		}

		// TODO@rebornix, remove cell should use emitDelta as well to ensure document/editor events are sent together
		await this._proxy.$acceptDocumentAndEditorsDelta({ removedDocuments: [notebook.uri] });
		document.dispose();
		this._mapping.delete(URI.from(notebook.uri).toString());
	}

	// Methods for ExtHost

	handleNotebookChange(resource: UriComponents) {
		let document = this._mapping.get(URI.from(resource).toString());
		document?.textModel.handleUnknownChange();
	}

	handleEdit(resource: UriComponents, editId: number, label: string | undefined): void {
		let document = this._mapping.get(URI.from(resource).toString());
		document?.handleEdit(editId, label);
	}

	updateLanguages(resource: UriComponents, languages: string[]) {
		let document = this._mapping.get(URI.from(resource).toString());
		document?.textModel.updateLanguages(languages);
	}

	updateNotebookMetadata(resource: UriComponents, metadata: NotebookDocumentMetadata) {
		let document = this._mapping.get(URI.from(resource).toString());
		document?.textModel.updateNotebookMetadata(metadata);
	}

	updateNotebookCellMetadata(resource: UriComponents, handle: number, metadata: NotebookCellMetadata) {
		let document = this._mapping.get(URI.from(resource).toString());
		document?.textModel.updateNotebookCellMetadata(handle, metadata);
	}

	async executeNotebookCell(uri: URI, handle: number, token: CancellationToken): Promise<void> {
		return this._proxy.$executeNotebookByAttachedKernel(this._viewType, uri, handle, token);
	}

	async save(uri: URI, token: CancellationToken): Promise<boolean> {
		return this._proxy.$saveNotebook(this._viewType, uri, token);
	}

	async saveAs(uri: URI, target: URI, token: CancellationToken): Promise<boolean> {
		return this._proxy.$saveNotebookAs(this._viewType, uri, target, token);
	}

	async backup(uri: URI, token: CancellationToken): Promise<string | undefined> {
		const backupId = await this._proxy.$backup(this._viewType, uri, token);
		return backupId;
	}
}

export class MainThreadNotebookKernel implements INotebookKernelInfo {
	constructor(
		private readonly _proxy: ExtHostNotebookShape,
		readonly id: string,
		readonly label: string,
		readonly selectors: (string | IRelativePattern)[],
		readonly extension: ExtensionIdentifier,
		readonly extensionLocation: URI,
		readonly preloads: URI[]
	) {
	}

	async executeNotebook(viewType: string, uri: URI, handle: number | undefined, token: CancellationToken): Promise<void> {
		return this._proxy.$executeNotebook2(this.id, viewType, uri, handle, token);
	}
}

export class MainThreadNotebookRenderer implements INotebookRendererInfo {
	constructor(
		private readonly _proxy: ExtHostNotebookShape,
		readonly id: string,
		readonly extensionId: ExtensionIdentifier,
		readonly extensionLocation: URI,
		readonly selectors: INotebookMimeTypeSelector,
		readonly preloads: URI[]
	) {

	}

	render(uri: URI, request: IOutputRenderRequest<UriComponents>): Promise<IOutputRenderResponse<UriComponents> | undefined> {
		return this._proxy.$renderOutputs(uri, this.id, request);
	}

	render2<T>(uri: URI, request: IOutputRenderRequest<T>): Promise<IOutputRenderResponse<T> | undefined> {
		return this._proxy.$renderOutputs2(uri, this.id, request);
	}
}
