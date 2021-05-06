/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { Event, Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { TextFileEditorModel } from 'vs/workbench/services/textfile/common/textFileEditorModel';
import { dispose, IDisposable, Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { ITextFileEditorModel, ITextFileEditorModelManager, ITextFileEditorModelResolveOrCreateOptions, ITextFileResolveEvent, ITextFileSaveEvent, ITextFileSaveParticipant } from 'vs/workbench/services/textfile/common/textfiles';
import { ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ResourceMap } from 'vs/base/common/map';
import { IFileService, FileChangesEvent, FileOperation, FileChangeType } from 'vs/platform/files/common/files';
import { Promises, ResourceQueue } from 'vs/base/common/async';
import { onUnexpectedError } from 'vs/base/common/errors';
import { TextFileSaveParticipant } from 'vs/workbench/services/textfile/common/textFileSaveParticipant';
import { SaveReason } from 'vs/workbench/common/editor';
import { CancellationToken } from 'vs/base/common/cancellation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IWorkingCopyFileService, WorkingCopyFileEvent } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { ITextSnapshot } from 'vs/editor/common/model';
import { joinPath } from 'vs/base/common/resources';
import { createTextBufferFactoryFromSnapshot } from 'vs/editor/common/model/textModel';
import { PLAINTEXT_MODE_ID } from 'vs/editor/common/modes/modesRegistry';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

export class TextFileEditorModelManager extends Disposable implements ITextFileEditorModelManager {

	private readonly _onDidCreate = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidCreate = this._onDidCreate.event;

	private readonly _onDidResolve = this._register(new Emitter<ITextFileResolveEvent>());
	readonly onDidResolve = this._onDidResolve.event;

	private readonly _onDidChangeDirty = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private readonly _onDidSaveError = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidSaveError = this._onDidSaveError.event;

	private readonly _onDidSave = this._register(new Emitter<ITextFileSaveEvent>());
	readonly onDidSave = this._onDidSave.event;

	private readonly _onDidRevert = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidRevert = this._onDidRevert.event;

	private readonly _onDidChangeEncoding = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidChangeEncoding = this._onDidChangeEncoding.event;

	private readonly mapResourceToModel = new ResourceMap<TextFileEditorModel>();
	private readonly mapResourceToModelListeners = new ResourceMap<IDisposable>();
	private readonly mapResourceToDisposeListener = new ResourceMap<IDisposable>();
	private readonly mapResourceToPendingModelResolvers = new ResourceMap<Promise<void>>();

	private readonly modelResolveQueue = this._register(new ResourceQueue());

	saveErrorHandler = (() => {
		const notificationService = this.notificationService;

		return {
			onSaveError(error: Error, model: ITextFileEditorModel): void {
				notificationService.error(localize({ key: 'genericSaveError', comment: ['{0} is the resource that failed to save and {1} the error message'] }, "Failed to save '{0}': {1}", model.name, toErrorMessage(error, false)));
			}
		};
	})();

	get models(): TextFileEditorModel[] {
		return [...this.mapResourceToModel.values()];
	}

	constructor(
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkingCopyFileService private readonly workingCopyFileService: IWorkingCopyFileService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		// Update models from file change events
		this._register(this.fileService.onDidFilesChange(e => this.onDidFilesChange(e)));

		// Working copy operations
		this._register(this.workingCopyFileService.onWillRunWorkingCopyFileOperation(e => this.onWillRunWorkingCopyFileOperation(e)));
		this._register(this.workingCopyFileService.onDidFailWorkingCopyFileOperation(e => this.onDidFailWorkingCopyFileOperation(e)));
		this._register(this.workingCopyFileService.onDidRunWorkingCopyFileOperation(e => this.onDidRunWorkingCopyFileOperation(e)));

		// Lifecycle
		this.lifecycleService.onDidShutdown(() => this.dispose());
	}

	private onDidFilesChange(e: FileChangesEvent): void {
		for (const model of this.models) {
			if (model.isDirty() || !model.isResolved()) {
				continue; // require a resolved, saved model to continue
			}

			// Trigger a model resolve for any update or add event that impacts
			// the model. We also consider the added event because it could
			// be that a file was added and updated right after.
			if (e.contains(model.resource, FileChangeType.UPDATED, FileChangeType.ADDED)) {
				this.queueModelResolve(model);
			}
		}
	}

	private queueModelResolve(model: TextFileEditorModel): void {

		// Resolve model to update (use a queue to prevent accumulation of resolves
		// when the resolve actually takes long. At most we only want the queue
		// to have a size of 2 (1 running resolve and 1 queued resolve).
		const queue = this.modelResolveQueue.queueFor(model.resource);
		if (queue.size <= 1) {
			queue.queue(async () => {
				try {
					await model.resolve();
				} catch (error) {
					onUnexpectedError(error);
				}
			});
		}
	}

	private readonly mapCorrelationIdToModelsToRestore = new Map<number, { source: URI, target: URI, snapshot?: ITextSnapshot; mode?: string; encoding?: string; }[]>();

	private onWillRunWorkingCopyFileOperation(e: WorkingCopyFileEvent): void {

		// Move / Copy: remember models to restore after the operation
		if (e.operation === FileOperation.MOVE || e.operation === FileOperation.COPY) {
			const modelsToRestore: { source: URI, target: URI, snapshot?: ITextSnapshot; mode?: string; encoding?: string; }[] = [];

			for (const { source, target } of e.files) {
				if (source) {
					if (this.uriIdentityService.extUri.isEqual(source, target)) {
						continue; // ignore if resources are considered equal
					}

					// find all models that related to source (can be many if resource is a folder)
					const sourceModels: TextFileEditorModel[] = [];
					for (const model of this.models) {
						if (this.uriIdentityService.extUri.isEqualOrParent(model.resource, source)) {
							sourceModels.push(model);
						}
					}

					// remember each source model to resolve again after move is done
					// with optional content to restore if it was dirty
					for (const sourceModel of sourceModels) {
						const sourceModelResource = sourceModel.resource;

						// If the source is the actual model, just use target as new resource
						let targetModelResource: URI;
						if (this.uriIdentityService.extUri.isEqual(sourceModelResource, source)) {
							targetModelResource = target;
						}

						// Otherwise a parent folder of the source is being moved, so we need
						// to compute the target resource based on that
						else {
							targetModelResource = joinPath(target, sourceModelResource.path.substr(source.path.length + 1));
						}

						modelsToRestore.push({
							source: sourceModelResource,
							target: targetModelResource,
							mode: sourceModel.getMode(),
							encoding: sourceModel.getEncoding(),
							snapshot: sourceModel.isDirty() ? sourceModel.createSnapshot() : undefined
						});
					}
				}
			}

			this.mapCorrelationIdToModelsToRestore.set(e.correlationId, modelsToRestore);
		}
	}

	private onDidFailWorkingCopyFileOperation(e: WorkingCopyFileEvent): void {

		// Move / Copy: restore dirty flag on models to restore that were dirty
		if ((e.operation === FileOperation.MOVE || e.operation === FileOperation.COPY)) {
			const modelsToRestore = this.mapCorrelationIdToModelsToRestore.get(e.correlationId);
			if (modelsToRestore) {
				this.mapCorrelationIdToModelsToRestore.delete(e.correlationId);

				modelsToRestore.forEach(model => {
					// snapshot presence means this model used to be dirty and so we restore that
					// flag. we do NOT have to restore the content because the model was only soft
					// reverted and did not loose its original dirty contents.
					if (model.snapshot) {
						this.get(model.source)?.setDirty(true);
					}
				});
			}
		}
	}

	private onDidRunWorkingCopyFileOperation(e: WorkingCopyFileEvent): void {
		switch (e.operation) {

			// Create: Revert existing models
			case FileOperation.CREATE:
				e.waitUntil((async () => {
					for (const { target } of e.files) {
						const model = this.get(target);
						if (model && !model.isDisposed()) {
							await model.revert();
						}
					}
				})());
				break;

			// Move/Copy: restore models that were resolved before the operation took place
			case FileOperation.MOVE:
			case FileOperation.COPY:
				e.waitUntil((async () => {
					const modelsToRestore = this.mapCorrelationIdToModelsToRestore.get(e.correlationId);
					if (modelsToRestore) {
						this.mapCorrelationIdToModelsToRestore.delete(e.correlationId);

						await Promises.settled(modelsToRestore.map(async modelToRestore => {

							// restore the model at the target. if we have previous dirty content, we pass it
							// over to be used, otherwise we force a reload from disk. this is important
							// because we know the file has changed on disk after the move and the model might
							// have still existed with the previous state. this ensures that the model is not
							// tracking a stale state.
							const restoredModel = await this.resolve(modelToRestore.target, {
								reload: { async: false }, // enforce a reload
								contents: modelToRestore.snapshot ? createTextBufferFactoryFromSnapshot(modelToRestore.snapshot) : undefined,
								encoding: modelToRestore.encoding
							});

							// restore previous mode only if the mode is now unspecified and it was specified
							if (modelToRestore.mode && modelToRestore.mode !== PLAINTEXT_MODE_ID && restoredModel.getMode() === PLAINTEXT_MODE_ID) {
								restoredModel.updateTextEditorModel(undefined, modelToRestore.mode);
							}
						}));
					}
				})());
				break;
		}
	}

	get(resource: URI): TextFileEditorModel | undefined {
		return this.mapResourceToModel.get(resource);
	}

	async resolve(resource: URI, options?: ITextFileEditorModelResolveOrCreateOptions): Promise<TextFileEditorModel> {

		// Await a pending model resolve first before proceeding
		// to ensure that we never resolve a model more than once
		// in parallel
		const pendingResolve = this.joinPendingResolve(resource);
		if (pendingResolve) {
			await pendingResolve;
		}

		let modelPromise: Promise<void>;
		let model = this.get(resource);
		let didCreateModel = false;

		// Model exists
		if (model) {

			// Always reload if contents are provided
			if (options?.contents) {
				modelPromise = model.resolve(options);
			}

			// Reload async or sync based on options
			else if (options?.reload) {

				// async reload: trigger a reload but return immediately
				if (options.reload.async) {
					modelPromise = Promise.resolve();
					model.resolve(options);
				}

				// sync reload: do not return until model reloaded
				else {
					modelPromise = model.resolve(options);
				}
			}

			// Do not reload
			else {
				modelPromise = Promise.resolve();
			}
		}

		// Model does not exist
		else {
			didCreateModel = true;

			const newModel = model = this.instantiationService.createInstance(TextFileEditorModel, resource, options ? options.encoding : undefined, options ? options.mode : undefined);
			modelPromise = model.resolve(options);

			this.registerModel(newModel);
		}

		// Store pending resolves to avoid race conditions
		this.mapResourceToPendingModelResolvers.set(resource, modelPromise);

		// Make known to manager (if not already known)
		this.add(resource, model);

		// Emit some events if we created the model
		if (didCreateModel) {
			this._onDidCreate.fire(model);

			// If the model is dirty right from the beginning,
			// make sure to emit this as an event
			if (model.isDirty()) {
				this._onDidChangeDirty.fire(model);
			}
		}

		try {
			await modelPromise;

			// Remove from pending resolves
			this.mapResourceToPendingModelResolvers.delete(resource);

			// Apply mode if provided
			if (options?.mode) {
				model.setMode(options.mode);
			}

			// Model can be dirty if a backup was restored, so we make sure to
			// have this event delivered if we created the model here
			if (didCreateModel && model.isDirty()) {
				this._onDidChangeDirty.fire(model);
			}

			return model;
		} catch (error) {

			// Free resources of this invalid model
			if (model) {
				model.dispose();
			}

			// Remove from pending resolves
			this.mapResourceToPendingModelResolvers.delete(resource);

			throw error;
		}
	}

	private joinPendingResolve(resource: URI): Promise<void> | undefined {
		const pendingModelResolve = this.mapResourceToPendingModelResolvers.get(resource);
		if (pendingModelResolve) {
			return pendingModelResolve.then(undefined, error => {/* ignore any error here, it will bubble to the original requestor*/ });
		}

		return undefined;
	}

	private registerModel(model: TextFileEditorModel): void {

		// Install model listeners
		const modelListeners = new DisposableStore();
		modelListeners.add(model.onDidResolve(reason => this._onDidResolve.fire({ model, reason })));
		modelListeners.add(model.onDidChangeDirty(() => this._onDidChangeDirty.fire(model)));
		modelListeners.add(model.onDidSaveError(() => this._onDidSaveError.fire(model)));
		modelListeners.add(model.onDidSave(reason => this._onDidSave.fire({ model, reason })));
		modelListeners.add(model.onDidRevert(() => this._onDidRevert.fire(model)));
		modelListeners.add(model.onDidChangeEncoding(() => this._onDidChangeEncoding.fire(model)));

		// Keep for disposal
		this.mapResourceToModelListeners.set(model.resource, modelListeners);
	}

	protected add(resource: URI, model: TextFileEditorModel): void {
		const knownModel = this.mapResourceToModel.get(resource);
		if (knownModel === model) {
			return; // already cached
		}

		// dispose any previously stored dispose listener for this resource
		const disposeListener = this.mapResourceToDisposeListener.get(resource);
		if (disposeListener) {
			disposeListener.dispose();
		}

		// store in cache but remove when model gets disposed
		this.mapResourceToModel.set(resource, model);
		this.mapResourceToDisposeListener.set(resource, model.onWillDispose(() => this.remove(resource)));
	}

	protected remove(resource: URI): void {
		this.mapResourceToModel.delete(resource);

		const disposeListener = this.mapResourceToDisposeListener.get(resource);
		if (disposeListener) {
			dispose(disposeListener);
			this.mapResourceToDisposeListener.delete(resource);
		}

		const modelListener = this.mapResourceToModelListeners.get(resource);
		if (modelListener) {
			dispose(modelListener);
			this.mapResourceToModelListeners.delete(resource);
		}
	}

	//#region Save participants

	private readonly saveParticipants = this._register(this.instantiationService.createInstance(TextFileSaveParticipant));

	addSaveParticipant(participant: ITextFileSaveParticipant): IDisposable {
		return this.saveParticipants.addSaveParticipant(participant);
	}

	runSaveParticipants(model: ITextFileEditorModel, context: { reason: SaveReason; }, token: CancellationToken): Promise<void> {
		return this.saveParticipants.participate(model, context, token);
	}

	//#endregion

	clear(): void {

		// model caches
		this.mapResourceToModel.clear();
		this.mapResourceToPendingModelResolvers.clear();

		// dispose the dispose listeners
		this.mapResourceToDisposeListener.forEach(listener => listener.dispose());
		this.mapResourceToDisposeListener.clear();

		// dispose the model change listeners
		this.mapResourceToModelListeners.forEach(listener => listener.dispose());
		this.mapResourceToModelListeners.clear();
	}

	canDispose(model: TextFileEditorModel): true | Promise<true> {

		// quick return if model already disposed or not dirty and not resolving
		if (
			model.isDisposed() ||
			(!this.mapResourceToPendingModelResolvers.has(model.resource) && !model.isDirty())
		) {
			return true;
		}

		// promise based return in all other cases
		return this.doCanDispose(model);
	}

	private async doCanDispose(model: TextFileEditorModel): Promise<true> {

		// if we have a pending model resolve, await it first and then try again
		const pendingResolve = this.joinPendingResolve(model.resource);
		if (pendingResolve) {
			await pendingResolve;

			return this.canDispose(model);
		}

		// dirty model: we do not allow to dispose dirty models to prevent
		// data loss cases. dirty models can only be disposed when they are
		// either saved or reverted
		if (model.isDirty()) {
			await Event.toPromise(model.onDidChangeDirty);

			return this.canDispose(model);
		}

		return true;
	}

	override dispose(): void {
		super.dispose();

		this.clear();
	}
}
