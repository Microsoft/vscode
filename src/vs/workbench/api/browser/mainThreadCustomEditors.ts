/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { multibyteAwareBtoa } from 'vs/base/browser/dom';
import { CancelablePromise, createCancelablePromise, timeout } from 'vs/base/common/async';
import { VSBuffer } from 'vs/base/common/buffer';
import { CancellationToken } from 'vs/base/common/cancellation';
import { isPromiseCanceledError, onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, dispose, IDisposable, IReference } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { basename } from 'vs/base/common/path';
import { isEqual, isEqualOrParent, toLocalResource } from 'vs/base/common/resources';
import { URI, UriComponents } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { FileChangesEvent, FileChangeType, FileSystemProviderCapabilities, IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { IUndoRedoService, UndoRedoElementType } from 'vs/platform/undoRedo/common/undoRedo';
import { MainThreadWebviewPanels } from 'vs/workbench/api/browser/mainThreadWebviewPanels';
import { MainThreadWebviews, reviveWebviewExtension } from 'vs/workbench/api/browser/mainThreadWebviews';
import * as extHostProtocol from 'vs/workbench/api/common/extHost.protocol';
import { editorGroupToViewColumn, IRevertOptions, ISaveOptions } from 'vs/workbench/common/editor';
import { CustomEditorInput } from 'vs/workbench/contrib/customEditor/browser/customEditorInput';
import { CustomDocumentBackupData } from 'vs/workbench/contrib/customEditor/browser/customEditorInputFactory';
import { ICustomEditorModel, ICustomEditorService } from 'vs/workbench/contrib/customEditor/common/customEditor';
import { CustomTextEditorModel } from 'vs/workbench/contrib/customEditor/common/customTextEditorModel';
import { WebviewExtensionDescription } from 'vs/workbench/contrib/webview/browser/webview';
import { WebviewInput } from 'vs/workbench/contrib/webviewPanel/browser/webviewEditorInput';
import { IWebviewWorkbenchService } from 'vs/workbench/contrib/webviewPanel/browser/webviewWorkbenchService';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IWorkingCopy, IWorkingCopyBackup, NO_TYPE_ID, WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopy';

const enum CustomEditorModelType {
	Custom,
	Text,
}

export class MainThreadCustomEditors extends Disposable implements extHostProtocol.MainThreadCustomEditorsShape {

	private readonly _proxyCustomEditors: extHostProtocol.ExtHostCustomEditorsShape;

	private readonly _editorProviders = new Map<string, IDisposable>();

	constructor(
		context: extHostProtocol.IExtHostContext,
		private readonly mainThreadWebview: MainThreadWebviews,
		private readonly mainThreadWebviewPanels: MainThreadWebviewPanels,
		@IExtensionService extensionService: IExtensionService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@IWorkingCopyFileService workingCopyFileService: IWorkingCopyFileService,
		@ICustomEditorService private readonly _customEditorService: ICustomEditorService,
		@IEditorGroupsService private readonly _editorGroupService: IEditorGroupsService,
		@IWebviewWorkbenchService private readonly _webviewWorkbenchService: IWebviewWorkbenchService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();

		this._proxyCustomEditors = context.getProxy(extHostProtocol.ExtHostContext.ExtHostCustomEditors);

		this._register(workingCopyFileService.registerWorkingCopyProvider((editorResource) => {
			const matchedWorkingCopies: IWorkingCopy[] = [];

			for (const workingCopy of workingCopyService.workingCopies) {
				if (workingCopy instanceof MainThreadCustomEditorModel) {
					if (isEqualOrParent(editorResource, workingCopy.editorResource)) {
						matchedWorkingCopies.push(workingCopy);
					}
				}
			}
			return matchedWorkingCopies;
		}));

		// This reviver's only job is to activate custom editor extensions.
		this._register(_webviewWorkbenchService.registerResolver({
			canResolve: (webview: WebviewInput) => {
				if (webview instanceof CustomEditorInput) {
					extensionService.activateByEvent(`onCustomEditor:${webview.viewType}`);
				}
				return false;
			},
			resolveWebview: () => { throw new Error('not implemented'); }
		}));
	}

	override dispose() {
		super.dispose();

		dispose(this._editorProviders.values());
		this._editorProviders.clear();
	}

	public $registerTextEditorProvider(extensionData: extHostProtocol.WebviewExtensionDescription, viewType: string, options: extHostProtocol.IWebviewPanelOptions, capabilities: extHostProtocol.CustomTextEditorCapabilities, serializeBuffersForPostMessage: boolean): void {
		this.registerEditorProvider(CustomEditorModelType.Text, reviveWebviewExtension(extensionData), viewType, options, capabilities, true, serializeBuffersForPostMessage);
	}

	public $registerCustomEditorProvider(extensionData: extHostProtocol.WebviewExtensionDescription, viewType: string, options: extHostProtocol.IWebviewPanelOptions, supportsMultipleEditorsPerDocument: boolean, serializeBuffersForPostMessage: boolean): void {
		this.registerEditorProvider(CustomEditorModelType.Custom, reviveWebviewExtension(extensionData), viewType, options, {}, supportsMultipleEditorsPerDocument, serializeBuffersForPostMessage);
	}

	private registerEditorProvider(
		modelType: CustomEditorModelType,
		extension: WebviewExtensionDescription,
		viewType: string,
		options: extHostProtocol.IWebviewPanelOptions,
		capabilities: extHostProtocol.CustomTextEditorCapabilities,
		supportsMultipleEditorsPerDocument: boolean,
		serializeBuffersForPostMessage: boolean,
	): void {
		if (this._editorProviders.has(viewType)) {
			throw new Error(`Provider for ${viewType} already registered`);
		}

		const disposables = new DisposableStore();

		disposables.add(this._customEditorService.registerCustomEditorCapabilities(viewType, {
			supportsMultipleEditorsPerDocument
		}));

		disposables.add(this._webviewWorkbenchService.registerResolver({
			canResolve: (webviewInput) => {
				return webviewInput instanceof CustomEditorInput && webviewInput.viewType === viewType;
			},
			resolveWebview: async (webviewInput: CustomEditorInput, cancellation: CancellationToken) => {
				const handle = webviewInput.id;
				const resource = webviewInput.resource;

				this.mainThreadWebviewPanels.addWebviewInput(handle, webviewInput, { serializeBuffersForPostMessage });
				webviewInput.webview.options = options;
				webviewInput.webview.extension = extension;

				let modelRef: IReference<ICustomEditorModel>;
				try {
					modelRef = await this.getOrCreateCustomEditorModel(modelType, resource, viewType, { backupId: webviewInput.backupId }, cancellation);
				} catch (error) {
					onUnexpectedError(error);
					webviewInput.webview.html = this.mainThreadWebview.getWebviewResolvedFailedContent(viewType);
					return;
				}

				if (cancellation.isCancellationRequested) {
					modelRef.dispose();
					return;
				}

				webviewInput.webview.onDidDispose(() => {
					// If the model is still dirty, make sure we have time to save it
					if (modelRef.object.isDirty()) {
						const sub = modelRef.object.onDidChangeDirty(() => {
							if (!modelRef.object.isDirty()) {
								sub.dispose();
								modelRef.dispose();
							}
						});
						return;
					}

					modelRef.dispose();
				});

				if (capabilities.supportsMove) {
					webviewInput.onMove(async (newResource: URI) => {
						const oldModel = modelRef;
						modelRef = await this.getOrCreateCustomEditorModel(modelType, newResource, viewType, {}, CancellationToken.None);
						this._proxyCustomEditors.$onMoveCustomEditor(handle, newResource, viewType);
						oldModel.dispose();
					});
				}

				try {
					await this._proxyCustomEditors.$resolveWebviewEditor(resource, handle, viewType, {
						title: webviewInput.getTitle(),
						webviewOptions: webviewInput.webview.contentOptions,
						panelOptions: webviewInput.webview.options,
					}, editorGroupToViewColumn(this._editorGroupService, webviewInput.group || 0), cancellation);
				} catch (error) {
					onUnexpectedError(error);
					webviewInput.webview.html = this.mainThreadWebview.getWebviewResolvedFailedContent(viewType);
					modelRef.dispose();
					return;
				}
			}
		}));

		this._editorProviders.set(viewType, disposables);
	}

	public $unregisterEditorProvider(viewType: string): void {
		const provider = this._editorProviders.get(viewType);
		if (!provider) {
			throw new Error(`No provider for ${viewType} registered`);
		}

		provider.dispose();
		this._editorProviders.delete(viewType);

		this._customEditorService.models.disposeAllModelsForView(viewType);
	}

	private async getOrCreateCustomEditorModel(
		modelType: CustomEditorModelType,
		resource: URI,
		viewType: string,
		options: { backupId?: string },
		cancellation: CancellationToken,
	): Promise<IReference<ICustomEditorModel>> {
		const existingModel = this._customEditorService.models.tryRetain(resource, viewType);
		if (existingModel) {
			return existingModel;
		}

		switch (modelType) {
			case CustomEditorModelType.Text:
				{
					const model = CustomTextEditorModel.create(this._instantiationService, viewType, resource);
					return this._customEditorService.models.add(resource, viewType, model);
				}
			case CustomEditorModelType.Custom:
				{
					const model = MainThreadCustomEditorModel.create(this._instantiationService, this._proxyCustomEditors, viewType, resource, options, () => {
						return Array.from(this.mainThreadWebviewPanels.webviewInputs)
							.filter(editor => editor instanceof CustomEditorInput && isEqual(editor.resource, resource)) as CustomEditorInput[];
					}, cancellation);
					return this._customEditorService.models.add(resource, viewType, model);
				}
		}
	}

	public async $onDidEdit(resourceComponents: UriComponents, viewType: string, editId: number, label: string | undefined): Promise<void> {
		const model = await this.getCustomEditorModel(resourceComponents, viewType);
		model.pushEdit(editId, label);
	}

	public async $onContentChange(resourceComponents: UriComponents, viewType: string): Promise<void> {
		const model = await this.getCustomEditorModel(resourceComponents, viewType);
		model.changeContent();
	}

	private async getCustomEditorModel(resourceComponents: UriComponents, viewType: string) {
		const resource = URI.revive(resourceComponents);
		const model = await this._customEditorService.models.get(resource, viewType);
		if (!model || !(model instanceof MainThreadCustomEditorModel)) {
			throw new Error('Could not find model for webview editor');
		}
		return model;
	}
}

namespace HotExitState {
	export const enum Type {
		Allowed,
		NotAllowed,
		Pending,
	}

	export const Allowed = Object.freeze({ type: Type.Allowed } as const);
	export const NotAllowed = Object.freeze({ type: Type.NotAllowed } as const);

	export class Pending {
		readonly type = Type.Pending;

		constructor(
			public readonly operation: CancelablePromise<string>,
		) { }
	}

	export type State = typeof Allowed | typeof NotAllowed | Pending;
}


class MainThreadCustomEditorModel extends Disposable implements ICustomEditorModel, IWorkingCopy {

	#isDisposed = false;

	private _fromBackup: boolean = false;
	private _hotExitState: HotExitState.State = HotExitState.Allowed;
	private _backupId: string | undefined;

	private _currentEditIndex: number = -1;
	private _savePoint: number = -1;
	private readonly _edits: Array<number> = [];
	private _isDirtyFromContentChange = false;
	private _inOrphaned = false;

	private _ongoingSave?: CancelablePromise<void>;

	private readonly _onDidChangeOrphaned = this._register(new Emitter<void>());
	public readonly onDidChangeOrphaned = this._onDidChangeOrphaned.event;

	// TODO@mjbvz consider to enable a `typeId` that is specific for custom
	// editors. Using a distinct `typeId` allows the working copy to have
	// any resource (including file based resources) even if other working
	// copies exist with the same resource.
	//
	// IMPORTANT: changing the `typeId` has an impact on backups for this
	// working copy. Any value that is not the empty string will be used
	// as seed to the backup. Only change the `typeId` if you have implemented
	// a fallback solution to resolve any existing backups that do not have
	// this seed.
	readonly typeId = NO_TYPE_ID;

	public static async create(
		instantiationService: IInstantiationService,
		proxy: extHostProtocol.ExtHostCustomEditorsShape,
		viewType: string,
		resource: URI,
		options: { backupId?: string },
		getEditors: () => CustomEditorInput[],
		cancellation: CancellationToken,
	): Promise<MainThreadCustomEditorModel> {
		const editors = getEditors();
		let untitledDocumentData: VSBuffer | undefined;
		if (editors.length !== 0) {
			untitledDocumentData = editors[0].untitledDocumentData;
		}
		const { editable } = await proxy.$createCustomDocument(resource, viewType, options.backupId, untitledDocumentData, cancellation);
		return instantiationService.createInstance(MainThreadCustomEditorModel, proxy, viewType, resource, !!options.backupId, editable, !!untitledDocumentData, getEditors);
	}

	constructor(
		private readonly _proxy: extHostProtocol.ExtHostCustomEditorsShape,
		private readonly _viewType: string,
		private readonly _editorResource: URI,
		fromBackup: boolean,
		private readonly _editable: boolean,
		startDirty: boolean,
		private readonly _getEditors: () => CustomEditorInput[],
		@IFileDialogService private readonly _fileDialogService: IFileDialogService,
		@IFileService private readonly _fileService: IFileService,
		@ILabelService private readonly _labelService: ILabelService,
		@IUndoRedoService private readonly _undoService: IUndoRedoService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@IPathService private readonly _pathService: IPathService,
	) {
		super();

		this._fromBackup = fromBackup;

		if (_editable) {
			this._register(workingCopyService.registerWorkingCopy(this));
		}

		// Normally means we're re-opening an untitled file
		if (startDirty) {
			this._isDirtyFromContentChange = true;
		}

		this._register(_fileService.onDidFilesChange(e => this.onDidFilesChange(e)));
	}

	get editorResource() {
		return this._editorResource;
	}

	override dispose() {
		this.#isDisposed = true;

		if (this._editable) {
			this._undoService.removeElements(this._editorResource);
		}

		this._proxy.$disposeCustomDocument(this._editorResource, this._viewType);

		super.dispose();
	}

	//#region IWorkingCopy

	public get resource() {
		// Make sure each custom editor has a unique resource for backup and edits
		return MainThreadCustomEditorModel.toWorkingCopyResource(this._viewType, this._editorResource);
	}

	private static toWorkingCopyResource(viewType: string, resource: URI) {
		const authority = viewType.replace(/[^a-z0-9\-_]/gi, '-');
		const path = `/${multibyteAwareBtoa(resource.with({ query: null, fragment: null }).toString(true))}`;
		return URI.from({
			scheme: Schemas.vscodeCustomEditor,
			authority: authority,
			path: path,
			query: JSON.stringify(resource.toJSON()),
		});
	}

	public get name() {
		return basename(this._labelService.getUriLabel(this._editorResource));
	}

	public get capabilities(): WorkingCopyCapabilities {
		return this.isUntitled() ? WorkingCopyCapabilities.Untitled : WorkingCopyCapabilities.None;
	}

	public isDirty(): boolean {
		if (this._isDirtyFromContentChange) {
			return true;
		}
		if (this._edits.length > 0) {
			return this._savePoint !== this._currentEditIndex;
		}
		return this._fromBackup;
	}

	public isOrphaned(): boolean {
		return this._inOrphaned;
	}

	private isUntitled() {
		return this._editorResource.scheme === Schemas.untitled;
	}

	private readonly _onDidChangeDirty: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChangeDirty: Event<void> = this._onDidChangeDirty.event;

	private readonly _onDidChangeContent: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;

	//#endregion

	private async onDidFilesChange(e: FileChangesEvent): Promise<void> {
		let fileEventImpactsModel = false;
		let newInOrphanModeGuess: boolean | undefined;

		// If we are currently orphaned, we check if the model file was added back
		if (this._inOrphaned) {
			const modelFileAdded = e.contains(this.editorResource, FileChangeType.ADDED);
			if (modelFileAdded) {
				newInOrphanModeGuess = false;
				fileEventImpactsModel = true;
			}
		}

		// Otherwise we check if the model file was deleted
		else {
			const modelFileDeleted = e.contains(this.editorResource, FileChangeType.DELETED);
			if (modelFileDeleted) {
				newInOrphanModeGuess = true;
				fileEventImpactsModel = true;
			}
		}

		if (fileEventImpactsModel && this._inOrphaned !== newInOrphanModeGuess) {
			let newInOrphanModeValidated: boolean = false;
			if (newInOrphanModeGuess) {
				// We have received reports of users seeing delete events even though the file still
				// exists (network shares issue: https://github.com/microsoft/vscode/issues/13665).
				// Since we do not want to mark the model as orphaned, we have to check if the
				// file is really gone and not just a faulty file event.
				await timeout(100);

				if (this.#isDisposed) {
					newInOrphanModeValidated = true;
				} else {
					const exists = await this._fileService.exists(this.editorResource);
					newInOrphanModeValidated = !exists;
				}
			}

			if (this._inOrphaned !== newInOrphanModeValidated && !this.#isDisposed) {
				this.setOrphaned(newInOrphanModeValidated);
			}
		}
	}

	private setOrphaned(orphaned: boolean): void {
		if (this._inOrphaned !== orphaned) {
			this._inOrphaned = orphaned;
			this._onDidChangeOrphaned.fire();
		}
	}

	public isEditable(): boolean {
		return this._editable;
	}

	public isOnReadonlyFileSystem(): boolean {
		return this._fileService.hasCapability(this.editorResource, FileSystemProviderCapabilities.Readonly);
	}

	public get viewType() {
		return this._viewType;
	}

	public get backupId() {
		return this._backupId;
	}

	public pushEdit(editId: number, label: string | undefined) {
		if (!this._editable) {
			throw new Error('Document is not editable');
		}

		this.change(() => {
			this.spliceEdits(editId);
			this._currentEditIndex = this._edits.length - 1;
		});

		this._undoService.pushElement({
			type: UndoRedoElementType.Resource,
			resource: this._editorResource,
			label: label ?? localize('defaultEditLabel', "Edit"),
			undo: () => this.undo(),
			redo: () => this.redo(),
		});
	}

	public changeContent() {
		this.change(() => {
			this._isDirtyFromContentChange = true;
		});
	}

	private async undo(): Promise<void> {
		if (!this._editable) {
			return;
		}

		if (this._currentEditIndex < 0) {
			// nothing to undo
			return;
		}

		const undoneEdit = this._edits[this._currentEditIndex];
		this.change(() => {
			--this._currentEditIndex;
		});
		await this._proxy.$undo(this._editorResource, this.viewType, undoneEdit, this.isDirty());
	}

	private async redo(): Promise<void> {
		if (!this._editable) {
			return;
		}

		if (this._currentEditIndex >= this._edits.length - 1) {
			// nothing to redo
			return;
		}

		const redoneEdit = this._edits[this._currentEditIndex + 1];
		this.change(() => {
			++this._currentEditIndex;
		});
		await this._proxy.$redo(this._editorResource, this.viewType, redoneEdit, this.isDirty());
	}

	private spliceEdits(editToInsert?: number) {
		const start = this._currentEditIndex + 1;
		const toRemove = this._edits.length - this._currentEditIndex;

		const removedEdits = typeof editToInsert === 'number'
			? this._edits.splice(start, toRemove, editToInsert)
			: this._edits.splice(start, toRemove);

		if (removedEdits.length) {
			this._proxy.$disposeEdits(this._editorResource, this._viewType, removedEdits);
		}
	}

	private change(makeEdit: () => void): void {
		const wasDirty = this.isDirty();
		makeEdit();
		this._onDidChangeContent.fire();

		if (this.isDirty() !== wasDirty) {
			this._onDidChangeDirty.fire();
		}
	}

	public async revert(_options?: IRevertOptions) {
		if (!this._editable) {
			return;
		}

		if (this._currentEditIndex === this._savePoint && !this._isDirtyFromContentChange && !this._fromBackup) {
			return;
		}

		this._proxy.$revert(this._editorResource, this.viewType, CancellationToken.None);
		this.change(() => {
			this._isDirtyFromContentChange = false;
			this._fromBackup = false;
			this._currentEditIndex = this._savePoint;
			this.spliceEdits();
		});
	}

	public async save(options?: ISaveOptions): Promise<boolean> {
		return !!await this.saveCustomEditor(options);
	}

	public async saveCustomEditor(options?: ISaveOptions): Promise<URI | undefined> {
		if (!this._editable) {
			return undefined;
		}

		if (this.isUntitled()) {
			const targetUri = await this.suggestUntitledSavePath(options);
			if (!targetUri) {
				return undefined;
			}

			await this.saveCustomEditorAs(this._editorResource, targetUri, options);
			return targetUri;
		}

		const savePromise = createCancelablePromise(token => this._proxy.$onSave(this._editorResource, this.viewType, token));
		this._ongoingSave?.cancel();
		this._ongoingSave = savePromise;

		try {
			await savePromise;

			if (this._ongoingSave === savePromise) { // Make sure we are still doing the same save
				this.change(() => {
					this._isDirtyFromContentChange = false;
					this._savePoint = this._currentEditIndex;
					this._fromBackup = false;
				});
			}
		} finally {
			if (this._ongoingSave === savePromise) { // Make sure we are still doing the same save
				this._ongoingSave = undefined;
			}
		}

		return this._editorResource;
	}

	private suggestUntitledSavePath(options: ISaveOptions | undefined): Promise<URI | undefined> {
		if (!this.isUntitled()) {
			throw new Error('Resource is not untitled');
		}

		const remoteAuthority = this._environmentService.remoteAuthority;
		const localResource = toLocalResource(this._editorResource, remoteAuthority, this._pathService.defaultUriScheme);

		return this._fileDialogService.pickFileToSave(localResource, options?.availableFileSystems);
	}

	public async saveCustomEditorAs(resource: URI, targetResource: URI, _options?: ISaveOptions): Promise<boolean> {
		if (this._editable) {
			// TODO: handle cancellation
			await createCancelablePromise(token => this._proxy.$onSaveAs(this._editorResource, this.viewType, targetResource, token));
			this.change(() => {
				this._savePoint = this._currentEditIndex;
			});
			return true;
		} else {
			// Since the editor is readonly, just copy the file over
			await this._fileService.copy(resource, targetResource, false /* overwrite */);
			return true;
		}
	}

	public async backup(token: CancellationToken): Promise<IWorkingCopyBackup> {
		const editors = this._getEditors();
		if (!editors.length) {
			throw new Error('No editors found for resource, cannot back up');
		}
		const primaryEditor = editors[0];

		const backupMeta: CustomDocumentBackupData = {
			viewType: this.viewType,
			editorResource: this._editorResource,
			backupId: '',
			extension: primaryEditor.extension ? {
				id: primaryEditor.extension.id.value,
				location: primaryEditor.extension.location,
			} : undefined,
			webview: {
				id: primaryEditor.id,
				options: primaryEditor.webview.options,
				state: primaryEditor.webview.state,
			}
		};

		const backupData: IWorkingCopyBackup = {
			meta: backupMeta
		};

		if (!this._editable) {
			return backupData;
		}

		if (this._hotExitState.type === HotExitState.Type.Pending) {
			this._hotExitState.operation.cancel();
		}

		const pendingState = new HotExitState.Pending(
			createCancelablePromise(token =>
				this._proxy.$backup(this._editorResource.toJSON(), this.viewType, token)));
		this._hotExitState = pendingState;

		token.onCancellationRequested(() => {
			pendingState.operation.cancel();
		});

		try {
			const backupId = await pendingState.operation;
			// Make sure state has not changed in the meantime
			if (this._hotExitState === pendingState) {
				this._hotExitState = HotExitState.Allowed;
				backupData.meta!.backupId = backupId;
				this._backupId = backupId;
			}
		} catch (e) {
			if (isPromiseCanceledError(e)) {
				// This is expected
				throw e;
			}

			// Otherwise it could be a real error. Make sure state has not changed in the meantime.
			if (this._hotExitState === pendingState) {
				this._hotExitState = HotExitState.NotAllowed;
			}
		}

		if (this._hotExitState === HotExitState.Allowed) {
			return backupData;
		}

		throw new Error('Cannot back up in this state');
	}
}
