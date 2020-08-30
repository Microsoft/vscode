/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ChildProcess, fork, ForkOptions } from 'child_process';
import { IDisposable, toDisposable, dispose } from 'vs/base/common/lifecycle';
import { Delayer, createCancelablePromise } from 'vs/base/common/async';
import { deepClone, assign } from 'vs/base/common/objects';
import { Emitter, Event } from 'vs/base/common/event';
import { createQueuedSender } from 'vs/base/node/processes';
import { IChannel, ChannelServer as IPCServer, ChannelClient as IPCClient, IChannelClient } from 'vs/base/parts/ipc/common/ipc';
import { isRemoteConsoleLog, log } from 'vs/base/common/console';
import { CancellationToken } from 'vs/base/common/cancellation';
import * as errors from 'vs/base/common/errors';
import { VSBuffer } from 'vs/base/common/buffer';

/**
 * This implementation doesn't perform well since it uses base64 encoding for buffers.
 * We should move all implementations to use named ipc.net, so we stop depending on cp.fork.
 */

export class Server<TContext extends string> extends IPCServer<TContext> {
	constructor(ctx: TContext) {
		super({
			send: r => {
				try {
					if (process.send) {
						process.send((<Buffer>r.buffer).toString('base64'));
					}
				} catch (e) { /* not much to do */ }
			},
			onMessage: Event.fromNodeEventEmitter(process, 'message', msg => VSBuffer.wrap(Buffer.from(msg, 'base64')))
		}, ctx);

		process.once('disconnect', () => this.dispose());
	}
}

export interface IIPCOptions {

	/**
	 * A descriptive name for the server this connection is to. Used in logging.
	 */
	serverName: string;

	/**
	 * Time in millies before killing the ipc process. The next request after killing will start it again.
	 */
	timeout?: number;

	/**
	 * Arguments to the module to execute.
	 */
	args?: string[];

	/**
	 * Environment key-value pairs to be passed to the process that gets spawned for the ipc.
	 */
	env?: any;

	/**
	 * Allows to assign a debug port for debugging the application executed.
	 */
	debug?: number;

	/**
	 * Allows to assign a debug port for debugging the application and breaking it on the first line.
	 */
	debugBrk?: number;

	/**
	 * See https://github.com/Microsoft/vscode/issues/27665
	 * Allows to pass in fresh execArgv to the forked process such that it doesn't inherit them from `process.execArgv`.
	 * e.g. Launching the extension host process with `--inspect-brk=xxx` and then forking a process from the extension host
	 * results in the forked process inheriting `--inspect-brk=xxx`.
	 */
	freshExecArgv?: boolean;

	/**
	 * Enables our createQueuedSender helper for this Client. Uses a queue when the internal Node.js queue is
	 * full of messages - see notes on that method.
	 */
	useQueue?: boolean;
}

export class Client implements IChannelClient, IDisposable {

	private disposeDelayer: Delayer<void> | undefined;
	private activeRequests = new Set<IDisposable>();
	private child: ChildProcess | null;
	private _client: IPCClient | null;
	private channels = new Map<string, IChannel>();

	private readonly _onDidProcessExit = new Emitter<{ code: number, signal: string }>();
	readonly onDidProcessExit = this._onDidProcessExit.event;

	constructor(private modulePath: string, private options: IIPCOptions) {
		const timeout = options && options.timeout ? options.timeout : 60000;
		this.disposeDelayer = new Delayer<void>(timeout);
		this.child = null;
		this._client = null;
	}

	getChannel<T extends IChannel>(channelName: string): T {
		const that = this;

		return {
			call<T>(command: string, arg?: any, cancellationToken?: CancellationToken): Promise<T> {
				return that.requestPromise<T>(channelName, command, arg, cancellationToken);
			},
			listen(event: string, arg?: any) {
				return that.requestEvent(channelName, event, arg);
			}
		} as T;
	}

	protected requestPromise<T>(channelName: string, name: string, arg?: any, cancellationToken = CancellationToken.None): Promise<T> {
		if (!this.disposeDelayer) {
			return Promise.reject(new Error('disposed'));
		}

		if (cancellationToken.isCancellationRequested) {
			return Promise.reject(errors.canceled());
		}

		this.disposeDelayer.cancel();

		const channel = this.getCachedChannel(channelName);
		const result = createCancelablePromise(token => channel.call<T>(name, arg, token));
		const cancellationTokenListener = cancellationToken.onCancellationRequested(() => result.cancel());

		const disposable = toDisposable(() => result.cancel());
		this.activeRequests.add(disposable);

		result.finally(() => {
			cancellationTokenListener.dispose();
			this.activeRequests.delete(disposable);

			if (this.activeRequests.size === 0 && this.disposeDelayer) {
				this.disposeDelayer.trigger(() => this.disposeClient());
			}
		});

		return result;
	}

	protected requestEvent<T>(channelName: string, name: string, arg?: any): Event<T> {
		if (!this.disposeDelayer) {
			return Event.None;
		}

		this.disposeDelayer.cancel();

		let listener: IDisposable;
		const emitter = new Emitter<any>({
			onFirstListenerAdd: () => {
				const channel = this.getCachedChannel(channelName);
				const event: Event<T> = channel.listen(name, arg);

				listener = event(emitter.fire, emitter);
				this.activeRequests.add(listener);
			},
			onLastListenerRemove: () => {
				this.activeRequests.delete(listener);
				listener.dispose();

				if (this.activeRequests.size === 0 && this.disposeDelayer) {
					this.disposeDelayer.trigger(() => this.disposeClient());
				}
			}
		});

		return emitter.event;
	}

	private get client(): IPCClient {
		if (!this._client) {
			const args = this.options && this.options.args ? this.options.args : [];
			const forkOpts: ForkOptions = Object.create(null);

			forkOpts.env = assign(deepClone(process.env), { 'VSCODE_PARENT_PID': String(process.pid) });

			if (this.options && this.options.env) {
				forkOpts.env = assign(forkOpts.env, this.options.env);
			}

			if (this.options && this.options.freshExecArgv) {
				forkOpts.execArgv = [];
			}

			if (this.options && typeof this.options.debug === 'number') {
				forkOpts.execArgv = ['--nolazy', '--inspect=' + this.options.debug];
			}

			if (this.options && typeof this.options.debugBrk === 'number') {
				forkOpts.execArgv = ['--nolazy', '--inspect-brk=' + this.options.debugBrk];
			}

			this.child = fork(this.modulePath, args, forkOpts);

			const onMessageEmitter = new Emitter<VSBuffer>();
			const onRawMessage = Event.fromNodeEventEmitter(this.child, 'message', msg => msg);

			onRawMessage(msg => {

				// Handle remote console logs specially
				if (isRemoteConsoleLog(msg)) {
					log(msg, `IPC Library: ${this.options.serverName}`);
					return;
				}

				// Anything else goes to the outside
				onMessageEmitter.fire(VSBuffer.wrap(Buffer.from(msg, 'base64')));
			});

			const sender = this.options.useQueue ? createQueuedSender(this.child) : this.child;
			const send = (r: VSBuffer) => this.child && this.child.connected && sender.send((<Buffer>r.buffer).toString('base64'));
			const onMessage = onMessageEmitter.event;
			const protocol = { send, onMessage };

			this._client = new IPCClient(protocol);

			const onExit = () => this.disposeClient();
			process.once('exit', onExit);

			this.child.on('error', err => console.warn('IPC "' + this.options.serverName + '" errored with ' + err));

			this.child.on('exit', (code: any, signal: any) => {
				process.removeListener('exit' as 'loaded', onExit); // https://github.com/electron/electron/issues/21475

				this.activeRequests.forEach(r => dispose(r));
				this.activeRequests.clear();

				if (code !== 0 && signal !== 'SIGTERM') {
					console.warn('IPC "' + this.options.serverName + '" crashed with exit code ' + code + ' and signal ' + signal);
				}

				if (this.disposeDelayer) {
					this.disposeDelayer.cancel();
				}
				this.disposeClient();
				this._onDidProcessExit.fire({ code, signal });
			});
		}

		return this._client;
	}

	private getCachedChannel(name: string): IChannel {
		let channel = this.channels.get(name);

		if (!channel) {
			channel = this.client.getChannel(name);
			this.channels.set(name, channel);
		}

		return channel;
	}

	private disposeClient() {
		if (this._client) {
			if (this.child) {
				this.child.kill();
				this.child = null;
			}
			this._client = null;
			this.channels.clear();
		}
	}

	dispose() {
		this._onDidProcessExit.dispose();
		if (this.disposeDelayer) {
			this.disposeDelayer.cancel();
			this.disposeDelayer = undefined;
		}
		this.disposeClient();
		this.activeRequests.clear();
	}
}
