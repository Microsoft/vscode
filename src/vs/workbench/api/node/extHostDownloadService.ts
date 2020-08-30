/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join } from 'vs/base/common/path';
import { tmpdir } from 'os';
import { generateUuid } from 'vs/base/common/uuid';
import { IExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { Disposable } from 'vs/base/common/lifecycle';
import { MainContext } from 'vs/workbench/api/common/extHost.protocol';
import { URI } from 'vs/base/common/uri';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';

export class ExtHostDownloadService extends Disposable {

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostCommands commands: IExtHostCommands
	) {
		super();

		const proxy = extHostRpc.getProxy(MainContext.MainThreadDownloadService);

		commands.registerCommand(false, '_workbench.downloadResource', async (resource: URI): Promise<any> => {
			const location = URI.file(join(tmpdir(), generateUuid()));
			await proxy.$download(resource, location);
			return location;
		});
	}
}
