/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import {
	IUserDataSyncService, SyncStatus, IUserDataSyncStoreService, SyncResource, IUserDataSyncLogService, IUserDataSynchroniser, UserDataSyncErrorCode,
	UserDataSyncError, ISyncResourceHandle, IUserDataManifest, ISyncTask, IResourcePreview, IManualSyncTask, ISyncResourcePreview, MergeState, Change, IUserDataSyncStoreManagementService, UserDataSyncStoreError, createSyncHeaders
} from 'vs/platform/userDataSync/common/userDataSync';
import { Disposable } from 'vs/base/common/lifecycle';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Emitter, Event } from 'vs/base/common/event';
import { ExtensionsSynchroniser } from 'vs/platform/userDataSync/common/extensionsSync';
import { KeybindingsSynchroniser } from 'vs/platform/userDataSync/common/keybindingsSync';
import { GlobalStateSynchroniser } from 'vs/platform/userDataSync/common/globalStateSync';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { equals } from 'vs/base/common/arrays';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { URI } from 'vs/base/common/uri';
import { SettingsSynchroniser } from 'vs/platform/userDataSync/common/settingsSync';
import { isEqual } from 'vs/base/common/resources';
import { SnippetsSynchroniser } from 'vs/platform/userDataSync/common/snippetsSync';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IHeaders } from 'vs/base/parts/request/common/request';
import { generateUuid } from 'vs/base/common/uuid';
import { createCancelablePromise, CancelablePromise } from 'vs/base/common/async';
import { isPromiseCanceledError } from 'vs/base/common/errors';

type SyncErrorClassification = {
	code: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	service: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	url?: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	resource?: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	executionId?: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

const LAST_SYNC_TIME_KEY = 'sync.lastSyncTime';

export class UserDataSyncService extends Disposable implements IUserDataSyncService {

	_serviceBrand: any;

	private readonly synchronisers: IUserDataSynchroniser[];

	private _status: SyncStatus = SyncStatus.Uninitialized;
	get status(): SyncStatus { return this._status; }
	private _onDidChangeStatus: Emitter<SyncStatus> = this._register(new Emitter<SyncStatus>());
	readonly onDidChangeStatus: Event<SyncStatus> = this._onDidChangeStatus.event;

	readonly onDidChangeLocal: Event<SyncResource>;

	private _conflicts: [SyncResource, IResourcePreview[]][] = [];
	get conflicts(): [SyncResource, IResourcePreview[]][] { return this._conflicts; }
	private _onDidChangeConflicts: Emitter<[SyncResource, IResourcePreview[]][]> = this._register(new Emitter<[SyncResource, IResourcePreview[]][]>());
	readonly onDidChangeConflicts: Event<[SyncResource, IResourcePreview[]][]> = this._onDidChangeConflicts.event;

	private _syncErrors: [SyncResource, UserDataSyncError][] = [];
	private _onSyncErrors: Emitter<[SyncResource, UserDataSyncError][]> = this._register(new Emitter<[SyncResource, UserDataSyncError][]>());
	readonly onSyncErrors: Event<[SyncResource, UserDataSyncError][]> = this._onSyncErrors.event;

	private _lastSyncTime: number | undefined = undefined;
	get lastSyncTime(): number | undefined { return this._lastSyncTime; }
	private _onDidChangeLastSyncTime: Emitter<number> = this._register(new Emitter<number>());
	readonly onDidChangeLastSyncTime: Event<number> = this._onDidChangeLastSyncTime.event;

	private _onDidResetLocal = this._register(new Emitter<void>());
	readonly onDidResetLocal = this._onDidResetLocal.event;
	private _onDidResetRemote = this._register(new Emitter<void>());
	readonly onDidResetRemote = this._onDidResetRemote.event;

	private readonly settingsSynchroniser: SettingsSynchroniser;
	private readonly keybindingsSynchroniser: KeybindingsSynchroniser;
	private readonly snippetsSynchroniser: SnippetsSynchroniser;
	private readonly extensionsSynchroniser: ExtensionsSynchroniser;
	private readonly globalStateSynchroniser: GlobalStateSynchroniser;

	constructor(
		@IUserDataSyncStoreService private readonly userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncStoreManagementService private readonly userDataSyncStoreManagementService: IUserDataSyncStoreManagementService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IUserDataSyncLogService private readonly logService: IUserDataSyncLogService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IStorageService private readonly storageService: IStorageService,
	) {
		super();
		this.settingsSynchroniser = this._register(this.instantiationService.createInstance(SettingsSynchroniser));
		this.keybindingsSynchroniser = this._register(this.instantiationService.createInstance(KeybindingsSynchroniser));
		this.snippetsSynchroniser = this._register(this.instantiationService.createInstance(SnippetsSynchroniser));
		this.globalStateSynchroniser = this._register(this.instantiationService.createInstance(GlobalStateSynchroniser));
		this.extensionsSynchroniser = this._register(this.instantiationService.createInstance(ExtensionsSynchroniser));
		this.synchronisers = [this.settingsSynchroniser, this.keybindingsSynchroniser, this.snippetsSynchroniser, this.globalStateSynchroniser, this.extensionsSynchroniser];
		this.updateStatus();

		if (this.userDataSyncStoreManagementService.userDataSyncStore) {
			this._register(Event.any(...this.synchronisers.map(s => Event.map(s.onDidChangeStatus, () => undefined)))(() => this.updateStatus()));
			this._register(Event.any(...this.synchronisers.map(s => Event.map(s.onDidChangeConflicts, () => undefined)))(() => this.updateConflicts()));
		}

		this._lastSyncTime = this.storageService.getNumber(LAST_SYNC_TIME_KEY, StorageScope.GLOBAL, undefined);
		this.onDidChangeLocal = Event.any(...this.synchronisers.map(s => Event.map(s.onDidChangeLocal, () => s.resource)));
	}

	async createSyncTask(disableCache?: boolean): Promise<ISyncTask> {
		await this.checkEnablement();

		const executionId = generateUuid();
		let manifest: IUserDataManifest | null;
		try {
			const syncHeaders = createSyncHeaders(executionId);
			if (disableCache) {
				syncHeaders['Cache-Control'] = 'no-cache';
			}
			manifest = await this.userDataSyncStoreService.manifest(syncHeaders);
		} catch (error) {
			const userDataSyncError = UserDataSyncError.toUserDataSyncError(error);
			this.reportUserDataSyncError(userDataSyncError, executionId);
			throw userDataSyncError;
		}

		let executed = false;
		const that = this;
		let cancellablePromise: CancelablePromise<void> | undefined;
		return {
			manifest,
			run(): Promise<void> {
				if (executed) {
					throw new Error('Can run a task only once');
				}
				cancellablePromise = createCancelablePromise(token => that.sync(manifest, executionId, token));
				return cancellablePromise.finally(() => cancellablePromise = undefined);
			},
			async stop(): Promise<void> {
				if (cancellablePromise) {
					cancellablePromise.cancel();
				}
				if (that.status !== SyncStatus.Idle) {
					return that.stop();
				}
			}
		};
	}

	async createManualSyncTask(): Promise<IManualSyncTask> {
		await this.checkEnablement();

		const executionId = generateUuid();
		const syncHeaders = createSyncHeaders(executionId);

		let manifest: IUserDataManifest | null;
		try {
			manifest = await this.userDataSyncStoreService.manifest(syncHeaders);
		} catch (error) {
			const userDataSyncError = UserDataSyncError.toUserDataSyncError(error);
			this.reportUserDataSyncError(userDataSyncError, executionId);
			throw userDataSyncError;
		}

		return new ManualSyncTask(executionId, manifest, syncHeaders, this.synchronisers, this.logService);
	}

	private recoveredSettings: boolean = false;
	private async sync(manifest: IUserDataManifest | null, executionId: string, token: CancellationToken): Promise<void> {
		if (!this.recoveredSettings) {
			await this.settingsSynchroniser.recoverSettings();
			this.recoveredSettings = true;
		}

		// Return if cancellation is requested
		if (token.isCancellationRequested) {
			return;
		}

		const startTime = new Date().getTime();
		this._syncErrors = [];
		try {
			this.logService.trace('Sync started.');
			if (this.status !== SyncStatus.HasConflicts) {
				this.setStatus(SyncStatus.Syncing);
			}

			const syncHeaders = createSyncHeaders(executionId);

			for (const synchroniser of this.synchronisers) {
				// Return if cancellation is requested
				if (token.isCancellationRequested) {
					return;
				}
				try {
					await synchroniser.sync(manifest, syncHeaders);
				} catch (e) {

					if (e instanceof UserDataSyncError) {
						// Bail out for following errors
						switch (e.code) {
							case UserDataSyncErrorCode.TooLarge:
								throw new UserDataSyncError(e.message, e.code, synchroniser.resource);
							case UserDataSyncErrorCode.TooManyRequests:
							case UserDataSyncErrorCode.TooManyRequestsAndRetryAfter:
							case UserDataSyncErrorCode.LocalTooManyRequests:
							case UserDataSyncErrorCode.Gone:
							case UserDataSyncErrorCode.UpgradeRequired:
							case UserDataSyncErrorCode.IncompatibleRemoteContent:
							case UserDataSyncErrorCode.IncompatibleLocalContent:
								throw e;
						}
					}

					// Log and report other errors and continue
					const userDataSyncError = UserDataSyncError.toUserDataSyncError(e);
					this.reportUserDataSyncError(userDataSyncError, executionId);
					this.logService.error(e);
					this.logService.error(`${synchroniser.resource}: ${toErrorMessage(e)}`);
					this._syncErrors.push([synchroniser.resource, userDataSyncError]);
				}
			}

			this.logService.info(`Sync done. Took ${new Date().getTime() - startTime}ms`);
			this.updateLastSyncTime();
		} catch (error) {
			const userDataSyncError = UserDataSyncError.toUserDataSyncError(error);
			this.reportUserDataSyncError(userDataSyncError, executionId);
			throw userDataSyncError;
		} finally {
			this.updateStatus();
			this._onSyncErrors.fire(this._syncErrors);
		}
	}

	private async stop(): Promise<void> {
		if (this.status === SyncStatus.Idle) {
			return;
		}

		for (const synchroniser of this.synchronisers) {
			try {
				if (synchroniser.status !== SyncStatus.Idle) {
					await synchroniser.stop();
				}
			} catch (e) {
				this.logService.error(e);
			}
		}

	}

	async replace(uri: URI): Promise<void> {
		await this.checkEnablement();
		for (const synchroniser of this.synchronisers) {
			if (await synchroniser.replace(uri)) {
				return;
			}
		}
	}

	async accept(syncResource: SyncResource, resource: URI, content: string | null | undefined, apply: boolean): Promise<void> {
		await this.checkEnablement();
		const synchroniser = this.getSynchroniser(syncResource);
		await synchroniser.accept(resource, content);
		if (apply) {
			await synchroniser.apply(false, createSyncHeaders(generateUuid()));
		}
	}

	async resolveContent(resource: URI): Promise<string | null> {
		for (const synchroniser of this.synchronisers) {
			const content = await synchroniser.resolveContent(resource);
			if (content) {
				return content;
			}
		}
		return null;
	}

	getRemoteSyncResourceHandles(resource: SyncResource): Promise<ISyncResourceHandle[]> {
		return this.getSynchroniser(resource).getRemoteSyncResourceHandles();
	}

	getLocalSyncResourceHandles(resource: SyncResource): Promise<ISyncResourceHandle[]> {
		return this.getSynchroniser(resource).getLocalSyncResourceHandles();
	}

	getAssociatedResources(resource: SyncResource, syncResourceHandle: ISyncResourceHandle): Promise<{ resource: URI, comparableResource: URI }[]> {
		return this.getSynchroniser(resource).getAssociatedResources(syncResourceHandle);
	}

	getMachineId(resource: SyncResource, syncResourceHandle: ISyncResourceHandle): Promise<string | undefined> {
		return this.getSynchroniser(resource).getMachineId(syncResourceHandle);
	}

	async hasLocalData(): Promise<boolean> {
		// skip global state synchronizer
		const synchronizers = [this.settingsSynchroniser, this.keybindingsSynchroniser, this.snippetsSynchroniser, this.extensionsSynchroniser];
		for (const synchroniser of synchronizers) {
			if (await synchroniser.hasLocalData()) {
				return true;
			}
		}
		return false;
	}

	async reset(): Promise<void> {
		await this.checkEnablement();
		await this.resetRemote();
		await this.resetLocal();
	}

	async resetRemote(): Promise<void> {
		await this.checkEnablement();
		try {
			await this.userDataSyncStoreService.clear();
			this.logService.info('Cleared data on server');
		} catch (e) {
			this.logService.error(e);
		}
		this._onDidResetRemote.fire();
	}

	async resetLocal(): Promise<void> {
		await this.checkEnablement();
		this.storageService.remove(LAST_SYNC_TIME_KEY, StorageScope.GLOBAL);
		for (const synchroniser of this.synchronisers) {
			try {
				await synchroniser.resetLocal();
			} catch (e) {
				this.logService.error(`${synchroniser.resource}: ${toErrorMessage(e)}`);
				this.logService.error(e);
			}
		}
		this._onDidResetLocal.fire();
		this.logService.info('Did reset the local sync state.');
	}

	async hasPreviouslySynced(): Promise<boolean> {
		for (const synchroniser of this.synchronisers) {
			if (await synchroniser.hasPreviouslySynced()) {
				return true;
			}
		}
		return false;
	}

	private setStatus(status: SyncStatus): void {
		const oldStatus = this._status;
		if (this._status !== status) {
			this._status = status;
			this._onDidChangeStatus.fire(status);
			if (oldStatus === SyncStatus.HasConflicts) {
				this.updateLastSyncTime();
			}
		}
	}

	private updateStatus(): void {
		this.updateConflicts();
		const status = this.computeStatus();
		this.setStatus(status);
	}

	private updateConflicts(): void {
		const conflicts = this.computeConflicts();
		if (!equals(this._conflicts, conflicts, ([syncResourceA, conflictsA], [syncResourceB, conflictsB]) => syncResourceA === syncResourceA && equals(conflictsA, conflictsB, (a, b) => isEqual(a.previewResource, b.previewResource)))) {
			this._conflicts = this.computeConflicts();
			this._onDidChangeConflicts.fire(conflicts);
		}
	}

	private computeStatus(): SyncStatus {
		if (!this.userDataSyncStoreManagementService.userDataSyncStore) {
			return SyncStatus.Uninitialized;
		}
		if (this.synchronisers.some(s => s.status === SyncStatus.HasConflicts)) {
			return SyncStatus.HasConflicts;
		}
		if (this.synchronisers.some(s => s.status === SyncStatus.Syncing)) {
			return SyncStatus.Syncing;
		}
		return SyncStatus.Idle;
	}

	private updateLastSyncTime(): void {
		if (this.status === SyncStatus.Idle) {
			this._lastSyncTime = new Date().getTime();
			this.storageService.store(LAST_SYNC_TIME_KEY, this._lastSyncTime, StorageScope.GLOBAL, StorageTarget.MACHINE);
			this._onDidChangeLastSyncTime.fire(this._lastSyncTime);
		}
	}

	private reportUserDataSyncError(userDataSyncError: UserDataSyncError, executionId: string) {
		this.telemetryService.publicLog2<{ code: string, service: string, url?: string, resource?: string, executionId?: string }, SyncErrorClassification>('sync/error',
			{ code: userDataSyncError.code, url: userDataSyncError instanceof UserDataSyncStoreError ? userDataSyncError.url : undefined, resource: userDataSyncError.resource, executionId, service: this.userDataSyncStoreManagementService.userDataSyncStore!.url.toString() });
	}

	private computeConflicts(): [SyncResource, IResourcePreview[]][] {
		return this.synchronisers.filter(s => s.status === SyncStatus.HasConflicts)
			.map(s => ([s.resource, s.conflicts.map(toStrictResourcePreview)]));
	}

	getSynchroniser(source: SyncResource): IUserDataSynchroniser {
		return this.synchronisers.find(s => s.resource === source)!;
	}

	private async checkEnablement(): Promise<void> {
		if (!this.userDataSyncStoreManagementService.userDataSyncStore) {
			throw new Error('Not enabled');
		}
	}

}

class ManualSyncTask extends Disposable implements IManualSyncTask {

	private previewsPromise: CancelablePromise<[SyncResource, ISyncResourcePreview][]> | undefined;
	private previews: [SyncResource, ISyncResourcePreview][] | undefined;

	private synchronizingResources: [SyncResource, URI[]][] = [];
	private _onSynchronizeResources = this._register(new Emitter<[SyncResource, URI[]][]>());
	readonly onSynchronizeResources = this._onSynchronizeResources.event;

	private isDisposed: boolean = false;

	get status(): SyncStatus {
		if (this.synchronisers.some(s => s.status === SyncStatus.HasConflicts)) {
			return SyncStatus.HasConflicts;
		}
		if (this.synchronisers.some(s => s.status === SyncStatus.Syncing)) {
			return SyncStatus.Syncing;
		}
		return SyncStatus.Idle;
	}

	constructor(
		readonly id: string,
		readonly manifest: IUserDataManifest | null,
		private readonly syncHeaders: IHeaders,
		private readonly synchronisers: IUserDataSynchroniser[],
		private readonly logService: IUserDataSyncLogService,
	) {
		super();
	}

	async preview(): Promise<[SyncResource, ISyncResourcePreview][]> {
		try {
			if (this.isDisposed) {
				throw new Error('Disposed');
			}
			if (!this.previewsPromise) {
				this.previewsPromise = createCancelablePromise(token => this.getPreviews(token));
			}
			if (!this.previews) {
				this.previews = await this.previewsPromise;
			}
			return this.previews;
		} catch (error) {
			this.logService.error(error);
			throw error;
		}
	}

	async accept(resource: URI, content?: string | null): Promise<[SyncResource, ISyncResourcePreview][]> {
		try {
			return await this.performAction(resource, sychronizer => sychronizer.accept(resource, content));
		} catch (error) {
			this.logService.error(error);
			throw error;
		}
	}

	async merge(resource?: URI): Promise<[SyncResource, ISyncResourcePreview][]> {
		try {
			if (resource) {
				return await this.performAction(resource, sychronizer => sychronizer.merge(resource));
			} else {
				return await this.mergeAll();
			}
		} catch (error) {
			this.logService.error(error);
			throw error;
		}
	}

	async discard(resource: URI): Promise<[SyncResource, ISyncResourcePreview][]> {
		try {
			return await this.performAction(resource, sychronizer => sychronizer.discard(resource));
		} catch (error) {
			this.logService.error(error);
			throw error;
		}
	}

	async discardConflicts(): Promise<[SyncResource, ISyncResourcePreview][]> {
		try {
			if (!this.previews) {
				throw new Error('Missing preview. Create preview and try again.');
			}
			if (this.synchronizingResources.length) {
				throw new Error('Cannot discard while synchronizing resources');
			}

			const conflictResources: URI[] = [];
			for (const [, syncResourcePreview] of this.previews) {
				for (const resourcePreview of syncResourcePreview.resourcePreviews) {
					if (resourcePreview.mergeState === MergeState.Conflict) {
						conflictResources.push(resourcePreview.previewResource);
					}
				}
			}

			for (const resource of conflictResources) {
				await this.discard(resource);
			}
			return this.previews;
		} catch (error) {
			this.logService.error(error);
			throw error;
		}
	}

	async apply(): Promise<[SyncResource, ISyncResourcePreview][]> {
		try {
			if (!this.previews) {
				throw new Error('You need to create preview before applying');
			}
			if (this.synchronizingResources.length) {
				throw new Error('Cannot pull while synchronizing resources');
			}
			const previews: [SyncResource, ISyncResourcePreview][] = [];
			for (const [syncResource, preview] of this.previews) {
				this.synchronizingResources.push([syncResource, preview.resourcePreviews.map(r => r.localResource)]);
				this._onSynchronizeResources.fire(this.synchronizingResources);

				const synchroniser = this.synchronisers.find(s => s.resource === syncResource)!;

				/* merge those which are not yet merged */
				for (const resourcePreview of preview.resourcePreviews) {
					if ((resourcePreview.localChange !== Change.None || resourcePreview.remoteChange !== Change.None) && resourcePreview.mergeState === MergeState.Preview) {
						await synchroniser.merge(resourcePreview.previewResource);
					}
				}

				/* apply */
				const newPreview = await synchroniser.apply(false, this.syncHeaders);
				if (newPreview) {
					previews.push(this.toSyncResourcePreview(synchroniser.resource, newPreview));
				}

				this.synchronizingResources.splice(this.synchronizingResources.findIndex(s => s[0] === syncResource), 1);
				this._onSynchronizeResources.fire(this.synchronizingResources);
			}
			this.previews = previews;
			return this.previews;
		} catch (error) {
			this.logService.error(error);
			throw error;
		}
	}

	async pull(): Promise<void> {
		try {
			if (!this.previews) {
				throw new Error('You need to create preview before applying');
			}
			if (this.synchronizingResources.length) {
				throw new Error('Cannot pull while synchronizing resources');
			}
			for (const [syncResource, preview] of this.previews) {
				this.synchronizingResources.push([syncResource, preview.resourcePreviews.map(r => r.localResource)]);
				this._onSynchronizeResources.fire(this.synchronizingResources);
				const synchroniser = this.synchronisers.find(s => s.resource === syncResource)!;
				for (const resourcePreview of preview.resourcePreviews) {
					await synchroniser.accept(resourcePreview.remoteResource);
				}
				await synchroniser.apply(true, this.syncHeaders);
				this.synchronizingResources.splice(this.synchronizingResources.findIndex(s => s[0] === syncResource), 1);
				this._onSynchronizeResources.fire(this.synchronizingResources);
			}
			this.previews = [];
		} catch (error) {
			this.logService.error(error);
			throw error;
		}
	}

	async push(): Promise<void> {
		try {
			if (!this.previews) {
				throw new Error('You need to create preview before applying');
			}
			if (this.synchronizingResources.length) {
				throw new Error('Cannot pull while synchronizing resources');
			}
			for (const [syncResource, preview] of this.previews) {
				this.synchronizingResources.push([syncResource, preview.resourcePreviews.map(r => r.localResource)]);
				this._onSynchronizeResources.fire(this.synchronizingResources);
				const synchroniser = this.synchronisers.find(s => s.resource === syncResource)!;
				for (const resourcePreview of preview.resourcePreviews) {
					await synchroniser.accept(resourcePreview.localResource);
				}
				await synchroniser.apply(true, this.syncHeaders);
				this.synchronizingResources.splice(this.synchronizingResources.findIndex(s => s[0] === syncResource), 1);
				this._onSynchronizeResources.fire(this.synchronizingResources);
			}
			this.previews = [];
		} catch (error) {
			this.logService.error(error);
			throw error;
		}
	}

	async stop(): Promise<void> {
		for (const synchroniser of this.synchronisers) {
			try {
				await synchroniser.stop();
			} catch (error) {
				if (!isPromiseCanceledError(error)) {
					this.logService.error(error);
				}
			}
		}
		this.reset();
	}

	private async performAction(resource: URI, action: (synchroniser: IUserDataSynchroniser) => Promise<ISyncResourcePreview | null>): Promise<[SyncResource, ISyncResourcePreview][]> {
		if (!this.previews) {
			throw new Error('Missing preview. Create preview and try again.');
		}

		const index = this.previews.findIndex(([, preview]) => preview.resourcePreviews.some(({ localResource, previewResource, remoteResource }) =>
			isEqual(resource, localResource) || isEqual(resource, previewResource) || isEqual(resource, remoteResource)));
		if (index === -1) {
			return this.previews;
		}

		const [syncResource, previews] = this.previews[index];
		const resourcePreview = previews.resourcePreviews.find(({ localResource, remoteResource, previewResource }) => isEqual(localResource, resource) || isEqual(remoteResource, resource) || isEqual(previewResource, resource));
		if (!resourcePreview) {
			return this.previews;
		}

		let synchronizingResources = this.synchronizingResources.find(s => s[0] === syncResource);
		if (!synchronizingResources) {
			synchronizingResources = [syncResource, []];
			this.synchronizingResources.push(synchronizingResources);
		}
		if (!synchronizingResources[1].some(s => isEqual(s, resourcePreview.localResource))) {
			synchronizingResources[1].push(resourcePreview.localResource);
			this._onSynchronizeResources.fire(this.synchronizingResources);
		}

		const synchroniser = this.synchronisers.find(s => s.resource === this.previews![index][0])!;
		const preview = await action(synchroniser);
		preview ? this.previews.splice(index, 1, this.toSyncResourcePreview(synchroniser.resource, preview)) : this.previews.splice(index, 1);

		const i = this.synchronizingResources.findIndex(s => s[0] === syncResource);
		this.synchronizingResources[i][1].splice(synchronizingResources[1].findIndex(r => isEqual(r, resourcePreview.localResource)), 1);
		if (!synchronizingResources[1].length) {
			this.synchronizingResources.splice(i, 1);
			this._onSynchronizeResources.fire(this.synchronizingResources);
		}

		return this.previews;
	}

	private async mergeAll(): Promise<[SyncResource, ISyncResourcePreview][]> {
		if (!this.previews) {
			throw new Error('You need to create preview before merging or applying');
		}
		if (this.synchronizingResources.length) {
			throw new Error('Cannot merge or apply while synchronizing resources');
		}
		const previews: [SyncResource, ISyncResourcePreview][] = [];
		for (const [syncResource, preview] of this.previews) {
			this.synchronizingResources.push([syncResource, preview.resourcePreviews.map(r => r.localResource)]);
			this._onSynchronizeResources.fire(this.synchronizingResources);

			const synchroniser = this.synchronisers.find(s => s.resource === syncResource)!;

			/* merge those which are not yet merged */
			let newPreview: ISyncResourcePreview | null = preview;
			for (const resourcePreview of preview.resourcePreviews) {
				if ((resourcePreview.localChange !== Change.None || resourcePreview.remoteChange !== Change.None) && resourcePreview.mergeState === MergeState.Preview) {
					newPreview = await synchroniser.merge(resourcePreview.previewResource);
				}
			}

			if (newPreview) {
				previews.push(this.toSyncResourcePreview(synchroniser.resource, newPreview));
			}

			this.synchronizingResources.splice(this.synchronizingResources.findIndex(s => s[0] === syncResource), 1);
			this._onSynchronizeResources.fire(this.synchronizingResources);
		}
		this.previews = previews;
		return this.previews;
	}

	private async getPreviews(token: CancellationToken): Promise<[SyncResource, ISyncResourcePreview][]> {
		const result: [SyncResource, ISyncResourcePreview][] = [];
		for (const synchroniser of this.synchronisers) {
			if (token.isCancellationRequested) {
				return [];
			}
			const preview = await synchroniser.preview(this.manifest, this.syncHeaders);
			if (preview) {
				result.push(this.toSyncResourcePreview(synchroniser.resource, preview));
			}
		}
		return result;
	}

	private toSyncResourcePreview(syncResource: SyncResource, preview: ISyncResourcePreview): [SyncResource, ISyncResourcePreview] {
		return [
			syncResource,
			{
				isLastSyncFromCurrentMachine: preview.isLastSyncFromCurrentMachine,
				resourcePreviews: preview.resourcePreviews.map(toStrictResourcePreview)
			}
		];
	}

	private reset(): void {
		if (this.previewsPromise) {
			this.previewsPromise.cancel();
			this.previewsPromise = undefined;
		}
		this.previews = undefined;
		this.synchronizingResources = [];
	}

	override dispose(): void {
		this.reset();
		this.isDisposed = true;
	}

}

function toStrictResourcePreview(resourcePreview: IResourcePreview): IResourcePreview {
	return {
		localResource: resourcePreview.localResource,
		previewResource: resourcePreview.previewResource,
		remoteResource: resourcePreview.remoteResource,
		acceptedResource: resourcePreview.acceptedResource,
		localChange: resourcePreview.localChange,
		remoteChange: resourcePreview.remoteChange,
		mergeState: resourcePreview.mergeState,
	};
}
