/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as path from 'vs/base/common/path';
import * as processes from 'vs/base/node/processes';
import * as nls from 'vs/nls';
import * as pfs from 'vs/base/node/pfs';
import * as env from 'vs/base/common/platform';
import { assign } from 'vs/base/common/objects';
import { IExternalTerminalService, IExternalTerminalConfiguration, IExternalTerminalSettings } from 'vs/workbench/contrib/externalTerminal/common/externalTerminal';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { optional } from 'vs/platform/instantiation/common/instantiation';
import { DEFAULT_TERMINAL_OSX } from 'vs/workbench/contrib/externalTerminal/node/externalTerminal';

const TERMINAL_TITLE = nls.localize('console.title', "VS Code Console");

export class WindowsExternalTerminalService implements IExternalTerminalService {
	public _serviceBrand: undefined;

	private static readonly CMD = 'cmd.exe';

	constructor(
		@optional(IConfigurationService) private readonly _configurationService: IConfigurationService
	) {
	}

	public openTerminal(cwd?: string): void {
		if (this._configurationService) {
			const configuration = this._configurationService.getValue<IExternalTerminalConfiguration>();
			this.spawnTerminal(cp, configuration, processes.getWindowsShell(), cwd);
		}
	}

	public runInTerminal(title: string, dir: string, args: string[], envVars: env.IProcessEnvironment, settings: IExternalTerminalSettings): Promise<number | undefined> {

		const exec = settings.windowsExec || WindowsExternalTerminalService.getDefaultTerminalWindows();

		return new Promise<number | undefined>((resolve, reject) => {

			const title = `"${dir} - ${TERMINAL_TITLE}"`;
			const command = `""${args.join('" "')}" & pause"`; // use '|' to only pause on non-zero exit code

			const cmdArgs = [
				'/c', 'start', title, '/wait', exec, '/c', command
			];

			// merge environment variables into a copy of the process.env
			const env = assign({}, process.env, envVars);

			// delete environment variables that have a null value
			Object.keys(env).filter(v => env[v] === null).forEach(key => delete env[key]);

			const options: any = {
				cwd: dir,
				env: env,
				windowsVerbatimArguments: true
			};

			const cmd = cp.spawn(WindowsExternalTerminalService.CMD, cmdArgs, options);
			cmd.on('error', err => {
				reject(improveError(err));
			});

			resolve(undefined);
		});
	}

	private spawnTerminal(spawner: typeof cp, configuration: IExternalTerminalConfiguration, command: string, cwd?: string): Promise<void> {
		const terminalConfig = configuration.terminal.external;
		const exec = terminalConfig.windowsExec || WindowsExternalTerminalService.getDefaultTerminalWindows();

		// Make the drive letter uppercase on Windows (see #9448)
		if (cwd && cwd[1] === ':') {
			cwd = cwd[0].toUpperCase() + cwd.substr(1);
		}

		// cmder ignores the environment cwd and instead opts to always open in %USERPROFILE%
		// unless otherwise specified
		const basename = path.basename(exec).toLowerCase();
		if (basename === 'cmder' || basename === 'cmder.exe') {
			spawner.spawn(exec, cwd ? [cwd] : undefined);
			return Promise.resolve(undefined);
		}

		const cmdArgs = ['/c', 'start', '/wait'];
		if (exec.indexOf(' ') >= 0) {
			// The "" argument is the window title. Without this, exec doesn't work when the path
			// contains spaces
			cmdArgs.push('""');
		}
		cmdArgs.push(exec);
		// Add starting directory parameter for Windows Terminal (see #90734)
		if (basename === 'wt' || basename === 'wt.exe') {
			cmdArgs.push('-d .');
		}

		return new Promise<void>((c, e) => {
			const env = cwd ? { cwd: cwd } : undefined;
			const child = spawner.spawn(command, cmdArgs, env);
			child.on('error', e);
			child.on('exit', () => c());
		});
	}

	private static _DEFAULT_TERMINAL_WINDOWS: string;

	public static getDefaultTerminalWindows(): string {
		if (!WindowsExternalTerminalService._DEFAULT_TERMINAL_WINDOWS) {
			const isWoW64 = !!process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
			WindowsExternalTerminalService._DEFAULT_TERMINAL_WINDOWS = `${process.env.windir ? process.env.windir : 'C:\\Windows'}\\${isWoW64 ? 'Sysnative' : 'System32'}\\cmd.exe`;
		}
		return WindowsExternalTerminalService._DEFAULT_TERMINAL_WINDOWS;
	}
}

export class MacExternalTerminalService implements IExternalTerminalService {
	public _serviceBrand: undefined;

	private static readonly OSASCRIPT = '/usr/bin/osascript';	// osascript is the AppleScript interpreter on OS X

	constructor(
		@optional(IConfigurationService) private readonly _configurationService: IConfigurationService
	) { }

	public openTerminal(cwd?: string): void {
		if (this._configurationService) {
			const configuration = this._configurationService.getValue<IExternalTerminalConfiguration>();
			this.spawnTerminal(cp, configuration, cwd);
		}
	}

	public runInTerminal(title: string, dir: string, args: string[], envVars: env.IProcessEnvironment, settings: IExternalTerminalSettings): Promise<number | undefined> {

		const terminalApp = settings.osxExec || DEFAULT_TERMINAL_OSX;

		return new Promise<number | undefined>((resolve, reject) => {

			if (terminalApp === DEFAULT_TERMINAL_OSX || terminalApp === 'iTerm.app') {

				// On OS X we launch an AppleScript that creates (or reuses) a Terminal window
				// and then launches the program inside that window.

				const script = terminalApp === DEFAULT_TERMINAL_OSX ? 'TerminalHelper' : 'iTermHelper';
				const scriptpath = getPathFromAmdModule(require, `vs/workbench/contrib/externalTerminal/node/${script}.scpt`);

				const osaArgs = [
					scriptpath,
					'-t', title || TERMINAL_TITLE,
					'-w', dir,
				];

				for (let a of args) {
					osaArgs.push('-a');
					osaArgs.push(a);
				}

				if (envVars) {
					for (let key in envVars) {
						const value = envVars[key];
						if (value === null) {
							osaArgs.push('-u');
							osaArgs.push(key);
						} else {
							osaArgs.push('-e');
							osaArgs.push(`${key}=${value}`);
						}
					}
				}

				let stderr = '';
				const osa = cp.spawn(MacExternalTerminalService.OSASCRIPT, osaArgs);
				osa.on('error', err => {
					reject(improveError(err));
				});
				osa.stderr.on('data', (data) => {
					stderr += data.toString();
				});
				osa.on('exit', (code: number) => {
					if (code === 0) {	// OK
						resolve(undefined);
					} else {
						if (stderr) {
							const lines = stderr.split('\n', 1);
							reject(new Error(lines[0]));
						} else {
							reject(new Error(nls.localize('mac.terminal.script.failed', "Script '{0}' failed with exit code {1}", script, code)));
						}
					}
				});
			} else {
				reject(new Error(nls.localize('mac.terminal.type.not.supported', "'{0}' not supported", terminalApp)));
			}
		});
	}

	private spawnTerminal(spawner: typeof cp, configuration: IExternalTerminalConfiguration, cwd?: string): Promise<void> {
		const terminalConfig = configuration.terminal.external;
		const terminalApp = terminalConfig.osxExec || DEFAULT_TERMINAL_OSX;

		return new Promise<void>((c, e) => {
			const args = ['-a', terminalApp];
			if (cwd) {
				args.push(cwd);
			}
			const child = spawner.spawn('/usr/bin/open', args);
			child.on('error', e);
			child.on('exit', () => c());
		});
	}
}

export class LinuxExternalTerminalService implements IExternalTerminalService {
	public _serviceBrand: undefined;

	private static readonly WAIT_MESSAGE = nls.localize('press.any.key', "Press any key to continue...");

	constructor(
		@optional(IConfigurationService) private readonly _configurationService: IConfigurationService
	) { }

	public openTerminal(cwd?: string): void {
		if (this._configurationService) {
			const configuration = this._configurationService.getValue<IExternalTerminalConfiguration>();
			this.spawnTerminal(cp, configuration, cwd);
		}
	}

	public runInTerminal(title: string, dir: string, args: string[], envVars: env.IProcessEnvironment, settings: IExternalTerminalSettings): Promise<number | undefined> {

		const execPromise = settings.linuxExec ? Promise.resolve(settings.linuxExec) : LinuxExternalTerminalService.getDefaultTerminalLinuxReady();

		return new Promise<number | undefined>((resolve, reject) => {

			let termArgs: string[] = [];
			//termArgs.push('--title');
			//termArgs.push(`"${TERMINAL_TITLE}"`);
			execPromise.then(exec => {
				if (exec.indexOf('gnome-terminal') >= 0) {
					termArgs.push('-x');
				} else {
					termArgs.push('-e');
				}
				termArgs.push('bash');
				termArgs.push('-c');

				const bashCommand = `${quote(args)}; echo; read -p "${LinuxExternalTerminalService.WAIT_MESSAGE}" -n1;`;
				termArgs.push(`''${bashCommand}''`);	// wrapping argument in two sets of ' because node is so "friendly" that it removes one set...

				// merge environment variables into a copy of the process.env
				const env = assign({}, process.env, envVars);

				// delete environment variables that have a null value
				Object.keys(env).filter(v => env[v] === null).forEach(key => delete env[key]);

				const options: any = {
					cwd: dir,
					env: env
				};

				let stderr = '';
				const cmd = cp.spawn(exec, termArgs, options);
				cmd.on('error', err => {
					reject(improveError(err));
				});
				cmd.stderr.on('data', (data) => {
					stderr += data.toString();
				});
				cmd.on('exit', (code: number) => {
					if (code === 0) {	// OK
						resolve(undefined);
					} else {
						if (stderr) {
							const lines = stderr.split('\n', 1);
							reject(new Error(lines[0]));
						} else {
							reject(new Error(nls.localize('linux.term.failed', "'{0}' failed with exit code {1}", exec, code)));
						}
					}
				});
			});
		});
	}

	private spawnTerminal(spawner: typeof cp, configuration: IExternalTerminalConfiguration, cwd?: string): Promise<void> {
		const terminalConfig = configuration.terminal.external;
		const execPromise = terminalConfig.linuxExec ? Promise.resolve(terminalConfig.linuxExec) : LinuxExternalTerminalService.getDefaultTerminalLinuxReady();

		return new Promise<void>((c, e) => {
			execPromise.then(exec => {
				const env = cwd ? { cwd } : undefined;
				const child = spawner.spawn(exec, [], env);
				child.on('error', e);
				child.on('exit', () => c());
			});
		});
	}

	private static _DEFAULT_TERMINAL_LINUX_READY: Promise<string>;

	public static async getDefaultTerminalLinuxReady(): Promise<string> {
		if (!LinuxExternalTerminalService._DEFAULT_TERMINAL_LINUX_READY) {
			LinuxExternalTerminalService._DEFAULT_TERMINAL_LINUX_READY = new Promise(async r => {
				if (env.isLinux) {
					const isDebian = await pfs.exists('/etc/debian_version');
					await process.lazyEnv;
					if (isDebian) {
						r('x-terminal-emulator');
					} else if (process.env.DESKTOP_SESSION === 'gnome' || process.env.DESKTOP_SESSION === 'gnome-classic') {
						r('gnome-terminal');
					} else if (process.env.DESKTOP_SESSION === 'kde-plasma') {
						r('konsole');
					} else if (process.env.COLORTERM) {
						r(process.env.COLORTERM);
					} else if (process.env.TERM) {
						r(process.env.TERM);
					} else {
						r('xterm');
					}
				} else {
					r('xterm');
				}
			});
		}
		return LinuxExternalTerminalService._DEFAULT_TERMINAL_LINUX_READY;
	}
}

/**
 * tries to turn OS errors into more meaningful error messages
 */
function improveError(err: Error): Error {
	if ('errno' in err && err['errno'] === 'ENOENT' && 'path' in err && typeof err['path'] === 'string') {
		return new Error(nls.localize('ext.term.app.not.found', "can't find terminal application '{0}'", err['path']));
	}
	return err;
}

/**
 * Quote args if necessary and combine into a space separated string.
 */
function quote(args: string[]): string {
	let r = '';
	for (let a of args) {
		if (a.indexOf(' ') >= 0) {
			r += '"' + a + '"';
		} else {
			r += a;
		}
		r += ' ';
	}
	return r;
}
