/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as platform from 'vs/base/common/platform';
import * as processes from 'vs/base/node/processes';
import { readFile, fileExists, stat } from 'vs/base/node/pfs';
import { LinuxDistro, IShellDefinition } from 'vs/workbench/contrib/terminal/common/terminal';
import { coalesce } from 'vs/base/common/arrays';
import { normalize, basename } from 'vs/base/common/path';

/**
 * Gets the detected default shell for the _system_, not to be confused with VS Code's _default_
 * shell that the terminal uses by default.
 * @param p The platform to detect the shell of.
 */
export function getSystemShell(p: platform.Platform, environment: platform.IProcessEnvironment = process.env as platform.IProcessEnvironment): string {
	if (p === platform.Platform.Windows) {
		if (platform.isWindows) {
			return getSystemShellWindows(environment);
		}
		// Don't detect Windows shell when not on Windows
		return processes.getWindowsShell(environment);
	}
	// Only use $SHELL for the current OS
	if (platform.isLinux && p === platform.Platform.Mac || platform.isMacintosh && p === platform.Platform.Linux) {
		return '/bin/bash';
	}
	return getSystemShellUnixLike(environment);
}

let _TERMINAL_DEFAULT_SHELL_UNIX_LIKE: string | null = null;
function getSystemShellUnixLike(environment: platform.IProcessEnvironment): string {
	if (!_TERMINAL_DEFAULT_SHELL_UNIX_LIKE) {
		let unixLikeTerminal = 'sh';
		if (!platform.isWindows && environment.SHELL) {
			unixLikeTerminal = environment.SHELL;
			// Some systems have $SHELL set to /bin/false which breaks the terminal
			if (unixLikeTerminal === '/bin/false') {
				unixLikeTerminal = '/bin/bash';
			}
		}
		if (platform.isWindows) {
			unixLikeTerminal = '/bin/bash'; // for WSL
		}
		_TERMINAL_DEFAULT_SHELL_UNIX_LIKE = unixLikeTerminal;
	}
	return _TERMINAL_DEFAULT_SHELL_UNIX_LIKE;
}

let _TERMINAL_DEFAULT_SHELL_WINDOWS: string | null = null;
function getSystemShellWindows(environment: platform.IProcessEnvironment): string {
	if (!_TERMINAL_DEFAULT_SHELL_WINDOWS) {
		const isAtLeastWindows10 = platform.isWindows && parseFloat(os.release()) >= 10;
		const is32ProcessOn64Windows = environment.hasOwnProperty('PROCESSOR_ARCHITEW6432');
		const powerShellPath = `${environment.windir}\\${is32ProcessOn64Windows ? 'Sysnative' : 'System32'}\\WindowsPowerShell\\v1.0\\powershell.exe`;
		_TERMINAL_DEFAULT_SHELL_WINDOWS = isAtLeastWindows10 ? powerShellPath : processes.getWindowsShell(environment);
	}
	return _TERMINAL_DEFAULT_SHELL_WINDOWS;
}

let detectedDistro = LinuxDistro.Unknown;
if (platform.isLinux) {
	const file = '/etc/os-release';
	fileExists(file).then(async exists => {
		if (!exists) {
			return;
		}
		const buffer = await readFile(file);
		const contents = buffer.toString();
		if (/NAME="?Fedora"?/.test(contents)) {
			detectedDistro = LinuxDistro.Fedora;
		} else if (/NAME="?Ubuntu"?/.test(contents)) {
			detectedDistro = LinuxDistro.Ubuntu;
		}
	});
}

export const linuxDistro = detectedDistro;

export function getWindowsBuildNumber(): number {
	const osVersion = (/(\d+)\.(\d+)\.(\d+)/g).exec(os.release());
	let buildNumber: number = 0;
	if (osVersion && osVersion.length === 4) {
		buildNumber = parseInt(osVersion[3]);
	}
	return buildNumber;
}

export function detectAvailableShells(): Promise<IShellDefinition[]> {
	return platform.isWindows ? detectAvailableWindowsShells() : detectAvailableUnixShells();
}

async function detectAvailableWindowsShells(): Promise<IShellDefinition[]> {
	// Determine the correct System32 path. We want to point to Sysnative
	// when the 32-bit version of VS Code is running on a 64-bit machine.
	// The reason for this is because PowerShell's important PSReadline
	// module doesn't work if this is not the case. See #27915.
	const is32ProcessOn64Windows = process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
	const system32Path = `${process.env['windir']}\\${is32ProcessOn64Windows ? 'Sysnative' : 'System32'}`;

	let useWSLexe = false;

	if (getWindowsBuildNumber() >= 16299) {
		useWSLexe = true;
	}

	const expectedLocations: { [key: string]: string[] } = {
		'Command Prompt': [`${system32Path}\\cmd.exe`],
		'Windows PowerShell': [`${system32Path}\\WindowsPowerShell\\v1.0\\powershell.exe`],
		'PowerShell': [await getShellPathFromRegistry('pwsh')],
		'WSL Bash': [`${system32Path}\\${useWSLexe ? 'wsl.exe' : 'bash.exe'}`],
		'Git Bash': [
			`${process.env['ProgramW6432']}\\Git\\bin\\bash.exe`,
			`${process.env['ProgramW6432']}\\Git\\usr\\bin\\bash.exe`,
			`${process.env['ProgramFiles']}\\Git\\bin\\bash.exe`,
			`${process.env['ProgramFiles']}\\Git\\usr\\bin\\bash.exe`,
			`${process.env['LocalAppData']}\\Programs\\Git\\bin\\bash.exe`,
		],
		// See #75945
		// Cygwin: [
		// 	`${process.env['HOMEDRIVE']}\\cygwin64\\bin\\bash.exe`,
		// 	`${process.env['HOMEDRIVE']}\\cygwin\\bin\\bash.exe`
		// ]
	};
	const promises: Promise<IShellDefinition | undefined>[] = [];
	Object.keys(expectedLocations).forEach(key => promises.push(validateShellPaths(key, expectedLocations[key])));
	const shells = await Promise.all(promises);
	return coalesce(shells);
}

async function detectAvailableUnixShells(): Promise<IShellDefinition[]> {
	const contents = await readFile('/etc/shells', 'utf8');
	const shells = contents.split('\n').filter(e => e.trim().indexOf('#') !== 0 && e.trim().length > 0);
	return shells.map(e => {
		return {
			label: basename(e),
			path: e
		};
	});
}

async function validateShellPaths(label: string, potentialPaths: string[]): Promise<IShellDefinition | undefined> {
	if (potentialPaths.length === 0) {
		return Promise.resolve(undefined);
	}
	const current = potentialPaths.shift()!;
	if (current! === '') {
		return validateShellPaths(label, potentialPaths);
	}
	try {
		const result = await stat(normalize(current));
		if (result.isFile() || result.isSymbolicLink()) {
			return {
				label,
				path: current
			};
		}
	} catch { /* noop */ }
	return validateShellPaths(label, potentialPaths);
}

async function getShellPathFromRegistry(shellName: string): Promise<string> {
	const Registry = await import('vscode-windows-registry');
	try {
		const shellPath = Registry.GetStringRegKey('HKEY_LOCAL_MACHINE', `SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\${shellName}.exe`, '');
		return shellPath ? shellPath : '';
	} catch (error) {
		return '';
	}
}
