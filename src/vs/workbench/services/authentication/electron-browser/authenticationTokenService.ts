/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { IAuthenticationTokenService, IUserDataSyncAuthToken } from 'vs/platform/authentication/common/authentication';

export class AuthenticationTokenService extends Disposable implements IAuthenticationTokenService {

	_serviceBrand: undefined;

	private readonly channel: IChannel;
	private _onDidChangeToken = this._register(new Emitter<IUserDataSyncAuthToken | undefined>());
	readonly onDidChangeToken = this._onDidChangeToken.event;

	private _onTokenFailed: Emitter<void> = this._register(new Emitter<void>());
	readonly onTokenFailed: Event<void> = this._onTokenFailed.event;

	constructor(
		@ISharedProcessService sharedProcessService: ISharedProcessService,
	) {
		super();
		this.channel = sharedProcessService.getChannel('authToken');
		this._register(this.channel.listen<void[]>('onTokenFailed')(_ => this.sendTokenFailed()));
	}

	getToken(): Promise<IUserDataSyncAuthToken | undefined> {
		return this.channel.call('getToken');
	}

	setToken(token: IUserDataSyncAuthToken | undefined): Promise<undefined> {
		return this.channel.call('setToken', token);
	}

	sendTokenFailed(): void {
		this._onTokenFailed.fire();
	}
}

registerSingleton(IAuthenticationTokenService, AuthenticationTokenService);
