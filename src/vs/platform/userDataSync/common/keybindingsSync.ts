/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import {
	UserDataSyncError, UserDataSyncErrorCode, IUserDataSyncStoreService, IUserDataSyncLogService, IUserDataSyncUtilService, SyncResource,
	IUserDataSynchroniser, IUserDataSyncResourceEnablementService, IUserDataSyncBackupStoreService, USER_DATA_SYNC_SCHEME, ISyncResourceHandle,
	IRemoteUserData, ISyncData, Change
} from 'vs/platform/userDataSync/common/userDataSync';
import { merge } from 'vs/platform/userDataSync/common/keybindingsMerge';
import { VSBuffer } from 'vs/base/common/buffer';
import { parse } from 'vs/base/common/json';
import { localize } from 'vs/nls';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { CancellationToken } from 'vs/base/common/cancellation';
import { OS, OperatingSystem } from 'vs/base/common/platform';
import { isUndefined } from 'vs/base/common/types';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { AbstractJsonFileSynchroniser, IFileResourcePreview } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { URI } from 'vs/base/common/uri';
import { joinPath, isEqual, dirname, basename } from 'vs/base/common/resources';
import { IStorageService } from 'vs/platform/storage/common/storage';

interface ISyncContent {
	mac?: string;
	linux?: string;
	windows?: string;
	all?: string;
}

export class KeybindingsSynchroniser extends AbstractJsonFileSynchroniser implements IUserDataSynchroniser {

	protected readonly version: number = 1;
	private readonly previewResource: URI = joinPath(this.syncPreviewFolder, 'keybindings.json');
	private readonly localResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' });
	private readonly remoteResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' });
	private readonly acceptedResource: URI = this.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' });

	constructor(
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncResourceEnablementService userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IStorageService storageService: IStorageService,
		@IUserDataSyncUtilService userDataSyncUtilService: IUserDataSyncUtilService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(environmentService.keybindingsResource, SyncResource.Keybindings, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncResourceEnablementService, telemetryService, logService, userDataSyncUtilService, configurationService);
	}

	protected async generatePullPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken): Promise<IFileResourcePreview[]> {
		const fileContent = await this.getLocalFileContent();
		const previewContent = remoteUserData.syncData !== null ? this.getKeybindingsContentFromSyncContent(remoteUserData.syncData.content) : null;

		return [{
			localResource: this.localResource,
			fileContent,
			localContent: fileContent ? fileContent.value.toString() : null,
			remoteResource: this.remoteResource,
			remoteContent: previewContent,
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
		const previewContent: string | null = fileContent ? fileContent.value.toString() : null;

		return [{
			localResource: this.localResource,
			fileContent,
			localContent: fileContent ? fileContent.value.toString() : null,
			remoteResource: this.remoteResource,
			remoteContent: remoteUserData.syncData !== null ? this.getKeybindingsContentFromSyncContent(remoteUserData.syncData.content) : null,
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
		const previewContent = this.getKeybindingsContentFromSyncContent(syncData.content);

		return [{
			localResource: this.localResource,
			fileContent,
			localContent: fileContent ? fileContent.value.toString() : null,
			remoteResource: this.remoteResource,
			remoteContent: remoteUserData.syncData !== null ? this.getKeybindingsContentFromSyncContent(remoteUserData.syncData.content) : null,
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
		const remoteContent = remoteUserData.syncData ? this.getKeybindingsContentFromSyncContent(remoteUserData.syncData.content) : null;
		const lastSyncContent: string | null = lastSyncUserData && lastSyncUserData.syncData ? this.getKeybindingsContentFromSyncContent(lastSyncUserData.syncData.content) : null;

		// Get file content last to get the latest
		const fileContent = await this.getLocalFileContent();
		const formattingOptions = await this.getFormattingOptions();

		let previewContent: string | null = null;
		let hasLocalChanged: boolean = false;
		let hasRemoteChanged: boolean = false;
		let hasConflicts: boolean = false;

		if (remoteContent) {
			const localContent: string = fileContent ? fileContent.value.toString() : '[]';
			if (!localContent.trim() || this.hasErrors(localContent)) {
				throw new UserDataSyncError(localize('errorInvalidSettings', "Unable to sync keybindings because the content in the file is not valid. Please open the file and correct it."), UserDataSyncErrorCode.LocalInvalidContent, this.resource);
			}

			if (!lastSyncContent // First time sync
				|| lastSyncContent !== localContent // Local has forwarded
				|| lastSyncContent !== remoteContent // Remote has forwarded
			) {
				this.logService.trace(`${this.syncResourceLogLabel}: Merging remote keybindings with local keybindings...`);
				const result = await merge(localContent, remoteContent, lastSyncContent, formattingOptions, this.userDataSyncUtilService);
				// Sync only if there are changes
				if (result.hasChanges) {
					previewContent = result.mergeContent;
					hasConflicts = result.hasConflicts;
					hasLocalChanged = hasConflicts || result.mergeContent !== localContent;
					hasRemoteChanged = hasConflicts || result.mergeContent !== remoteContent;
				}
			}
		}

		// First time syncing to remote
		else if (fileContent) {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote keybindings does not exist. Synchronizing keybindings for the first time.`);
			previewContent = fileContent.value.toString();
			hasRemoteChanged = true;
		}

		if (previewContent && !token.isCancellationRequested) {
			await this.fileService.writeFile(this.previewResource, VSBuffer.fromString(previewContent));
		}

		return [{
			localResource: this.localResource,
			fileContent,
			localContent: fileContent ? fileContent.value.toString() : null,
			remoteResource: this.remoteResource,
			remoteContent,
			previewResource: this.previewResource,
			previewContent,
			acceptedResource: this.acceptedResource,
			acceptedContent: previewContent,
			hasConflicts,
			localChange: hasLocalChanged ? fileContent ? Change.Modified : Change.Added : Change.None,
			remoteChange: hasRemoteChanged ? Change.Modified : Change.None,
		}];
	}

	protected async applyPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resourcePreviews: IFileResourcePreview[], force: boolean): Promise<void> {
		let { fileContent, acceptedContent: content, localChange, remoteChange } = resourcePreviews[0];

		if (content !== null) {
			if (this.hasErrors(content)) {
				throw new UserDataSyncError(localize('errorInvalidSettings', "Unable to sync keybindings because the content in the file is not valid. Please open the file and correct it."), UserDataSyncErrorCode.LocalInvalidContent, this.resource);
			}

			if (localChange !== Change.None) {
				this.logService.trace(`${this.syncResourceLogLabel}: Updating local keybindings...`);
				if (fileContent) {
					await this.backupLocal(this.toSyncContent(fileContent.value.toString(), null));
				}
				await this.updateLocalFileContent(content, fileContent, force);
				this.logService.info(`${this.syncResourceLogLabel}: Updated local keybindings`);
			}

			if (remoteChange !== Change.None) {
				this.logService.trace(`${this.syncResourceLogLabel}: Updating remote keybindings...`);
				const remoteContents = this.toSyncContent(content, remoteUserData.syncData ? remoteUserData.syncData.content : null);
				remoteUserData = await this.updateRemoteUserData(remoteContents, force ? null : remoteUserData.ref);
				this.logService.info(`${this.syncResourceLogLabel}: Updated remote keybindings`);
			}

			// Delete the preview
			try {
				await this.fileService.del(this.previewResource);
			} catch (e) { /* ignore */ }
		} else {
			this.logService.info(`${this.syncResourceLogLabel}: No changes found during synchronizing keybindings.`);
		}

		if (lastSyncUserData?.ref !== remoteUserData.ref) {
			this.logService.trace(`${this.syncResourceLogLabel}: Updating last synchronized keybindings...`);
			const lastSyncContent = content !== null || fileContent !== null ? this.toSyncContent(content !== null ? content : fileContent!.value.toString(), null) : null;
			await this.updateLastSyncUserData({ ref: remoteUserData.ref, syncData: lastSyncContent ? { version: remoteUserData.syncData!.version, machineId: remoteUserData.syncData!.machineId, content: lastSyncContent } : null });
			this.logService.info(`${this.syncResourceLogLabel}: Updated last synchronized keybindings`);
		}

	}

	async hasLocalData(): Promise<boolean> {
		try {
			const localFileContent = await this.getLocalFileContent();
			if (localFileContent) {
				const keybindings = parse(localFileContent.value.toString());
				if (isNonEmptyArray(keybindings)) {
					return true;
				}
			}
		} catch (error) {
			if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {
				return true;
			}
		}
		return false;
	}

	async getAssociatedResources({ uri }: ISyncResourceHandle): Promise<{ resource: URI, comparableResource?: URI }[]> {
		return [{ resource: joinPath(uri, 'keybindings.json'), comparableResource: this.file }];
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
					case 'keybindings.json':
						return this.getKeybindingsContentFromSyncContent(syncData.content);
				}
			}
		}
		return null;
	}

	getKeybindingsContentFromSyncContent(syncContent: string): string | null {
		try {
			const parsed = <ISyncContent>JSON.parse(syncContent);
			if (!this.configurationService.getValue<boolean>('sync.keybindingsPerPlatform')) {
				return isUndefined(parsed.all) ? null : parsed.all;
			}
			switch (OS) {
				case OperatingSystem.Macintosh:
					return isUndefined(parsed.mac) ? null : parsed.mac;
				case OperatingSystem.Linux:
					return isUndefined(parsed.linux) ? null : parsed.linux;
				case OperatingSystem.Windows:
					return isUndefined(parsed.windows) ? null : parsed.windows;
			}
		} catch (e) {
			this.logService.error(e);
			return null;
		}
	}

	private toSyncContent(keybindingsContent: string, syncContent: string | null): string {
		let parsed: ISyncContent = {};
		try {
			parsed = JSON.parse(syncContent || '{}');
		} catch (e) {
			this.logService.error(e);
		}
		if (!this.configurationService.getValue<boolean>('sync.keybindingsPerPlatform')) {
			parsed.all = keybindingsContent;
		} else {
			delete parsed.all;
		}
		switch (OS) {
			case OperatingSystem.Macintosh:
				parsed.mac = keybindingsContent;
				break;
			case OperatingSystem.Linux:
				parsed.linux = keybindingsContent;
				break;
			case OperatingSystem.Windows:
				parsed.windows = keybindingsContent;
				break;
		}
		return JSON.stringify(parsed);
	}

}
