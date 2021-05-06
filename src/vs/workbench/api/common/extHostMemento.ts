/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { IDisposable } from 'vs/base/common/lifecycle';
import { ExtHostStorage } from 'vs/workbench/api/common/extHostStorage';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { DeferredPromise, RunOnceScheduler } from 'vs/base/common/async';

export class ExtensionMemento implements vscode.Memento {

	protected readonly _id: string;
	private readonly _shared: boolean;
	protected readonly _storage: ExtHostStorage;

	private readonly _init: Promise<ExtensionMemento>;
	private _value?: { [n: string]: any; };
	private readonly _storageListener: IDisposable;

	private _deferredPromises: Map<string, DeferredPromise<void>> = new Map();
	private _scheduler: RunOnceScheduler;

	constructor(id: string, global: boolean, storage: ExtHostStorage) {
		this._id = id;
		this._shared = global;
		this._storage = storage;

		this._init = this._storage.getValue(this._shared, this._id, Object.create(null)).then(value => {
			this._value = value;
			return this;
		});

		this._storageListener = this._storage.onDidChangeStorage(e => {
			if (e.shared === this._shared && e.key === this._id) {
				this._value = e.value;
			}
		});

		this._scheduler = new RunOnceScheduler(() => {
			const records = this._deferredPromises;
			this._deferredPromises = new Map();
			(async () => {
				try {
					await this._storage.setValue(this._shared, this._id, this._value!);
					for (const value of records.values()) {
						value.complete();
					}
				} catch (e) {
					for (const value of records.values()) {
						value.error(e);
					}
				}
			})();
		}, 0);
	}

	get whenReady(): Promise<ExtensionMemento> {
		return this._init;
	}

	get<T>(key: string): T | undefined;
	get<T>(key: string, defaultValue: T): T;
	get<T>(key: string, defaultValue?: T): T {
		let value = this._value![key];
		if (typeof value === 'undefined') {
			value = defaultValue;
		}
		return value;
	}

	update(key: string, value: any): Promise<void> {
		this._value![key] = value;

		let record = this._deferredPromises.get(key);
		if (record !== undefined) {
			return record.p;
		}

		const promise = new DeferredPromise<void>();
		this._deferredPromises.set(key, promise);

		if (!this._scheduler.isScheduled()) {
			this._scheduler.schedule();
		}

		return promise.p;
	}

	dispose(): void {
		this._storageListener.dispose();
	}
}

export class ExtensionGlobalMemento extends ExtensionMemento {

	private readonly _extension: IExtensionDescription;

	setKeysForSync(keys: string[]): void {
		this._storage.registerExtensionStorageKeysToSync({ id: this._id, version: this._extension.version }, keys);
	}

	constructor(extensionDescription: IExtensionDescription, storage: ExtHostStorage) {
		super(extensionDescription.identifier.value, true, storage);
		this._extension = extensionDescription;
	}

}
