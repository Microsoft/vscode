/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IUserDataSyncStoreService, IUserDataSyncLogService, IUserDataSynchroniser, SyncResource, IUserDataSyncResourceEnablementService, IUserDataSyncBackupStoreService,
	USER_DATA_SYNC_SCHEME, ISyncResourceHandle, IRemoteUserData, ISyncData, Change
} from 'vs/platform/userDataSync/common/userDataSync';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService, FileChangesEvent, IFileStat, IFileContent, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { AbstractSynchroniser, IFileResourcePreview } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStringDictionary } from 'vs/base/common/collections';
import { URI } from 'vs/base/common/uri';
import { joinPath, extname, relativePath, isEqualOrParent, basename, dirname } from 'vs/base/common/resources';
import { VSBuffer } from 'vs/base/common/buffer';
import { merge, IMergeResult, areSame } from 'vs/platform/userDataSync/common/snippetsMerge';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { deepClone } from 'vs/base/common/objects';

export class SnippetsSynchroniser extends AbstractSynchroniser implements IUserDataSynchroniser {

	protected readonly version: number = 1;
	private readonly snippetsFolder: URI;

	constructor(
		@IEnvironmentService environmentService: IEnvironmentService,
		@IFileService fileService: IFileService,
		@IStorageService storageService: IStorageService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncResourceEnablementService userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(SyncResource.Snippets, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncResourceEnablementService, telemetryService, logService, configurationService);
		this.snippetsFolder = environmentService.snippetsHome;
		this._register(this.fileService.watch(environmentService.userRoamingDataHome));
		this._register(this.fileService.watch(this.snippetsFolder));
		this._register(this.fileService.onDidFilesChange(e => this.onFileChanges(e)));
	}

	private onFileChanges(e: FileChangesEvent): void {
		if (!e.changes.some(change => isEqualOrParent(change.resource, this.snippetsFolder))) {
			return;
		}
		this.triggerLocalChange();
	}

	protected async generatePullPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken): Promise<IFileResourcePreview[]> {
		const resourcePreviews: IFileResourcePreview[] = [];
		if (remoteUserData.syncData !== null) {
			const local = await this.getSnippetsFileContents();
			const localSnippets = this.toSnippetsContents(local);
			const remoteSnippets = this.parseSnippets(remoteUserData.syncData);
			const mergeResult = merge(localSnippets, remoteSnippets, localSnippets);
			resourcePreviews.push(...this.getResourcePreviews(mergeResult, local, remoteSnippets));
		}
		return resourcePreviews;
	}

	protected async generatePushPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken): Promise<IFileResourcePreview[]> {
		const local = await this.getSnippetsFileContents();
		const localSnippets = this.toSnippetsContents(local);
		const mergeResult = merge(localSnippets, null, null);
		const resourcePreviews = this.getResourcePreviews(mergeResult, local, {});
		return resourcePreviews;
	}

	protected async generateReplacePreview(syncData: ISyncData, remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null): Promise<IFileResourcePreview[]> {
		const local = await this.getSnippetsFileContents();
		const localSnippets = this.toSnippetsContents(local);
		const snippets = this.parseSnippets(syncData);
		const mergeResult = merge(localSnippets, snippets, localSnippets);
		const resourcePreviews = this.getResourcePreviews(mergeResult, local, snippets);
		return resourcePreviews;
	}

	protected async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken): Promise<IFileResourcePreview[]> {
		const local = await this.getSnippetsFileContents();
		const localSnippets = this.toSnippetsContents(local);
		const remoteSnippets: IStringDictionary<string> | null = remoteUserData.syncData ? this.parseSnippets(remoteUserData.syncData) : null;
		const lastSyncSnippets: IStringDictionary<string> | null = lastSyncUserData && lastSyncUserData.syncData ? this.parseSnippets(lastSyncUserData.syncData) : null;

		if (remoteSnippets) {
			this.logService.trace(`${this.syncResourceLogLabel}: Merging remote snippets with local snippets...`);
		} else {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote snippets does not exist. Synchronizing snippets for the first time.`);
		}

		const mergeResult = merge(localSnippets, remoteSnippets, lastSyncSnippets);
		return this.getResourcePreviews(mergeResult, local, remoteSnippets || {});
	}

	protected async updateResourcePreview(resourcePreview: IFileResourcePreview, resource: URI, acceptedContent: string): Promise<IFileResourcePreview> {
		return {
			...resourcePreview,
			acceptedContent: acceptedContent || null,
			localChange: this.computeLocalChange(resourcePreview, resource, acceptedContent || null),
			remoteChange: this.computeRemoteChange(resourcePreview, resource, acceptedContent || null),
		};
	}

	private computeLocalChange(resourcePreview: IFileResourcePreview, resource: URI, acceptedContent: string | null): Change {
		const isRemoteResourceAccepted = isEqualOrParent(resource, this.syncPreviewFolder.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' }));
		const isPreviewResourceAccepted = isEqualOrParent(resource, this.syncPreviewFolder);

		const previewExists = acceptedContent !== null;
		const remoteExists = resourcePreview.remoteContent !== null;
		const localExists = resourcePreview.fileContent !== null;

		if (isRemoteResourceAccepted) {
			if (remoteExists && localExists) {
				return Change.Modified;
			}
			if (remoteExists && !localExists) {
				return Change.Added;
			}
			if (!remoteExists && localExists) {
				return Change.Deleted;
			}
			return Change.None;
		}

		if (isPreviewResourceAccepted) {
			if (previewExists && localExists) {
				return Change.Modified;
			}
			if (previewExists && !localExists) {
				return Change.Added;
			}
			if (!previewExists && localExists) {
				return Change.Deleted;
			}
			return Change.None;
		}

		return Change.None;
	}

	private computeRemoteChange(resourcePreview: IFileResourcePreview, resource: URI, acceptedContent: string | null): Change {
		const isLocalResourceAccepted = isEqualOrParent(resource, this.syncPreviewFolder.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' }));
		const isPreviewResourceAccepted = isEqualOrParent(resource, this.syncPreviewFolder);

		const previewExists = acceptedContent !== null;
		const remoteExists = resourcePreview.remoteContent !== null;
		const localExists = resourcePreview.fileContent !== null;

		if (isLocalResourceAccepted) {
			if (remoteExists && localExists) {
				return Change.Modified;
			}
			if (remoteExists && !localExists) {
				return Change.Deleted;
			}
			if (!remoteExists && localExists) {
				return Change.Added;
			}
			return Change.None;
		}

		if (isPreviewResourceAccepted) {
			if (previewExists && remoteExists) {
				return Change.Modified;
			}
			if (previewExists && !remoteExists) {
				return Change.Added;
			}
			if (!previewExists && remoteExists) {
				return Change.Deleted;
			}
			return Change.None;
		}

		return Change.None;
	}

	protected async applyPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resourcePreviews: IFileResourcePreview[], force: boolean): Promise<void> {
		if (resourcePreviews.every(({ localChange, remoteChange }) => localChange === Change.None && remoteChange === Change.None)) {
			this.logService.info(`${this.syncResourceLogLabel}: No changes found during synchronizing snippets.`);
		}

		if (resourcePreviews.some(({ localChange }) => localChange !== Change.None)) {
			// back up all snippets
			await this.updateLocalBackup(resourcePreviews);
			await this.updateLocalSnippets(resourcePreviews, force);
		}

		if (resourcePreviews.some(({ remoteChange }) => remoteChange !== Change.None)) {
			remoteUserData = await this.updateRemoteSnippets(resourcePreviews, remoteUserData, force);
		}

		if (lastSyncUserData?.ref !== remoteUserData.ref) {
			// update last sync
			this.logService.trace(`${this.syncResourceLogLabel}: Updating last synchronized snippets...`);
			await this.updateLastSyncUserData(remoteUserData);
			this.logService.info(`${this.syncResourceLogLabel}: Updated last synchronized snippets`);
		}

		for (const { previewResource } of resourcePreviews) {
			// Delete the preview
			try {
				await this.fileService.del(previewResource);
			} catch (e) { /* ignore */ }
		}

	}

	private getResourcePreviews(mergeResult: IMergeResult, localFileContent: IStringDictionary<IFileContent>, remoteSnippets: IStringDictionary<string>): IFileResourcePreview[] {
		const resourcePreviews: Map<string, IFileResourcePreview> = new Map<string, IFileResourcePreview>();

		/* Snippets added remotely -> add locally */
		for (const key of Object.keys(mergeResult.local.added)) {
			resourcePreviews.set(key, {
				localResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' }),
				fileContent: null,
				localContent: null,
				remoteResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' }),
				remoteContent: remoteSnippets[key],
				previewResource: joinPath(this.syncPreviewFolder, key),
				previewContent: mergeResult.local.added[key],
				acceptedResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' }),
				acceptedContent: mergeResult.local.added[key],
				hasConflicts: false,
				localChange: Change.Added,
				remoteChange: Change.None
			});
		}

		/* Snippets updated remotely -> update locally */
		for (const key of Object.keys(mergeResult.local.updated)) {
			resourcePreviews.set(key, {
				localResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' }),
				fileContent: localFileContent[key],
				localContent: localFileContent[key].value.toString(),
				remoteResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' }),
				remoteContent: remoteSnippets[key],
				previewResource: joinPath(this.syncPreviewFolder, key),
				previewContent: mergeResult.local.updated[key],
				acceptedResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' }),
				acceptedContent: mergeResult.local.updated[key],
				hasConflicts: false,
				localChange: Change.Modified,
				remoteChange: Change.None
			});
		}

		/* Snippets removed remotely -> remove locally */
		for (const key of mergeResult.local.removed) {
			resourcePreviews.set(key, {
				localResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' }),
				fileContent: localFileContent[key],
				localContent: localFileContent[key].value.toString(),
				remoteResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' }),
				remoteContent: null,
				previewResource: joinPath(this.syncPreviewFolder, key),
				previewContent: null,
				acceptedResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' }),
				acceptedContent: null,
				hasConflicts: false,
				localChange: Change.Deleted,
				remoteChange: Change.None
			});
		}

		/* Snippets added locally -> add remotely */
		for (const key of Object.keys(mergeResult.remote.added)) {
			resourcePreviews.set(key, {
				localResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' }),
				fileContent: localFileContent[key],
				localContent: localFileContent[key].value.toString(),
				remoteResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' }),
				remoteContent: null,
				previewResource: joinPath(this.syncPreviewFolder, key),
				previewContent: mergeResult.remote.added[key],
				acceptedResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' }),
				acceptedContent: mergeResult.remote.added[key],
				hasConflicts: false,
				localChange: Change.None,
				remoteChange: Change.Added
			});
		}

		/* Snippets updated locally -> update remotely */
		for (const key of Object.keys(mergeResult.remote.updated)) {
			resourcePreviews.set(key, {
				localResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' }),
				fileContent: localFileContent[key],
				localContent: localFileContent[key].value.toString(),
				remoteResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' }),
				remoteContent: remoteSnippets[key],
				previewResource: joinPath(this.syncPreviewFolder, key),
				previewContent: mergeResult.remote.updated[key],
				acceptedResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' }),
				acceptedContent: mergeResult.remote.updated[key],
				hasConflicts: false,
				localChange: Change.None,
				remoteChange: Change.Modified
			});
		}

		/* Snippets removed locally -> remove remotely */
		for (const key of mergeResult.remote.removed) {
			resourcePreviews.set(key, {
				localResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' }),
				fileContent: null,
				localContent: null,
				remoteResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' }),
				remoteContent: remoteSnippets[key],
				previewResource: joinPath(this.syncPreviewFolder, key),
				previewContent: null,
				acceptedResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' }),
				acceptedContent: null,
				hasConflicts: false,
				localChange: Change.None,
				remoteChange: Change.Deleted
			});
		}

		/* Snippets with conflicts */
		for (const key of mergeResult.conflicts) {
			resourcePreviews.set(key, {
				localResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' }),
				fileContent: localFileContent[key] || null,
				localContent: localFileContent[key] ? localFileContent[key].value.toString() : null,
				remoteResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' }),
				remoteContent: remoteSnippets[key] || null,
				previewResource: joinPath(this.syncPreviewFolder, key),
				previewContent: localFileContent[key] ? localFileContent[key].value.toString() : null,
				acceptedResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' }),
				acceptedContent: localFileContent[key] ? localFileContent[key].value.toString() : null,
				hasConflicts: true,
				localChange: localFileContent[key] ? Change.Modified : Change.Added,
				remoteChange: remoteSnippets[key] ? Change.Modified : Change.Added
			});
		}

		/* Unmodified Snippets */
		for (const key of Object.keys(localFileContent)) {
			if (!resourcePreviews.has(key)) {
				resourcePreviews.set(key, {
					localResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' }),
					fileContent: localFileContent[key] || null,
					localContent: localFileContent[key] ? localFileContent[key].value.toString() : null,
					remoteResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' }),
					remoteContent: remoteSnippets[key] || null,
					previewResource: joinPath(this.syncPreviewFolder, key),
					previewContent: localFileContent[key] ? localFileContent[key].value.toString() : null,
					acceptedResource: joinPath(this.syncPreviewFolder, key).with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' }),
					acceptedContent: localFileContent[key] ? localFileContent[key].value.toString() : null,
					hasConflicts: false,
					localChange: Change.None,
					remoteChange: Change.None
				});
			}
		}

		return [...resourcePreviews.values()];
	}

	async getAssociatedResources({ uri }: ISyncResourceHandle): Promise<{ resource: URI, comparableResource?: URI }[]> {
		let content = await super.resolveContent(uri);
		if (content) {
			const syncData = this.parseSyncData(content);
			if (syncData) {
				const snippets = this.parseSnippets(syncData);
				const result = [];
				for (const snippet of Object.keys(snippets)) {
					const resource = joinPath(uri, snippet);
					const comparableResource = joinPath(this.snippetsFolder, snippet);
					const exists = await this.fileService.exists(comparableResource);
					result.push({ resource, comparableResource: exists ? comparableResource : undefined });
				}
				return result;
			}
		}
		return [];
	}

	async resolveContent(uri: URI): Promise<string | null> {
		if (isEqualOrParent(uri, this.syncPreviewFolder.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote' }))
			|| isEqualOrParent(uri, this.syncPreviewFolder.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local' }))
			|| isEqualOrParent(uri, this.syncPreviewFolder.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' }))) {
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
				const snippets = this.parseSnippets(syncData);
				return snippets[basename(uri)] || null;
			}
		}

		return null;
	}

	async hasLocalData(): Promise<boolean> {
		try {
			const localSnippets = await this.getSnippetsFileContents();
			if (Object.keys(localSnippets).length) {
				return true;
			}
		} catch (error) {
			/* ignore error */
		}
		return false;
	}

	private async updateLocalBackup(resourcePreviews: IFileResourcePreview[]): Promise<void> {
		const local: IStringDictionary<IFileContent> = {};
		for (const resourcePreview of resourcePreviews) {
			if (resourcePreview.fileContent) {
				local[basename(resourcePreview.localResource!)] = resourcePreview.fileContent;
			}
		}
		await this.backupLocal(JSON.stringify(this.toSnippetsContents(local)));
	}

	private async updateLocalSnippets(resourcePreviews: IFileResourcePreview[], force: boolean): Promise<void> {
		for (const { fileContent, acceptedContent: content, localResource, remoteResource, localChange } of resourcePreviews) {
			if (localChange !== Change.None) {
				const key = remoteResource ? basename(remoteResource) : basename(localResource!);
				const resource = joinPath(this.snippetsFolder, key);

				// Removed
				if (localChange === Change.Deleted) {
					this.logService.trace(`${this.syncResourceLogLabel}: Deleting snippet...`, basename(resource));
					await this.fileService.del(resource);
					this.logService.info(`${this.syncResourceLogLabel}: Deleted snippet`, basename(resource));
				}

				// Added
				else if (localChange === Change.Added) {
					this.logService.trace(`${this.syncResourceLogLabel}: Creating snippet...`, basename(resource));
					await this.fileService.createFile(resource, VSBuffer.fromString(content!), { overwrite: force });
					this.logService.info(`${this.syncResourceLogLabel}: Created snippet`, basename(resource));
				}

				// Updated
				else {
					this.logService.trace(`${this.syncResourceLogLabel}: Updating snippet...`, basename(resource));
					await this.fileService.writeFile(resource, VSBuffer.fromString(content!), force ? undefined : fileContent!);
					this.logService.info(`${this.syncResourceLogLabel}: Updated snippet`, basename(resource));
				}
			}
		}
	}

	private async updateRemoteSnippets(resourcePreviews: IFileResourcePreview[], remoteUserData: IRemoteUserData, forcePush: boolean): Promise<IRemoteUserData> {
		const currentSnippets: IStringDictionary<string> = remoteUserData.syncData ? this.parseSnippets(remoteUserData.syncData) : {};
		const newSnippets: IStringDictionary<string> = deepClone(currentSnippets);

		for (const { acceptedContent: content, localResource, remoteResource, remoteChange } of resourcePreviews) {
			if (remoteChange !== Change.None) {
				const key = localResource ? basename(localResource) : basename(remoteResource!);
				if (remoteChange === Change.Deleted) {
					delete newSnippets[key];
				} else {
					newSnippets[key] = content!;
				}
			}
		}

		if (!areSame(currentSnippets, newSnippets)) {
			// update remote
			this.logService.trace(`${this.syncResourceLogLabel}: Updating remote snippets...`);
			remoteUserData = await this.updateRemoteUserData(JSON.stringify(newSnippets), forcePush ? null : remoteUserData.ref);
			this.logService.info(`${this.syncResourceLogLabel}: Updated remote snippets`);
		}
		return remoteUserData;
	}

	private parseSnippets(syncData: ISyncData): IStringDictionary<string> {
		return JSON.parse(syncData.content);
	}

	private toSnippetsContents(snippetsFileContents: IStringDictionary<IFileContent>): IStringDictionary<string> {
		const snippets: IStringDictionary<string> = {};
		for (const key of Object.keys(snippetsFileContents)) {
			snippets[key] = snippetsFileContents[key].value.toString();
		}
		return snippets;
	}

	private async getSnippetsFileContents(): Promise<IStringDictionary<IFileContent>> {
		const snippets: IStringDictionary<IFileContent> = {};
		let stat: IFileStat;
		try {
			stat = await this.fileService.resolve(this.snippetsFolder);
		} catch (e) {
			// No snippets
			if (e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) {
				return snippets;
			} else {
				throw e;
			}
		}
		for (const entry of stat.children || []) {
			const resource = entry.resource;
			const extension = extname(resource);
			if (extension === '.json' || extension === '.code-snippets') {
				const key = relativePath(this.snippetsFolder, resource)!;
				const content = await this.fileService.readFile(resource);
				snippets[key] = content;
			}
		}
		return snippets;
	}
}
