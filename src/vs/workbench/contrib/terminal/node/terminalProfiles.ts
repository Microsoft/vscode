/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as platform from 'vs/base/common/platform';
import { coalesce } from 'vs/base/common/arrays';
import { normalize, basename } from 'vs/base/common/path';
import { enumeratePowerShellInstallations } from 'vs/base/node/powershell';
import { getWindowsBuildNumber } from 'vs/platform/terminal/node/terminalEnvironment';
import { ITerminalProfile } from 'vs/workbench/contrib/terminal/common/terminal';

export interface IStatProvider {
	stat(path: string): boolean,
	lstat(path: string): boolean
}

export function detectAvailableShells(statProvider?: IStatProvider): Promise<ITerminalProfile[]> {
	return platform.isWindows ? detectAvailableWindowsShells(statProvider) : detectAvailableUnixShells();
}

async function detectAvailableWindowsShells(statProvider?: IStatProvider): Promise<ITerminalProfile[]> {
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
		'WSL Bash': [`${system32Path}\\${useWSLexe ? 'wsl.exe' : 'bash.exe'}`],
		'Git Bash': [
			`${process.env['ProgramW6432']}\\Git\\bin\\bash.exe`,
			`${process.env['ProgramW6432']}\\Git\\usr\\bin\\bash.exe`,
			`${process.env['ProgramFiles']}\\Git\\bin\\bash.exe`,
			`${process.env['ProgramFiles']}\\Git\\usr\\bin\\bash.exe`,
			`${process.env['LocalAppData']}\\Programs\\Git\\bin\\bash.exe`,
		],
		'Cygwin': [
			`${process.env['HOMEDRIVE']}\\cygwin64\\bin\\bash.exe`,
			`${process.env['HOMEDRIVE']}\\cygwin\\bin\\bash.exe`
		]
	};

	// Add all of the different kinds of PowerShells
	for await (const pwshExe of enumeratePowerShellInstallations()) {
		expectedLocations[pwshExe.displayName] = [pwshExe.exePath];
	}
	const promises: Promise<ITerminalProfile | undefined>[] = [];
	Object.keys(expectedLocations).forEach(key => promises.push(validateShellPaths(key, expectedLocations[key], statProvider)));
	const shells = await Promise.all(promises);
	//TODO@meganrogge fix this up
	let cygwin = shells.find(shell => shell?.profileName === 'Cygwin');
	let wsl = shells.find(shell => shell?.path.endsWith('wsl.exe'));
	let bashZsh = shells.find(shell => shell?.profileName === 'Git Bash' || shell?.path.endsWith('zsh.exe'));
	if (cygwin) {
		cygwin.args = ['-l'];
	} else if (wsl) {
		wsl.args = ['-l'];
	} else if (bashZsh) {
		bashZsh.args = ['--login'];
	}
	return coalesce(shells);
}

async function detectAvailableUnixShells(): Promise<ITerminalProfile[]> {
	const contents = await fs.promises.readFile('/etc/shells', 'utf8');
	const shells = contents.split('\n').filter(e => e.trim().indexOf('#') !== 0 && e.trim().length > 0);
	return shells.map(e => {
		return {
			profileName: basename(e),
			path: e
		};
	});
}

async function validateShellPaths(label: string, potentialPaths: string[], statProvider?: IStatProvider): Promise<ITerminalProfile | undefined> {
	if (potentialPaths.length === 0) {
		return Promise.resolve(undefined);
	}
	const current = potentialPaths.shift()!;
	if (current! === '') {
		return validateShellPaths(label, potentialPaths, statProvider);
	}
	if (statProvider) {
		if (statProvider.stat(current)) {
			return {
				profileName: label,
				path: current
			};
		}
	} else {
		try {
			const result = await fs.promises.stat(normalize(current));
			if (result.isFile() || result.isSymbolicLink()) {
				return {
					profileName: label,
					path: current
				};
			}
		} catch (e) {
			// Also try using lstat as some symbolic links on Windows
			// throw 'permission denied' using 'stat' but don't throw
			// using 'lstat'
			try {
				const result = await fs.promises.lstat(normalize(current));
				if (result.isFile() || result.isSymbolicLink()) {
					return {
						profileName: label,
						path: current
					};
				}
			}
			catch (e) {
				// noop
			}
		}
	}
	return validateShellPaths(label, potentialPaths, statProvider);
}
