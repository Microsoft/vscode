/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDiskFileChange, normalizeFileChanges, ILogMessage } from 'vs/platform/files/node/watcher/watcher';
import { Disposable } from 'vs/base/common/lifecycle';
import { SymlinkSupport } from 'vs/base/node/pfs';
import { realpath } from 'vs/base/node/extpath';
import { watchFolder, watchFile, CHANGE_BUFFER_DELAY } from 'vs/base/node/watcher';
import { FileChangeType } from 'vs/platform/files/common/files';
import { ThrottledDelayer } from 'vs/base/common/async';
import { join, basename } from 'vs/base/common/path';

export class FileWatcher extends Disposable {
	private isDisposed: boolean | undefined;

	private fileChangesDelayer: ThrottledDelayer<void> = this._register(new ThrottledDelayer<void>(CHANGE_BUFFER_DELAY * 2 /* sync on delay from underlying library */));
	private fileChangesBuffer: IDiskFileChange[] = [];

	constructor(
		private path: string,
		private onDidFilesChange: (changes: IDiskFileChange[]) => void,
		private onLogMessage: (msg: ILogMessage) => void,
		private verboseLogging: boolean
	) {
		super();

		this.startWatching();
	}

	setVerboseLogging(verboseLogging: boolean): void {
		this.verboseLogging = verboseLogging;
	}

	private async startWatching(): Promise<void> {
		try {
			const { stat, symbolicLink } = await SymlinkSupport.stat(this.path);

			if (this.isDisposed) {
				return;
			}

			let pathToWatch = this.path;
			if (symbolicLink) {
				try {
					pathToWatch = await realpath(pathToWatch);
				} catch (error) {
					this.onError(error);

					if (symbolicLink.dangling) {
						return; // give up if symbolic link is dangling
					}
				}
			}

			// Watch Folder
			if (stat.isDirectory()) {
				this._register(watchFolder(pathToWatch, (eventType, path) => {
					this.onFileChange({
						type: eventType === 'changed' ? FileChangeType.UPDATED : eventType === 'added' ? FileChangeType.ADDED : FileChangeType.DELETED,
						path: join(this.path, basename(path)) // ensure path is identical with what was passed in
					});
				}, error => this.onError(error)));
			}

			// Watch File
			else {
				this._register(watchFile(pathToWatch, eventType => {
					this.onFileChange({
						type: eventType === 'changed' ? FileChangeType.UPDATED : FileChangeType.DELETED,
						path: this.path // ensure path is identical with what was passed in
					});
				}, error => this.onError(error)));
			}
		} catch (error) {
			if (error.code !== 'ENOENT') {
				this.onError(error);
			}
		}
	}

	private onFileChange(event: IDiskFileChange): void {

		// Add to buffer
		this.fileChangesBuffer.push(event);

		// Logging
		if (this.verboseLogging) {
			this.onVerbose(`${event.type === FileChangeType.ADDED ? '[ADDED]' : event.type === FileChangeType.DELETED ? '[DELETED]' : '[CHANGED]'} ${event.path}`);
		}

		// Handle emit through delayer to accommodate for bulk changes and thus reduce spam
		this.fileChangesDelayer.trigger(async () => {
			const fileChanges = this.fileChangesBuffer;
			this.fileChangesBuffer = [];

			// Event normalization
			const normalizedFileChanges = normalizeFileChanges(fileChanges);

			// Logging
			if (this.verboseLogging) {
				normalizedFileChanges.forEach(event => {
					this.onVerbose(`>> normalized ${event.type === FileChangeType.ADDED ? '[ADDED]' : event.type === FileChangeType.DELETED ? '[DELETED]' : '[CHANGED]'} ${event.path}`);
				});
			}

			// Fire
			if (normalizedFileChanges.length > 0) {
				this.onDidFilesChange(normalizedFileChanges);
			}
		});
	}

	private onError(error: string): void {
		if (!this.isDisposed) {
			this.onLogMessage({ type: 'error', message: `[File Watcher (node.js)] ${error}` });
		}
	}

	private onVerbose(message: string): void {
		if (!this.isDisposed) {
			this.onLogMessage({ type: 'trace', message: `[File Watcher (node.js)] ${message}` });
		}
	}

	override dispose(): void {
		this.isDisposed = true;

		super.dispose();
	}
}
