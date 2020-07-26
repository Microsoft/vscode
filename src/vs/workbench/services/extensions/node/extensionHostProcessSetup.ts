/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nativeWatchdog from 'native-watchdog';
import * as net from 'net';
import * as minimist from 'minimist';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Event } from 'vs/base/common/event';
import { IMessagePassingProtocol } from 'vs/base/parts/ipc/common/ipc';
import { PersistentProtocol, ProtocolConstants, BufferedEmitter } from 'vs/base/parts/ipc/common/ipc.net';
import { NodeSocket, WebSocketNodeSocket } from 'vs/base/parts/ipc/node/ipc.net';
import product from 'vs/platform/product/common/product';
import { IInitData } from 'vs/workbench/api/common/extHost.protocol';
import { MessageType, createMessageOfType, isMessageOfType, IExtHostSocketMessage, IExtHostReadyMessage, IExtHostReduceGraceTimeMessage } from 'vs/workbench/services/extensions/common/extensionHostProtocol';
import { ExtensionHostMain, IExitFn } from 'vs/workbench/services/extensions/common/extensionHostMain';
import { VSBuffer } from 'vs/base/common/buffer';
import { IURITransformer, URITransformer, IRawURITransformer } from 'vs/base/common/uriIpc';
import { exists } from 'vs/base/node/pfs';
import { realpath } from 'vs/base/node/extpath';
import { IHostUtils } from 'vs/workbench/api/common/extHostExtensionService';
import { RunOnceScheduler } from 'vs/base/common/async';

import 'vs/workbench/api/common/extHost.common.services';
import 'vs/workbench/api/node/extHost.node.services';

interface ParsedExtHostArgs {
	uriTransformerPath?: string;
	useHostProxy?: string;
}

// workaround for https://github.com/microsoft/vscode/issues/85490
// remove --inspect-port=0 after start so that it doesn't trigger LSP debugging
(function removeInspectPort() {
	for (let i = 0; i < process.execArgv.length; i++) {
		if (process.execArgv[i] === '--inspect-port=0') {
			process.execArgv.splice(i, 1);
			i--;
		}
	}
})();

const args = minimist(process.argv.slice(2), {
	string: [
		'uriTransformerPath',
		'useHostProxy'
	]
}) as ParsedExtHostArgs;

// With Electron 2.x and node.js 8.x the "natives" module
// can cause a native crash (see https://github.com/nodejs/node/issues/19891 and
// https://github.com/electron/electron/issues/10905). To prevent this from
// happening we essentially blocklist this module from getting loaded in any
// extension by patching the node require() function.
(function () {
	const Module = require.__$__nodeRequire('module') as any;
	const originalLoad = Module._load;

	Module._load = function (request: string) {
		if (request === 'natives') {
			throw new Error('Either the extension or a NPM dependency is using the "natives" node module which is unsupported as it can cause a crash of the extension host. Click [here](https://go.microsoft.com/fwlink/?linkid=871887) to find out more');
		}

		return originalLoad.apply(this, arguments);
	};
})();

// custom process.exit logic...
const nativeExit: IExitFn = process.exit.bind(process);
function patchProcess(allowExit: boolean) {
	process.exit = function (code?: number) {
		if (allowExit) {
			nativeExit(code);
		} else {
			const err = new Error('An extension called process.exit() and this was prevented.');
			console.warn(err.stack);
		}
	} as (code?: number) => never;

	// override Electron's process.crash() method
	process.crash = function () {
		const err = new Error('An extension called process.crash() and this was prevented.');
		console.warn(err.stack);
	};
}

interface IRendererConnection {
	protocol: IMessagePassingProtocol;
	initData: IInitData;
}

// This calls exit directly in case the initialization is not finished and we need to exit
// Otherwise, if initialization completed we go to extensionHostMain.terminate()
let onTerminate = function () {
	nativeExit();
};

function _createExtHostProtocol(): Promise<PersistentProtocol> {
	if (process.env.VSCODE_EXTHOST_WILL_SEND_SOCKET) {

		return new Promise<PersistentProtocol>((resolve, reject) => {

			let protocol: PersistentProtocol | null = null;

			let timer = setTimeout(() => {
				reject(new Error('VSCODE_EXTHOST_IPC_SOCKET timeout'));
			}, 60000);

			const reconnectionGraceTime = ProtocolConstants.ReconnectionGraceTime;
			const reconnectionShortGraceTime = ProtocolConstants.ReconnectionShortGraceTime;
			const disconnectRunner1 = new RunOnceScheduler(() => onTerminate(), reconnectionGraceTime);
			const disconnectRunner2 = new RunOnceScheduler(() => onTerminate(), reconnectionShortGraceTime);

			process.on('message', (msg: IExtHostSocketMessage | IExtHostReduceGraceTimeMessage, handle: net.Socket) => {
				if (msg && msg.type === 'VSCODE_EXTHOST_IPC_SOCKET') {
					const initialDataChunk = VSBuffer.wrap(Buffer.from(msg.initialDataChunk, 'base64'));
					let socket: NodeSocket | WebSocketNodeSocket;
					if (msg.skipWebSocketFrames) {
						socket = new NodeSocket(handle);
					} else {
						socket = new WebSocketNodeSocket(new NodeSocket(handle));
					}
					if (protocol) {
						// reconnection case
						disconnectRunner1.cancel();
						disconnectRunner2.cancel();
						protocol.beginAcceptReconnection(socket, initialDataChunk);
						protocol.endAcceptReconnection();
					} else {
						clearTimeout(timer);
						protocol = new PersistentProtocol(socket, initialDataChunk);
						protocol.onClose(() => onTerminate());
						resolve(protocol);

						// Wait for rich client to reconnect
						protocol.onSocketClose(() => {
							// The socket has closed, let's give the renderer a certain amount of time to reconnect
							disconnectRunner1.schedule();
						});
					}
				}
				if (msg && msg.type === 'VSCODE_EXTHOST_IPC_REDUCE_GRACE_TIME') {
					if (disconnectRunner2.isScheduled()) {
						// we are disconnected and already running the short reconnection timer
						return;
					}
					if (disconnectRunner1.isScheduled()) {
						// we are disconnected and running the long reconnection timer
						disconnectRunner2.schedule();
					}
				}
			});

			// Now that we have managed to install a message listener, ask the other side to send us the socket
			const req: IExtHostReadyMessage = { type: 'VSCODE_EXTHOST_IPC_READY' };
			if (process.send) {
				process.send(req);
			}
		});

	} else {

		const pipeName = process.env.VSCODE_IPC_HOOK_EXTHOST!;

		return new Promise<PersistentProtocol>((resolve, reject) => {

			const socket = net.createConnection(pipeName, () => {
				socket.removeListener('error', reject);
				resolve(new PersistentProtocol(new NodeSocket(socket)));
			});
			socket.once('error', reject);

		});
	}
}

async function createExtHostProtocol(): Promise<IMessagePassingProtocol> {

	const protocol = await _createExtHostProtocol();

	return new class implements IMessagePassingProtocol {

		private readonly _onMessage = new BufferedEmitter<VSBuffer>();
		readonly onMessage: Event<VSBuffer> = this._onMessage.event;

		private _terminating: boolean;

		constructor() {
			this._terminating = false;
			protocol.onMessage((msg) => {
				if (isMessageOfType(msg, MessageType.Terminate)) {
					this._terminating = true;
					onTerminate();
				} else {
					this._onMessage.fire(msg);
				}
			});
		}

		send(msg: any): void {
			if (!this._terminating) {
				protocol.send(msg);
			}
		}

		drain(): Promise<void> {
			return protocol.drain();
		}
	};
}

function connectToRenderer(protocol: IMessagePassingProtocol): Promise<IRendererConnection> {
	return new Promise<IRendererConnection>((c) => {

		// Listen init data message
		const first = protocol.onMessage(raw => {
			first.dispose();

			const initData = <IInitData>JSON.parse(raw.toString());

			const rendererCommit = initData.commit;
			const myCommit = product.commit;

			if (rendererCommit && myCommit) {
				// Running in the built version where commits are defined
				if (rendererCommit !== myCommit) {
					nativeExit(55);
				}
			}

			// Print a console message when rejection isn't handled within N seconds. For details:
			// see https://nodejs.org/api/process.html#process_event_unhandledrejection
			// and https://nodejs.org/api/process.html#process_event_rejectionhandled
			const unhandledPromises: Promise<any>[] = [];
			process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
				unhandledPromises.push(promise);
				setTimeout(() => {
					const idx = unhandledPromises.indexOf(promise);
					if (idx >= 0) {
						promise.catch(e => {
							unhandledPromises.splice(idx, 1);
							console.warn(`rejected promise not handled within 1 second: ${e}`);
							if (e && e.stack) {
								console.warn(`stack trace: ${e.stack}`);
							}
							onUnexpectedError(reason);
						});
					}
				}, 1000);
			});

			process.on('rejectionHandled', (promise: Promise<any>) => {
				const idx = unhandledPromises.indexOf(promise);
				if (idx >= 0) {
					unhandledPromises.splice(idx, 1);
				}
			});

			// Print a console message when an exception isn't handled.
			process.on('uncaughtException', function (err: Error) {
				onUnexpectedError(err);
			});

			// Kill oneself if one's parent dies. Much drama.
			setInterval(function () {
				try {
					process.kill(initData.parentPid, 0); // throws an exception if the main process doesn't exist anymore.
				} catch (e) {
					onTerminate();
				}
			}, 1000);

			// In certain cases, the event loop can become busy and never yield
			// e.g. while-true or process.nextTick endless loops
			// So also use the native node module to do it from a separate thread
			let watchdog: typeof nativeWatchdog;
			try {
				watchdog = require.__$__nodeRequire('native-watchdog');
				watchdog.start(initData.parentPid);
			} catch (err) {
				// no problem...
				onUnexpectedError(err);
			}

			// Tell the outside that we are initialized
			protocol.send(createMessageOfType(MessageType.Initialized));

			c({ protocol, initData });
		});

		// Tell the outside that we are ready to receive messages
		protocol.send(createMessageOfType(MessageType.Ready));
	});
}

export async function startExtensionHostProcess(): Promise<void> {

	const protocol = await createExtHostProtocol();
	const renderer = await connectToRenderer(protocol);
	const { initData } = renderer;
	// setup things
	patchProcess(!!initData.environment.extensionTestsLocationURI); // to support other test frameworks like Jasmin that use process.exit (https://github.com/Microsoft/vscode/issues/37708)
	initData.environment.useHostProxy = args.useHostProxy !== undefined ? args.useHostProxy !== 'false' : undefined;

	// host abstraction
	const hostUtils = new class NodeHost implements IHostUtils {
		declare readonly _serviceBrand: undefined;
		exit(code: number) { nativeExit(code); }
		exists(path: string) { return exists(path); }
		realpath(path: string) { return realpath(path); }
	};

	// Attempt to load uri transformer
	let uriTransformer: IURITransformer | null = null;
	if (initData.remote.authority && args.uriTransformerPath) {
		try {
			const rawURITransformerFactory = <any>require.__$__nodeRequire(args.uriTransformerPath);
			const rawURITransformer = <IRawURITransformer>rawURITransformerFactory(initData.remote.authority);
			uriTransformer = new URITransformer(rawURITransformer);
		} catch (e) {
			console.error(e);
		}
	}

	const extensionHostMain = new ExtensionHostMain(
		renderer.protocol,
		initData,
		hostUtils,
		uriTransformer
	);

	// rewrite onTerminate-function to be a proper shutdown
	onTerminate = () => extensionHostMain.terminate();
}
