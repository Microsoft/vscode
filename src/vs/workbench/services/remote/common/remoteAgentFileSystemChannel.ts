/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OperatingSystem } from 'vs/base/common/platform';
import { IPCFileSystemProvider } from 'vs/platform/files/common/ipcFileSystemProvider';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';

export const REMOTE_FILE_SYSTEM_CHANNEL_NAME = 'remotefilesystem';

export class RemoteFileSystemProvider extends IPCFileSystemProvider {

	constructor(remoteAgentService: IRemoteAgentService) {
		super(remoteAgentService.getConnection()!.getChannel(REMOTE_FILE_SYSTEM_CHANNEL_NAME));

		// Initially assume case sensitivity until remote environment is resolved
		this.setCaseSensitive(true);
		(async () => {
			const remoteAgentEnvironment = await remoteAgentService.getEnvironment();
			this.setCaseSensitive(remoteAgentEnvironment?.os === OperatingSystem.Linux);
		})();
	}
}
