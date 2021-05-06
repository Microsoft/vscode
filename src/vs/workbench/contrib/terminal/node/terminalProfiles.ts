/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { normalize, basename, delimiter } from 'vs/base/common/path';
import { enumeratePowerShellInstallations } from 'vs/base/node/powershell';
import { findExecutable, getWindowsBuildNumber } from 'vs/platform/terminal/node/terminalEnvironment';
import { ITerminalProfile, ITerminalProfileObject, ProfileSource, TerminalSettingId } from 'vs/workbench/contrib/terminal/common/terminal';
import * as cp from 'child_process';
import { ExtHostVariableResolverService } from 'vs/workbench/api/common/extHostDebugService';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { ILogService } from 'vs/platform/log/common/log';
import * as pfs from 'vs/base/node/pfs';
import { ITerminalEnvironment, SafeConfigProvider } from 'vs/platform/terminal/common/terminal';
import { Codicon } from 'vs/base/common/codicons';
import { isMacintosh, isWindows } from 'vs/base/common/platform';

let profileSources: Map<string, IPotentialTerminalProfile> | undefined;

export function detectAvailableProfiles(configuredProfilesOnly: boolean, safeConfigProvider: SafeConfigProvider, fsProvider?: IFsProvider, logService?: ILogService, variableResolver?: ExtHostVariableResolverService, workspaceFolder?: IWorkspaceFolder, testPaths?: string[]): Promise<ITerminalProfile[]> {
	fsProvider = fsProvider || {
		existsFile: pfs.SymlinkSupport.existsFile,
		readFile: fs.promises.readFile
	};
	if (isWindows) {
		return detectAvailableWindowsProfiles(
			configuredProfilesOnly,
			fsProvider,
			logService,
			safeConfigProvider(TerminalSettingId.UseWslProfiles) || true,
			safeConfigProvider(TerminalSettingId.ProfilesWindows),
			variableResolver,
			workspaceFolder
		);
	}
	return detectAvailableUnixProfiles(
		fsProvider,
		logService,
		configuredProfilesOnly,
		safeConfigProvider(isMacintosh ? TerminalSettingId.ProfilesMacOs : TerminalSettingId.ProfilesLinux),
		testPaths,
		variableResolver,
		workspaceFolder
	);
}

async function detectAvailableWindowsProfiles(configuredProfilesOnly: boolean, fsProvider: IFsProvider, logService?: ILogService, useWslProfiles?: boolean, configProfiles?: { [key: string]: ITerminalProfileObject }, variableResolver?: ExtHostVariableResolverService, workspaceFolder?: IWorkspaceFolder): Promise<ITerminalProfile[]> {
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

	await initializeWindowsProfiles();

	const detectedProfiles: Map<string, ITerminalProfileObject> = new Map();

	// Add auto detected profiles
	if (!configuredProfilesOnly) {
		detectedProfiles.set('PowerShell', {
			source: ProfileSource.Pwsh,
			icon: Codicon.terminalPowershell.id,
			isAutoDetected: true
		});
		detectedProfiles.set('Windows PowerShell', {
			path: `${system32Path}\\WindowsPowerShell\\v1.0\\powershell.exe`,
			icon: Codicon.terminalPowershell.id,
			isAutoDetected: true
		});
		detectedProfiles.set('Git Bash', { source: ProfileSource.GitBash, isAutoDetected: true });
		detectedProfiles.set('Cygwin', {
			path: [
				`${process.env['HOMEDRIVE']}\\cygwin64\\bin\\bash.exe`,
				`${process.env['HOMEDRIVE']}\\cygwin\\bin\\bash.exe`
			],
			args: ['--login'],
			isAutoDetected: true
		});
		detectedProfiles.set('Command Prompt',
			{
				path: `${system32Path}\\cmd.exe`,
				icon: Codicon.terminalCmd.id,
				isAutoDetected: true
			},
		);
	}

	applyConfigProfilesToMap(configProfiles, detectedProfiles);

	const resultProfiles: ITerminalProfile[] = await transformToTerminalProfiles(detectedProfiles.entries(), fsProvider, logService, variableResolver, workspaceFolder);

	if (!configuredProfilesOnly || (configuredProfilesOnly && useWslProfiles)) {
		try {
			const result = await getWslProfiles(`${system32Path}\\${useWSLexe ? 'wsl.exe' : 'bash.exe'}`, useWslProfiles);
			if (result) {
				resultProfiles.push(...result);
			}
		} catch (e) {
			logService?.info('WSL is not installed, so could not detect WSL profiles');
		}
	}

	return resultProfiles;
}

async function transformToTerminalProfiles(entries: IterableIterator<[string, ITerminalProfileObject]>, fsProvider: IFsProvider, logService?: ILogService, variableResolver?: ExtHostVariableResolverService, workspaceFolder?: IWorkspaceFolder): Promise<ITerminalProfile[]> {
	const resultProfiles: ITerminalProfile[] = [];
	for (const [profileName, profile] of entries) {
		if (profile === null) { continue; }
		let originalPaths: string[];
		let args: string[] | string | undefined;
		let icon: string | undefined;
		if ('source' in profile) {
			const source = profileSources?.get(profile.source);
			if (!source) {
				continue;
			}
			originalPaths = source.paths;

			// if there are configured args, override the default ones
			args = profile.args || source.args;
			icon = profile.icon || source.icon;
		} else {
			originalPaths = Array.isArray(profile.path) ? profile.path : [profile.path];
			args = isWindows ? profile.args : Array.isArray(profile.args) ? profile.args : undefined;
			icon = profile.icon;
		}

		const paths = originalPaths.slice();

		for (let i = 0; i < paths.length; i++) {
			paths[i] = await variableResolver?.resolveAsync(workspaceFolder, paths[i]) || paths[i];
		}
		const validatedProfile = await validateProfilePaths(profileName, paths, fsProvider, args, profile.env, profile.overrideName, profile.isAutoDetected, logService);
		if (validatedProfile) {
			validatedProfile.isAutoDetected = profile.isAutoDetected;
			validatedProfile.icon = icon;
			resultProfiles.push(validatedProfile);
		} else {
			logService?.trace('profile not validated', profileName, originalPaths);
		}
	}
	return resultProfiles;
}

async function initializeWindowsProfiles(): Promise<void> {
	if (profileSources) {
		return;
	}

	profileSources = new Map();
	profileSources.set(
		'Git Bash', {
		profileName: 'Git Bash',
		paths: [
			`${process.env['ProgramW6432']}\\Git\\bin\\bash.exe`,
			`${process.env['ProgramW6432']}\\Git\\usr\\bin\\bash.exe`,
			`${process.env['ProgramFiles']}\\Git\\bin\\bash.exe`,
			`${process.env['ProgramFiles']}\\Git\\usr\\bin\\bash.exe`,
			`${process.env['LocalAppData']}\\Programs\\Git\\bin\\bash.exe`
		],
		args: ['--login']
	});
	profileSources.set('PowerShell', {
		profileName: 'PowerShell',
		paths: await getPowershellPaths(),
		icon: 'terminal-powershell'
	});
}

async function getPowershellPaths(): Promise<string[]> {
	const paths: string[] = [];
	// Add all of the different kinds of PowerShells
	for await (const pwshExe of enumeratePowerShellInstallations()) {
		paths.push(pwshExe.exePath);
	}
	return paths;
}

async function getWslProfiles(wslPath: string, useWslProfiles?: boolean): Promise<ITerminalProfile[]> {
	const profiles: ITerminalProfile[] = [];
	if (useWslProfiles) {
		const distroOutput = await new Promise<string>((resolve, reject) => {
			// wsl.exe output is encoded in utf16le (ie. A -> 0x4100)
			cp.exec('wsl.exe -l -q', { encoding: 'utf16le' }, (err, stdout) => {
				if (err) {
					return reject('Problem occurred when getting wsl distros');
				}
				resolve(stdout);
			});
		});
		if (distroOutput) {
			const regex = new RegExp(/[\r?\n]/);
			const distroNames = distroOutput.split(regex).filter(t => t.trim().length > 0 && t !== '');
			for (const distroName of distroNames) {
				// Skip empty lines
				if (distroName === '') {
					continue;
				}

				// docker-desktop and docker-desktop-data are treated as implementation details of
				// Docker Desktop for Windows and therefore not exposed
				if (distroName.startsWith('docker-desktop')) {
					continue;
				}

				// Create the profile, adding the icon depending on the distro
				const profile: ITerminalProfile = {
					profileName: `${distroName} (WSL)`,
					path: wslPath,
					args: [`-d`, `${distroName}`]
				};
				if (distroName.includes('Ubuntu')) {
					profile.icon = 'terminal-ubuntu';
				}
				else if (distroName.includes('Debian')) {
					profile.icon = 'terminal-debian';
				} else {
					profile.icon = 'terminal-linux';
				}

				// Add the profile
				profiles.push(profile);
			}
			return profiles;
		}
	}
	return [];
}

async function detectAvailableUnixProfiles(fsProvider: IFsProvider, logService?: ILogService, configuredProfilesOnly?: boolean, configProfiles?: { [key: string]: ITerminalProfileObject }, testPaths?: string[], variableResolver?: ExtHostVariableResolverService, workspaceFolder?: IWorkspaceFolder): Promise<ITerminalProfile[]> {
	const detectedProfiles: Map<string, ITerminalProfileObject> = new Map();

	// Add non-quick launch profiles
	if (!configuredProfilesOnly) {
		const contents = await fsProvider.readFile('/etc/shells', 'utf8');
		const profiles = testPaths || contents.split('\n').filter(e => e.trim().indexOf('#') !== 0 && e.trim().length > 0);
		const counts: Map<string, number> = new Map();
		for (const profile of profiles) {
			let profileName = basename(profile);
			let count = counts.get(profileName) || 0;
			count++;
			if (count > 1) {
				profileName = `${profileName} (${count})`;
			}
			counts.set(profileName, count);
			detectedProfiles.set(profileName, { path: profile, isAutoDetected: true });
		}
	}

	applyConfigProfilesToMap(configProfiles, detectedProfiles);

	return await transformToTerminalProfiles(detectedProfiles.entries(), fsProvider, logService, variableResolver, workspaceFolder);
}

function applyConfigProfilesToMap(configProfiles: { [key: string]: ITerminalProfileObject } | undefined, profilesMap: Map<string, ITerminalProfileObject>) {
	if (!configProfiles) {
		return;
	}
	for (const [profileName, value] of Object.entries(configProfiles)) {
		if (value === null || (!('path' in value) && !('source' in value))) {
			profilesMap.delete(profileName);
		} else {
			profilesMap.set(profileName, value);
		}
	}
}

async function validateProfilePaths(profileName: string, potentialPaths: string[], fsProvider: IFsProvider, args?: string[] | string, env?: ITerminalEnvironment, overrideName?: boolean, isAutoDetected?: boolean, logService?: ILogService): Promise<ITerminalProfile | undefined> {
	if (potentialPaths.length === 0) {
		return Promise.resolve(undefined);
	}
	const path = potentialPaths.shift()!;
	if (path === '') {
		return validateProfilePaths(profileName, potentialPaths, fsProvider, args, env, overrideName, isAutoDetected);
	}

	const profile: ITerminalProfile = { profileName, path, args, env, overrideName, isAutoDetected };

	// For non-absolute paths, check if it's available on $PATH
	if (basename(path) === path) {
		// The executable isn't an absolute path, try find it on the PATH
		const envPaths: string[] | undefined = process.env.PATH ? process.env.PATH.split(delimiter) : undefined;
		const executable = await findExecutable(path, undefined, envPaths, undefined, fsProvider.existsFile);
		if (!executable) {
			return validateProfilePaths(profileName, potentialPaths, fsProvider, args);
		}
		return profile;
	}

	const result = await fsProvider.existsFile(normalize(path));
	if (result) {
		return profile;
	}

	return validateProfilePaths(profileName, potentialPaths, fsProvider, args, env, overrideName, isAutoDetected);
}

export interface IFsProvider {
	existsFile(path: string): Promise<boolean>,
	readFile(path: string, options: { encoding: BufferEncoding, flag?: string | number } | BufferEncoding): Promise<string>;
}

interface IPotentialTerminalProfile {
	profileName: string;
	paths: string[];
	args?: string[];
	icon?: string;
}
