/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IFileService, IFileContent, FileChangesEvent, FileOperationResult, FileOperationError, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { VSBuffer } from 'vs/base/common/buffer';
import { URI } from 'vs/base/common/uri';
import {
	SyncResource, SyncStatus, IUserData, IUserDataSyncStoreService, UserDataSyncErrorCode, UserDataSyncError, IUserDataSyncLogService, IUserDataSyncUtilService,
	IUserDataSyncResourceEnablementService, IUserDataSyncBackupStoreService, ISyncResourceHandle, USER_DATA_SYNC_SCHEME, ISyncResourcePreview as IBaseSyncResourcePreview,
	IUserDataManifest, ISyncData, IRemoteUserData, PREVIEW_DIR_NAME, IResourcePreview as IBaseResourcePreview, Change, MergeState, IUserDataInitializer
} from 'vs/platform/userDataSync/common/userDataSync';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IExtUri, extUri, extUriIgnorePathCase } from 'vs/base/common/resources';
import { CancelablePromise, RunOnceScheduler, createCancelablePromise } from 'vs/base/common/async';
import { Emitter, Event } from 'vs/base/common/event';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ParseError, parse } from 'vs/base/common/json';
import { FormattingOptions } from 'vs/base/common/jsonFormatter';
import { IStringDictionary } from 'vs/base/common/collections';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { isString } from 'vs/base/common/types';
import { uppercaseFirstLetter } from 'vs/base/common/strings';
import { equals } from 'vs/base/common/arrays';
import { getServiceMachineId } from 'vs/platform/serviceMachineId/common/serviceMachineId';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IHeaders } from 'vs/base/parts/request/common/request';

type SyncSourceClassification = {
	source?: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

export function isSyncData(thing: any): thing is ISyncData {
	if (thing
		&& (thing.version !== undefined && typeof thing.version === 'number')
		&& (thing.content !== undefined && typeof thing.content === 'string')) {

		// backward compatibility
		if (Object.keys(thing).length === 2) {
			return true;
		}

		if (Object.keys(thing).length === 3
			&& (thing.machineId !== undefined && typeof thing.machineId === 'string')) {
			return true;
		}
	}

	return false;
}

function getLastSyncResourceUri(syncResource: SyncResource, environmentService: IEnvironmentService, extUri: IExtUri): URI {
	return extUri.joinPath(environmentService.userDataSyncHome, syncResource, `lastSync${syncResource}.json`);
}

export interface IResourcePreview {

	readonly remoteResource: URI;
	readonly remoteContent: string | null;
	readonly remoteChange: Change;

	readonly localResource: URI;
	readonly localContent: string | null;
	readonly localChange: Change;

	readonly previewResource: URI;
	readonly acceptedResource: URI;
}

export interface IAcceptResult {
	readonly content: string | null;
	readonly localChange: Change;
	readonly remoteChange: Change;
}

export interface IMergeResult extends IAcceptResult {
	readonly hasConflicts: boolean;
}

interface IEditableResourcePreview extends IBaseResourcePreview, IResourcePreview {
	localChange: Change;
	remoteChange: Change;
	mergeState: MergeState;
	acceptResult?: IAcceptResult;
}

interface ISyncResourcePreview extends IBaseSyncResourcePreview {
	readonly remoteUserData: IRemoteUserData;
	readonly lastSyncUserData: IRemoteUserData | null;
	readonly resourcePreviews: IEditableResourcePreview[];
}

export abstract class AbstractSynchroniser extends Disposable {

	private syncPreviewPromise: CancelablePromise<ISyncResourcePreview> | null = null;

	protected readonly syncFolder: URI;
	protected readonly syncPreviewFolder: URI;
	protected readonly extUri: IExtUri;
	private readonly currentMachineIdPromise: Promise<string>;

	private _status: SyncStatus = SyncStatus.Idle;
	get status(): SyncStatus { return this._status; }
	private _onDidChangStatus: Emitter<SyncStatus> = this._register(new Emitter<SyncStatus>());
	readonly onDidChangeStatus: Event<SyncStatus> = this._onDidChangStatus.event;

	private _conflicts: IBaseResourcePreview[] = [];
	get conflicts(): IBaseResourcePreview[] { return this._conflicts; }
	private _onDidChangeConflicts: Emitter<IBaseResourcePreview[]> = this._register(new Emitter<IBaseResourcePreview[]>());
	readonly onDidChangeConflicts: Event<IBaseResourcePreview[]> = this._onDidChangeConflicts.event;

	private readonly localChangeTriggerScheduler = new RunOnceScheduler(() => this.doTriggerLocalChange(), 50);
	private readonly _onDidChangeLocal: Emitter<void> = this._register(new Emitter<void>());
	readonly onDidChangeLocal: Event<void> = this._onDidChangeLocal.event;

	protected readonly lastSyncResource: URI;
	private hasSyncResourceStateVersionChanged: boolean = false;
	protected readonly syncResourceLogLabel: string;

	private syncHeaders: IHeaders = {};

	constructor(
		readonly resource: SyncResource,
		@IFileService protected readonly fileService: IFileService,
		@IEnvironmentService protected readonly environmentService: IEnvironmentService,
		@IStorageService storageService: IStorageService,
		@IUserDataSyncStoreService protected readonly userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService protected readonly userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncResourceEnablementService protected readonly userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@ITelemetryService protected readonly telemetryService: ITelemetryService,
		@IUserDataSyncLogService protected readonly logService: IUserDataSyncLogService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
	) {
		super();
		this.syncResourceLogLabel = uppercaseFirstLetter(this.resource);
		this.extUri = this.fileService.hasCapability(environmentService.userDataSyncHome, FileSystemProviderCapabilities.PathCaseSensitive) ? extUri : extUriIgnorePathCase;
		this.syncFolder = this.extUri.joinPath(environmentService.userDataSyncHome, resource);
		this.syncPreviewFolder = this.extUri.joinPath(this.syncFolder, PREVIEW_DIR_NAME);
		this.lastSyncResource = getLastSyncResourceUri(resource, environmentService, this.extUri);
		this.currentMachineIdPromise = getServiceMachineId(environmentService, fileService, storageService);
	}

	protected isEnabled(): boolean { return this.userDataSyncResourceEnablementService.isResourceEnabled(this.resource); }

	protected async triggerLocalChange(): Promise<void> {
		if (this.isEnabled()) {
			this.localChangeTriggerScheduler.schedule();
		}
	}

	protected async doTriggerLocalChange(): Promise<void> {

		// Sync again if current status is in conflicts
		if (this.status === SyncStatus.HasConflicts) {
			this.logService.info(`${this.syncResourceLogLabel}: In conflicts state and local change detected. Syncing again...`);
			const preview = await this.syncPreviewPromise!;
			this.syncPreviewPromise = null;
			const status = await this.performSync(preview.remoteUserData, preview.lastSyncUserData, true);
			this.setStatus(status);
		}

		// Check if local change causes remote change
		else {
			this.logService.trace(`${this.syncResourceLogLabel}: Checking for local changes...`);
			const lastSyncUserData = await this.getLastSyncUserData();
			const hasRemoteChanged = lastSyncUserData ? (await this.doGenerateSyncResourcePreview(lastSyncUserData, lastSyncUserData, true, CancellationToken.None)).resourcePreviews.some(({ remoteChange }) => remoteChange !== Change.None) : true;
			if (hasRemoteChanged) {
				this._onDidChangeLocal.fire();
			}
		}
	}

	protected setStatus(status: SyncStatus): void {
		if (this._status !== status) {
			const oldStatus = this._status;
			if (status === SyncStatus.HasConflicts) {
				// Log to telemetry when there is a sync conflict
				this.telemetryService.publicLog2<{ source: string }, SyncSourceClassification>('sync/conflictsDetected', { source: this.resource });
			}
			if (oldStatus === SyncStatus.HasConflicts && status === SyncStatus.Idle) {
				// Log to telemetry when conflicts are resolved
				this.telemetryService.publicLog2<{ source: string }, SyncSourceClassification>('sync/conflictsResolved', { source: this.resource });
			}
			this._status = status;
			this._onDidChangStatus.fire(status);
		}
	}

	async sync(manifest: IUserDataManifest | null, headers: IHeaders = {}): Promise<void> {
		await this._sync(manifest, true, headers);
	}

	async preview(manifest: IUserDataManifest | null, headers: IHeaders = {}): Promise<ISyncResourcePreview | null> {
		return this._sync(manifest, false, headers);
	}

	async apply(force: boolean, headers: IHeaders = {}): Promise<ISyncResourcePreview | null> {
		try {
			this.syncHeaders = { ...headers };

			const status = await this.doApply(force);
			this.setStatus(status);

			return this.syncPreviewPromise;
		} finally {
			this.syncHeaders = {};
		}
	}

	private async _sync(manifest: IUserDataManifest | null, apply: boolean, headers: IHeaders): Promise<ISyncResourcePreview | null> {
		try {
			this.syncHeaders = { ...headers };

			if (!this.isEnabled()) {
				if (this.status !== SyncStatus.Idle) {
					await this.stop();
				}
				this.logService.info(`${this.syncResourceLogLabel}: Skipped synchronizing ${this.resource.toLowerCase()} as it is disabled.`);
				return null;
			}

			if (this.status === SyncStatus.HasConflicts) {
				this.logService.info(`${this.syncResourceLogLabel}: Skipped synchronizing ${this.resource.toLowerCase()} as there are conflicts.`);
				return this.syncPreviewPromise;
			}

			if (this.status === SyncStatus.Syncing) {
				this.logService.info(`${this.syncResourceLogLabel}: Skipped synchronizing ${this.resource.toLowerCase()} as it is running already.`);
				return this.syncPreviewPromise;
			}

			this.logService.trace(`${this.syncResourceLogLabel}: Started synchronizing ${this.resource.toLowerCase()}...`);
			this.setStatus(SyncStatus.Syncing);

			let status: SyncStatus = SyncStatus.Idle;
			try {
				const lastSyncUserData = await this.getLastSyncUserData();
				const remoteUserData = await this.getLatestRemoteUserData(manifest, lastSyncUserData);
				status = await this.performSync(remoteUserData, lastSyncUserData, apply);
				if (status === SyncStatus.HasConflicts) {
					this.logService.info(`${this.syncResourceLogLabel}: Detected conflicts while synchronizing ${this.resource.toLowerCase()}.`);
				} else if (status === SyncStatus.Idle) {
					this.logService.trace(`${this.syncResourceLogLabel}: Finished synchronizing ${this.resource.toLowerCase()}.`);
				}
				return this.syncPreviewPromise || null;
			} finally {
				this.setStatus(status);
			}
		} finally {
			this.syncHeaders = {};
		}
	}

	async replace(uri: URI): Promise<boolean> {
		const content = await this.resolveContent(uri);
		if (!content) {
			return false;
		}

		const syncData = this.parseSyncData(content);
		if (!syncData) {
			return false;
		}

		await this.stop();

		try {
			this.logService.trace(`${this.syncResourceLogLabel}: Started resetting ${this.resource.toLowerCase()}...`);
			this.setStatus(SyncStatus.Syncing);
			const lastSyncUserData = await this.getLastSyncUserData();
			const remoteUserData = await this.getLatestRemoteUserData(null, lastSyncUserData);

			/* use replace sync data */
			const resourcePreviewResults = await this.generateSyncPreview({ ref: remoteUserData.ref, syncData }, lastSyncUserData, CancellationToken.None);

			const resourcePreviews: [IResourcePreview, IAcceptResult][] = [];
			for (const resourcePreviewResult of resourcePreviewResults) {
				/* Accept remote resource */
				const acceptResult: IAcceptResult = await this.getAcceptResult(resourcePreviewResult, resourcePreviewResult.remoteResource, undefined, CancellationToken.None);
				/* compute remote change */
				const { remoteChange } = await this.getAcceptResult(resourcePreviewResult, resourcePreviewResult.previewResource, resourcePreviewResult.remoteContent, CancellationToken.None);
				resourcePreviews.push([resourcePreviewResult, { ...acceptResult, remoteChange: remoteChange !== Change.None ? remoteChange : Change.Modified }]);
			}

			await this.applyResult(remoteUserData, lastSyncUserData, resourcePreviews, false);
			this.logService.info(`${this.syncResourceLogLabel}: Finished resetting ${this.resource.toLowerCase()}.`);
		} finally {
			this.setStatus(SyncStatus.Idle);
		}

		return true;
	}

	protected async getLatestRemoteUserData(manifest: IUserDataManifest | null, lastSyncUserData: IRemoteUserData | null): Promise<IRemoteUserData> {
		if (lastSyncUserData) {

			const latestRef = manifest && manifest.latest ? manifest.latest[this.resource] : undefined;

			// Last time synced resource and latest resource on server are same
			if (lastSyncUserData.ref === latestRef) {
				return lastSyncUserData;
			}

			// There is no resource on server and last time it was synced with no resource
			if (latestRef === undefined && lastSyncUserData.syncData === null) {
				return lastSyncUserData;
			}
		}
		return this.getRemoteUserData(lastSyncUserData);
	}

	private async performSync(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, apply: boolean): Promise<SyncStatus> {
		if (remoteUserData.syncData && remoteUserData.syncData.version > this.version) {
			// current version is not compatible with cloud version
			this.telemetryService.publicLog2<{ source: string }, SyncSourceClassification>('sync/incompatible', { source: this.resource });
			throw new UserDataSyncError(localize({ key: 'incompatible', comment: ['This is an error while syncing a resource that its local version is not compatible with its remote version.'] }, "Cannot sync {0} as its local version {1} is not compatible with its remote version {2}", this.resource, this.version, remoteUserData.syncData.version), UserDataSyncErrorCode.IncompatibleLocalContent, this.resource);
		}

		try {
			return await this.doSync(remoteUserData, lastSyncUserData, apply);
		} catch (e) {
			if (e instanceof UserDataSyncError) {
				switch (e.code) {

					case UserDataSyncErrorCode.LocalPreconditionFailed:
						// Rejected as there is a new local version. Syncing again...
						this.logService.info(`${this.syncResourceLogLabel}: Failed to synchronize ${this.syncResourceLogLabel} as there is a new local version available. Synchronizing again...`);
						return this.performSync(remoteUserData, lastSyncUserData, apply);

					case UserDataSyncErrorCode.Conflict:
					case UserDataSyncErrorCode.PreconditionFailed:
						// Rejected as there is a new remote version. Syncing again...
						this.logService.info(`${this.syncResourceLogLabel}: Failed to synchronize as there is a new remote version available. Synchronizing again...`);

						// Avoid cache and get latest remote user data - https://github.com/microsoft/vscode/issues/90624
						remoteUserData = await this.getRemoteUserData(null);

						// Get the latest last sync user data. Because multiples parallel syncs (in Web) could share same last sync data
						// and one of them successfully updated remote and last sync state.
						lastSyncUserData = await this.getLastSyncUserData();

						return this.performSync(remoteUserData, lastSyncUserData, apply);
				}
			}
			throw e;
		}
	}

	protected async doSync(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, apply: boolean): Promise<SyncStatus> {
		try {
			// generate or use existing preview
			if (!this.syncPreviewPromise) {
				this.syncPreviewPromise = createCancelablePromise(token => this.doGenerateSyncResourcePreview(remoteUserData, lastSyncUserData, apply, token));
			}

			const preview = await this.syncPreviewPromise;
			this.updateConflicts(preview.resourcePreviews);
			if (preview.resourcePreviews.some(({ mergeState }) => mergeState === MergeState.Conflict)) {
				return SyncStatus.HasConflicts;
			}

			if (apply) {
				return await this.doApply(false);
			}

			return SyncStatus.Syncing;

		} catch (error) {

			// reset preview on error
			this.syncPreviewPromise = null;

			throw error;
		}
	}

	async merge(resource: URI): Promise<ISyncResourcePreview | null> {
		await this.updateSyncResourcePreview(resource, async (resourcePreview) => {
			const mergeResult = await this.getMergeResult(resourcePreview, CancellationToken.None);
			await this.fileService.writeFile(resourcePreview.previewResource, VSBuffer.fromString(mergeResult?.content || ''));
			const acceptResult: IAcceptResult | undefined = mergeResult && !mergeResult.hasConflicts
				? await this.getAcceptResult(resourcePreview, resourcePreview.previewResource, undefined, CancellationToken.None)
				: undefined;
			resourcePreview.acceptResult = acceptResult;
			resourcePreview.mergeState = mergeResult.hasConflicts ? MergeState.Conflict : acceptResult ? MergeState.Accepted : MergeState.Preview;
			resourcePreview.localChange = acceptResult ? acceptResult.localChange : mergeResult.localChange;
			resourcePreview.remoteChange = acceptResult ? acceptResult.remoteChange : mergeResult.remoteChange;
			return resourcePreview;
		});
		return this.syncPreviewPromise;
	}

	async accept(resource: URI, content?: string | null): Promise<ISyncResourcePreview | null> {
		await this.updateSyncResourcePreview(resource, async (resourcePreview) => {
			const acceptResult = await this.getAcceptResult(resourcePreview, resource, content, CancellationToken.None);
			resourcePreview.acceptResult = acceptResult;
			resourcePreview.mergeState = MergeState.Accepted;
			resourcePreview.localChange = acceptResult.localChange;
			resourcePreview.remoteChange = acceptResult.remoteChange;
			return resourcePreview;
		});
		return this.syncPreviewPromise;
	}

	async discard(resource: URI): Promise<ISyncResourcePreview | null> {
		await this.updateSyncResourcePreview(resource, async (resourcePreview) => {
			const mergeResult = await this.getMergeResult(resourcePreview, CancellationToken.None);
			await this.fileService.writeFile(resourcePreview.previewResource, VSBuffer.fromString(mergeResult.content || ''));
			resourcePreview.acceptResult = undefined;
			resourcePreview.mergeState = MergeState.Preview;
			resourcePreview.localChange = mergeResult.localChange;
			resourcePreview.remoteChange = mergeResult.remoteChange;
			return resourcePreview;
		});
		return this.syncPreviewPromise;
	}

	private async updateSyncResourcePreview(resource: URI, updateResourcePreview: (resourcePreview: IEditableResourcePreview) => Promise<IEditableResourcePreview>): Promise<void> {
		if (!this.syncPreviewPromise) {
			return;
		}

		let preview = await this.syncPreviewPromise;
		const index = preview.resourcePreviews.findIndex(({ localResource, remoteResource, previewResource }) =>
			this.extUri.isEqual(localResource, resource) || this.extUri.isEqual(remoteResource, resource) || this.extUri.isEqual(previewResource, resource));
		if (index === -1) {
			return;
		}

		this.syncPreviewPromise = createCancelablePromise(async token => {
			const resourcePreviews = [...preview.resourcePreviews];
			resourcePreviews[index] = await updateResourcePreview(resourcePreviews[index]);
			return {
				...preview,
				resourcePreviews
			};
		});

		preview = await this.syncPreviewPromise;
		this.updateConflicts(preview.resourcePreviews);
		if (preview.resourcePreviews.some(({ mergeState }) => mergeState === MergeState.Conflict)) {
			this.setStatus(SyncStatus.HasConflicts);
		} else {
			this.setStatus(SyncStatus.Syncing);
		}
	}

	private async doApply(force: boolean): Promise<SyncStatus> {
		if (!this.syncPreviewPromise) {
			return SyncStatus.Idle;
		}

		const preview = await this.syncPreviewPromise;

		// check for conflicts
		if (preview.resourcePreviews.some(({ mergeState }) => mergeState === MergeState.Conflict)) {
			return SyncStatus.HasConflicts;
		}

		// check if all are accepted
		if (preview.resourcePreviews.some(({ mergeState }) => mergeState !== MergeState.Accepted)) {
			return SyncStatus.Syncing;
		}

		// apply preview
		await this.applyResult(preview.remoteUserData, preview.lastSyncUserData, preview.resourcePreviews.map(resourcePreview => ([resourcePreview, resourcePreview.acceptResult!])), force);

		// reset preview
		this.syncPreviewPromise = null;

		// reset preview folder
		await this.clearPreviewFolder();

		return SyncStatus.Idle;
	}

	private async clearPreviewFolder(): Promise<void> {
		try {
			await this.fileService.del(this.syncPreviewFolder, { recursive: true });
		} catch (error) { /* Ignore */ }
	}

	private updateConflicts(resourcePreviews: IEditableResourcePreview[]): void {
		const conflicts = resourcePreviews.filter(({ mergeState }) => mergeState === MergeState.Conflict);
		if (!equals(this._conflicts, conflicts, (a, b) => this.extUri.isEqual(a.previewResource, b.previewResource))) {
			this._conflicts = conflicts;
			this._onDidChangeConflicts.fire(conflicts);
		}
	}

	async hasPreviouslySynced(): Promise<boolean> {
		const lastSyncData = await this.getLastSyncUserData();
		return !!lastSyncData;
	}

	async getRemoteSyncResourceHandles(): Promise<ISyncResourceHandle[]> {
		const handles = await this.userDataSyncStoreService.getAllRefs(this.resource);
		return handles.map(({ created, ref }) => ({ created, uri: this.toRemoteBackupResource(ref) }));
	}

	async getLocalSyncResourceHandles(): Promise<ISyncResourceHandle[]> {
		const handles = await this.userDataSyncBackupStoreService.getAllRefs(this.resource);
		return handles.map(({ created, ref }) => ({ created, uri: this.toLocalBackupResource(ref) }));
	}

	private toRemoteBackupResource(ref: string): URI {
		return URI.from({ scheme: USER_DATA_SYNC_SCHEME, authority: 'remote-backup', path: `/${this.resource}/${ref}` });
	}

	private toLocalBackupResource(ref: string): URI {
		return URI.from({ scheme: USER_DATA_SYNC_SCHEME, authority: 'local-backup', path: `/${this.resource}/${ref}` });
	}

	async getMachineId({ uri }: ISyncResourceHandle): Promise<string | undefined> {
		const ref = this.extUri.basename(uri);
		if (this.extUri.isEqual(uri, this.toRemoteBackupResource(ref))) {
			const { content } = await this.getUserData(ref);
			if (content) {
				const syncData = this.parseSyncData(content);
				return syncData?.machineId;
			}
		}
		return undefined;
	}

	async resolveContent(uri: URI): Promise<string | null> {
		const ref = this.extUri.basename(uri);
		if (this.extUri.isEqual(uri, this.toRemoteBackupResource(ref))) {
			const { content } = await this.getUserData(ref);
			return content;
		}
		if (this.extUri.isEqual(uri, this.toLocalBackupResource(ref))) {
			return this.userDataSyncBackupStoreService.resolveContent(this.resource, ref);
		}
		return null;
	}

	protected async resolvePreviewContent(uri: URI): Promise<string | null> {
		const syncPreview = this.syncPreviewPromise ? await this.syncPreviewPromise : null;
		if (syncPreview) {
			for (const resourcePreview of syncPreview.resourcePreviews) {
				if (this.extUri.isEqual(resourcePreview.acceptedResource, uri)) {
					return resourcePreview.acceptResult ? resourcePreview.acceptResult.content : null;
				}
				if (this.extUri.isEqual(resourcePreview.remoteResource, uri)) {
					return resourcePreview.remoteContent;
				}
				if (this.extUri.isEqual(resourcePreview.localResource, uri)) {
					return resourcePreview.localContent;
				}
			}
		}
		return null;
	}

	async resetLocal(): Promise<void> {
		try {
			await this.fileService.del(this.lastSyncResource);
		} catch (e) { /* ignore */ }
	}

	private async doGenerateSyncResourcePreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, apply: boolean, token: CancellationToken): Promise<ISyncResourcePreview> {
		const machineId = await this.currentMachineIdPromise;
		const isLastSyncFromCurrentMachine = !!remoteUserData.syncData?.machineId && remoteUserData.syncData.machineId === machineId;

		const lastSyncUserDataForPreview = lastSyncUserData === null && isLastSyncFromCurrentMachine && !this.hasSyncResourceStateVersionChanged ? remoteUserData : lastSyncUserData;
		const resourcePreviewResults = await this.generateSyncPreview(remoteUserData, lastSyncUserDataForPreview, token);

		const resourcePreviews: IEditableResourcePreview[] = [];
		for (const resourcePreviewResult of resourcePreviewResults) {
			const acceptedResource = resourcePreviewResult.previewResource.with({ scheme: USER_DATA_SYNC_SCHEME, authority: 'accepted' });

			/* No change -> Accept */
			if (resourcePreviewResult.localChange === Change.None && resourcePreviewResult.remoteChange === Change.None) {
				resourcePreviews.push({
					...resourcePreviewResult,
					acceptedResource,
					acceptResult: { content: null, localChange: Change.None, remoteChange: Change.None },
					mergeState: MergeState.Accepted
				});
			}

			/* Changed -> Apply ? (Merge ? Conflict | Accept) : Preview */
			else {
				/* Merge */
				const mergeResult = apply ? await this.getMergeResult(resourcePreviewResult, token) : undefined;
				if (token.isCancellationRequested) {
					break;
				}
				await this.fileService.writeFile(resourcePreviewResult.previewResource, VSBuffer.fromString(mergeResult?.content || ''));

				/* Conflict | Accept */
				const acceptResult = mergeResult && !mergeResult.hasConflicts
					/* Accept if merged and there are no conflicts */
					? await this.getAcceptResult(resourcePreviewResult, resourcePreviewResult.previewResource, undefined, token)
					: undefined;

				resourcePreviews.push({
					...resourcePreviewResult,
					acceptResult,
					mergeState: mergeResult?.hasConflicts ? MergeState.Conflict : acceptResult ? MergeState.Accepted : MergeState.Preview,
					localChange: acceptResult ? acceptResult.localChange : mergeResult ? mergeResult.localChange : resourcePreviewResult.localChange,
					remoteChange: acceptResult ? acceptResult.remoteChange : mergeResult ? mergeResult.remoteChange : resourcePreviewResult.remoteChange
				});
			}
		}

		return { remoteUserData, lastSyncUserData, resourcePreviews, isLastSyncFromCurrentMachine };
	}

	async getLastSyncUserData<T extends IRemoteUserData>(): Promise<T | null> {
		try {
			const content = await this.fileService.readFile(this.lastSyncResource);
			const parsed = JSON.parse(content.value.toString());
			const resourceSyncStateVersion = this.userDataSyncResourceEnablementService.getResourceSyncStateVersion(this.resource);
			this.hasSyncResourceStateVersionChanged = parsed.version && resourceSyncStateVersion && parsed.version !== resourceSyncStateVersion;
			if (this.hasSyncResourceStateVersionChanged) {
				this.logService.info(`${this.syncResourceLogLabel}: Reset last sync state because last sync state version ${parsed.version} is not compatible with current sync state version ${resourceSyncStateVersion}.`);
				await this.resetLocal();
				return null;
			}

			const userData: IUserData = parsed as IUserData;
			if (userData.content === null) {
				return { ref: parsed.ref, syncData: null } as T;
			}
			const syncData: ISyncData = JSON.parse(userData.content);

			/* Check if syncData is of expected type. Return only if matches */
			if (isSyncData(syncData)) {
				return { ...parsed, ...{ syncData, content: undefined } };
			}

		} catch (error) {
			if (!(error instanceof FileOperationError && error.fileOperationResult === FileOperationResult.FILE_NOT_FOUND)) {
				// log error always except when file does not exist
				this.logService.error(error);
			}
		}
		return null;
	}

	protected async updateLastSyncUserData(lastSyncRemoteUserData: IRemoteUserData, additionalProps: IStringDictionary<any> = {}): Promise<void> {
		if (additionalProps['ref'] || additionalProps['content'] || additionalProps['version']) {
			throw new Error('Cannot have core properties as additional');
		}

		const version = this.userDataSyncResourceEnablementService.getResourceSyncStateVersion(this.resource);
		const lastSyncUserData = { ref: lastSyncRemoteUserData.ref, content: lastSyncRemoteUserData.syncData ? JSON.stringify(lastSyncRemoteUserData.syncData) : null, version, ...additionalProps };
		await this.fileService.writeFile(this.lastSyncResource, VSBuffer.fromString(JSON.stringify(lastSyncUserData)));
	}

	async getRemoteUserData(lastSyncData: IRemoteUserData | null): Promise<IRemoteUserData> {
		const { ref, content } = await this.getUserData(lastSyncData);
		let syncData: ISyncData | null = null;
		if (content !== null) {
			syncData = this.parseSyncData(content);
		}
		return { ref, syncData };
	}

	protected parseSyncData(content: string): ISyncData {
		try {
			const syncData: ISyncData = JSON.parse(content);
			if (isSyncData(syncData)) {
				return syncData;
			}
		} catch (error) {
			this.logService.error(error);
		}
		throw new UserDataSyncError(localize('incompatible sync data', "Cannot parse sync data as it is not compatible with the current version."), UserDataSyncErrorCode.IncompatibleRemoteContent, this.resource);
	}

	private async getUserData(refOrLastSyncData: string | IRemoteUserData | null): Promise<IUserData> {
		if (isString(refOrLastSyncData)) {
			const content = await this.userDataSyncStoreService.resolveContent(this.resource, refOrLastSyncData);
			return { ref: refOrLastSyncData, content };
		} else {
			const lastSyncUserData: IUserData | null = refOrLastSyncData ? { ref: refOrLastSyncData.ref, content: refOrLastSyncData.syncData ? JSON.stringify(refOrLastSyncData.syncData) : null } : null;
			return this.userDataSyncStoreService.read(this.resource, lastSyncUserData, this.syncHeaders);
		}
	}

	protected async updateRemoteUserData(content: string, ref: string | null): Promise<IRemoteUserData> {
		const machineId = await this.currentMachineIdPromise;
		const syncData: ISyncData = { version: this.version, machineId, content };
		ref = await this.userDataSyncStoreService.write(this.resource, JSON.stringify(syncData), ref, this.syncHeaders);
		return { ref, syncData };
	}

	protected async backupLocal(content: string): Promise<void> {
		const syncData: ISyncData = { version: this.version, content };
		return this.userDataSyncBackupStoreService.backup(this.resource, JSON.stringify(syncData));
	}

	async stop(): Promise<void> {
		if (this.status === SyncStatus.Idle) {
			return;
		}

		this.logService.trace(`${this.syncResourceLogLabel}: Stopping synchronizing ${this.resource.toLowerCase()}.`);
		if (this.syncPreviewPromise) {
			this.syncPreviewPromise.cancel();
			this.syncPreviewPromise = null;
		}

		this.updateConflicts([]);
		await this.clearPreviewFolder();

		this.setStatus(SyncStatus.Idle);
		this.logService.info(`${this.syncResourceLogLabel}: Stopped synchronizing ${this.resource.toLowerCase()}.`);
	}

	protected abstract readonly version: number;
	protected abstract generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, token: CancellationToken): Promise<IResourcePreview[]>;
	protected abstract getMergeResult(resourcePreview: IResourcePreview, token: CancellationToken): Promise<IMergeResult>;
	protected abstract getAcceptResult(resourcePreview: IResourcePreview, resource: URI, content: string | null | undefined, token: CancellationToken): Promise<IAcceptResult>;
	protected abstract applyResult(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, result: [IResourcePreview, IAcceptResult][], force: boolean): Promise<void>;
}

export interface IFileResourcePreview extends IResourcePreview {
	readonly fileContent: IFileContent | null;
}

export abstract class AbstractFileSynchroniser extends AbstractSynchroniser {

	constructor(
		protected readonly file: URI,
		resource: SyncResource,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IStorageService storageService: IStorageService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncResourceEnablementService userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(resource, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncResourceEnablementService, telemetryService, logService, configurationService);
		this._register(this.fileService.watch(this.extUri.dirname(file)));
		this._register(this.fileService.onDidFilesChange(e => this.onFileChanges(e)));
	}

	protected async getLocalFileContent(): Promise<IFileContent | null> {
		try {
			return await this.fileService.readFile(this.file);
		} catch (error) {
			return null;
		}
	}

	protected async updateLocalFileContent(newContent: string, oldContent: IFileContent | null, force: boolean): Promise<void> {
		try {
			if (oldContent) {
				// file exists already
				await this.fileService.writeFile(this.file, VSBuffer.fromString(newContent), force ? undefined : oldContent);
			} else {
				// file does not exist
				await this.fileService.createFile(this.file, VSBuffer.fromString(newContent), { overwrite: force });
			}
		} catch (e) {
			if ((e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_NOT_FOUND) ||
				(e instanceof FileOperationError && e.fileOperationResult === FileOperationResult.FILE_MODIFIED_SINCE)) {
				throw new UserDataSyncError(e.message, UserDataSyncErrorCode.LocalPreconditionFailed);
			} else {
				throw e;
			}
		}
	}

	private onFileChanges(e: FileChangesEvent): void {
		if (!e.contains(this.file)) {
			return;
		}
		this.triggerLocalChange();
	}

}

export abstract class AbstractJsonFileSynchroniser extends AbstractFileSynchroniser {

	constructor(
		file: URI,
		resource: SyncResource,
		@IFileService fileService: IFileService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IStorageService storageService: IStorageService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService,
		@IUserDataSyncResourceEnablementService userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IUserDataSyncLogService logService: IUserDataSyncLogService,
		@IUserDataSyncUtilService protected readonly userDataSyncUtilService: IUserDataSyncUtilService,
		@IConfigurationService configurationService: IConfigurationService,
	) {
		super(file, resource, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncResourceEnablementService, telemetryService, logService, configurationService);
	}

	protected hasErrors(content: string): boolean {
		const parseErrors: ParseError[] = [];
		parse(content, parseErrors, { allowEmptyContent: true, allowTrailingComma: true });
		return parseErrors.length > 0;
	}

	private _formattingOptions: Promise<FormattingOptions> | undefined = undefined;
	protected getFormattingOptions(): Promise<FormattingOptions> {
		if (!this._formattingOptions) {
			this._formattingOptions = this.userDataSyncUtilService.resolveFormattingOptions(this.file);
		}
		return this._formattingOptions;
	}

}

export abstract class AbstractInitializer implements IUserDataInitializer {

	protected readonly extUri: IExtUri;
	private readonly lastSyncResource: URI;

	constructor(
		readonly resource: SyncResource,
		@IEnvironmentService protected readonly environmentService: IEnvironmentService,
		@IUserDataSyncLogService protected readonly logService: IUserDataSyncLogService,
		@IFileService protected readonly fileService: IFileService,
	) {
		this.extUri = this.fileService.hasCapability(environmentService.userDataSyncHome, FileSystemProviderCapabilities.PathCaseSensitive) ? extUri : extUriIgnorePathCase;
		this.lastSyncResource = getLastSyncResourceUri(this.resource, environmentService, extUri);
	}

	async initialize({ ref, content }: IUserData): Promise<void> {
		if (!content) {
			this.logService.info('Remote content does not exist.', this.resource);
			return;
		}

		const syncData = this.parseSyncData(content);
		if (!syncData) {
			return;
		}

		const isPreviouslySynced = await this.fileService.exists(this.lastSyncResource);
		if (isPreviouslySynced) {
			this.logService.info('Remote content does not exist.', this.resource);
			return;
		}

		try {
			await this.doInitialize({ ref, syncData });
		} catch (error) {
			this.logService.error(error);
		}
	}

	private parseSyncData(content: string): ISyncData | undefined {
		try {
			const syncData: ISyncData = JSON.parse(content);
			if (isSyncData(syncData)) {
				return syncData;
			}
		} catch (error) {
			this.logService.error(error);
		}
		this.logService.info('Cannot parse sync data as it is not compatible with the current version.', this.resource);
		return undefined;
	}

	protected async updateLastSyncUserData(lastSyncRemoteUserData: IRemoteUserData, additionalProps: IStringDictionary<any> = {}): Promise<void> {
		const lastSyncUserData: IUserData = { ref: lastSyncRemoteUserData.ref, content: lastSyncRemoteUserData.syncData ? JSON.stringify(lastSyncRemoteUserData.syncData) : null, ...additionalProps };
		await this.fileService.writeFile(this.lastSyncResource, VSBuffer.fromString(JSON.stringify(lastSyncUserData)));
	}

	protected abstract doInitialize(remoteUserData: IRemoteUserData): Promise<void>;

}
