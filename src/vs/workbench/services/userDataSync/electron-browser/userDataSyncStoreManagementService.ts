/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUserDataSyncStoreManagementService, UserDataSyncStoreType, IUserDataSyncStore } from 'vs/platform/userDataSync/common/userDataSync';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { AbstractUserDataSyncStoreManagementService } from 'vs/platform/userDataSync/common/userDataSyncStoreService';
import { IProductService } from 'vs/platform/product/common/productService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { URI } from 'vs/base/common/uri';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

class UserDataSyncStoreManagementService extends AbstractUserDataSyncStoreManagementService implements IUserDataSyncStoreManagementService {

	private readonly channel: IChannel;

	constructor(
		@IProductService productService: IProductService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@ISharedProcessService sharedProcessService: ISharedProcessService,
	) {
		super(productService, configurationService, storageService);
		this.channel = sharedProcessService.getChannel('userDataSyncStoreManagement');
	}

	async switch(type: UserDataSyncStoreType): Promise<void> {
		return this.channel.call('switch', [type]);
	}

	async getPreviousUserDataSyncStore(): Promise<IUserDataSyncStore> {
		const userDataSyncStore = await this.channel.call<IUserDataSyncStore>('getPreviousUserDataSyncStore');
		return this.revive(userDataSyncStore);
	}

	private revive(userDataSyncStore: IUserDataSyncStore): IUserDataSyncStore {
		return {
			url: URI.revive(userDataSyncStore.url),
			defaultUrl: URI.revive(userDataSyncStore.defaultUrl),
			insidersUrl: URI.revive(userDataSyncStore.insidersUrl),
			stableUrl: URI.revive(userDataSyncStore.stableUrl),
			authenticationProviders: userDataSyncStore.authenticationProviders,
		};
	}

}

registerSingleton(IUserDataSyncStoreManagementService, UserDataSyncStoreManagementService);
