/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IWindowsShellHelper, ITerminalChildProcess, IDefaultShellAndArgsRequest } from 'vs/workbench/contrib/terminal/common/terminal';
import { Terminal as XTermTerminal } from 'xterm';
import { SearchAddon as XTermSearchAddon } from 'xterm-addon-search';
import { Unicode11Addon as XTermUnicode11Addon } from 'xterm-addon-unicode11';
import { WebglAddon as XTermWebglAddon } from 'xterm-addon-webgl';
import { IProcessEnvironment } from 'vs/base/common/platform';
import { Emitter, Event } from 'vs/base/common/event';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

let Terminal: typeof XTermTerminal;
let SearchAddon: typeof XTermSearchAddon;
let Unicode11Addon: typeof XTermUnicode11Addon;
let WebglAddon: typeof XTermWebglAddon;

export class TerminalInstanceService implements ITerminalInstanceService {
	public _serviceBrand: undefined;

	private readonly _onRequestDefaultShellAndArgs = new Emitter<IDefaultShellAndArgsRequest>();
	public get onRequestDefaultShellAndArgs(): Event<IDefaultShellAndArgsRequest> { return this._onRequestDefaultShellAndArgs.event; }

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

	public createWindowsShellHelper(): IWindowsShellHelper {
		throw new Error('Not implemented');
	}

	public createTerminalProcess(): ITerminalChildProcess {
		throw new Error('Not implemented');
	}

	public getDefaultShellAndArgs(useAutomationShell: boolean,): Promise<{ shell: string, args: string[] | string | undefined }> {
		return new Promise(r => this._onRequestDefaultShellAndArgs.fire({
			useAutomationShell,
			callback: (shell, args) => r({ shell, args })
		}));
	}

	public async getMainProcessParentEnv(): Promise<IProcessEnvironment> {
		return {};
	}
}

registerSingleton(ITerminalInstanceService, TerminalInstanceService, true);
