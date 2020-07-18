/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Model } from '../model';
import { GitExtension, Repository, API } from './git';
import { ApiRepository, ApiImpl } from './api1';
import { Event, EventEmitter } from 'vscode';

export function deprecated(_target: any, key: string, descriptor: any): void {
	if (typeof descriptor.value !== 'function') {
		throw new Error('not supported');
	}

	const fn = descriptor.value;
	descriptor.value = function () {
		console.warn(`Git extension API method '${key}' is deprecated.`);
		return fn.apply(this, arguments);
	};
}

export class GitExtensionImpl implements GitExtension {

	enabled: boolean = false;

	private _onDidChangeEnablement = new EventEmitter<boolean>();
	readonly onDidChangeEnablement: Event<boolean> = this._onDidChangeEnablement.event;

	private _model: Model | undefined = undefined;

	set model(model: Model | undefined) {
		this._model = model;

		const enabled = !!model;

		if (this.enabled === enabled) {
			return;
		}

		this.enabled = enabled;
		this._onDidChangeEnablement.fire(this.enabled);
	}

	get model(): Model | undefined {
		return this._model;
	}

	constructor(model?: Model) {
		if (model) {
			this.enabled = true;
			this._model = model;
		}
	}

	@deprecated
	async getGitPath(): Promise<string> {
		if (!this._model) {
			throw new Error('Git model not found');
		}

		return this._model.git.path;
	}

	@deprecated
	async getRepositories(): Promise<Repository[]> {
		if (!this._model) {
			throw new Error('Git model not found');
		}

		return this._model.repositories.map(repository => new ApiRepository(repository));
	}

	getAPI(version: number): API {
		if (!this._model) {
			throw new Error('Git model not found');
		}

		if (version !== 1) {
			throw new Error(`No API version ${version} found.`);
		}

		return new ApiImpl(this._model);
	}
}
