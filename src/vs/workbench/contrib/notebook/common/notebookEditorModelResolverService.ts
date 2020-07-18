/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';
import { INotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookEditorModel } from 'vs/workbench/contrib/notebook/common/notebookEditorModel';
import { IReference, ReferenceCollection } from 'vs/base/common/lifecycle';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { ILogService } from 'vs/platform/log/common/log';

export const INotebookEditorModelResolverService = createDecorator<INotebookEditorModelResolverService>('INotebookModelResolverService');

export interface INotebookEditorModelResolverService {
	readonly _serviceBrand: undefined;
	resolve(resource: URI, viewType: string, editorId?: string): Promise<IReference<INotebookEditorModel>>;
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
		const [viewType, editorId] = args as [string, string | undefined];

		const resource = URI.parse(key);
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

	async resolve(resource: URI, viewType: string, editorId?: string | undefined): Promise<IReference<INotebookEditorModel>> {
		const reference = this._data.acquire(resource.toString(), viewType, editorId);
		const model = await reference.object;
		return {
			object: model,
			dispose() { reference.dispose(); }
		};
	}
}
