/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export interface IStorageKey {

	readonly key: string;
	readonly version: number;

}

export const IStorageKeysSyncRegistryService = createDecorator<IStorageKeysSyncRegistryService>('IStorageKeysSyncRegistryService');

export interface IStorageKeysSyncRegistryService {

	_serviceBrand: any;

	/**
	 * All registered storage keys
	 */
	readonly storageKeys: ReadonlyArray<IStorageKey>;

	/**
	 * Event that is triggered when storage keys are changed
	 */
	readonly onDidChangeStorageKeys: Event<ReadonlyArray<IStorageKey>>;

	/**
	 * Register a storage key that has to be synchronized during sync.
	 */
	registerStorageKey(key: IStorageKey): void;

}

export class StorageKeysSyncRegistryService extends Disposable implements IStorageKeysSyncRegistryService {

	_serviceBrand: any;

	private readonly _storageKeys = new Map<string, IStorageKey>();
	get storageKeys(): ReadonlyArray<IStorageKey> { return [...this._storageKeys.values()]; }

	private readonly _onDidChangeStorageKeys: Emitter<ReadonlyArray<IStorageKey>> = this._register(new Emitter<ReadonlyArray<IStorageKey>>());
	readonly onDidChangeStorageKeys = this._onDidChangeStorageKeys.event;

	constructor() {
		super();
		this._register(toDisposable(() => this._storageKeys.clear()));
	}

	registerStorageKey(storageKey: IStorageKey): void {
		if (!this._storageKeys.has(storageKey.key)) {
			this._storageKeys.set(storageKey.key, storageKey);
			this._onDidChangeStorageKeys.fire(this.storageKeys);
		}
	}

}
