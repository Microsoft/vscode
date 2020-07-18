/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { StorageKeysSyncRegistryChannelClient } from 'vs/platform/userDataSync/common/userDataSyncIpc';

class StorageKeysSyncRegistryService extends StorageKeysSyncRegistryChannelClient implements IStorageKeysSyncRegistryService {

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService
	) {
		super(mainProcessService.getChannel('storageKeysSyncRegistryService'));
	}
}

registerSingleton(IStorageKeysSyncRegistryService, StorageKeysSyncRegistryService);
