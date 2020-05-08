/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { UserDataSyncError, UserDataSyncErrorCode, SyncStatus, IUserDataSyncStoreService, IUserDataSyncLogService, IUserDataSyncUtilService, CONFIGURATION_SYNC_STORE_KEY, SyncResource, IUserDataSyncEnablementService, IUserDataSyncBackupStoreService, USER_DATA_SYNC_SCHEME, PREVIEW_DIR_NAME, ISyncResourceHandle } from 'vs/platform/userDataSync/common/userDataSync';
import { VSBuffer } from 'vs/base/common/buffer';
import { localize } from 'vs/nls';
import { Event } from 'vs/base/common/event';
import { createCancelablePromise } from 'vs/base/common/async';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { CancellationToken } from 'vs/base/common/cancellation';
import { updateIgnoredSettings, merge, getIgnoredSettings, isEmpty } from 'vs/platform/userDataSync/common/settingsMerge';
import { edit } from 'vs/platform/userDataSync/common/content';
import { IFileSyncPreviewResult, AbstractJsonFileSynchroniser, IRemoteUserData } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { URI } from 'vs/base/common/uri';
import { IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { joinPath, isEqual, dirname, basename } from 'vs/base/common/resources';

export interface ISettingsSyncContent {
	settings: string;
}

function isSettingsSyncContent(thing: any): thing is ISettingsSyncContent {
	return thing
		&& (thing.settings && typeof thing.settings === 'string')
		&& Object.keys(thing).length === 1;
}

export class SettingsSynchroniser extends AbstractJsonFileSynchroniser {

	_serviceBrand: any;

	protected readonly version: number = 1;
	protected readonly localPreviewResource: URI = joinPath(this.syncFolder, PREVIEW_DIR_NAME, 'settings.json');
	protected readonly remotePreviewResource: URI = this.localPreviewResource.with({ scheme: USER_DATA_SYNC_SCHEME });

	constructor(
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IUserDataSyncUtilService userDataSyncUtilService: IUserDataSyncUtilService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncEnablementService userDataSyncEnablementService: IUserDataSyncEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
	) {
		super(environmentService.settingsResource, SyncResource.Settings, fileService, environmentService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncEnablementService, telemetryService, logService, userDataSyncUtilService, configurationService);
	}

	protected setStatus(status: SyncStatus): void {
		super.setStatus(status);
		if (this.status !== SyncStatus.HasConflicts) {
			this.setConflicts([]);
		}
	}

	async pull(): Promise<void> {
		if (!this.isEnabled()) {
			this.logService.info(`${this.syncResourceLogLabel}: Skipped pulling settings as it is disabled.`);
			return;
		}

		this.stop();

		try {
			this.logService.info(`${this.syncResourceLogLabel}: Started pulling settings...`);
			this.setStatus(SyncStatus.Syncing);

			const lastSyncUserData = await this.getLastSyncUserData();
			const remoteUserData = await this.getRemoteUserData(lastSyncUserData);
			const remoteSettingsSyncContent = this.getSettingsSyncContent(remoteUserData);

			if (remoteSettingsSyncContent !== null) {
				const fileContent = await this.getLocalFileContent();
				const formatUtils = await this.getFormattingOptions();
				// Update ignored settings from local file content
				const ignoredSettings = await this.getIgnoredSettings();
				const content = updateIgnoredSettings(remoteSettingsSyncContent.settings, fileContent ? fileContent.value.toString() : '{}', ignoredSettings, formatUtils);
				this.syncPreviewResultPromise = createCancelablePromise(() => Promise.resolve<IFileSyncPreviewResult>({
					fileContent,
					remoteUserData,
					lastSyncUserData,
					content,
					hasLocalChanged: true,
					hasRemoteChanged: false,
					hasConflicts: false,
				}));

				await this.apply();
			}

			// No remote exists to pull
			else {
				this.logService.info(`${this.syncResourceLogLabel}: Remote settings does not exist.`);
			}

			this.logService.info(`${this.syncResourceLogLabel}: Finished pulling settings.`);
		} finally {
			this.setStatus(SyncStatus.Idle);
		}
	}

	async push(): Promise<void> {
		if (!this.isEnabled()) {
			this.logService.info(`${this.syncResourceLogLabel}: Skipped pushing settings as it is disabled.`);
			return;
		}

		this.stop();

		try {
			this.logService.info(`${this.syncResourceLogLabel}: Started pushing settings...`);
			this.setStatus(SyncStatus.Syncing);

			const fileContent = await this.getLocalFileContent();

			if (fileContent !== null) {
				const formatUtils = await this.getFormattingOptions();
				// Remove ignored settings
				const ignoredSettings = await this.getIgnoredSettings();
				const content = updateIgnoredSettings(fileContent.value.toString(), '{}', ignoredSettings, formatUtils);
				const lastSyncUserData = await this.getLastSyncUserData();
				const remoteUserData = await this.getRemoteUserData(lastSyncUserData);

				this.syncPreviewResultPromise = createCancelablePromise(() => Promise.resolve<IFileSyncPreviewResult>({
					fileContent,
					remoteUserData,
					lastSyncUserData,
					content,
					hasRemoteChanged: true,
					hasLocalChanged: false,
					hasConflicts: false,
				}));

				await this.apply(true);
			}

			// No local exists to push
			else {
				this.logService.info(`${this.syncResourceLogLabel}: Local settings does not exist.`);
			}

			this.logService.info(`${this.syncResourceLogLabel}: Finished pushing settings.`);
		} finally {
			this.setStatus(SyncStatus.Idle);
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
		if (isEqual(this.remotePreviewResource, uri)) {
			return this.getConflictContent(uri);
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

	protected async getConflictContent(conflictResource: URI): Promise<string | null> {
		let content = await super.getConflictContent(conflictResource);
		if (content !== null) {
			const settingsSyncContent = this.parseSettingsSyncContent(content);
			content = settingsSyncContent ? settingsSyncContent.settings : null;
		}
		if (content !== null) {
			const formatUtils = await this.getFormattingOptions();
			// remove ignored settings from the remote content for preview
			const ignoredSettings = await this.getIgnoredSettings();
			content = updateIgnoredSettings(content, '{}', ignoredSettings, formatUtils);
		}
		return content;
	}

	async acceptConflict(conflict: URI, content: string): Promise<void> {
		if (this.status === SyncStatus.HasConflicts
			&& (isEqual(this.localPreviewResource, conflict) || isEqual(this.remotePreviewResource, conflict))
		) {
			const preview = await this.syncPreviewResultPromise!;
			this.cancel();
			const formatUtils = await this.getFormattingOptions();
			// Add ignored settings from local file content
			const ignoredSettings = await this.getIgnoredSettings();
			content = updateIgnoredSettings(content, preview.fileContent ? preview.fileContent.value.toString() : '{}', ignoredSettings, formatUtils);
			this.syncPreviewResultPromise = createCancelablePromise(async () => ({ ...preview, content }));
			await this.apply(true);
			this.setStatus(SyncStatus.Idle);
		}
	}

	async resolveSettingsConflicts(resolvedConflicts: { key: string, value: any | undefined }[]): Promise<void> {
		if (this.status === SyncStatus.HasConflicts) {
			const preview = await this.syncPreviewResultPromise!;
			this.cancel();
			await this.performSync(preview.remoteUserData, preview.lastSyncUserData, resolvedConflicts);
		}
	}

	protected async performSync(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resolvedConflicts: { key: string, value: any | undefined }[] = []): Promise<SyncStatus> {
		try {
			const result = await this.getPreview(remoteUserData, lastSyncUserData, resolvedConflicts);
			if (result.hasConflicts) {
				return SyncStatus.HasConflicts;
			}
			await this.apply();
			return SyncStatus.Idle;
		} catch (e) {
			this.syncPreviewResultPromise = null;
			if (e instanceof UserDataSyncError) {
				switch (e.code) {
					case UserDataSyncErrorCode.LocalPreconditionFailed:
						// Rejected as there is a new local version. Syncing again.
						this.logService.info(`${this.syncResourceLogLabel}: Failed to synchronize settings as there is a new local version available. Synchronizing again...`);
						return this.performSync(remoteUserData, lastSyncUserData, resolvedConflicts);
				}
			}
			throw e;
		}
	}

	private async apply(forcePush?: boolean): Promise<void> {
		if (!this.syncPreviewResultPromise) {
			return;
		}

		let { fileContent, remoteUserData, lastSyncUserData, content, hasLocalChanged, hasRemoteChanged } = await this.syncPreviewResultPromise;

		if (content !== null) {

			this.validateContent(content);

			if (hasLocalChanged) {
				this.logService.trace(`${this.syncResourceLogLabel}: Updating local settings...`);
				if (fileContent) {
					await this.backupLocal(JSON.stringify(this.toSettingsSyncContent(fileContent.value.toString())));
				}
				await this.updateLocalFileContent(content, fileContent);
				this.logService.info(`${this.syncResourceLogLabel}: Updated local settings`);
			}
			if (hasRemoteChanged) {
				const formatUtils = await this.getFormattingOptions();
				// Update ignored settings from remote
				const remoteSettingsSyncContent = this.getSettingsSyncContent(remoteUserData);
				const ignoredSettings = await this.getIgnoredSettings(content);
				content = updateIgnoredSettings(content, remoteSettingsSyncContent ? remoteSettingsSyncContent.settings : '{}', ignoredSettings, formatUtils);
				this.logService.trace(`${this.syncResourceLogLabel}: Updating remote settings...`);
				remoteUserData = await this.updateRemoteUserData(JSON.stringify(this.toSettingsSyncContent(content)), forcePush ? null : remoteUserData.ref);
				this.logService.info(`${this.syncResourceLogLabel}: Updated remote settings`);
			}

			// Delete the preview
			try {
				await this.fileService.del(this.localPreviewResource);
			} catch (e) { /* ignore */ }
		} else {
			this.logService.info(`${this.syncResourceLogLabel}: No changes found during synchronizing settings.`);
		}

		if (lastSyncUserData?.ref !== remoteUserData.ref) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating last synchronized settings...`);
			await this.updateLastSyncUserData(remoteUserData);
			this.logService.info(`${this.syncResourceLogLabel}: Updated last synchronized settings`);
		}

		this.syncPreviewResultPromise = null;
	}

	private getPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resolvedConflicts: { key: string, value: any }[] = []): Promise<IFileSyncPreviewResult> {
		if (!this.syncPreviewResultPromise) {
			this.syncPreviewResultPromise = createCancelablePromise(token => this.generatePreview(remoteUserData, lastSyncUserData, resolvedConflicts, token));
		}
		return this.syncPreviewResultPromise;
	}

	protected async generatePreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resolvedConflicts: { key: string, value: any }[] = [], token: CancellationToken = CancellationToken.None): Promise<IFileSyncPreviewResult> {
		const fileContent = await this.getLocalFileContent();
		const formattingOptions = await this.getFormattingOptions();
		const remoteSettingsSyncContent = this.getSettingsSyncContent(remoteUserData);
		const lastSettingsSyncContent = lastSyncUserData ? this.getSettingsSyncContent(lastSyncUserData) : null;

		let content: string | null = null;
		let hasLocalChanged: boolean = false;
		let hasRemoteChanged: boolean = false;
		let hasConflicts: boolean = false;

		if (remoteSettingsSyncContent) {
			const localContent: string = fileContent ? fileContent.value.toString() : '{}';
			this.validateContent(localContent);
			this.logService.trace(`${this.syncResourceLogLabel}: Merging remote settings with local settings...`);
			const ignoredSettings = await this.getIgnoredSettings();
			const result = merge(localContent, remoteSettingsSyncContent.settings, lastSettingsSyncContent ? lastSettingsSyncContent.settings : null, ignoredSettings, resolvedConflicts, formattingOptions);
			content = result.localContent || result.remoteContent;
			hasLocalChanged = result.localContent !== null;
			hasRemoteChanged = result.remoteContent !== null;
			hasConflicts = result.hasConflicts;
		}

		// First time syncing to remote
		else if (fileContent) {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote settings does not exist. Synchronizing settings for the first time.`);
			content = fileContent.value.toString();
			hasRemoteChanged = true;
		}

		if (content && !token.isCancellationRequested) {
			// Remove the ignored settings from the preview.
			const ignoredSettings = await this.getIgnoredSettings();
			const previewContent = updateIgnoredSettings(content, '{}', ignoredSettings, formattingOptions);
			await this.fileService.writeFile(this.localPreviewResource, VSBuffer.fromString(previewContent));
		}

		this.setConflicts(hasConflicts && !token.isCancellationRequested ? [{ local: this.localPreviewResource, remote: this.remotePreviewResource }] : []);

		return { fileContent, remoteUserData, lastSyncUserData, content, hasLocalChanged, hasRemoteChanged, hasConflicts };
	}

	private getSettingsSyncContent(remoteUserData: IRemoteUserData): ISettingsSyncContent | null {
		return remoteUserData.syncData ? this.parseSettingsSyncContent(remoteUserData.syncData.content) : null;
	}

	private parseSettingsSyncContent(syncContent: string): ISettingsSyncContent | null {
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
	protected async getIgnoredSettings(content?: string): Promise<string[]> {
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
}
