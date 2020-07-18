/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IUserDataSyncStoreService, IUserDataSyncLogService, IGlobalState, SyncResource, IUserDataSynchroniser, IUserDataSyncResourceEnablementService,
	IUserDataSyncBackupStoreService, ISyncResourceHandle, IStorageValue, USER_DATA_SYNC_SCHEME, IRemoteUserData, ISyncData, Change
} from 'vs/platform/userDataSync/common/userDataSync';
import { VSBuffer } from 'vs/base/common/buffer';
import { Event } from 'vs/base/common/event';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { dirname, joinPath, basename, isEqual } from 'vs/base/common/resources';
import { IFileService } from 'vs/platform/files/common/files';
import { IStringDictionary } from 'vs/base/common/collections';
import { edit } from 'vs/platform/userDataSync/common/content';
import { merge } from 'vs/platform/userDataSync/common/globalStateMerge';
import { parse } from 'vs/base/common/json';
import { AbstractSynchroniser, IResourcePreview } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { URI } from 'vs/base/common/uri';
import { format } from 'vs/base/common/jsonFormatter';
import { applyEdits } from 'vs/base/common/jsonEdit';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IStorageKeysSyncRegistryService, IStorageKey } from 'vs/platform/userDataSync/common/storageKeys';
import { equals } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';

const argvStoragePrefx = 'globalState.argv.';
const argvProperties: string[] = ['locale'];

export interface IGlobalStateResourcePreview extends IResourcePreview {
	readonly local: { added: IStringDictionary<IStorageValue>, removed: string[], updated: IStringDictionary<IStorageValue> };
	readonly remote: IStringDictionary<IStorageValue> | null;
	readonly skippedStorageKeys: string[];
	readonly localUserData: IGlobalState;
}

interface ILastSyncUserData extends IRemoteUserData {
	skippedStorageKeys: string[] | undefined;
}

export class GlobalStateSynchroniser extends AbstractSynchroniser implements IUserDataSynchroniser {

	private static readonly GLOBAL_STATE_DATA_URI = URI.from({ scheme: USER_DATA_SYNC_SCHEME, authority: 'globalState', path: `/globalState.json` });
	protected readonly version: number = 1;
	private readonly previewResource: URI = joinPath(this.syncPreviewFolder, 'globalState.json');
	private readonly localResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' });
	private readonly remoteResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' });
	private readonly acceptedResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' });

	constructor(
		@IFileService fileService: IFileService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IUserDataSyncResourceEnablementService userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@IStorageKeysSyncRegistryService private readonly storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
	) {
		super(SyncResource.GlobalState, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncResourceEnablementService, telemetryService, logService, configurationService);
		this._register(this.fileService.watch(dirname(this.environmentService.argvResource)));
		this._register(
			Event.any(
				/* Locale change */
				Event.filter(this.fileService.onDidFilesChange, e => e.contains(this.environmentService.argvResource)),
				/* Storage change */
				Event.filter(this.storageService.onDidChangeStorage, e => storageKeysSyncRegistryService.storageKeys.some(({ key }) => e.key === key)),
				/* Storage key registered */
				this.storageKeysSyncRegistryService.onDidChangeStorageKeys
			)((() => this.triggerLocalChange()))
		);
	}

	protected async generatePullPreview(remoteUserData: IRemoteUserData, lastSyncUserData: ILastSyncUserData | null, token: CancellationToken): Promise<IGlobalStateResourcePreview[]> {
		const remoteContent = remoteUserData.syncData !== null ? remoteUserData.syncData.content : null;
		const pullPreview = await this.getPullPreview(remoteContent, lastSyncUserData?.skippedStorageKeys || []);
		return [pullPreview];
	}

	protected async generatePushPreview(remoteUserData: IRemoteUserData, lastSyncUserData: ILastSyncUserData | null, token: CancellationToken): Promise<IGlobalStateResourcePreview[]> {
		const remoteContent = remoteUserData.syncData !== null ? remoteUserData.syncData.content : null;
		const pushPreview = await this.getPushPreview(remoteContent);
		return [pushPreview];
	}

	protected async generateReplacePreview(syncData: ISyncData, remoteUserData: IRemoteUserData, lastSyncUserData: ILastSyncUserData | null): Promise<IGlobalStateResourcePreview[]> {
		const localUserData = await this.getLocalGlobalState();
		const syncGlobalState: IGlobalState = JSON.parse(syncData.content);
		const remoteGlobalState: IGlobalState = remoteUserData.syncData ? JSON.parse(remoteUserData.syncData.content) : null;
		const mergeResult = merge(localUserData.storage, syncGlobalState.storage, localUserData.storage, this.getSyncStorageKeys(), lastSyncUserData?.skippedStorageKeys || [], this.logService);
		const { local, skipped } = mergeResult;
		return [{
			localResource: this.localResource,
			localContent: this.format(localUserData),
			remoteResource: this.remoteResource,
			remoteContent: remoteGlobalState ? this.format(remoteGlobalState) : null,
			previewResource: this.previewResource,
			previewContent: null,
			acceptedResource: this.acceptedResource,
			acceptedContent: null,
			local,
			remote: syncGlobalState.storage,
			localUserData,
			skippedStorageKeys: skipped,
			localChange: Object.keys(local.added).length > 0 || Object.keys(local.updated).length > 0 || local.removed.length > 0 ? Change.Modified : Change.None,
			remoteChange: Change.Modified,
			hasConflicts: false,
		}];
	}

	protected async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: ILastSyncUserData | null, token: CancellationToken): Promise<IGlobalStateResourcePreview[]> {
		const remoteGlobalState: IGlobalState = remoteUserData.syncData ? JSON.parse(remoteUserData.syncData.content) : null;
		const lastSyncGlobalState: IGlobalState | null = lastSyncUserData && lastSyncUserData.syncData ? JSON.parse(lastSyncUserData.syncData.content) : null;

		const localGloablState = await this.getLocalGlobalState();

		if (remoteGlobalState) {
			this.logService.trace(`${this.syncResourceLogLabel}: Merging remote ui state with local ui state...`);
		} else {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote ui state does not exist. Synchronizing ui state for the first time.`);
		}

		const mergeResult = merge(localGloablState.storage, remoteGlobalState ? remoteGlobalState.storage : null, lastSyncGlobalState ? lastSyncGlobalState.storage : null, this.getSyncStorageKeys(), lastSyncUserData?.skippedStorageKeys || [], this.logService);
		const { local, remote, skipped } = mergeResult;

		return [{
			localResource: this.localResource,
			localContent: this.format(localGloablState),
			remoteResource: this.remoteResource,
			remoteContent: remoteGlobalState ? this.format(remoteGlobalState) : null,
			previewResource: this.previewResource,
			previewContent: null,
			acceptedResource: this.acceptedResource,
			acceptedContent: null,
			local,
			remote,
			localUserData: localGloablState,
			skippedStorageKeys: skipped,
			localChange: Object.keys(local.added).length > 0 || Object.keys(local.updated).length > 0 || local.removed.length > 0 ? Change.Modified : Change.None,
			remoteChange: remote !== null ? Change.Modified : Change.None,
			hasConflicts: false,
		}];
	}

	protected async applyPreview(remoteUserData: IRemoteUserData, lastSyncUserData: ILastSyncUserData | null, resourcePreviews: IGlobalStateResourcePreview[], force: boolean): Promise<void> {
		let { local, remote, localUserData, localChange, remoteChange, skippedStorageKeys } = resourcePreviews[0];

		if (localChange === Change.None && remoteChange === Change.None) {
			this.logService.info(`${this.syncResourceLogLabel}: No changes found during synchronizing ui state.`);
		}

		if (localChange !== Change.None) {
			// update local
			this.logService.trace(`${this.syncResourceLogLabel}: Updating local ui state...`);
			await this.backupLocal(JSON.stringify(localUserData));
			await this.writeLocalGlobalState(local);
			this.logService.info(`${this.syncResourceLogLabel}: Updated local ui state`);
		}

		if (remoteChange !== Change.None) {
			// update remote
			this.logService.trace(`${this.syncResourceLogLabel}: Updating remote ui state...`);
			const content = JSON.stringify(<IGlobalState>{ storage: remote });
			remoteUserData = await this.updateRemoteUserData(content, force ? null : remoteUserData.ref);
			this.logService.info(`${this.syncResourceLogLabel}: Updated remote ui state`);
		}

		if (lastSyncUserData?.ref !== remoteUserData.ref || !equals(lastSyncUserData.skippedStorageKeys, skippedStorageKeys)) {
			// update last sync
			this.logService.trace(`${this.syncResourceLogLabel}: Updating last synchronized ui state...`);
			await this.updateLastSyncUserData(remoteUserData, { skippedStorageKeys });
			this.logService.info(`${this.syncResourceLogLabel}: Updated last synchronized ui state`);
		}
	}

	protected async updateResourcePreview(resourcePreview: IGlobalStateResourcePreview, resource: URI, acceptedContent: string): Promise<IGlobalStateResourcePreview> {
		if (isEqual(this.localResource, resource)) {
			return this.getPushPreview(resourcePreview.remoteContent);
		}
		if (isEqual(this.remoteResource, resource)) {
			return this.getPullPreview(resourcePreview.remoteContent, resourcePreview.skippedStorageKeys);
		}
		return resourcePreview;
	}

	private async getPullPreview(remoteContent: string | null, skippedStorageKeys: string[]): Promise<IGlobalStateResourcePreview> {
		const localGlobalState = await this.getLocalGlobalState();
		const localResource = this.localResource;
		const localContent = this.format(localGlobalState);
		const remoteResource = this.remoteResource;
		const previewResource = this.previewResource;
		const acceptedResource = this.acceptedResource;
		const previewContent = null;
		if (remoteContent !== null) {
			const remoteGlobalState: IGlobalState = JSON.parse(remoteContent);
			const mergeResult = merge(localGlobalState.storage, remoteGlobalState.storage, null, this.getSyncStorageKeys(), skippedStorageKeys, this.logService);
			const { local, remote, skipped } = mergeResult;
			return {
				localResource,
				localContent,
				remoteResource,
				remoteContent: this.format(remoteGlobalState),
				previewResource,
				previewContent,
				acceptedResource,
				acceptedContent: previewContent,
				local,
				remote,
				localUserData: localGlobalState,
				skippedStorageKeys: skipped,
				localChange: Object.keys(local.added).length > 0 || Object.keys(local.updated).length > 0 || local.removed.length > 0 ? Change.Modified : Change.None,
				remoteChange: remote !== null ? Change.Modified : Change.None,
				hasConflicts: false,
			};
		} else {
			return {
				localResource,
				localContent,
				remoteResource,
				remoteContent: null,
				previewResource,
				previewContent,
				acceptedResource,
				acceptedContent: previewContent,
				local: { added: {}, removed: [], updated: {} },
				remote: null,
				localUserData: localGlobalState,
				skippedStorageKeys: [],
				localChange: Change.None,
				remoteChange: Change.None,
				hasConflicts: false,
			};
		}
	}

	private async getPushPreview(remoteContent: string | null): Promise<IGlobalStateResourcePreview> {
		const localUserData = await this.getLocalGlobalState();
		const remoteGlobalState: IGlobalState = remoteContent ? JSON.parse(remoteContent) : null;
		return {
			localResource: this.localResource,
			localContent: this.format(localUserData),
			remoteResource: this.remoteResource,
			remoteContent: remoteGlobalState ? this.format(remoteGlobalState) : null,
			previewResource: this.previewResource,
			previewContent: null,
			acceptedResource: this.acceptedResource,
			acceptedContent: null,
			local: { added: {}, removed: [], updated: {} },
			remote: localUserData.storage,
			localUserData,
			skippedStorageKeys: [],
			localChange: Change.None,
			remoteChange: Change.Modified,
			hasConflicts: false,
		};
	}

	async getAssociatedResources({ uri }: ISyncResourceHandle): Promise<{ resource: URI, comparableResource?: URI }[]> {
		return [{ resource: joinPath(uri, 'globalState.json'), comparableResource: GlobalStateSynchroniser.GLOBAL_STATE_DATA_URI }];
	}

	async resolveContent(uri: URI): Promise<string | null> {
		if (isEqual(this.remoteResource, uri) || isEqual(this.localResource, uri) || isEqual(this.acceptedResource, uri)) {
			return this.resolvePreviewContent(uri);
		}

		let content = await super.resolveContent(uri);
		if (content) {
			return content;
		}

		content = await super.resolveContent(dirname(uri));
		if (content) {
			const syncData = this.parseSyncData(content);
			if (syncData) {
				switch (basename(uri)) {
					case 'globalState.json':
						return this.format(JSON.parse(syncData.content));
				}
			}
		}

		return null;
	}

	private format(globalState: IGlobalState): string {
		const storageKeys = Object.keys(globalState.storage).sort();
		const storage: IStringDictionary<IStorageValue> = {};
		storageKeys.forEach(key => storage[key] = globalState.storage[key]);
		globalState.storage = storage;
		const content = JSON.stringify(globalState);
		const edits = format(content, undefined, {});
		return applyEdits(content, edits);
	}

	async hasLocalData(): Promise<boolean> {
		try {
			const { storage } = await this.getLocalGlobalState();
			if (Object.keys(storage).length > 1 || storage[`${argvStoragePrefx}.locale`]?.value !== 'en') {
				return true;
			}
		} catch (error) {
			/* ignore error */
		}
		return false;
	}

	private async getLocalGlobalState(): Promise<IGlobalState> {
		const storage: IStringDictionary<IStorageValue> = {};
		const argvContent: string = await this.getLocalArgvContent();
		const argvValue: IStringDictionary<any> = parse(argvContent);
		for (const argvProperty of argvProperties) {
			if (argvValue[argvProperty] !== undefined) {
				storage[`${argvStoragePrefx}${argvProperty}`] = { version: 1, value: argvValue[argvProperty] };
			}
		}
		for (const { key, version } of this.storageKeysSyncRegistryService.storageKeys) {
			const value = this.storageService.get(key, StorageScope.GLOBAL);
			if (value) {
				storage[key] = { version, value };
			}
		}
		return { storage };
	}

	private async getLocalArgvContent(): Promise<string> {
		try {
			const content = await this.fileService.readFile(this.environmentService.argvResource);
			return content.value.toString();
		} catch (error) { }
		return '{}';
	}

	private async writeLocalGlobalState({ added, removed, updated }: { added: IStringDictionary<IStorageValue>, updated: IStringDictionary<IStorageValue>, removed: string[] }): Promise<void> {
		const argv: IStringDictionary<any> = {};
		const updatedStorage: IStringDictionary<any> = {};
		const handleUpdatedStorage = (keys: string[], storage?: IStringDictionary<IStorageValue>): void => {
			for (const key of keys) {
				if (key.startsWith(argvStoragePrefx)) {
					argv[key.substring(argvStoragePrefx.length)] = storage ? storage[key].value : undefined;
					continue;
				}
				if (storage) {
					const storageValue = storage[key];
					if (storageValue.value !== String(this.storageService.get(key, StorageScope.GLOBAL))) {
						updatedStorage[key] = storageValue.value;
					}
				} else {
					if (this.storageService.get(key, StorageScope.GLOBAL) !== undefined) {
						updatedStorage[key] = undefined;
					}
				}
			}
		};
		handleUpdatedStorage(Object.keys(added), added);
		handleUpdatedStorage(Object.keys(updated), updated);
		handleUpdatedStorage(removed);
		if (Object.keys(argv).length) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating locale...`);
			await this.updateArgv(argv);
			this.logService.info(`${this.syncResourceLogLabel}: Updated locale`);
		}
		const updatedStorageKeys: string[] = Object.keys(updatedStorage);
		if (updatedStorageKeys.length) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating global state...`);
			for (const key of Object.keys(updatedStorage)) {
				this.storageService.store(key, updatedStorage[key], StorageScope.GLOBAL);
			}
			this.logService.info(`${this.syncResourceLogLabel}: Updated global state`, Object.keys(updatedStorage));
		}
	}

	private async updateArgv(argv: IStringDictionary<any>): Promise<void> {
		const argvContent = await this.getLocalArgvContent();
		let content = argvContent;
		for (const argvProperty of Object.keys(argv)) {
			content = edit(content, [argvProperty], argv[argvProperty], {});
		}
		if (argvContent !== content) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating locale...`);
			await this.fileService.writeFile(this.environmentService.argvResource, VSBuffer.fromString(content));
			this.logService.info(`${this.syncResourceLogLabel}: Updated locale.`);
		}
	}

	private getSyncStorageKeys(): IStorageKey[] {
		return [...this.storageKeysSyncRegistryService.storageKeys, ...argvProperties.map(argvProprety => (<IStorageKey>{ key: `${argvStoragePrefx}${argvProprety}`, version: 1 }))];
	}
}
