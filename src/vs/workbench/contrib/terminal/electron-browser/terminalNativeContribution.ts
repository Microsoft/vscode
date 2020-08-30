/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { IDesktopOpenFileRequest } from 'vs/platform/windows/common/windows';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { getWindowsBuildNumber, linuxDistro } from 'vs/workbench/contrib/terminal/node/terminal';
import { escapeNonWindowsPath } from 'vs/workbench/contrib/terminal/common/terminalEnvironment';
import { execFile } from 'child_process';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { registerRemoteContributions } from 'vs/workbench/contrib/terminal/electron-browser/terminalRemote';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { Disposable } from 'vs/base/common/lifecycle';
import { ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';

export class TerminalNativeContribution extends Disposable implements IWorkbenchContribution {
	public _serviceBrand: undefined;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IInstantiationService readonly instantiationService: IInstantiationService,
		@IRemoteAgentService readonly remoteAgentService: IRemoteAgentService,
		@IElectronService readonly electronService: IElectronService
	) {
		super();

		ipcRenderer.on('vscode:openFiles', (_: unknown, request: IDesktopOpenFileRequest) => this._onOpenFileRequest(request));
		this._register(electronService.onOSResume(() => this._onOsResume()));

		this._terminalService.setLinuxDistro(linuxDistro);
		this._terminalService.setNativeWindowsDelegate({
			getWslPath: this._getWslPath.bind(this),
			getWindowsBuildNumber: this._getWindowsBuildNumber.bind(this)
		});

		const connection = remoteAgentService.getConnection();
		if (connection && connection.remoteAuthority) {
			registerRemoteContributions();
		}
	}

	private _onOsResume(): void {
		const activeTab = this._terminalService.getActiveTab();
		if (!activeTab) {
			return;
		}
		activeTab.terminalInstances.forEach(instance => instance.forceRedraw());
	}

	private async _onOpenFileRequest(request: IDesktopOpenFileRequest): Promise<void> {
		// if the request to open files is coming in from the integrated terminal (identified though
		// the termProgram variable) and we are instructed to wait for editors close, wait for the
		// marker file to get deleted and then focus back to the integrated terminal.
		if (request.termProgram === 'vscode' && request.filesToWait) {
			const waitMarkerFileUri = URI.revive(request.filesToWait.waitMarkerFileUri);
			await this._whenFileDeleted(waitMarkerFileUri);

			// Focus active terminal
			this._terminalService.getActiveInstance()?.focus();
		}
	}

	private _whenFileDeleted(path: URI): Promise<void> {
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
	private _getWslPath(path: string): Promise<string> {
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

	private _getWindowsBuildNumber(): number {
		return getWindowsBuildNumber();
	}
}
