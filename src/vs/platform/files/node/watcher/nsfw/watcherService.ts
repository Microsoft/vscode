/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ProxyChannel, getNextTickChannel } from 'vs/base/parts/ipc/common/ipc';
import { Client } from 'vs/base/parts/ipc/node/ipc.cp';
import { IDiskFileChange, ILogMessage } from 'vs/platform/files/node/watcher/watcher';
import { Disposable } from 'vs/base/common/lifecycle';
import { IWatcherRequest, IWatcherService } from 'vs/platform/files/node/watcher/nsfw/watcher';
import { FileAccess } from 'vs/base/common/network';

export class FileWatcher extends Disposable {

	private static readonly MAX_RESTARTS = 5;

	private service: IWatcherService | undefined;
	private isDisposed: boolean;
	private restartCounter: number;

	constructor(
		private folders: IWatcherRequest[],
		private onDidFilesChange: (changes: IDiskFileChange[]) => void,
		private onLogMessage: (msg: ILogMessage) => void,
		private verboseLogging: boolean,
	) {
		super();

		this.isDisposed = false;
		this.restartCounter = 0;

		this.startWatching();
	}

	private startWatching(): void {
		const client = this._register(new Client(
			FileAccess.asFileUri('bootstrap-fork', require).fsPath,
			{
				serverName: 'File Watcher (nsfw)',
				args: ['--type=watcherService'],
				env: {
					VSCODE_AMD_ENTRYPOINT: 'vs/platform/files/node/watcher/nsfw/watcherApp',
					VSCODE_PIPE_LOGGING: 'true',
					VSCODE_VERBOSE_LOGGING: 'true' // transmit console logs from server to client
				}
			}
		));

		this._register(client.onDidProcessExit(() => {
			// our watcher app should never be completed because it keeps on watching. being in here indicates
			// that the watcher process died and we want to restart it here. we only do it a max number of times
			if (!this.isDisposed) {
				if (this.restartCounter <= FileWatcher.MAX_RESTARTS) {
					this.error('terminated unexpectedly and is restarted again...');
					this.restartCounter++;
					this.startWatching();
				} else {
					this.error('failed to start after retrying for some time, giving up. Please report this as a bug report!');
				}
			}
		}));

		// Initialize watcher
		this.service = ProxyChannel.toService<IWatcherService>(getNextTickChannel(client.getChannel('watcher')));

		this.service.setVerboseLogging(this.verboseLogging);

		this._register(this.service.onDidChangeFile(e => !this.isDisposed && this.onDidFilesChange(e)));
		this._register(this.service.onDidLogMessage(m => this.onLogMessage(m)));

		// Start watching
		this.setFolders(this.folders);
	}

	setVerboseLogging(verboseLogging: boolean): void {
		this.verboseLogging = verboseLogging;
		if (!this.isDisposed && this.service) {
			this.service.setVerboseLogging(verboseLogging);
		}
	}

	error(message: string) {
		this.onLogMessage({ type: 'error', message: `[File Watcher (nsfw)] ${message}` });
	}

	setFolders(folders: IWatcherRequest[]): void {
		this.folders = folders;

		if (this.service) {
			this.service.setRoots(folders);
		}
	}

	override dispose(): void {
		this.isDisposed = true;

		super.dispose();
	}
}
