/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IEnvironmentVariableService, IMergedEnvironmentVariableCollection, ISerializableEnvironmentVariableCollection, IEnvironmentVariableCollectionWithPersistence } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { Event, Emitter } from 'vs/base/common/event';
import { debounce, throttle } from 'vs/base/common/decorators';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { MergedEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariableCollection';
import { deserializeEnvironmentVariableCollection, serializeEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariableShared';

const ENVIRONMENT_VARIABLE_COLLECTIONS_KEY = 'terminal.integrated.environmentVariableCollections';

interface ISerializableExtensionEnvironmentVariableCollection {
	extensionIdentifier: string,
	collection: ISerializableEnvironmentVariableCollection
}

/**
 * Tracks and persists environment variable collections as defined by extensions.
 */
export class EnvironmentVariableService implements IEnvironmentVariableService {
	declare readonly _serviceBrand: undefined;

	collections: Map<string, IEnvironmentVariableCollectionWithPersistence> = new Map();
	mergedCollection: IMergedEnvironmentVariableCollection;

	private readonly _onDidChangeCollections = new Emitter<IMergedEnvironmentVariableCollection>();
	get onDidChangeCollections(): Event<IMergedEnvironmentVariableCollection> { return this._onDidChangeCollections.event; }

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IStorageService private readonly _storageService: IStorageService
	) {
		const serializedPersistedCollections = this._storageService.get(ENVIRONMENT_VARIABLE_COLLECTIONS_KEY, StorageScope.WORKSPACE);
		if (serializedPersistedCollections) {
			const collectionsJson: ISerializableExtensionEnvironmentVariableCollection[] = JSON.parse(serializedPersistedCollections);
			collectionsJson.forEach(c => this.collections.set(c.extensionIdentifier, {
				persistent: true,
				map: deserializeEnvironmentVariableCollection(c.collection)
			}));

			// Asynchronously invalidate collections where extensions have been uninstalled, this is
			// async to avoid making all functions on the service synchronous and because extensions
			// being uninstalled is rare.
			this._invalidateExtensionCollections();
		}
		this.mergedCollection = this._resolveMergedCollection();

		// Listen for uninstalled/disabled extensions
		this._extensionService.onDidChangeExtensions(() => this._invalidateExtensionCollections());
	}

	set(extensionIdentifier: string, collection: IEnvironmentVariableCollectionWithPersistence): void {
		this.collections.set(extensionIdentifier, collection);
		this._updateCollections();
	}

	delete(extensionIdentifier: string): void {
		this.collections.delete(extensionIdentifier);
		this._updateCollections();
	}

	private _updateCollections(): void {
		this._persistCollectionsEventually();
		this.mergedCollection = this._resolveMergedCollection();
		this._notifyCollectionUpdatesEventually();
	}

	@throttle(1000)
	private _persistCollectionsEventually(): void {
		this._persistCollections();
	}

	protected _persistCollections(): void {
		const collectionsJson: ISerializableExtensionEnvironmentVariableCollection[] = [];
		this.collections.forEach((collection, extensionIdentifier) => {
			if (collection.persistent) {
				collectionsJson.push({
					extensionIdentifier,
					collection: serializeEnvironmentVariableCollection(this.collections.get(extensionIdentifier)!.map)
				});
			}
		});
		const stringifiedJson = JSON.stringify(collectionsJson);
		this._storageService.store(ENVIRONMENT_VARIABLE_COLLECTIONS_KEY, stringifiedJson, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}

	@debounce(1000)
	private _notifyCollectionUpdatesEventually(): void {
		this._notifyCollectionUpdates();
	}

	protected _notifyCollectionUpdates(): void {
		this._onDidChangeCollections.fire(this.mergedCollection);
	}

	private _resolveMergedCollection(): IMergedEnvironmentVariableCollection {
		return new MergedEnvironmentVariableCollection(this.collections);
	}

	private async _invalidateExtensionCollections(): Promise<void> {
		await this._extensionService.whenInstalledExtensionsRegistered();

		const registeredExtensions = await this._extensionService.getExtensions();
		let changes = false;
		this.collections.forEach((_, extensionIdentifier) => {
			const isExtensionRegistered = registeredExtensions.some(r => r.identifier.value === extensionIdentifier);
			if (!isExtensionRegistered) {
				this.collections.delete(extensionIdentifier);
				changes = true;
			}
		});
		if (changes) {
			this._updateCollections();
		}
	}
}
