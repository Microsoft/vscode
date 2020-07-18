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
import { ITextFileEditorModel, ITextFileEditorModelManager, ITextFileEditorModelLoadOrCreateOptions, ITextFileLoadEvent, ITextFileSaveEvent, ITextFileSaveParticipant } from 'vs/workbench/services/textfile/common/textfiles';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ResourceMap } from 'vs/base/common/map';
import { IFileService, FileChangesEvent, FileOperation } from 'vs/platform/files/common/files';
import { distinct, coalesce } from 'vs/base/common/arrays';
import { ResourceQueue } from 'vs/base/common/async';
import { onUnexpectedError } from 'vs/base/common/errors';
import { TextFileSaveParticipant } from 'vs/workbench/services/textfile/common/textFileSaveParticipant';
import { SaveReason } from 'vs/workbench/common/editor';
import { CancellationToken } from 'vs/base/common/cancellation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IWorkingCopyFileService, WorkingCopyFileEvent } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { ITextSnapshot, ITextBufferFactory } from 'vs/editor/common/model';
import { joinPath, extUri } from 'vs/base/common/resources';
import { createTextBufferFactoryFromSnapshot } from 'vs/editor/common/model/textModel';
import { PLAINTEXT_MODE_ID } from 'vs/editor/common/modes/modesRegistry';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

export class TextFileEditorModelManager extends Disposable implements ITextFileEditorModelManager {

	private readonly _onDidCreate = this._register(new Emitter<TextFileEditorModel>());
	readonly onDidCreate = this._onDidCreate.event;

	private readonly _onDidLoad = this._register(new Emitter<ITextFileLoadEvent>());
	readonly onDidLoad = this._onDidLoad.event;

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
	private readonly mapResourceToPendingModelLoaders = new ResourceMap<Promise<TextFileEditorModel>>();

	private readonly modelLoadQueue = this._register(new ResourceQueue());

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
		this.lifecycleService.onShutdown(this.dispose, this);
	}

	private onDidFilesChange(e: FileChangesEvent): void {

		// Collect distinct (saved) models to update.
		//
		// Note: we also consider the added event because it could be that a file was added
		// and updated right after.
		distinct(
			coalesce(
				[...e.getUpdated(), ...e.getAdded()].map(({ resource }) => this.get(resource))
			).filter(model => model && model.isResolved() && !model.isDirty()),
			model => model.resource.toString()
		).forEach(model => this.queueModelLoad(model));
	}

	private queueModelLoad(model: TextFileEditorModel): void {

		// Load model to update (use a queue to prevent accumulation of loads
		// when the load actually takes long. At most we only want the queue
		// to have a size of 2 (1 running load and 1 queued load).
		const queue = this.modelLoadQueue.queueFor(model.resource);
		if (queue.size <= 1) {
			queue.queue(async () => {
				try {
					await model.load();
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

					// find all models that related to either source or target (can be many if resource is a folder)
					const sourceModels: TextFileEditorModel[] = [];
					const targetModels: TextFileEditorModel[] = [];
					for (const model of this.models) {
						const resource = model.resource;

						if (extUri.isEqualOrParent(resource, target)) {
							// EXPLICITLY do not ignorecase, see https://github.com/Microsoft/vscode/issues/56384
							targetModels.push(model);
						}

						if (this.uriIdentityService.extUri.isEqualOrParent(resource, source)) {
							sourceModels.push(model);
						}
					}

					// remember each source model to load again after move is done
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

			// Move/Copy: restore models that were loaded before the operation took place
			case FileOperation.MOVE:
			case FileOperation.COPY:
				e.waitUntil((async () => {
					const modelsToRestore = this.mapCorrelationIdToModelsToRestore.get(e.correlationId);
					if (modelsToRestore) {
						this.mapCorrelationIdToModelsToRestore.delete(e.correlationId);

						await Promise.all(modelsToRestore.map(async modelToRestore => {

							// restore the model, forcing a reload. this is important because
							// we know the file has changed on disk after the move and the
							// model might have still existed with the previous state. this
							// ensures we are not tracking a stale state.
							const restoredModel = await this.resolve(modelToRestore.target, { reload: { async: false }, encoding: modelToRestore.encoding });

							// restore previous dirty content if any and ensure to mark the model as dirty
							let textBufferFactory: ITextBufferFactory | undefined = undefined;
							if (modelToRestore.snapshot) {
								textBufferFactory = createTextBufferFactoryFromSnapshot(modelToRestore.snapshot);
							}

							// restore previous mode only if the mode is now unspecified
							let preferredMode: string | undefined = undefined;
							if (restoredModel.getMode() === PLAINTEXT_MODE_ID && modelToRestore.mode !== PLAINTEXT_MODE_ID) {
								preferredMode = modelToRestore.mode;
							}

							if (textBufferFactory || preferredMode) {
								restoredModel.updateTextEditorModel(textBufferFactory, preferredMode);
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

	async resolve(resource: URI, options?: ITextFileEditorModelLoadOrCreateOptions): Promise<TextFileEditorModel> {

		// Return early if model is currently being loaded
		const pendingLoad = this.mapResourceToPendingModelLoaders.get(resource);
		if (pendingLoad) {
			return pendingLoad;
		}

		let modelPromise: Promise<TextFileEditorModel>;
		let model = this.get(resource);
		let didCreateModel = false;

		// Model exists
		if (model) {
			if (options?.reload) {

				// async reload: trigger a reload but return immediately
				if (options.reload.async) {
					modelPromise = Promise.resolve(model);
					model.load(options);
				}

				// sync reload: do not return until model reloaded
				else {
					modelPromise = model.load(options);
				}
			} else {
				modelPromise = Promise.resolve(model);
			}
		}

		// Model does not exist
		else {
			didCreateModel = true;

			const newModel = model = this.instantiationService.createInstance(TextFileEditorModel, resource, options ? options.encoding : undefined, options ? options.mode : undefined);
			modelPromise = model.load(options);

			this.registerModel(newModel);
		}

		// Store pending loads to avoid race conditions
		this.mapResourceToPendingModelLoaders.set(resource, modelPromise);

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
			const resolvedModel = await modelPromise;

			// Remove from pending loads
			this.mapResourceToPendingModelLoaders.delete(resource);

			// Apply mode if provided
			if (options?.mode) {
				resolvedModel.setMode(options.mode);
			}

			// Model can be dirty if a backup was restored, so we make sure to
			// have this event delivered if we created the model here
			if (didCreateModel && resolvedModel.isDirty()) {
				this._onDidChangeDirty.fire(resolvedModel);
			}

			return resolvedModel;
		} catch (error) {

			// Free resources of this invalid model
			if (model) {
				model.dispose();
			}

			// Remove from pending loads
			this.mapResourceToPendingModelLoaders.delete(resource);

			throw error;
		}
	}

	private registerModel(model: TextFileEditorModel): void {

		// Install model listeners
		const modelListeners = new DisposableStore();
		modelListeners.add(model.onDidLoad(reason => this._onDidLoad.fire({ model, reason })));
		modelListeners.add(model.onDidChangeDirty(() => this._onDidChangeDirty.fire(model)));
		modelListeners.add(model.onDidSaveError(() => this._onDidSaveError.fire(model)));
		modelListeners.add(model.onDidSave(reason => this._onDidSave.fire({ model: model, reason })));
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
		this.mapResourceToDisposeListener.set(resource, model.onDispose(() => this.remove(resource)));
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
		this.mapResourceToPendingModelLoaders.clear();

		// dispose the dispose listeners
		this.mapResourceToDisposeListener.forEach(listener => listener.dispose());
		this.mapResourceToDisposeListener.clear();

		// dispose the model change listeners
		this.mapResourceToModelListeners.forEach(listener => listener.dispose());
		this.mapResourceToModelListeners.clear();
	}

	canDispose(model: TextFileEditorModel): true | Promise<true> {

		// quick return if model already disposed or not dirty and not loading
		if (
			model.isDisposed() ||
			(!this.mapResourceToPendingModelLoaders.has(model.resource) && !model.isDirty())
		) {
			return true;
		}

		// promise based return in all other cases
		return this.doCanDispose(model);
	}

	private async doCanDispose(model: TextFileEditorModel): Promise<true> {

		// pending model load: wait for the load to finish before trying again
		const pendingModelLoad = this.mapResourceToPendingModelLoaders.get(model.resource);
		if (pendingModelLoad) {
			try {
				await pendingModelLoad;
			} catch (error) {
				// ignore any error
			}

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

	dispose(): void {
		super.dispose();

		this.clear();
	}
}
