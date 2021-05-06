/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { EditorModel, IEditorInput, IRevertOptions, ISaveOptions } from 'vs/workbench/common/editor';
import { Emitter, Event } from 'vs/base/common/event';
import { ICellDto2, INotebookEditorModel, INotebookLoadOptions, IResolvedNotebookEditorModel, NotebookCellsChangeType, NotebookDataDto, NotebookDocumentBackupData } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { INotebookContentProvider, INotebookSerializer, INotebookService, SimpleNotebookProviderInfo } from 'vs/workbench/contrib/notebook/common/notebookService';
import { URI } from 'vs/base/common/uri';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IWorkingCopy, IWorkingCopyBackup, WorkingCopyCapabilities, NO_TYPE_ID, IWorkingCopyIdentifier } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { Schemas } from 'vs/base/common/network';
import { IFileStatWithMetadata, IFileService, FileChangeType, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { ILabelService } from 'vs/platform/label/common/label';
import { ILogService } from 'vs/platform/log/common/log';
import { TaskSequentializer } from 'vs/base/common/async';
import { bufferToStream, streamToBuffer, VSBuffer, VSBufferReadableStream } from 'vs/base/common/buffer';
import { assertType } from 'vs/base/common/types';
import { IUntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { IFileWorkingCopyModel, IFileWorkingCopyModelContentChangedEvent, IFileWorkingCopyModelFactory, IResolvedFileWorkingCopy } from 'vs/workbench/services/workingCopy/common/fileWorkingCopy';
import { DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { canceled } from 'vs/base/common/errors';
import { NotebookEditorInput } from 'vs/workbench/contrib/notebook/common/notebookEditorInput';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IFileWorkingCopyManager, IFileWorkingCopySaveAsOptions } from 'vs/workbench/services/workingCopy/common/fileWorkingCopyManager';
import { filter } from 'vs/base/common/objects';

//#region --- complex content provider

export class ComplexNotebookEditorModel extends EditorModel implements INotebookEditorModel {

	private readonly _onDidSave = this._register(new Emitter<void>());
	private readonly _onDidChangeDirty = this._register(new Emitter<void>());
	private readonly _onDidChangeContent = this._register(new Emitter<void>());

	readonly onDidSave = this._onDidSave.event;
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private _lastResolvedFileStat?: IFileStatWithMetadata;

	private readonly _name: string;
	private readonly _workingCopyIdentifier: IWorkingCopyIdentifier;
	private readonly _saveSequentializer = new TaskSequentializer();

	private _dirty: boolean = false;

	constructor(
		readonly resource: URI,
		readonly viewType: string,
		private readonly _contentProvider: INotebookContentProvider,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IWorkingCopyService private readonly _workingCopyService: IWorkingCopyService,
		@IWorkingCopyBackupService private readonly _workingCopyBackupService: IWorkingCopyBackupService,
		@IFileService private readonly _fileService: IFileService,
		@INotificationService private readonly _notificationService: INotificationService,
		@ILogService private readonly _logService: ILogService,
		@IUntitledTextEditorService private readonly untitledTextEditorService: IUntitledTextEditorService,
		@ILabelService labelService: ILabelService,
	) {
		super();

		this._name = labelService.getUriBasenameLabel(resource);

		const that = this;
		this._workingCopyIdentifier = {
			// TODO@jrieken TODO@rebornix consider to enable a `typeId` that is
			// specific for custom editors. Using a distinct `typeId` allows the
			// working copy to have any resource (including file based resources)
			// even if other working copies exist with the same resource.
			//
			// IMPORTANT: changing the `typeId` has an impact on backups for this
			// working copy. Any value that is not the empty string will be used
			// as seed to the backup. Only change the `typeId` if you have implemented
			// a fallback solution to resolve any existing backups that do not have
			// this seed.
			typeId: NO_TYPE_ID,
			resource: URI.from({ scheme: Schemas.vscodeNotebook, path: resource.toString() })
		};
		const workingCopyAdapter = new class implements IWorkingCopy {
			readonly typeId = that._workingCopyIdentifier.typeId;
			readonly resource = that._workingCopyIdentifier.resource;
			get name() { return that._name; }
			readonly capabilities = that._isUntitled() ? WorkingCopyCapabilities.Untitled : WorkingCopyCapabilities.None;
			readonly onDidChangeDirty = that.onDidChangeDirty;
			readonly onDidChangeContent = that._onDidChangeContent.event;
			isDirty(): boolean { return that.isDirty(); }
			backup(token: CancellationToken): Promise<IWorkingCopyBackup> { return that.backup(token); }
			save(): Promise<boolean> { return that.save(); }
			revert(options?: IRevertOptions): Promise<void> { return that.revert(options); }
		};

		this._register(this._workingCopyService.registerWorkingCopy(workingCopyAdapter));
		this._register(this._fileService.onDidFilesChange(async e => {
			if (this.isDirty() || !this.isResolved() || this._saveSequentializer.hasPending()) {
				// skip when dirty, unresolved, or when saving
				return;
			}
			if (!e.affects(this.resource, FileChangeType.UPDATED)) {
				// no my file
				return;
			}
			const stats = await this._resolveStats(this.resource);
			if (stats && this._lastResolvedFileStat && stats.etag !== this._lastResolvedFileStat.etag) {
				this._logService.debug('[notebook editor model] trigger load after file event');
				this.load({ forceReadFromFile: true });
			}
		}));
	}

	override isResolved(): this is IResolvedNotebookEditorModel {
		return this.notebook !== undefined;
	}

	isDirty(): boolean {
		return this._dirty;
	}

	isReadonly(): boolean {
		return false;
	}

	private _isUntitled(): boolean {
		return this.resource.scheme === Schemas.untitled;
	}

	get notebook(): NotebookTextModel | undefined {
		const candidate = this._notebookService.getNotebookTextModel(this.resource);
		return candidate && candidate.viewType === this.viewType ? candidate : undefined;
	}

	setDirty(newState: boolean) {
		if (this._dirty !== newState) {
			this._dirty = newState;
			this._onDidChangeDirty.fire();
		}
	}

	async backup(token: CancellationToken): Promise<IWorkingCopyBackup> {

		if (!this.isResolved()) {
			return {};
		}

		const backupId = await this._contentProvider.backup(this.resource, token);
		if (token.isCancellationRequested) {
			return {};
		}
		const stats = await this._resolveStats(this.resource);

		return {
			meta: {
				mtime: stats?.mtime ?? Date.now(),
				viewType: this.notebook.viewType,
				backupId
			}
		};
	}

	async revert(options?: IRevertOptions | undefined): Promise<void> {
		if (options?.soft) {
			this.setDirty(false);
			return;
		}

		await this.load({ forceReadFromFile: true });
		const newStats = await this._resolveStats(this.resource);
		this._lastResolvedFileStat = newStats;

		this.setDirty(false);
		this._onDidChangeDirty.fire();
	}

	async load(options?: INotebookLoadOptions): Promise<IResolvedNotebookEditorModel> {
		if (options?.forceReadFromFile) {
			this._logService.debug('[notebook editor model] load from provider (forceRead)', this.resource.toString());
			this._loadFromProvider(undefined);
			assertType(this.isResolved());
			return this;
		}

		if (this.isResolved()) {
			return this;
		}

		const backup = await this._workingCopyBackupService.resolve<NotebookDocumentBackupData>(this._workingCopyIdentifier);

		if (this.isResolved()) {
			return this; // Make sure meanwhile someone else did not succeed in loading
		}

		this._logService.debug('[notebook editor model] load from provider', this.resource.toString());
		await this._loadFromProvider(backup?.meta?.backupId);
		assertType(this.isResolved());
		return this;
	}

	/**
	 * @description Uses the textmodel resolver service to acquire the untitled file's content
	 * @param resource The resource that is the untitled file
	 * @returns The bytes
	 */
	private async getUntitledDocumentData(resource: URI): Promise<VSBuffer | undefined> {
		// If it's an untitled file we must populate the untitledDocumentData
		const untitledString = this.untitledTextEditorService.getValue(resource);
		let untitledDocumentData = untitledString ? VSBuffer.fromString(untitledString) : undefined;
		return untitledDocumentData;
	}

	private async _loadFromProvider(backupId: string | undefined): Promise<void> {

		const untitledData = await this.getUntitledDocumentData(this.resource);
		// If we're loading untitled file data we should ensure the model is dirty
		if (untitledData) {
			this._onDidChangeDirty.fire();
		}
		const data = await this._contentProvider.open(this.resource, backupId, untitledData, CancellationToken.None);

		this._lastResolvedFileStat = await this._resolveStats(this.resource);

		if (this.isDisposed()) {
			return;
		}

		if (!this.notebook) {
			this._logService.debug('[notebook editor model] loading NEW notebook', this.resource.toString());
			// FRESH there is no notebook yet and we are now creating it

			// UGLY
			// There might be another notebook for the URI which was created from a different
			// source (different viewType). In that case we simply dispose the
			// existing/conflicting model and proceed with a new notebook
			const conflictingNotebook = this._notebookService.getNotebookTextModel(this.resource);
			if (conflictingNotebook) {
				this._logService.warn('DISPOSING conflicting notebook with same URI but different view type', this.resource.toString(), this.viewType);
				conflictingNotebook.dispose();
			}


			// this creates and caches a new notebook model so that notebookService.getNotebookTextModel(...)
			// will return this one model
			const notebook = this._notebookService.createNotebookTextModel(this.viewType, this.resource, data.data, data.transientOptions);
			this._register(notebook);
			this._register(notebook.onDidChangeContent(e => {
				let triggerDirty = false;
				for (let i = 0; i < e.rawEvents.length; i++) {
					if (e.rawEvents[i].kind !== NotebookCellsChangeType.Initialize) {
						this._onDidChangeContent.fire();
						triggerDirty = triggerDirty || !e.rawEvents[i].transient;
					}
				}
				if (triggerDirty) {
					this.setDirty(true);
				}
			}));

		} else {
			// UPDATE exitsing notebook with data that we have just fetched
			this._logService.debug('[notebook editor model] loading onto EXISTING notebook', this.resource.toString());
			this.notebook.reset(data.data.cells, data.data.metadata, data.transientOptions);
		}

		if (backupId) {
			this._workingCopyBackupService.discardBackup(this._workingCopyIdentifier);
			this.setDirty(true);
		} else {
			this.setDirty(false);
		}
	}

	private async _assertStat(): Promise<'overwrite' | 'revert' | 'none'> {
		this._logService.debug('[notebook editor model] start assert stat');
		const stats = await this._resolveStats(this.resource);
		if (this._lastResolvedFileStat && stats && stats.mtime > this._lastResolvedFileStat.mtime) {
			this._logService.debug(`[notebook editor model] noteboook file on disk is newer:\nLastResolvedStat: ${this._lastResolvedFileStat ? JSON.stringify(this._lastResolvedFileStat) : undefined}.\nCurrent stat: ${JSON.stringify(stats)}`);
			this._lastResolvedFileStat = stats;
			return new Promise<'overwrite' | 'revert' | 'none'>(resolve => {
				const handle = this._notificationService.prompt(
					Severity.Info,
					nls.localize('notebook.staleSaveError', "The contents of the file has changed on disk. Would you like to open the updated version or overwrite the file with your changes?"),
					[{
						label: nls.localize('notebook.staleSaveError.revert', "Revert"),
						run: () => {
							resolve('revert');
						}
					}, {
						label: nls.localize('notebook.staleSaveError.overwrite.', "Overwrite"),
						run: () => {
							resolve('overwrite');
						}
					}],
					{ sticky: true }
				);

				Event.once(handle.onDidClose)(() => {
					resolve('none');
				});
			});
		} else if (!this._lastResolvedFileStat && stats) {
			// finally get a stats
			this._lastResolvedFileStat = stats;
		}

		return 'overwrite';
	}

	async save(): Promise<boolean> {

		if (!this.isResolved()) {
			return false;
		}

		const versionId = this.notebook.versionId;
		this._logService.debug(`[notebook editor model] save(${versionId}) - enter with versionId ${versionId}`, this.resource.toString(true));

		if (this._saveSequentializer.hasPending(versionId)) {
			this._logService.debug(`[notebook editor model] save(${versionId}) - exit - found a pending save for versionId ${versionId}`, this.resource.toString(true));
			return this._saveSequentializer.pending.then(() => {
				return true;
			});
		}

		if (this._saveSequentializer.hasPending()) {
			return this._saveSequentializer.setNext(async () => {
				await this.save();
			}).then(() => {
				return true;
			});
		}

		return this._saveSequentializer.setPending(versionId, (async () => {
			const result = await this._assertStat();
			if (result === 'none') {
				return;
			}
			if (result === 'revert') {
				await this.revert();
				return;
			}
			if (!this.isResolved()) {
				return;
			}
			const success = await this._contentProvider.save(this.notebook.uri, CancellationToken.None);
			this._logService.debug(`[notebook editor model] save(${versionId}) - document saved saved, start updating file stats`, this.resource.toString(true), success);
			this._lastResolvedFileStat = await this._resolveStats(this.resource);
			if (success) {
				this.setDirty(false);
				this._onDidSave.fire();
			}
		})()).then(() => {
			return true;
		});
	}

	async saveAs(targetResource: URI): Promise<IEditorInput | undefined> {

		if (!this.isResolved()) {
			return undefined;
		}

		this._logService.debug(`[notebook editor model] saveAs - enter`, this.resource.toString(true));
		const result = await this._assertStat();

		if (result === 'none') {
			return undefined;
		}

		if (result === 'revert') {
			await this.revert();
			return undefined;
		}

		const success = await this._contentProvider.saveAs(this.notebook.uri, targetResource, CancellationToken.None);
		this._logService.debug(`[notebook editor model] saveAs - document saved, start updating file stats`, this.resource.toString(true), success);
		this._lastResolvedFileStat = await this._resolveStats(this.resource);
		if (!success) {
			return undefined;
		}
		this.setDirty(false);
		this._onDidSave.fire();
		return this._instantiationService.createInstance(NotebookEditorInput, targetResource, this.viewType, {});
	}

	private async _resolveStats(resource: URI) {
		if (resource.scheme === Schemas.untitled) {
			return undefined;
		}

		try {
			this._logService.debug(`[notebook editor model] _resolveStats`, this.resource.toString(true));
			const newStats = await this._fileService.resolve(this.resource, { resolveMetadata: true });
			this._logService.debug(`[notebook editor model] _resolveStats - latest file stats: ${JSON.stringify(newStats)}`, this.resource.toString(true));
			return newStats;
		} catch (e) {
			return undefined;
		}
	}
}

//#endregion

//#region --- simple content provider

export class SimpleNotebookEditorModel extends EditorModel implements INotebookEditorModel {

	private readonly _onDidChangeDirty = new Emitter<void>();
	private readonly _onDidSave = new Emitter<void>();

	readonly onDidChangeDirty: Event<void> = this._onDidChangeDirty.event;
	readonly onDidSave: Event<void> = this._onDidSave.event;

	private _workingCopy?: IResolvedFileWorkingCopy<NotebookFileWorkingCopyModel>;
	private readonly _workingCopyListeners = new DisposableStore();

	constructor(
		readonly resource: URI,
		readonly viewType: string,
		private readonly _workingCopyManager: IFileWorkingCopyManager<NotebookFileWorkingCopyModel>,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
	}

	override dispose(): void {
		this._workingCopyListeners.dispose();
		this._workingCopy?.dispose();
		this._onDidChangeDirty.dispose();
		this._onDidSave.dispose();
		super.dispose();
	}

	get notebook(): NotebookTextModel | undefined {
		return this._workingCopy?.model.notebookModel;
	}

	override isResolved(): this is IResolvedNotebookEditorModel {
		return Boolean(this._workingCopy);
	}

	isDirty(): boolean {
		return this._workingCopy?.isDirty() ?? false;
	}

	isReadonly(): boolean {
		return this.fileService.hasCapability(this.resource, FileSystemProviderCapabilities.Readonly);
	}

	revert(options?: IRevertOptions): Promise<void> {
		assertType(this.isResolved());
		return this._workingCopy!.revert(options);
	}

	save(options?: ISaveOptions): Promise<boolean> {
		assertType(this.isResolved());
		return this._workingCopy!.save(options);
	}

	async load(options?: INotebookLoadOptions): Promise<IResolvedNotebookEditorModel> {
		const workingCopy = await this._workingCopyManager.resolve(this.resource, { reload: { async: !options?.forceReadFromFile } });
		if (!this._workingCopy) {
			this._workingCopy = <IResolvedFileWorkingCopy<NotebookFileWorkingCopyModel>>workingCopy;
			this._workingCopy.onDidChangeDirty(() => this._onDidChangeDirty.fire(), this._workingCopyListeners);
			this._workingCopy.onDidSave(() => this._onDidSave.fire(), this._workingCopyListeners);
		}
		assertType(this.isResolved());
		return this;
	}

	async saveAs(target: URI, options?: IFileWorkingCopySaveAsOptions): Promise<IEditorInput | undefined> {
		const newWorkingCopy = await this._workingCopyManager.saveAs(this.resource, target, options);
		if (!newWorkingCopy) {
			return undefined;
		}
		assertType(newWorkingCopy.isResolved());
		// this is a little hacky because we leave the new working copy alone. BUT
		// the newly created editor input will pick it up and claim ownership of it.
		return this._instantiationService.createInstance(NotebookEditorInput, newWorkingCopy.resource, this.viewType, {});
	}
}

export class NotebookFileWorkingCopyModel implements IFileWorkingCopyModel {

	private readonly _onDidChangeContent = new Emitter<IFileWorkingCopyModelContentChangedEvent>();
	private readonly _changeListener: IDisposable;

	readonly onDidChangeContent = this._onDidChangeContent.event;
	readonly onWillDispose: Event<void>;

	constructor(
		private readonly _notebookModel: NotebookTextModel,
		private readonly _notebookSerializer: INotebookSerializer
	) {
		this.onWillDispose = _notebookModel.onWillDispose.bind(_notebookModel);

		this._changeListener = _notebookModel.onDidChangeContent(e => {
			for (const rawEvent of e.rawEvents) {
				if (rawEvent.kind === NotebookCellsChangeType.Initialize) {
					continue;
				}
				if (rawEvent.transient) {
					continue;
				}
				//todo@jrieken,@rebornix forward this information from notebook model
				this._onDidChangeContent.fire({
					isRedoing: false,
					isUndoing: false
				});
				break;
			}
		});
	}

	dispose(): void {
		this._changeListener.dispose();
		this._onDidChangeContent.dispose();
		this._notebookModel.dispose();
	}

	get notebookModel() {
		return this._notebookModel;
	}

	async snapshot(token: CancellationToken): Promise<VSBufferReadableStream> {

		const data: NotebookDataDto = {
			metadata: filter(this._notebookModel.metadata, key => !this._notebookSerializer.options.transientDocumentMetadata[key]),
			cells: [],
		};

		for (const cell of this._notebookModel.cells) {
			const cellData: ICellDto2 = {
				cellKind: cell.cellKind,
				language: cell.language,
				source: cell.getValue(),
				outputs: []
			};

			cellData.outputs = !this._notebookSerializer.options.transientOutputs ? cell.outputs : [];
			cellData.metadata = filter(cell.metadata, key => !this._notebookSerializer.options.transientCellMetadata[key]);

			data.cells.push(cellData);
		}

		const bytes = await this._notebookSerializer.notebookToData(data);
		if (token.isCancellationRequested) {
			throw canceled();
		}
		return bufferToStream(bytes);
	}

	async update(stream: VSBufferReadableStream, token: CancellationToken): Promise<void> {

		const bytes = await streamToBuffer(stream);
		const data = await this._notebookSerializer.dataToNotebook(bytes);

		if (token.isCancellationRequested) {
			throw canceled();
		}
		this._notebookModel.reset(data.cells, data.metadata, this._notebookSerializer.options);
	}

	get versionId() { return this._notebookModel.alternativeVersionId; }

	pushStackElement(): void {
		this._notebookModel.pushStackElement('save', undefined, undefined);
	}
}

export class NotebookFileWorkingCopyModelFactory implements IFileWorkingCopyModelFactory<NotebookFileWorkingCopyModel>{

	constructor(
		private readonly _viewType: string,
		@INotebookService private readonly _notebookService: INotebookService,
	) { }

	async createModel(resource: URI, stream: VSBufferReadableStream, token: CancellationToken): Promise<NotebookFileWorkingCopyModel> {

		const info = await this._notebookService.withNotebookDataProvider(resource, this._viewType);
		if (!(info instanceof SimpleNotebookProviderInfo)) {
			throw new Error('CANNOT open file notebook with this provider');
		}

		const data = await info.serializer.dataToNotebook(await streamToBuffer(stream));

		if (token.isCancellationRequested) {
			throw canceled();
		}

		const notebookModel = this._notebookService.createNotebookTextModel(info.viewType, resource, data, info.serializer.options);
		return new NotebookFileWorkingCopyModel(notebookModel, info.serializer);
	}
}

//#endregion
