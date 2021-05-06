/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServerChannel, IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IReloadSessionEvent, ICloseSessionEvent, IAttachSessionEvent, ITerminateSessionEvent, IExtensionHostDebugService, IOpenExtensionWindowResult, INullableProcessEnvironment } from 'vs/platform/debug/common/extensionHostDebug';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';

export class ExtensionHostDebugBroadcastChannel<TContext> implements IServerChannel<TContext> {

	static readonly ChannelName = 'extensionhostdebugservice';

	private readonly _onCloseEmitter = new Emitter<ICloseSessionEvent>();
	private readonly _onReloadEmitter = new Emitter<IReloadSessionEvent>();
	private readonly _onTerminateEmitter = new Emitter<ITerminateSessionEvent>();
	private readonly _onAttachEmitter = new Emitter<IAttachSessionEvent>();

	call(ctx: TContext, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'close':
				return Promise.resolve(this._onCloseEmitter.fire({ sessionId: arg[0] }));
			case 'reload':
				return Promise.resolve(this._onReloadEmitter.fire({ sessionId: arg[0] }));
			case 'terminate':
				return Promise.resolve(this._onTerminateEmitter.fire({ sessionId: arg[0] }));
			case 'attach':
				return Promise.resolve(this._onAttachEmitter.fire({ sessionId: arg[0], port: arg[1], subId: arg[2] }));
		}
		throw new Error('Method not implemented.');
	}

	listen(ctx: TContext, event: string, arg?: any): Event<any> {
		switch (event) {
			case 'close':
				return this._onCloseEmitter.event;
			case 'reload':
				return this._onReloadEmitter.event;
			case 'terminate':
				return this._onTerminateEmitter.event;
			case 'attach':
				return this._onAttachEmitter.event;
		}
		throw new Error('Method not implemented.');
	}
}

export class ExtensionHostDebugChannelClient extends Disposable implements IExtensionHostDebugService {

	declare readonly _serviceBrand: undefined;

	constructor(private channel: IChannel) {
		super();
	}

	reload(sessionId: string): void {
		this.channel.call('reload', [sessionId]);
	}

	get onReload(): Event<IReloadSessionEvent> {
		return this.channel.listen('reload');
	}

	close(sessionId: string): void {
		this.channel.call('close', [sessionId]);
	}

	get onClose(): Event<ICloseSessionEvent> {
		return this.channel.listen('close');
	}

	attachSession(sessionId: string, port: number, subId?: string): void {
		this.channel.call('attach', [sessionId, port, subId]);
	}

	get onAttachSession(): Event<IAttachSessionEvent> {
		return this.channel.listen('attach');
	}

	terminateSession(sessionId: string, subId?: string): void {
		this.channel.call('terminate', [sessionId, subId]);
	}

	get onTerminateSession(): Event<ITerminateSessionEvent> {
		return this.channel.listen('terminate');
	}

	openExtensionDevelopmentHostWindow(args: string[], env: INullableProcessEnvironment | undefined, debugRenderer: boolean): Promise<IOpenExtensionWindowResult> {
		return this.channel.call('openExtensionDevelopmentHostWindow', [args, env || {}, debugRenderer]);
	}
}
