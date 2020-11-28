/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event, Emitter, PauseableEmitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { isUndefinedOrNull } from 'vs/base/common/types';
import { IWorkspaceInitializationPayload } from 'vs/platform/workspaces/common/workspaces';

export const IS_NEW_KEY = '__$__isNewStorageMarker';
const TARGET_KEY = '__$__targetStorageMarker';

export const IStorageService = createDecorator<IStorageService>('storageService');

export enum WillSaveStateReason {

	/**
	 * No specific reason to save state.
	 */
	NONE,

	/**
	 * A hint that the workbench is about to shutdown.
	 */
	SHUTDOWN
}

export interface IWillSaveStateEvent {
	reason: WillSaveStateReason;
}

export interface IStorageService {

	readonly _serviceBrand: undefined;

	/**
	 * Emitted whenever data is updated or deleted.
	 */
	readonly onDidChangeValue: Event<IStorageValueChangeEvent>;

	/**
	 * Emitted whenever target of a storage entry changes.
	 */
	readonly onDidChangeTarget: Event<IStorageTargetChangeEvent>;

	/**
	 * Emitted when the storage is about to persist. This is the right time
	 * to persist data to ensure it is stored before the application shuts
	 * down.
	 *
	 * The will save state event allows to optionally ask for the reason of
	 * saving the state, e.g. to find out if the state is saved due to a
	 * shutdown.
	 *
	 * Note: this event may be fired many times, not only on shutdown to prevent
	 * loss of state in situations where the shutdown is not sufficient to
	 * persist the data properly.
	 */
	readonly onWillSaveState: Event<IWillSaveStateEvent>;

	/**
	 * Retrieve an element stored with the given key from storage. Use
	 * the provided `defaultValue` if the element is `null` or `undefined`.
	 *
	 * @param scope allows to define the scope of the storage operation
	 * to either the current workspace only or all workspaces.
	 */
	get(key: string, scope: StorageScope, fallbackValue: string): string;
	get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined;

	/**
	 * Retrieve an element stored with the given key from storage. Use
	 * the provided `defaultValue` if the element is `null` or `undefined`.
	 * The element will be converted to a `boolean`.
	 *
	 * @param scope allows to define the scope of the storage operation
	 * to either the current workspace only or all workspaces.
	 */
	getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean;
	getBoolean(key: string, scope: StorageScope, fallbackValue?: boolean): boolean | undefined;

	/**
	 * Retrieve an element stored with the given key from storage. Use
	 * the provided `defaultValue` if the element is `null` or `undefined`.
	 * The element will be converted to a `number` using `parseInt` with a
	 * base of `10`.
	 *
	 * @param scope allows to define the scope of the storage operation
	 * to either the current workspace only or all workspaces.
	 */
	getNumber(key: string, scope: StorageScope, fallbackValue: number): number;
	getNumber(key: string, scope: StorageScope, fallbackValue?: number): number | undefined;

	/**
	 * Store a value under the given key to storage. The value will be
	 * converted to a `string`. Storing either `undefined` or `null` will
	 * remove the entry under the key.
	 *
	 * @param scope allows to define the scope of the storage operation
	 * to either the current workspace only or all workspaces.
	 *
	 * @param target allows to define the target of the storage operation
	 * to either the current machine or user.
	 */
	store(key: string, value: string | boolean | number | undefined | null, scope: StorageScope, target: StorageTarget): void;

	/**
	 * Delete an element stored under the provided key from storage.
	 *
	 * The scope argument allows to define the scope of the storage
	 * operation to either the current workspace only or all workspaces.
	 */
	remove(key: string, scope: StorageScope): void;

	/**
	 * Returns all the keys used in the storage for the provided `scope`
	 * and `target`.
	 *
	 * Note: this will NOT return all keys stored in the storage layer.
	 * Some keys may not have an associated `StorageTarget` and thus
	 * will be excluded from the results.
	 *
	 * @param scope allows to define the scope for the keys
	 * to either the current workspace only or all workspaces.
	 *
	 * @param target allows to define the target for the keys
	 * to either the current machine or user.
	 */
	keys(scope: StorageScope, target: StorageTarget): string[];

	/**
	 * Log the contents of the storage to the console.
	 */
	logStorage(): void;

	/**
	 * Migrate the storage contents to another workspace.
	 */
	migrate(toWorkspace: IWorkspaceInitializationPayload): Promise<void>;

	/**
	 * Whether the storage for the given scope was created during this session or
	 * existed before.
	 */
	isNew(scope: StorageScope): boolean;

	/**
	 * Allows to flush state, e.g. in cases where a shutdown is
	 * imminent. This will send out the `onWillSaveState` to ask
	 * everyone for latest state.
	 *
	 * @returns a `Promise` that can be awaited on when all updates
	 * to the underlying storage have been flushed.
	 */
	flush(): Promise<void>;
}

export const enum StorageScope {

	/**
	 * The stored data will be scoped to all workspaces.
	 */
	GLOBAL,

	/**
	 * The stored data will be scoped to the current workspace.
	 */
	WORKSPACE
}

export const enum StorageTarget {

	/**
	 * The stored data is user specific and applies across machines.
	 */
	USER,

	/**
	 * The stored data is machine specific.
	 */
	MACHINE
}

export interface IStorageValueChangeEvent {

	/**
	 * The scope for the storage entry that changed
	 * or was removed.
	 */
	readonly scope: StorageScope;

	/**
	 * The `key` of the storage entry that was changed
	 * or was removed.
	 */
	readonly key: string;

	/**
	 * The `target` can be `undefined` if a key is being
	 * removed.
	 */
	readonly target: StorageTarget | undefined;
}

export interface IStorageTargetChangeEvent {

	/**
	 * The scope for the target that changed. Listeners
	 * should use `keys(scope, target)` to get an updated
	 * list of keys for the given `scope` and `target`.
	 */
	readonly scope: StorageScope;
}

interface IKeyTargets {
	[key: string]: StorageTarget
}

export abstract class AbstractStorageService extends Disposable implements IStorageService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeValue = this._register(new PauseableEmitter<IStorageValueChangeEvent>());
	readonly onDidChangeValue = this._onDidChangeValue.event;

	private readonly _onDidChangeTarget = this._register(new PauseableEmitter<IStorageTargetChangeEvent>());
	readonly onDidChangeTarget = this._onDidChangeTarget.event;

	private readonly _onWillSaveState = this._register(new Emitter<IWillSaveStateEvent>());
	readonly onWillSaveState = this._onWillSaveState.event;

	protected emitDidChangeValue(scope: StorageScope, key: string): void {

		// Specially handle `TARGET_KEY`
		if (key === TARGET_KEY) {

			// Clear our cached version which is now out of date
			if (scope === StorageScope.GLOBAL) {
				this._globalKeyTargets = undefined;
			} else if (scope === StorageScope.WORKSPACE) {
				this._workspaceKeyTargets = undefined;
			}

			// Emit as `didChangeTarget` event
			this._onDidChangeTarget.fire({ scope });
		}

		// Emit any other key to outside
		else {
			this._onDidChangeValue.fire({ scope, key, target: this.getKeyTargets(scope)[key] });
		}
	}

	protected emitWillSaveState(reason: WillSaveStateReason): void {
		this._onWillSaveState.fire({ reason });
	}

	store(key: string, value: string | boolean | number | undefined | null, scope: StorageScope, target: StorageTarget): void {

		// We remove the key for undefined/null values
		if (isUndefinedOrNull(value)) {
			this.remove(key, scope);
			return;
		}

		// Update our datastructures but send events only after
		this.withPausedEmitters(() => {

			// Update key-target map
			this.updateKeyTarget(key, scope, target);

			// Store actual value
			this.doStore(key, value, scope);
		});
	}

	remove(key: string, scope: StorageScope): void {

		// Update our datastructures but send events only after
		this.withPausedEmitters(() => {

			// Update key-target map
			this.updateKeyTarget(key, scope, undefined);

			// Remove actual key
			this.doRemove(key, scope);
		});
	}

	private withPausedEmitters(fn: Function): void {

		// Pause emitters
		this._onDidChangeValue.pause();
		this._onDidChangeTarget.pause();

		try {
			fn();
		} finally {

			// Resume emitters
			this._onDidChangeValue.resume();
			this._onDidChangeTarget.resume();
		}
	}

	keys(scope: StorageScope, target: StorageTarget): string[] {
		const keys: string[] = [];

		const keyTargets = this.getKeyTargets(scope);
		for (const key of Object.keys(keyTargets)) {
			const keyTarget = keyTargets[key];
			if (keyTarget === target) {
				keys.push(key);
			}
		}

		return keys;
	}

	private updateKeyTarget(key: string, scope: StorageScope, target: StorageTarget | undefined): void {

		// Add
		const keyTargets = this.getKeyTargets(scope);
		if (typeof target === 'number') {
			if (keyTargets[key] !== target) {
				keyTargets[key] = target;
				this.doStore(TARGET_KEY, JSON.stringify(keyTargets), scope);
			}
		}

		// Remove
		else {
			if (typeof keyTargets[key] === 'number') {
				delete keyTargets[key];
				this.doStore(TARGET_KEY, JSON.stringify(keyTargets), scope);
			}
		}
	}

	private _workspaceKeyTargets: IKeyTargets | undefined = undefined;
	private get workspaceKeyTargets(): IKeyTargets {
		if (!this._workspaceKeyTargets) {
			this._workspaceKeyTargets = this.loadKeyTargets(StorageScope.WORKSPACE);
		}

		return this._workspaceKeyTargets;
	}

	private _globalKeyTargets: IKeyTargets | undefined = undefined;
	private get globalKeyTargets(): IKeyTargets {
		if (!this._globalKeyTargets) {
			this._globalKeyTargets = this.loadKeyTargets(StorageScope.GLOBAL);
		}

		return this._globalKeyTargets;
	}

	private getKeyTargets(scope: StorageScope): IKeyTargets {
		return scope === StorageScope.GLOBAL ? this.globalKeyTargets : this.workspaceKeyTargets;
	}

	private loadKeyTargets(scope: StorageScope): { [key: string]: StorageTarget } {
		const keysRaw = this.get(TARGET_KEY, scope);
		if (keysRaw) {
			try {
				return JSON.parse(keysRaw);
			} catch (error) {
				// Fail gracefully
			}
		}

		return Object.create(null);
	}

	isNew(scope: StorageScope): boolean {
		return this.getBoolean(IS_NEW_KEY, scope) === true;
	}

	flush(): Promise<void> {

		// Signal event to collect changes
		this._onWillSaveState.fire({ reason: WillSaveStateReason.NONE });

		// Await flush
		return this.doFlush();
	}

	// --- abstract

	abstract get(key: string, scope: StorageScope, fallbackValue: string): string;
	abstract get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined;

	abstract getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean;
	abstract getBoolean(key: string, scope: StorageScope, fallbackValue?: boolean): boolean | undefined;

	abstract getNumber(key: string, scope: StorageScope, fallbackValue: number): number;
	abstract getNumber(key: string, scope: StorageScope, fallbackValue?: number): number | undefined;

	protected abstract doStore(key: string, value: string | boolean | number, scope: StorageScope): void;

	protected abstract doRemove(key: string, scope: StorageScope): void;

	protected abstract doFlush(): Promise<void>;

	abstract migrate(toWorkspace: IWorkspaceInitializationPayload): Promise<void>;

	abstract logStorage(): void;
}

export class InMemoryStorageService extends AbstractStorageService {

	private readonly globalCache = new Map<string, string>();
	private readonly workspaceCache = new Map<string, string>();

	private getCache(scope: StorageScope): Map<string, string> {
		return scope === StorageScope.GLOBAL ? this.globalCache : this.workspaceCache;
	}

	get(key: string, scope: StorageScope, fallbackValue: string): string;
	get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined {
		const value = this.getCache(scope).get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return value;
	}

	getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean;
	getBoolean(key: string, scope: StorageScope, fallbackValue?: boolean): boolean | undefined {
		const value = this.getCache(scope).get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return value === 'true';
	}

	getNumber(key: string, scope: StorageScope, fallbackValue: number): number;
	getNumber(key: string, scope: StorageScope, fallbackValue?: number): number | undefined {
		const value = this.getCache(scope).get(key);

		if (isUndefinedOrNull(value)) {
			return fallbackValue;
		}

		return parseInt(value, 10);
	}

	protected doStore(key: string, value: string | boolean | number, scope: StorageScope): void {

		// Otherwise, convert to String and store
		const valueStr = String(value);

		// Return early if value already set
		const currentValue = this.getCache(scope).get(key);
		if (currentValue === valueStr) {
			return;
		}

		// Update in cache
		this.getCache(scope).set(key, valueStr);

		// Events
		this.emitDidChangeValue(scope, key);
	}

	protected doRemove(key: string, scope: StorageScope): void {
		const wasDeleted = this.getCache(scope).delete(key);
		if (!wasDeleted) {
			return; // Return early if value already deleted
		}

		// Events
		this.emitDidChangeValue(scope, key);
	}

	logStorage(): void {
		logStorage(this.globalCache, this.workspaceCache, 'inMemory', 'inMemory');
	}

	async migrate(toWorkspace: IWorkspaceInitializationPayload): Promise<void> {
		// not supported
	}

	async doFlush(): Promise<void> { }

	async close(): Promise<void> { }
}

export async function logStorage(global: Map<string, string>, workspace: Map<string, string>, globalPath: string, workspacePath: string): Promise<void> {
	const safeParse = (value: string) => {
		try {
			return JSON.parse(value);
		} catch (error) {
			return value;
		}
	};

	const globalItems = new Map<string, string>();
	const globalItemsParsed = new Map<string, string>();
	global.forEach((value, key) => {
		globalItems.set(key, value);
		globalItemsParsed.set(key, safeParse(value));
	});

	const workspaceItems = new Map<string, string>();
	const workspaceItemsParsed = new Map<string, string>();
	workspace.forEach((value, key) => {
		workspaceItems.set(key, value);
		workspaceItemsParsed.set(key, safeParse(value));
	});

	console.group(`Storage: Global (path: ${globalPath})`);
	let globalValues: { key: string, value: string }[] = [];
	globalItems.forEach((value, key) => {
		globalValues.push({ key, value });
	});
	console.table(globalValues);
	console.groupEnd();

	console.log(globalItemsParsed);

	console.group(`Storage: Workspace (path: ${workspacePath})`);
	let workspaceValues: { key: string, value: string }[] = [];
	workspaceItems.forEach((value, key) => {
		workspaceValues.push({ key, value });
	});
	console.table(workspaceValues);
	console.groupEnd();

	console.log(workspaceItemsParsed);
}
