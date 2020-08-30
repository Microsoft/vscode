/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IReference } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { ICustomEditorModel, ICustomEditorModelManager } from 'vs/workbench/contrib/customEditor/common/customEditor';
import { once } from 'vs/base/common/functional';

export class CustomEditorModelManager implements ICustomEditorModelManager {

	private readonly _references = new Map<string, {
		readonly viewType: string,
		readonly model: Promise<ICustomEditorModel>,
		counter: number
	}>();

	public async get(resource: URI, viewType: string): Promise<ICustomEditorModel | undefined> {
		const key = this.key(resource, viewType);
		const entry = this._references.get(key);
		return entry?.model;
	}

	public tryRetain(resource: URI, viewType: string): Promise<IReference<ICustomEditorModel>> | undefined {
		const key = this.key(resource, viewType);

		const entry = this._references.get(key);
		if (!entry) {
			return undefined;
		}

		entry.counter++;

		return entry.model.then(model => {
			return {
				object: model,
				dispose: once(() => {
					if (--entry!.counter <= 0) {
						entry.model.then(x => x.dispose());
						this._references.delete(key);
					}
				}),
			};
		});
	}

	public add(resource: URI, viewType: string, model: Promise<ICustomEditorModel>): Promise<IReference<ICustomEditorModel>> {
		const key = this.key(resource, viewType);
		const existing = this._references.get(key);
		if (existing) {
			throw new Error('Model already exists');
		}

		this._references.set(key, { viewType, model, counter: 0 });
		return this.tryRetain(resource, viewType)!;
	}

	public disposeAllModelsForView(viewType: string): void {
		for (const [key, value] of this._references) {
			if (value.viewType === viewType) {
				value.model.then(x => x.dispose());
				this._references.delete(key);
			}
		}
	}

	private key(resource: URI, viewType: string): string {
		return `${resource.toString()}@@@${viewType}`;
	}
}
