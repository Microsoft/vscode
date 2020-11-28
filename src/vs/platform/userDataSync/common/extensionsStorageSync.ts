/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService, IStorageValueChangeEvent, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';

export interface IExtensionIdWithVersion {
	id: string;
	version: string;
}

export const IExtensionsStorageSyncService = createDecorator<IExtensionsStorageSyncService>('IExtensionsStorageSyncService');

export interface IExtensionsStorageSyncService {

	_serviceBrand: any;

	readonly onDidChangeExtensionsStorage: Event<void>;
	setKeysForSync(extensionIdWithVersion: IExtensionIdWithVersion, keys: string[]): void;
	getKeysForSync(extensionIdWithVersion: IExtensionIdWithVersion): string[] | undefined;

}

const EXTENSION_KEYS_ID_VERSION_REGEX = /^extensionKeys\/([^.]+\..+)@(\d+\.\d+\.\d+(-.*)?)$/;

export class ExtensionsStorageSyncService extends Disposable implements IExtensionsStorageSyncService {

	declare readonly _serviceBrand: undefined;

	private static toKey(extension: IExtensionIdWithVersion): string {
		return `extensionKeys/${extension.id}@${extension.version}`;
	}

	private static fromKey(key: string): IExtensionIdWithVersion | undefined {
		const matches = EXTENSION_KEYS_ID_VERSION_REGEX.exec(key);
		if (matches && matches[1]) {
			return { id: matches[1], version: matches[2] };
		}
		return undefined;
	}

	private readonly _onDidChangeExtensionsStorage = this._register(new Emitter<void>());
	readonly onDidChangeExtensionsStorage = this._onDidChangeExtensionsStorage.event;

	private readonly extensionsWithKeysForSync = new Set<string>();

	constructor(
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.initialize();
		this._register(this.storageService.onDidChangeValue(e => this.onDidChangeStorageValue(e)));
	}

	private initialize(): void {
		const keys = this.storageService.keys(StorageScope.GLOBAL, StorageTarget.MACHINE);
		for (const key of keys) {
			const extensionIdWithVersion = ExtensionsStorageSyncService.fromKey(key);
			if (extensionIdWithVersion) {
				this.extensionsWithKeysForSync.add(extensionIdWithVersion.id.toLowerCase());
			}
		}
	}

	private onDidChangeStorageValue(e: IStorageValueChangeEvent): void {
		if (e.scope !== StorageScope.GLOBAL) {
			return;
		}

		// State of extension with keys for sync has changed
		if (this.extensionsWithKeysForSync.has(e.key.toLowerCase())) {
			this._onDidChangeExtensionsStorage.fire();
			return;
		}

		// Keys for sync of an extension has changed
		const extensionIdWithVersion = ExtensionsStorageSyncService.fromKey(e.key);
		if (extensionIdWithVersion) {
			this.extensionsWithKeysForSync.add(extensionIdWithVersion.id.toLowerCase());
			this._onDidChangeExtensionsStorage.fire();
			return;
		}
	}

	setKeysForSync(extensionIdWithVersion: IExtensionIdWithVersion, keys: string[]): void {
		this.storageService.store(ExtensionsStorageSyncService.toKey(extensionIdWithVersion), JSON.stringify(keys), StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	getKeysForSync(extensionIdWithVersion: IExtensionIdWithVersion): string[] | undefined {
		const keysForSyncValue = this.storageService.get(ExtensionsStorageSyncService.toKey(extensionIdWithVersion), StorageScope.GLOBAL);
		return keysForSyncValue ? JSON.parse(keysForSyncValue) : undefined;
	}
}
