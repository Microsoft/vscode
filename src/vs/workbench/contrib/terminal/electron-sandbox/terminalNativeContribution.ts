/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ipcRenderer } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { INativeOpenFileRequest } from 'vs/platform/windows/common/windows';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { registerRemoteContributions } from 'vs/workbench/contrib/terminal/electron-sandbox/terminalRemote';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { Disposable } from 'vs/base/common/lifecycle';
import { ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';

export class TerminalNativeContribution extends Disposable implements IWorkbenchContribution {
	declare _serviceBrand: undefined;

	constructor(
		@IFileService private readonly _fileService: IFileService,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IInstantiationService readonly instantiationService: IInstantiationService,
		@IRemoteAgentService readonly remoteAgentService: IRemoteAgentService,
		@INativeHostService readonly nativeHostService: INativeHostService
	) {
		super();

		ipcRenderer.on('vscode:openFiles', (_: unknown, request: INativeOpenFileRequest) => this._onOpenFileRequest(request));
		this._register(nativeHostService.onDidResumeOS(() => this._onOsResume()));

		const connection = remoteAgentService.getConnection();
		if (connection && connection.remoteAuthority) {
			registerRemoteContributions();
		}
	}

	private _onOsResume(): void {
		this._terminalService.terminalInstances.forEach(instance => instance.forceRedraw());
	}

	private async _onOpenFileRequest(request: INativeOpenFileRequest): Promise<void> {
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
}
