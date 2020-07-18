/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { ILogService, LogLevel } from 'vs/platform/log/common/log';
import { IWorkspaceStorageChangeEvent, IStorageService, StorageScope, IWillSaveStateEvent, WillSaveStateReason, logStorage } from 'vs/platform/storage/common/storage';
import { SQLiteStorageDatabase, ISQLiteStorageDatabaseLoggingOptions } from 'vs/base/parts/storage/node/storage';
import { Storage, IStorageDatabase, IStorage, StorageHint } from 'vs/base/parts/storage/common/storage';
import { mark } from 'vs/base/common/performance';
import { join } from 'vs/base/common/path';
import { copy, exists, mkdirp, writeFile } from 'vs/base/node/pfs';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IWorkspaceInitializationPayload, isWorkspaceIdentifier, isSingleFolderWorkspaceInitializationPayload } from 'vs/platform/workspaces/common/workspaces';
import { assertIsDefined } from 'vs/base/common/types';
import { RunOnceScheduler, runWhenIdle } from 'vs/base/common/async';

export class NativeStorageService extends Disposable implements IStorageService {

	declare readonly _serviceBrand: undefined;

	private static readonly WORKSPACE_STORAGE_NAME = 'state.vscdb';
	private static readonly WORKSPACE_META_NAME = 'workspace.json';

	private static readonly WORKSPACE_IS_NEW_KEY = '__$__isNewStorageMarker';

	private readonly _onDidChangeStorage = this._register(new Emitter<IWorkspaceStorageChangeEvent>());
	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	private readonly _onWillSaveState = this._register(new Emitter<IWillSaveStateEvent>());
	readonly onWillSaveState = this._onWillSaveState.event;

	private readonly globalStorage = new Storage(this.globalStorageDatabase);

	private workspaceStoragePath: string | undefined;
	private workspaceStorage: IStorage | undefined;
	private workspaceStorageListener: IDisposable | undefined;

	private initializePromise: Promise<void> | undefined;

	private readonly periodicFlushScheduler = this._register(new RunOnceScheduler(() => this.doFlushWhenIdle(), 60000 /* every minute */));
	private runWhenIdleDisposable: IDisposable | undefined = undefined;

	constructor(
		private globalStorageDatabase: IStorageDatabase,
		@ILogService private readonly logService: ILogService,
		@IEnvironmentService private readonly environmentService: INativeEnvironmentService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		// Global Storage change events
		this._register(this.globalStorage.onDidChangeStorage(key => this.handleDidChangeStorage(key, StorageScope.GLOBAL)));
	}

	private handleDidChangeStorage(key: string, scope: StorageScope): void {
		this._onDidChangeStorage.fire({ key, scope });
	}

	initialize(payload?: IWorkspaceInitializationPayload): Promise<void> {
		if (!this.initializePromise) {
			this.initializePromise = this.doInitialize(payload);
		}

		return this.initializePromise;
	}

	private async doInitialize(payload?: IWorkspaceInitializationPayload): Promise<void> {

		// Init all storage locations
		await Promise.all([
			this.initializeGlobalStorage(),
			payload ? this.initializeWorkspaceStorage(payload) : Promise.resolve()
		]);

		// On some OS we do not get enough time to persist state on shutdown (e.g. when
		// Windows restarts after applying updates). In other cases, VSCode might crash,
		// so we periodically save state to reduce the chance of loosing any state.
		this.periodicFlushScheduler.schedule();
	}

	private initializeGlobalStorage(): Promise<void> {
		return this.globalStorage.init();
	}

	private async initializeWorkspaceStorage(payload: IWorkspaceInitializationPayload): Promise<void> {

		// Prepare workspace storage folder for DB
		try {
			const result = await this.prepareWorkspaceStorageFolder(payload);

			const useInMemoryStorage = !!this.environmentService.extensionTestsLocationURI; // no storage during extension tests!

			// Create workspace storage and initialize
			mark('willInitWorkspaceStorage');
			try {
				const workspaceStorage = this.createWorkspaceStorage(
					useInMemoryStorage ? SQLiteStorageDatabase.IN_MEMORY_PATH : join(result.path, NativeStorageService.WORKSPACE_STORAGE_NAME),
					result.wasCreated ? StorageHint.STORAGE_DOES_NOT_EXIST : undefined
				);
				await workspaceStorage.init();

				// Check to see if this is the first time we are "opening" this workspace
				const firstOpen = workspaceStorage.getBoolean(NativeStorageService.WORKSPACE_IS_NEW_KEY);
				if (firstOpen === undefined) {
					workspaceStorage.set(NativeStorageService.WORKSPACE_IS_NEW_KEY, result.wasCreated);
				} else if (firstOpen) {
					workspaceStorage.set(NativeStorageService.WORKSPACE_IS_NEW_KEY, false);
				}
			} finally {
				mark('didInitWorkspaceStorage');
			}
		} catch (error) {
			this.logService.error(`[storage] initializeWorkspaceStorage(): Unable to init workspace storage due to ${error}`);
		}
	}

	private createWorkspaceStorage(workspaceStoragePath: string, hint?: StorageHint): IStorage {

		// Logger for workspace storage
		const workspaceLoggingOptions: ISQLiteStorageDatabaseLoggingOptions = {
			logTrace: (this.logService.getLevel() === LogLevel.Trace) ? msg => this.logService.trace(msg) : undefined,
			logError: error => this.logService.error(error)
		};

		// Dispose old (if any)
		dispose(this.workspaceStorage);
		dispose(this.workspaceStorageListener);

		// Create new
		this.workspaceStoragePath = workspaceStoragePath;
		this.workspaceStorage = new Storage(new SQLiteStorageDatabase(workspaceStoragePath, { logging: workspaceLoggingOptions }), { hint });
		this.workspaceStorageListener = this.workspaceStorage.onDidChangeStorage(key => this.handleDidChangeStorage(key, StorageScope.WORKSPACE));

		return this.workspaceStorage;
	}

	private getWorkspaceStorageFolderPath(payload: IWorkspaceInitializationPayload): string {
		return join(this.environmentService.workspaceStorageHome.fsPath, payload.id); // workspace home + workspace id;
	}

	private async prepareWorkspaceStorageFolder(payload: IWorkspaceInitializationPayload): Promise<{ path: string, wasCreated: boolean }> {
		const workspaceStorageFolderPath = this.getWorkspaceStorageFolderPath(payload);

		const storageExists = await exists(workspaceStorageFolderPath);
		if (storageExists) {
			return { path: workspaceStorageFolderPath, wasCreated: false };
		}

		await mkdirp(workspaceStorageFolderPath);

		// Write metadata into folder
		this.ensureWorkspaceStorageFolderMeta(payload);

		return { path: workspaceStorageFolderPath, wasCreated: true };
	}

	private ensureWorkspaceStorageFolderMeta(payload: IWorkspaceInitializationPayload): void {
		let meta: object | undefined = undefined;
		if (isSingleFolderWorkspaceInitializationPayload(payload)) {
			meta = { folder: payload.folder.toString() };
		} else if (isWorkspaceIdentifier(payload)) {
			meta = { configuration: payload.configPath };
		}

		if (meta) {
			const logService = this.logService;
			const workspaceStorageMetaPath = join(this.getWorkspaceStorageFolderPath(payload), NativeStorageService.WORKSPACE_META_NAME);
			(async function () {
				try {
					const storageExists = await exists(workspaceStorageMetaPath);
					if (!storageExists) {
						await writeFile(workspaceStorageMetaPath, JSON.stringify(meta, undefined, 2));
					}
				} catch (error) {
					logService.error(error);
				}
			})();
		}
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

	private doFlushWhenIdle(): void {

		// Dispose any previous idle runner
		dispose(this.runWhenIdleDisposable);

		// Run when idle
		this.runWhenIdleDisposable = runWhenIdle(() => {

			// send event to collect state
			this.flush();

			// repeat
			this.periodicFlushScheduler.schedule();
		});
	}

	flush(): void {
		this._onWillSaveState.fire({ reason: WillSaveStateReason.NONE });
	}

	async close(): Promise<void> {

		// Stop periodic scheduler and idle runner as we now collect state normally
		this.periodicFlushScheduler.dispose();
		dispose(this.runWhenIdleDisposable);
		this.runWhenIdleDisposable = undefined;

		// Signal as event so that clients can still store data
		this._onWillSaveState.fire({ reason: WillSaveStateReason.SHUTDOWN });

		// Do it
		await Promise.all([
			this.globalStorage.close(),
			this.workspaceStorage ? this.workspaceStorage.close() : Promise.resolve()
		]);
	}

	async logStorage(): Promise<void> {
		return logStorage(
			this.globalStorage.items,
			this.workspaceStorage ? this.workspaceStorage.items : new Map<string, string>(), // Shared process storage does not has workspace storage
			this.environmentService.globalStorageHome.fsPath,
			this.workspaceStoragePath || '');
	}

	async migrate(toWorkspace: IWorkspaceInitializationPayload): Promise<void> {
		if (this.workspaceStoragePath === SQLiteStorageDatabase.IN_MEMORY_PATH) {
			return; // no migration needed if running in memory
		}

		// Close workspace DB to be able to copy
		await this.getStorage(StorageScope.WORKSPACE).close();

		// Prepare new workspace storage folder
		const result = await this.prepareWorkspaceStorageFolder(toWorkspace);

		const newWorkspaceStoragePath = join(result.path, NativeStorageService.WORKSPACE_STORAGE_NAME);

		// Copy current storage over to new workspace storage
		await copy(assertIsDefined(this.workspaceStoragePath), newWorkspaceStoragePath);

		// Recreate and init workspace storage
		return this.createWorkspaceStorage(newWorkspaceStoragePath).init();
	}

	isNew(scope: StorageScope.WORKSPACE): boolean {
		return this.getBoolean(NativeStorageService.WORKSPACE_IS_NEW_KEY, scope) === true;
	}
}
