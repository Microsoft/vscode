/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'vs/base/common/path';
import { promises } from 'fs';
import { writeFile } from 'vs/base/node/pfs';
import { isUndefined, isUndefinedOrNull } from 'vs/base/common/types';
import { IStateMainService } from 'vs/platform/state/electron-main/state';
import { ILogService } from 'vs/platform/log/common/log';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { ThrottledDelayer } from 'vs/base/common/async';

type StorageDatabase = { [key: string]: unknown; };

export class FileStorage {

	private database: StorageDatabase = Object.create(null);
	private lastFlushedSerializedDatabase: string | undefined = undefined;

	private readonly flushDelayer = new ThrottledDelayer<void>(100 /* buffer saves over a short time */);

	constructor(
		private readonly dbPath: string,
		private readonly logService: ILogService
	) {
	}

	async init(): Promise<void> {
		this.database = await this.load();
	}

	private async load(): Promise<StorageDatabase> {
		try {
			this.lastFlushedSerializedDatabase = (await promises.readFile(this.dbPath)).toString();

			return JSON.parse(this.lastFlushedSerializedDatabase);
		} catch (error) {
			if (error.code !== 'ENOENT') {
				this.logService.error(error);
			}

			return Object.create(null);
		}
	}

	getItem<T>(key: string, defaultValue: T): T;
	getItem<T>(key: string, defaultValue?: T): T | undefined;
	getItem<T>(key: string, defaultValue?: T): T | undefined {
		const res = this.database[key];
		if (isUndefinedOrNull(res)) {
			return defaultValue;
		}

		return res as T;
	}

	setItem(key: string, data?: object | string | number | boolean | undefined | null): void {

		// Remove an item when it is undefined or null
		if (isUndefinedOrNull(data)) {
			return this.removeItem(key);
		}

		// Shortcut for primitives that did not change
		if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
			if (this.database[key] === data) {
				return;
			}
		}

		this.database[key] = data;
		this.save();
	}

	setItems(items: readonly { key: string, data?: object | string | number | boolean | undefined | null }[]): void {
		let save = false;

		for (const { key, data } of items) {

			// Remove items when they are undefined or null
			if (isUndefinedOrNull(data)) {
				this.database[key] = undefined;
				save = true;
			}

			// Otherwise set items if changed
			else {
				if (typeof data === 'string' || typeof data === 'number' || typeof data === 'boolean') {
					if (this.database[key] === data) {
						continue; // Shortcut for primitives that did not change
					}
				}

				this.database[key] = data;
				save = true;
			}
		}

		if (save) {
			this.save();
		}
	}

	removeItem(key: string): void {

		// Only update if the key is actually present (not undefined)
		if (!isUndefined(this.database[key])) {
			this.database[key] = undefined;
			this.save();
		}
	}

	private save(delay?: number): Promise<void> {
		return this.flushDelayer.trigger(() => this.doSave(), delay);
	}

	private async doSave(): Promise<void> {
		const serializedDatabase = JSON.stringify(this.database, null, 4);
		if (serializedDatabase === this.lastFlushedSerializedDatabase) {
			return; // return early if the database has not changed
		}

		try {
			await writeFile(this.dbPath, serializedDatabase);
			this.lastFlushedSerializedDatabase = serializedDatabase;
		} catch (error) {
			this.logService.error(error);
		}
	}

	flush(): Promise<void> {
		return this.save(0 /* as soon as possible */);
	}
}

export class StateMainService implements IStateMainService {

	declare readonly _serviceBrand: undefined;

	private static readonly STATE_FILE = 'storage.json';

	private fileStorage: FileStorage;
	private storageDidInit = false;

	constructor(
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@ILogService private readonly logService: ILogService
	) {
		this.fileStorage = new FileStorage(join(environmentMainService.userDataPath, StateMainService.STATE_FILE), logService);
	}

	async init(): Promise<void> {
		if (this.storageDidInit) {
			return;
		}

		this.storageDidInit = true;

		return this.fileStorage.init();
	}

	private checkInit(): void {
		if (!this.storageDidInit) {
			this.logService.warn('StateMainService used before init()');
		}
	}

	getItem<T>(key: string, defaultValue: T): T;
	getItem<T>(key: string, defaultValue?: T): T | undefined;
	getItem<T>(key: string, defaultValue?: T): T | undefined {
		this.checkInit();

		return this.fileStorage.getItem(key, defaultValue);
	}

	setItem(key: string, data?: object | string | number | boolean | undefined | null): void {
		this.checkInit();

		this.fileStorage.setItem(key, data);
	}

	setItems(items: readonly { key: string, data?: object | string | number | boolean | undefined | null }[]): void {
		this.checkInit();

		this.fileStorage.setItems(items);
	}

	removeItem(key: string): void {
		this.checkInit();

		this.fileStorage.removeItem(key);
	}

	flush(): Promise<void> {
		this.checkInit();

		return this.fileStorage.flush();
	}
}
