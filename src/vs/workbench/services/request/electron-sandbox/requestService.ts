/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { RequestService } from 'vs/platform/request/browser/requestService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IRequestService } from 'vs/platform/request/common/request';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';

export class NativeRequestService extends RequestService {

	constructor(
		@IConfigurationService configurationService: IConfigurationService,
		@ILogService logService: ILogService,
		@IElectronService private electronService: IElectronService
	) {
		super(configurationService, logService);
	}

	async resolveProxy(url: string): Promise<string | undefined> {
		return this.electronService.resolveProxy(url);
	}
}

registerSingleton(IRequestService, NativeRequestService, true);
