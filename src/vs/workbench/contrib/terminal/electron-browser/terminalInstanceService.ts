/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IWindowsShellHelper, IShellLaunchConfig, ITerminalChildProcess, IS_WORKSPACE_SHELL_ALLOWED_STORAGE_KEY } from 'vs/workbench/contrib/terminal/common/terminal';
import { WindowsShellHelper } from 'vs/workbench/contrib/terminal/electron-browser/windowsShellHelper';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IProcessEnvironment, platform, Platform } from 'vs/base/common/platform';
import { TerminalProcess } from 'vs/workbench/contrib/terminal/node/terminalProcess';
import { getSystemShell } from 'vs/workbench/contrib/terminal/node/terminal';
import { Terminal as XTermTerminal } from 'xterm';
import { SearchAddon as XTermSearchAddon } from 'xterm-addon-search';
import { Unicode11Addon as XTermUnicode11Addon } from 'xterm-addon-unicode11';
import { WebglAddon as XTermWebglAddon } from 'xterm-addon-webgl';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { getDefaultShell, getDefaultShellArgs } from 'vs/workbench/contrib/terminal/common/terminalEnvironment';
import { StorageScope, IStorageService } from 'vs/platform/storage/common/storage';
import { getMainProcessParentEnv } from 'vs/workbench/contrib/terminal/node/terminalEnvironment';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ILogService } from 'vs/platform/log/common/log';

let Terminal: typeof XTermTerminal;
let SearchAddon: typeof XTermSearchAddon;
let Unicode11Addon: typeof XTermUnicode11Addon;
let WebglAddon: typeof XTermWebglAddon;

export class TerminalInstanceService implements ITerminalInstanceService {
	public _serviceBrand: undefined;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IStorageService private readonly _storageService: IStorageService,
		@IConfigurationResolverService private readonly _configurationResolverService: IConfigurationResolverService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IHistoryService private readonly _historyService: IHistoryService,
		@ILogService private readonly _logService: ILogService
	) {
	}

	public async getXtermConstructor(): Promise<typeof XTermTerminal> {
		if (!Terminal) {
			Terminal = (await import('xterm')).Terminal;
		}
		return Terminal;
	}

	public async getXtermSearchConstructor(): Promise<typeof XTermSearchAddon> {
		if (!SearchAddon) {
			SearchAddon = (await import('xterm-addon-search')).SearchAddon;
		}
		return SearchAddon;
	}

	public async getXtermUnicode11Constructor(): Promise<typeof XTermUnicode11Addon> {
		if (!Unicode11Addon) {
			Unicode11Addon = (await import('xterm-addon-unicode11')).Unicode11Addon;
		}
		return Unicode11Addon;
	}

	public async getXtermWebglConstructor(): Promise<typeof XTermWebglAddon> {
		if (!WebglAddon) {
			WebglAddon = (await import('xterm-addon-webgl')).WebglAddon;
		}
		return WebglAddon;
	}

	public createWindowsShellHelper(shellProcessId: number, xterm: XTermTerminal): IWindowsShellHelper {
		return new WindowsShellHelper(shellProcessId, xterm);
	}

	public createTerminalProcess(shellLaunchConfig: IShellLaunchConfig, cwd: string, cols: number, rows: number, env: IProcessEnvironment, windowsEnableConpty: boolean): ITerminalChildProcess {
		return this._instantiationService.createInstance(TerminalProcess, shellLaunchConfig, cwd, cols, rows, env, windowsEnableConpty);
	}

	private _isWorkspaceShellAllowed(): boolean {
		return this._storageService.getBoolean(IS_WORKSPACE_SHELL_ALLOWED_STORAGE_KEY, StorageScope.WORKSPACE, false);
	}

	public getDefaultShellAndArgs(useAutomationShell: boolean, platformOverride: Platform = platform): Promise<{ shell: string, args: string | string[] }> {
		const isWorkspaceShellAllowed = this._isWorkspaceShellAllowed();
		const activeWorkspaceRootUri = this._historyService.getLastActiveWorkspaceRoot();
		let lastActiveWorkspace = activeWorkspaceRootUri ? this._workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri) : undefined;
		lastActiveWorkspace = lastActiveWorkspace === null ? undefined : lastActiveWorkspace;
		const shell = getDefaultShell(
			(key) => this._configurationService.inspect(key),
			isWorkspaceShellAllowed,
			getSystemShell(platformOverride),
			process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432'),
			process.env.windir,
			lastActiveWorkspace,
			this._configurationResolverService,
			this._logService,
			useAutomationShell,
			platformOverride
		);
		const args = getDefaultShellArgs(
			(key) => this._configurationService.inspect(key),
			isWorkspaceShellAllowed,
			useAutomationShell,
			lastActiveWorkspace,
			this._configurationResolverService,
			this._logService,
			platformOverride
		);
		return Promise.resolve({ shell, args });
	}

	public getMainProcessParentEnv(): Promise<IProcessEnvironment> {
		return getMainProcessParentEnv();
	}
}
