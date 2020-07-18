/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from 'vs/base/common/platform';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { IDiagnosticInfoOptions, IDiagnosticInfo } from 'vs/platform/diagnostics/common/diagnostics';
import { ITelemetryData } from 'vs/platform/telemetry/common/telemetry';

export interface IGetEnvironmentDataArguments {
	language: string;
	remoteAuthority: string;
	extensionDevelopmentPath: UriComponents[] | undefined;
}

export interface IRemoteAgentEnvironmentDTO {
	pid: number;
	connectionToken: string;
	appRoot: UriComponents;
	settingsPath: UriComponents;
	logsPath: UriComponents;
	extensionsPath: UriComponents;
	extensionHostLogsPath: UriComponents;
	globalStorageHome: UriComponents;
	workspaceStorageHome: UriComponents;
	userHome: UriComponents;
	extensions: IExtensionDescription[];
	os: platform.OperatingSystem;
}

export class RemoteExtensionEnvironmentChannelClient {

	static async getEnvironmentData(channel: IChannel, remoteAuthority: string, extensionDevelopmentPath?: URI[]): Promise<IRemoteAgentEnvironment> {
		const args: IGetEnvironmentDataArguments = {
			language: platform.language,
			remoteAuthority,
			extensionDevelopmentPath
		};

		const data = await channel.call<IRemoteAgentEnvironmentDTO>('getEnvironmentData', args);

		return {
			pid: data.pid,
			connectionToken: data.connectionToken,
			appRoot: URI.revive(data.appRoot),
			settingsPath: URI.revive(data.settingsPath),
			logsPath: URI.revive(data.logsPath),
			extensionsPath: URI.revive(data.extensionsPath),
			extensionHostLogsPath: URI.revive(data.extensionHostLogsPath),
			globalStorageHome: URI.revive(data.globalStorageHome),
			workspaceStorageHome: URI.revive(data.workspaceStorageHome),
			userHome: URI.revive(data.userHome),
			extensions: data.extensions.map(ext => { (<any>ext).extensionLocation = URI.revive(ext.extensionLocation); return ext; }),
			os: data.os
		};
	}

	static getDiagnosticInfo(channel: IChannel, options: IDiagnosticInfoOptions): Promise<IDiagnosticInfo> {
		return channel.call<IDiagnosticInfo>('getDiagnosticInfo', options);
	}

	static disableTelemetry(channel: IChannel): Promise<void> {
		return channel.call<void>('disableTelemetry');
	}

	static logTelemetry(channel: IChannel, eventName: string, data: ITelemetryData): Promise<void> {
		return channel.call<void>('logTelemetry', { eventName, data });
	}

	static flushTelemetry(channel: IChannel): Promise<void> {
		return channel.call<void>('flushTelemetry');
	}
}
