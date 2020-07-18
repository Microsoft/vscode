/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import * as platform from 'vs/base/common/platform';
import * as pty from 'node-pty';
import * as fs from 'fs';
import { Event, Emitter } from 'vs/base/common/event';
import { getWindowsBuildNumber } from 'vs/workbench/contrib/terminal/node/terminal';
import { Disposable } from 'vs/base/common/lifecycle';
import { IShellLaunchConfig, ITerminalChildProcess, ITerminalLaunchError } from 'vs/workbench/contrib/terminal/common/terminal';
import { exec } from 'child_process';
import { ILogService } from 'vs/platform/log/common/log';
import { stat } from 'vs/base/node/pfs';
import { findExecutable } from 'vs/workbench/contrib/terminal/node/terminalEnvironment';
import { URI } from 'vs/base/common/uri';
import { localize } from 'vs/nls';

export class TerminalProcess extends Disposable implements ITerminalChildProcess {
	private _exitCode: number | undefined;
	private _exitMessage: string | undefined;
	private _closeTimeout: any;
	private _ptyProcess: pty.IPty | undefined;
	private _currentTitle: string = '';
	private _processStartupComplete: Promise<void> | undefined;
	private _isDisposed: boolean = false;
	private _titleInterval: NodeJS.Timer | null = null;
	private readonly _initialCwd: string;
	private readonly _ptyOptions: pty.IPtyForkOptions | pty.IWindowsPtyForkOptions;

	public get exitMessage(): string | undefined { return this._exitMessage; }

	private readonly _onProcessData = this._register(new Emitter<string>());
	public get onProcessData(): Event<string> { return this._onProcessData.event; }
	private readonly _onProcessExit = this._register(new Emitter<number>());
	public get onProcessExit(): Event<number> { return this._onProcessExit.event; }
	private readonly _onProcessReady = this._register(new Emitter<{ pid: number, cwd: string }>());
	public get onProcessReady(): Event<{ pid: number, cwd: string }> { return this._onProcessReady.event; }
	private readonly _onProcessTitleChanged = this._register(new Emitter<string>());
	public get onProcessTitleChanged(): Event<string> { return this._onProcessTitleChanged.event; }

	constructor(
		private readonly _shellLaunchConfig: IShellLaunchConfig,
		cwd: string,
		cols: number,
		rows: number,
		env: platform.IProcessEnvironment,
		windowsEnableConpty: boolean,
		@ILogService private readonly _logService: ILogService
	) {
		super();
		let name: string;
		if (platform.isWindows) {
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
			env,
			cols,
			rows,
			useConpty,
			// This option will force conpty to not redraw the whole viewport on launch
			conptyInheritCursor: useConpty && !!_shellLaunchConfig.initialText
		};
	}

	public async start(): Promise<ITerminalLaunchError | undefined> {
		const results = await Promise.all([this._validateCwd(), this._validateExecutable()]);
		const firstError = results.find(r => r !== undefined);
		if (firstError) {
			return firstError;
		}

		try {
			this.setupPtyProcess(this._shellLaunchConfig, this._ptyOptions);
			return undefined;
		} catch (err) {
			this._logService.trace('IPty#spawn native exception', err);
			return { message: `A native exception occurred during launch (${err.message})` };
		}
	}

	private async _validateCwd(): Promise<undefined | ITerminalLaunchError> {
		try {
			const result = await stat(this._initialCwd);
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
			const result = await stat(slc.executable);
			if (!result.isFile() && !result.isSymbolicLink()) {
				return { message: localize('launchFail.executableIsNotFileOrSymlink', "Path to shell executable \"{0}\" is not a file of a symlink", slc.executable) };
			}
		} catch (err) {
			if (err?.code === 'ENOENT') {
				// The executable isn't an absolute path, try find it on the PATH or CWD
				let cwd = slc.cwd instanceof URI ? slc.cwd.path : slc.cwd!;
				const envPaths: string[] | undefined = (slc.env && slc.env.PATH) ? slc.env.PATH.split(path.delimiter) : undefined;
				const executable = await findExecutable(slc.executable!, cwd, envPaths);
				if (!executable) {
					return { message: localize('launchFail.executableDoesNotExist', "Path to shell executable \"{0}\" does not exist", slc.executable) };
				}
			}
		}
		return undefined;
	}

	private setupPtyProcess(shellLaunchConfig: IShellLaunchConfig, options: pty.IPtyForkOptions): void {
		const args = shellLaunchConfig.args || [];
		this._logService.trace('IPty#spawn', shellLaunchConfig.executable, args, options);
		const ptyProcess = pty.spawn(shellLaunchConfig.executable!, args, options);
		this._ptyProcess = ptyProcess;
		this._processStartupComplete = new Promise<void>(c => {
			this.onProcessReady(() => c());
		});
		ptyProcess.onData(data => {
			this._onProcessData.fire(data);
			if (this._closeTimeout) {
				clearTimeout(this._closeTimeout);
				this._queueProcessExit();
			}
		});
		ptyProcess.onExit(e => {
			this._exitCode = e.exitCode;
			this._queueProcessExit();
		});
		this._setupTitlePolling(ptyProcess);
		this._sendProcessId(ptyProcess.pid);
	}

	public dispose(): void {
		this._isDisposed = true;
		if (this._titleInterval) {
			clearInterval(this._titleInterval);
		}
		this._titleInterval = null;
		this._onProcessData.dispose();
		this._onProcessExit.dispose();
		this._onProcessReady.dispose();
		this._onProcessTitleChanged.dispose();
		super.dispose();
	}

	private _setupTitlePolling(ptyProcess: pty.IPty) {
		// Send initial timeout async to give event listeners a chance to init
		setTimeout(() => {
			this._sendProcessTitle(ptyProcess);
		}, 0);
		// Setup polling for non-Windows, for Windows `process` doesn't change
		if (!platform.isWindows) {
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
		this._closeTimeout = setTimeout(() => this._kill(), 250);
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
				this._logService.trace('IPty#kill');
				this._ptyProcess.kill();
			}
		} catch (ex) {
			// Swallow, the pty has already been killed
		}
		this._onProcessExit.fire(this._exitCode || 0);
		this.dispose();
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

	public shutdown(immediate: boolean): void {
		if (immediate) {
			this._kill();
		} else {
			this._queueProcessExit();
		}
	}

	public input(data: string): void {
		if (this._isDisposed || !this._ptyProcess) {
			return;
		}
		this._logService.trace('IPty#write', `${data.length} characters`);
		this._ptyProcess.write(data);
	}

	public resize(cols: number, rows: number): void {
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

	public getInitialCwd(): Promise<string> {
		return Promise.resolve(this._initialCwd);
	}

	public getCwd(): Promise<string> {
		if (platform.isMacintosh) {
			return new Promise<string>(resolve => {
				if (!this._ptyProcess) {
					resolve(this._initialCwd);
					return;
				}
				this._logService.trace('IPty#pid');
				exec('lsof -OPl -p ' + this._ptyProcess.pid + ' | grep cwd', (error, stdout, stderr) => {
					if (stdout !== '') {
						resolve(stdout.substring(stdout.indexOf('/'), stdout.length - 1));
					}
				});
			});
		}

		if (platform.isLinux) {
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

	public getLatency(): Promise<number> {
		return Promise.resolve(0);
	}
}
