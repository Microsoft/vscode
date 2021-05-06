/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { EditorWorkerClient } from 'vs/editor/common/services/editorWorkerServiceImpl';
import { IModelService } from 'vs/editor/common/services/modelService';
import * as types from 'vs/base/common/types';

/**
 * Create a new web worker that has model syncing capabilities built in.
 * Specify an AMD module to load that will `create` an object that will be proxied.
 */
export function createWebWorker<T>(modelService: IModelService, opts: IWebWorkerOptions): MonacoWebWorker<T> {
	return new MonacoWebWorkerImpl<T>(modelService, opts);
}

/**
 * A web worker that can provide a proxy to an arbitrary file.
 */
export interface MonacoWebWorker<T> {
	/**
	 * Terminate the web worker, thus invalidating the returned proxy.
	 */
	dispose(): void;
	/**
	 * Get a proxy to the arbitrary loaded code.
	 */
	getProxy(): Promise<T>;
	/**
	 * Synchronize (send) the models at `resources` to the web worker,
	 * making them available in the monaco.worker.getMirrorModels().
	 */
	withSyncedResources(resources: URI[]): Promise<T>;
}

export interface IWebWorkerOptions {
	/**
	 * The AMD moduleId to load.
	 * It should export a function `create` that should return the exported proxy.
	 */
	moduleId: string;
	/**
	 * The data to send over when calling create on the module.
	 */
	createData?: any;
	/**
	 * A label to be used to identify the web worker for debugging purposes.
	 */
	label?: string;
	/**
	 * An object that can be used by the web worker to make calls back to the main thread.
	 */
	host?: any;
	/**
	 * Keep idle models.
	 * Defaults to false, which means that idle models will stop syncing after a while.
	 */
	keepIdleModels?: boolean;
}

class MonacoWebWorkerImpl<T> extends EditorWorkerClient implements MonacoWebWorker<T> {

	private readonly _foreignModuleId: string;
	private readonly _foreignModuleHost: { [method: string]: Function } | null;
	private _foreignModuleCreateData: any | null;
	private _foreignProxy: Promise<T> | null;

	constructor(modelService: IModelService, opts: IWebWorkerOptions) {
		super(modelService, opts.keepIdleModels || false, opts.label);
		this._foreignModuleId = opts.moduleId;
		this._foreignModuleCreateData = opts.createData || null;
		this._foreignModuleHost = opts.host || null;
		this._foreignProxy = null;
	}

	// foreign host request
	public override fhr(method: string, args: any[]): Promise<any> {
		if (!this._foreignModuleHost || typeof this._foreignModuleHost[method] !== 'function') {
			return Promise.reject(new Error('Missing method ' + method + ' or missing main thread foreign host.'));
		}

		try {
			return Promise.resolve(this._foreignModuleHost[method].apply(this._foreignModuleHost, args));
		} catch (e) {
			return Promise.reject(e);
		}
	}

	private _getForeignProxy(): Promise<T> {
		if (!this._foreignProxy) {
			this._foreignProxy = this._getProxy().then((proxy) => {
				const foreignHostMethods = this._foreignModuleHost ? types.getAllMethodNames(this._foreignModuleHost) : [];
				return proxy.loadForeignModule(this._foreignModuleId, this._foreignModuleCreateData, foreignHostMethods).then((foreignMethods) => {
					this._foreignModuleCreateData = null;

					const proxyMethodRequest = (method: string, args: any[]): Promise<any> => {
						return proxy.fmr(method, args);
					};

					const createProxyMethod = (method: string, proxyMethodRequest: (method: string, args: any[]) => Promise<any>): () => Promise<any> => {
						return function () {
							const args = Array.prototype.slice.call(arguments, 0);
							return proxyMethodRequest(method, args);
						};
					};

					let foreignProxy = {} as T;
					for (const foreignMethod of foreignMethods) {
						(<any>foreignProxy)[foreignMethod] = createProxyMethod(foreignMethod, proxyMethodRequest);
					}

					return foreignProxy;
				});
			});
		}
		return this._foreignProxy;
	}

	public getProxy(): Promise<T> {
		return this._getForeignProxy();
	}

	public withSyncedResources(resources: URI[]): Promise<T> {
		return this._withSyncedResources(resources).then(_ => this.getProxy());
	}
}
