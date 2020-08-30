/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUserDataAutoSyncService, UserDataSyncError, IUserDataSyncStoreManagementService } from 'vs/platform/userDataSync/common/userDataSync';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { Event } from 'vs/base/common/event';
import { UserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataAutoSyncService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

class UserDataAutoSyncService extends UserDataAutoSyncEnablementService implements IUserDataAutoSyncService {

	declare readonly _serviceBrand: undefined;

	private readonly channel: IChannel;
	get onError(): Event<UserDataSyncError> { return Event.map(this.channel.listen<Error>('onError'), e => UserDataSyncError.toUserDataSyncError(e)); }

	constructor(
		@IStorageService storageService: IStorageService,
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncStoreManagementService userDataSyncStoreManagementService: IUserDataSyncStoreManagementService,
		@ISharedProcessService sharedProcessService: ISharedProcessService,
	) {
		super(storageService, environmentService, userDataSyncStoreManagementService);
		this.channel = sharedProcessService.getChannel('userDataAutoSync');
	}

	triggerSync(sources: string[], hasToLimitSync: boolean, disableCache: boolean): Promise<void> {
		return this.channel.call('triggerSync', [sources, hasToLimitSync, disableCache]);
	}

	turnOn(): Promise<void> {
		return this.channel.call('turnOn');
	}

	turnOff(everywhere: boolean): Promise<void> {
		return this.channel.call('turnOff', [everywhere]);
	}

}

registerSingleton(IUserDataAutoSyncService, UserDataAutoSyncService);
