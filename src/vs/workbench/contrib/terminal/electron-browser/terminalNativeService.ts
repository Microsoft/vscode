/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { IOpenFileRequest } from 'vs/platform/windows/common/windows';
import { ITerminalNativeService, LinuxDistro } from 'vs/workbench/contrib/terminal/common/terminal';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { getWindowsBuildNumber, linuxDistro } from 'vs/workbench/contrib/terminal/node/terminal';
import { escapeNonWindowsPath } from 'vs/workbench/contrib/terminal/common/terminalEnvironment';
import { execFile } from 'child_process';
import { Emitter, Event } from 'vs/base/common/event';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { registerRemoteContributions } from 'vs/workbench/contrib/terminal/electron-browser/terminalRemote';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { Disposable } from 'vs/base/common/lifecycle';
import { INativeOpenFileRequest } from 'vs/platform/windows/node/window';

export class TerminalNativeService extends Disposable implements ITerminalNativeService {
	public _serviceBrand: undefined;

	public get linuxDistro(): LinuxDistro { return linuxDistro; }

	private readonly _onRequestFocusActiveInstance = this._register(new Emitter<void>());
	public get onRequestFocusActiveInstance(): Event<void> { return this._onRequestFocusActiveInstance.event; }
	private readonly _onOsResume = this._register(new Emitter<void>());
	public get onOsResume(): Event<void> { return this._onOsResume.event; }

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@IInstantiationService readonly instantiationService: IInstantiationService,
		@IRemoteAgentService remoteAgentService: IRemoteAgentService,
		@IElectronService electronService: IElectronService
	) {
		super();

		ipcRenderer.on('vscode:openFiles', (event: unknown, request: IOpenFileRequest) => this._onOpenFileRequest(request));
		this._register(electronService.onOSResume(() => this._onOsResume.fire()));

		const connection = remoteAgentService.getConnection();
		if (connection && connection.remoteAuthority) {
			registerRemoteContributions();
		}
	}

	private async _onOpenFileRequest(request: INativeOpenFileRequest): Promise<void> {
		// if the request to open files is coming in from the integrated terminal (identified though
		// the termProgram variable) and we are instructed to wait for editors close, wait for the
		// marker file to get deleted and then focus back to the integrated terminal.
		if (request.termProgram === 'vscode' && request.filesToWait) {
			const waitMarkerFileUri = URI.revive(request.filesToWait.waitMarkerFileUri);
			await this.whenFileDeleted(waitMarkerFileUri);
			this._onRequestFocusActiveInstance.fire();
		}
	}

	public whenFileDeleted(path: URI): Promise<void> {
		// Complete when wait marker file is deleted
		return new Promise<void>(resolve => {
			let running = false;
			const interval = setInterval(async () => {
				if (!running) {
					running = true;
					const exists = await this._fileService.exists(path);
					running = false;

					if (!exists) {
						clearInterval(interval);
						resolve(undefined);
					}
				}
			}, 1000);
		});
	}

	/**
	 * Converts a path to a path on WSL using the wslpath utility.
	 * @param path The original path.
	 */
	public getWslPath(path: string): Promise<string> {
		if (getWindowsBuildNumber() < 17063) {
			throw new Error('wslpath does not exist on Windows build < 17063');
		}
		return new Promise<string>(c => {
			const proc = execFile('bash.exe', ['-c', `wslpath ${escapeNonWindowsPath(path)}`], {}, (error, stdout, stderr) => {
				c(escapeNonWindowsPath(stdout.trim()));
			});
			proc.stdin!.end();
		});
	}

	public getWindowsBuildNumber(): number {
		return getWindowsBuildNumber();
	}
}
