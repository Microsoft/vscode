/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import * as os from 'os';
import { URI, UriComponents } from 'vs/base/common/uri';
import * as platform from 'vs/base/common/platform';
import * as terminalEnvironment from 'vs/workbench/contrib/terminal/common/terminalEnvironment';
import { IShellLaunchConfigDto, IShellDefinitionDto, IShellAndArgsDto } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostConfiguration, ExtHostConfigProvider, IExtHostConfiguration } from 'vs/workbench/api/common/extHostConfiguration';
import { ILogService } from 'vs/platform/log/common/log';
import { IShellLaunchConfig, ITerminalEnvironment, ITerminalLaunchError } from 'vs/workbench/contrib/terminal/common/terminal';
import { TerminalProcess } from 'vs/workbench/contrib/terminal/node/terminalProcess';
import { ExtHostWorkspace, IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { ExtHostVariableResolverService } from 'vs/workbench/api/common/extHostDebugService';
import { ExtHostDocumentsAndEditors, IExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { getSystemShell, detectAvailableShells } from 'vs/workbench/contrib/terminal/node/terminal';
import { getMainProcessParentEnv } from 'vs/workbench/contrib/terminal/node/terminalEnvironment';
import { BaseExtHostTerminalService, ExtHostTerminal } from 'vs/workbench/api/common/extHostTerminalService';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { MergedEnvironmentVariableCollection } from 'vs/workbench/contrib/terminal/common/environmentVariableCollection';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { withNullAsUndefined } from 'vs/base/common/types';

export class ExtHostTerminalService extends BaseExtHostTerminalService {

	private _variableResolver: ExtHostVariableResolverService | undefined;
	private _lastActiveWorkspace: IWorkspaceFolder | undefined;

	// TODO: Pull this from main side
	private _isWorkspaceShellAllowed: boolean = false;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostConfiguration private _extHostConfiguration: ExtHostConfiguration,
		@IExtHostWorkspace private _extHostWorkspace: ExtHostWorkspace,
		@IExtHostDocumentsAndEditors private _extHostDocumentsAndEditors: ExtHostDocumentsAndEditors,
		@ILogService private _logService: ILogService,
		@IExtHostInitDataService private _extHostInitDataService: IExtHostInitDataService
	) {
		super(true, extHostRpc);
		this._updateLastActiveWorkspace();
		this._updateVariableResolver();
		this._registerListeners();
	}

	public createTerminal(name?: string, shellPath?: string, shellArgs?: string[] | string): vscode.Terminal {
		const terminal = new ExtHostTerminal(this._proxy, { name, shellPath, shellArgs }, name);
		this._terminals.push(terminal);
		terminal.create(shellPath, shellArgs);
		return terminal;
	}

	public createTerminalFromOptions(options: vscode.TerminalOptions, isFeatureTerminal?: boolean): vscode.Terminal {
		const terminal = new ExtHostTerminal(this._proxy, options, options.name);
		this._terminals.push(terminal);
		terminal.create(
			withNullAsUndefined(options.shellPath),
			withNullAsUndefined(options.shellArgs),
			withNullAsUndefined(options.cwd),
			withNullAsUndefined(options.env),
			/*options.waitOnExit*/ undefined,
			withNullAsUndefined(options.strictEnv),
			withNullAsUndefined(options.hideFromUser),
			withNullAsUndefined(isFeatureTerminal));
		return terminal;
	}

	public getDefaultShell(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string {
		const fetchSetting = (key: string): { userValue: string | string[] | undefined, value: string | string[] | undefined, defaultValue: string | string[] | undefined } => {
			const setting = configProvider
				.getConfiguration(key.substr(0, key.lastIndexOf('.')))
				.inspect<string | string[]>(key.substr(key.lastIndexOf('.') + 1));
			return this._apiInspectConfigToPlain<string | string[]>(setting);
		};
		return terminalEnvironment.getDefaultShell(
			fetchSetting,
			this._isWorkspaceShellAllowed,
			getSystemShell(platform.platform),
			process.env.hasOwnProperty('PROCESSOR_ARCHITEW6432'),
			process.env.windir,
			terminalEnvironment.createVariableResolver(this._lastActiveWorkspace, this._variableResolver),
			this._logService,
			useAutomationShell
		);
	}

	public getDefaultShellArgs(useAutomationShell: boolean, configProvider: ExtHostConfigProvider): string[] | string {
		const fetchSetting = (key: string): { userValue: string | string[] | undefined, value: string | string[] | undefined, defaultValue: string | string[] | undefined } => {
			const setting = configProvider
				.getConfiguration(key.substr(0, key.lastIndexOf('.')))
				.inspect<string | string[]>(key.substr(key.lastIndexOf('.') + 1));
			return this._apiInspectConfigToPlain<string | string[]>(setting);
		};

		return terminalEnvironment.getDefaultShellArgs(fetchSetting, this._isWorkspaceShellAllowed, useAutomationShell, terminalEnvironment.createVariableResolver(this._lastActiveWorkspace, this._variableResolver), this._logService);
	}

	private _apiInspectConfigToPlain<T>(
		config: { key: string; defaultValue?: T; globalValue?: T; workspaceValue?: T, workspaceFolderValue?: T } | undefined
	): { userValue: T | undefined, value: T | undefined, defaultValue: T | undefined } {
		return {
			userValue: config ? config.globalValue : undefined,
			value: config ? config.workspaceValue : undefined,
			defaultValue: config ? config.defaultValue : undefined,
		};
	}

	private async _getNonInheritedEnv(): Promise<platform.IProcessEnvironment> {
		const env = await getMainProcessParentEnv();
		env.VSCODE_IPC_HOOK_CLI = process.env['VSCODE_IPC_HOOK_CLI']!;
		return env;
	}

	private _registerListeners(): void {
		this._extHostDocumentsAndEditors.onDidChangeActiveTextEditor(() => this._updateLastActiveWorkspace());
		this._extHostWorkspace.onDidChangeWorkspace(() => this._updateVariableResolver());
	}

	private _updateLastActiveWorkspace(): void {
		const activeEditor = this._extHostDocumentsAndEditors.activeEditor();
		if (activeEditor) {
			this._lastActiveWorkspace = this._extHostWorkspace.getWorkspaceFolder(activeEditor.document.uri) as IWorkspaceFolder;
		}
	}

	private async _updateVariableResolver(): Promise<void> {
		const configProvider = await this._extHostConfiguration.getConfigProvider();
		const workspaceFolders = await this._extHostWorkspace.getWorkspaceFolders2();
		this._variableResolver = new ExtHostVariableResolverService(workspaceFolders || [], this._extHostDocumentsAndEditors, configProvider, process.env as platform.IProcessEnvironment);
	}

	public async $spawnExtHostProcess(id: number, shellLaunchConfigDto: IShellLaunchConfigDto, activeWorkspaceRootUriComponents: UriComponents | undefined, cols: number, rows: number, isWorkspaceShellAllowed: boolean): Promise<ITerminalLaunchError | undefined> {
		const shellLaunchConfig: IShellLaunchConfig = {
			name: shellLaunchConfigDto.name,
			executable: shellLaunchConfigDto.executable,
			args: shellLaunchConfigDto.args,
			cwd: typeof shellLaunchConfigDto.cwd === 'string' ? shellLaunchConfigDto.cwd : URI.revive(shellLaunchConfigDto.cwd),
			env: shellLaunchConfigDto.env
		};

		// Merge in shell and args from settings
		const platformKey = platform.isWindows ? 'windows' : (platform.isMacintosh ? 'osx' : 'linux');
		const configProvider = await this._extHostConfiguration.getConfigProvider();
		if (!shellLaunchConfig.executable) {
			shellLaunchConfig.executable = this.getDefaultShell(false, configProvider);
			shellLaunchConfig.args = this.getDefaultShellArgs(false, configProvider);
		} else {
			if (this._variableResolver) {
				shellLaunchConfig.executable = this._variableResolver.resolve(this._lastActiveWorkspace, shellLaunchConfig.executable);
				if (shellLaunchConfig.args) {
					if (Array.isArray(shellLaunchConfig.args)) {
						const resolvedArgs: string[] = [];
						for (const arg of shellLaunchConfig.args) {
							resolvedArgs.push(this._variableResolver.resolve(this._lastActiveWorkspace, arg));
						}
						shellLaunchConfig.args = resolvedArgs;
					} else {
						shellLaunchConfig.args = this._variableResolver.resolve(this._lastActiveWorkspace, shellLaunchConfig.args);
					}
				}
			}
		}

		const activeWorkspaceRootUri = URI.revive(activeWorkspaceRootUriComponents);
		let lastActiveWorkspace: IWorkspaceFolder | undefined;
		if (activeWorkspaceRootUriComponents && activeWorkspaceRootUri) {
			// Get the environment
			const apiLastActiveWorkspace = await this._extHostWorkspace.getWorkspaceFolder(activeWorkspaceRootUri);
			if (apiLastActiveWorkspace) {
				lastActiveWorkspace = {
					uri: apiLastActiveWorkspace.uri,
					name: apiLastActiveWorkspace.name,
					index: apiLastActiveWorkspace.index,
					toResource: () => {
						throw new Error('Not implemented');
					}
				};
			}
		}

		// Get the initial cwd
		const terminalConfig = configProvider.getConfiguration('terminal.integrated');

		const initialCwd = terminalEnvironment.getCwd(shellLaunchConfig, os.homedir(), terminalEnvironment.createVariableResolver(lastActiveWorkspace, this._variableResolver), activeWorkspaceRootUri, terminalConfig.cwd, this._logService);
		shellLaunchConfig.cwd = initialCwd;

		const envFromConfig = this._apiInspectConfigToPlain(configProvider.getConfiguration('terminal.integrated').inspect<ITerminalEnvironment>(`env.${platformKey}`));
		const baseEnv = terminalConfig.get<boolean>('inheritEnv', true) ? process.env as platform.IProcessEnvironment : await this._getNonInheritedEnv();
		const env = terminalEnvironment.createTerminalEnvironment(
			shellLaunchConfig,
			envFromConfig,
			terminalEnvironment.createVariableResolver(lastActiveWorkspace, this._variableResolver),
			isWorkspaceShellAllowed,
			this._extHostInitDataService.version,
			terminalConfig.get<'auto' | 'off' | 'on'>('detectLocale', 'auto'),
			baseEnv
		);

		// Apply extension environment variable collections to the environment
		if (!shellLaunchConfig.strictEnv) {
			const mergedCollection = new MergedEnvironmentVariableCollection(this._environmentVariableCollections);
			mergedCollection.applyToProcessEnvironment(env);
		}

		this._proxy.$sendResolvedLaunchConfig(id, shellLaunchConfig);
		// Fork the process and listen for messages
		this._logService.debug(`Terminal process launching on ext host`, { shellLaunchConfig, initialCwd, cols, rows, env });
		// TODO: Support conpty on remote, it doesn't seem to work for some reason?
		// TODO: When conpty is enabled, only enable it when accessibilityMode is off
		const enableConpty = false; //terminalConfig.get('windowsEnableConpty') as boolean;

		const terminalProcess = new TerminalProcess(shellLaunchConfig, initialCwd, cols, rows, env, process.env as platform.IProcessEnvironment, enableConpty, this._logService);
		this._setupExtHostProcessListeners(id, terminalProcess);
		const error = await terminalProcess.start();
		if (error) {
			// TODO: Teardown?
			return error;
		}
		return undefined;
	}

	public $getAvailableShells(): Promise<IShellDefinitionDto[]> {
		return detectAvailableShells();
	}

	public async $getDefaultShellAndArgs(useAutomationShell: boolean): Promise<IShellAndArgsDto> {
		const configProvider = await this._extHostConfiguration.getConfigProvider();
		return {
			shell: this.getDefaultShell(useAutomationShell, configProvider),
			args: this.getDefaultShellArgs(useAutomationShell, configProvider)
		};
	}

	public $acceptWorkspacePermissionsChanged(isAllowed: boolean): void {
		this._isWorkspaceShellAllowed = isAllowed;
	}
}
