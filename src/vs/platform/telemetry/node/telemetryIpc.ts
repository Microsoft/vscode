/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel, IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { ITelemetryAppender } from 'vs/platform/telemetry/common/telemetryUtils';
import { Event } from 'vs/base/common/event';

export interface ITelemetryLog {
	eventName: string;
	data?: any;
}

export class TelemetryAppenderChannel implements IServerChannel {

	constructor(private appender: ITelemetryAppender) { }

	listen<T>(_: unknown, event: string): Event<T> {
		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, { eventName, data }: ITelemetryLog): Promise<any> {
		this.appender.log(eventName, data);
		return Promise.resolve(null);
	}
}

export class TelemetryAppenderClient implements ITelemetryAppender {

	constructor(private channel: IChannel) { }

	log(eventName: string, data?: any): any {
		this.channel.call('log', { eventName, data })
			.then(undefined, err => `Failed to log telemetry: ${console.warn(err)}`);

		return Promise.resolve(null);
	}

	flush(): Promise<void> {
		// TODO
		return Promise.resolve();
	}
}
