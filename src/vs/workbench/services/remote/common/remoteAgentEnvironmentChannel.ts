/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from 'vs/base/common/platform';
import * as performance from 'vs/base/common/performance';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IExtensionDescription, ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { IDiagnosticInfoOptions, IDiagnosticInfo } from 'vs/platform/diagnostics/common/diagnostics';
import { ITelemetryData } from 'vs/platform/telemetry/common/telemetry';

export interface IGetEnvironmentDataArguments {
	remoteAuthority: string;
}

export interface IScanExtensionsArguments {
	language: string;
	remoteAuthority: string;
	extensionDevelopmentPath: UriComponents[] | undefined;
	skipExtensions: ExtensionIdentifier[];
}

export interface IScanSingleExtensionArguments {
	language: string;
	remoteAuthority: string;
	isBuiltin: boolean;
	extensionLocation: UriComponents;
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
	os: platform.OperatingSystem;
	marks: performance.PerformanceMark[];
	useHostProxy: boolean;
}

export class RemoteExtensionEnvironmentChannelClient {

	static async getEnvironmentData(channel: IChannel, remoteAuthority: string): Promise<IRemoteAgentEnvironment> {
		const args: IGetEnvironmentDataArguments = {
			remoteAuthority
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
			os: data.os,
			marks: data.marks,
			useHostProxy: data.useHostProxy
		};
	}

	static async whenExtensionsReady(channel: IChannel): Promise<void> {
		await channel.call<void>('whenExtensionsReady');
	}

	static async scanExtensions(channel: IChannel, remoteAuthority: string, extensionDevelopmentPath: URI[] | undefined, skipExtensions: ExtensionIdentifier[]): Promise<IExtensionDescription[]> {
		const args: IScanExtensionsArguments = {
			language: platform.language,
			remoteAuthority,
			extensionDevelopmentPath,
			skipExtensions
		};

		const extensions = await channel.call<IExtensionDescription[]>('scanExtensions', args);
		extensions.forEach(ext => { (<any>ext).extensionLocation = URI.revive(ext.extensionLocation); });

		return extensions;
	}

	static async scanSingleExtension(channel: IChannel, remoteAuthority: string, isBuiltin: boolean, extensionLocation: URI): Promise<IExtensionDescription | null> {
		const args: IScanSingleExtensionArguments = {
			language: platform.language,
			remoteAuthority,
			isBuiltin,
			extensionLocation
		};

		const extension = await channel.call<IExtensionDescription | null>('scanSingleExtension', args);
		if (extension) {
			(<any>extension).extensionLocation = URI.revive(extension.extensionLocation);
		}
		return extension;
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
