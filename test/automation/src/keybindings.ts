/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';

const SEARCH_INPUT = '.keybindings-header .settings-search-input input';

export class KeybindingsEditor {

	constructor(private code: Code) { }

	async updateKeybinding(command: string, keybinding: string, title: string): Promise<any> {
		if (process.platform === 'darwin') {
			await this.code.dispatchKeybinding('cmd+k cmd+s');
		} else {
			await this.code.dispatchKeybinding('ctrl+k ctrl+s');
		}

		await this.code.waitForActiveElement(SEARCH_INPUT);
		await this.code.waitForSetValue(SEARCH_INPUT, command);

		await this.code.waitAndClick('.keybindings-list-container .monaco-list-row.keybinding-item');
		await this.code.waitForElement('.keybindings-list-container .monaco-list-row.keybinding-item.focused.selected');

		await this.code.waitAndClick('.keybindings-list-container .monaco-list-row.keybinding-item .action-item .codicon-keybindings-add');
		await this.code.waitForActiveElement('.defineKeybindingWidget .monaco-inputbox input');

		await this.code.dispatchKeybinding(keybinding);
		await this.code.dispatchKeybinding('enter');
		await this.code.waitForElement(`.keybindings-list-container .keybinding-label div[title="${title}"]`);
	}
}
