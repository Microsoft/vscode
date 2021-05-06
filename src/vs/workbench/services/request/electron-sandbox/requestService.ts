/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { RequestService } from 'vs/platform/request/browser/requestService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IRequestService } from 'vs/platform/request/common/request';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';

export class NativeRequestService extends RequestService {

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService,
		@INativeHostService private nativeHostService: INativeHostService
	) {
		super(configurationService, logService);
	}

	override async resolveProxy(url: string): Promise<string | undefined> {
		return this.nativeHostService.resolveProxy(url);
	}
}

registerSingleton(IRequestService, NativeRequestService, true);
