/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { StatusbarAlignment as MainThreadStatusBarAlignment } from 'vs/workbench/services/statusbar/common/statusbar';
import { StatusBarAlignment as ExtHostStatusBarAlignment, Disposable, ThemeColor } from './extHostTypes';
import type * as vscode from 'vscode';
import { MainContext, MainThreadStatusBarShape, IMainContext, ICommandDto } from './extHost.protocol';
import { localize } from 'vs/nls';
import { CommandsConverter } from 'vs/workbench/api/common/extHostCommands';
import { DisposableStore } from 'vs/base/common/lifecycle';

export class ExtHostStatusBarEntry implements vscode.StatusBarItem {
	private static ID_GEN = 0;

	private _id: number;
	private _alignment: number;
	private _priority?: number;
	private _disposed: boolean = false;
	private _visible: boolean = false;

	private _statusId: string;
	private _statusName: string;

	private _text: string = '';
	private _tooltip?: string;
	private _color?: string | ThemeColor;
	private readonly _internalCommandRegistration = new DisposableStore();
	private _command?: {
		readonly fromApi: string | vscode.Command,
		readonly internal: ICommandDto,
	};

	private _timeoutHandle: any;
	private _proxy: MainThreadStatusBarShape;
	private _commands: CommandsConverter;
	private _accessibilityInformation?: vscode.AccessibilityInformation;

	constructor(proxy: MainThreadStatusBarShape, commands: CommandsConverter, id: string, name: string, alignment: ExtHostStatusBarAlignment = ExtHostStatusBarAlignment.Left, priority?: number, accessibilityInformation?: vscode.AccessibilityInformation) {
		this._id = ExtHostStatusBarEntry.ID_GEN++;
		this._proxy = proxy;
		this._commands = commands;
		this._statusId = id;
		this._statusName = name;
		this._alignment = alignment;
		this._priority = priority;
		this._accessibilityInformation = accessibilityInformation;
	}

	public get id(): number {
		return this._id;
	}

	public get alignment(): vscode.StatusBarAlignment {
		return this._alignment;
	}

	public get priority(): number | undefined {
		return this._priority;
	}

	public get text(): string {
		return this._text;
	}

	public get tooltip(): string | undefined {
		return this._tooltip;
	}

	public get color(): string | ThemeColor | undefined {
		return this._color;
	}

	public get command(): string | vscode.Command | undefined {
		return this._command?.fromApi;
	}

	public get accessibilityInformation(): vscode.AccessibilityInformation | undefined {
		return this._accessibilityInformation;
	}

	public set text(text: string) {
		this._text = text;
		this.update();
	}

	public set tooltip(tooltip: string | undefined) {
		this._tooltip = tooltip;
		this.update();
	}

	public set color(color: string | ThemeColor | undefined) {
		this._color = color;
		this.update();
	}

	public set command(command: string | vscode.Command | undefined) {
		if (this._command?.fromApi === command) {
			return;
		}

		this._internalCommandRegistration.clear();
		if (typeof command === 'string') {
			this._command = {
				fromApi: command,
				internal: this._commands.toInternal({ title: '', command }, this._internalCommandRegistration),
			};
		} else if (command) {
			this._command = {
				fromApi: command,
				internal: this._commands.toInternal(command, this._internalCommandRegistration),
			};
		} else {
			this._command = undefined;
		}
		this.update();
	}

	public set accessibilityInformation(accessibilityInformation: vscode.AccessibilityInformation | undefined) {
		this._accessibilityInformation = accessibilityInformation;
		this.update();
	}

	public show(): void {
		this._visible = true;
		this.update();
	}

	public hide(): void {
		clearTimeout(this._timeoutHandle);
		this._visible = false;
		this._proxy.$dispose(this.id);
	}

	private update(): void {
		if (this._disposed || !this._visible) {
			return;
		}

		clearTimeout(this._timeoutHandle);

		// Defer the update so that multiple changes to setters dont cause a redraw each
		this._timeoutHandle = setTimeout(() => {
			this._timeoutHandle = undefined;

			// Set to status bar
			this._proxy.$setEntry(this.id, this._statusId, this._statusName, this.text, this.tooltip, this._command?.internal, this.color,
				this._alignment === ExtHostStatusBarAlignment.Left ? MainThreadStatusBarAlignment.LEFT : MainThreadStatusBarAlignment.RIGHT,
				this._priority, this._accessibilityInformation);
		}, 0);
	}

	public dispose(): void {
		this.hide();
		this._disposed = true;
	}
}

class StatusBarMessage {

	private _item: vscode.StatusBarItem;
	private _messages: { message: string }[] = [];

	constructor(statusBar: ExtHostStatusBar) {
		this._item = statusBar.createStatusBarEntry('status.extensionMessage', localize('status.extensionMessage', "Extension Status"), ExtHostStatusBarAlignment.Left, Number.MIN_VALUE);
	}

	dispose() {
		this._messages.length = 0;
		this._item.dispose();
	}

	setMessage(message: string): Disposable {
		const data: { message: string } = { message }; // use object to not confuse equal strings
		this._messages.unshift(data);
		this._update();

		return new Disposable(() => {
			const idx = this._messages.indexOf(data);
			if (idx >= 0) {
				this._messages.splice(idx, 1);
				this._update();
			}
		});
	}

	private _update() {
		if (this._messages.length > 0) {
			this._item.text = this._messages[0].message;
			this._item.show();
		} else {
			this._item.hide();
		}
	}
}

export class ExtHostStatusBar {

	private readonly _proxy: MainThreadStatusBarShape;
	private readonly _commands: CommandsConverter;
	private _statusMessage: StatusBarMessage;

	constructor(mainContext: IMainContext, commands: CommandsConverter) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadStatusBar);
		this._commands = commands;
		this._statusMessage = new StatusBarMessage(this);
	}

	createStatusBarEntry(id: string, name: string, alignment?: ExtHostStatusBarAlignment, priority?: number, accessibilityInformation?: vscode.AccessibilityInformation): vscode.StatusBarItem {
		return new ExtHostStatusBarEntry(this._proxy, this._commands, id, name, alignment, priority, accessibilityInformation);
	}

	setStatusBarMessage(text: string, timeoutOrThenable?: number | Thenable<any>): Disposable {

		const d = this._statusMessage.setMessage(text);
		let handle: any;

		if (typeof timeoutOrThenable === 'number') {
			handle = setTimeout(() => d.dispose(), timeoutOrThenable);
		} else if (typeof timeoutOrThenable !== 'undefined') {
			timeoutOrThenable.then(() => d.dispose(), () => d.dispose());
		}

		return new Disposable(() => {
			d.dispose();
			clearTimeout(handle);
		});
	}
}
