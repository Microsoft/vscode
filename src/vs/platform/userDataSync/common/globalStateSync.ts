/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IUserDataSyncStoreService, IUserDataSyncLogService, IGlobalState, SyncResource, IUserDataSynchroniser, IUserDataSyncResourceEnablementService,
	IUserDataSyncBackupStoreService, ISyncResourceHandle, IStorageValue, USER_DATA_SYNC_SCHEME, IRemoteUserData, Change
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
import { AbstractInitializer, AbstractSynchroniser, IAcceptResult, IMergeResult, IResourcePreview } from 'vs/platform/userDataSync/common/abstractSynchronizer';
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

interface IGlobalStateResourceMergeResult extends IAcceptResult {
	readonly local: { added: IStringDictionary<IStorageValue>, removed: string[], updated: IStringDictionary<IStorageValue> };
	readonly remote: IStringDictionary<IStorageValue> | null;
}

export interface IGlobalStateResourcePreview extends IResourcePreview {
	readonly skippedStorageKeys: string[];
	readonly localUserData: IGlobalState;
	readonly previewResult: IGlobalStateResourceMergeResult;
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
		@IEnvironmentService readonly environmentService: IEnvironmentService,
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

	protected async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: ILastSyncUserData | null, token: CancellationToken): Promise<IGlobalStateResourcePreview[]> {
		const remoteGlobalState: IGlobalState = remoteUserData.syncData ? JSON.parse(remoteUserData.syncData.content) : null;
		const lastSyncGlobalState: IGlobalState | null = lastSyncUserData && lastSyncUserData.syncData ? JSON.parse(lastSyncUserData.syncData.content) : null;

		const localGloablState = await this.getLocalGlobalState();

		if (remoteGlobalState) {
			this.logService.trace(`${this.syncResourceLogLabel}: Merging remote ui state with local ui state...`);
		} else {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote ui state does not exist. Synchronizing ui state for the first time.`);
		}

		const { local, remote, skipped } = merge(localGloablState.storage, remoteGlobalState ? remoteGlobalState.storage : null, lastSyncGlobalState ? lastSyncGlobalState.storage : null, this.getSyncStorageKeys(), lastSyncUserData?.skippedStorageKeys || [], this.logService);
		const previewResult: IGlobalStateResourceMergeResult = {
			content: null,
			local,
			remote,
			localChange: Object.keys(local.added).length > 0 || Object.keys(local.updated).length > 0 || local.removed.length > 0 ? Change.Modified : Change.None,
			remoteChange: remote !== null ? Change.Modified : Change.None,
		};

		return [{
			skippedStorageKeys: skipped,
			localResource: this.localResource,
			localContent: this.format(localGloablState),
			localUserData: localGloablState,
			remoteResource: this.remoteResource,
			remoteContent: remoteGlobalState ? this.format(remoteGlobalState) : null,
			previewResource: this.previewResource,
			previewResult,
			localChange: previewResult.localChange,
			remoteChange: previewResult.remoteChange,
			acceptedResource: this.acceptedResource,
		}];
	}

	protected async getMergeResult(resourcePreview: IGlobalStateResourcePreview, token: CancellationToken): Promise<IMergeResult> {
		return { ...resourcePreview.previewResult, hasConflicts: false };
	}

	protected async getAcceptResult(resourcePreview: IGlobalStateResourcePreview, resource: URI, content: string | null | undefined, token: CancellationToken): Promise<IGlobalStateResourceMergeResult> {

		/* Accept local resource */
		if (isEqual(resource, this.localResource)) {
			return this.acceptLocal(resourcePreview);
		}

		/* Accept remote resource */
		if (isEqual(resource, this.remoteResource)) {
			return this.acceptRemote(resourcePreview);
		}

		/* Accept preview resource */
		if (isEqual(resource, this.previewResource)) {
			return resourcePreview.previewResult;
		}

		throw new Error(`Invalid Resource: ${resource.toString()}`);
	}

	private async acceptLocal(resourcePreview: IGlobalStateResourcePreview): Promise<IGlobalStateResourceMergeResult> {
		return {
			content: resourcePreview.localContent,
			local: { added: {}, removed: [], updated: {} },
			remote: resourcePreview.localUserData.storage,
			localChange: Change.None,
			remoteChange: Change.Modified,
		};
	}

	private async acceptRemote(resourcePreview: IGlobalStateResourcePreview): Promise<IGlobalStateResourceMergeResult> {
		if (resourcePreview.remoteContent !== null) {
			const remoteGlobalState: IGlobalState = JSON.parse(resourcePreview.remoteContent);
			const { local, remote } = merge(resourcePreview.localUserData.storage, remoteGlobalState.storage, null, this.getSyncStorageKeys(), resourcePreview.skippedStorageKeys, this.logService);
			return {
				content: resourcePreview.remoteContent,
				local,
				remote,
				localChange: Object.keys(local.added).length > 0 || Object.keys(local.updated).length > 0 || local.removed.length > 0 ? Change.Modified : Change.None,
				remoteChange: remote !== null ? Change.Modified : Change.None,
			};
		} else {
			return {
				content: resourcePreview.remoteContent,
				local: { added: {}, removed: [], updated: {} },
				remote: null,
				localChange: Change.None,
				remoteChange: Change.None,
			};
		}
	}

	protected async applyResult(remoteUserData: IRemoteUserData, lastSyncUserData: ILastSyncUserData | null, resourcePreviews: [IGlobalStateResourcePreview, IGlobalStateResourceMergeResult][], force: boolean): Promise<void> {
		let { localUserData, skippedStorageKeys } = resourcePreviews[0][0];
		let { local, remote, localChange, remoteChange } = resourcePreviews[0][1];

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

	async getAssociatedResources({ uri }: ISyncResourceHandle): Promise<{ resource: URI, comparableResource: URI }[]> {
		return [{ resource: joinPath(uri, 'globalState.json'), comparableResource: GlobalStateSynchroniser.GLOBAL_STATE_DATA_URI }];
	}

	async resolveContent(uri: URI): Promise<string | null> {
		if (isEqual(uri, GlobalStateSynchroniser.GLOBAL_STATE_DATA_URI)) {
			const localGlobalState = await this.getLocalGlobalState();
			return this.format(localGlobalState);
		}

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

export class GlobalStateInitializer extends AbstractInitializer {

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
	) {
		super(SyncResource.GlobalState, environmentService, logService, fileService);
	}

	async doInitialize(remoteUserData: IRemoteUserData): Promise<void> {
		const remoteGlobalState: IGlobalState = remoteUserData.syncData ? JSON.parse(remoteUserData.syncData.content) : null;
		if (!remoteGlobalState) {
			this.logService.info('Skipping initializing global state because remote global state does not exist.');
			return;
		}

		const argv: IStringDictionary<any> = {};
		const storage: IStringDictionary<any> = {};
		for (const key of Object.keys(remoteGlobalState.storage)) {
			if (key.startsWith(argvStoragePrefx)) {
				argv[key.substring(argvStoragePrefx.length)] = remoteGlobalState.storage[key].value;
			} else {
				if (this.storageService.get(key, StorageScope.GLOBAL) === undefined) {
					storage[key] = remoteGlobalState.storage[key].value;
				}
			}
		}

		if (Object.keys(argv).length) {
			let content = '{}';
			try {
				const fileContent = await this.fileService.readFile(this.environmentService.argvResource);
				content = fileContent.value.toString();
			} catch (error) { }
			for (const argvProperty of Object.keys(argv)) {
				content = edit(content, [argvProperty], argv[argvProperty], {});
			}
			await this.fileService.writeFile(this.environmentService.argvResource, VSBuffer.fromString(content));
		}

		if (Object.keys(storage).length) {
			for (const key of Object.keys(storage)) {
				this.storageService.store(key, storage[key], StorageScope.GLOBAL);
			}
		}
	}

}

