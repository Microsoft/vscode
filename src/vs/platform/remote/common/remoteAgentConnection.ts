/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Client, PersistentProtocol, ISocket, ProtocolConstants } from 'vs/base/parts/ipc/common/ipc.net';
import { generateUuid } from 'vs/base/common/uuid';
import { RemoteAgentConnectionContext } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { Disposable } from 'vs/base/common/lifecycle';
import { VSBuffer } from 'vs/base/common/buffer';
import { Emitter } from 'vs/base/common/event';
import { RemoteAuthorityResolverError } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { isPromiseCanceledError, onUnexpectedError } from 'vs/base/common/errors';
import { ISignService } from 'vs/platform/sign/common/sign';
import { CancelablePromise, createCancelablePromise } from 'vs/base/common/async';
import { ILogService } from 'vs/platform/log/common/log';
import { IIPCLogger } from 'vs/base/parts/ipc/common/ipc';

export const enum ConnectionType {
	Management = 1,
	ExtensionHost = 2,
	Tunnel = 3,
}

function connectionTypeToString(connectionType: ConnectionType): string {
	switch (connectionType) {
		case ConnectionType.Management:
			return 'Management';
		case ConnectionType.ExtensionHost:
			return 'ExtensionHost';
		case ConnectionType.Tunnel:
			return 'Tunnel';
	}
}

export interface AuthRequest {
	type: 'auth';
	auth: string;
}

export interface SignRequest {
	type: 'sign';
	data: string;
}

export interface ConnectionTypeRequest {
	type: 'connectionType';
	commit?: string;
	signedData?: string;
	desiredConnectionType?: ConnectionType;
	args?: any;
}

export interface ErrorMessage {
	type: 'error';
	reason: string;
}

export interface OKMessage {
	type: 'ok';
}

export type HandshakeMessage = AuthRequest | SignRequest | ConnectionTypeRequest | ErrorMessage | OKMessage;


interface ISimpleConnectionOptions {
	commit: string | undefined;
	host: string;
	port: number;
	reconnectionToken: string;
	reconnectionProtocol: PersistentProtocol | null;
	socketFactory: ISocketFactory;
	signService: ISignService;
	logService: ILogService;
}

export interface IConnectCallback {
	(err: any | undefined, socket: ISocket | undefined): void;
}

export interface ISocketFactory {
	connect(host: string, port: number, query: string, callback: IConnectCallback): void;
}

async function connectToRemoteExtensionHostAgent(options: ISimpleConnectionOptions, connectionType: ConnectionType, args: any | undefined): Promise<{ protocol: PersistentProtocol; ownsProtocol: boolean; }> {
	const logPrefix = connectLogPrefix(options, connectionType);
	const { protocol, ownsProtocol } = await new Promise<{ protocol: PersistentProtocol; ownsProtocol: boolean; }>((c, e) => {
		options.logService.trace(`${logPrefix} 1/6. invoking socketFactory.connect().`);
		options.socketFactory.connect(
			options.host,
			options.port,
			`reconnectionToken=${options.reconnectionToken}&reconnection=${options.reconnectionProtocol ? 'true' : 'false'}`,
			(err: any, socket: ISocket | undefined) => {
				if (err || !socket) {
					options.logService.error(`${logPrefix} socketFactory.connect() failed. Error:`);
					options.logService.error(err);
					e(err);
					return;
				}

				options.logService.trace(`${logPrefix} 2/6. socketFactory.connect() was successful.`);
				if (options.reconnectionProtocol) {
					options.reconnectionProtocol.beginAcceptReconnection(socket, null);
					c({ protocol: options.reconnectionProtocol, ownsProtocol: false });
				} else {
					c({ protocol: new PersistentProtocol(socket, null), ownsProtocol: true });
				}
			}
		);
	});

	return new Promise<{ protocol: PersistentProtocol; ownsProtocol: boolean; }>((c, e) => {

		const errorTimeoutToken = setTimeout(() => {
			const error: any = new Error('handshake timeout');
			error.code = 'ETIMEDOUT';
			error.syscall = 'connect';
			options.logService.error(`${logPrefix} the handshake took longer than 10 seconds. Error:`);
			options.logService.error(error);
			if (ownsProtocol) {
				safeDisposeProtocolAndSocket(protocol);
			}
			e(error);
		}, 10000);

		const messageRegistration = protocol.onControlMessage(async raw => {
			const msg = <HandshakeMessage>JSON.parse(raw.toString());
			// Stop listening for further events
			messageRegistration.dispose();

			const error = getErrorFromMessage(msg);
			if (error) {
				options.logService.error(`${logPrefix} received error control message when negotiating connection. Error:`);
				options.logService.error(error);
				if (ownsProtocol) {
					safeDisposeProtocolAndSocket(protocol);
				}
				return e(error);
			}

			if (msg.type === 'sign') {
				options.logService.trace(`${logPrefix} 4/6. received SignRequest control message.`);
				const signed = await options.signService.sign(msg.data);
				const connTypeRequest: ConnectionTypeRequest = {
					type: 'connectionType',
					commit: options.commit,
					signedData: signed,
					desiredConnectionType: connectionType
				};
				if (args) {
					connTypeRequest.args = args;
				}
				options.logService.trace(`${logPrefix} 5/6. sending ConnectionTypeRequest control message.`);
				protocol.sendControl(VSBuffer.fromString(JSON.stringify(connTypeRequest)));
				clearTimeout(errorTimeoutToken);
				c({ protocol, ownsProtocol });
			} else {
				const error = new Error('handshake error');
				options.logService.error(`${logPrefix} received unexpected control message. Error:`);
				options.logService.error(error);
				if (ownsProtocol) {
					safeDisposeProtocolAndSocket(protocol);
				}
				e(error);
			}
		});

		options.logService.trace(`${logPrefix} 3/6. sending AuthRequest control message.`);
		// TODO@vs-remote: use real nonce here
		const authRequest: AuthRequest = {
			type: 'auth',
			auth: '00000000000000000000'
		};
		protocol.sendControl(VSBuffer.fromString(JSON.stringify(authRequest)));
	});
}

interface IManagementConnectionResult {
	protocol: PersistentProtocol;
}

async function connectToRemoteExtensionHostAgentAndReadOneMessage(options: ISimpleConnectionOptions, connectionType: ConnectionType, args: any | undefined): Promise<{ protocol: PersistentProtocol; firstMessage: any }> {
	const startTime = Date.now();
	const logPrefix = connectLogPrefix(options, connectionType);
	const { protocol, ownsProtocol } = await connectToRemoteExtensionHostAgent(options, connectionType, args);
	return new Promise<{ protocol: PersistentProtocol; firstMessage: any }>((c, e) => {
		const registration = protocol.onControlMessage(raw => {
			registration.dispose();
			const msg = JSON.parse(raw.toString());
			const error = getErrorFromMessage(msg);
			if (error) {
				options.logService.error(`${logPrefix} received error control message when negotiating connection. Error:`);
				options.logService.error(error);
				if (ownsProtocol) {
					safeDisposeProtocolAndSocket(protocol);
				}
				return e(error);
			}
			if (options.reconnectionProtocol) {
				options.reconnectionProtocol.endAcceptReconnection();
			}
			options.logService.trace(`${logPrefix} 6/6. handshake finished, connection is up and running after ${logElapsed(startTime)}!`);
			c({ protocol, firstMessage: msg });
		});
	});
}

async function doConnectRemoteAgentManagement(options: ISimpleConnectionOptions): Promise<IManagementConnectionResult> {
	const { protocol } = await connectToRemoteExtensionHostAgentAndReadOneMessage(options, ConnectionType.Management, undefined);
	return { protocol };
}

export interface IRemoteExtensionHostStartParams {
	language: string;
	debugId?: string;
	break?: boolean;
	port?: number | null;
	env?: { [key: string]: string | null };
}

interface IExtensionHostConnectionResult {
	protocol: PersistentProtocol;
	debugPort?: number;
}

async function doConnectRemoteAgentExtensionHost(options: ISimpleConnectionOptions, startArguments: IRemoteExtensionHostStartParams): Promise<IExtensionHostConnectionResult> {
	const { protocol, firstMessage } = await connectToRemoteExtensionHostAgentAndReadOneMessage(options, ConnectionType.ExtensionHost, startArguments);
	const debugPort = firstMessage && firstMessage.debugPort;
	return { protocol, debugPort };
}

export interface ITunnelConnectionStartParams {
	port: number;
}

async function doConnectRemoteAgentTunnel(options: ISimpleConnectionOptions, startParams: ITunnelConnectionStartParams): Promise<PersistentProtocol> {
	const startTime = Date.now();
	const logPrefix = connectLogPrefix(options, ConnectionType.Tunnel);
	const { protocol } = await connectToRemoteExtensionHostAgent(options, ConnectionType.Tunnel, startParams);
	options.logService.trace(`${logPrefix} 6/6. handshake finished, connection is up and running after ${logElapsed(startTime)}!`);
	return protocol;
}

export interface IConnectionOptions {
	commit: string | undefined;
	socketFactory: ISocketFactory;
	addressProvider: IAddressProvider;
	signService: ISignService;
	logService: ILogService;
	ipcLogger: IIPCLogger | null;
}

async function resolveConnectionOptions(options: IConnectionOptions, reconnectionToken: string, reconnectionProtocol: PersistentProtocol | null): Promise<ISimpleConnectionOptions> {
	const { host, port } = await options.addressProvider.getAddress();
	return {
		commit: options.commit,
		host: host,
		port: port,
		reconnectionToken: reconnectionToken,
		reconnectionProtocol: reconnectionProtocol,
		socketFactory: options.socketFactory,
		signService: options.signService,
		logService: options.logService
	};
}

export interface IAddress {
	host: string;
	port: number;
}

export interface IAddressProvider {
	getAddress(): Promise<IAddress>;
}

export async function connectRemoteAgentManagement(options: IConnectionOptions, remoteAuthority: string, clientId: string): Promise<ManagementPersistentConnection> {
	try {
		const reconnectionToken = generateUuid();
		const simpleOptions = await resolveConnectionOptions(options, reconnectionToken, null);
		const { protocol } = await connectWithTimeLimit(simpleOptions.logService, doConnectRemoteAgentManagement(simpleOptions), 30 * 1000 /*30s*/);
		return new ManagementPersistentConnection(options, remoteAuthority, clientId, reconnectionToken, protocol);
	} catch (err) {
		options.logService.error(`[remote-connection] An error occurred in the very first connect attempt, it will be treated as a permanent error! Error:`);
		options.logService.error(err);
		PersistentConnection.triggerPermanentFailure();
		throw err;
	}
}

export async function connectRemoteAgentExtensionHost(options: IConnectionOptions, startArguments: IRemoteExtensionHostStartParams): Promise<ExtensionHostPersistentConnection> {
	try {
		const reconnectionToken = generateUuid();
		const simpleOptions = await resolveConnectionOptions(options, reconnectionToken, null);
		const { protocol, debugPort } = await connectWithTimeLimit(simpleOptions.logService, doConnectRemoteAgentExtensionHost(simpleOptions, startArguments), 30 * 1000 /*30s*/);
		return new ExtensionHostPersistentConnection(options, startArguments, reconnectionToken, protocol, debugPort);
	} catch (err) {
		options.logService.error(`[remote-connection] An error occurred in the very first connect attempt, it will be treated as a permanent error! Error:`);
		options.logService.error(err);
		PersistentConnection.triggerPermanentFailure();
		throw err;
	}
}

export async function connectRemoteAgentTunnel(options: IConnectionOptions, tunnelRemotePort: number): Promise<PersistentProtocol> {
	const simpleOptions = await resolveConnectionOptions(options, generateUuid(), null);
	const protocol = await connectWithTimeLimit(simpleOptions.logService, doConnectRemoteAgentTunnel(simpleOptions, { port: tunnelRemotePort }), 30 * 1000 /*30s*/);
	return protocol;
}

function sleep(seconds: number): CancelablePromise<void> {
	return createCancelablePromise(token => {
		return new Promise((resolve, reject) => {
			const timeout = setTimeout(resolve, seconds * 1000);
			token.onCancellationRequested(() => {
				clearTimeout(timeout);
				resolve();
			});
		});
	});
}

export const enum PersistentConnectionEventType {
	ConnectionLost,
	ReconnectionWait,
	ReconnectionRunning,
	ReconnectionPermanentFailure,
	ConnectionGain
}
export class ConnectionLostEvent {
	public readonly type = PersistentConnectionEventType.ConnectionLost;
}
export class ReconnectionWaitEvent {
	public readonly type = PersistentConnectionEventType.ReconnectionWait;
	constructor(
		public readonly durationSeconds: number,
		private readonly cancellableTimer: CancelablePromise<void>
	) { }

	public skipWait(): void {
		this.cancellableTimer.cancel();
	}
}
export class ReconnectionRunningEvent {
	public readonly type = PersistentConnectionEventType.ReconnectionRunning;
}
export class ConnectionGainEvent {
	public readonly type = PersistentConnectionEventType.ConnectionGain;
}
export class ReconnectionPermanentFailureEvent {
	public readonly type = PersistentConnectionEventType.ReconnectionPermanentFailure;
}
export type PersistenConnectionEvent = ConnectionGainEvent | ConnectionLostEvent | ReconnectionWaitEvent | ReconnectionRunningEvent | ReconnectionPermanentFailureEvent;

abstract class PersistentConnection extends Disposable {

	public static triggerPermanentFailure(): void {
		this._permanentFailure = true;
		this._instances.forEach(instance => instance._gotoPermanentFailure());
	}
	private static _permanentFailure: boolean = false;
	private static _instances: PersistentConnection[] = [];

	private readonly _onDidStateChange = this._register(new Emitter<PersistenConnectionEvent>());
	public readonly onDidStateChange = this._onDidStateChange.event;

	protected readonly _options: IConnectionOptions;
	public readonly reconnectionToken: string;
	public readonly protocol: PersistentProtocol;

	private _isReconnecting: boolean;

	constructor(private readonly _connectionType: ConnectionType, options: IConnectionOptions, reconnectionToken: string, protocol: PersistentProtocol) {
		super();
		this._options = options;
		this.reconnectionToken = reconnectionToken;
		this.protocol = protocol;
		this._isReconnecting = false;

		this._onDidStateChange.fire(new ConnectionGainEvent());

		this._register(protocol.onSocketClose(() => this._beginReconnecting()));
		this._register(protocol.onSocketTimeout(() => this._beginReconnecting()));

		PersistentConnection._instances.push(this);

		if (PersistentConnection._permanentFailure) {
			this._gotoPermanentFailure();
		}
	}

	private async _beginReconnecting(): Promise<void> {
		// Only have one reconnection loop active at a time.
		if (this._isReconnecting) {
			return;
		}
		try {
			this._isReconnecting = true;
			await this._runReconnectingLoop();
		} finally {
			this._isReconnecting = false;
		}
	}

	private async _runReconnectingLoop(): Promise<void> {
		if (PersistentConnection._permanentFailure) {
			// no more attempts!
			return;
		}
		const logPrefix = commonLogPrefix(this._connectionType, this.reconnectionToken, true);
		this._options.logService.info(`${logPrefix} starting reconnecting loop. You can get more information with the trace log level.`);
		this._onDidStateChange.fire(new ConnectionLostEvent());
		const TIMES = [5, 5, 10, 10, 10, 10, 10, 30];
		const disconnectStartTime = Date.now();
		let attempt = -1;
		do {
			attempt++;
			const waitTime = (attempt < TIMES.length ? TIMES[attempt] : TIMES[TIMES.length - 1]);
			try {
				const sleepPromise = sleep(waitTime);
				this._onDidStateChange.fire(new ReconnectionWaitEvent(waitTime, sleepPromise));

				this._options.logService.info(`${logPrefix} waiting for ${waitTime} seconds before reconnecting...`);
				try {
					await sleepPromise;
				} catch { } // User canceled timer

				if (PersistentConnection._permanentFailure) {
					this._options.logService.error(`${logPrefix} permanent failure occurred while running the reconnecting loop.`);
					break;
				}

				// connection was lost, let's try to re-establish it
				this._onDidStateChange.fire(new ReconnectionRunningEvent());
				this._options.logService.info(`${logPrefix} resolving connection...`);
				const simpleOptions = await resolveConnectionOptions(this._options, this.reconnectionToken, this.protocol);
				this._options.logService.info(`${logPrefix} connecting to ${simpleOptions.host}:${simpleOptions.port}...`);
				await connectWithTimeLimit(simpleOptions.logService, this._reconnect(simpleOptions), 30 * 1000 /*30s*/);
				this._options.logService.info(`${logPrefix} reconnected!`);
				this._onDidStateChange.fire(new ConnectionGainEvent());

				break;
			} catch (err) {
				if (err.code === 'VSCODE_CONNECTION_ERROR') {
					this._options.logService.error(`${logPrefix} A permanent error occurred in the reconnecting loop! Will give up now! Error:`);
					this._options.logService.error(err);
					PersistentConnection.triggerPermanentFailure();
					break;
				}
				if (Date.now() - disconnectStartTime > ProtocolConstants.ReconnectionGraceTime) {
					this._options.logService.error(`${logPrefix} An error occurred while reconnecting, but it will be treated as a permanent error because the reconnection grace time has expired! Will give up now! Error:`);
					this._options.logService.error(err);
					PersistentConnection.triggerPermanentFailure();
					break;
				}
				if (RemoteAuthorityResolverError.isTemporarilyNotAvailable(err)) {
					this._options.logService.info(`${logPrefix} A temporarily not available error occured while trying to reconnect, will try again...`);
					this._options.logService.trace(err);
					// try again!
					continue;
				}
				if ((err.code === 'ETIMEDOUT' || err.code === 'ENETUNREACH' || err.code === 'ECONNREFUSED' || err.code === 'ECONNRESET') && err.syscall === 'connect') {
					this._options.logService.info(`${logPrefix} A network error occured while trying to reconnect, will try again...`);
					this._options.logService.trace(err);
					// try again!
					continue;
				}
				if (isPromiseCanceledError(err)) {
					this._options.logService.info(`${logPrefix} A promise cancelation error occured while trying to reconnect, will try again...`);
					this._options.logService.trace(err);
					// try again!
					continue;
				}
				this._options.logService.error(`${logPrefix} An unknown error occured while trying to reconnect, since this is an unknown case, it will be treated as a permanent error! Will give up now! Error:`);
				this._options.logService.error(err);
				PersistentConnection.triggerPermanentFailure();
				break;
			}
		} while (!PersistentConnection._permanentFailure);
	}

	private _gotoPermanentFailure(): void {
		this._onDidStateChange.fire(new ReconnectionPermanentFailureEvent());
		safeDisposeProtocolAndSocket(this.protocol);
	}

	protected abstract _reconnect(options: ISimpleConnectionOptions): Promise<void>;
}

export class ManagementPersistentConnection extends PersistentConnection {

	public readonly client: Client<RemoteAgentConnectionContext>;

	constructor(options: IConnectionOptions, remoteAuthority: string, clientId: string, reconnectionToken: string, protocol: PersistentProtocol) {
		super(ConnectionType.Management, options, reconnectionToken, protocol);
		this.client = this._register(new Client<RemoteAgentConnectionContext>(protocol, {
			remoteAuthority: remoteAuthority,
			clientId: clientId
		}, options.ipcLogger));
	}

	protected async _reconnect(options: ISimpleConnectionOptions): Promise<void> {
		await doConnectRemoteAgentManagement(options);
	}
}

export class ExtensionHostPersistentConnection extends PersistentConnection {

	private readonly _startArguments: IRemoteExtensionHostStartParams;
	public readonly debugPort: number | undefined;

	constructor(options: IConnectionOptions, startArguments: IRemoteExtensionHostStartParams, reconnectionToken: string, protocol: PersistentProtocol, debugPort: number | undefined) {
		super(ConnectionType.ExtensionHost, options, reconnectionToken, protocol);
		this._startArguments = startArguments;
		this.debugPort = debugPort;
	}

	protected async _reconnect(options: ISimpleConnectionOptions): Promise<void> {
		await doConnectRemoteAgentExtensionHost(options, this._startArguments);
	}
}

function connectWithTimeLimit<T>(logService: ILogService, p: Promise<T>, timeLimit: number): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		let timeout = setTimeout(() => {
			const err: any = new Error('Time limit reached');
			err.code = 'ETIMEDOUT';
			err.syscall = 'connect';
			logService.error(`[remote-connection] The time limit has been reached for a connection. Error:`);
			logService.error(err);
			reject(err);
		}, timeLimit);
		p.then((value) => {
			clearTimeout(timeout);
			resolve(value);
		}, (err) => {
			clearTimeout(timeout);
			reject(err);
		});
	});
}

function safeDisposeProtocolAndSocket(protocol: PersistentProtocol): void {
	try {
		protocol.acceptDisconnect();
		const socket = protocol.getSocket();
		protocol.dispose();
		socket.dispose();
	} catch (err) {
		onUnexpectedError(err);
	}
}

function getErrorFromMessage(msg: any): Error | null {
	if (msg && msg.type === 'error') {
		const error = new Error(`Connection error: ${msg.reason}`);
		(<any>error).code = 'VSCODE_CONNECTION_ERROR';
		return error;
	}
	return null;
}

function stringRightPad(str: string, len: number): string {
	while (str.length < len) {
		str += ' ';
	}
	return str;
}

function commonLogPrefix(connectionType: ConnectionType, reconnectionToken: string, isReconnect: boolean): string {
	return `[remote-connection][${stringRightPad(connectionTypeToString(connectionType), 13)}][${reconnectionToken.substr(0, 5)}…][${isReconnect ? 'reconnect' : 'initial'}]`;
}

function connectLogPrefix(options: ISimpleConnectionOptions, connectionType: ConnectionType): string {
	return `${commonLogPrefix(connectionType, options.reconnectionToken, !!options.reconnectionProtocol)}[${options.host}:${options.port}]`;
}

function logElapsed(startTime: number): string {
	return `${Date.now() - startTime} ms`;
}
