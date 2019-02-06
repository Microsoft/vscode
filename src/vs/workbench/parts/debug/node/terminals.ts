/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as nls from 'vs/nls';
import * as env from 'vs/base/common/platform';
import * as pfs from 'vs/base/node/pfs';
import { assign } from 'vs/base/common/objects';
import { ITerminalLauncher, ITerminalSettings } from 'vs/workbench/parts/debug/common/debug';
import { getPathFromAmdModule } from 'vs/base/common/amd';

const TERMINAL_TITLE = nls.localize('console.title', "VS Code Console");

let terminalLauncher: ITerminalLauncher | undefined = undefined;

export function getTerminalLauncher() {
	if (!terminalLauncher) {
		if (env.isWindows) {
			terminalLauncher = new WinTerminalService();
		} else if (env.isMacintosh) {
			terminalLauncher = new MacTerminalService();
		} else if (env.isLinux) {
			terminalLauncher = new LinuxTerminalService();
		}
	}
	return terminalLauncher;
}

let _DEFAULT_TERMINAL_LINUX_READY: Promise<string> | null = null;
export function getDefaultTerminalLinuxReady(): Promise<string> {
	if (!_DEFAULT_TERMINAL_LINUX_READY) {
		_DEFAULT_TERMINAL_LINUX_READY = new Promise<string>(c => {
			if (env.isLinux) {
				Promise.all([pfs.exists('/etc/debian_version'), process.lazyEnv]).then(([isDebian]) => {
					if (isDebian) {
						c('x-terminal-emulator');
					} else if (process.env.DESKTOP_SESSION === 'gnome' || process.env.DESKTOP_SESSION === 'gnome-classic') {
						c('gnome-terminal');
					} else if (process.env.DESKTOP_SESSION === 'kde-plasma') {
						c('konsole');
					} else if (process.env.COLORTERM) {
						c(process.env.COLORTERM);
					} else if (process.env.TERM) {
						c(process.env.TERM);
					} else {
						c('xterm');
					}
				});
				return;
			}

			c('xterm');
		});
	}
	return _DEFAULT_TERMINAL_LINUX_READY;
}

let _DEFAULT_TERMINAL_WINDOWS: string | null = null;
export function getDefaultTerminalWindows(): string {
	if (!_DEFAULT_TERMINAL_WINDOWS) {
		const isWoW64 = !!process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
		_DEFAULT_TERMINAL_WINDOWS = `${process.env.windir ? process.env.windir : 'C:\\Windows'}\\${isWoW64 ? 'Sysnative' : 'System32'}\\cmd.exe`;
	}
	return _DEFAULT_TERMINAL_WINDOWS;
}

abstract class TerminalLauncher implements ITerminalLauncher {
	public runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments, config: ITerminalSettings): Promise<number | undefined> {
		return this.runInTerminal0(args.title, args.cwd, args.args, args.env || {}, config);
	}
	runInTerminal0(title: string, dir: string, args: string[], envVars: env.IProcessEnvironment, config): Promise<number | undefined> {
		return undefined;
	}
}

class WinTerminalService extends TerminalLauncher {

	private static readonly CMD = 'cmd.exe';

	public runInTerminal0(title: string, dir: string, args: string[], envVars: env.IProcessEnvironment, configuration: ITerminalSettings): Promise<number | undefined> {

		const exec = configuration.external.windowsExec || getDefaultTerminalWindows();

		return new Promise<number | undefined>((c, e) => {

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

			const cmd = cp.spawn(WinTerminalService.CMD, cmdArgs, options);
			cmd.on('error', e);

			c(undefined);
		});
	}
}

class MacTerminalService extends TerminalLauncher {

	private static readonly DEFAULT_TERMINAL_OSX = 'Terminal.app';
	private static readonly OSASCRIPT = '/usr/bin/osascript';	// osascript is the AppleScript interpreter on OS X

	public runInTerminal0(title: string, dir: string, args: string[], envVars: env.IProcessEnvironment, configuration: ITerminalSettings): Promise<number | undefined> {

		const terminalApp = configuration.external.osxExec || MacTerminalService.DEFAULT_TERMINAL_OSX;

		return new Promise<number | undefined>((c, e) => {

			if (terminalApp === MacTerminalService.DEFAULT_TERMINAL_OSX || terminalApp === 'iTerm.app') {

				// On OS X we launch an AppleScript that creates (or reuses) a Terminal window
				// and then launches the program inside that window.

				const script = terminalApp === MacTerminalService.DEFAULT_TERMINAL_OSX ? 'TerminalHelper' : 'iTermHelper';
				const scriptpath = getPathFromAmdModule(require, `vs/workbench/parts/execution/electron-browser/${script}.scpt`);

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
				const osa = cp.spawn(MacTerminalService.OSASCRIPT, osaArgs);
				osa.on('error', e);
				osa.stderr.on('data', (data) => {
					stderr += data.toString();
				});
				osa.on('exit', (code: number) => {
					if (code === 0) {	// OK
						c(undefined);
					} else {
						if (stderr) {
							const lines = stderr.split('\n', 1);
							e(new Error(lines[0]));
						} else {
							e(new Error(nls.localize('mac.terminal.script.failed', "Script '{0}' failed with exit code {1}", script, code)));
						}
					}
				});
			} else {
				e(new Error(nls.localize('mac.terminal.type.not.supported', "'{0}' not supported", terminalApp)));
			}
		});
	}
}

class LinuxTerminalService extends TerminalLauncher {

	private static readonly WAIT_MESSAGE = nls.localize('press.any.key', "Press any key to continue...");

	public runInTerminal0(title: string, dir: string, args: string[], envVars: env.IProcessEnvironment, configuration: ITerminalSettings): Promise<number | undefined> {

		const terminalConfig = configuration.external;
		const execThenable: Promise<string> = terminalConfig.linuxExec ? Promise.resolve(terminalConfig.linuxExec) : getDefaultTerminalLinuxReady();

		return new Promise<number | undefined>((c, e) => {

			let termArgs: string[] = [];
			//termArgs.push('--title');
			//termArgs.push(`"${TERMINAL_TITLE}"`);
			execThenable.then(exec => {
				if (exec.indexOf('gnome-terminal') >= 0) {
					termArgs.push('-x');
				} else {
					termArgs.push('-e');
				}
				termArgs.push('bash');
				termArgs.push('-c');

				const bashCommand = `${quote(args)}; echo; read -p "${LinuxTerminalService.WAIT_MESSAGE}" -n1;`;
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
				cmd.on('error', e);
				cmd.stderr.on('data', (data) => {
					stderr += data.toString();
				});
				cmd.on('exit', (code: number) => {
					if (code === 0) {	// OK
						c(undefined);
					} else {
						if (stderr) {
							const lines = stderr.split('\n', 1);
							e(new Error(lines[0]));
						} else {
							e(new Error(nls.localize('linux.term.failed', "'{0}' failed with exit code {1}", exec, code)));
						}
					}
				});
			});
		});
	}
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


export function hasChildProcesses(processId: number): boolean {
	if (processId) {
		try {
			// if shell has at least one child process, assume that shell is busy
			if (env.isWindows) {
				const result = cp.spawnSync('wmic', ['process', 'get', 'ParentProcessId']);
				if (result.stdout) {
					const pids = result.stdout.toString().split('\r\n');
					if (!pids.some(p => parseInt(p) === processId)) {
						return false;
					}
				}
			} else {
				const result = cp.spawnSync('/usr/bin/pgrep', ['-lP', String(processId)]);
				if (result.stdout) {
					const r = result.stdout.toString().trim();
					if (r.length === 0 || r.indexOf(' tmux') >= 0) { // ignore 'tmux'; see #43683
						return false;
					}
				}
			}
		}
		catch (e) {
			// silently ignore
		}
	}
	// fall back to safe side
	return true;
}

const enum ShellType { cmd, powershell, bash }

export function prepareCommand(args: DebugProtocol.RunInTerminalRequestArguments, config: ITerminalSettings): string {

	let shellType: ShellType;

	// get the shell configuration for the current platform
	let shell: string;
	const shell_config = config.integrated.shell;
	if (env.isWindows) {
		shell = shell_config.windows;
		shellType = ShellType.cmd;
	} else if (env.isLinux) {
		shell = shell_config.linux;
		shellType = ShellType.bash;
	} else if (env.isMacintosh) {
		shell = shell_config.osx;
		shellType = ShellType.bash;
	}

	// try to determine the shell type
	shell = shell.trim().toLowerCase();
	if (shell.indexOf('powershell') >= 0 || shell.indexOf('pwsh') >= 0) {
		shellType = ShellType.powershell;
	} else if (shell.indexOf('cmd.exe') >= 0) {
		shellType = ShellType.cmd;
	} else if (shell.indexOf('bash') >= 0) {
		shellType = ShellType.bash;
	} else if (shell.indexOf('git\\bin\\bash.exe') >= 0) {
		shellType = ShellType.bash;
	}

	let quote: (s: string) => string;
	let command = '';

	switch (shellType) {

		case ShellType.powershell:

			quote = (s: string) => {
				s = s.replace(/\'/g, '\'\'');
				return `'${s}'`;
				//return s.indexOf(' ') >= 0 || s.indexOf('\'') >= 0 || s.indexOf('"') >= 0 ? `'${s}'` : s;
			};

			if (args.cwd) {
				command += `cd '${args.cwd}'; `;
			}
			if (args.env) {
				for (let key in args.env) {
					const value = args.env[key];
					if (value === null) {
						command += `Remove-Item env:${key}; `;
					} else {
						command += `\${env:${key}}='${value}'; `;
					}
				}
			}
			if (args.args && args.args.length > 0) {
				const cmd = quote(args.args.shift());
				command += (cmd[0] === '\'') ? `& ${cmd} ` : `${cmd} `;
				for (let a of args.args) {
					command += `${quote(a)} `;
				}
			}
			break;

		case ShellType.cmd:

			quote = (s: string) => {
				s = s.replace(/\"/g, '""');
				return (s.indexOf(' ') >= 0 || s.indexOf('"') >= 0) ? `"${s}"` : s;
			};

			if (args.cwd) {
				command += `cd ${quote(args.cwd)} && `;
			}
			if (args.env) {
				command += 'cmd /C "';
				for (let key in args.env) {
					let value = args.env[key];
					if (value === null) {
						command += `set "${key}=" && `;
					} else {
						value = value.replace(/[\^\&]/g, s => `^${s}`);
						command += `set "${key}=${value}" && `;
					}
				}
			}
			for (let a of args.args) {
				command += `${quote(a)} `;
			}
			if (args.env) {
				command += '"';
			}
			break;

		case ShellType.bash:

			quote = (s: string) => {
				s = s.replace(/'/g, '\'\\\'\'');
				return `'${s}'`;
			};

			if (args.cwd) {
				command += `cd ${quote(args.cwd)} ; `;
			}
			if (args.env) {
				command += 'env';
				for (let key in args.env) {
					const value = args.env[key];
					if (value === null) {
						command += ` -u ${quote(key)}`;
					} else {
						command += ` ${quote(`${key}=${value}`)}`;
					}
				}
				command += ' ';
			}
			for (let a of args.args) {
				command += `${quote(a)} `;
			}
			break;
	}

	return command;
}
