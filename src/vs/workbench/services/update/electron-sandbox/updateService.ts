/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { Event, Emitter } from 'vs/base/common/event';
import { IUpdateService, State } from 'vs/platform/update/common/update';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

export class NativeUpdateService implements IUpdateService {

	declare readonly _serviceBrand: undefined;

	private readonly _onStateChange = new Emitter<State>();
	readonly onStateChange: Event<State> = this._onStateChange.event;

	private _state: State = State.Uninitialized;
	get state(): State { return this._state; }

	private channel: IChannel;

	constructor(@IMainProcessService mainProcessService: IMainProcessService) {
		this.channel = mainProcessService.getChannel('update');

		// always set this._state as the state changes
		this.onStateChange(state => this._state = state);

		this.channel.call<State>('_getInitialState').then(state => {
			// fire initial state
			this._onStateChange.fire(state);

			// fire subsequent states as they come in from remote

			this.channel.listen<State>('onStateChange')(state => this._onStateChange.fire(state));
		});
	}

	checkForUpdates(context: any): Promise<void> {
		return this.channel.call('checkForUpdates', context);
	}

	downloadUpdate(): Promise<void> {
		return this.channel.call('downloadUpdate');
	}

	applyUpdate(): Promise<void> {
		return this.channel.call('applyUpdate');
	}

	quitAndInstall(): Promise<void> {
		return this.channel.call('quitAndInstall');
	}

	isLatestVersion(): Promise<boolean> {
		return this.channel.call('isLatestVersion');
	}
}

registerSingleton(IUpdateService, NativeUpdateService);
