/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import {
	UserDataSyncError, UserDataSyncErrorCode, IUserDataSyncStoreService, IUserDataSyncLogService, IUserDataSyncUtilService, CONFIGURATION_SYNC_STORE_KEY,
	SyncResource, IUserDataSyncResourceEnablementService, IUserDataSyncBackupStoreService, USER_DATA_SYNC_SCHEME, ISyncResourceHandle, IUserDataSynchroniser,
	IRemoteUserData, ISyncData, Change
} from 'vs/platform/userDataSync/common/userDataSync';
import { VSBuffer } from 'vs/base/common/buffer';
import { localize } from 'vs/nls';
import { Event } from 'vs/base/common/event';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { CancellationToken } from 'vs/base/common/cancellation';
import { updateIgnoredSettings, merge, getIgnoredSettings, isEmpty } from 'vs/platform/userDataSync/common/settingsMerge';
import { edit } from 'vs/platform/userDataSync/common/content';
import { AbstractJsonFileSynchroniser, IFileResourcePreview } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { URI } from 'vs/base/common/uri';
import { IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { joinPath, isEqual, dirname, basename } from 'vs/base/common/resources';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { Edit } from 'vs/base/common/jsonFormatter';
import { setProperty, applyEdits } from 'vs/base/common/jsonEdit';

export interface ISettingsSyncContent {
	settings: string;
}

function isSettingsSyncContent(thing: any): thing is ISettingsSyncContent {
	return thing
		&& (thing.settings && typeof thing.settings === 'string')
		&& Object.keys(thing).length === 1;
}

export class SettingsSynchroniser extends AbstractJsonFileSynchroniser implements IUserDataSynchroniser {

	protected readonly version: number = 1;
	private readonly previewResource: URI = joinPath(this.syncPreviewFolder, 'settings.json');
	private readonly localResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' });
	private readonly remoteResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' });
	private readonly acceptedResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' });

	constructor(
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IStorageService storageService: IStorageService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IUserDataSyncUtilService userDataSyncUtilService: IUserDataSyncUtilService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncResourceEnablementService userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
	) {
		super(environmentService.settingsResource, SyncResource.Settings, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncResourceEnablementService, telemetryService, logService, userDataSyncUtilService, configurationService);
	}

	protected async generatePullPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken): Promise<IFileResourcePreview[]> {

		const fileContent = await this.getLocalFileContent();
		const formatUtils = await this.getFormattingOptions();
		const ignoredSettings = await this.getIgnoredSettings();
		const remoteSettingsSyncContent = this.getSettingsSyncContent(remoteUserData);

		let previewContent: string | null = null;
		if (remoteSettingsSyncContent) {
			// Update ignored settings from local file content
			previewContent = updateIgnoredSettings(remoteSettingsSyncContent.settings, fileContent ? fileContent.value.toString() : '{}', ignoredSettings, formatUtils);
		}

		return [{
			localResource: this.localResource,
			fileContent,
			localContent: fileContent ? fileContent.value.toString() : null,
			remoteResource: this.remoteResource,
			remoteContent: remoteSettingsSyncContent ? remoteSettingsSyncContent.settings : null,
			previewResource: this.previewResource,
			previewContent,
			acceptedResource: this.acceptedResource,
			acceptedContent: previewContent,
			localChange: previewContent !== null ? Change.Modified : Change.None,
			remoteChange: Change.None,
			hasConflicts: false,
		}];
	}

	protected async generatePushPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken): Promise<IFileResourcePreview[]> {

		const fileContent = await this.getLocalFileContent();
		const formatUtils = await this.getFormattingOptions();
		const ignoredSettings = await this.getIgnoredSettings();
		const remoteSettingsSyncContent = this.getSettingsSyncContent(remoteUserData);

		let previewContent: string | null = fileContent?.value.toString() || null;
		if (previewContent) {
			// Remove ignored settings
			previewContent = updateIgnoredSettings(previewContent, '{}', ignoredSettings, formatUtils);
		}

		return [{
			localResource: this.localResource,
			fileContent,
			localContent: fileContent ? fileContent.value.toString() : null,
			remoteResource: this.remoteResource,
			remoteContent: remoteSettingsSyncContent ? remoteSettingsSyncContent.settings : null,
			previewResource: this.previewResource,
			previewContent,
			acceptedResource: this.acceptedResource,
			acceptedContent: previewContent,
			localChange: Change.None,
			remoteChange: previewContent !== null ? Change.Modified : Change.None,
			hasConflicts: false,
		}];
	}

	protected async generateReplacePreview(syncData: ISyncData, remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null): Promise<IFileResourcePreview[]> {

		const fileContent = await this.getLocalFileContent();
		const formatUtils = await this.getFormattingOptions();
		const ignoredSettings = await this.getIgnoredSettings();

		let previewContent: string | null = null;
		const settingsSyncContent = this.parseSettingsSyncContent(syncData.content);
		const remoteSettingsSyncContent = this.getSettingsSyncContent(remoteUserData);
		if (settingsSyncContent) {
			previewContent = updateIgnoredSettings(settingsSyncContent.settings, fileContent ? fileContent.value.toString() : '{}', ignoredSettings, formatUtils);
		}

		return [{
			localResource: this.localResource,
			fileContent,
			localContent: fileContent ? fileContent.value.toString() : null,
			remoteResource: this.remoteResource,
			remoteContent: remoteSettingsSyncContent ? remoteSettingsSyncContent.settings : null,
			previewResource: this.previewResource,
			previewContent,
			acceptedResource: this.acceptedResource,
			acceptedContent: previewContent,
			localChange: previewContent !== null ? Change.Modified : Change.None,
			remoteChange: previewContent !== null ? Change.Modified : Change.None,
			hasConflicts: false,
		}];
	}

	protected async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken): Promise<IFileResourcePreview[]> {
		const fileContent = await this.getLocalFileContent();
		const formattingOptions = await this.getFormattingOptions();
		const remoteSettingsSyncContent = this.getSettingsSyncContent(remoteUserData);
		const lastSettingsSyncContent: ISettingsSyncContent | null = lastSyncUserData ? this.getSettingsSyncContent(lastSyncUserData) : null;
		const ignoredSettings = await this.getIgnoredSettings();

		let acceptedContent: string | null = null;
		let previewContent: string | null = null;
		let hasLocalChanged: boolean = false;
		let hasRemoteChanged: boolean = false;
		let hasConflicts: boolean = false;

		if (remoteSettingsSyncContent) {
			const localContent: string = fileContent ? fileContent.value.toString() : '{}';
			this.validateContent(localContent);
			this.logService.trace(`${this.syncResourceLogLabel}: Merging remote settings with local settings...`);
			const result = merge(localContent, remoteSettingsSyncContent.settings, lastSettingsSyncContent ? lastSettingsSyncContent.settings : null, ignoredSettings, [], formattingOptions);
			acceptedContent = result.localContent || result.remoteContent;
			hasLocalChanged = result.localContent !== null;
			hasRemoteChanged = result.remoteContent !== null;
			hasConflicts = result.hasConflicts;
		}

		// First time syncing to remote
		else if (fileContent) {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote settings does not exist. Synchronizing settings for the first time.`);
			acceptedContent = fileContent.value.toString();
			hasRemoteChanged = true;
		}

		if (acceptedContent && !token.isCancellationRequested) {
			// Remove the ignored settings from the preview.
			previewContent = updateIgnoredSettings(acceptedContent, '{}', ignoredSettings, formattingOptions);
		}

		return [{
			localResource: this.localResource,
			fileContent,
			localContent: fileContent ? fileContent.value.toString() : null,
			remoteResource: this.remoteResource,
			remoteContent: remoteSettingsSyncContent ? remoteSettingsSyncContent.settings : null,
			previewResource: this.previewResource,
			previewContent,
			acceptedResource: this.acceptedResource,
			acceptedContent,
			localChange: hasLocalChanged ? Change.Modified : Change.None,
			remoteChange: hasRemoteChanged ? Change.Modified : Change.None,
			hasConflicts,
		}];
	}

	protected async updateResourcePreview(resourcePreview: IFileResourcePreview, resource: URI, acceptedContent: string | null): Promise<IFileResourcePreview> {
		if (acceptedContent && (isEqual(resource, this.previewResource) || isEqual(resource, this.remoteResource))) {
			const formatUtils = await this.getFormattingOptions();
			// Add ignored settings from local file content
			const ignoredSettings = await this.getIgnoredSettings();
			acceptedContent = updateIgnoredSettings(acceptedContent, resourcePreview.fileContent ? resourcePreview.fileContent.value.toString() : '{}', ignoredSettings, formatUtils);
		}
		return {
			...resourcePreview,
			acceptedContent,
			localChange: isEqual(resource, this.localResource) ? Change.None : Change.Modified,
			remoteChange: isEqual(resource, this.remoteResource) ? Change.None : Change.Modified,
		};
	}

	protected async applyPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resourcePreviews: IFileResourcePreview[], force: boolean): Promise<void> {
		let { fileContent, acceptedContent: content, localChange, remoteChange } = resourcePreviews[0];

		if (localChange === Change.None && remoteChange === Change.None) {
			this.logService.info(`${this.syncResourceLogLabel}: No changes found during synchronizing settings.`);
		}

		content = content !== null ? content : '{}';
		this.validateContent(content);

		if (localChange !== Change.None) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating local settings...`);
			if (fileContent) {
				await this.backupLocal(JSON.stringify(this.toSettingsSyncContent(fileContent.value.toString())));
			}
			await this.updateLocalFileContent(content, fileContent, force);
			this.logService.info(`${this.syncResourceLogLabel}: Updated local settings`);
		}

		if (remoteChange !== Change.None) {
			const formatUtils = await this.getFormattingOptions();
			// Update ignored settings from remote
			const remoteSettingsSyncContent = this.getSettingsSyncContent(remoteUserData);
			const ignoredSettings = await this.getIgnoredSettings(content);
			content = updateIgnoredSettings(content, remoteSettingsSyncContent ? remoteSettingsSyncContent.settings : '{}', ignoredSettings, formatUtils);
			this.logService.trace(`${this.syncResourceLogLabel}: Updating remote settings...`);
			remoteUserData = await this.updateRemoteUserData(JSON.stringify(this.toSettingsSyncContent(content)), force ? null : remoteUserData.ref);
			this.logService.info(`${this.syncResourceLogLabel}: Updated remote settings`);
		}

		// Delete the preview
		try {
			await this.fileService.del(this.previewResource);
		} catch (e) { /* ignore */ }

		if (lastSyncUserData?.ref !== remoteUserData.ref) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating last synchronized settings...`);
			await this.updateLastSyncUserData(remoteUserData);
			this.logService.info(`${this.syncResourceLogLabel}: Updated last synchronized settings`);
		}

	}

	async hasLocalData(): Promise<boolean> {
		try {
			const localFileContent = await this.getLocalFileContent();
			if (localFileContent) {
				const formatUtils = await this.getFormattingOptions();
				const content = edit(localFileContent.value.toString(), [CONFIGURATION_SYNC_STORE_KEY], undefined, formatUtils);
				return !isEmpty(content);
			}
		} catch (error) {
			if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {
				return true;
			}
		}
		return false;
	}

	async getAssociatedResources({ uri }: ISyncResourceHandle): Promise<{ resource: URI, comparableResource?: URI }[]> {
		return [{ resource: joinPath(uri, 'settings.json'), comparableResource: this.file }];
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
				const settingsSyncContent = this.parseSettingsSyncContent(syncData.content);
				if (settingsSyncContent) {
					switch (basename(uri)) {
						case 'settings.json':
							return settingsSyncContent.settings;
					}
				}
			}
		}
		return null;
	}

	protected async resolvePreviewContent(resource: URI): Promise<string | null> {
		let content = await super.resolvePreviewContent(resource);
		if (content) {
			const formatUtils = await this.getFormattingOptions();
			// remove ignored settings from the preview content
			const ignoredSettings = await this.getIgnoredSettings();
			content = updateIgnoredSettings(content, '{}', ignoredSettings, formatUtils);
		}
		return content;
	}

	private getSettingsSyncContent(remoteUserData: IRemoteUserData): ISettingsSyncContent | null {
		return remoteUserData.syncData ? this.parseSettingsSyncContent(remoteUserData.syncData.content) : null;
	}

	parseSettingsSyncContent(syncContent: string): ISettingsSyncContent | null {
		try {
			const parsed = <ISettingsSyncContent>JSON.parse(syncContent);
			return isSettingsSyncContent(parsed) ? parsed : /* migrate */ { settings: syncContent };
		} catch (e) {
			this.logService.error(e);
		}
		return null;
	}

	private toSettingsSyncContent(settings: string): ISettingsSyncContent {
		return { settings };
	}

	private _defaultIgnoredSettings: Promise<string[]> | undefined = undefined;
	private async getIgnoredSettings(content?: string): Promise<string[]> {
		if (!this._defaultIgnoredSettings) {
			this._defaultIgnoredSettings = this.userDataSyncUtilService.resolveDefaultIgnoredSettings();
			const disposable = Event.any<any>(
				Event.filter(this.extensionManagementService.onDidInstallExtension, (e => !!e.gallery)),
				Event.filter(this.extensionManagementService.onDidUninstallExtension, (e => !e.error)))(() => {
					disposable.dispose();
					this._defaultIgnoredSettings = undefined;
				});
		}
		const defaultIgnoredSettings = await this._defaultIgnoredSettings;
		return getIgnoredSettings(defaultIgnoredSettings, this.configurationService, content);
	}

	private validateContent(content: string): void {
		if (this.hasErrors(content)) {
			throw new UserDataSyncError(localize('errorInvalidSettings', "Unable to sync settings as there are errors/warning in settings file."), UserDataSyncErrorCode.LocalInvalidContent, this.resource);
		}
	}

	async recoverSettings(): Promise<void> {
		try {
			const fileContent = await this.getLocalFileContent();
			if (!fileContent) {
				return;
			}

			const syncData: ISyncData = JSON.parse(fileContent.value.toString());
			if (!isSyncData(syncData)) {
				return;
			}

			this.telemetryService.publicLog2('sync/settingsCorrupted');
			const settingsSyncContent = this.parseSettingsSyncContent(syncData.content);
			if (!settingsSyncContent || !settingsSyncContent.settings) {
				return;
			}

			let settings = settingsSyncContent.settings;
			const formattingOptions = await this.getFormattingOptions();
			for (const key in syncData) {
				if (['version', 'content', 'machineId'].indexOf(key) === -1 && (syncData as any)[key] !== undefined) {
					const edits: Edit[] = setProperty(settings, [key], (syncData as any)[key], formattingOptions);
					if (edits.length) {
						settings = applyEdits(settings, edits);
					}
				}
			}

			await this.fileService.writeFile(this.file, VSBuffer.fromString(settings));
		} catch (e) {/* ignore */ }
	}
}

function isSyncData(thing: any): thing is ISyncData {
	if (thing
		&& (thing.version !== undefined && typeof thing.version === 'number')
		&& (thing.content !== undefined && typeof thing.content === 'string')
		&& (thing.machineId !== undefined && typeof thing.machineId === 'string')
	) {
		return true;
	}

	return false;
}
