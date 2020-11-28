/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { RemoteAgentConnectionContext, IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { IChannel, IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { IDiagnosticInfoOptions, IDiagnosticInfo } from 'vs/platform/diagnostics/common/diagnostics';
import { Event } from 'vs/base/common/event';
import { PersistentConnectionEvent, ISocketFactory } from 'vs/platform/remote/common/remoteAgentConnection';
import { ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { URI } from 'vs/base/common/uri';

export const RemoteExtensionLogFileName = 'remoteagent';

export const IRemoteAgentService = createDecorator<IRemoteAgentService>('remoteAgentService');

export interface IRemoteAgentService {
	readonly _serviceBrand: undefined;

	readonly socketFactory: ISocketFactory;

	getConnection(): IRemoteAgentConnection | null;
	/**
	 * Get the remote environment. In case of an error, returns `null`.
	 */
	getEnvironment(): Promise<IRemoteAgentEnvironment | null>;
	/**
	 * Get the remote environment. Can return an error.
	 */
	getRawEnvironment(): Promise<IRemoteAgentEnvironment | null>;

	whenExtensionsReady(): Promise<void>;
	/**
	 * Scan remote extensions.
	 */
	scanExtensions(skipExtensions?: ExtensionIdentifier[]): Promise<IExtensionDescription[]>;
	/**
	 * Scan a single remote extension.
	 */
	scanSingleExtension(extensionLocation: URI, isBuiltin: boolean): Promise<IExtensionDescription | null>;
	getDiagnosticInfo(options: IDiagnosticInfoOptions): Promise<IDiagnosticInfo | undefined>;
	disableTelemetry(): Promise<void>;
	logTelemetry(eventName: string, data?: ITelemetryData): Promise<void>;
	flushTelemetry(): Promise<void>;
}

export interface IRemoteAgentConnection {
	readonly remoteAuthority: string;

	readonly onReconnecting: Event<void>;
	readonly onDidStateChange: Event<PersistentConnectionEvent>;

	getChannel<T extends IChannel>(channelName: string): T;
	withChannel<T extends IChannel, R>(channelName: string, callback: (channel: T) => Promise<R>): Promise<R>;
	registerChannel<T extends IServerChannel<RemoteAgentConnectionContext>>(channelName: string, channel: T): void;
}
