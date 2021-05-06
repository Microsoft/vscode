/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from 'vs/base/common/network';
import { env } from 'vs/base/common/process';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { IWorkspaceContextService, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IRemoteTerminalService, ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IProcessEnvironment, OperatingSystem } from 'vs/base/common/platform';
import { IShellLaunchConfig } from 'vs/platform/terminal/common/terminal';
import { IShellLaunchConfigResolveOptions, ITerminalProfile, ITerminalProfileResolverService, TerminalSettingId } from 'vs/workbench/contrib/terminal/common/terminal';
import * as path from 'vs/base/common/path';
import { Codicon, iconRegistry } from 'vs/base/common/codicons';

export interface IProfileContextProvider {
	getDefaultSystemShell: (remoteAuthority: string | undefined, os: OperatingSystem) => Promise<string>;
	getEnvironment: (remoteAuthority: string | undefined) => Promise<IProcessEnvironment>;
}

const generatedProfileName = 'Generated';

export abstract class BaseTerminalProfileResolverService implements ITerminalProfileResolverService {
	declare _serviceBrand: undefined;

	constructor(
		private readonly _context: IProfileContextProvider,
		private readonly _configurationService: IConfigurationService,
		private readonly _configurationResolverService: IConfigurationResolverService,
		private readonly _historyService: IHistoryService,
		private readonly _logService: ILogService,
		private readonly _terminalService: ITerminalService,
		private readonly _workspaceContextService: IWorkspaceContextService,
	) {
	}

	resolveIcon(shellLaunchConfig: IShellLaunchConfig, os: OperatingSystem): void {
		if (shellLaunchConfig.executable) {
			return;
		}

		const defaultProfile = this._getRealDefaultProfile(true, os);
		if (defaultProfile) {
			shellLaunchConfig.icon = defaultProfile.icon;
		}
	}

	async resolveShellLaunchConfig(shellLaunchConfig: IShellLaunchConfig, options: IShellLaunchConfigResolveOptions): Promise<void> {
		// Resolve the shell and shell args
		let resolvedProfile: ITerminalProfile;
		if (shellLaunchConfig.executable) {
			resolvedProfile = await this._resolveProfile({
				path: shellLaunchConfig.executable,
				args: shellLaunchConfig.args,
				profileName: generatedProfileName
			}, options);
		} else {
			resolvedProfile = await this.getDefaultProfile(options);
		}
		shellLaunchConfig.executable = resolvedProfile.path;
		shellLaunchConfig.args = resolvedProfile.args;
		if (resolvedProfile.env) {
			if (shellLaunchConfig.env) {
				shellLaunchConfig.env = { ...shellLaunchConfig.env, ...resolvedProfile.env };
			} else {
				shellLaunchConfig.env = resolvedProfile.env;
			}
		}

		// Verify the icon is valid, and fallback correctly to the generic terminal id if there is
		// an issue
		shellLaunchConfig.icon = this._verifyIcon(shellLaunchConfig.icon) || this._verifyIcon(resolvedProfile.icon) || Codicon.terminal.id;
	}

	private _verifyIcon(iconId?: string): string | undefined {
		if (!iconId || !iconRegistry.get(iconId)) {
			return undefined;
		}
		return iconId;
	}

	async getDefaultShell(options: IShellLaunchConfigResolveOptions): Promise<string> {
		return (await this.getDefaultProfile(options)).path;
	}

	async getDefaultShellArgs(options: IShellLaunchConfigResolveOptions): Promise<string | string[]> {
		return (await this.getDefaultProfile(options)).args || [];
	}

	async getDefaultProfile(options: IShellLaunchConfigResolveOptions): Promise<ITerminalProfile> {
		return this._resolveProfile(await this._getUnresolvedDefaultProfile(options), options);
	}

	getEnvironment(remoteAuthority: string | undefined): Promise<IProcessEnvironment> {
		return this._context.getEnvironment(remoteAuthority);
	}

	private async _getUnresolvedDefaultProfile(options: IShellLaunchConfigResolveOptions): Promise<ITerminalProfile> {
		// If automation shell is allowed, prefer that
		if (options.allowAutomationShell) {
			const automationShellProfile = this._getAutomationShellProfile(options);
			if (automationShellProfile) {
				return automationShellProfile;
			}
		}

		// Return the real default profile if it exists and is valid
		const defaultProfile = await this._getRealDefaultProfile(false, options.os);
		if (defaultProfile) {
			return defaultProfile;
		}

		// If there is no real default profile, create a fallback default profile based on the shell
		// and shellArgs settings in addition to the current environment.
		return this._getFallbackDefaultProfile(options);
	}

	private _getRealDefaultProfile(sync: true, os: OperatingSystem): ITerminalProfile | undefined;
	private _getRealDefaultProfile(sync: false, os: OperatingSystem): Promise<ITerminalProfile | undefined>;
	private _getRealDefaultProfile(sync: boolean, os: OperatingSystem): ITerminalProfile | undefined | Promise<ITerminalProfile | undefined> {
		const defaultProfileName = this.getSafeConfigValue('defaultProfile', os);
		if (defaultProfileName && typeof defaultProfileName === 'string') {
			if (sync) {
				const profiles = this._terminalService.availableProfiles;
				return profiles.find(e => e.profileName === defaultProfileName);
			} else {
				return this._terminalService.availableProfiles.find(e => e.profileName === defaultProfileName);
			}
		}
		return undefined;
	}

	private async _getFallbackDefaultProfile(options: IShellLaunchConfigResolveOptions): Promise<ITerminalProfile> {
		let executable: string;
		let args: string | string[] | undefined;
		const shellSetting = this.getSafeConfigValue('shell', options.os);
		if (this._isValidShell(shellSetting)) {
			executable = shellSetting;
			const shellArgsSetting = this.getSafeConfigValue('shellArgs', options.os);
			if (this._isValidShellArgs(shellArgsSetting, options.os)) {
				args = shellArgsSetting;
			}
		} else {
			executable = await this._context.getDefaultSystemShell(options.remoteAuthority, options.os);
		}

		if (args === undefined) {
			if (options.os === OperatingSystem.Macintosh && args === undefined) {
				// macOS should launch a login shell by default
				args = ['--login'];
			} else {
				// Resolve undefined to []
				args = [];
			}
		}

		const icon = this._guessProfileIcon(executable);

		return {
			profileName: generatedProfileName,
			path: executable,
			args,
			icon
		};
	}

	private _getAutomationShellProfile(options: IShellLaunchConfigResolveOptions): ITerminalProfile | undefined {
		const automationShell = this.getSafeConfigValue('automationShell', options.os);
		if (!automationShell || typeof automationShell !== 'string') {
			return undefined;
		}
		return {
			path: automationShell,
			profileName: generatedProfileName
		};
	}

	private async _resolveProfile(profile: ITerminalProfile, options: IShellLaunchConfigResolveOptions): Promise<ITerminalProfile> {
		if (options.os === OperatingSystem.Windows) {
			// Change Sysnative to System32 if the OS is Windows but NOT WoW64. It's
			// safe to assume that this was used by accident as Sysnative does not
			// exist and will break the terminal in non-WoW64 environments.
			const env = await this._context.getEnvironment(options.remoteAuthority);
			const isWoW64 = !!env.hasOwnProperty('PROCESSOR_ARCHITEW6432');
			const windir = env.windir;
			if (!isWoW64 && windir) {
				const sysnativePath = path.join(windir, 'Sysnative').replace(/\//g, '\\').toLowerCase();
				if (profile.path && profile.path.toLowerCase().indexOf(sysnativePath) === 0) {
					profile.path = path.join(windir, 'System32', profile.path.substr(sysnativePath.length + 1));
				}
			}

			// Convert / to \ on Windows for convenience
			if (profile.path) {
				profile.path = profile.path.replace(/\//g, '\\');
			}
		}

		// Resolve path variables
		const env = await this._context.getEnvironment(options.remoteAuthority);
		const activeWorkspaceRootUri = this._historyService.getLastActiveWorkspaceRoot(Schemas.file);
		const lastActiveWorkspace = activeWorkspaceRootUri ? withNullAsUndefined(this._workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri)) : undefined;
		profile.path = this._resolveVariables(profile.path, env, lastActiveWorkspace);

		// Resolve args variables
		if (profile.args) {
			if (typeof profile.args === 'string') {
				profile.args = this._resolveVariables(profile.args, env, lastActiveWorkspace);
			} else {
				for (let i = 0; i < profile.args.length; i++) {
					profile.args[i] = this._resolveVariables(profile.args[i], env, lastActiveWorkspace);
				}
			}
		}

		return profile;
	}

	private _resolveVariables(value: string, env: IProcessEnvironment, lastActiveWorkspace: IWorkspaceFolder | undefined) {
		try {
			value = this._configurationResolverService.resolveWithEnvironment(env, lastActiveWorkspace, value);
		} catch (e) {
			this._logService.error(`Could not resolve shell`, e);
		}
		return value;
	}

	private _getOsKey(os: OperatingSystem): string {
		switch (os) {
			case OperatingSystem.Linux: return 'linux';
			case OperatingSystem.Macintosh: return 'osx';
			case OperatingSystem.Windows: return 'windows';
		}
	}

	private _guessProfileIcon(shell: string): string | undefined {
		const file = path.parse(shell).name;
		switch (file) {
			case 'bash':
				return Codicon.terminalBash.id;
			case 'pwsh':
			case 'powershell':
				return Codicon.terminalPowershell.id;
			case 'tmux':
				return Codicon.terminalTmux.id;
			case 'cmd':
				return Codicon.terminalCmd.id;
			default:
				return undefined;
		}
	}

	private _isValidShell(shell: unknown): shell is string {
		if (!shell) {
			return false;
		}
		return typeof shell === 'string';
	}

	private _isValidShellArgs(shellArgs: unknown, os: OperatingSystem): shellArgs is string | string[] | undefined {
		if (shellArgs === undefined) {
			return true;
		}
		if (os === OperatingSystem.Windows && typeof shellArgs === 'string') {
			return true;
		}
		if (Array.isArray(shellArgs) && shellArgs.every(e => typeof e === 'string')) {
			return true;
		}
		return false;
	}

	// TODO: Remove when workspace trust is enabled
	getSafeConfigValue(key: string, os: OperatingSystem): unknown | undefined {
		return this.getSafeConfigValueFullKey(`terminal.integrated.${key}.${this._getOsKey(os)}`);
	}
	getSafeConfigValueFullKey(key: string): unknown | undefined {
		const isWorkspaceConfigAllowed = this._configurationService.getValue(TerminalSettingId.AllowWorkspaceConfiguration);
		if (isWorkspaceConfigAllowed) {
			return this._configurationService.getValue(key);
		} else {
			const config = this._configurationService.inspect(key);
			const value = config.user?.value || config.default?.value;
			// Clone if needed to allow extensibility
			if (Array.isArray(value)) {
				return value.slice();
			}
			if (typeof value === 'object') {
				return { ...value };
			}
			return value;
		}
	}
}

export class BrowserTerminalProfileResolverService extends BaseTerminalProfileResolverService {

	constructor(
		@IConfigurationResolverService configurationResolverService: IConfigurationResolverService,
		@IConfigurationService configurationService: IConfigurationService,
		@IHistoryService historyService: IHistoryService,
		@ILogService logService: ILogService,
		@IRemoteTerminalService remoteTerminalService: IRemoteTerminalService,
		@ITerminalService terminalService: ITerminalService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
	) {
		super(
			{
				getDefaultSystemShell: async (remoteAuthority, os) => {
					if (!remoteAuthority) {
						// Just return basic values, this is only for serverless web and wouldn't be used
						return os === OperatingSystem.Windows ? 'pwsh' : 'bash';
					}
					return remoteTerminalService.getDefaultSystemShell(os);
				},
				getEnvironment: async (remoteAuthority) => {
					if (!remoteAuthority) {
						return env;
					}
					return remoteTerminalService.getEnvironment();
				}
			},
			configurationService,
			configurationResolverService,
			historyService,
			logService,
			terminalService,
			workspaceContextService
		);
	}
}
