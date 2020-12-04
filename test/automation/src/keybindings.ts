/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';

const SEARCH_INPUT = '.keybindings-header .settings-search-input input';

export class KeybindingsEditor {

	constructor(private code: Code) { }

	async updateKeybinding(command: string, commandName: string | undefined, keybinding: string, keybindingTitle: string): Promise<any> {
		if (process.platform === 'darwin') {
			await this.code.dispatchKeybinding('cmd+k cmd+s');
		} else {
			await this.code.dispatchKeybinding('ctrl+k ctrl+s');
		}

		await this.code.waitForActiveElement(SEARCH_INPUT);
		await this.code.waitForSetValue(SEARCH_INPUT, `@command:${command}`);

		const commandTitle = commandName ? `${commandName} (${command})` : command;
		await this.code.waitAndClick(`.keybindings-list-container .monaco-list-row.keybinding-item .command span.monaco-highlighted-label[title="${commandTitle}"]`);
		await this.code.waitForElement(`.keybindings-list-container .monaco-list-row.keybinding-item.focused.selected .command span.monaco-highlighted-label[title="${commandTitle}"]`);
		await this.code.dispatchKeybinding('enter');

		await this.code.waitForActiveElement('.defineKeybindingWidget .monaco-inputbox input');
		await this.code.dispatchKeybinding(keybinding);
		await this.code.dispatchKeybinding('enter');
		await this.code.waitForElement(`.keybindings-list-container .keybinding-label div[title="${keybindingTitle}"]`);
	}
}
