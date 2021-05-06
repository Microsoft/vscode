/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client as TelemetryClient } from 'vs/base/parts/ipc/node/ipc.cp';
import { TelemetryAppenderClient } from 'vs/platform/telemetry/common/telemetryIpc';
import { FileAccess } from 'vs/base/common/network';
import { TelemetryService } from 'vs/platform/telemetry/common/telemetryService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ICustomEndpointTelemetryService, ITelemetryData, ITelemetryEndpoint, ITelemetryService } from 'vs/platform/telemetry/common/telemetry';

export class CustomEndpointTelemetryService implements ICustomEndpointTelemetryService {
	declare readonly _serviceBrand: undefined;

	private customTelemetryServices = new Map<string, ITelemetryService>();

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) { }

	private async getCustomTelemetryService(endpoint: ITelemetryEndpoint): Promise<ITelemetryService> {
		if (!this.customTelemetryServices.has(endpoint.id)) {
			const { machineId, sessionId } = await this.telemetryService.getTelemetryInfo();
			const telemetryInfo: { [key: string]: string } = Object.create(null);
			telemetryInfo['common.vscodemachineid'] = machineId;
			telemetryInfo['common.vscodesessionid'] = sessionId;
			const args = [endpoint.id, JSON.stringify(telemetryInfo), endpoint.aiKey];
			const client = new TelemetryClient(
				FileAccess.asFileUri('bootstrap-fork', require).fsPath,
				{
					serverName: 'Debug Telemetry',
					timeout: 1000 * 60 * 5,
					args,
					env: {
						ELECTRON_RUN_AS_NODE: 1,
						VSCODE_PIPE_LOGGING: 'true',
						VSCODE_AMD_ENTRYPOINT: 'vs/workbench/contrib/debug/node/telemetryApp'
					}
				}
			);

			const channel = client.getChannel('telemetryAppender');
			const appender = new TelemetryAppenderClient(channel);

			this.customTelemetryServices.set(endpoint.id, new TelemetryService({
				appender,
				sendErrorTelemetry: endpoint.sendErrorTelemetry
			}, this.configurationService));
		}

		return this.customTelemetryServices.get(endpoint.id)!;
	}

	async publicLog(telemetryEndpoint: ITelemetryEndpoint, eventName: string, data?: ITelemetryData): Promise<void> {
		const customTelemetryService = await this.getCustomTelemetryService(telemetryEndpoint);
		await customTelemetryService.publicLog(eventName, data);
	}

	async publicLogError(telemetryEndpoint: ITelemetryEndpoint, errorEventName: string, data?: ITelemetryData): Promise<void> {
		const customTelemetryService = await this.getCustomTelemetryService(telemetryEndpoint);
		await customTelemetryService.publicLogError(errorEventName, data);
	}
}
