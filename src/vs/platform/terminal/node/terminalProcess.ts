/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import type * as pty from 'node-pty';
import * as fs from 'fs';
import * as os from 'os';
import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IShellLaunchConfig, ITerminalLaunchError, FlowControlConstants, ITerminalChildProcess, ITerminalDimensionsOverride, TerminalShellType } from 'vs/platform/terminal/common/terminal';
import { exec } from 'child_process';
import { ILogService } from 'vs/platform/log/common/log';
import { findExecutable, getWindowsBuildNumber } from 'vs/platform/terminal/node/terminalEnvironment';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';
import { WindowsShellHelper } from 'vs/platform/terminal/node/windowsShellHelper';
import { IProcessEnvironment, isLinux, isMacintosh, isWindows } from 'vs/base/common/platform';
import { timeout } from 'vs/base/common/async';

// Writing large amounts of data can be corrupted for some reason, after looking into this is
// appears to be a race condition around writing to the FD which may be based on how powerful the
// hardware is. The workaround for this is to space out when large amounts of data is being written
// to the terminal. See https://github.com/microsoft/vscode/issues/38137
const WRITE_MAX_CHUNK_SIZE = 50;
const WRITE_INTERVAL_MS = 5;

const enum ShutdownConstants {
	/**
	 * The amount of ms that must pass between data events after exit is queued before the actual
	 * kill call is triggered. This data flush mechanism works around an [issue in node-pty][1]
	 * where not all data is flushed which causes problems for task problem matchers. Additionally
	 * on Windows under conpty, killing a process while data is being output will cause the [conhost
	 * flush to hang the pty host][2] because [conhost should be hosted on another thread][3].
	 *
	 * [1]: https://github.com/Tyriar/node-pty/issues/72
	 * [2]: https://github.com/microsoft/vscode/issues/71966
	 * [3]: https://github.com/microsoft/node-pty/pull/415
	 */
	DataFlushTimeout = 250,
	/**
	 * The maximum ms to allow after dispose is called because forcefully killing the process.
	 */
	MaximumShutdownTime = 5000
}

const enum Constants {
	/**
	 * The minimum duration between kill and spawn calls on Windows/conpty as a mitigation for a
	 * hang issue. See:
	 * - https://github.com/microsoft/vscode/issues/71966
	 * - https://github.com/microsoft/vscode/issues/117956
	 * - https://github.com/microsoft/vscode/issues/121336
	 */
	KillSpawnThrottleInterval = 250,
	/**
	 * The amount of time to wait when a call is throttles beyond the exact amount, this is used to
	 * try prevent early timeouts causing a kill/spawn call to happen at double the regular
	 * interval.
	 */
	KillSpawnSpacingDuration = 50,
}

interface IWriteObject {
	data: string,
	isBinary: boolean
}

export class TerminalProcess extends Disposable implements ITerminalChildProcess {
	readonly id = 0;
	readonly shouldPersist = false;

	private static _lastKillOrStart = 0;

	private _exitCode: number | undefined;
	private _exitMessage: string | undefined;
	private _closeTimeout: any;
	private _ptyProcess: pty.IPty | undefined;
	private _currentTitle: string = '';
	private _processStartupComplete: Promise<void> | undefined;
	private _isDisposed: boolean = false;
	private _windowsShellHelper: WindowsShellHelper | undefined;
	private _titleInterval: NodeJS.Timer | null = null;
	private _writeQueue: IWriteObject[] = [];
	private _writeTimeout: NodeJS.Timeout | undefined;
	private _delayedResizer: DelayedResizer | undefined;
	private readonly _initialCwd: string;
	private readonly _ptyOptions: pty.IPtyForkOptions | pty.IWindowsPtyForkOptions;

	private _isPtyPaused: boolean = false;
	private _unacknowledgedCharCount: number = 0;
	get exitMessage(): string | undefined { return this._exitMessage; }

	get currentTitle(): string { return this._windowsShellHelper?.shellTitle || this._currentTitle; }
	get shellType(): TerminalShellType { return this._windowsShellHelper ? this._windowsShellHelper.shellType : undefined; }

	private readonly _onProcessData = this._register(new Emitter<string>());
	get onProcessData(): Event<string> { return this._onProcessData.event; }
	private readonly _onProcessExit = this._register(new Emitter<number>());
	get onProcessExit(): Event<number> { return this._onProcessExit.event; }
	private readonly _onProcessReady = this._register(new Emitter<{ pid: number, cwd: string }>());
	get onProcessReady(): Event<{ pid: number, cwd: string }> { return this._onProcessReady.event; }
	private readonly _onProcessTitleChanged = this._register(new Emitter<string>());
	get onProcessTitleChanged(): Event<string> { return this._onProcessTitleChanged.event; }
	private readonly _onProcessShellTypeChanged = this._register(new Emitter<TerminalShellType>());
	readonly onProcessShellTypeChanged = this._onProcessShellTypeChanged.event;

	constructor(
		private readonly _shellLaunchConfig: IShellLaunchConfig,
		cwd: string,
		cols: number,
		rows: number,
		env: IProcessEnvironment,
		/**
		 * environment used for `findExecutable`
		 */
		private readonly _executableEnv: IProcessEnvironment,
		windowsEnableConpty: boolean,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		let name: string;
		if (isWindows) {
			name = path.basename(this._shellLaunchConfig.executable || '');
		} else {
			// Using 'xterm-256color' here helps ensure that the majority of Linux distributions will use a
			// color prompt as defined in the default ~/.bashrc file.
			name = 'xterm-256color';
		}
		this._initialCwd = cwd;
		const useConpty = windowsEnableConpty && process.platform === 'win32' && getWindowsBuildNumber() >= 18309;
		this._ptyOptions = {
			name,
			cwd,
			// TODO: When node-pty is updated this cast can be removed
			env: env as { [key: string]: string; },
			cols,
			rows,
			useConpty,
			// This option will force conpty to not redraw the whole viewport on launch
			conptyInheritCursor: useConpty && !!_shellLaunchConfig.initialText
		};
		// Delay resizes to avoid conpty not respecting very early resize calls
		if (isWindows) {
			if (useConpty && cols === 0 && rows === 0 && this._shellLaunchConfig.executable?.endsWith('Git\\bin\\bash.exe')) {
				this._delayedResizer = new DelayedResizer();
				this._register(this._delayedResizer.onTrigger(dimensions => {
					this._delayedResizer?.dispose();
					this._delayedResizer = undefined;
					if (dimensions.cols && dimensions.rows) {
						this.resize(dimensions.cols, dimensions.rows);
					}
				}));
			}
			// WindowsShellHelper is used to fetch the process title and shell type
			this.onProcessReady(e => {
				this._windowsShellHelper = this._register(new WindowsShellHelper(e.pid));
				this._register(this._windowsShellHelper.onShellTypeChanged(e => this._onProcessShellTypeChanged.fire(e)));
				this._register(this._windowsShellHelper.onShellNameChanged(e => this._onProcessTitleChanged.fire(e)));
			});
		}
	}
	onProcessOverrideDimensions?: Event<ITerminalDimensionsOverride | undefined> | undefined;
	onProcessResolvedShellLaunchConfig?: Event<IShellLaunchConfig> | undefined;

	async start(): Promise<ITerminalLaunchError | undefined> {
		const results = await Promise.all([this._validateCwd(), this._validateExecutable()]);
		const firstError = results.find(r => r !== undefined);
		if (firstError) {
			return firstError;
		}

		try {
			await this.setupPtyProcess(this._shellLaunchConfig, this._ptyOptions);
			return undefined;
		} catch (err) {
			this._logService.trace('IPty#spawn native exception', err);
			return { message: `A native exception occurred during launch (${err.message})` };
		}
	}

	private async _validateCwd(): Promise<undefined | ITerminalLaunchError> {
		try {
			const result = await fs.promises.stat(this._initialCwd);
			if (!result.isDirectory()) {
				return { message: localize('launchFail.cwdNotDirectory', "Starting directory (cwd) \"{0}\" is not a directory", this._initialCwd.toString()) };
			}
		} catch (err) {
			if (err?.code === 'ENOENT') {
				return { message: localize('launchFail.cwdDoesNotExist', "Starting directory (cwd) \"{0}\" does not exist", this._initialCwd.toString()) };
			}
		}
		return undefined;
	}

	private async _validateExecutable(): Promise<undefined | ITerminalLaunchError> {
		const slc = this._shellLaunchConfig;
		if (!slc.executable) {
			throw new Error('IShellLaunchConfig.executable not set');
		}
		try {
			const result = await fs.promises.stat(slc.executable);
			if (!result.isFile() && !result.isSymbolicLink()) {
				return { message: localize('launchFail.executableIsNotFileOrSymlink', "Path to shell executable \"{0}\" is not a file of a symlink", slc.executable) };
			}
		} catch (err) {
			if (err?.code === 'ENOENT') {
				// The executable isn't an absolute path, try find it on the PATH or CWD
				let cwd = slc.cwd instanceof URI ? slc.cwd.path : slc.cwd!;
				const envPaths: string[] | undefined = (slc.env && slc.env.PATH) ? slc.env.PATH.split(path.delimiter) : undefined;
				const executable = await findExecutable(slc.executable!, cwd, envPaths, this._executableEnv);
				if (!executable) {
					return { message: localize('launchFail.executableDoesNotExist', "Path to shell executable \"{0}\" does not exist", slc.executable) };
				}
				// Set the executable explicitly here so that node-pty doesn't need to search the
				// $PATH too.
				slc.executable = executable;
			}
		}
		return undefined;
	}

	private async setupPtyProcess(shellLaunchConfig: IShellLaunchConfig, options: pty.IPtyForkOptions): Promise<void> {
		const args = shellLaunchConfig.args || [];
		await this._throttleKillSpawn();
		this._logService.trace('IPty#spawn', shellLaunchConfig.executable, args, options);
		const ptyProcess = (await import('node-pty')).spawn(shellLaunchConfig.executable!, args, options);
		this._ptyProcess = ptyProcess;
		this._processStartupComplete = new Promise<void>(c => {
			this.onProcessReady(() => c());
		});
		ptyProcess.onData(data => {
			// Handle flow control
			this._unacknowledgedCharCount += data.length;
			if (!this._isPtyPaused && this._unacknowledgedCharCount > FlowControlConstants.HighWatermarkChars) {
				this._logService.trace(`Flow control: Pause (${this._unacknowledgedCharCount} > ${FlowControlConstants.HighWatermarkChars})`);
				this._isPtyPaused = true;
				ptyProcess.pause();
			}


			// Refire the data event
			this._onProcessData.fire(data);
			if (this._closeTimeout) {
				this._queueProcessExit();
			}
			this._windowsShellHelper?.checkShell();
		});
		ptyProcess.onExit(e => {
			this._exitCode = e.exitCode;
			this._queueProcessExit();
		});
		this._setupTitlePolling(ptyProcess);
		this._sendProcessId(ptyProcess.pid);
	}

	override dispose(): void {
		this._isDisposed = true;
		if (this._titleInterval) {
			clearInterval(this._titleInterval);
		}
		this._titleInterval = null;
		super.dispose();
	}

	private _setupTitlePolling(ptyProcess: pty.IPty) {
		// Send initial timeout async to give event listeners a chance to init
		setTimeout(() => this._sendProcessTitle(ptyProcess), 0);
		// Setup polling for non-Windows, for Windows `process` doesn't change
		if (!isWindows) {
			this._titleInterval = setInterval(() => {
				if (this._currentTitle !== ptyProcess.process) {
					this._sendProcessTitle(ptyProcess);
				}
			}, 200);
		}
	}

	// Allow any trailing data events to be sent before the exit event is sent.
	// See https://github.com/Tyriar/node-pty/issues/72
	private _queueProcessExit() {
		if (this._closeTimeout) {
			clearTimeout(this._closeTimeout);
		}
		this._closeTimeout = setTimeout(() => {
			this._closeTimeout = undefined;
			this._kill();
		}, ShutdownConstants.DataFlushTimeout);
	}

	private async _kill(): Promise<void> {
		// Wait to kill to process until the start up code has run. This prevents us from firing a process exit before a
		// process start.
		await this._processStartupComplete;
		if (this._isDisposed) {
			return;
		}
		// Attempt to kill the pty, it may have already been killed at this
		// point but we want to make sure
		try {
			if (this._ptyProcess) {
				await this._throttleKillSpawn();
				this._logService.trace('IPty#kill');
				this._ptyProcess.kill();
			}
		} catch (ex) {
			// Swallow, the pty has already been killed
		}
		this._onProcessExit.fire(this._exitCode || 0);
		this.dispose();
	}

	private async _throttleKillSpawn(): Promise<void> {
		// Only throttle on Windows/conpty
		if (!isWindows || !('useConpty' in this._ptyOptions) || !this._ptyOptions.useConpty) {
			return;
		}
		// Use a loop to ensure multiple calls in a single interval space out
		while (Date.now() - TerminalProcess._lastKillOrStart < Constants.KillSpawnThrottleInterval) {
			this._logService.trace('Throttling kill/spawn call');
			await timeout(Constants.KillSpawnThrottleInterval - (Date.now() - TerminalProcess._lastKillOrStart) + Constants.KillSpawnSpacingDuration);
		}
		TerminalProcess._lastKillOrStart = Date.now();
	}

	private _sendProcessId(pid: number) {
		this._onProcessReady.fire({ pid, cwd: this._initialCwd });
	}

	private _sendProcessTitle(ptyProcess: pty.IPty): void {
		if (this._isDisposed) {
			return;
		}
		this._currentTitle = ptyProcess.process;
		this._onProcessTitleChanged.fire(this._currentTitle);
	}

	shutdown(immediate: boolean): void {
		// don't force immediate disposal of the terminal processes on Windows as an additional
		// mitigation for https://github.com/microsoft/vscode/issues/71966 which causes the pty host
		// to become unresponsive, disconnecting all terminals across all windows.
		if (immediate && !isWindows) {
			this._kill();
		} else {
			if (!this._closeTimeout && !this._isDisposed) {
				this._queueProcessExit();
				// Allow a maximum amount of time for the process to exit, otherwise force kill it
				setTimeout(() => {
					if (this._closeTimeout && !this._isDisposed) {
						this._closeTimeout = undefined;
						this._kill();
					}
				}, ShutdownConstants.MaximumShutdownTime);
			}
		}
	}

	input(data: string, isBinary?: boolean): void {
		if (this._isDisposed || !this._ptyProcess) {
			return;
		}
		for (let i = 0; i <= Math.floor(data.length / WRITE_MAX_CHUNK_SIZE); i++) {
			const obj = {
				isBinary: isBinary || false,
				data: data.substr(i * WRITE_MAX_CHUNK_SIZE, WRITE_MAX_CHUNK_SIZE)
			};
			this._writeQueue.push(obj);
		}
		this._startWrite();
	}

	async processBinary(data: string): Promise<void> {
		this.input(data, true);
	}

	private _startWrite(): void {
		// Don't write if it's already queued of is there is nothing to write
		if (this._writeTimeout !== undefined || this._writeQueue.length === 0) {
			return;
		}

		this._doWrite();

		// Don't queue more writes if the queue is empty
		if (this._writeQueue.length === 0) {
			this._writeTimeout = undefined;
			return;
		}

		// Queue the next write
		this._writeTimeout = setTimeout(() => {
			this._writeTimeout = undefined;
			this._startWrite();
		}, WRITE_INTERVAL_MS);
	}

	private _doWrite(): void {
		const object = this._writeQueue.shift()!;
		if (object.isBinary) {
			this._ptyProcess!.write(Buffer.from(object.data, 'binary') as any);
		} else {
			this._ptyProcess!.write(object.data);
		}
	}

	resize(cols: number, rows: number): void {
		if (this._isDisposed) {
			return;
		}
		if (typeof cols !== 'number' || typeof rows !== 'number' || isNaN(cols) || isNaN(rows)) {
			return;
		}
		// Ensure that cols and rows are always >= 1, this prevents a native
		// exception in winpty.
		if (this._ptyProcess) {
			cols = Math.max(cols, 1);
			rows = Math.max(rows, 1);

			// Delay resize if needed
			if (this._delayedResizer) {
				this._delayedResizer.cols = cols;
				this._delayedResizer.rows = rows;
				return;
			}

			this._logService.trace('IPty#resize', cols, rows);
			try {
				this._ptyProcess.resize(cols, rows);
			} catch (e) {
				// Swallow error if the pty has already exited
				this._logService.trace('IPty#resize exception ' + e.message);
				if (this._exitCode !== undefined && e.message !== 'ioctl(2) failed, EBADF') {
					throw e;
				}
			}
		}
	}

	acknowledgeDataEvent(charCount: number): void {
		// Prevent lower than 0 to heal from errors
		this._unacknowledgedCharCount = Math.max(this._unacknowledgedCharCount - charCount, 0);
		this._logService.trace(`Flow control: Ack ${charCount} chars (unacknowledged: ${this._unacknowledgedCharCount})`);
		if (this._isPtyPaused && this._unacknowledgedCharCount < FlowControlConstants.LowWatermarkChars) {
			this._logService.trace(`Flow control: Resume (${this._unacknowledgedCharCount} < ${FlowControlConstants.LowWatermarkChars})`);
			this._ptyProcess?.resume();
			this._isPtyPaused = false;
		}
	}

	clearUnacknowledgedChars(): void {
		this._unacknowledgedCharCount = 0;
		this._logService.trace(`Flow control: Cleared all unacknowledged chars, forcing resume`);
		if (this._isPtyPaused) {
			this._ptyProcess?.resume();
			this._isPtyPaused = false;
		}
	}

	getInitialCwd(): Promise<string> {
		return Promise.resolve(this._initialCwd);
	}

	getCwd(): Promise<string> {
		if (isMacintosh) {
			// Disable cwd lookup on macOS Big Sur due to spawn blocking thread (darwin v20 is macOS
			// Big Sur) https://github.com/Microsoft/vscode/issues/105446
			const osRelease = os.release().split('.');
			if (osRelease.length > 0 && parseInt(osRelease[0]) < 20) {
				return new Promise<string>(resolve => {
					if (!this._ptyProcess) {
						resolve(this._initialCwd);
						return;
					}
					this._logService.trace('IPty#pid');
					exec('lsof -OPln -p ' + this._ptyProcess.pid + ' | grep cwd', (error, stdout, stderr) => {
						if (!error && stdout !== '') {
							resolve(stdout.substring(stdout.indexOf('/'), stdout.length - 1));
						} else {
							this._logService.error('lsof did not run successfully, it may not be on the $PATH?', error, stdout, stderr);
							resolve(this._initialCwd);
						}
					});
				});
			}
		}

		if (isLinux) {
			return new Promise<string>(resolve => {
				if (!this._ptyProcess) {
					resolve(this._initialCwd);
					return;
				}
				this._logService.trace('IPty#pid');
				fs.readlink('/proc/' + this._ptyProcess.pid + '/cwd', (err, linkedstr) => {
					if (err) {
						resolve(this._initialCwd);
					}
					resolve(linkedstr);
				});
			});
		}

		return new Promise<string>(resolve => {
			resolve(this._initialCwd);
		});
	}

	getLatency(): Promise<number> {
		return Promise.resolve(0);
	}
}

/**
 * Tracks the latest resize event to be trigger at a later point.
 */
class DelayedResizer extends Disposable {
	rows: number | undefined;
	cols: number | undefined;
	private _timeout: NodeJS.Timeout;

	private readonly _onTrigger = this._register(new Emitter<{ rows?: number, cols?: number }>());
	get onTrigger(): Event<{ rows?: number, cols?: number }> { return this._onTrigger.event; }

	constructor() {
		super();
		this._timeout = setTimeout(() => {
			this._onTrigger.fire({ rows: this.rows, cols: this.cols });
		}, 1000);
		this._register({
			dispose: () => {
				clearTimeout(this._timeout);
			}
		});
	}

	override dispose(): void {
		super.dispose();
		clearTimeout(this._timeout);
	}
}
