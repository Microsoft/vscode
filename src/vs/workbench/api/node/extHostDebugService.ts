/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import type * as vscode from 'vscode';
import * as env from 'vs/base/common/platform';
import { DebugAdapterExecutable } from 'vs/workbench/api/common/extHostTypes';
import { ExecutableDebugAdapter, SocketDebugAdapter, NamedPipeDebugAdapter } from 'vs/workbench/contrib/debug/node/debugAdapter';
import { AbstractDebugAdapter } from 'vs/workbench/contrib/debug/common/abstractDebugAdapter';
import { IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { IExtHostExtensionService } from 'vs/workbench/api/common/extHostExtensionService';
import { IExtHostDocumentsAndEditors, ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { IAdapterDescriptor } from 'vs/workbench/contrib/debug/common/debug';
import { IExtHostConfiguration, ExtHostConfigProvider } from '../common/extHostConfiguration';
import { ExtensionDescriptionRegistry } from 'vs/workbench/services/extensions/common/extensionDescriptionRegistry';
import { IExtHostTerminalService } from 'vs/workbench/api/common/extHostTerminalService';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { ExtHostDebugServiceBase, ExtHostDebugSession, ExtHostVariableResolverService } from 'vs/workbench/api/common/extHostDebugService';
import { ISignService } from 'vs/platform/sign/common/sign';
import { SignService } from 'vs/platform/sign/node/signService';
import { hasChildProcesses, prepareCommand, runInExternalTerminal } from 'vs/workbench/contrib/debug/node/terminals';
import { IDisposable } from 'vs/base/common/lifecycle';
import { AbstractVariableResolverService } from 'vs/workbench/services/configurationResolver/common/variableResolver';
import { createCancelablePromise, firstParallel } from 'vs/base/common/async';


export class ExtHostDebugService extends ExtHostDebugServiceBase {

	readonly _serviceBrand: undefined;

	private _integratedTerminalInstances = new DebugTerminalCollection();
	private _terminalDisposedListener: IDisposable | undefined;

	constructor(
		@IExtHostRpcService extHostRpcService: IExtHostRpcService,
		@IExtHostWorkspace workspaceService: IExtHostWorkspace,
		@IExtHostExtensionService extensionService: IExtHostExtensionService,
		@IExtHostDocumentsAndEditors editorsService: IExtHostDocumentsAndEditors,
		@IExtHostConfiguration configurationService: IExtHostConfiguration,
		@IExtHostTerminalService private _terminalService: IExtHostTerminalService
	) {
		super(extHostRpcService, workspaceService, extensionService, editorsService, configurationService);
	}

	protected createDebugAdapter(adapter: IAdapterDescriptor, session: ExtHostDebugSession): AbstractDebugAdapter | undefined {
		switch (adapter.type) {
			case 'server':
				return new SocketDebugAdapter(adapter);
			case 'pipeServer':
				return new NamedPipeDebugAdapter(adapter);
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
					this._integratedTerminalInstances.onTerminalClosed(terminal);
				});
			}

			const configProvider = await this._configurationService.getConfigProvider();
			const shell = this._terminalService.getDefaultShell(true, configProvider);
			const shellArgs = this._terminalService.getDefaultShellArgs(true, configProvider);

			const shellConfig = JSON.stringify({ shell, shellArgs });
			let terminal = await this._integratedTerminalInstances.checkout(shellConfig);

			let cwdForPrepareCommand: string | undefined;
			let giveShellTimeToInitialize = false;

			if (!terminal) {
				const options: vscode.TerminalOptions = {
					shellPath: shell,
					shellArgs: shellArgs,
					cwd: args.cwd,
					name: args.title || nls.localize('debug.terminal.title', "debuggee"),
				};
				giveShellTimeToInitialize = true;
				terminal = this._terminalService.createTerminalFromOptions(options, true);
				this._integratedTerminalInstances.insert(terminal, shellConfig);

			} else {
				cwdForPrepareCommand = args.cwd;
			}

			terminal.show();

			const shellProcessId = await terminal.processId;

			if (giveShellTimeToInitialize) {
				// give a new terminal some time to initialize the shell
				await new Promise(resolve => setTimeout(resolve, 1000));
			}

			const command = prepareCommand(shell, args.args, cwdForPrepareCommand, args.env);
			terminal.sendText(command, true);

			return shellProcessId;

		} else if (args.kind === 'external') {

			return runInExternalTerminal(args, await this._configurationService.getConfigProvider());
		}
		return super.$runInTerminal(args);
	}

	protected createVariableResolver(folders: vscode.WorkspaceFolder[], editorService: ExtHostDocumentsAndEditors, configurationService: ExtHostConfigProvider): AbstractVariableResolverService {
		return new ExtHostVariableResolverService(folders, editorService, configurationService, process.env as env.IProcessEnvironment, this._workspaceService);
	}
}

class DebugTerminalCollection {
	/**
	 * Delay before a new terminal is a candidate for reuse. See #71850
	 */
	private static minUseDelay = 1000;

	private _terminalInstances = new Map<vscode.Terminal, { lastUsedAt: number, config: string }>();

	public async checkout(config: string) {
		const entries = [...this._terminalInstances.keys()];
		const promises = entries.map((terminal) => createCancelablePromise(async ct => {
			const pid = await terminal.processId;
			if (await hasChildProcesses(pid)) {
				return null;
			}

			// important: date check and map operations must be synchronous
			const now = Date.now();
			const termInfo = this._terminalInstances.get(terminal);
			if (!termInfo || termInfo.lastUsedAt + DebugTerminalCollection.minUseDelay > now || ct.isCancellationRequested) {
				return null;
			}

			if (termInfo.config !== config) {
				return null;
			}

			termInfo.lastUsedAt = now;
			return terminal;
		}));

		return await firstParallel(promises, (t): t is vscode.Terminal => !!t);
	}

	public insert(terminal: vscode.Terminal, termConfig: string) {
		this._terminalInstances.set(terminal, { lastUsedAt: Date.now(), config: termConfig });
	}

	public onTerminalClosed(terminal: vscode.Terminal) {
		this._terminalInstances.delete(terminal);
	}
}
