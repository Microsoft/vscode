/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface Command {
	readonly id: string | string[];

	execute(...args: any[]): void;
}

export class CommandManager {
	private readonly commands = new Map<string, vscode.Disposable>();

	public dispose() {
		for (const registration of this.commands.values()) {
			registration.dispose();
		}
		this.commands.clear();
	}

	public register<T extends Command>(command: T): T {
		for (const id of Array.isArray(command.id) ? command.id : [command.id]) {
			this.registerCommand(id, command.execute, command);
		}
		return command;
	}

	private registerCommand(id: string, impl: (...args: any[]) => void, thisArg?: any) {
		if (this.commands.has(id)) {
			return;
		}

		this.commands.set(id, vscode.commands.registerCommand(id, impl, thisArg));
	}
}