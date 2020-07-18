/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { Disposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { IUserDataSyncAccountService, IUserDataSyncAccount } from 'vs/platform/userDataSync/common/userDataSyncAccount';

export class UserDataSyncAccountService extends Disposable implements IUserDataSyncAccountService {

	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;

	private _account: IUserDataSyncAccount | undefined;
	get account(): IUserDataSyncAccount | undefined { return this._account; }

	get onTokenFailed(): Event<boolean> { return this.channel.listen<boolean>('onTokenFailed'); }

	private _onDidChangeAccount: Emitter<IUserDataSyncAccount | undefined> = this._register(new Emitter<IUserDataSyncAccount | undefined>());
	readonly onDidChangeAccount: Event<IUserDataSyncAccount | undefined> = this._onDidChangeAccount.event;

	constructor(
		@ISharedProcessService sharedProcessService: ISharedProcessService,
	) {
		super();
		this.channel = sharedProcessService.getChannel('userDataSyncAccount');
		this.channel.call<IUserDataSyncAccount | undefined>('_getInitialData').then(account => {
			this._account = account;
			this._register(this.channel.listen<IUserDataSyncAccount | undefined>('onDidChangeAccount')(account => {
				this._account = account;
				this._onDidChangeAccount.fire(account);
			}));
		});
	}

	updateAccount(account: IUserDataSyncAccount | undefined): Promise<undefined> {
		return this.channel.call('updateAccount', account);
	}

}

registerSingleton(IUserDataSyncAccountService, UserDataSyncAccountService);
