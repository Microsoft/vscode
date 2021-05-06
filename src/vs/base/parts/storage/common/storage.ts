/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { ThrottledDelayer } from 'vs/base/common/async';
import { isUndefinedOrNull } from 'vs/base/common/types';

export enum StorageHint {

	// A hint to the storage that the storage
	// does not exist on disk yet. This allows
	// the storage library to improve startup
	// time by not checking the storage for data.
	STORAGE_DOES_NOT_EXIST
}

export interface IStorageOptions {
	readonly hint?: StorageHint;
}

export interface IUpdateRequest {
	readonly insert?: Map<string, string>;
	readonly delete?: Set<string>;
}

export interface IStorageItemsChangeEvent {
	readonly changed?: Map<string, string>;
	readonly deleted?: Set<string>;
}

export interface IStorageDatabase {

	readonly onDidChangeItemsExternal: Event<IStorageItemsChangeEvent>;

	getItems(): Promise<Map<string, string>>;
	updateItems(request: IUpdateRequest): Promise<void>;

	close(recovery?: () => Map<string, string>): Promise<void>;
}

export interface IStorage extends IDisposable {

	readonly onDidChangeStorage: Event<string>;

	readonly items: Map<string, string>;
	readonly size: number;

	init(): Promise<void>;

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;

	getBoolean(key: string, fallbackValue: boolean): boolean;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;

	getNumber(key: string, fallbackValue: number): number;
	getNumber(key: string, fallbackValue?: number): number | undefined;

	set(key: string, value: string | boolean | number | undefined | null): Promise<void>;
	delete(key: string): Promise<void>;

	whenFlushed(): Promise<void>;

	close(): Promise<void>;
}

enum StorageState {
	None,
	Initialized,
	Closed
}

export class Storage extends Disposable implements IStorage {

	private static readonly DEFAULT_FLUSH_DELAY = 100;

	private readonly _onDidChangeStorage = this._register(new Emitter<string>());
	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	private state = StorageState.None;

	private cache = new Map<string, string>();

	private readonly flushDelayer = new ThrottledDelayer<void>(Storage.DEFAULT_FLUSH_DELAY);

	private pendingDeletes = new Set<string>();
	private pendingInserts = new Map<string, string>();

	private pendingClose: Promise<void> | undefined = undefined;

	private readonly whenFlushedCallbacks: Function[] = [];

	constructor(
		protected readonly database: IStorageDatabase,
		private readonly options: IStorageOptions = Object.create(null)
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.database.onDidChangeItemsExternal(e => this.onDidChangeItemsExternal(e)));
	}

	private onDidChangeItemsExternal(e: IStorageItemsChangeEvent): void {
		// items that change external require us to update our
		// caches with the values. we just accept the value and
		// emit an event if there is a change.
		e.changed?.forEach((value, key) => this.accept(key, value));
		e.deleted?.forEach(key => this.accept(key, undefined));
	}

	private accept(key: string, value: string | undefined): void {
		if (this.state === StorageState.Closed) {
			return; // Return early if we are already closed
		}

		let changed = false;

		// Item got removed, check for deletion
		if (isUndefinedOrNull(value)) {
			changed = this.cache.delete(key);
		}

		// Item got updated, check for change
		else {
			const currentValue = this.cache.get(key);
			if (currentValue !== value) {
				this.cache.set(key, value);
				changed = true;
			}
		}

		// Signal to outside listeners
		if (changed) {
			this._onDidChangeStorage.fire(key);
		}
	}

	get items(): Map<string, string> {
		return this.cache;
	}

	get size(): number {
		return this.cache.size;
	}

	async init(): Promise<void> {
		if (this.state !== StorageState.None) {
			return; // either closed or already initialized
		}

		this.state = StorageState.Initialized;

		if (this.options.hint === StorageHint.STORAGE_DOES_NOT_EXIST) {
			// return early if we know the storage file does not exist. this is a performance
			// optimization to not load all items of the underlying storage if we know that
			// there can be no items because the storage does not exist.
			return;
		}

		this.cache = await this.database.getItems();
	}

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;
	get(key: string, fallbackValue?: string): string | undefined {
		const value = this.cache.get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return value;
	}

	getBoolean(key: string, fallbackValue: boolean): boolean;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined;
	getBoolean(key: string, fallbackValue?: boolean): boolean | undefined {
		const value = this.get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return value === 'true';
	}

	getNumber(key: string, fallbackValue: number): number;
	getNumber(key: string, fallbackValue?: number): number | undefined;
	getNumber(key: string, fallbackValue?: number): number | undefined {
		const value = this.get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return parseInt(value, 10);
	}

	async set(key: string, value: string | boolean | number | null | undefined): Promise<void> {
		if (this.state === StorageState.Closed) {
			return; // Return early if we are already closed
		}

		// We remove the key for undefined/null values
		if (isUndefinedOrNull(value)) {
			return this.delete(key);
		}

		// Otherwise, convert to String and store
		const valueStr = String(value);

		// Return early if value already set
		const currentValue = this.cache.get(key);
		if (currentValue === valueStr) {
			return;
		}

		// Update in cache and pending
		this.cache.set(key, valueStr);
		this.pendingInserts.set(key, valueStr);
		this.pendingDeletes.delete(key);

		// Event
		this._onDidChangeStorage.fire(key);

		// Accumulate work by scheduling after timeout
		return this.flushDelayer.trigger(() => this.flushPending());
	}

	async delete(key: string): Promise<void> {
		if (this.state === StorageState.Closed) {
			return; // Return early if we are already closed
		}

		// Remove from cache and add to pending
		const wasDeleted = this.cache.delete(key);
		if (!wasDeleted) {
			return; // Return early if value already deleted
		}

		if (!this.pendingDeletes.has(key)) {
			this.pendingDeletes.add(key);
		}

		this.pendingInserts.delete(key);

		// Event
		this._onDidChangeStorage.fire(key);

		// Accumulate work by scheduling after timeout
		return this.flushDelayer.trigger(() => this.flushPending());
	}

	async close(): Promise<void> {
		if (!this.pendingClose) {
			this.pendingClose = this.doClose();
		}

		return this.pendingClose;
	}

	private async doClose(): Promise<void> {

		// Update state
		this.state = StorageState.Closed;

		// Trigger new flush to ensure data is persisted and then close
		// even if there is an error flushing. We must always ensure
		// the DB is closed to avoid corruption.
		//
		// Recovery: we pass our cache over as recovery option in case
		// the DB is not healthy.
		try {
			await this.flushDelayer.trigger(() => this.flushPending(), 0 /* as soon as possible */);
		} catch (error) {
			// Ignore
		}

		await this.database.close(() => this.cache);
	}

	private get hasPending() {
		return this.pendingInserts.size > 0 || this.pendingDeletes.size > 0;
	}

	private async flushPending(): Promise<void> {
		if (!this.hasPending) {
			return; // return early if nothing to do
		}

		// Get pending data
		const updateRequest: IUpdateRequest = { insert: this.pendingInserts, delete: this.pendingDeletes };

		// Reset pending data for next run
		this.pendingDeletes = new Set<string>();
		this.pendingInserts = new Map<string, string>();

		// Update in storage and release any
		// waiters we have once done
		return this.database.updateItems(updateRequest).finally(() => {
			if (!this.hasPending) {
				while (this.whenFlushedCallbacks.length) {
					this.whenFlushedCallbacks.pop()?.();
				}
			}
		});
	}

	async whenFlushed(): Promise<void> {
		if (!this.hasPending) {
			return; // return early if nothing to do
		}

		return new Promise(resolve => this.whenFlushedCallbacks.push(resolve));
	}

	override dispose(): void {
		this.flushDelayer.cancel(); // workaround https://github.com/microsoft/vscode/issues/116777
		this.flushDelayer.dispose();

		super.dispose();
	}
}

export class InMemoryStorageDatabase implements IStorageDatabase {

	readonly onDidChangeItemsExternal = Event.None;

	private readonly items = new Map<string, string>();

	async getItems(): Promise<Map<string, string>> {
		return this.items;
	}

	async updateItems(request: IUpdateRequest): Promise<void> {
		if (request.insert) {
			request.insert.forEach((value, key) => this.items.set(key, value));
		}

		if (request.delete) {
			request.delete.forEach(key => this.items.delete(key));
		}
	}

	async close(): Promise<void> { }
}
