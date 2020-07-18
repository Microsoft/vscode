/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICommandService, CommandsRegistry, ICommandHandlerDescription } from 'vs/platform/commands/common/commands';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { ExtHostContext, MainThreadCommandsShape, ExtHostCommandsShape, MainContext, IExtHostContext } from '../common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { revive } from 'vs/base/common/marshalling';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';

@extHostNamedCustomer(MainContext.MainThreadCommands)
export class MainThreadCommands implements MainThreadCommandsShape {

	private readonly _commandRegistrations = new Map<string, IDisposable>();
	private readonly _generateCommandsDocumentationRegistration: IDisposable;
	private readonly _proxy: ExtHostCommandsShape;

	constructor(
		extHostContext: IExtHostContext,
		@ICommandService private readonly _commandService: ICommandService,
		@IExtensionService private readonly _extensionService: IExtensionService,
	) {
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostCommands);

		this._generateCommandsDocumentationRegistration = CommandsRegistry.registerCommand('_generateCommandsDocumentation', () => this._generateCommandsDocumentation());
	}

	dispose() {
		dispose(this._commandRegistrations.values());
		this._commandRegistrations.clear();

		this._generateCommandsDocumentationRegistration.dispose();
	}

	private _generateCommandsDocumentation(): Promise<void> {
		return this._proxy.$getContributedCommandHandlerDescriptions().then(result => {
			// add local commands
			const commands = CommandsRegistry.getCommands();
			for (const [id, command] of commands) {
				if (command.description) {
					result[id] = command.description;
				}
			}

			// print all as markdown
			const all: string[] = [];
			for (let id in result) {
				all.push('`' + id + '` - ' + _generateMarkdown(result[id]));
			}
			console.log(all.join('\n'));
		});
	}

	$registerCommand(id: string): void {
		this._commandRegistrations.set(
			id,
			CommandsRegistry.registerCommand(id, (accessor, ...args) => {
				return this._proxy.$executeContributedCommand(id, ...args).then(result => {
					return revive(result);
				});
			})
		);
	}

	$unregisterCommand(id: string): void {
		const command = this._commandRegistrations.get(id);
		if (command) {
			command.dispose();
			this._commandRegistrations.delete(id);
		}
	}

	async $executeCommand<T>(id: string, args: any[], retry: boolean): Promise<T | undefined> {
		for (let i = 0; i < args.length; i++) {
			args[i] = revive(args[i]);
		}
		if (retry && args.length > 0 && !CommandsRegistry.getCommand(id)) {
			await this._extensionService.activateByEvent(`onCommand:${id}`);
			throw new Error('$executeCommand:retry');
		}
		return this._commandService.executeCommand<T>(id, ...args);
	}

	$getCommands(): Promise<string[]> {
		return Promise.resolve([...CommandsRegistry.getCommands().keys()]);
	}
}

// --- command doc

function _generateMarkdown(description: string | ICommandHandlerDescription): string {
	if (typeof description === 'string') {
		return description;
	} else {
		const parts = [description.description];
		parts.push('\n\n');
		if (description.args) {
			for (let arg of description.args) {
				parts.push(`* _${arg.name}_ - ${arg.description || ''}\n`);
			}
		}
		if (description.returns) {
			parts.push(`* _(returns)_ - ${description.returns}`);
		}
		parts.push('\n\n');
		return parts.join('');
	}
}
