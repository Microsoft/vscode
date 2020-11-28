/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService } from 'vs/platform/files/common/files';
import { StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { isUUID, generateUuid } from 'vs/base/common/uuid';
import { VSBuffer } from 'vs/base/common/buffer';

export async function getServiceMachineId(environmentService: IEnvironmentService, fileService: IFileService, storageService: {
	get: (key: string, scope: StorageScope, fallbackValue?: string | undefined) => string | undefined,
	store: (key: string, value: string, scope: StorageScope, target: StorageTarget) => void
} | undefined): Promise<string> {
	let uuid: string | null = storageService ? storageService.get('storage.serviceMachineId', StorageScope.GLOBAL) || null : null;
	if (uuid) {
		return uuid;
	}
	try {
		const contents = await fileService.readFile(environmentService.serviceMachineIdResource);
		const value = contents.value.toString();
		uuid = isUUID(value) ? value : null;
	} catch (e) {
		uuid = null;
	}

	if (!uuid) {
		uuid = generateUuid();
		try {
			await fileService.writeFile(environmentService.serviceMachineIdResource, VSBuffer.fromString(uuid));
		} catch (error) {
			//noop
		}
	}
	if (storageService) {
		storageService.store('storage.serviceMachineId', uuid, StorageScope.GLOBAL, StorageTarget.MACHINE);
	}
	return uuid;
}
