/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createChannelSender } from 'vs/base/parts/ipc/common/ipc';
import { ILocalizationsService } from 'vs/platform/localizations/common/localizations';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

export class LocalizationsService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@ISharedProcessService sharedProcessService: ISharedProcessService,
	) {
		return createChannelSender<ILocalizationsService>(sharedProcessService.getChannel('localizations'));
	}
}

registerSingleton(ILocalizationsService, LocalizationsService, true);
