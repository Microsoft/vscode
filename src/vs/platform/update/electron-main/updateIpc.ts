/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { Event } from 'vs/base/common/event';
import { IUpdateService } from 'vs/platform/update/common/update';

export class UpdateChannel implements IServerChannel {

	constructor(private service: IUpdateService) { }

	listen(_: unknown, event: string): Event<any> {
		switch (event) {
			case 'onStateChange': return this.service.onStateChange;
		}

		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'checkForUpdates': return this.service.checkForUpdates(arg);
			case 'downloadUpdate': return this.service.downloadUpdate();
			case 'applyUpdate': return this.service.applyUpdate();
			case 'quitAndInstall': return this.service.quitAndInstall();
			case '_getInitialState': return Promise.resolve(this.service.state);
			case 'isLatestVersion': return this.service.isLatestVersion();
		}

		throw new Error(`Call not found: ${command}`);
	}
}
