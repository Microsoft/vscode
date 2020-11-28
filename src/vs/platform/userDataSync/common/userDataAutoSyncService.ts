/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Delayer, disposableTimeout, CancelablePromise, createCancelablePromise, timeout } from 'vs/base/common/async';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable, toDisposable, MutableDisposable, IDisposable } from 'vs/base/common/lifecycle';
import { IUserDataSyncLogService, IUserDataSyncService, IUserDataAutoSyncService, UserDataSyncError, UserDataSyncErrorCode, IUserDataSyncResourceEnablementService, IUserDataSyncStoreService, UserDataAutoSyncError, ISyncTask, IUserDataSyncStoreManagementService, IUserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { IUserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IStorageService, StorageScope, IStorageValueChangeEvent, StorageTarget } from 'vs/platform/storage/common/storage';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IUserDataSyncMachinesService } from 'vs/platform/userDataSync/common/userDataSyncMachines';
import { localize } from 'vs/nls';
import { toLocalISOString } from 'vs/base/common/date';
import { URI } from 'vs/base/common/uri';
import { isEqual } from 'vs/base/common/resources';

type AutoSyncClassification = {
	sources: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

type AutoSyncEnablementClassification = {
	enabled?: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

type AutoSyncErrorClassification = {
	code: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	service: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

const enablementKey = 'sync.enable';
const disableMachineEventuallyKey = 'sync.disableMachineEventually';
const sessionIdKey = 'sync.sessionId';
const storeUrlKey = 'sync.storeUrl';

interface _IUserDataAutoSyncEnablementService extends IUserDataAutoSyncEnablementService {
	canToggleEnablement(): boolean;
	setEnablement(enabled: boolean): void;
}

export class UserDataAutoSyncEnablementService extends Disposable implements _IUserDataAutoSyncEnablementService {

	_serviceBrand: any;

	private _onDidChangeEnablement = new Emitter<boolean>();
	readonly onDidChangeEnablement: Event<boolean> = this._onDidChangeEnablement.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IEnvironmentService protected readonly environmentService: IEnvironmentService,
		@IUserDataSyncStoreManagementService private readonly userDataSyncStoreManagementService: IUserDataSyncStoreManagementService,
	) {
		super();
		this._register(storageService.onDidChangeValue(e => this.onDidStorageChange(e)));
	}

	isEnabled(defaultEnablement?: boolean): boolean {
		switch (this.environmentService.sync) {
			case 'on':
				return true;
			case 'off':
				return false;
		}
		return this.storageService.getBoolean(enablementKey, StorageScope.GLOBAL, !!defaultEnablement);
	}

	canToggleEnablement(): boolean {
		return this.userDataSyncStoreManagementService.userDataSyncStore !== undefined && this.environmentService.sync === undefined;
	}

	setEnablement(enabled: boolean): void {
		this.storageService.store(enablementKey, enabled, StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	private onDidStorageChange(storageChangeEvent: IStorageValueChangeEvent): void {
		if (storageChangeEvent.scope !== StorageScope.GLOBAL) {
			return;
		}

		if (enablementKey === storageChangeEvent.key) {
			this._onDidChangeEnablement.fire(this.isEnabled());
			return;
		}
	}

}

export class UserDataAutoSyncService extends Disposable implements IUserDataAutoSyncService {

	_serviceBrand: any;

	private readonly userDataAutoSyncEnablementService: _IUserDataAutoSyncEnablementService;

	private readonly autoSync = this._register(new MutableDisposable<AutoSync>());
	private successiveFailures: number = 0;
	private lastSyncTriggerTime: number | undefined = undefined;
	private readonly syncTriggerDelayer: Delayer<void>;

	private readonly _onError: Emitter<UserDataSyncError> = this._register(new Emitter<UserDataSyncError>());
	readonly onError: Event<UserDataSyncError> = this._onError.event;

	private lastSyncUrl: URI | undefined;
	private get syncUrl(): URI | undefined {
		const value = this.storageService.get(storeUrlKey, StorageScope.GLOBAL);
		return value ? URI.parse(value) : undefined;
	}
	private set syncUrl(syncUrl: URI | undefined) {
		if (syncUrl) {
			this.storageService.store(storeUrlKey, syncUrl.toString(), StorageScope.GLOBAL, StorageTarget.MACHINE);
		} else {
			this.storageService.remove(storeUrlKey, StorageScope.GLOBAL);
		}
	}

	constructor(
		@IUserDataSyncStoreManagementService private readonly userDataSyncStoreManagementService: IUserDataSyncStoreManagementService,
		@IUserDataSyncStoreService private readonly userDataSyncStoreService: IUserDataSyncStoreService,
		@IUserDataSyncResourceEnablementService private readonly userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IUserDataSyncLogService private readonly logService: IUserDataSyncLogService,
		@IUserDataSyncAccountService private readonly userDataSyncAccountService: IUserDataSyncAccountService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IUserDataSyncMachinesService private readonly userDataSyncMachinesService: IUserDataSyncMachinesService,
		@IStorageService private readonly storageService: IStorageService,
		@IUserDataAutoSyncEnablementService userDataAutoSyncEnablementService: IUserDataAutoSyncEnablementService
	) {
		super();
		this.userDataAutoSyncEnablementService = userDataAutoSyncEnablementService as _IUserDataAutoSyncEnablementService;
		this.syncTriggerDelayer = this._register(new Delayer<void>(0));

		this.lastSyncUrl = this.syncUrl;
		this.syncUrl = userDataSyncStoreManagementService.userDataSyncStore?.url;

		if (this.syncUrl) {

			this.logService.info('Using settings sync service', this.syncUrl.toString());
			this._register(userDataSyncStoreManagementService.onDidChangeUserDataSyncStore(() => {
				if (!isEqual(this.syncUrl, userDataSyncStoreManagementService.userDataSyncStore?.url)) {
					this.lastSyncUrl = this.syncUrl;
					this.syncUrl = userDataSyncStoreManagementService.userDataSyncStore?.url;
					if (this.syncUrl) {
						this.logService.info('Using settings sync service', this.syncUrl.toString());
					}
				}
			}));

			if (this.userDataAutoSyncEnablementService.isEnabled()) {
				this.logService.info('Auto Sync is enabled.');
			} else {
				this.logService.info('Auto Sync is disabled.');
			}
			this.updateAutoSync();

			if (this.hasToDisableMachineEventually()) {
				this.disableMachineEventually();
			}

			this._register(userDataSyncAccountService.onDidChangeAccount(() => this.updateAutoSync()));
			this._register(userDataSyncStoreService.onDidChangeDonotMakeRequestsUntil(() => this.updateAutoSync()));
			this._register(Event.debounce<string, string[]>(userDataSyncService.onDidChangeLocal, (last, source) => last ? [...last, source] : [source], 1000)(sources => this.triggerSync(sources, false, false)));
			this._register(Event.filter(this.userDataSyncResourceEnablementService.onDidChangeResourceEnablement, ([, enabled]) => enabled)(() => this.triggerSync(['resourceEnablement'], false, false)));
		}
	}

	private updateAutoSync(): void {
		const { enabled, message } = this.isAutoSyncEnabled();
		if (enabled) {
			if (this.autoSync.value === undefined) {
				this.autoSync.value = new AutoSync(this.lastSyncUrl, 1000 * 60 * 5 /* 5 miutes */, this.userDataSyncStoreManagementService, this.userDataSyncStoreService, this.userDataSyncService, this.userDataSyncMachinesService, this.logService, this.storageService);
				this.autoSync.value.register(this.autoSync.value.onDidStartSync(() => this.lastSyncTriggerTime = new Date().getTime()));
				this.autoSync.value.register(this.autoSync.value.onDidFinishSync(e => this.onDidFinishSync(e)));
				if (this.startAutoSync()) {
					this.autoSync.value.start();
				}
			}
		} else {
			this.syncTriggerDelayer.cancel();
			if (this.autoSync.value !== undefined) {
				if (message) {
					this.logService.info(message);
				}
				this.autoSync.clear();
			}

			/* log message when auto sync is not disabled by user */
			else if (message && this.userDataAutoSyncEnablementService.isEnabled()) {
				this.logService.info(message);
			}
		}
	}

	// For tests purpose only
	protected startAutoSync(): boolean { return true; }

	private isAutoSyncEnabled(): { enabled: boolean, message?: string } {
		if (!this.userDataAutoSyncEnablementService.isEnabled()) {
			return { enabled: false, message: 'Auto Sync: Disabled.' };
		}
		if (!this.userDataSyncAccountService.account) {
			return { enabled: false, message: 'Auto Sync: Suspended until auth token is available.' };
		}
		if (this.userDataSyncStoreService.donotMakeRequestsUntil) {
			return { enabled: false, message: `Auto Sync: Suspended until ${toLocalISOString(this.userDataSyncStoreService.donotMakeRequestsUntil)} because server is not accepting requests until then.` };
		}
		return { enabled: true };
	}

	async turnOn(): Promise<void> {
		this.stopDisableMachineEventually();
		this.lastSyncUrl = this.syncUrl;
		this.updateEnablement(true);
	}

	async turnOff(everywhere: boolean, softTurnOffOnError?: boolean, donotRemoveMachine?: boolean): Promise<void> {
		try {

			// Remove machine
			if (this.userDataSyncAccountService.account && !donotRemoveMachine) {
				await this.userDataSyncMachinesService.removeCurrentMachine();
			}

			// Disable Auto Sync
			this.updateEnablement(false);

			// Reset Session
			this.storageService.remove(sessionIdKey, StorageScope.GLOBAL);

			// Reset
			if (everywhere) {
				this.telemetryService.publicLog2('sync/turnOffEveryWhere');
				await this.userDataSyncService.reset();
			} else {
				await this.userDataSyncService.resetLocal();
			}
		} catch (error) {
			if (softTurnOffOnError) {
				this.logService.error(error);
				this.updateEnablement(false);
			} else {
				throw error;
			}
		}
	}

	private updateEnablement(enabled: boolean): void {
		if (this.userDataAutoSyncEnablementService.isEnabled() !== enabled) {
			this.telemetryService.publicLog2<{ enabled: boolean }, AutoSyncEnablementClassification>(enablementKey, { enabled });
			this.userDataAutoSyncEnablementService.setEnablement(enabled);
			this.updateAutoSync();
		}
	}

	private async onDidFinishSync(error: Error | undefined): Promise<void> {
		if (!error) {
			// Sync finished without errors
			this.successiveFailures = 0;
			return;
		}

		// Error while syncing
		const userDataSyncError = UserDataSyncError.toUserDataSyncError(error);

		// Log to telemetry
		if (userDataSyncError instanceof UserDataAutoSyncError) {
			this.telemetryService.publicLog2<{ code: string, service: string }, AutoSyncErrorClassification>(`autosync/error`, { code: userDataSyncError.code, service: this.userDataSyncStoreManagementService.userDataSyncStore!.url.toString() });
		}

		// Session got expired
		if (userDataSyncError.code === UserDataSyncErrorCode.SessionExpired) {
			await this.turnOff(false, true /* force soft turnoff on error */);
			this.logService.info('Auto Sync: Turned off sync because current session is expired');
		}

		// Turned off from another device
		else if (userDataSyncError.code === UserDataSyncErrorCode.TurnedOff) {
			await this.turnOff(false, true /* force soft turnoff on error */);
			this.logService.info('Auto Sync: Turned off sync because sync is turned off in the cloud');
		}

		// Exceeded Rate Limit
		else if (userDataSyncError.code === UserDataSyncErrorCode.LocalTooManyRequests || userDataSyncError.code === UserDataSyncErrorCode.TooManyRequests) {
			await this.turnOff(false, true /* force soft turnoff on error */,
				true /* do not disable machine because disabling a machine makes request to server and can fail with TooManyRequests */);
			this.disableMachineEventually();
			this.logService.info('Auto Sync: Turned off sync because of making too many requests to server');
		}

		// Upgrade Required or Gone
		else if (userDataSyncError.code === UserDataSyncErrorCode.UpgradeRequired || userDataSyncError.code === UserDataSyncErrorCode.Gone) {
			await this.turnOff(false, true /* force soft turnoff on error */,
				true /* do not disable machine because disabling a machine makes request to server and can fail with upgrade required or gone */);
			this.disableMachineEventually();
			this.logService.info('Auto Sync: Turned off sync because current client is not compatible with server. Requires client upgrade.');
		}

		// Incompatible Local Content
		else if (userDataSyncError.code === UserDataSyncErrorCode.IncompatibleLocalContent) {
			await this.turnOff(false, true /* force soft turnoff on error */);
			this.logService.info(`Auto Sync: Turned off sync because server has ${userDataSyncError.resource} content with newer version than of client. Requires client upgrade.`);
		}

		// Incompatible Remote Content
		else if (userDataSyncError.code === UserDataSyncErrorCode.IncompatibleRemoteContent) {
			await this.turnOff(false, true /* force soft turnoff on error */);
			this.logService.info(`Auto Sync: Turned off sync because server has ${userDataSyncError.resource} content with older version than of client. Requires server reset.`);
		}

		// Service changed
		else if (userDataSyncError.code === UserDataSyncErrorCode.ServiceChanged || userDataSyncError.code === UserDataSyncErrorCode.DefaultServiceChanged) {
			await this.turnOff(false, true /* force soft turnoff on error */, true /* do not disable machine */);
			await this.turnOn();
			this.logService.info('Auto Sync: Sync Service changed. Turned off auto sync, reset local state and turned on auto sync.');
		}

		else {
			this.logService.error(userDataSyncError);
			this.successiveFailures++;
		}

		this._onError.fire(userDataSyncError);
	}

	private async disableMachineEventually(): Promise<void> {
		this.storageService.store(disableMachineEventuallyKey, true, StorageScope.GLOBAL, StorageTarget.MACHINE);
		await timeout(1000 * 60 * 10);

		// Return if got stopped meanwhile.
		if (!this.hasToDisableMachineEventually()) {
			return;
		}

		this.stopDisableMachineEventually();

		// disable only if sync is disabled
		if (!this.userDataAutoSyncEnablementService.isEnabled() && this.userDataSyncAccountService.account) {
			await this.userDataSyncMachinesService.removeCurrentMachine();
		}
	}

	private hasToDisableMachineEventually(): boolean {
		return this.storageService.getBoolean(disableMachineEventuallyKey, StorageScope.GLOBAL, false);
	}

	private stopDisableMachineEventually(): void {
		this.storageService.remove(disableMachineEventuallyKey, StorageScope.GLOBAL);
	}

	private sources: string[] = [];
	async triggerSync(sources: string[], skipIfSyncedRecently: boolean, disableCache: boolean): Promise<void> {
		if (this.autoSync.value === undefined) {
			return this.syncTriggerDelayer.cancel();
		}

		if (skipIfSyncedRecently && this.lastSyncTriggerTime
			&& Math.round((new Date().getTime() - this.lastSyncTriggerTime) / 1000) < 10) {
			this.logService.debug('Auto Sync: Skipped. Limited to once per 10 seconds.');
			return;
		}

		this.sources.push(...sources);
		return this.syncTriggerDelayer.trigger(async () => {
			this.logService.trace('activity sources', ...this.sources);
			this.telemetryService.publicLog2<{ sources: string[] }, AutoSyncClassification>('sync/triggered', { sources: this.sources });
			this.sources = [];
			if (this.autoSync.value) {
				await this.autoSync.value.sync('Activity', disableCache);
			}
		}, this.successiveFailures
			? this.getSyncTriggerDelayTime() * 1 * Math.min(Math.pow(2, this.successiveFailures), 60) /* Delay exponentially until max 1 minute */
			: this.getSyncTriggerDelayTime());

	}

	protected getSyncTriggerDelayTime(): number {
		return 1000; /* Debounce for a second if there are no failures */
	}

}

class AutoSync extends Disposable {

	private static readonly INTERVAL_SYNCING = 'Interval';

	private readonly intervalHandler = this._register(new MutableDisposable<IDisposable>());

	private readonly _onDidStartSync = this._register(new Emitter<void>());
	readonly onDidStartSync = this._onDidStartSync.event;

	private readonly _onDidFinishSync = this._register(new Emitter<Error | undefined>());
	readonly onDidFinishSync = this._onDidFinishSync.event;

	private syncTask: ISyncTask | undefined;
	private syncPromise: CancelablePromise<void> | undefined;

	constructor(
		private readonly lastSyncUrl: URI | undefined,
		private readonly interval: number /* in milliseconds */,
		private readonly userDataSyncStoreManagementService: IUserDataSyncStoreManagementService,
		private readonly userDataSyncStoreService: IUserDataSyncStoreService,
		private readonly userDataSyncService: IUserDataSyncService,
		private readonly userDataSyncMachinesService: IUserDataSyncMachinesService,
		private readonly logService: IUserDataSyncLogService,
		private readonly storageService: IStorageService,
	) {
		super();
	}

	start(): void {
		this._register(this.onDidFinishSync(() => this.waitUntilNextIntervalAndSync()));
		this._register(toDisposable(() => {
			if (this.syncPromise) {
				this.syncPromise.cancel();
				this.logService.info('Auto sync: Cancelled sync that is in progress');
				this.syncPromise = undefined;
			}
			if (this.syncTask) {
				this.syncTask.stop();
			}
			this.logService.info('Auto Sync: Stopped');
		}));
		this.logService.info('Auto Sync: Started');
		this.sync(AutoSync.INTERVAL_SYNCING, false);
	}

	private waitUntilNextIntervalAndSync(): void {
		this.intervalHandler.value = disposableTimeout(() => this.sync(AutoSync.INTERVAL_SYNCING, false), this.interval);
	}

	sync(reason: string, disableCache: boolean): Promise<void> {
		const syncPromise = createCancelablePromise(async token => {
			if (this.syncPromise) {
				try {
					// Wait until existing sync is finished
					this.logService.debug('Auto Sync: Waiting until sync is finished.');
					await this.syncPromise;
				} catch (error) {
					if (isPromiseCanceledError(error)) {
						// Cancelled => Disposed. Donot continue sync.
						return;
					}
				}
			}
			return this.doSync(reason, disableCache, token);
		});
		this.syncPromise = syncPromise;
		this.syncPromise.finally(() => this.syncPromise = undefined);
		return this.syncPromise;
	}

	private hasSyncServiceChanged(): boolean {
		return this.lastSyncUrl !== undefined && !isEqual(this.lastSyncUrl, this.userDataSyncStoreManagementService.userDataSyncStore?.url);
	}

	private async hasDefaultServiceChanged(): Promise<boolean> {
		const previous = await this.userDataSyncStoreManagementService.getPreviousUserDataSyncStore();
		const current = this.userDataSyncStoreManagementService.userDataSyncStore;
		// check if defaults changed
		return !!current && !!previous &&
			(!isEqual(current.defaultUrl, previous.defaultUrl) ||
				!isEqual(current.insidersUrl, previous.insidersUrl) ||
				!isEqual(current.stableUrl, previous.stableUrl));
	}

	private async doSync(reason: string, disableCache: boolean, token: CancellationToken): Promise<void> {
		this.logService.info(`Auto Sync: Triggered by ${reason}`);
		this._onDidStartSync.fire();
		let error: Error | undefined;
		try {
			this.syncTask = await this.userDataSyncService.createSyncTask(disableCache);
			if (token.isCancellationRequested) {
				return;
			}
			let manifest = this.syncTask.manifest;

			// Server has no data but this machine was synced before
			if (manifest === null && await this.userDataSyncService.hasPreviouslySynced()) {
				if (this.hasSyncServiceChanged()) {
					if (await this.hasDefaultServiceChanged()) {
						throw new UserDataAutoSyncError(localize('default service changed', "Cannot sync because default service has changed"), UserDataSyncErrorCode.DefaultServiceChanged);
					} else {
						throw new UserDataAutoSyncError(localize('service changed', "Cannot sync because sync service has changed"), UserDataSyncErrorCode.ServiceChanged);
					}
				} else {
					// Sync was turned off in the cloud
					throw new UserDataAutoSyncError(localize('turned off', "Cannot sync because syncing is turned off in the cloud"), UserDataSyncErrorCode.TurnedOff);
				}
			}

			const sessionId = this.storageService.get(sessionIdKey, StorageScope.GLOBAL);
			// Server session is different from client session
			if (sessionId && manifest && sessionId !== manifest.session) {
				if (this.hasSyncServiceChanged()) {
					if (await this.hasDefaultServiceChanged()) {
						throw new UserDataAutoSyncError(localize('default service changed', "Cannot sync because default service has changed"), UserDataSyncErrorCode.DefaultServiceChanged);
					} else {
						throw new UserDataAutoSyncError(localize('service changed', "Cannot sync because sync service has changed"), UserDataSyncErrorCode.ServiceChanged);
					}
				} else {
					throw new UserDataAutoSyncError(localize('session expired', "Cannot sync because current session is expired"), UserDataSyncErrorCode.SessionExpired);
				}
			}

			const machines = await this.userDataSyncMachinesService.getMachines(manifest || undefined);
			// Return if cancellation is requested
			if (token.isCancellationRequested) {
				return;
			}

			const currentMachine = machines.find(machine => machine.isCurrent);
			// Check if sync was turned off from other machine
			if (currentMachine?.disabled) {
				// Throw TurnedOff error
				throw new UserDataAutoSyncError(localize('turned off machine', "Cannot sync because syncing is turned off on this machine from another machine."), UserDataSyncErrorCode.TurnedOff);
			}

			await this.syncTask.run();

			// After syncing, get the manifest if it was not available before
			if (manifest === null) {
				manifest = await this.userDataSyncStoreService.manifest();
			}

			// Update local session id
			if (manifest && manifest.session !== sessionId) {
				this.storageService.store(sessionIdKey, manifest.session, StorageScope.GLOBAL, StorageTarget.MACHINE);
			}

			// Return if cancellation is requested
			if (token.isCancellationRequested) {
				return;
			}

			// Add current machine
			if (!currentMachine) {
				await this.userDataSyncMachinesService.addCurrentMachine(manifest || undefined);
			}

		} catch (e) {
			this.logService.error(e);
			error = e;
		}

		this._onDidFinishSync.fire(error);
	}

	register<T extends IDisposable>(t: T): T {
		return super._register(t);
	}

}
