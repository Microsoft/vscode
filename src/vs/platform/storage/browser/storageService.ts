/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { IWorkspaceStorageChangeEvent, IStorageService, StorageScope, IWillSaveStateEvent, WillSaveStateReason, logStorage } from 'vs/platform/storage/common/storage';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IWorkspaceInitializationPayload } from 'vs/platform/workspaces/common/workspaces';
import { IFileService, FileChangeType } from 'vs/platform/files/common/files';
import { IStorage, Storage, IStorageDatabase, IStorageItemsChangeEvent, IUpdateRequest } from 'vs/base/parts/storage/common/storage';
import { URI } from 'vs/base/common/uri';
import { joinPath } from 'vs/base/common/resources';
import { runWhenIdle, RunOnceScheduler } from 'vs/base/common/async';
import { VSBuffer } from 'vs/base/common/buffer';
import { assertIsDefined, assertAllDefined } from 'vs/base/common/types';

export class BrowserStorageService extends Disposable implements IStorageService {

	declare readonly _serviceBrand: undefined;

	private static readonly WORKSPACE_IS_NEW_KEY = '__$__isNewStorageMarker';

	private readonly _onDidChangeStorage = this._register(new Emitter<IWorkspaceStorageChangeEvent>());
	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	private readonly _onWillSaveState = this._register(new Emitter<IWillSaveStateEvent>());
	readonly onWillSaveState = this._onWillSaveState.event;

	private globalStorage: IStorage | undefined;
	private workspaceStorage: IStorage | undefined;

	private globalStorageDatabase: FileStorageDatabase | undefined;
	private workspaceStorageDatabase: FileStorageDatabase | undefined;

	private globalStorageFile: URI | undefined;
	private workspaceStorageFile: URI | undefined;

	private initializePromise: Promise<void> | undefined;

	private readonly periodicFlushScheduler = this._register(new RunOnceScheduler(() => this.doFlushWhenIdle(), 5000 /* every 5s */));
	private runWhenIdleDisposable: IDisposable | undefined = undefined;

	constructor(
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IFileService private readonly fileService: IFileService
	) {
		super();
	}

	initialize(payload: IWorkspaceInitializationPayload): Promise<void> {
		if (!this.initializePromise) {
			this.initializePromise = this.doInitialize(payload);
		}

		return this.initializePromise;
	}

	private async doInitialize(payload: IWorkspaceInitializationPayload): Promise<void> {

		// Ensure state folder exists
		const stateRoot = joinPath(this.environmentService.userRoamingDataHome, 'state');
		await this.fileService.createFolder(stateRoot);

		// Workspace Storage
		this.workspaceStorageFile = joinPath(stateRoot, `${payload.id}.json`);

		this.workspaceStorageDatabase = this._register(new FileStorageDatabase(this.workspaceStorageFile, false /* do not watch for external changes */, this.fileService));
		this.workspaceStorage = this._register(new Storage(this.workspaceStorageDatabase));
		this._register(this.workspaceStorage.onDidChangeStorage(key => this._onDidChangeStorage.fire({ key, scope: StorageScope.WORKSPACE })));

		// Global Storage
		this.globalStorageFile = joinPath(stateRoot, 'global.json');
		this.globalStorageDatabase = this._register(new FileStorageDatabase(this.globalStorageFile, true /* watch for external changes */, this.fileService));
		this.globalStorage = this._register(new Storage(this.globalStorageDatabase));
		this._register(this.globalStorage.onDidChangeStorage(key => this._onDidChangeStorage.fire({ key, scope: StorageScope.GLOBAL })));

		// Init both
		await Promise.all([
			this.workspaceStorage.init(),
			this.globalStorage.init()
		]);

		// Check to see if this is the first time we are "opening" this workspace
		const firstOpen = this.workspaceStorage.getBoolean(BrowserStorageService.WORKSPACE_IS_NEW_KEY);
		if (firstOpen === undefined) {
			this.workspaceStorage.set(BrowserStorageService.WORKSPACE_IS_NEW_KEY, true);
		} else if (firstOpen) {
			this.workspaceStorage.set(BrowserStorageService.WORKSPACE_IS_NEW_KEY, false);
		}

		// In the browser we do not have support for long running unload sequences. As such,
		// we cannot ask for saving state in that moment, because that would result in a
		// long running operation.
		// Instead, periodically ask customers to save save. The library will be clever enough
		// to only save state that has actually changed.
		this.periodicFlushScheduler.schedule();
	}

	get(key: string, scope: StorageScope, fallbackValue: string): string;
	get(key: string, scope: StorageScope): string | undefined;
	get(key: string, scope: StorageScope, fallbackValue?: string): string | undefined {
		return this.getStorage(scope).get(key, fallbackValue);
	}

	getBoolean(key: string, scope: StorageScope, fallbackValue: boolean): boolean;
	getBoolean(key: string, scope: StorageScope): boolean | undefined;
	getBoolean(key: string, scope: StorageScope, fallbackValue?: boolean): boolean | undefined {
		return this.getStorage(scope).getBoolean(key, fallbackValue);
	}

	getNumber(key: string, scope: StorageScope, fallbackValue: number): number;
	getNumber(key: string, scope: StorageScope): number | undefined;
	getNumber(key: string, scope: StorageScope, fallbackValue?: number): number | undefined {
		return this.getStorage(scope).getNumber(key, fallbackValue);
	}

	store(key: string, value: string | boolean | number | undefined | null, scope: StorageScope): void {
		this.getStorage(scope).set(key, value);
	}

	remove(key: string, scope: StorageScope): void {
		this.getStorage(scope).delete(key);
	}

	private getStorage(scope: StorageScope): IStorage {
		return assertIsDefined(scope === StorageScope.GLOBAL ? this.globalStorage : this.workspaceStorage);
	}

	async logStorage(): Promise<void> {
		const [globalStorage, workspaceStorage, globalStorageFile, workspaceStorageFile] = assertAllDefined(this.globalStorage, this.workspaceStorage, this.globalStorageFile, this.workspaceStorageFile);

		const result = await Promise.all([
			globalStorage.items,
			workspaceStorage.items
		]);

		return logStorage(result[0], result[1], globalStorageFile.toString(), workspaceStorageFile.toString());
	}

	async migrate(toWorkspace: IWorkspaceInitializationPayload): Promise<void> {
		throw new Error('Migrating storage is currently unsupported in Web');
	}

	private doFlushWhenIdle(): void {

		// Dispose any previous idle runner
		dispose(this.runWhenIdleDisposable);

		// Run when idle
		this.runWhenIdleDisposable = runWhenIdle(() => {

			// this event will potentially cause new state to be stored
			// since new state will only be created while the document
			// has focus, one optimization is to not run this when the
			// document has no focus, assuming that state has not changed
			//
			// another optimization is to not collect more state if we
			// have a pending update already running which indicates
			// that the connection is either slow or disconnected and
			// thus unhealthy.
			if (document.hasFocus() && !this.hasPendingUpdate) {
				this.flush();
			}

			// repeat
			this.periodicFlushScheduler.schedule();
		});
	}

	get hasPendingUpdate(): boolean {
		return (!!this.globalStorageDatabase && this.globalStorageDatabase.hasPendingUpdate) || (!!this.workspaceStorageDatabase && this.workspaceStorageDatabase.hasPendingUpdate);
	}

	flush(): void {
		this._onWillSaveState.fire({ reason: WillSaveStateReason.NONE });
	}

	close(): void {
		// We explicitly do not close our DBs because writing data onBeforeUnload()
		// can result in unexpected results. Namely, it seems that - even though this
		// operation is async - sometimes it is being triggered on unload and
		// succeeds. Often though, the DBs turn out to be empty because the write
		// never had a chance to complete.
		//
		// Instead we trigger dispose() to ensure that no timeouts or callbacks
		// get triggered in this phase.
		this.dispose();
	}

	isNew(scope: StorageScope.WORKSPACE): boolean {
		return this.getBoolean(BrowserStorageService.WORKSPACE_IS_NEW_KEY, scope) === true;
	}

	dispose(): void {
		dispose(this.runWhenIdleDisposable);
		this.runWhenIdleDisposable = undefined;

		super.dispose();
	}
}

export class FileStorageDatabase extends Disposable implements IStorageDatabase {

	private readonly _onDidChangeItemsExternal = this._register(new Emitter<IStorageItemsChangeEvent>());
	readonly onDidChangeItemsExternal = this._onDidChangeItemsExternal.event;

	private cache: Map<string, string> | undefined;

	private pendingUpdate: Promise<void> = Promise.resolve();

	private _hasPendingUpdate = false;
	get hasPendingUpdate(): boolean {
		return this._hasPendingUpdate;
	}

	private isWatching = false;

	constructor(
		private readonly file: URI,
		private readonly watchForExternalChanges: boolean,
		@IFileService private readonly fileService: IFileService
	) {
		super();
	}

	private async ensureWatching(): Promise<void> {
		if (this.isWatching || !this.watchForExternalChanges) {
			return;
		}

		const exists = await this.fileService.exists(this.file);
		if (this.isWatching || !exists) {
			return; // file must exist to be watched
		}

		this.isWatching = true;

		this._register(this.fileService.watch(this.file));
		this._register(this.fileService.onDidFilesChange(e => {
			if (document.hasFocus()) {
				return; // optimization: ignore changes from ourselves by checking for focus
			}

			if (!e.contains(this.file, FileChangeType.UPDATED)) {
				return; // not our file
			}

			this.onDidStorageChangeExternal();
		}));
	}

	private async onDidStorageChangeExternal(): Promise<void> {
		const items = await this.doGetItemsFromFile();

		// pervious cache, diff for changes
		let changed = new Map<string, string>();
		let deleted = new Set<string>();
		if (this.cache) {
			items.forEach((value, key) => {
				const existingValue = this.cache?.get(key);
				if (existingValue !== value) {
					changed.set(key, value);
				}
			});

			this.cache.forEach((_, key) => {
				if (!items.has(key)) {
					deleted.add(key);
				}
			});
		}

		// no previous cache, consider all as changed
		else {
			changed = items;
		}

		// Update cache
		this.cache = items;

		// Emit as event as needed
		if (changed.size > 0 || deleted.size > 0) {
			this._onDidChangeItemsExternal.fire({ changed, deleted });
		}
	}

	async getItems(): Promise<Map<string, string>> {
		if (!this.cache) {
			try {
				this.cache = await this.doGetItemsFromFile();
			} catch (error) {
				this.cache = new Map();
			}
		}

		return this.cache;
	}

	private async doGetItemsFromFile(): Promise<Map<string, string>> {
		await this.pendingUpdate;

		const itemsRaw = await this.fileService.readFile(this.file);

		this.ensureWatching(); // now that the file must exist, ensure we watch it for changes

		return new Map(JSON.parse(itemsRaw.value.toString()));
	}

	async updateItems(request: IUpdateRequest): Promise<void> {
		const items = await this.getItems();

		if (request.insert) {
			request.insert.forEach((value, key) => items.set(key, value));
		}

		if (request.delete) {
			request.delete.forEach(key => items.delete(key));
		}

		await this.pendingUpdate;

		this.pendingUpdate = (async () => {
			try {
				this._hasPendingUpdate = true;

				await this.fileService.writeFile(this.file, VSBuffer.fromString(JSON.stringify(Array.from(items.entries()))));

				this.ensureWatching(); // now that the file must exist, ensure we watch it for changes
			} finally {
				this._hasPendingUpdate = false;
			}
		})();

		return this.pendingUpdate;
	}

	close(): Promise<void> {
		return this.pendingUpdate;
	}
}
