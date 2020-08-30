/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel, IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { IWatcherRequest, IWatcherService, IWatcherOptions } from './watcher';
import { Event } from 'vs/base/common/event';
import { IDiskFileChange, ILogMessage } from 'vs/platform/files/node/watcher/watcher';

export class WatcherChannel implements IServerChannel {

	constructor(private service: IWatcherService) { }

	listen(_: unknown, event: string, arg?: any): Event<any> {
		switch (event) {
			case 'watch': return this.service.watch(arg);
			case 'onLogMessage': return this.service.onLogMessage;
		}

		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'setRoots': return this.service.setRoots(arg);
			case 'setVerboseLogging': return this.service.setVerboseLogging(arg);
			case 'stop': return this.service.stop();
		}

		throw new Error(`Call not found: ${command}`);
	}
}

export class WatcherChannelClient implements IWatcherService {

	constructor(private channel: IChannel) { }

	watch(options: IWatcherOptions): Event<IDiskFileChange[]> {
		return this.channel.listen('watch', options);
	}

	setVerboseLogging(enable: boolean): Promise<void> {
		return this.channel.call('setVerboseLogging', enable);
	}

	get onLogMessage(): Event<ILogMessage> {
		return this.channel.listen('onLogMessage');
	}

	setRoots(roots: IWatcherRequest[]): Promise<void> {
		return this.channel.call('setRoots', roots);
	}

	stop(): Promise<void> {
		return this.channel.call('stop');
	}
}
