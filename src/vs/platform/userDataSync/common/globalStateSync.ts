/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IUserDataSyncStoreService, IUserDataSyncLogService, IGlobalState, SyncResource, IUserDataSynchroniser, IUserDataSyncResourceEnablementService,
	IUserDataSyncBackupStoreService, ISyncResourceHandle, IStorageValue, USER_DATA_SYNC_SCHEME, IRemoteUserData, Change, ALL_SYNC_RESOURCES, getEnablementKey, SYNC_SERVICE_URL_TYPE, UserDataSyncStoreType, IUserData, ISyncData, createSyncHeaders, UserDataSyncError, UserDataSyncErrorCode
} from 'vs/platform/userDataSync/common/userDataSync';
import { VSBuffer } from 'vs/base/common/buffer';
import { Event } from 'vs/base/common/event';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { IStringDictionary } from 'vs/base/common/collections';
import { edit } from 'vs/platform/userDataSync/common/content';
import { merge } from 'vs/platform/userDataSync/common/globalStateMerge';
import { parse } from 'vs/base/common/json';
import { AbstractInitializer, AbstractSynchroniser, IAcceptResult, IMergeResult, IResourcePreview, isSyncData } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { URI } from 'vs/base/common/uri';
import { format } from 'vs/base/common/jsonFormatter';
import { applyEdits } from 'vs/base/common/jsonEdit';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { CancellationToken } from 'vs/base/common/cancellation';
import { isWeb } from 'vs/base/common/platform';
import { UserDataSyncStoreClient } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { getServiceMachineId } from 'vs/platform/serviceMachineId/common/serviceMachineId';
import { generateUuid } from 'vs/base/common/uuid';
import { IHeaders } from 'vs/base/parts/request/common/request';
import { ILogService } from 'vs/platform/log/common/log';

const argvStoragePrefx = 'globalState.argv.';
const argvProperties: string[] = ['locale'];

type StorageKeys = { machine: string[], user: string[], unregistered: string[] };

interface IGlobalStateResourceMergeResult extends IAcceptResult {
	readonly local: { added: IStringDictionary<IStorageValue>, removed: string[], updated: IStringDictionary<IStorageValue> };
	readonly remote: IStringDictionary<IStorageValue> | null;
}

export interface IGlobalStateResourcePreview extends IResourcePreview {
	readonly localUserData: IGlobalState;
	readonly previewResult: IGlobalStateResourceMergeResult;
	readonly storageKeys: StorageKeys;
}

function formatAndStringify(globalState: IGlobalState): string {
	const storageKeys = globalState.storage ? Object.keys(globalState.storage).sort() : [];
	const storage: IStringDictionary<IStorageValue> = {};
	storageKeys.forEach(key => storage[key] = globalState.storage[key]);
	globalState.storage = storage;
	const content = JSON.stringify(globalState);
	const edits = format(content, undefined, {});
	return applyEdits(content, edits);
}

const GLOBAL_STATE_DATA_VERSION = 1;

/**
 * Synchronises global state that includes
 * 	- Global storage with user scope
 * 	- Locale from argv properties
 *
 * Global storage is synced without checking version just like other resources (settings, keybindings).
 * If there is a change in format of the value of a storage key which requires migration then
 * 		Owner of that key should remove that key from user scope and replace that with new user scoped key.
 */
export class GlobalStateSynchroniser extends AbstractSynchroniser implements IUserDataSynchroniser {

	private static readonly GLOBAL_STATE_DATA_URI = URI.from({ scheme: USER_DATA_SYNC_SCHEME, authority: 'globalState', path: `/globalState.json` });
	protected readonly version: number = GLOBAL_STATE_DATA_VERSION;
	private readonly previewResource: URI = this.extUri.joinPath(this.syncPreviewFolder, 'globalState.json');
	private readonly localResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' });
	private readonly remoteResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' });
	private readonly acceptedResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' });

	constructor(
		@IFileService fileService: IFileService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncResourceEnablementService userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super(SyncResource.GlobalState, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncResourceEnablementService, telemetryService, logService, configurationService);
		this._register(fileService.watch(this.extUri.dirname(this.environmentService.argvResource)));
		this._register(
			Event.any(
				/* Locale change */
				Event.filter(fileService.onDidFilesChange, e => e.contains(this.environmentService.argvResource)),
				/* Global storage with user target has changed */
				Event.filter(storageService.onDidChangeValue, e => e.scope === StorageScope.GLOBAL && e.target !== undefined ? e.target === StorageTarget.USER : storageService.keys(StorageScope.GLOBAL, StorageTarget.USER).includes(e.key)),
				/* Storage key target has changed */
				this.storageService.onDidChangeTarget
			)((() => this.triggerLocalChange()))
		);
	}

	protected async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken): Promise<IGlobalStateResourcePreview[]> {
		const remoteGlobalState: IGlobalState = remoteUserData.syncData ? JSON.parse(remoteUserData.syncData.content) : null;
		const lastSyncGlobalState: IGlobalState | null = lastSyncUserData && lastSyncUserData.syncData ? JSON.parse(lastSyncUserData.syncData.content) : null;

		const localGloablState = await this.getLocalGlobalState();

		if (remoteGlobalState) {
			this.logService.trace(`${this.syncResourceLogLabel}: Merging remote ui state with local ui state...`);
		} else {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote ui state does not exist. Synchronizing ui state for the first time.`);
		}

		const storageKeys = this.getStorageKeys(lastSyncGlobalState);
		const { local, remote } = merge(localGloablState.storage, remoteGlobalState ? remoteGlobalState.storage : null, lastSyncGlobalState ? lastSyncGlobalState.storage : null, storageKeys, this.logService);
		const previewResult: IGlobalStateResourceMergeResult = {
			content: null,
			local,
			remote,
			localChange: Object.keys(local.added).length > 0 || Object.keys(local.updated).length > 0 || local.removed.length > 0 ? Change.Modified : Change.None,
			remoteChange: remote !== null ? Change.Modified : Change.None,
		};

		return [{
			localResource: this.localResource,
			localContent: formatAndStringify(localGloablState),
			localUserData: localGloablState,
			remoteResource: this.remoteResource,
			remoteContent: remoteGlobalState ? formatAndStringify(remoteGlobalState) : null,
			previewResource: this.previewResource,
			previewResult,
			localChange: previewResult.localChange,
			remoteChange: previewResult.remoteChange,
			acceptedResource: this.acceptedResource,
			storageKeys
		}];
	}

	protected async getMergeResult(resourcePreview: IGlobalStateResourcePreview, token: CancellationToken): Promise<IMergeResult> {
		return { ...resourcePreview.previewResult, hasConflicts: false };
	}

	protected async getAcceptResult(resourcePreview: IGlobalStateResourcePreview, resource: URI, content: string | null | undefined, token: CancellationToken): Promise<IGlobalStateResourceMergeResult> {

		/* Accept local resource */
		if (this.extUri.isEqual(resource, this.localResource)) {
			return this.acceptLocal(resourcePreview);
		}

		/* Accept remote resource */
		if (this.extUri.isEqual(resource, this.remoteResource)) {
			return this.acceptRemote(resourcePreview);
		}

		/* Accept preview resource */
		if (this.extUri.isEqual(resource, this.previewResource)) {
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
			const { local, remote } = merge(resourcePreview.localUserData.storage, remoteGlobalState.storage, null, resourcePreview.storageKeys, this.logService);
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

	protected async applyResult(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resourcePreviews: [IGlobalStateResourcePreview, IGlobalStateResourceMergeResult][], force: boolean): Promise<void> {
		let { localUserData } = resourcePreviews[0][0];
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

		if (lastSyncUserData?.ref !== remoteUserData.ref) {
			// update last sync
			this.logService.trace(`${this.syncResourceLogLabel}: Updating last synchronized ui state...`);
			await this.updateLastSyncUserData(remoteUserData);
			this.logService.info(`${this.syncResourceLogLabel}: Updated last synchronized ui state`);
		}
	}

	async getAssociatedResources({ uri }: ISyncResourceHandle): Promise<{ resource: URI, comparableResource: URI }[]> {
		return [{ resource: this.extUri.joinPath(uri, 'globalState.json'), comparableResource: GlobalStateSynchroniser.GLOBAL_STATE_DATA_URI }];
	}

	override async resolveContent(uri: URI): Promise<string | null> {
		if (this.extUri.isEqual(uri, GlobalStateSynchroniser.GLOBAL_STATE_DATA_URI)) {
			const localGlobalState = await this.getLocalGlobalState();
			return formatAndStringify(localGlobalState);
		}

		if (this.extUri.isEqual(this.remoteResource, uri) || this.extUri.isEqual(this.localResource, uri) || this.extUri.isEqual(this.acceptedResource, uri)) {
			return this.resolvePreviewContent(uri);
		}

		let content = await super.resolveContent(uri);
		if (content) {
			return content;
		}

		content = await super.resolveContent(this.extUri.dirname(uri));
		if (content) {
			const syncData = this.parseSyncData(content);
			if (syncData) {
				switch (this.extUri.basename(uri)) {
					case 'globalState.json':
						return formatAndStringify(JSON.parse(syncData.content));
				}
			}
		}

		return null;
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
		for (const key of this.storageService.keys(StorageScope.GLOBAL, StorageTarget.USER)) {
			const value = this.storageService.get(key, StorageScope.GLOBAL);
			if (value) {
				storage[key] = { version: 1, value };
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
				this.storageService.store(key, updatedStorage[key], StorageScope.GLOBAL, StorageTarget.USER);
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

	private getStorageKeys(lastSyncGlobalState: IGlobalState | null): StorageKeys {
		const user = this.storageService.keys(StorageScope.GLOBAL, StorageTarget.USER);
		const machine = this.storageService.keys(StorageScope.GLOBAL, StorageTarget.MACHINE);
		const registered = [...user, ...machine];
		const unregistered = lastSyncGlobalState?.storage ? Object.keys(lastSyncGlobalState.storage).filter(key => !key.startsWith(argvStoragePrefx) && !registered.includes(key) && this.storageService.get(key, StorageScope.GLOBAL) !== undefined) : [];

		if (!isWeb) {
			// Following keys are synced only in web. Do not sync these keys in other platforms
			const keysSyncedOnlyInWeb = [...ALL_SYNC_RESOURCES.map(resource => getEnablementKey(resource)), SYNC_SERVICE_URL_TYPE];
			unregistered.push(...keysSyncedOnlyInWeb);
			machine.push(...keysSyncedOnlyInWeb);
		}

		return { user, machine, unregistered };
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
				this.storageService.store(key, storage[key], StorageScope.GLOBAL, StorageTarget.USER);
			}
		}
	}

}

export class UserDataSyncStoreTypeSynchronizer {

	constructor(
		private readonly userDataSyncStoreClient: UserDataSyncStoreClient,
		@IStorageService private readonly storageService: IStorageService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@ILogService private readonly logService: ILogService,
	) {
	}

	getSyncStoreType(userData: IUserData): UserDataSyncStoreType | undefined {
		const remoteGlobalState = this.parseGlobalState(userData);
		return remoteGlobalState?.storage[SYNC_SERVICE_URL_TYPE]?.value as UserDataSyncStoreType;
	}

	async sync(userDataSyncStoreType: UserDataSyncStoreType): Promise<void> {
		const syncHeaders = createSyncHeaders(generateUuid());
		try {
			return await this.doSync(userDataSyncStoreType, syncHeaders);
		} catch (e) {
			if (e instanceof UserDataSyncError) {
				switch (e.code) {
					case UserDataSyncErrorCode.PreconditionFailed:
						this.logService.info(`Failed to synchronize UserDataSyncStoreType as there is a new remote version available. Synchronizing again...`);
						return this.doSync(userDataSyncStoreType, syncHeaders);
				}
			}
			throw e;
		}
	}

	private async doSync(userDataSyncStoreType: UserDataSyncStoreType, syncHeaders: IHeaders): Promise<void> {
		// Read the global state from remote
		const globalStateUserData = await this.userDataSyncStoreClient.read(SyncResource.GlobalState, null, syncHeaders);
		const remoteGlobalState = this.parseGlobalState(globalStateUserData) || { storage: {} };

		// Update the sync store type
		remoteGlobalState.storage[SYNC_SERVICE_URL_TYPE] = { value: userDataSyncStoreType, version: GLOBAL_STATE_DATA_VERSION };

		// Write the global state to remote
		const machineId = await getServiceMachineId(this.environmentService, this.fileService, this.storageService);
		const syncDataToUpdate: ISyncData = { version: GLOBAL_STATE_DATA_VERSION, machineId, content: formatAndStringify(remoteGlobalState) };
		await this.userDataSyncStoreClient.write(SyncResource.GlobalState, JSON.stringify(syncDataToUpdate), globalStateUserData.ref, syncHeaders);
	}

	private parseGlobalState({ content }: IUserData): IGlobalState | null {
		if (!content) {
			return null;
		}
		const syncData = JSON.parse(content);
		if (isSyncData(syncData)) {
			return syncData ? JSON.parse(syncData.content) : null;
		}
		throw new Error('Invalid remote data');
	}

}

