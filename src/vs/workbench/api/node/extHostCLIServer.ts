/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createRandomIPCHandle } from 'vs/base/parts/ipc/node/ipc.net';
import * as http from 'http';
import * as fs from 'fs';
import { IExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { IWindowOpenable, IOpenWindowOptions } from 'vs/platform/windows/common/windows';
import { URI } from 'vs/base/common/uri';
import { hasWorkspaceFileExtension } from 'vs/platform/workspaces/common/workspaces';
import { ILogService } from 'vs/platform/log/common/log';

export interface OpenCommandPipeArgs {
	type: 'open';
	fileURIs?: string[];
	folderURIs?: string[];
	forceNewWindow?: boolean;
	diffMode?: boolean;
	addMode?: boolean;
	gotoLineMode?: boolean;
	forceReuseWindow?: boolean;
	waitMarkerFilePath?: string;
}

export interface OpenExternalCommandPipeArgs {
	type: 'openExternal';
	uris: string[];
}

export interface StatusPipeArgs {
	type: 'status';
}

export interface ExtensionManagementPipeArgs {
	type: 'extensionManagement';
	list?: { showVersions?: boolean, category?: string; };
	install?: string[];
	uninstall?: string[];
	force?: boolean;
}

export type PipeCommand = OpenCommandPipeArgs | StatusPipeArgs | OpenExternalCommandPipeArgs | ExtensionManagementPipeArgs;

export interface ICommandsExecuter {
	executeCommand<T>(id: string, ...args: any[]): Promise<T>;
}

export class CLIServerBase {
	private readonly _server: http.Server;

	constructor(
		private readonly _commands: ICommandsExecuter,
		private readonly logService: ILogService,
		private readonly _ipcHandlePath: string,
	) {
		this._server = http.createServer((req, res) => this.onRequest(req, res));
		this.setup().catch(err => {
			logService.error(err);
			return '';
		});
	}

	public get ipcHandlePath() {
		return this._ipcHandlePath;
	}

	private async setup(): Promise<string> {
		try {
			this._server.listen(this.ipcHandlePath);
			this._server.on('error', err => this.logService.error(err));
		} catch (err) {
			this.logService.error('Could not start open from terminal server.');
		}

		return this._ipcHandlePath;
	}

	private onRequest(req: http.IncomingMessage, res: http.ServerResponse): void {
		const chunks: string[] = [];
		req.setEncoding('utf8');
		req.on('data', (d: string) => chunks.push(d));
		req.on('end', () => {
			const data: PipeCommand | any = JSON.parse(chunks.join(''));
			switch (data.type) {
				case 'open':
					this.open(data, res);
					break;
				case 'openExternal':
					this.openExternal(data, res);
					break;
				case 'status':
					this.getStatus(data, res);
					break;
				case 'extensionManagement':
					this.manageExtensions(data, res)
						.catch(this.logService.error);
					break;
				default:
					res.writeHead(404);
					res.write(`Unknown message type: ${data.type}`, err => {
						if (err) {
							this.logService.error(err);
						}
					});
					res.end();
					break;
			}
		});
	}

	private open(data: OpenCommandPipeArgs, res: http.ServerResponse) {
		let { fileURIs, folderURIs, forceNewWindow, diffMode, addMode, forceReuseWindow, gotoLineMode, waitMarkerFilePath } = data;
		const urisToOpen: IWindowOpenable[] = [];
		if (Array.isArray(folderURIs)) {
			for (const s of folderURIs) {
				try {
					urisToOpen.push({ folderUri: URI.parse(s) });
				} catch (e) {
					// ignore
				}
			}
		}
		if (Array.isArray(fileURIs)) {
			for (const s of fileURIs) {
				try {
					if (hasWorkspaceFileExtension(s)) {
						urisToOpen.push({ workspaceUri: URI.parse(s) });
					} else {
						urisToOpen.push({ fileUri: URI.parse(s) });
					}
				} catch (e) {
					// ignore
				}
			}
		}
		if (urisToOpen.length) {
			const waitMarkerFileURI = waitMarkerFilePath ? URI.file(waitMarkerFilePath) : undefined;
			const preferNewWindow = !forceReuseWindow && !waitMarkerFileURI && !addMode;
			const windowOpenArgs: IOpenWindowOptions = { forceNewWindow, diffMode, addMode, gotoLineMode, forceReuseWindow, preferNewWindow, waitMarkerFileURI };
			this._commands.executeCommand('_remoteCLI.windowOpen', urisToOpen, windowOpenArgs);
		}
		res.writeHead(200);
		res.end();
	}

	private async openExternal(data: OpenExternalCommandPipeArgs, res: http.ServerResponse) {
		for (const uriString of data.uris) {
			const uri = URI.parse(uriString);
			const urioOpen = uri.scheme === 'file' ? uri : uriString; // workaround for #112577
			await this._commands.executeCommand('_remoteCLI.openExternal', urioOpen);
		}
		res.writeHead(200);
		res.end();
	}

	private async manageExtensions(data: ExtensionManagementPipeArgs, res: http.ServerResponse) {
		try {
			const toExtOrVSIX = (inputs: string[] | undefined) => inputs?.map(input => /\.vsix$/i.test(input) ? URI.parse(input) : input);
			const commandArgs = {
				list: data.list,
				install: toExtOrVSIX(data.install),
				uninstall: toExtOrVSIX(data.uninstall),
				force: data.force
			};
			const output = await this._commands.executeCommand('_remoteCLI.manageExtensions', commandArgs);
			res.writeHead(200);
			res.write(output);
		} catch (err) {
			res.writeHead(500);
			res.write(String(err), err => {
				if (err) {
					this.logService.error(err);
				}
			});
		}
		res.end();
	}

	private async getStatus(data: StatusPipeArgs, res: http.ServerResponse) {
		try {
			const status = await this._commands.executeCommand('_remoteCLI.getSystemStatus');
			res.writeHead(200);
			res.write(status);
			res.end();
		} catch (err) {
			res.writeHead(500);
			res.write(String(err), err => {
				if (err) {
					this.logService.error(err);
				}
			});
			res.end();
		}
	}

	dispose(): void {
		this._server.close();

		if (this._ipcHandlePath && process.platform !== 'win32' && fs.existsSync(this._ipcHandlePath)) {
			fs.unlinkSync(this._ipcHandlePath);
		}
	}
}

export class CLIServer extends CLIServerBase {
	constructor(
		@IExtHostCommands commands: IExtHostCommands,
		@ILogService logService: ILogService
	) {
		super(commands, logService, createRandomIPCHandle());
	}
}
