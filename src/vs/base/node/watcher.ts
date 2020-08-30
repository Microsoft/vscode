/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { join, basename } from 'vs/base/common/path';
import { watch } from 'fs';
import { isMacintosh } from 'vs/base/common/platform';
import { normalizeNFC } from 'vs/base/common/normalization';
import { toDisposable, IDisposable, dispose } from 'vs/base/common/lifecycle';
import { exists, readdir } from 'vs/base/node/pfs';

export function watchFile(path: string, onChange: (type: 'added' | 'changed' | 'deleted', path: string) => void, onError: (error: string) => void): IDisposable {
	return doWatchNonRecursive({ path, isDirectory: false }, onChange, onError);
}

export function watchFolder(path: string, onChange: (type: 'added' | 'changed' | 'deleted', path: string) => void, onError: (error: string) => void): IDisposable {
	return doWatchNonRecursive({ path, isDirectory: true }, onChange, onError);
}

export const CHANGE_BUFFER_DELAY = 100;

function doWatchNonRecursive(file: { path: string, isDirectory: boolean }, onChange: (type: 'added' | 'changed' | 'deleted', path: string) => void, onError: (error: string) => void): IDisposable {
	const originalFileName = basename(file.path);
	const mapPathToStatDisposable = new Map<string, IDisposable>();

	let disposed = false;
	let watcherDisposables: IDisposable[] = [toDisposable(() => {
		mapPathToStatDisposable.forEach(disposable => dispose(disposable));
		mapPathToStatDisposable.clear();
	})];

	try {

		// Creating watcher can fail with an exception
		const watcher = watch(file.path);
		watcherDisposables.push(toDisposable(() => {
			watcher.removeAllListeners();
			watcher.close();
		}));

		// Folder: resolve children to emit proper events
		const folderChildren: Set<string> = new Set<string>();
		if (file.isDirectory) {
			readdir(file.path).then(children => children.forEach(child => folderChildren.add(child)));
		}

		watcher.on('error', (code: number, signal: string) => {
			if (!disposed) {
				onError(`Failed to watch ${file.path} for changes using fs.watch() (${code}, ${signal})`);
			}
		});

		watcher.on('change', (type, raw) => {
			if (disposed) {
				return; // ignore if already disposed
			}

			// Normalize file name
			let changedFileName: string = '';
			if (raw) { // https://github.com/Microsoft/vscode/issues/38191
				changedFileName = raw.toString();
				if (isMacintosh) {
					// Mac: uses NFD unicode form on disk, but we want NFC
					// See also https://github.com/nodejs/node/issues/2165
					changedFileName = normalizeNFC(changedFileName);
				}
			}

			if (!changedFileName || (type !== 'change' && type !== 'rename')) {
				return; // ignore unexpected events
			}

			// File path: use path directly for files and join with changed file name otherwise
			const changedFilePath = file.isDirectory ? join(file.path, changedFileName) : file.path;

			// File
			if (!file.isDirectory) {
				if (type === 'rename' || changedFileName !== originalFileName) {
					// The file was either deleted or renamed. Many tools apply changes to files in an
					// atomic way ("Atomic Save") by first renaming the file to a temporary name and then
					// renaming it back to the original name. Our watcher will detect this as a rename
					// and then stops to work on Mac and Linux because the watcher is applied to the
					// inode and not the name. The fix is to detect this case and trying to watch the file
					// again after a certain delay.
					// In addition, we send out a delete event if after a timeout we detect that the file
					// does indeed not exist anymore.

					const timeoutHandle = setTimeout(async () => {
						const fileExists = await exists(changedFilePath);

						if (disposed) {
							return; // ignore if disposed by now
						}

						// File still exists, so emit as change event and reapply the watcher
						if (fileExists) {
							onChange('changed', changedFilePath);

							watcherDisposables = [doWatchNonRecursive(file, onChange, onError)];
						}

						// File seems to be really gone, so emit a deleted event
						else {
							onChange('deleted', changedFilePath);
						}
					}, CHANGE_BUFFER_DELAY);

					// Very important to dispose the watcher which now points to a stale inode
					// and wire in a new disposable that tracks our timeout that is installed
					dispose(watcherDisposables);
					watcherDisposables = [toDisposable(() => clearTimeout(timeoutHandle))];
				} else {
					onChange('changed', changedFilePath);
				}
			}

			// Folder
			else {

				// Children add/delete
				if (type === 'rename') {

					// Cancel any previous stats for this file path if existing
					const statDisposable = mapPathToStatDisposable.get(changedFilePath);
					if (statDisposable) {
						dispose(statDisposable);
					}

					// Wait a bit and try see if the file still exists on disk to decide on the resulting event
					const timeoutHandle = setTimeout(async () => {
						mapPathToStatDisposable.delete(changedFilePath);

						const fileExists = await exists(changedFilePath);

						if (disposed) {
							return; // ignore if disposed by now
						}

						// Figure out the correct event type:
						// File Exists: either 'added' or 'changed' if known before
						// File Does not Exist: always 'deleted'
						let type: 'added' | 'deleted' | 'changed';
						if (fileExists) {
							if (folderChildren.has(changedFileName)) {
								type = 'changed';
							} else {
								type = 'added';
								folderChildren.add(changedFileName);
							}
						} else {
							folderChildren.delete(changedFileName);
							type = 'deleted';
						}

						onChange(type, changedFilePath);
					}, CHANGE_BUFFER_DELAY);

					mapPathToStatDisposable.set(changedFilePath, toDisposable(() => clearTimeout(timeoutHandle)));
				}

				// Other events
				else {

					// Figure out the correct event type: if this is the
					// first time we see this child, it can only be added
					let type: 'added' | 'changed';
					if (folderChildren.has(changedFileName)) {
						type = 'changed';
					} else {
						type = 'added';
						folderChildren.add(changedFileName);
					}

					onChange(type, changedFilePath);
				}
			}
		});
	} catch (error) {
		exists(file.path).then(exists => {
			if (exists && !disposed) {
				onError(`Failed to watch ${file.path} for changes using fs.watch() (${error.toString()})`);
			}
		});
	}

	return toDisposable(() => {
		disposed = true;

		watcherDisposables = dispose(watcherDisposables);
	});
}
