/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { INotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookEditorModel';
import { DisposableStore, IDisposable, IReference, ReferenceCollection } from 'vs/base/common/lifecycle';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { ILogService } from 'vs/platform/log/common/log';
import { Event } from 'vs/base/common/event';

export const INotebookEditorModelResolverService = createDecorator<INotebookEditorModelResolverService>('INotebookModelResolverService');

export interface INotebookEditorModelResolverService {
	readonly _serviceBrand: undefined;
	resolve(resource: URI, viewType?: string, editorId?: string): Promise<IReference<INotebookEditorModel>>;
}


export class NotebookModelReferenceCollection extends ReferenceCollection<Promise<INotebookEditorModel>> {

	constructor(
		@IInstantiationService readonly _instantiationService: IInstantiationService,
		@INotebookService private readonly _notebookService: INotebookService,
		@ILogService private readonly _logService: ILogService,
	) {
		super();
	}

	protected createReferencedObject(key: string, ...args: any[]): Promise<INotebookEditorModel> {
		const resource = URI.parse(key);

		let [viewType, editorId] = args as [string | undefined, string | undefined];
		if (!viewType) {
			viewType = this._notebookService.getContributedNotebookProviders(resource)[0]?.id;
		}
		if (!viewType) {
			throw new Error('Missing viewType');
		}

		const model = this._instantiationService.createInstance(NotebookEditorModel, resource, viewType);
		const promise = model.load({ editorId });
		return promise;
	}

	protected destroyReferencedObject(_key: string, object: Promise<INotebookEditorModel>): void {
		object.then(model => {
			this._notebookService.destoryNotebookDocument(model.viewType, model.notebook);
			model.dispose();
		}).catch(err => {
			this._logService.critical('FAILED to destory notebook', err);
		});
	}
}

export class NotebookModelResolverService implements INotebookEditorModelResolverService {

	readonly _serviceBrand: undefined;

	private readonly _data: NotebookModelReferenceCollection;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService
	) {
		this._data = instantiationService.createInstance(NotebookModelReferenceCollection);
	}

	async resolve(resource: URI, viewType?: string, editorId?: string | undefined): Promise<IReference<INotebookEditorModel>> {
		const reference = this._data.acquire(resource.toString(), viewType, editorId);
		const model = await reference.object;
		NotebookModelResolverService._autoReferenceDirtyModel(model, () => this._data.acquire(resource.toString(), viewType, editorId));
		return {
			object: model,
			dispose() { reference.dispose(); }
		};
	}

	private static _autoReferenceDirtyModel(model: INotebookEditorModel, ref: () => IDisposable) {

		const references = new DisposableStore();
		const listener = model.notebook.onDidChangeDirty(() => {
			if (model.notebook.isDirty) {
				references.add(ref());
			} else {
				references.clear();
			}
		});

		Event.once(model.notebook.onWillDispose)(() => {
			listener.dispose();
			references.dispose();
		});
	}
}
