/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { validateConstraint } from 'vs/base/common/types';
import { ICommandHandlerDescription } from 'vs/platform/commands/common/commands';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import * as extHostTypeConverter from 'vs/workbench/api/common/extHostTypeConverters';
import { cloneAndChange } from 'vs/base/common/objects';
import { MainContext, MainThreadCommandsShape, ExtHostCommandsShape, ObjectIdentifier, ICommandDto } from './extHost.protocol';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import * as modes from 'vs/editor/common/modes';
import type * as vscode from 'vscode';
import { ILogService } from 'vs/platform/log/common/log';
import { revive } from 'vs/base/common/marshalling';
import { Range } from 'vs/editor/common/core/range';
import { Position } from 'vs/editor/common/core/position';
import { URI } from 'vs/base/common/uri';
import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';

interface CommandHandler {
	callback: Function;
	thisArg: any;
	description?: ICommandHandlerDescription;
}

export interface ArgumentProcessor {
	processArgument(arg: any): any;
}

export class ExtHostCommands implements ExtHostCommandsShape {

	readonly _serviceBrand: undefined;

	private readonly _commands = new Map<string, CommandHandler>();
	private readonly _proxy: MainThreadCommandsShape;
	private readonly _converter: CommandsConverter;
	private readonly _logService: ILogService;
	private readonly _argumentProcessors: ArgumentProcessor[];

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@ILogService logService: ILogService
	) {
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadCommands);
		this._logService = logService;
		this._converter = new CommandsConverter(this, logService);
		this._argumentProcessors = [
			{
				processArgument(a) {
					// URI, Regex
					return revive(a);
				}
			},
			{
				processArgument(arg) {
					return cloneAndChange(arg, function (obj) {
						// Reverse of https://github.com/Microsoft/vscode/blob/1f28c5fc681f4c01226460b6d1c7e91b8acb4a5b/src/vs/workbench/api/node/extHostCommands.ts#L112-L127
						if (Range.isIRange(obj)) {
							return extHostTypeConverter.Range.to(obj);
						}
						if (Position.isIPosition(obj)) {
							return extHostTypeConverter.Position.to(obj);
						}
						if (Range.isIRange((obj as modes.Location).range) && URI.isUri((obj as modes.Location).uri)) {
							return extHostTypeConverter.location.to(obj);
						}
						if (!Array.isArray(obj)) {
							return obj;
						}
					});
				}
			}
		];
	}

	get converter(): CommandsConverter {
		return this._converter;
	}

	registerArgumentProcessor(processor: ArgumentProcessor): void {
		this._argumentProcessors.push(processor);
	}

	registerCommand(global: boolean, id: string, callback: <T>(...args: any[]) => T | Thenable<T>, thisArg?: any, description?: ICommandHandlerDescription): extHostTypes.Disposable {
		this._logService.trace('ExtHostCommands#registerCommand', id);

		if (!id.trim().length) {
			throw new Error('invalid id');
		}

		if (this._commands.has(id)) {
			throw new Error(`command '${id}' already exists`);
		}

		this._commands.set(id, { callback, thisArg, description });
		if (global) {
			this._proxy.$registerCommand(id);
		}

		return new extHostTypes.Disposable(() => {
			if (this._commands.delete(id)) {
				if (global) {
					this._proxy.$unregisterCommand(id);
				}
			}
		});
	}

	executeCommand<T>(id: string, ...args: any[]): Promise<T> {
		this._logService.trace('ExtHostCommands#executeCommand', id);
		return this._doExecuteCommand(id, args, true);
	}

	private async _doExecuteCommand<T>(id: string, args: any[], retry: boolean): Promise<T> {

		if (this._commands.has(id)) {
			// we stay inside the extension host and support
			// to pass any kind of parameters around
			return this._executeContributedCommand<T>(id, args);

		} else {
			// automagically convert some argument types
			const toArgs = cloneAndChange(args, function (value) {
				if (value instanceof extHostTypes.Position) {
					return extHostTypeConverter.Position.from(value);
				}
				if (value instanceof extHostTypes.Range) {
					return extHostTypeConverter.Range.from(value);
				}
				if (value instanceof extHostTypes.Location) {
					return extHostTypeConverter.location.from(value);
				}
				if (!Array.isArray(value)) {
					return value;
				}
			});

			try {
				const result = await this._proxy.$executeCommand<T>(id, toArgs, retry);
				return revive(result);
			} catch (e) {
				// Rerun the command when it wasn't known, had arguments, and when retry
				// is enabled. We do this because the command might be registered inside
				// the extension host now and can therfore accept the arguments as-is.
				if (e instanceof Error && e.message === '$executeCommand:retry') {
					return this._doExecuteCommand(id, args, false);
				} else {
					throw e;
				}
			}
		}
	}

	private _executeContributedCommand<T>(id: string, args: any[]): Promise<T> {
		const command = this._commands.get(id);
		if (!command) {
			throw new Error('Unknown command');
		}
		let { callback, thisArg, description } = command;
		if (description) {
			for (let i = 0; i < description.args.length; i++) {
				try {
					validateConstraint(args[i], description.args[i].constraint);
				} catch (err) {
					return Promise.reject(new Error(`Running the contributed command: '${id}' failed. Illegal argument '${description.args[i].name}' - ${description.args[i].description}`));
				}
			}
		}

		try {
			const result = callback.apply(thisArg, args);
			return Promise.resolve(result);
		} catch (err) {
			this._logService.error(err, id);
			return Promise.reject(new Error(`Running the contributed command: '${id}' failed.`));
		}
	}

	$executeContributedCommand<T>(id: string, ...args: any[]): Promise<T> {
		this._logService.trace('ExtHostCommands#$executeContributedCommand', id);

		if (!this._commands.has(id)) {
			return Promise.reject(new Error(`Contributed command '${id}' does not exist.`));
		} else {
			args = args.map(arg => this._argumentProcessors.reduce((r, p) => p.processArgument(r), arg));
			return this._executeContributedCommand(id, args);
		}
	}

	getCommands(filterUnderscoreCommands: boolean = false): Promise<string[]> {
		this._logService.trace('ExtHostCommands#getCommands', filterUnderscoreCommands);

		return this._proxy.$getCommands().then(result => {
			if (filterUnderscoreCommands) {
				result = result.filter(command => command[0] !== '_');
			}
			return result;
		});
	}

	$getContributedCommandHandlerDescriptions(): Promise<{ [id: string]: string | ICommandHandlerDescription }> {
		const result: { [id: string]: string | ICommandHandlerDescription } = Object.create(null);
		for (let [id, command] of this._commands) {
			let { description } = command;
			if (description) {
				result[id] = description;
			}
		}
		return Promise.resolve(result);
	}
}


export class CommandsConverter {

	private readonly _delegatingCommandId: string;
	private readonly _cache = new Map<number, vscode.Command>();
	private _cachIdPool = 0;

	// --- conversion between internal and api commands
	constructor(
		private readonly _commands: ExtHostCommands,
		private readonly _logService: ILogService
	) {
		this._delegatingCommandId = `_vscode_delegate_cmd_${Date.now().toString(36)}`;
		this._commands.registerCommand(true, this._delegatingCommandId, this._executeConvertedCommand, this);
	}

	toInternal(command: vscode.Command, disposables: DisposableStore): ICommandDto;
	toInternal(command: vscode.Command | undefined, disposables: DisposableStore): ICommandDto | undefined;
	toInternal(command: vscode.Command | undefined, disposables: DisposableStore): ICommandDto | undefined {

		if (!command) {
			return undefined;
		}

		const result: ICommandDto = {
			$ident: undefined,
			id: command.command,
			title: command.title,
			tooltip: command.tooltip
		};

		if (command.command && isNonEmptyArray(command.arguments)) {
			// we have a contributed command with arguments. that
			// means we don't want to send the arguments around

			const id = ++this._cachIdPool;
			this._cache.set(id, command);
			disposables.add(toDisposable(() => {
				this._cache.delete(id);
				this._logService.trace('CommandsConverter#DISPOSE', id);
			}));
			result.$ident = id;

			result.id = this._delegatingCommandId;
			result.arguments = [id];

			this._logService.trace('CommandsConverter#CREATE', command.command, id);
		}

		return result;
	}

	fromInternal(command: modes.Command): vscode.Command | undefined {

		const id = ObjectIdentifier.of(command);
		if (typeof id === 'number') {
			return this._cache.get(id);

		} else {
			return {
				command: command.id,
				title: command.title,
				arguments: command.arguments
			};
		}
	}

	private _executeConvertedCommand<R>(...args: any[]): Promise<R> {
		const actualCmd = this._cache.get(args[0]);
		this._logService.trace('CommandsConverter#EXECUTE', args[0], actualCmd ? actualCmd.command : 'MISSING');

		if (!actualCmd) {
			return Promise.reject('actual command NOT FOUND');
		}
		return this._commands.executeCommand(actualCmd.command, ...(actualCmd.arguments || []));
	}

}

export interface IExtHostCommands extends ExtHostCommands { }
export const IExtHostCommands = createDecorator<IExtHostCommands>('IExtHostCommands');
