/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { CellUri, IResolvedNotebookEditorModel, NotebookWorkingCopyTypeIdentifier } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ComplexNotebookEditorModel, NotebookFileWorkingCopyModel, NotebookFileWorkingCopyModelFactory, SimpleNotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookEditorModel';
import { combinedDisposable, DisposableStore, dispose, IDisposable, IReference, ReferenceCollection, toDisposable } from 'vs/base/common/lifecycle';
import { ComplexNotebookProviderInfo, INotebookService, SimpleNotebookProviderInfo } from 'vs/workbench/contrib/notebook/common/notebookService';
import { ILogService } from 'vs/platform/log/common/log';
import { Emitter, Event } from 'vs/base/common/event';
import { FileWorkingCopyManager, IFileWorkingCopyManager } from 'vs/workbench/services/workingCopy/common/fileWorkingCopyManager';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { INotebookEditorModelResolverService } from 'vs/workbench/contrib/notebook/common/notebookEditorModelResolverService';
import { ResourceMap } from 'vs/base/common/map';

class NotebookModelReferenceCollection extends ReferenceCollection<Promise<IResolvedNotebookEditorModel>> {

	private readonly _disposables = new DisposableStore();
	private readonly _workingCopyManagers = new Map<string, IFileWorkingCopyManager<NotebookFileWorkingCopyModel>>();
	private readonly _modelListener = new Map<IResolvedNotebookEditorModel, IDisposable>();

	private readonly _onDidSaveNotebook = new Emitter<URI>();
	readonly onDidSaveNotebook: Event<URI> = this._onDidSaveNotebook.event;

	private readonly _onDidChangeDirty = new Emitter<IResolvedNotebookEditorModel>();
	readonly onDidChangeDirty: Event<IResolvedNotebookEditorModel> = this._onDidChangeDirty.event;

	private readonly _dirtyStates = new ResourceMap<boolean>();

	constructor(
		@IInstantiationService readonly _instantiationService: IInstantiationService,
		@INotebookService private readonly _notebookService: INotebookService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();

		this._disposables.add(_notebookService.onWillRemoveViewType(viewType => {
			const manager = this._workingCopyManagers.get(NotebookWorkingCopyTypeIdentifier.create(viewType));
			if (manager) {
				manager.dispose();
			}
		}));
	}

	dispose(): void {
		this._disposables.dispose();
		this._onDidSaveNotebook.dispose();
		this._onDidChangeDirty.dispose();
		dispose(this._modelListener.values());
		dispose(this._workingCopyManagers.values());
	}

	isDirty(resource: URI): boolean {
		return this._dirtyStates.get(resource) ?? false;
	}

	protected async createReferencedObject(key: string, viewType: string): Promise<IResolvedNotebookEditorModel> {
		const uri = URI.parse(key);
		const info = await this._notebookService.withNotebookDataProvider(uri, viewType);

		let result: IResolvedNotebookEditorModel;

		if (info instanceof ComplexNotebookProviderInfo) {
			const model = this._instantiationService.createInstance(ComplexNotebookEditorModel, uri, viewType, info.controller);
			result = await model.load();

		} else if (info instanceof SimpleNotebookProviderInfo) {
			const workingCopyTypeId = NotebookWorkingCopyTypeIdentifier.create(viewType);
			let workingCopyManager = this._workingCopyManagers.get(workingCopyTypeId);
			if (!workingCopyManager) {
				workingCopyManager = <IFileWorkingCopyManager<NotebookFileWorkingCopyModel>><any>this._instantiationService.createInstance(
					FileWorkingCopyManager,
					workingCopyTypeId,
					new NotebookFileWorkingCopyModelFactory(viewType, this._notebookService)
				);
				this._workingCopyManagers.set(workingCopyTypeId, workingCopyManager);
			}
			const model = this._instantiationService.createInstance(SimpleNotebookEditorModel, uri, viewType, workingCopyManager);
			result = await model.load();

		} else {
			throw new Error(`CANNOT open ${key}, no provider found`);
		}

		// Whenever a notebook model is dirty we automatically reference it so that
		// we can ensure that at least one reference exists. That guarantees that
		// a model with unsaved changes is never disposed.
		let onDirtyAutoReference: IReference<any> | undefined;

		this._modelListener.set(result, combinedDisposable(
			result.onDidSave(() => this._onDidSaveNotebook.fire(result.resource)),
			result.onDidChangeDirty(() => {
				const isDirty = result.isDirty();
				this._dirtyStates.set(result.resource, isDirty);

				// isDirty -> add reference
				// !isDirty -> free reference
				if (isDirty && !onDirtyAutoReference) {
					onDirtyAutoReference = this.acquire(key, viewType);
				} else if (onDirtyAutoReference) {
					onDirtyAutoReference.dispose();
					onDirtyAutoReference = undefined;
				}

				this._onDidChangeDirty.fire(result);
			}),
			toDisposable(() => onDirtyAutoReference?.dispose()),
		));
		return result;
	}

	protected destroyReferencedObject(_key: string, object: Promise<IResolvedNotebookEditorModel>): void {
		object.then(model => {
			this._modelListener.get(model)?.dispose();
			this._modelListener.delete(model);
			model.dispose();
		}).catch(err => {
			this._logService.critical('FAILED to destory notebook', err);
		});
	}
}

export class NotebookModelResolverServiceImpl implements INotebookEditorModelResolverService {

	readonly _serviceBrand: undefined;

	private readonly _data: NotebookModelReferenceCollection;

	readonly onDidSaveNotebook: Event<URI>;
	readonly onDidChangeDirty: Event<IResolvedNotebookEditorModel>;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@INotebookService private readonly _notebookService: INotebookService,
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IUriIdentityService private readonly _uriIdentService: IUriIdentityService,
	) {
		this._data = instantiationService.createInstance(NotebookModelReferenceCollection);
		this.onDidSaveNotebook = this._data.onDidSaveNotebook;
		this.onDidChangeDirty = this._data.onDidChangeDirty;
	}

	dispose() {
		this._data.dispose();
	}

	isDirty(resource: URI): boolean {
		return this._data.isDirty(resource);
	}

	async resolve(resource: URI, viewType?: string): Promise<IReference<IResolvedNotebookEditorModel>> {

		if (resource.scheme === CellUri.scheme) {
			throw new Error(`CANNOT open a cell-uri as notebook. Tried with ${resource.toString()}`);
		}

		resource = this._uriIdentService.asCanonicalUri(resource);

		const existingViewType = this._notebookService.getNotebookTextModel(resource)?.viewType;
		if (!viewType) {
			if (existingViewType) {
				viewType = existingViewType;
			} else {
				await this._extensionService.whenInstalledExtensionsRegistered();
				const providers = this._notebookService.getContributedNotebookProviders(resource);
				const exclusiveProvider = providers.find(provider => provider.exclusive);
				viewType = exclusiveProvider?.id || providers[0]?.id;
			}
		}

		if (!viewType) {
			throw new Error(`Missing viewType for '${resource}'`);
		}

		if (existingViewType && existingViewType !== viewType) {
			throw new Error(`A notebook with view type '${existingViewType}' already exists for '${resource}', CANNOT create another notebook with view type ${viewType}`);
		}

		const reference = this._data.acquire(resource.toString(), viewType);
		const model = await reference.object;
		return {
			object: model,
			dispose() {
				reference.dispose();
			}
		};
	}
}
