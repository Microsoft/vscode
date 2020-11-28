/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Disposable } from 'vs/base/common/lifecycle';
import { IChannel, IServerChannel, getDelayedChannel, IPCLogger } from 'vs/base/parts/ipc/common/ipc';
import { Client } from 'vs/base/parts/ipc/common/ipc.net';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { connectRemoteAgentManagement, IConnectionOptions, ISocketFactory, PersistentConnectionEvent } from 'vs/platform/remote/common/remoteAgentConnection';
import { IRemoteAgentConnection, IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IRemoteAuthorityResolverService, RemoteAuthorityResolverError } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { RemoteAgentConnectionContext, IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { IWorkbenchContribution, IWorkbenchContributionsRegistry, Extensions } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { RemoteExtensionEnvironmentChannelClient } from 'vs/workbench/services/remote/common/remoteAgentEnvironmentChannel';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IDiagnosticInfoOptions, IDiagnosticInfo } from 'vs/platform/diagnostics/common/diagnostics';
import { Emitter } from 'vs/base/common/event';
import { ISignService } from 'vs/platform/sign/common/sign';
import { ILogService } from 'vs/platform/log/common/log';
import { ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { IProductService } from 'vs/platform/product/common/productService';
import { URI } from 'vs/base/common/uri';

export abstract class AbstractRemoteAgentService extends Disposable implements IRemoteAgentService {

	declare readonly _serviceBrand: undefined;

	public readonly socketFactory: ISocketFactory;
	private readonly _connection: IRemoteAgentConnection | null;
	private _environment: Promise<IRemoteAgentEnvironment | null> | null;

	constructor(
		socketFactory: ISocketFactory,
		@IWorkbenchEnvironmentService protected readonly _environmentService: IWorkbenchEnvironmentService,
		@IProductService productService: IProductService,
		@IRemoteAuthorityResolverService private readonly _remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		@ISignService signService: ISignService,
		@ILogService logService: ILogService
	) {
		super();
		this.socketFactory = socketFactory;
		if (this._environmentService.remoteAuthority) {
			this._connection = this._register(new RemoteAgentConnection(this._environmentService.remoteAuthority, productService.commit, this.socketFactory, this._remoteAuthorityResolverService, signService, logService));
		} else {
			this._connection = null;
		}
		this._environment = null;
	}

	getConnection(): IRemoteAgentConnection | null {
		return this._connection;
	}

	getEnvironment(): Promise<IRemoteAgentEnvironment | null> {
		return this.getRawEnvironment().then(undefined, () => null);
	}

	getRawEnvironment(): Promise<IRemoteAgentEnvironment | null> {
		if (!this._environment) {
			this._environment = this._withChannel(
				async (channel, connection) => {
					const env = await RemoteExtensionEnvironmentChannelClient.getEnvironmentData(channel, connection.remoteAuthority);
					this._remoteAuthorityResolverService._setAuthorityConnectionToken(connection.remoteAuthority, env.connectionToken);
					return env;
				},
				null
			);
		}
		return this._environment;
	}

	whenExtensionsReady(): Promise<void> {
		return this._withChannel(
			channel => RemoteExtensionEnvironmentChannelClient.whenExtensionsReady(channel),
			undefined
		);
	}

	scanExtensions(skipExtensions: ExtensionIdentifier[] = []): Promise<IExtensionDescription[]> {
		return this._withChannel(
			(channel, connection) => RemoteExtensionEnvironmentChannelClient.scanExtensions(channel, connection.remoteAuthority, this._environmentService.extensionDevelopmentLocationURI, skipExtensions),
			[]
		).then(undefined, () => []);
	}

	scanSingleExtension(extensionLocation: URI, isBuiltin: boolean): Promise<IExtensionDescription | null> {
		return this._withChannel(
			(channel, connection) => RemoteExtensionEnvironmentChannelClient.scanSingleExtension(channel, connection.remoteAuthority, isBuiltin, extensionLocation),
			null
		).then(undefined, () => null);
	}

	getDiagnosticInfo(options: IDiagnosticInfoOptions): Promise<IDiagnosticInfo | undefined> {
		return this._withChannel(
			channel => RemoteExtensionEnvironmentChannelClient.getDiagnosticInfo(channel, options),
			undefined
		);
	}

	disableTelemetry(): Promise<void> {
		return this._withChannel(
			channel => RemoteExtensionEnvironmentChannelClient.disableTelemetry(channel),
			undefined
		);
	}

	logTelemetry(eventName: string, data: ITelemetryData): Promise<void> {
		return this._withChannel(
			channel => RemoteExtensionEnvironmentChannelClient.logTelemetry(channel, eventName, data),
			undefined
		);
	}

	flushTelemetry(): Promise<void> {
		return this._withChannel(
			channel => RemoteExtensionEnvironmentChannelClient.flushTelemetry(channel),
			undefined
		);
	}

	private _withChannel<R>(callback: (channel: IChannel, connection: IRemoteAgentConnection) => Promise<R>, fallback: R): Promise<R> {
		const connection = this.getConnection();
		if (!connection) {
			return Promise.resolve(fallback);
		}
		return connection.withChannel('remoteextensionsenvironment', (channel) => callback(channel, connection));
	}
}

export class RemoteAgentConnection extends Disposable implements IRemoteAgentConnection {

	private readonly _onReconnecting = this._register(new Emitter<void>());
	public readonly onReconnecting = this._onReconnecting.event;

	private readonly _onDidStateChange = this._register(new Emitter<PersistentConnectionEvent>());
	public readonly onDidStateChange = this._onDidStateChange.event;

	readonly remoteAuthority: string;
	private _connection: Promise<Client<RemoteAgentConnectionContext>> | null;

	constructor(
		remoteAuthority: string,
		private readonly _commit: string | undefined,
		private readonly _socketFactory: ISocketFactory,
		private readonly _remoteAuthorityResolverService: IRemoteAuthorityResolverService,
		private readonly _signService: ISignService,
		private readonly _logService: ILogService
	) {
		super();
		this.remoteAuthority = remoteAuthority;
		this._connection = null;
	}

	getChannel<T extends IChannel>(channelName: string): T {
		return <T>getDelayedChannel(this._getOrCreateConnection().then(c => c.getChannel(channelName)));
	}

	withChannel<T extends IChannel, R>(channelName: string, callback: (channel: T) => Promise<R>): Promise<R> {
		const channel = this.getChannel<T>(channelName);
		const result = callback(channel);
		return result;
	}

	registerChannel<T extends IServerChannel<RemoteAgentConnectionContext>>(channelName: string, channel: T): void {
		this._getOrCreateConnection().then(client => client.registerChannel(channelName, channel));
	}

	private _getOrCreateConnection(): Promise<Client<RemoteAgentConnectionContext>> {
		if (!this._connection) {
			this._connection = this._createConnection();
		}
		return this._connection;
	}

	private async _createConnection(): Promise<Client<RemoteAgentConnectionContext>> {
		let firstCall = true;
		const options: IConnectionOptions = {
			commit: this._commit,
			socketFactory: this._socketFactory,
			addressProvider: {
				getAddress: async () => {
					if (firstCall) {
						firstCall = false;
					} else {
						this._onReconnecting.fire(undefined);
					}
					const { authority } = await this._remoteAuthorityResolverService.resolveAuthority(this.remoteAuthority);
					return { host: authority.host, port: authority.port, connectionToken: authority.connectionToken };
				}
			},
			signService: this._signService,
			logService: this._logService,
			ipcLogger: false ? new IPCLogger(`Local \u2192 Remote`, `Remote \u2192 Local`) : null
		};
		const connection = this._register(await connectRemoteAgentManagement(options, this.remoteAuthority, `renderer`));
		this._register(connection.onDidStateChange(e => this._onDidStateChange.fire(e)));
		return connection.client;
	}
}

class RemoteConnectionFailureNotificationContribution implements IWorkbenchContribution {

	constructor(
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		@INotificationService notificationService: INotificationService,
	) {
		// Let's cover the case where connecting to fetch the remote extension info fails
		remoteAgentService.getRawEnvironment()
			.then(undefined, err => {
				if (!RemoteAuthorityResolverError.isHandled(err)) {
					notificationService.error(nls.localize('connectionError', "Failed to connect to the remote extension host server (Error: {0})", err ? err.message : ''));
				}
			});
	}

}

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(RemoteConnectionFailureNotificationContribution, LifecyclePhase.Ready);
