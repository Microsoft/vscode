/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { exists } from 'vs/base/node/pfs';
import * as cp from 'child_process';
import * as stream from 'stream';
import * as nls from 'vs/nls';
import * as net from 'net';
import * as path from 'vs/base/common/path';
import * as strings from 'vs/base/common/strings';
import * as objects from 'vs/base/common/objects';
import * as platform from 'vs/base/common/platform';
import { ExtensionsChannelId } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IOutputService } from 'vs/workbench/contrib/output/common/output';
import { IDebugAdapterExecutable, IDebuggerContribution, IPlatformSpecificAdapterContribution, IDebugAdapterServer, IDebugAdapterNamedPipeServer } from 'vs/workbench/contrib/debug/common/debug';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { AbstractDebugAdapter } from '../common/abstractDebugAdapter';

/**
 * An implementation that communicates via two streams with the debug adapter.
 */
export abstract class StreamDebugAdapter extends AbstractDebugAdapter {

	private static readonly TWO_CRLF = '\r\n\r\n';
	private static readonly HEADER_LINESEPARATOR = /\r?\n/;	// allow for non-RFC 2822 conforming line separators
	private static readonly HEADER_FIELDSEPARATOR = /: */;

	private outputStream!: stream.Writable;
	private rawData = Buffer.allocUnsafe(0);
	private contentLength = -1;

	constructor() {
		super();
	}

	protected connect(readable: stream.Readable, writable: stream.Writable): void {

		this.outputStream = writable;
		this.rawData = Buffer.allocUnsafe(0);
		this.contentLength = -1;

		readable.on('data', (data: Buffer) => this.handleData(data));
	}

	sendMessage(message: DebugProtocol.ProtocolMessage): void {

		if (this.outputStream) {
			const json = JSON.stringify(message);
			this.outputStream.write(`Content-Length: ${Buffer.byteLength(json, 'utf8')}${StreamDebugAdapter.TWO_CRLF}${json}`, 'utf8');
		}
	}

	private handleData(data: Buffer): void {

		this.rawData = Buffer.concat([this.rawData, data]);

		while (true) {
			if (this.contentLength >= 0) {
				if (this.rawData.length >= this.contentLength) {
					const message = this.rawData.toString('utf8', 0, this.contentLength);
					this.rawData = this.rawData.slice(this.contentLength);
					this.contentLength = -1;
					if (message.length > 0) {
						try {
							this.acceptMessage(<DebugProtocol.ProtocolMessage>JSON.parse(message));
						} catch (e) {
							this._onError.fire(new Error((e.message || e) + '\n' + message));
						}
					}
					continue;	// there may be more complete messages to process
				}
			} else {
				const idx = this.rawData.indexOf(StreamDebugAdapter.TWO_CRLF);
				if (idx !== -1) {
					const header = this.rawData.toString('utf8', 0, idx);
					const lines = header.split(StreamDebugAdapter.HEADER_LINESEPARATOR);
					for (const h of lines) {
						const kvPair = h.split(StreamDebugAdapter.HEADER_FIELDSEPARATOR);
						if (kvPair[0] === 'Content-Length') {
							this.contentLength = Number(kvPair[1]);
						}
					}
					this.rawData = this.rawData.slice(idx + StreamDebugAdapter.TWO_CRLF.length);
					continue;
				}
			}
			break;
		}
	}
}

export abstract class NetworkDebugAdapter extends StreamDebugAdapter {

	protected socket?: net.Socket;

	protected abstract createConnection(connectionListener: () => void): net.Socket;

	startSession(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			let connected = false;

			this.socket = this.createConnection(() => {
				this.connect(this.socket!, this.socket!);
				resolve();
				connected = true;
			});

			this.socket.on('close', () => {
				if (connected) {
					this._onError.fire(new Error('connection closed'));
				} else {
					reject(new Error('connection closed'));
				}
			});

			this.socket.on('error', error => {
				if (connected) {
					this._onError.fire(error);
				} else {
					reject(error);
				}
			});
		});
	}

	async stopSession(): Promise<void> {
		await this.cancelPendingRequests();
		if (this.socket) {
			this.socket.end();
			this.socket = undefined;
		}
	}
}

/**
 * An implementation that connects to a debug adapter via a socket.
*/
export class SocketDebugAdapter extends NetworkDebugAdapter {

	constructor(private adapterServer: IDebugAdapterServer) {
		super();
	}

	protected createConnection(connectionListener: () => void): net.Socket {
		return net.createConnection(this.adapterServer.port, this.adapterServer.host || '127.0.0.1', connectionListener);
	}
}

/**
 * An implementation that connects to a debug adapter via a NamedPipe (on Windows)/UNIX Domain Socket (on non-Windows).
 */
export class NamedPipeDebugAdapter extends NetworkDebugAdapter {

	constructor(private adapterServer: IDebugAdapterNamedPipeServer) {
		super();
	}

	protected createConnection(connectionListener: () => void): net.Socket {
		return net.createConnection(this.adapterServer.path, connectionListener);
	}
}

/**
 * An implementation that launches the debug adapter as a separate process and communicates via stdin/stdout.
*/
export class ExecutableDebugAdapter extends StreamDebugAdapter {

	private serverProcess: cp.ChildProcess | undefined;

	constructor(private adapterExecutable: IDebugAdapterExecutable, private debugType: string, private readonly outputService?: IOutputService) {
		super();
	}

	async startSession(): Promise<void> {

		const command = this.adapterExecutable.command;
		const args = this.adapterExecutable.args;
		const options = this.adapterExecutable.options || {};

		try {
			// verify executables asynchronously
			if (command) {
				if (path.isAbsolute(command)) {
					const commandExists = await exists(command);
					if (!commandExists) {
						throw new Error(nls.localize('debugAdapterBinNotFound', "Debug adapter executable '{0}' does not exist.", command));
					}
				} else {
					// relative path
					if (command.indexOf('/') < 0 && command.indexOf('\\') < 0) {
						// no separators: command looks like a runtime name like 'node' or 'mono'
						// TODO: check that the runtime is available on PATH
					}
				}
			} else {
				throw new Error(nls.localize({ key: 'debugAdapterCannotDetermineExecutable', comment: ['Adapter executable file not found'] },
					"Cannot determine executable for debug adapter '{0}'.", this.debugType));
			}

			let env = process.env;
			if (options.env && Object.keys(options.env).length > 0) {
				env = objects.mixin(objects.deepClone(process.env), options.env);
			}

			if (command === 'node') {
				if (Array.isArray(args) && args.length > 0) {
					const isElectron = !!process.env['ELECTRON_RUN_AS_NODE'] || !!process.versions['electron'];
					const forkOptions: cp.ForkOptions = {
						env: env,
						execArgv: isElectron ? ['-e', 'delete process.env.ELECTRON_RUN_AS_NODE;require(process.argv[1])'] : [],
						silent: true
					};
					if (options.cwd) {
						forkOptions.cwd = options.cwd;
					}
					const child = cp.fork(args[0], args.slice(1), forkOptions);
					if (!child.pid) {
						throw new Error(nls.localize('unableToLaunchDebugAdapter', "Unable to launch debug adapter from '{0}'.", args[0]));
					}
					this.serverProcess = child;
				} else {
					throw new Error(nls.localize('unableToLaunchDebugAdapterNoArgs', "Unable to launch debug adapter."));
				}
			} else {
				const spawnOptions: cp.SpawnOptions = {
					env: env
				};
				if (options.cwd) {
					spawnOptions.cwd = options.cwd;
				}
				this.serverProcess = cp.spawn(command, args, spawnOptions);
			}

			this.serverProcess.on('error', err => {
				this._onError.fire(err);
			});
			this.serverProcess.on('exit', (code, signal) => {
				this._onExit.fire(code);
			});

			this.serverProcess.stdout!.on('close', () => {
				this._onError.fire(new Error('read error'));
			});
			this.serverProcess.stdout!.on('error', error => {
				this._onError.fire(error);
			});

			this.serverProcess.stdin!.on('error', error => {
				this._onError.fire(error);
			});

			const outputService = this.outputService;
			if (outputService) {
				const sanitize = (s: string) => s.toString().replace(/\r?\n$/mg, '');
				// this.serverProcess.stdout.on('data', (data: string) => {
				// 	console.log('%c' + sanitize(data), 'background: #ddd; font-style: italic;');
				// });
				this.serverProcess.stderr!.on('data', (data: string) => {
					const channel = outputService.getChannel(ExtensionsChannelId);
					if (channel) {
						channel.append(sanitize(data));
					}
				});
			} else {
				this.serverProcess.stderr!.resume();
			}

			// finally connect to the DA
			this.connect(this.serverProcess.stdout!, this.serverProcess.stdin!);

		} catch (err) {
			this._onError.fire(err);
		}
	}

	async stopSession(): Promise<void> {

		if (!this.serverProcess) {
			return Promise.resolve(undefined);
		}

		// when killing a process in windows its child
		// processes are *not* killed but become root
		// processes. Therefore we use TASKKILL.EXE
		await this.cancelPendingRequests();
		if (platform.isWindows) {
			return new Promise<void>((c, e) => {
				const killer = cp.exec(`taskkill /F /T /PID ${this.serverProcess!.pid}`, function (err, stdout, stderr) {
					if (err) {
						return e(err);
					}
				});
				killer.on('exit', c);
				killer.on('error', e);
			});
		} else {
			this.serverProcess.kill('SIGTERM');
			return Promise.resolve(undefined);
		}
	}

	private static extract(platformContribution: IPlatformSpecificAdapterContribution, extensionFolderPath: string): IDebuggerContribution | undefined {
		if (!platformContribution) {
			return undefined;
		}

		const result: IDebuggerContribution = Object.create(null);
		if (platformContribution.runtime) {
			if (platformContribution.runtime.indexOf('./') === 0) {	// TODO
				result.runtime = path.join(extensionFolderPath, platformContribution.runtime);
			} else {
				result.runtime = platformContribution.runtime;
			}
		}
		if (platformContribution.runtimeArgs) {
			result.runtimeArgs = platformContribution.runtimeArgs;
		}
		if (platformContribution.program) {
			if (!path.isAbsolute(platformContribution.program)) {
				result.program = path.join(extensionFolderPath, platformContribution.program);
			} else {
				result.program = platformContribution.program;
			}
		}
		if (platformContribution.args) {
			result.args = platformContribution.args;
		}

		const contribution = platformContribution as IDebuggerContribution;

		if (contribution.win) {
			result.win = ExecutableDebugAdapter.extract(contribution.win, extensionFolderPath);
		}
		if (contribution.winx86) {
			result.winx86 = ExecutableDebugAdapter.extract(contribution.winx86, extensionFolderPath);
		}
		if (contribution.windows) {
			result.windows = ExecutableDebugAdapter.extract(contribution.windows, extensionFolderPath);
		}
		if (contribution.osx) {
			result.osx = ExecutableDebugAdapter.extract(contribution.osx, extensionFolderPath);
		}
		if (contribution.linux) {
			result.linux = ExecutableDebugAdapter.extract(contribution.linux, extensionFolderPath);
		}
		return result;
	}

	static platformAdapterExecutable(extensionDescriptions: IExtensionDescription[], debugType: string): IDebugAdapterExecutable | undefined {
		let result: IDebuggerContribution = Object.create(null);
		debugType = debugType.toLowerCase();

		// merge all contributions into one
		for (const ed of extensionDescriptions) {
			if (ed.contributes) {
				const debuggers = <IDebuggerContribution[]>ed.contributes['debuggers'];
				if (debuggers && debuggers.length > 0) {
					debuggers.filter(dbg => typeof dbg.type === 'string' && strings.equalsIgnoreCase(dbg.type, debugType)).forEach(dbg => {
						// extract relevant attributes and make them absolute where needed
						const extractedDbg = ExecutableDebugAdapter.extract(dbg, ed.extensionLocation.fsPath);

						// merge
						result = objects.mixin(result, extractedDbg, ed.isBuiltin);
					});
				}
			}
		}

		// select the right platform
		let platformInfo: IPlatformSpecificAdapterContribution | undefined;
		if (platform.isWindows && !process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432')) {
			platformInfo = result.winx86 || result.win || result.windows;
		} else if (platform.isWindows) {
			platformInfo = result.win || result.windows;
		} else if (platform.isMacintosh) {
			platformInfo = result.osx;
		} else if (platform.isLinux) {
			platformInfo = result.linux;
		}
		platformInfo = platformInfo || result;

		// these are the relevant attributes
		let program = platformInfo.program || result.program;
		const args = platformInfo.args || result.args;
		let runtime = platformInfo.runtime || result.runtime;
		const runtimeArgs = platformInfo.runtimeArgs || result.runtimeArgs;

		if (runtime) {
			return {
				type: 'executable',
				command: runtime,
				args: (runtimeArgs || []).concat(typeof program === 'string' ? [program] : []).concat(args || [])
			};
		} else if (program) {
			return {
				type: 'executable',
				command: program,
				args: args || []
			};
		}

		// nothing found
		return undefined;
	}
}
