/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as cp from 'child_process';
import * as path from 'path';
import * as fs from 'fs';
import * as os from 'os';
import * as net from 'net';
import * as http from 'http';
import { downloadAndUnzipVSCodeServer } from './download';
import { terminateProcess } from './util/processes';

let extHostProcess: cp.ChildProcess | undefined;
const enum CharCode {
	Backspace = 8,
	LineFeed = 10
}

let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {

	function doResolve(_authority: string, progress: vscode.Progress<{ message?: string; increment?: number }>): Promise<vscode.ResolvedAuthority> {
		const serverPromise = new Promise<vscode.ResolvedAuthority>(async (res, rej) => {
			progress.report({ message: 'Starting Test Resolver' });
			outputChannel = vscode.window.createOutputChannel('TestResolver');

			let isResolved = false;
			async function processError(message: string) {
				outputChannel.appendLine(message);
				if (!isResolved) {
					isResolved = true;
					outputChannel.show();

					const result = await vscode.window.showErrorMessage(message, { modal: true }, ...getActions());
					if (result) {
						await result.execute();
					}
					rej(vscode.RemoteAuthorityResolverError.NotAvailable(message, true));
				}
			}

			let lastProgressLine = '';
			function processOutput(output: string) {
				outputChannel.append(output);
				for (let i = 0; i < output.length; i++) {
					const chr = output.charCodeAt(i);
					if (chr === CharCode.LineFeed) {
						const match = lastProgressLine.match(/Extension host agent listening on (\d+)/);
						if (match) {
							isResolved = true;
							res(new vscode.ResolvedAuthority('localhost', parseInt(match[1], 10))); // success!
						}
						lastProgressLine = '';
					} else if (chr === CharCode.Backspace) {
						lastProgressLine = lastProgressLine.substr(0, lastProgressLine.length - 1);
					} else {
						lastProgressLine += output.charAt(i);
					}
				}
			}
			const delay = getConfiguration('startupDelay');
			if (typeof delay === 'number') {
				let remaining = Math.ceil(delay);
				outputChannel.append(`Delaying startup by ${remaining} seconds (configured by "testresolver.startupDelay").`);
				while (remaining > 0) {
					progress.report({ message: `Delayed resolving: Remaining ${remaining}s` });
					await (sleep(1000));
					remaining--;
				}
			}

			if (getConfiguration('startupError') === true) {
				processError('Test Resolver failed for testing purposes (configured by "testresolver.startupError").');
				return;
			}

			const { updateUrl, commit, quality, serverDataFolderName, dataFolderName } = getProductConfiguration();
			const commandArgs = ['--port=0', '--disable-telemetry'];
			const env = getNewEnv();
			const remoteDataDir = process.env['TESTRESOLVER_DATA_FOLDER'] || path.join(os.homedir(), serverDataFolderName || `${dataFolderName}-testresolver`);

			env['VSCODE_AGENT_FOLDER'] = remoteDataDir;
			outputChannel.appendLine(`Using data folder at ${remoteDataDir}`);

			if (!commit) { // dev mode
				const serverCommand = process.platform === 'win32' ? 'server.bat' : 'server.sh';
				const vscodePath = path.resolve(path.join(context.extensionPath, '..', '..'));
				const serverCommandPath = path.join(vscodePath, 'resources', 'server', 'bin-dev', serverCommand);
				extHostProcess = cp.spawn(serverCommandPath, commandArgs, { env, cwd: vscodePath });
			} else {
				const extensionToInstall = process.env['TESTRESOLVER_INSTALL_BUILTIN_EXTENSION'];
				if (extensionToInstall) {
					commandArgs.push('--install-builtin-extension', extensionToInstall);
					commandArgs.push('--start-server');
				}
				const serverCommand = process.platform === 'win32' ? 'server.cmd' : 'server.sh';
				let serverLocation = env['VSCODE_REMOTE_SERVER_PATH']; // support environment variable to specify location of server on disk
				if (!serverLocation) {
					const serverBin = path.join(remoteDataDir, 'bin');
					progress.report({ message: 'Installing VSCode Server' });
					serverLocation = await downloadAndUnzipVSCodeServer(updateUrl, commit, quality, serverBin, m => outputChannel.appendLine(m));
				}

				outputChannel.appendLine(`Using server build at ${serverLocation}`);
				outputChannel.appendLine(`Server arguments ${commandArgs.join(' ')}`);

				extHostProcess = cp.spawn(path.join(serverLocation, serverCommand), commandArgs, { env, cwd: serverLocation });
			}
			extHostProcess.stdout!.on('data', (data: Buffer) => processOutput(data.toString()));
			extHostProcess.stderr!.on('data', (data: Buffer) => processOutput(data.toString()));
			extHostProcess.on('error', (error: Error) => {
				processError(`server failed with error:\n${error.message}`);
				extHostProcess = undefined;
			});
			extHostProcess.on('close', (code: number) => {
				processError(`server closed unexpectedly.\nError code: ${code}`);
				extHostProcess = undefined;
			});
			context.subscriptions.push({
				dispose: () => {
					if (extHostProcess) {
						terminateProcess(extHostProcess, context.extensionPath);
					}
				}
			});
		});
		return serverPromise.then(serverAddr => {
			return new Promise<vscode.ResolvedAuthority>(async (res, _rej) => {
				const proxyServer = net.createServer(proxySocket => {
					outputChannel.appendLine(`Proxy connection accepted`);
					let remoteReady = true, localReady = true;
					const remoteSocket = net.createConnection({ port: serverAddr.port });

					let isDisconnected = getConfiguration('pause') === true;
					vscode.workspace.onDidChangeConfiguration(_ => {
						let newIsDisconnected = getConfiguration('pause') === true;
						if (isDisconnected !== newIsDisconnected) {
							outputChannel.appendLine(`Connection state: ${newIsDisconnected ? 'open' : 'paused'}`);
							isDisconnected = newIsDisconnected;
							if (!isDisconnected) {
								outputChannel.appendLine(`Resume remote and proxy sockets.`);
								if (remoteSocket.isPaused() && localReady) {
									remoteSocket.resume();
								}
								if (proxySocket.isPaused() && remoteReady) {
									proxySocket.resume();
								}
							} else {
								outputChannel.appendLine(`Pausing remote and proxy sockets.`);
								if (!remoteSocket.isPaused()) {
									remoteSocket.pause();
								}
								if (!proxySocket.isPaused()) {
									proxySocket.pause();
								}
							}
						}
					});

					proxySocket.on('data', (data) => {
						remoteReady = remoteSocket.write(data);
						if (!remoteReady) {
							proxySocket.pause();
						}
					});
					remoteSocket.on('data', (data) => {
						localReady = proxySocket.write(data);
						if (!localReady) {
							remoteSocket.pause();
						}
					});
					proxySocket.on('drain', () => {
						localReady = true;
						if (!isDisconnected) {
							remoteSocket.resume();
						}
					});
					remoteSocket.on('drain', () => {
						remoteReady = true;
						if (!isDisconnected) {
							proxySocket.resume();
						}
					});
					proxySocket.on('close', () => {
						outputChannel.appendLine(`Proxy socket closed, closing remote socket.`);
						remoteSocket.end();
					});
					remoteSocket.on('close', () => {
						outputChannel.appendLine(`Remote socket closed, closing proxy socket.`);
						proxySocket.end();
					});
					context.subscriptions.push({
						dispose: () => {
							proxySocket.end();
							remoteSocket.end();
						}
					});
				});
				proxyServer.listen(0, () => {
					const port = (<net.AddressInfo>proxyServer.address()).port;
					outputChannel.appendLine(`Going through proxy at port ${port}`);
					const r: vscode.ResolverResult = new vscode.ResolvedAuthority('127.0.0.1', port);
					res(r);
				});
				context.subscriptions.push({
					dispose: () => {
						proxyServer.close();
					}
				});
			});
		});
	}

	const authorityResolverDisposable = vscode.workspace.registerRemoteAuthorityResolver('test', {
		resolve(_authority: string): Thenable<vscode.ResolvedAuthority> {
			return vscode.window.withProgress({
				location: vscode.ProgressLocation.Notification,
				title: 'Open TestResolver Remote ([details](command:vscode-testresolver.showLog))',
				cancellable: false
			}, (progress) => doResolve(_authority, progress));
		},
		tunnelFactory,
		tunnelFeatures: { elevation: true, public: !!vscode.workspace.getConfiguration('testresolver').get('supportPublicPorts') },
		showCandidatePort
	});
	context.subscriptions.push(authorityResolverDisposable);

	context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.newWindow', () => {
		return vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: 'test+test' });
	}));
	context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.newWindowWithError', () => {
		return vscode.commands.executeCommand('vscode.newWindow', { remoteAuthority: 'test+error' });
	}));
	context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.killServerAndTriggerHandledError', () => {
		authorityResolverDisposable.dispose();
		if (extHostProcess) {
			terminateProcess(extHostProcess, context.extensionPath);
		}
		vscode.workspace.registerRemoteAuthorityResolver('test', {
			async resolve(_authority: string): Promise<vscode.ResolvedAuthority> {
				setTimeout(async () => {
					await vscode.window.showErrorMessage('Just a custom message.', { modal: true, useCustom: true }, 'OK', 'Great');
				}, 2000);
				throw vscode.RemoteAuthorityResolverError.NotAvailable('Intentional Error', true);
			}
		});
	}));
	context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.showLog', () => {
		if (outputChannel) {
			outputChannel.show();
		}
	}));

	context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.openTunnel', async () => {
		const result = await vscode.window.showInputBox({
			prompt: 'Enter the remote port for the tunnel',
			value: '5000',
			validateInput: input => /^[\d]+$/.test(input) ? undefined : 'Not a valid number'
		});
		if (result) {
			const port = Number.parseInt(result);
			vscode.workspace.openTunnel({
				remoteAddress: {
					host: 'localhost',
					port: port
				},
				localAddressPort: port + 1
			});
		}

	}));
	context.subscriptions.push(vscode.commands.registerCommand('vscode-testresolver.startRemoteServer', async () => {
		const result = await vscode.window.showInputBox({
			prompt: 'Enter the port for the remote server',
			value: '5000',
			validateInput: input => /^[\d]+$/.test(input) ? undefined : 'Not a valid number'
		});
		if (result) {
			runHTTPTestServer(Number.parseInt(result));
		}

	}));
	vscode.commands.executeCommand('setContext', 'forwardedPortsViewEnabled', true);
}

type ActionItem = (vscode.MessageItem & { execute: () => void; });

function getActions(): ActionItem[] {
	const actions: ActionItem[] = [];
	const isDirty = vscode.workspace.textDocuments.some(d => d.isDirty) || vscode.workspace.workspaceFile && vscode.workspace.workspaceFile.scheme === 'untitled';

	actions.push({
		title: 'Retry',
		execute: async () => {
			await vscode.commands.executeCommand('workbench.action.reloadWindow');
		}
	});
	if (!isDirty) {
		actions.push({
			title: 'Close Remote',
			execute: async () => {
				await vscode.commands.executeCommand('vscode.newWindow', { reuseWindow: true, remoteAuthority: null });
			}
		});
	}
	actions.push({
		title: 'Ignore',
		isCloseAffordance: true,
		execute: async () => {
			vscode.commands.executeCommand('vscode-testresolver.showLog'); // no need to wait
		}
	});
	return actions;
}

export interface IProductConfiguration {
	updateUrl: string;
	commit: string;
	quality: string;
	dataFolderName: string;
	serverDataFolderName?: string;
}

function getProductConfiguration(): IProductConfiguration {
	const content = fs.readFileSync(path.join(vscode.env.appRoot, 'product.json')).toString();
	return JSON.parse(content) as IProductConfiguration;
}

function getNewEnv(): { [x: string]: string | undefined } {
	const env = { ...process.env };
	delete env['ELECTRON_RUN_AS_NODE'];
	return env;
}

function sleep(ms: number): Promise<void> {
	return new Promise(resolve => {
		setTimeout(resolve, ms);
	});
}

function getConfiguration<T>(id: string): T | undefined {
	return vscode.workspace.getConfiguration('testresolver').get<T>(id);
}

const remoteServers: number[] = [];

async function showCandidatePort(_host: string, port: number, _detail: string): Promise<boolean> {
	return remoteServers.includes(port) || port === 100;
}

async function tunnelFactory(tunnelOptions: vscode.TunnelOptions, tunnelCreationOptions: vscode.TunnelCreationOptions): Promise<vscode.Tunnel> {
	outputChannel.appendLine(`Tunnel factory request: Remote ${tunnelOptions.remoteAddress.port} -> local ${tunnelOptions.localAddressPort}`);
	if (tunnelCreationOptions.elevationRequired) {
		await vscode.window.showInformationMessage('This is a fake elevation message. A real resolver would show a native elevation prompt.', { modal: true }, 'Ok');
	}

	return createTunnelService();

	function newTunnel(localAddress: { host: string, port: number }) {
		const onDidDispose: vscode.EventEmitter<void> = new vscode.EventEmitter();
		let isDisposed = false;
		return {
			localAddress,
			remoteAddress: tunnelOptions.remoteAddress,
			public: !!vscode.workspace.getConfiguration('testresolver').get('supportPublicPorts') && tunnelOptions.public,
			onDidDispose: onDidDispose.event,
			dispose: () => {
				if (!isDisposed) {
					isDisposed = true;
					onDidDispose.fire();
				}
			}
		};
	}

	function createTunnelService(): Promise<vscode.Tunnel> {
		return new Promise<vscode.Tunnel>((res, _rej) => {
			const proxyServer = net.createServer(proxySocket => {
				const remoteSocket = net.createConnection({ host: tunnelOptions.remoteAddress.host, port: tunnelOptions.remoteAddress.port });
				remoteSocket.pipe(proxySocket);
				proxySocket.pipe(remoteSocket);
			});
			let localPort = 0;

			if (tunnelOptions.localAddressPort) {
				// When the tunnelOptions include a localAddressPort, we should use that.
				// However, the test resolver all runs on one machine, so if the localAddressPort is the same as the remote port,
				// then we must use a different port number.
				localPort = tunnelOptions.localAddressPort;
			} else {
				localPort = tunnelOptions.remoteAddress.port;
			}

			if (localPort === tunnelOptions.remoteAddress.port) {
				localPort += 1;
			}

			// The test resolver can't actually handle privileged ports, it only pretends to.
			if (localPort < 1024 && process.platform !== 'win32') {
				localPort = 0;
			}
			proxyServer.listen(localPort, () => {
				const localPort = (<net.AddressInfo>proxyServer.address()).port;
				outputChannel.appendLine(`New test resolver tunnel service: Remote ${tunnelOptions.remoteAddress.port} -> local ${localPort}`);
				const tunnel = newTunnel({ host: 'localhost', port: localPort });
				tunnel.onDidDispose(() => proxyServer.close());
				res(tunnel);
			});
		});
	}
}

function runHTTPTestServer(port: number): vscode.Disposable {
	const server = http.createServer((_req, res) => {
		res.writeHead(200);
		res.end(`Hello, World from test server running on port ${port}!`);
	});
	remoteServers.push(port);
	server.listen(port);
	const message = `Opened HTTP server on http://localhost:${port}`;
	console.log(message);
	outputChannel.appendLine(message);
	return {
		dispose: () => {
			server.close();
			const index = remoteServers.indexOf(port);
			if (index !== -1) {
				remoteServers.splice(index, 1);
			}
		}
	};
}
