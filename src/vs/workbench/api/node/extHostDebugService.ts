/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import type * as vscode from 'vscode';
import * as env from 'vs/base/common/platform';
import { DebugAdapterExecutable } from 'vs/workbench/api/common/extHostTypes';
import { ExecutableDebugAdapter, SocketDebugAdapter } from 'vs/workbench/contrib/debug/node/debugAdapter';
import { AbstractDebugAdapter } from 'vs/workbench/contrib/debug/common/abstractDebugAdapter';
import { IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { IExtHostExtensionService } from 'vs/workbench/api/common/extHostExtensionService';
import { IExtHostDocumentsAndEditors, ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { IAdapterDescriptor } from 'vs/workbench/contrib/debug/common/debug';
import { IExtHostConfiguration, ExtHostConfigProvider } from '../common/extHostConfiguration';
import { IExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { ExtensionDescriptionRegistry } from 'vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import { IExtHostTerminalService } from 'vs/workbench/api/common/extHostTerminalService';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { ExtHostDebugServiceBase, ExtHostDebugSession, ExtHostVariableResolverService } from 'vs/workbench/api/common/extHostDebugService';
import { ISignService } from 'vs/platform/sign/common/sign';
import { SignService } from 'vs/platform/sign/node/signService';
import { hasChildProcesses, prepareCommand, runInExternalTerminal } from 'vs/workbench/contrib/debug/node/terminals';
import { IDisposable } from 'vs/base/common/lifecycle';
import { AbstractVariableResolverService } from 'vs/workbench/services/configurationResolver/common/variableResolver';


export class ExtHostDebugService extends ExtHostDebugServiceBase {

	readonly _serviceBrand: undefined;

	private _integratedTerminalInstance?: vscode.Terminal;
	private _terminalDisposedListener: IDisposable | undefined;

	constructor(
		@IExtHostRpcService extHostRpcService: IExtHostRpcService,
		@IExtHostWorkspace workspaceService: IExtHostWorkspace,
		@IExtHostExtensionService extensionService: IExtHostExtensionService,
		@IExtHostDocumentsAndEditors editorsService: IExtHostDocumentsAndEditors,
		@IExtHostConfiguration configurationService: IExtHostConfiguration,
		@IExtHostTerminalService private _terminalService: IExtHostTerminalService,
		@IExtHostCommands commandService: IExtHostCommands
	) {
		super(extHostRpcService, workspaceService, extensionService, editorsService, configurationService, commandService);
	}

	protected createDebugAdapter(adapter: IAdapterDescriptor, session: ExtHostDebugSession): AbstractDebugAdapter | undefined {
		switch (adapter.type) {
			case 'server':
				return new SocketDebugAdapter(adapter);
			case 'executable':
				return new ExecutableDebugAdapter(adapter, session.type);
		}
		return super.createDebugAdapter(adapter, session);
	}

	protected daExecutableFromPackage(session: ExtHostDebugSession, extensionRegistry: ExtensionDescriptionRegistry): DebugAdapterExecutable | undefined {
		const dae = ExecutableDebugAdapter.platformAdapterExecutable(extensionRegistry.getAllExtensionDescriptions(), session.type);
		if (dae) {
			return new DebugAdapterExecutable(dae.command, dae.args, dae.options);
		}
		return undefined;
	}

	protected createSignService(): ISignService | undefined {
		return new SignService();
	}

	public async $runInTerminal(args: DebugProtocol.RunInTerminalRequestArguments): Promise<number | undefined> {

		if (args.kind === 'integrated') {

			if (!this._terminalDisposedListener) {
				// React on terminal disposed and check if that is the debug terminal #12956
				this._terminalDisposedListener = this._terminalService.onDidCloseTerminal(terminal => {
					if (this._integratedTerminalInstance && this._integratedTerminalInstance === terminal) {
						this._integratedTerminalInstance = undefined;
					}
				});
			}

			let needNewTerminal = true;	// be pessimistic
			if (this._integratedTerminalInstance) {
				const pid = await this._integratedTerminalInstance.processId;
				needNewTerminal = await hasChildProcesses(pid);		// if no processes running in terminal reuse terminal
			}

			const configProvider = await this._configurationService.getConfigProvider();
			const shell = this._terminalService.getDefaultShell(true, configProvider);
			let cwdForPrepareCommand: string | undefined;

			if (needNewTerminal || !this._integratedTerminalInstance) {

				const options: vscode.TerminalOptions = {
					shellPath: shell,
					// shellArgs: this._terminalService._getDefaultShellArgs(configProvider),
					cwd: args.cwd,
					name: args.title || nls.localize('debug.terminal.title', "debuggee"),
				};
				this._integratedTerminalInstance = this._terminalService.createTerminalFromOptions(options);
			} else {
				cwdForPrepareCommand = args.cwd;
			}

			const terminal = this._integratedTerminalInstance;

			terminal.show();

			const shellProcessId = await this._integratedTerminalInstance.processId;
			const command = prepareCommand(shell, args.args, cwdForPrepareCommand, args.env);
			terminal.sendText(command, true);

			return shellProcessId;

		} else if (args.kind === 'external') {

			return runInExternalTerminal(args, await this._configurationService.getConfigProvider());
		}
		return super.$runInTerminal(args);
	}

	protected createVariableResolver(folders: vscode.WorkspaceFolder[], editorService: ExtHostDocumentsAndEditors, configurationService: ExtHostConfigProvider): AbstractVariableResolverService {
		return new ExtHostVariableResolverService(folders, editorService, configurationService, process.env as env.IProcessEnvironment);
	}
}
