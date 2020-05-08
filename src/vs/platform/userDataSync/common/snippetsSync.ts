/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SyncStatus, IUserDataSyncStoreService, IUserDataSyncLogService, IUserDataSynchroniser, SyncResource, IUserDataSyncEnablementService, IUserDataSyncBackupStoreService, Conflict, USER_DATA_SYNC_SCHEME, PREVIEW_DIR_NAME, UserDataSyncError, UserDataSyncErrorCode, ISyncResourceHandle, ISyncPreviewResult } from 'vs/platform/userDataSync/common/userDataSync';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService, FileChangesEvent, IFileStat, IFileContent, FileOperationError, FileOperationResult } from 'vs/platform/files/common/files';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { AbstractSynchroniser, IRemoteUserData, ISyncData } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IStringDictionary } from 'vs/base/common/collections';
import { URI } from 'vs/base/common/uri';
import { joinPath, extname, relativePath, isEqualOrParent, isEqual, basename, dirname } from 'vs/base/common/resources';
import { VSBuffer } from 'vs/base/common/buffer';
import { merge } from 'vs/platform/userDataSync/common/snippetsMerge';
import { CancelablePromise, createCancelablePromise } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';

interface ISinppetsSyncPreviewResult extends ISyncPreviewResult {
	readonly local: IStringDictionary<IFileContent>;
	readonly remoteUserData: IRemoteUserData;
	readonly lastSyncUserData: IRemoteUserData | null;
	readonly added: IStringDictionary<string>;
	readonly updated: IStringDictionary<string>;
	readonly removed: string[];
	readonly conflicts: Conflict[];
	readonly resolvedConflicts: IStringDictionary<string | null>;
	readonly remote: IStringDictionary<string> | null;
}

export class SnippetsSynchroniser extends AbstractSynchroniser implements IUserDataSynchroniser {

	protected readonly version: number = 1;
	private readonly snippetsFolder: URI;
	private readonly snippetsPreviewFolder: URI;
	private syncPreviewResultPromise: CancelablePromise<ISinppetsSyncPreviewResult> | null = null;

	constructor(
		@IEnvironmentService environmentService: IEnvironmentService,
		@IFileService fileService: IFileService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IConfigurationService configurationService: IConfigurationService,
		@IUserDataSyncEnablementService userDataSyncEnablementService: IUserDataSyncEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(SyncResource.Snippets, fileService, environmentService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncEnablementService, telemetryService, logService, configurationService);
		this.snippetsFolder = environmentService.snippetsHome;
		this.snippetsPreviewFolder = joinPath(this.syncFolder, PREVIEW_DIR_NAME);
		this._register(this.fileService.watch(environmentService.userRoamingDataHome));
		this._register(this.fileService.watch(this.snippetsFolder));
		this._register(this.fileService.onDidFilesChange(e => this.onFileChanges(e)));
	}

	private onFileChanges(e: FileChangesEvent): void {
		if (!e.changes.some(change => isEqualOrParent(change.resource, this.snippetsFolder))) {
			return;
		}
		if (!this.isEnabled()) {
			return;
		}
		// Sync again if local file has changed and current status is in conflicts
		if (this.status === SyncStatus.HasConflicts) {
			this.syncPreviewResultPromise!.then(result => {
				this.cancel();
				this.doSync(result.remoteUserData, result.lastSyncUserData).then(status => this.setStatus(status));
			});
		}
		// Otherwise fire change event
		else {
			this._onDidChangeLocal.fire();
		}
	}

	async pull(): Promise<void> {
		if (!this.isEnabled()) {
			this.logService.info(`${this.syncResourceLogLabel}: Skipped pulling snippets as it is disabled.`);
			return;
		}

		this.stop();

		try {
			this.logService.info(`${this.syncResourceLogLabel}: Started pulling snippets...`);
			this.setStatus(SyncStatus.Syncing);

			const lastSyncUserData = await this.getLastSyncUserData();
			const remoteUserData = await this.getRemoteUserData(lastSyncUserData);

			if (remoteUserData.syncData !== null) {
				const local = await this.getSnippetsFileContents();
				const localSnippets = this.toSnippetsContents(local);
				const remoteSnippets = this.parseSnippets(remoteUserData.syncData);
				const { added, updated, remote, removed } = merge(localSnippets, remoteSnippets, localSnippets);
				this.syncPreviewResultPromise = createCancelablePromise(() => Promise.resolve<ISinppetsSyncPreviewResult>({
					added, removed, updated, remote, remoteUserData, local, lastSyncUserData, conflicts: [], resolvedConflicts: {},
					hasLocalChanged: Object.keys(added).length > 0 || removed.length > 0 || Object.keys(updated).length > 0,
					hasRemoteChanged: remote !== null
				}));
				await this.apply();
			}

			// No remote exists to pull
			else {
				this.logService.info(`${this.syncResourceLogLabel}: Remote snippets does not exist.`);
			}

			this.logService.info(`${this.syncResourceLogLabel}: Finished pulling snippets.`);
		} finally {
			this.setStatus(SyncStatus.Idle);
		}
	}

	async push(): Promise<void> {
		if (!this.isEnabled()) {
			this.logService.info(`${this.syncResourceLogLabel}: Skipped pushing snippets as it is disabled.`);
			return;
		}

		this.stop();

		try {
			this.logService.info(`${this.syncResourceLogLabel}: Started pushing snippets...`);
			this.setStatus(SyncStatus.Syncing);

			const local = await this.getSnippetsFileContents();
			const localSnippets = this.toSnippetsContents(local);
			const { added, removed, updated, remote } = merge(localSnippets, null, null);
			const lastSyncUserData = await this.getLastSyncUserData();
			const remoteUserData = await this.getRemoteUserData(lastSyncUserData);
			this.syncPreviewResultPromise = createCancelablePromise(() => Promise.resolve<ISinppetsSyncPreviewResult>({
				added, removed, updated, remote, remoteUserData, local, lastSyncUserData, conflicts: [], resolvedConflicts: {},
				hasLocalChanged: Object.keys(added).length > 0 || removed.length > 0 || Object.keys(updated).length > 0,
				hasRemoteChanged: remote !== null
			}));

			await this.apply(true);

			this.logService.info(`${this.syncResourceLogLabel}: Finished pushing snippets.`);
		} finally {
			this.setStatus(SyncStatus.Idle);
		}

	}

	async stop(): Promise<void> {
		await this.clearConflicts();
		this.cancel();
		this.logService.info(`${this.syncResourceLogLabel}: Stopped synchronizing ${this.syncResourceLogLabel}.`);
		this.setStatus(SyncStatus.Idle);
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
		if (isEqualOrParent(uri.with({ scheme: this.syncFolder.scheme }), this.snippetsPreviewFolder)) {
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
				const snippets = this.parseSnippets(syncData);
				return snippets[basename(uri)] || null;
			}
		}
		return null;
	}

	protected async getConflictContent(conflictResource: URI): Promise<string | null> {
		if (this.syncPreviewResultPromise) {
			const result = await this.syncPreviewResultPromise;
			const key = relativePath(this.snippetsPreviewFolder, conflictResource.with({ scheme: this.snippetsPreviewFolder.scheme }))!;
			if (conflictResource.scheme === this.snippetsPreviewFolder.scheme) {
				return result.local[key] ? result.local[key].value.toString() : null;
			} else if (result.remoteUserData && result.remoteUserData.syncData) {
				const snippets = this.parseSnippets(result.remoteUserData.syncData);
				return snippets[key] || null;
			}
		}
		return null;
	}

	async acceptConflict(conflictResource: URI, content: string): Promise<void> {
		const conflict = this.conflicts.filter(({ local, remote }) => isEqual(local, conflictResource) || isEqual(remote, conflictResource))[0];
		if (this.status === SyncStatus.HasConflicts && conflict) {
			const key = relativePath(this.snippetsPreviewFolder, conflict.local)!;
			let previewResult = await this.syncPreviewResultPromise!;
			this.cancel();
			previewResult.resolvedConflicts[key] = content || null;
			this.syncPreviewResultPromise = createCancelablePromise(token => this.doGeneratePreview(previewResult.local, previewResult.remoteUserData, previewResult.lastSyncUserData, previewResult.resolvedConflicts, token));
			previewResult = await this.syncPreviewResultPromise;
			this.setConflicts(previewResult.conflicts);
			if (!this.conflicts.length) {
				await this.apply();
				this.setStatus(SyncStatus.Idle);
			}
		}
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

	protected async performSync(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null): Promise<SyncStatus> {
		try {
			const previewResult = await this.getPreview(remoteUserData, lastSyncUserData);
			this.setConflicts(previewResult.conflicts);
			if (this.conflicts.length) {
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
						this.logService.info(`${this.syncResourceLogLabel}: Failed to synchronize snippets as there is a new local version available. Synchronizing again...`);
						return this.performSync(remoteUserData, lastSyncUserData);
				}
			}
			throw e;
		}
	}

	protected getPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null): Promise<ISinppetsSyncPreviewResult> {
		if (!this.syncPreviewResultPromise) {
			this.syncPreviewResultPromise = createCancelablePromise(token => this.generatePreview(remoteUserData, lastSyncUserData, token));
		}
		return this.syncPreviewResultPromise;
	}

	protected cancel(): void {
		if (this.syncPreviewResultPromise) {
			this.syncPreviewResultPromise.cancel();
			this.syncPreviewResultPromise = null;
		}
	}

	private async clearConflicts(): Promise<void> {
		if (this.conflicts.length) {
			await Promise.all(this.conflicts.map(({ local }) => this.fileService.del(local)));
			this.setConflicts([]);
		}
	}

	protected async generatePreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken = CancellationToken.None): Promise<ISinppetsSyncPreviewResult> {
		return this.getSnippetsFileContents()
			.then(local => this.doGeneratePreview(local, remoteUserData, lastSyncUserData, {}, token));
	}

	private async doGeneratePreview(local: IStringDictionary<IFileContent>, remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, resolvedConflicts: IStringDictionary<string | null> = {}, token: CancellationToken = CancellationToken.None): Promise<ISinppetsSyncPreviewResult> {
		const localSnippets = this.toSnippetsContents(local);
		const remoteSnippets: IStringDictionary<string> | null = remoteUserData.syncData ? this.parseSnippets(remoteUserData.syncData) : null;
		const lastSyncSnippets: IStringDictionary<string> | null = lastSyncUserData ? this.parseSnippets(lastSyncUserData.syncData!) : null;

		if (remoteSnippets) {
			this.logService.trace(`${this.syncResourceLogLabel}: Merging remote snippets with local snippets...`);
		} else {
			this.logService.trace(`${this.syncResourceLogLabel}: Remote snippets does not exist. Synchronizing snippets for the first time.`);
		}

		const mergeResult = merge(localSnippets, remoteSnippets, lastSyncSnippets, resolvedConflicts);

		const conflicts: Conflict[] = [];
		for (const key of mergeResult.conflicts) {
			const localPreview = joinPath(this.snippetsPreviewFolder, key);
			conflicts.push({ local: localPreview, remote: localPreview.with({ scheme: USER_DATA_SYNC_SCHEME }) });
			const content = local[key];
			if (!token.isCancellationRequested) {
				await this.fileService.writeFile(localPreview, content ? content.value : VSBuffer.fromString(''));
			}
		}

		for (const conflict of this.conflicts) {
			// clear obsolete conflicts
			if (!conflicts.some(({ local }) => isEqual(local, conflict.local))) {
				try {
					await this.fileService.del(conflict.local);
				} catch (error) {
					// Ignore & log
					this.logService.error(error);
				}
			}
		}

		return {
			remoteUserData, local,
			lastSyncUserData,
			added: mergeResult.added,
			removed: mergeResult.removed,
			updated: mergeResult.updated,
			conflicts,
			remote: mergeResult.remote,
			resolvedConflicts,
			hasLocalChanged: Object.keys(mergeResult.added).length > 0 || mergeResult.removed.length > 0 || Object.keys(mergeResult.updated).length > 0,
			hasRemoteChanged: mergeResult.remote !== null
		};
	}

	private async apply(forcePush?: boolean): Promise<void> {
		if (!this.syncPreviewResultPromise) {
			return;
		}

		let { added, removed, updated, local, remote, remoteUserData, lastSyncUserData, hasLocalChanged, hasRemoteChanged } = await this.syncPreviewResultPromise;

		if (!hasLocalChanged && !hasRemoteChanged) {
			this.logService.info(`${this.syncResourceLogLabel}: No changes found during synchronizing snippets.`);
		}

		if (hasLocalChanged) {
			// back up all snippets
			await this.backupLocal(JSON.stringify(this.toSnippetsContents(local)));
			await this.updateLocalSnippets(added, removed, updated, local);
		}

		if (remote) {
			// update remote
			this.logService.trace(`${this.syncResourceLogLabel}: Updating remote snippets...`);
			const content = JSON.stringify(remote);
			remoteUserData = await this.updateRemoteUserData(content, forcePush ? null : remoteUserData.ref);
			this.logService.info(`${this.syncResourceLogLabel}: Updated remote snippets`);
		}

		if (lastSyncUserData?.ref !== remoteUserData.ref) {
			// update last sync
			this.logService.trace(`${this.syncResourceLogLabel}: Updating last synchronized snippets...`);
			await this.updateLastSyncUserData(remoteUserData);
			this.logService.info(`${this.syncResourceLogLabel}: Updated last synchronized snippets`);
		}

		this.syncPreviewResultPromise = null;
	}

	private async updateLocalSnippets(added: IStringDictionary<string>, removed: string[], updated: IStringDictionary<string>, local: IStringDictionary<IFileContent>): Promise<void> {
		for (const key of removed) {
			const resource = joinPath(this.snippetsFolder, key);
			this.logService.trace(`${this.syncResourceLogLabel}: Deleting snippet...`, basename(resource));
			await this.fileService.del(resource);
			this.logService.info(`${this.syncResourceLogLabel}: Deleted snippet`, basename(resource));
		}

		for (const key of Object.keys(added)) {
			const resource = joinPath(this.snippetsFolder, key);
			this.logService.trace(`${this.syncResourceLogLabel}: Creating snippet...`, basename(resource));
			await this.fileService.createFile(resource, VSBuffer.fromString(added[key]), { overwrite: false });
			this.logService.info(`${this.syncResourceLogLabel}: Created snippet`, basename(resource));
		}

		for (const key of Object.keys(updated)) {
			const resource = joinPath(this.snippetsFolder, key);
			this.logService.trace(`${this.syncResourceLogLabel}: Updating snippet...`, basename(resource));
			await this.fileService.writeFile(resource, VSBuffer.fromString(updated[key]), local[key]);
			this.logService.info(`${this.syncResourceLogLabel}: Updated snippet`, basename(resource));
		}
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
