/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { timeout } from 'vs/base/common/async';
import { ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { IUpdateService, State, StateType, AvailableForDownload, UpdateType } from 'vs/platform/update/common/update';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { ILogService } from 'vs/platform/log/common/log';
import * as path from 'vs/base/common/path';
import { realpath, watch } from 'fs';
import { spawn } from 'child_process';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { UpdateNotAvailableClassification } from 'vs/platform/update/electron-main/abstractUpdateService';

abstract class AbstractUpdateService implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	private _state: State = State.Uninitialized;

	private readonly _onStateChange = new Emitter<State>();
	readonly onStateChange: Event<State> = this._onStateChange.event;

	get state(): State {
		return this._state;
	}

	protected setState(state: State): void {
		this.logService.info('update#setState', state.type);
		this._state = state;
		this._onStateChange.fire(state);
	}

	constructor(
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@ILogService protected logService: ILogService,
	) {
		if (environmentMainService.disableUpdates) {
			this.logService.info('update#ctor - updates are disabled');
			return;
		}

		this.setState(State.Idle(this.getUpdateType()));

		// Start checking for updates after 30 seconds
		this.scheduleCheckForUpdates(30 * 1000).then(undefined, err => this.logService.error(err));
	}

	private scheduleCheckForUpdates(delay = 60 * 60 * 1000): Promise<void> {
		return timeout(delay)
			.then(() => this.checkForUpdates(false))
			.then(() => {
				// Check again after 1 hour
				return this.scheduleCheckForUpdates(60 * 60 * 1000);
			});
	}

	async checkForUpdates(explicit: boolean): Promise<void> {
		this.logService.trace('update#checkForUpdates, state = ', this.state.type);

		if (this.state.type !== StateType.Idle) {
			return;
		}

		this.doCheckForUpdates(explicit);
	}

	async downloadUpdate(): Promise<void> {
		this.logService.trace('update#downloadUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.AvailableForDownload) {
			return;
		}

		await this.doDownloadUpdate(this.state);
	}

	protected doDownloadUpdate(state: AvailableForDownload): Promise<void> {
		return Promise.resolve(undefined);
	}

	async applyUpdate(): Promise<void> {
		this.logService.trace('update#applyUpdate, state = ', this.state.type);

		if (this.state.type !== StateType.Downloaded) {
			return;
		}

		await this.doApplyUpdate();
	}

	protected doApplyUpdate(): Promise<void> {
		return Promise.resolve(undefined);
	}

	quitAndInstall(): Promise<void> {
		this.logService.trace('update#quitAndInstall, state = ', this.state.type);

		if (this.state.type !== StateType.Ready) {
			return Promise.resolve(undefined);
		}

		this.logService.trace('update#quitAndInstall(): before lifecycle quit()');

		this.lifecycleMainService.quit(true /* will restart */).then(vetod => {
			this.logService.trace(`update#quitAndInstall(): after lifecycle quit() with veto: ${vetod}`);
			if (vetod) {
				return;
			}

			this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');
			this.doQuitAndInstall();
		});

		return Promise.resolve(undefined);
	}


	protected getUpdateType(): UpdateType {
		return UpdateType.Snap;
	}

	protected doQuitAndInstall(): void {
		// noop
	}

	abstract isLatestVersion(): Promise<boolean | undefined>;
	protected abstract doCheckForUpdates(context: any): void;
}

export class SnapUpdateService extends AbstractUpdateService {

	constructor(
		private snap: string,
		private snapRevision: string,
		@ILifecycleMainService lifecycleMainService: ILifecycleMainService,
		@IEnvironmentMainService environmentMainService: IEnvironmentMainService,
		@ILogService logService: ILogService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		super(lifecycleMainService, environmentMainService, logService);

		const watcher = watch(path.dirname(this.snap));
		const onChange = Event.fromNodeEventEmitter(watcher, 'change', (_, fileName: string) => fileName);
		const onCurrentChange = Event.filter(onChange, n => n === 'current');
		const onDebouncedCurrentChange = Event.debounce(onCurrentChange, (_, e) => e, 2000);
		const listener = onDebouncedCurrentChange(() => this.checkForUpdates(false));

		lifecycleMainService.onWillShutdown(() => {
			listener.dispose();
			watcher.close();
		});
	}

	protected doCheckForUpdates(): void {
		this.setState(State.CheckingForUpdates(false));
		this.isUpdateAvailable().then(result => {
			if (result) {
				this.setState(State.Ready({ version: 'something', productVersion: 'something' }));
			} else {
				this.telemetryService.publicLog2<{ explicit: boolean }, UpdateNotAvailableClassification>('update:notAvailable', { explicit: false });

				this.setState(State.Idle(UpdateType.Snap));
			}
		}, err => {
			this.logService.error(err);
			this.telemetryService.publicLog2<{ explicit: boolean }, UpdateNotAvailableClassification>('update:notAvailable', { explicit: false });
			this.setState(State.Idle(UpdateType.Snap, err.message || err));
		});
	}

	protected override doQuitAndInstall(): void {
		this.logService.trace('update#quitAndInstall(): running raw#quitAndInstall()');

		// Allow 3 seconds for VS Code to close
		spawn('sleep 3 && ' + path.basename(process.argv[0]), {
			shell: true,
			detached: true,
			stdio: 'ignore',
		});
	}

	private async isUpdateAvailable(): Promise<boolean> {
		const resolvedCurrentSnapPath = await new Promise<string>((c, e) => realpath(`${path.dirname(this.snap)}/current`, (err, r) => err ? e(err) : c(r)));
		const currentRevision = path.basename(resolvedCurrentSnapPath);
		return this.snapRevision !== currentRevision;
	}

	isLatestVersion(): Promise<boolean | undefined> {
		return this.isUpdateAvailable().then(undefined, err => {
			this.logService.error('update#checkForSnapUpdate(): Could not get realpath of application.');
			return undefined;
		});
	}
}
