/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel, IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { Event, Emitter } from 'vs/base/common/event';
import { timeout } from 'vs/base/common/async';

export interface IMarcoPoloEvent {
	answer: string;
}

export interface ITestService {
	onMarco: Event<IMarcoPoloEvent>;
	marco(): Promise<string>;
	pong(ping: string): Promise<{ incoming: string, outgoing: string }>;
	cancelMe(): Promise<boolean>;
}

export class TestService implements ITestService {

	private readonly _onMarco = new Emitter<IMarcoPoloEvent>();
	onMarco: Event<IMarcoPoloEvent> = this._onMarco.event;

	marco(): Promise<string> {
		this._onMarco.fire({ answer: 'polo' });
		return Promise.resolve('polo');
	}

	pong(ping: string): Promise<{ incoming: string, outgoing: string }> {
		return Promise.resolve({ incoming: ping, outgoing: 'pong' });
	}

	cancelMe(): Promise<boolean> {
		return Promise.resolve(timeout(100)).then(() => true);
	}
}

export class TestChannel implements IServerChannel {

	constructor(private testService: ITestService) { }

	listen(_: unknown, event: string): Event<any> {
		switch (event) {
			case 'marco': return this.testService.onMarco;
		}

		throw new Error('Event not found');
	}

	call(_: unknown, command: string, ...args: any[]): Promise<any> {
		switch (command) {
			case 'pong': return this.testService.pong(args[0]);
			case 'cancelMe': return this.testService.cancelMe();
			case 'marco': return this.testService.marco();
			default: return Promise.reject(new Error(`command not found: ${command}`));
		}
	}
}

export class TestServiceClient implements ITestService {

	get onMarco(): Event<IMarcoPoloEvent> { return this.channel.listen('marco'); }

	constructor(private channel: IChannel) { }

	marco(): Promise<string> {
		return this.channel.call('marco');
	}

	pong(ping: string): Promise<{ incoming: string, outgoing: string }> {
		return this.channel.call('pong', ping);
	}

	cancelMe(): Promise<boolean> {
		return this.channel.call('cancelMe');
	}
}
