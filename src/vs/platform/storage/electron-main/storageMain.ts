/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises } from 'fs';
import { exists, writeFile } from 'vs/base/node/pfs';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { ILogService, LogLevel } from 'vs/platform/log/common/log';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { SQLiteStorageDatabase, ISQLiteStorageDatabaseLoggingOptions } from 'vs/base/parts/storage/node/storage';
import { Storage, InMemoryStorageDatabase, StorageHint, IStorage } from 'vs/base/parts/storage/common/storage';
import { join } from 'vs/base/common/path';
import { IS_NEW_KEY } from 'vs/platform/storage/common/storage';
import { currentSessionDateStorageKey, firstSessionDateStorageKey, instanceStorageKey, lastSessionDateStorageKey } from 'vs/platform/telemetry/common/telemetry';
import { generateUuid } from 'vs/base/common/uuid';
import { IEmptyWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier, isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier, IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';

export interface IStorageMainOptions {

	/**
	 * If enabled, storage will not persist to disk
	 * but into memory.
	 */
	useInMemoryStorage?: boolean;
}

/**
 * Provides access to global and workspace storage from the
 * electron-main side that is the owner of all storage connections.
 */
export interface IStorageMain extends IDisposable {

	/**
	 * Emitted whenever data is updated or deleted.
	 */
	readonly onDidChangeStorage: Event<IStorageChangeEvent>;

	/**
	 * Emitted when the storage is closed.
	 */
	readonly onDidCloseStorage: Event<void>;

	/**
	 * Access to all cached items of this storage service.
	 */
	readonly items: Map<string, string>;

	/**
	 * Required call to ensure the service can be used.
	 */
	init(): Promise<void>;

	/**
	 * Retrieve an element stored with the given key from storage. Use
	 * the provided defaultValue if the element is null or undefined.
	 */
	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;

	/**
	 * Store a string value under the given key to storage. The value will
	 * be converted to a string.
	 */
	set(key: string, value: string | boolean | number | undefined | null): void;

	/**
	 * Delete an element stored under the provided key from storage.
	 */
	delete(key: string): void;

	/**
	 * Close the storage connection.
	 */
	close(): Promise<void>;
}

export interface IStorageChangeEvent {
	key: string;
}

abstract class BaseStorageMain extends Disposable implements IStorageMain {

	protected readonly _onDidChangeStorage = this._register(new Emitter<IStorageChangeEvent>());
	readonly onDidChangeStorage = this._onDidChangeStorage.event;

	private readonly _onDidCloseStorage = this._register(new Emitter<void>());
	readonly onDidCloseStorage = this._onDidCloseStorage.event;

	private storage: IStorage = new Storage(new InMemoryStorageDatabase()); // storage is in-memory until initialized

	private initializePromise: Promise<void> | undefined = undefined;

	constructor(
		protected readonly logService: ILogService
	) {
		super();
	}

	init(): Promise<void> {
		if (!this.initializePromise) {
			this.initializePromise = (async () => {
				try {

					// Create storage via subclasses
					const storage = await this.doCreate();

					// Replace our in-memory storage with the real
					// once as soon as possible without awaiting
					// the init call.
					this.storage.dispose();
					this.storage = storage;

					// Re-emit storage changes via event
					this._register(storage.onDidChangeStorage(key => this._onDidChangeStorage.fire({ key })));

					// Await storage init
					await this.doInit(storage);

					// Ensure we track wether storage is new or not
					const isNewStorage = storage.getBoolean(IS_NEW_KEY);
					if (isNewStorage === undefined) {
						storage.set(IS_NEW_KEY, true);
					} else if (isNewStorage) {
						storage.set(IS_NEW_KEY, false);
					}
				} catch (error) {
					this.logService.error(`StorageMain#initialize(): Unable to init storage due to ${error}`);
				}
			})();
		}

		return this.initializePromise;
	}

	protected createLogginOptions(): ISQLiteStorageDatabaseLoggingOptions {
		return {
			logTrace: (this.logService.getLevel() === LogLevel.Trace) ? msg => this.logService.trace(msg) : undefined,
			logError: error => this.logService.error(error)
		};
	}

	protected doInit(storage: IStorage): Promise<void> {
		return storage.init();
	}

	protected abstract doCreate(): Promise<IStorage>;

	get items(): Map<string, string> { return this.storage.items; }

	get(key: string, fallbackValue: string): string;
	get(key: string, fallbackValue?: string): string | undefined;
	get(key: string, fallbackValue?: string): string | undefined {
		return this.storage.get(key, fallbackValue);
	}

	set(key: string, value: string | boolean | number | undefined | null): Promise<void> {
		return this.storage.set(key, value);
	}

	delete(key: string): Promise<void> {
		return this.storage.delete(key);
	}

	async close(): Promise<void> {

		// Ensure we are not accidentally leaving
		// a pending initialized storage behind in
		// case close() was called before init()
		// finishes
		if (this.initializePromise) {
			await this.initializePromise;
		}

		// Propagate to storage lib
		await this.storage.close();

		// Signal as event
		this._onDidCloseStorage.fire();
	}
}

export class GlobalStorageMain extends BaseStorageMain implements IStorageMain {

	private static readonly STORAGE_NAME = 'state.vscdb';

	constructor(
		private readonly options: IStorageMainOptions,
		logService: ILogService,
		private readonly environmentService: IEnvironmentService
	) {
		super(logService);
	}

	protected async doCreate(): Promise<IStorage> {
		let storagePath: string;
		if (this.options.useInMemoryStorage) {
			storagePath = SQLiteStorageDatabase.IN_MEMORY_PATH;
		} else {
			storagePath = join(this.environmentService.globalStorageHome.fsPath, GlobalStorageMain.STORAGE_NAME);
		}

		return new Storage(new SQLiteStorageDatabase(storagePath, {
			logging: this.createLogginOptions()
		}));
	}

	protected override async doInit(storage: IStorage): Promise<void> {
		await super.doInit(storage);

		// Apply global telemetry values as part of the initialization
		this.updateTelemetryState(storage);
	}

	private updateTelemetryState(storage: IStorage): void {

		// Instance UUID (once)
		const instanceId = storage.get(instanceStorageKey, undefined);
		if (instanceId === undefined) {
			storage.set(instanceStorageKey, generateUuid());
		}

		// First session date (once)
		const firstSessionDate = storage.get(firstSessionDateStorageKey, undefined);
		if (firstSessionDate === undefined) {
			storage.set(firstSessionDateStorageKey, new Date().toUTCString());
		}

		// Last / current session (always)
		// previous session date was the "current" one at that time
		// current session date is "now"
		const lastSessionDate = storage.get(currentSessionDateStorageKey, undefined);
		const currentSessionDate = new Date().toUTCString();
		storage.set(lastSessionDateStorageKey, typeof lastSessionDate === 'undefined' ? null : lastSessionDate);
		storage.set(currentSessionDateStorageKey, currentSessionDate);
	}
}

export class WorkspaceStorageMain extends BaseStorageMain implements IStorageMain {

	private static readonly WORKSPACE_STORAGE_NAME = 'state.vscdb';
	private static readonly WORKSPACE_META_NAME = 'workspace.json';

	constructor(
		private workspace: IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier | IEmptyWorkspaceIdentifier,
		private readonly options: IStorageMainOptions,
		logService: ILogService,
		private readonly environmentService: IEnvironmentService
	) {
		super(logService);
	}

	protected async doCreate(): Promise<IStorage> {
		const { storageFilePath, wasCreated } = await this.prepareWorkspaceStorageFolder();

		return new Storage(new SQLiteStorageDatabase(storageFilePath, {
			logging: this.createLogginOptions()
		}), { hint: wasCreated ? StorageHint.STORAGE_DOES_NOT_EXIST : undefined });
	}

	private async prepareWorkspaceStorageFolder(): Promise<{ storageFilePath: string, wasCreated: boolean }> {

		// Return early if using inMemory storage
		if (this.options.useInMemoryStorage) {
			return { storageFilePath: SQLiteStorageDatabase.IN_MEMORY_PATH, wasCreated: true };
		}

		// Otherwise, ensure the storage folder exists on disk
		const workspaceStorageFolderPath = join(this.environmentService.workspaceStorageHome.fsPath, this.workspace.id);
		const workspaceStorageDatabasePath = join(workspaceStorageFolderPath, WorkspaceStorageMain.WORKSPACE_STORAGE_NAME);

		const storageExists = await exists(workspaceStorageFolderPath);
		if (storageExists) {
			return { storageFilePath: workspaceStorageDatabasePath, wasCreated: false };
		}

		// Ensure storage folder exists
		await promises.mkdir(workspaceStorageFolderPath, { recursive: true });

		// Write metadata into folder (but do not await)
		this.ensureWorkspaceStorageFolderMeta(workspaceStorageFolderPath);

		return { storageFilePath: workspaceStorageDatabasePath, wasCreated: true };
	}

	private async ensureWorkspaceStorageFolderMeta(workspaceStorageFolderPath: string): Promise<void> {
		let meta: object | undefined = undefined;
		if (isSingleFolderWorkspaceIdentifier(this.workspace)) {
			meta = { folder: this.workspace.uri.toString() };
		} else if (isWorkspaceIdentifier(this.workspace)) {
			meta = { workspace: this.workspace.configPath.toString() };
		}

		if (meta) {
			try {
				const workspaceStorageMetaPath = join(workspaceStorageFolderPath, WorkspaceStorageMain.WORKSPACE_META_NAME);
				const storageExists = await exists(workspaceStorageMetaPath);
				if (!storageExists) {
					await writeFile(workspaceStorageMetaPath, JSON.stringify(meta, undefined, 2));
				}
			} catch (error) {
				this.logService.error(`StorageMain#ensureWorkspaceStorageFolderMeta(): Unable to create workspace storage metadata due to ${error}`);
			}
		}
	}
}
