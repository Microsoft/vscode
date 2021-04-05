/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { ITerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IS_WORKSPACE_SHELL_ALLOWED_STORAGE_KEY } from 'vs/workbench/contrib/terminal/common/terminal';
import { Disposable } from 'vs/base/common/lifecycle';
import { IProcessEnvironment, platform, Platform } from 'vs/base/common/platform';
import { getSystemShell } from 'vs/base/node/shell';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { getMainProcessParentEnv } from 'vs/workbench/contrib/terminal/node/terminalEnvironment';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IShellEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/shellEnvironmentService';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import type { Terminal as XTermTerminal } from 'xterm';
import type { LigaturesAddon as XTermLigaturesAddon } from 'xterm-addon-ligatures';
import type { SearchAddon as XTermSearchAddon } from 'xterm-addon-search';
import type { Unicode11Addon as XTermUnicode11Addon } from 'xterm-addon-unicode11';
import type { WebglAddon as XTermWebglAddon } from 'xterm-addon-webgl';
import { createVariableResolver, getDefaultShell, getDefaultShellArgs } from 'vs/workbench/contrib/terminal/common/terminalEnvironment';

let Terminal: typeof XTermTerminal;
let LigaturesAddon: typeof XTermLigaturesAddon;
let SearchAddon: typeof XTermSearchAddon;
let Unicode11Addon: typeof XTermUnicode11Addon;
let WebglAddon: typeof XTermWebglAddon;

export class TerminalInstanceService extends Disposable implements ITerminalInstanceService {
	public _serviceBrand: undefined;

	constructor(
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IStorageService private readonly _storageService: IStorageService,
		@IConfigurationResolverService private readonly _configurationResolverService: IConfigurationResolverService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IHistoryService private readonly _historyService: IHistoryService,
		@ILogService private readonly _logService: ILogService,
		@IShellEnvironmentService private readonly _shellEnvironmentService: IShellEnvironmentService
	) {
		super();
	}

	public async getXtermConstructor(): Promise<typeof XTermTerminal> {
		if (!Terminal) {
			Terminal = (await import('xterm')).Terminal;
		}
		return Terminal;
	}

	public async getXtermLigaturesConstructor(): Promise<typeof XTermLigaturesAddon> {
		if (!LigaturesAddon) {
			LigaturesAddon = (await import('xterm-addon-ligatures')).LigaturesAddon;
		}
		return LigaturesAddon;
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

	private _isWorkspaceShellAllowed(): boolean {
		return this._storageService.getBoolean(IS_WORKSPACE_SHELL_ALLOWED_STORAGE_KEY, StorageScope.WORKSPACE, false);
	}

	public async getDefaultShellAndArgs(useAutomationShell: boolean, platformOverride: Platform = platform): Promise<{ shell: string, args: string | string[] }> {
		const isWorkspaceShellAllowed = this._isWorkspaceShellAllowed();
		const activeWorkspaceRootUri = this._historyService.getLastActiveWorkspaceRoot();
		let lastActiveWorkspace = activeWorkspaceRootUri ? this._workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri) : undefined;
		lastActiveWorkspace = lastActiveWorkspace === null ? undefined : lastActiveWorkspace;

		const shell = getDefaultShell(
			(key) => this._configurationService.inspect(key),
			isWorkspaceShellAllowed,
			await getSystemShell(platformOverride, await this._shellEnvironmentService.getShellEnv()),
			process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432'),
			process.env.windir,
			createVariableResolver(lastActiveWorkspace, this._configurationResolverService),
			this._logService,
			useAutomationShell,
			platformOverride
		);

		const args = getDefaultShellArgs(
			(key) => this._configurationService.inspect(key),
			isWorkspaceShellAllowed,
			useAutomationShell,
			createVariableResolver(lastActiveWorkspace, this._configurationResolverService),
			this._logService,
			platformOverride
		);

		return Promise.resolve({ shell, args });
	}

	public getMainProcessParentEnv(): Promise<IProcessEnvironment> {
		return getMainProcessParentEnv();
	}
}
