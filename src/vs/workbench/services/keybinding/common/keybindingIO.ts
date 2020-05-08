/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { SimpleKeybinding } from 'vs/base/common/keyCodes';
import { KeybindingParser } from 'vs/base/common/keybindingParser';
import { ScanCodeBinding } from 'vs/base/common/scanCode';
import { ContextKeyExpr, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { IUserFriendlyKeybinding } from 'vs/platform/keybinding/common/keybinding';
import { ResolvedKeybindingItem } from 'vs/platform/keybinding/common/resolvedKeybindingItem';

export interface IUserKeybindingItem {
	parts: (SimpleKeybinding | ScanCodeBinding)[];
	command: string | null;
	commandArgs?: any;
	when: ContextKeyExpression | undefined;
}

export class KeybindingIO {

	public static writeKeybindingItem(out: OutputBuilder, item: ResolvedKeybindingItem): void {
		if (!item.resolvedKeybinding) {
			return;
		}
		let quotedSerializedKeybinding = JSON.stringify(item.resolvedKeybinding.getUserSettingsLabel());
		out.write(`{ "key": ${rightPaddedString(quotedSerializedKeybinding + ',', 25)} "command": `);

		let quotedSerializedWhen = item.when ? JSON.stringify(item.when.serialize()) : '';
		let quotedSerializeCommand = JSON.stringify(item.command);
		if (quotedSerializedWhen.length > 0) {
			out.write(`${quotedSerializeCommand},`);
			out.writeLine();
			out.write(`                                     "when": ${quotedSerializedWhen}`);
		} else {
			out.write(`${quotedSerializeCommand}`);
		}
		if (item.commandArgs) {
			out.write(',');
			out.writeLine();
			out.write(`                                     "args": ${JSON.stringify(item.commandArgs)}`);
		}
		out.write(' }');
	}

	public static readUserKeybindingItem(input: IUserFriendlyKeybinding): IUserKeybindingItem {
		const parts = (typeof input.key === 'string' ? KeybindingParser.parseUserBinding(input.key) : []);
		const when = (typeof input.when === 'string' ? ContextKeyExpr.deserialize(input.when) : undefined);
		const command = (typeof input.command === 'string' ? input.command : null);
		const commandArgs = (typeof input.args !== 'undefined' ? input.args : undefined);
		return {
			parts: parts,
			command: command,
			commandArgs: commandArgs,
			when: when
		};
	}
}

function rightPaddedString(str: string, minChars: number): string {
	if (str.length < minChars) {
		return str + (new Array(minChars - str.length).join(' '));
	}
	return str;
}

export class OutputBuilder {

	private _lines: string[] = [];
	private _currentLine: string = '';

	write(str: string): void {
		this._currentLine += str;
	}

	writeLine(str: string = ''): void {
		this._lines.push(this._currentLine + str);
		this._currentLine = '';
	}

	toString(): string {
		this.writeLine();
		return this._lines.join('\n');
	}
}
