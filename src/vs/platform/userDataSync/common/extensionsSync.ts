/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IUserDataSyncStoreService, ISyncExtension, IUserDataSyncLogService, IUserDataSynchroniser, SyncResource, IUserDataSyncResourceEnablementService,
	IUserDataSyncBackupStoreService, ISyncResourceHandle, USER_DATA_SYNC_SCHEME, IRemoteUserData, ISyncData, Change
} from 'vs/platform/userDataSync/common/userDataSync';
import { Event } from 'vs/base/common/event';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IExtensionManagementService, IExtensionGalleryService, IGlobalExtensionEnablementService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionType, IExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IFileService } from 'vs/platform/files/common/files';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { merge, getIgnoredExtensions } from 'vs/platform/userDataSync/common/extensionsMerge';
import { AbstractInitializer, AbstractSynchroniser, IAcceptResult, IMergeResult, IResourcePreview } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { URI } from 'vs/base/common/uri';
import { joinPath, dirname, basename, isEqual } from 'vs/base/common/resources';
import { format } from 'vs/base/common/jsonFormatter';
import { applyEdits } from 'vs/base/common/jsonEdit';
import { compare } from 'vs/base/common/strings';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { CancellationToken } from 'vs/base/common/cancellation';

interface IExtensionResourceMergeResult extends IAcceptResult {
	readonly added: ISyncExtension[];
	readonly removed: IExtensionIdentifier[];
	readonly updated: ISyncExtension[];
	readonly remote: ISyncExtension[] | null;
}

interface IExtensionResourcePreview extends IResourcePreview {
	readonly localExtensions: ISyncExtension[];
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
		const systemExtensions = await extensionManagementService.getInstalled(ExtensionType.System);
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
				if (systemExtensions.every(installed => !areSameExtensions(installed.identifier, extension.identifier))) {
					extension.installed = true;
				}
			}
			// #endregion
		}
	}
	return extensions;
}

export class ExtensionsSynchroniser extends AbstractSynchroniser implements IUserDataSynchroniser {

	private static readonly EXTENSIONS_DATA_URI = URI.from({ scheme: USER_DATA_SYNC_SCHEME, authority: 'extensions', path: `/extensions.json` });

	/*
		Version 3 - Introduce installed property to skip installing built in extensions
		protected readonly version: number = 3;
	*/
	/* Version 4: Change settings from `sync.${setting}` to `settingsSync.{setting}` */
	protected readonly version: number = 4;

	protected isEnabled(): boolean { return super.isEnabled() && this.extensionGalleryService.isEnabled(); }
	private readonly previewResource: URI = joinPath(this.syncPreviewFolder, 'extensions.json');
	private readonly localResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' });
	private readonly remoteResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' });
	private readonly acceptedResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' });

	constructor(
		@IEnvironmentService environmentService: IEnvironmentService,
		@IFileService fileService: IFileService,
		@IStorageService storageService: IStorageService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IGlobalExtensionEnablementService private readonly extensionEnablementService: IGlobalExtensionEnablementService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncResourceEnablementService userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(SyncResource.Extensions, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncResourceEnablementService, telemetryService, logService, configurationService);
		this._register(
			Event.debounce(
				Event.any<any>(
					Event.filter(this.extensionManagementService.onDidInstallExtension, (e => !!e.gallery)),
					Event.filter(this.extensionManagementService.onDidUninstallExtension, (e => !e.error)),
					this.extensionEnablementService.onDidChangeEnablement),
				() => undefined, 500)(() => this.triggerLocalChange()));
	}

	protected async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: ILastSyncUserData | null): Promise<IExtensionResourcePreview[]> {
		const remoteExtensions: ISyncExtension[] | null = remoteUserData.syncData ? await parseAndMigrateExtensions(remoteUserData.syncData, this.extensionManagementService) : null;
		const skippedExtensions: ISyncExtension[] = lastSyncUserData ? lastSyncUserData.skippedExtensions || [] : [];
		const lastSyncExtensions: ISyncExtension[] | null = lastSyncUserData ? await parseAndMigrateExtensions(lastSyncUserData.syncData!, this.extensionManagementService) : null;

		const installedExtensions = await this.extensionManagementService.getInstalled();
		const localExtensions = this.getLocalExtensions(installedExtensions);
		const ignoredExtensions = getIgnoredExtensions(installedExtensions, this.configurationService);

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

	private async acceptLocal(resourcePreview: IExtensionResourcePreview): Promise<IExtensionResourceMergeResult> {
		const installedExtensions = await this.extensionManagementService.getInstalled();
		const ignoredExtensions = getIgnoredExtensions(installedExtensions, this.configurationService);
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
		const ignoredExtensions = getIgnoredExtensions(installedExtensions, this.configurationService);
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
		return [{ resource: joinPath(uri, 'extensions.json'), comparableResource: ExtensionsSynchroniser.EXTENSIONS_DATA_URI }];
	}

	async resolveContent(uri: URI): Promise<string | null> {
		if (isEqual(uri, ExtensionsSynchroniser.EXTENSIONS_DATA_URI)) {
			const installedExtensions = await this.extensionManagementService.getInstalled();
			const ignoredExtensions = getIgnoredExtensions(installedExtensions, this.configurationService);
			const localExtensions = this.getLocalExtensions(installedExtensions).filter(e => !ignoredExtensions.some(id => areSameExtensions({ id }, e.identifier)));
			return this.format(localExtensions);
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

		if (removed.length) {
			const installedExtensions = await this.extensionManagementService.getInstalled(ExtensionType.User);
			const extensionsToRemove = installedExtensions.filter(({ identifier }) => removed.some(r => areSameExtensions(identifier, r)));
			await Promise.all(extensionsToRemove.map(async extensionToRemove => {
				this.logService.trace(`${this.syncResourceLogLabel}: Uninstalling local extension...`, extensionToRemove.identifier.id);
				await this.extensionManagementService.uninstall(extensionToRemove);
				this.logService.info(`${this.syncResourceLogLabel}: Uninstalled local extension.`, extensionToRemove.identifier.id);
				removeFromSkipped.push(extensionToRemove.identifier);
			}));
		}

		if (added.length || updated.length) {
			await Promise.all([...added, ...updated].map(async e => {
				const installedExtensions = await this.extensionManagementService.getInstalled();
				const installedExtension = installedExtensions.filter(installed => areSameExtensions(installed.identifier, e.identifier))[0];

				// Builtin Extension: Sync only enablement state
				if (installedExtension && installedExtension.type === ExtensionType.System) {
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

				const extension = await this.extensionGalleryService.getCompatibleExtension(e.identifier, e.version);
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
						if (!installedExtension || installedExtension.manifest.version !== extension.version) {
							this.logService.trace(`${this.syncResourceLogLabel}: Installing extension...`, e.identifier.id, extension.version);
							await this.extensionManagementService.installFromGallery(extension);
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

	private parseExtensions(syncData: ISyncData): ISyncExtension[] {
		return JSON.parse(syncData.content);
	}

	private getLocalExtensions(installedExtensions: ILocalExtension[]): ISyncExtension[] {
		const disabledExtensions = this.extensionEnablementService.getDisabledExtensions();
		return installedExtensions
			.map(({ identifier, type }) => {
				const syncExntesion: ISyncExtension = { identifier };
				if (disabledExtensions.some(disabledExtension => areSameExtensions(disabledExtension, identifier))) {
					syncExntesion.disabled = true;
				}
				if (type === ExtensionType.User) {
					syncExntesion.installed = true;
				}
				return syncExntesion;
			});
	}

}

export class ExtensionsInitializer extends AbstractInitializer {

	constructor(
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@IGlobalExtensionEnablementService private readonly extensionEnablementService: IGlobalExtensionEnablementService,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
	) {
		super(SyncResource.Extensions, environmentService, logService, fileService);
	}

	async doInitialize(remoteUserData: IRemoteUserData): Promise<void> {
		const remoteExtensions: ISyncExtension[] | null = remoteUserData.syncData ? await parseAndMigrateExtensions(remoteUserData.syncData, this.extensionManagementService) : null;
		if (!remoteExtensions) {
			this.logService.info('Skipping initializing extensions because remote extensions does not exist.');
			return;
		}

		const installedExtensions = await this.extensionManagementService.getInstalled();
		const toInstall: { names: string[], uuids: string[] } = { names: [], uuids: [] };
		const toDisable: IExtensionIdentifier[] = [];
		for (const extension of remoteExtensions) {
			if (installedExtensions.some(i => areSameExtensions(i.identifier, extension.identifier))) {
				if (extension.disabled) {
					toDisable.push(extension.identifier);
				}
			} else {
				if (extension.installed) {
					if (extension.identifier.uuid) {
						toInstall.uuids.push(extension.identifier.uuid);
					} else {
						toInstall.names.push(extension.identifier.id);
					}
				}
			}
		}

		if (toInstall.names.length || toInstall.uuids.length) {
			const galleryExtensions = (await this.galleryService.query({ ids: toInstall.uuids, names: toInstall.names, pageSize: toInstall.uuids.length + toInstall.names.length }, CancellationToken.None)).firstPage;
			for (const galleryExtension of galleryExtensions) {
				try {
					this.logService.trace(`Installing extension...`, galleryExtension.identifier.id);
					await this.extensionManagementService.installFromGallery(galleryExtension);
					this.logService.info(`Installed extension.`, galleryExtension.identifier.id);
				} catch (error) {
					this.logService.error(error);
				}
			}
		}

		if (toDisable.length) {
			for (const identifier of toDisable) {
				this.logService.trace(`Enabling extension...`, identifier.id);
				await this.extensionEnablementService.disableExtension(identifier);
				this.logService.info(`Enabled extension`, identifier.id);
			}
		}
	}

}


