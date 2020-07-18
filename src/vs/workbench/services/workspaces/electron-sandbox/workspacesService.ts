/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createChannelSender } from 'vs/base/parts/ipc/common/ipc';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';

export class NativeWorkspacesService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IMainProcessService mainProcessService: IMainProcessService,
		@IElectronService electronService: IElectronService
	) {
		return createChannelSender<IWorkspacesService>(mainProcessService.getChannel('workspaces'), { context: electronService.windowId });
	}
}

registerSingleton(IWorkspacesService, NativeWorkspacesService, true);
