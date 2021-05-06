/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IUserDataSyncStoreService, ISyncExtension, IUserDataSyncLogService, IUserDataSynchroniser, SyncResource, IUserDataSyncResourceEnablementService,
	IUserDataSyncBackupStoreService, ISyncResourceHandle, USER_DATA_SYNC_SCHEME, IRemoteUserData, ISyncData, Change, ISyncExtensionWithVersion
} from 'vs/platform/userDataSync/common/userDataSync';
import { Event } from 'vs/base/common/event';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IExtensionManagementService, IExtensionGalleryService, IGlobalExtensionEnablementService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionType, IExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { areSameExtensions, getExtensionId, getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IFileService } from 'vs/platform/files/common/files';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { merge } from 'vs/platform/userDataSync/common/extensionsMerge';
import { AbstractInitializer, AbstractSynchroniser, IAcceptResult, IMergeResult, IResourcePreview } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { URI } from 'vs/base/common/uri';
import { format } from 'vs/base/common/jsonFormatter';
import { applyEdits } from 'vs/base/common/jsonEdit';
import { compare } from 'vs/base/common/strings';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IIgnoredExtensionsManagementService } from 'vs/platform/userDataSync/common/ignoredExtensions';
import { getErrorMessage } from 'vs/base/common/errors';
import { IStringDictionary } from 'vs/base/common/collections';
import { IExtensionsStorageSyncService } from 'vs/platform/userDataSync/common/extensionsStorageSync';
import { Promises } from 'vs/base/common/async';

interface IExtensionResourceMergeResult extends IAcceptResult {
	readonly added: ISyncExtension[];
	readonly removed: IExtensionIdentifier[];
	readonly updated: ISyncExtension[];
	readonly remote: ISyncExtension[] | null;
}

interface IExtensionResourcePreview extends IResourcePreview {
	readonly localExtensions: ISyncExtensionWithVersion[];
	readonly skippedExtensions: ISyncExtension[];
	readonly previewResult: IExtensionResourceMergeResult;
}

interface ILastSyncUserData extends IRemoteUserData {
	skippedExtensions: ISyncExtension[] | undefined;
}

async function parseAndMigrateExtensions(syncData: ISyncData, extensionManagementService: IExtensionManagementService): Promise<ISyncExtension[]> {
	const extensions = JSON.parse(syncData.content);
	if (syncData.version === 1
		|| syncData.version === 2
	) {
		const builtinExtensions = (await extensionManagementService.getInstalled(ExtensionType.System)).filter(e => e.isBuiltin);
		for (const extension of extensions) {
			// #region Migration from v1 (enabled -> disabled)
			if (syncData.version === 1) {
				if ((<any>extension).enabled === false) {
					extension.disabled = true;
				}
				delete (<any>extension).enabled;
			}
			// #endregion

			// #region Migration from v2 (set installed property on extension)
			if (syncData.version === 2) {
				if (builtinExtensions.every(installed => !areSameExtensions(installed.identifier, extension.identifier))) {
					extension.installed = true;
				}
			}
			// #endregion
		}
	}
	return extensions;
}

export function getExtensionStorageState(publisher: string, name: string, storageService: IStorageService): IStringDictionary<any> {
	const extensionStorageValue = storageService.get(getExtensionId(publisher, name) /* use the same id used in extension host */, StorageScope.GLOBAL) || '{}';
	return JSON.parse(extensionStorageValue);
}

export function storeExtensionStorageState(publisher: string, name: string, extensionState: IStringDictionary<any>, storageService: IStorageService): void {
	storageService.store(getExtensionId(publisher, name) /* use the same id used in extension host */, JSON.stringify(extensionState), StorageScope.GLOBAL, StorageTarget.MACHINE);
}

export class ExtensionsSynchroniser extends AbstractSynchroniser implements IUserDataSynchroniser {

	private static readonly EXTENSIONS_DATA_URI = URI.from({ scheme: USER_DATA_SYNC_SCHEME, authority: 'extensions', path: `/extensions.json` });

	/*
		Version 3 - Introduce installed property to skip installing built in extensions
		protected readonly version: number = 3;
	*/
	/* Version 4: Change settings from `sync.${setting}` to `settingsSync.{setting}` */
	/* Version 5: Introduce extension state */
	protected readonly version: number = 5;

	protected override isEnabled(): boolean { return super.isEnabled() && this.extensionGalleryService.isEnabled(); }
	private readonly previewResource: URI = this.extUri.joinPath(this.syncPreviewFolder, 'extensions.json');
	private readonly localResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' });
	private readonly remoteResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' });
	private readonly acceptedResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' });

	constructor(
		@IEnvironmentService environmentService: IEnvironmentService,
		@IFileService fileService: IFileService,
		@IStorageService private readonly storageService: IStorageService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IGlobalExtensionEnablementService private readonly extensionEnablementService: IGlobalExtensionEnablementService,
		@IIgnoredExtensionsManagementService private readonly ignoredExtensionsManagementService: IIgnoredExtensionsManagementService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncResourceEnablementService userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IExtensionsStorageSyncService private readonly extensionsStorageSyncService: IExtensionsStorageSyncService,
	) {
		super(SyncResource.Extensions, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncResourceEnablementService, telemetryService, logService, configurationService);
		this._register(
			Event.debounce(
				Event.any<any>(
					Event.filter(this.extensionManagementService.onDidInstallExtension, (e => !!e.gallery)),
					Event.filter(this.extensionManagementService.onDidUninstallExtension, (e => !e.error)),
					this.extensionEnablementService.onDidChangeEnablement,
					this.extensionsStorageSyncService.onDidChangeExtensionsStorage),
				() => undefined, 500)(() => this.triggerLocalChange()));
	}

	protected async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: ILastSyncUserData | null): Promise<IExtensionResourcePreview[]> {
		const remoteExtensions: ISyncExtension[] | null = remoteUserData.syncData ? await parseAndMigrateExtensions(remoteUserData.syncData, this.extensionManagementService) : null;
		const skippedExtensions: ISyncExtension[] = lastSyncUserData?.skippedExtensions || [];
		const lastSyncExtensions: ISyncExtension[] | null = lastSyncUserData?.syncData ? await parseAndMigrateExtensions(lastSyncUserData.syncData, this.extensionManagementService) : null;

		const installedExtensions = await this.extensionManagementService.getInstalled();
		const localExtensions = this.getLocalExtensions(installedExtensions);
		const ignoredExtensions = this.ignoredExtensionsManagementService.getIgnoredExtensions(installedExtensions);

		if (remoteExtensions) {
			this.logService.trace(`${this.syncResourceLogLabel}: Merging remote extensions with local extensions...`);
		} else {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote extensions does not exist. Synchronizing extensions for the first time.`);
		}

		const { added, removed, updated, remote } = merge(localExtensions, remoteExtensions, lastSyncExtensions, skippedExtensions, ignoredExtensions);
		const previewResult: IExtensionResourceMergeResult = {
			added,
			removed,
			updated,
			remote,
			content: this.getPreviewContent(localExtensions, added, updated, removed),
			localChange: added.length > 0 || removed.length > 0 || updated.length > 0 ? Change.Modified : Change.None,
			remoteChange: remote !== null ? Change.Modified : Change.None,
		};

		return [{
			skippedExtensions,
			localResource: this.localResource,
			localContent: this.format(localExtensions),
			localExtensions,
			remoteResource: this.remoteResource,
			remoteContent: remoteExtensions ? this.format(remoteExtensions) : null,
			previewResource: this.previewResource,
			previewResult,
			localChange: previewResult.localChange,
			remoteChange: previewResult.remoteChange,
			acceptedResource: this.acceptedResource,
		}];
	}

	private getPreviewContent(localExtensions: ISyncExtension[], added: ISyncExtension[], updated: ISyncExtension[], removed: IExtensionIdentifier[]): string {
		const preview: ISyncExtension[] = [...added, ...updated];

		const idsOrUUIDs: Set<string> = new Set<string>();
		const addIdentifier = (identifier: IExtensionIdentifier) => {
			idsOrUUIDs.add(identifier.id.toLowerCase());
			if (identifier.uuid) {
				idsOrUUIDs.add(identifier.uuid);
			}
		};
		preview.forEach(({ identifier }) => addIdentifier(identifier));
		removed.forEach(addIdentifier);

		for (const localExtension of localExtensions) {
			if (idsOrUUIDs.has(localExtension.identifier.id.toLowerCase()) || (localExtension.identifier.uuid && idsOrUUIDs.has(localExtension.identifier.uuid))) {
				// skip
				continue;
			}
			preview.push(localExtension);
		}

		return this.format(preview);
	}

	protected async getMergeResult(resourcePreview: IExtensionResourcePreview, token: CancellationToken): Promise<IMergeResult> {
		return { ...resourcePreview.previewResult, hasConflicts: false };
	}

	protected async getAcceptResult(resourcePreview: IExtensionResourcePreview, resource: URI, content: string | null | undefined, token: CancellationToken): Promise<IExtensionResourceMergeResult> {

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

	private async acceptLocal(resourcePreview: IExtensionResourcePreview): Promise<IExtensionResourceMergeResult> {
		const installedExtensions = await this.extensionManagementService.getInstalled();
		const ignoredExtensions = this.ignoredExtensionsManagementService.getIgnoredExtensions(installedExtensions);
		const mergeResult = merge(resourcePreview.localExtensions, null, null, resourcePreview.skippedExtensions, ignoredExtensions);
		const { added, removed, updated, remote } = mergeResult;
		return {
			content: resourcePreview.localContent,
			added,
			removed,
			updated,
			remote,
			localChange: added.length > 0 || removed.length > 0 || updated.length > 0 ? Change.Modified : Change.None,
			remoteChange: remote !== null ? Change.Modified : Change.None,
		};
	}

	private async acceptRemote(resourcePreview: IExtensionResourcePreview): Promise<IExtensionResourceMergeResult> {
		const installedExtensions = await this.extensionManagementService.getInstalled();
		const ignoredExtensions = this.ignoredExtensionsManagementService.getIgnoredExtensions(installedExtensions);
		const remoteExtensions = resourcePreview.remoteContent ? JSON.parse(resourcePreview.remoteContent) : null;
		if (remoteExtensions !== null) {
			const mergeResult = merge(resourcePreview.localExtensions, remoteExtensions, resourcePreview.localExtensions, [], ignoredExtensions);
			const { added, removed, updated, remote } = mergeResult;
			return {
				content: resourcePreview.remoteContent,
				added,
				removed,
				updated,
				remote,
				localChange: added.length > 0 || removed.length > 0 || updated.length > 0 ? Change.Modified : Change.None,
				remoteChange: remote !== null ? Change.Modified : Change.None,
			};
		} else {
			return {
				content: resourcePreview.remoteContent,
				added: [], removed: [], updated: [], remote: null,
				localChange: Change.None,
				remoteChange: Change.None,
			};
		}
	}

	protected async applyResult(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resourcePreviews: [IExtensionResourcePreview, IExtensionResourceMergeResult][], force: boolean): Promise<void> {
		let { skippedExtensions, localExtensions } = resourcePreviews[0][0];
		let { added, removed, updated, remote, localChange, remoteChange } = resourcePreviews[0][1];

		if (localChange === Change.None && remoteChange === Change.None) {
			this.logService.info(`${this.syncResourceLogLabel}: No changes found during synchronizing extensions.`);
		}

		if (localChange !== Change.None) {
			await this.backupLocal(JSON.stringify(localExtensions));
			skippedExtensions = await this.updateLocalExtensions(added, removed, updated, skippedExtensions);
		}

		if (remote) {
			// update remote
			this.logService.trace(`${this.syncResourceLogLabel}: Updating remote extensions...`);
			const content = JSON.stringify(remote);
			remoteUserData = await this.updateRemoteUserData(content, force ? null : remoteUserData.ref);
			this.logService.info(`${this.syncResourceLogLabel}: Updated remote extensions`);
		}

		if (lastSyncUserData?.ref !== remoteUserData.ref) {
			// update last sync
			this.logService.trace(`${this.syncResourceLogLabel}: Updating last synchronized extensions...`);
			await this.updateLastSyncUserData(remoteUserData, { skippedExtensions });
			this.logService.info(`${this.syncResourceLogLabel}: Updated last synchronized extensions`);
		}
	}

	async getAssociatedResources({ uri }: ISyncResourceHandle): Promise<{ resource: URI, comparableResource: URI }[]> {
		return [{ resource: this.extUri.joinPath(uri, 'extensions.json'), comparableResource: ExtensionsSynchroniser.EXTENSIONS_DATA_URI }];
	}

	override async resolveContent(uri: URI): Promise<string | null> {
		if (this.extUri.isEqual(uri, ExtensionsSynchroniser.EXTENSIONS_DATA_URI)) {
			const installedExtensions = await this.extensionManagementService.getInstalled();
			const ignoredExtensions = this.ignoredExtensionsManagementService.getIgnoredExtensions(installedExtensions);
			const localExtensions = this.getLocalExtensions(installedExtensions).filter(e => !ignoredExtensions.some(id => areSameExtensions({ id }, e.identifier)));
			return this.format(localExtensions);
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
					case 'extensions.json':
						return this.format(this.parseExtensions(syncData));
				}
			}
		}

		return null;
	}

	private format(extensions: ISyncExtension[]): string {
		extensions.sort((e1, e2) => {
			if (!e1.identifier.uuid && e2.identifier.uuid) {
				return -1;
			}
			if (e1.identifier.uuid && !e2.identifier.uuid) {
				return 1;
			}
			return compare(e1.identifier.id, e2.identifier.id);
		});
		const content = JSON.stringify(extensions);
		const edits = format(content, undefined, {});
		return applyEdits(content, edits);
	}

	async hasLocalData(): Promise<boolean> {
		try {
			const installedExtensions = await this.extensionManagementService.getInstalled();
			const localExtensions = this.getLocalExtensions(installedExtensions);
			if (localExtensions.some(e => e.installed || e.disabled)) {
				return true;
			}
		} catch (error) {
			/* ignore error */
		}
		return false;
	}

	private async updateLocalExtensions(added: ISyncExtension[], removed: IExtensionIdentifier[], updated: ISyncExtension[], skippedExtensions: ISyncExtension[]): Promise<ISyncExtension[]> {
		const removeFromSkipped: IExtensionIdentifier[] = [];
		const addToSkipped: ISyncExtension[] = [];
		const installedExtensions = await this.extensionManagementService.getInstalled();

		if (removed.length) {
			const extensionsToRemove = installedExtensions.filter(({ identifier, isBuiltin }) => !isBuiltin && removed.some(r => areSameExtensions(identifier, r)));
			await Promises.settled(extensionsToRemove.map(async extensionToRemove => {
				this.logService.trace(`${this.syncResourceLogLabel}: Uninstalling local extension...`, extensionToRemove.identifier.id);
				await this.extensionManagementService.uninstall(extensionToRemove, { donotIncludePack: true, donotCheckDependents: true });
				this.logService.info(`${this.syncResourceLogLabel}: Uninstalled local extension.`, extensionToRemove.identifier.id);
				removeFromSkipped.push(extensionToRemove.identifier);
			}));
		}

		if (added.length || updated.length) {
			await Promises.settled([...added, ...updated].map(async e => {
				const installedExtension = installedExtensions.find(installed => areSameExtensions(installed.identifier, e.identifier));

				// Builtin Extension Sync: Enablement & State
				if (installedExtension && installedExtension.isBuiltin) {
					if (e.state && installedExtension.manifest.version === e.version) {
						this.updateExtensionState(e.state, installedExtension.manifest.publisher, installedExtension.manifest.name, installedExtension.manifest.version);
					}
					if (e.disabled) {
						this.logService.trace(`${this.syncResourceLogLabel}: Disabling extension...`, e.identifier.id);
						await this.extensionEnablementService.disableExtension(e.identifier);
						this.logService.info(`${this.syncResourceLogLabel}: Disabled extension`, e.identifier.id);
					} else {
						this.logService.trace(`${this.syncResourceLogLabel}: Enabling extension...`, e.identifier.id);
						await this.extensionEnablementService.enableExtension(e.identifier);
						this.logService.info(`${this.syncResourceLogLabel}: Enabled extension`, e.identifier.id);
					}
					removeFromSkipped.push(e.identifier);
					return;
				}

				// User Extension Sync: Install/Update, Enablement & State
				const extension = await this.extensionGalleryService.getCompatibleExtension(e.identifier);

				/* Update extension state only if
				 *	extension is installed and version is same as synced version or
				 *	extension is not installed and installable
				 */
				if (e.state &&
					(installedExtension ? installedExtension.manifest.version === e.version /* Installed and has same version */
						: !!extension /* Installable */)
				) {
					const publisher = installedExtension ? installedExtension.manifest.publisher : extension!.publisher;
					const name = installedExtension ? installedExtension.manifest.name : extension!.name;
					this.updateExtensionState(e.state, publisher, name, installedExtension?.manifest.version);
				}

				if (extension) {
					try {
						if (e.disabled) {
							this.logService.trace(`${this.syncResourceLogLabel}: Disabling extension...`, e.identifier.id, extension.version);
							await this.extensionEnablementService.disableExtension(extension.identifier);
							this.logService.info(`${this.syncResourceLogLabel}: Disabled extension`, e.identifier.id, extension.version);
						} else {
							this.logService.trace(`${this.syncResourceLogLabel}: Enabling extension...`, e.identifier.id, extension.version);
							await this.extensionEnablementService.enableExtension(extension.identifier);
							this.logService.info(`${this.syncResourceLogLabel}: Enabled extension`, e.identifier.id, extension.version);
						}

						// Install only if the extension does not exist
						if (!installedExtension) {
							this.logService.trace(`${this.syncResourceLogLabel}: Installing extension...`, e.identifier.id, extension.version);
							await this.extensionManagementService.installFromGallery(extension, { isMachineScoped: false, donotIncludePackAndDependencies: true } /* pass options to prevent install and sync dialog in web */);
							this.logService.info(`${this.syncResourceLogLabel}: Installed extension.`, e.identifier.id, extension.version);
							removeFromSkipped.push(extension.identifier);
						}
					} catch (error) {
						addToSkipped.push(e);
						this.logService.error(error);
						this.logService.info(`${this.syncResourceLogLabel}: Skipped synchronizing extension`, extension.displayName || extension.identifier.id);
					}
				} else {
					addToSkipped.push(e);
				}
			}));
		}

		const newSkippedExtensions: ISyncExtension[] = [];
		for (const skippedExtension of skippedExtensions) {
			if (!removeFromSkipped.some(e => areSameExtensions(e, skippedExtension.identifier))) {
				newSkippedExtensions.push(skippedExtension);
			}
		}
		for (const skippedExtension of addToSkipped) {
			if (!newSkippedExtensions.some(e => areSameExtensions(e.identifier, skippedExtension.identifier))) {
				newSkippedExtensions.push(skippedExtension);
			}
		}
		return newSkippedExtensions;
	}

	private updateExtensionState(state: IStringDictionary<any>, publisher: string, name: string, version: string | undefined): void {
		const extensionState = getExtensionStorageState(publisher, name, this.storageService);
		const keys = version ? this.extensionsStorageSyncService.getKeysForSync({ id: getGalleryExtensionId(publisher, name), version }) : undefined;
		if (keys) {
			keys.forEach(key => { extensionState[key] = state[key]; });
		} else {
			Object.keys(state).forEach(key => extensionState[key] = state[key]);
		}
		storeExtensionStorageState(publisher, name, extensionState, this.storageService);
	}

	private parseExtensions(syncData: ISyncData): ISyncExtension[] {
		return JSON.parse(syncData.content);
	}

	private getLocalExtensions(installedExtensions: ILocalExtension[]): ISyncExtensionWithVersion[] {
		const disabledExtensions = this.extensionEnablementService.getDisabledExtensions();
		return installedExtensions
			.map(({ identifier, isBuiltin, manifest }) => {
				const syncExntesion: ISyncExtensionWithVersion = { identifier, version: manifest.version };
				if (disabledExtensions.some(disabledExtension => areSameExtensions(disabledExtension, identifier))) {
					syncExntesion.disabled = true;
				}
				if (!isBuiltin) {
					syncExntesion.installed = true;
				}
				try {
					const keys = this.extensionsStorageSyncService.getKeysForSync({ id: identifier.id, version: manifest.version });
					if (keys) {
						const extensionStorageState = getExtensionStorageState(manifest.publisher, manifest.name, this.storageService);
						syncExntesion.state = Object.keys(extensionStorageState).reduce((state: IStringDictionary<any>, key) => {
							if (keys.includes(key)) {
								state[key] = extensionStorageState[key];
							}
							return state;
						}, {});
					}
				} catch (error) {
					this.logService.info(`${this.syncResourceLogLabel}: Error while parsing extension state`, getErrorMessage(error));
				}
				return syncExntesion;
			});
	}

}

export interface IExtensionsInitializerPreviewResult {
	readonly installedExtensions: ILocalExtension[];
	readonly disabledExtensions: IExtensionIdentifier[];
	readonly newExtensions: IExtensionIdentifier[];
	readonly remoteExtensions: ISyncExtension[];
}

export abstract class AbstractExtensionsInitializer extends AbstractInitializer {

	constructor(
		@IExtensionManagementService protected readonly extensionManagementService: IExtensionManagementService,
		@IIgnoredExtensionsManagementService private readonly ignoredExtensionsManagementService: IIgnoredExtensionsManagementService,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
	) {
		super(SyncResource.Extensions, environmentService, logService, fileService);
	}

	protected async parseExtensions(remoteUserData: IRemoteUserData): Promise<ISyncExtension[] | null> {
		return remoteUserData.syncData ? await parseAndMigrateExtensions(remoteUserData.syncData, this.extensionManagementService) : null;
	}

	protected generatePreview(remoteExtensions: ISyncExtension[], localExtensions: ILocalExtension[]): IExtensionsInitializerPreviewResult {
		const installedExtensions: ILocalExtension[] = [];
		const newExtensions: IExtensionIdentifier[] = [];
		const disabledExtensions: IExtensionIdentifier[] = [];
		for (const extension of remoteExtensions) {
			if (this.ignoredExtensionsManagementService.hasToNeverSyncExtension(extension.identifier.id)) {
				// Skip extension ignored to sync
				continue;
			}

			const installedExtension = localExtensions.find(i => areSameExtensions(i.identifier, extension.identifier));
			if (installedExtension) {
				installedExtensions.push(installedExtension);
				if (extension.disabled) {
					disabledExtensions.push(extension.identifier);
				}
			} else if (extension.installed) {
				newExtensions.push(extension.identifier);
				if (extension.disabled) {
					disabledExtensions.push(extension.identifier);
				}
			}
		}
		return { installedExtensions, newExtensions, disabledExtensions, remoteExtensions };
	}

}
