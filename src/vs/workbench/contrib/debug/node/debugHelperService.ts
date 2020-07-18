/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDebugHelperService } from 'vs/workbench/contrib/debug/common/debug';
import { Client as TelemetryClient } from 'vs/base/parts/ipc/node/ipc.cp';
import { TelemetryAppenderClient } from 'vs/platform/telemetry/node/telemetryIpc';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { TelemetryService } from 'vs/platform/telemetry/common/telemetryService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { cleanRemoteAuthority } from 'vs/platform/telemetry/common/telemetryUtils';

export class NodeDebugHelperService implements IDebugHelperService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
	) { }


	createTelemetryService(configurationService: IConfigurationService, args: string[]): TelemetryService | undefined {

		const client = new TelemetryClient(
			getPathFromAmdModule(require, 'bootstrap-fork'),
			{
				serverName: 'Debug Telemetry',
				timeout: 1000 * 60 * 5,
				args: args,
				env: {
					ELECTRON_RUN_AS_NODE: 1,
					PIPE_LOGGING: 'true',
					AMD_ENTRYPOINT: 'vs/workbench/contrib/debug/node/telemetryApp'
				}
			}
		);

		const channel = client.getChannel('telemetryAppender');
		const appender = new TelemetryAppenderClient(channel);

		return new TelemetryService({
			appender,
			sendErrorTelemetry: cleanRemoteAuthority(this.environmentService.configuration.remoteAuthority) !== 'other'
		}, configurationService);
	}
}

registerSingleton(IDebugHelperService, NodeDebugHelperService, true);
