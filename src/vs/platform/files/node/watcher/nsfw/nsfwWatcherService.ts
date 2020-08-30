/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as glob from 'vs/base/common/glob';
import * as extpath from 'vs/base/common/extpath';
import * as path from 'vs/base/common/path';
import * as platform from 'vs/base/common/platform';
import { IDiskFileChange, normalizeFileChanges, ILogMessage } from 'vs/platform/files/node/watcher/watcher';
import * as nsfw from 'vscode-nsfw';
import { IWatcherService, IWatcherRequest, IWatcherOptions } from 'vs/platform/files/node/watcher/nsfw/watcher';
import { ThrottledDelayer } from 'vs/base/common/async';
import { FileChangeType } from 'vs/platform/files/common/files';
import { normalizeNFC } from 'vs/base/common/normalization';
import { Event, Emitter } from 'vs/base/common/event';
import { realcaseSync, realpathSync } from 'vs/base/node/extpath';

const nsfwActionToRawChangeType: { [key: number]: number } = [];
nsfwActionToRawChangeType[nsfw.actions.CREATED] = FileChangeType.ADDED;
nsfwActionToRawChangeType[nsfw.actions.MODIFIED] = FileChangeType.UPDATED;
nsfwActionToRawChangeType[nsfw.actions.DELETED] = FileChangeType.DELETED;

interface IWatcherObjet {
	start(): any;
	stop(): any;
}

interface IPathWatcher {
	ready: Promise<IWatcherObjet>;
	watcher?: IWatcherObjet;
	ignored: glob.ParsedPattern[];
}

export class NsfwWatcherService implements IWatcherService {
	private static readonly FS_EVENT_DELAY = 50; // aggregate and only emit events when changes have stopped for this duration (in ms)

	private _pathWatchers: { [watchPath: string]: IPathWatcher } = {};
	private _verboseLogging: boolean | undefined;
	private enospcErrorLogged: boolean | undefined;

	private readonly _onWatchEvent = new Emitter<IDiskFileChange[]>();
	readonly onWatchEvent = this._onWatchEvent.event;

	private readonly _onLogMessage = new Emitter<ILogMessage>();
	readonly onLogMessage: Event<ILogMessage> = this._onLogMessage.event;

	watch(options: IWatcherOptions): Event<IDiskFileChange[]> {
		return this.onWatchEvent;
	}

	private _watch(request: IWatcherRequest): void {
		let undeliveredFileEvents: IDiskFileChange[] = [];
		const fileEventDelayer = new ThrottledDelayer<void>(NsfwWatcherService.FS_EVENT_DELAY);

		let readyPromiseResolve: (watcher: IWatcherObjet) => void;
		this._pathWatchers[request.path] = {
			ready: new Promise<IWatcherObjet>(resolve => readyPromiseResolve = resolve),
			ignored: Array.isArray(request.excludes) ? request.excludes.map(ignored => glob.parse(ignored)) : []
		};

		process.on('uncaughtException', (e: Error | string) => {

			// Specially handle ENOSPC errors that can happen when
			// the watcher consumes so many file descriptors that
			// we are running into a limit. We only want to warn
			// once in this case to avoid log spam.
			// See https://github.com/Microsoft/vscode/issues/7950
			if (e === 'Inotify limit reached' && !this.enospcErrorLogged) {
				this.enospcErrorLogged = true;
				this.error('Inotify limit reached (ENOSPC)');
			}
		});

		// NSFW does not report file changes in the path provided on macOS if
		// - the path uses wrong casing
		// - the path is a symbolic link
		// We have to detect this case and massage the events to correct this.
		let realBasePathDiffers = false;
		let realBasePathLength = request.path.length;
		if (platform.isMacintosh) {
			try {

				// First check for symbolic link
				let realBasePath = realpathSync(request.path);

				// Second check for casing difference
				if (request.path === realBasePath) {
					realBasePath = (realcaseSync(request.path) || request.path);
				}

				if (request.path !== realBasePath) {
					realBasePathLength = realBasePath.length;
					realBasePathDiffers = true;

					this.warn(`Watcher basePath does not match version on disk and will be corrected (original: ${request.path}, real: ${realBasePath})`);
				}
			} catch (error) {
				// ignore
			}
		}

		if (this._verboseLogging) {
			this.log(`Start watching with nsfw: ${request.path}`);
		}

		nsfw(request.path, events => {
			for (const e of events) {
				// Logging
				if (this._verboseLogging) {
					const logPath = e.action === nsfw.actions.RENAMED ? path.join(e.directory, e.oldFile || '') + ' -> ' + e.newFile : path.join(e.directory, e.file || '');
					this.log(`${e.action === nsfw.actions.CREATED ? '[CREATED]' : e.action === nsfw.actions.DELETED ? '[DELETED]' : e.action === nsfw.actions.MODIFIED ? '[CHANGED]' : '[RENAMED]'} ${logPath}`);
				}

				// Convert nsfw event to IRawFileChange and add to queue
				let absolutePath: string;
				if (e.action === nsfw.actions.RENAMED) {
					// Rename fires when a file's name changes within a single directory
					absolutePath = path.join(e.directory, e.oldFile || '');
					if (!this._isPathIgnored(absolutePath, this._pathWatchers[request.path].ignored)) {
						undeliveredFileEvents.push({ type: FileChangeType.DELETED, path: absolutePath });
					} else if (this._verboseLogging) {
						this.log(` >> ignored ${absolutePath}`);
					}
					absolutePath = path.join(e.newDirectory || e.directory, e.newFile || '');
					if (!this._isPathIgnored(absolutePath, this._pathWatchers[request.path].ignored)) {
						undeliveredFileEvents.push({ type: FileChangeType.ADDED, path: absolutePath });
					} else if (this._verboseLogging) {
						this.log(` >> ignored ${absolutePath}`);
					}
				} else {
					absolutePath = path.join(e.directory, e.file || '');
					if (!this._isPathIgnored(absolutePath, this._pathWatchers[request.path].ignored)) {
						undeliveredFileEvents.push({
							type: nsfwActionToRawChangeType[e.action],
							path: absolutePath
						});
					} else if (this._verboseLogging) {
						this.log(` >> ignored ${absolutePath}`);
					}
				}
			}

			// Delay and send buffer
			fileEventDelayer.trigger(() => {
				const events = undeliveredFileEvents;
				undeliveredFileEvents = [];

				if (platform.isMacintosh) {
					events.forEach(e => {

						// Mac uses NFD unicode form on disk, but we want NFC
						e.path = normalizeNFC(e.path);

						// Convert paths back to original form in case it differs
						if (realBasePathDiffers) {
							e.path = request.path + e.path.substr(realBasePathLength);
						}
					});
				}

				// Broadcast to clients normalized
				const res = normalizeFileChanges(events);
				this._onWatchEvent.fire(res);

				// Logging
				if (this._verboseLogging) {
					res.forEach(r => {
						this.log(` >> normalized ${r.type === FileChangeType.ADDED ? '[ADDED]' : r.type === FileChangeType.DELETED ? '[DELETED]' : '[CHANGED]'} ${r.path}`);
					});
				}

				return Promise.resolve(undefined);
			});
		}).then(watcher => {
			this._pathWatchers[request.path].watcher = watcher;
			const startPromise = watcher.start();
			startPromise.then(() => readyPromiseResolve(watcher));
			return startPromise;
		});
	}

	public setRoots(roots: IWatcherRequest[]): Promise<void> {
		const promises: Promise<void>[] = [];
		const normalizedRoots = this._normalizeRoots(roots);

		// Gather roots that are not currently being watched
		const rootsToStartWatching = normalizedRoots.filter(r => {
			return !(r.path in this._pathWatchers);
		});

		// Gather current roots that don't exist in the new roots array
		const rootsToStopWatching = Object.keys(this._pathWatchers).filter(r => {
			return normalizedRoots.every(normalizedRoot => normalizedRoot.path !== r);
		});

		// Logging
		if (this._verboseLogging) {
			this.log(`Start watching: [${rootsToStartWatching.map(r => r.path).join(',')}]\nStop watching: [${rootsToStopWatching.join(',')}]`);
		}

		// Stop watching some roots
		rootsToStopWatching.forEach(root => {
			this._pathWatchers[root].ready.then(watcher => watcher.stop());
			delete this._pathWatchers[root];
		});

		// Start watching some roots
		rootsToStartWatching.forEach(root => this._watch(root));

		// Refresh ignored arrays in case they changed
		roots.forEach(root => {
			if (root.path in this._pathWatchers) {
				this._pathWatchers[root.path].ignored = Array.isArray(root.excludes) ? root.excludes.map(ignored => glob.parse(ignored)) : [];
			}
		});

		return Promise.all(promises).then(() => undefined);
	}

	public setVerboseLogging(enabled: boolean): Promise<void> {
		this._verboseLogging = enabled;
		return Promise.resolve(undefined);
	}

	public stop(): Promise<void> {
		for (let path in this._pathWatchers) {
			let watcher = this._pathWatchers[path];
			watcher.ready.then(watcher => watcher.stop());
			delete this._pathWatchers[path];
		}
		this._pathWatchers = Object.create(null);
		return Promise.resolve();
	}

	/**
	 * Normalizes a set of root paths by removing any root paths that are
	 * sub-paths of other roots.
	 */
	protected _normalizeRoots(roots: IWatcherRequest[]): IWatcherRequest[] {
		return roots.filter(r => roots.every(other => {
			return !(r.path.length > other.path.length && extpath.isEqualOrParent(r.path, other.path));
		}));
	}

	private _isPathIgnored(absolutePath: string, ignored: glob.ParsedPattern[]): boolean {
		return ignored && ignored.some(i => i(absolutePath));
	}

	private log(message: string) {
		this._onLogMessage.fire({ type: 'trace', message: `[File Watcher (nsfw)] ` + message });
	}

	private warn(message: string) {
		this._onLogMessage.fire({ type: 'warn', message: `[File Watcher (nsfw)] ` + message });
	}

	private error(message: string) {
		this._onLogMessage.fire({ type: 'error', message: `[File Watcher (nsfw)] ` + message });
	}
}
