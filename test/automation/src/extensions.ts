/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Viewlet } from './viewlet';
import { Code } from './code';

const SEARCH_BOX = 'div.extensions-viewlet[id="workbench.view.extensions"] .monaco-editor textarea';

export class Extensions extends Viewlet {

	constructor(code: Code) {
		super(code);
	}

	async openExtensionsViewlet(): Promise<any> {
		if (process.platform === 'darwin') {
			await this.code.dispatchKeybinding('cmd+shift+x');
		} else {
			await this.code.dispatchKeybinding('ctrl+shift+x');
		}

		await this.code.waitForActiveElement(SEARCH_BOX);
	}

	async searchForExtension(id: string): Promise<any> {
		await this.code.waitAndClick(SEARCH_BOX);
		await this.code.waitForActiveElement(SEARCH_BOX);
		await this.code.waitForTypeInEditor(SEARCH_BOX, `@id:${id}`);
		await this.code.waitForElement(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"]`);
	}

	async openExtension(id: string): Promise<any> {
		await this.searchForExtension(id);
		await this.code.waitAndClick(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"]`);
	}

	async closeExtension(title: string): Promise<any> {
		await this.code.waitAndClick(`.tabs-container div.tab[title="Extension: ${title}"] div.tab-actions a.action-label.codicon.codicon-close`);
	}

	async installExtension(id: string, waitUntilEnabled: boolean): Promise<void> {
		await this.searchForExtension(id);
		await this.code.waitAndClick(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"] .extension-list-item .monaco-action-bar .action-item:not(.disabled) .extension-action.install`);
		await this.code.waitForElement(`.extension-editor .monaco-action-bar .action-item:not(.disabled) .extension-action.uninstall`);
		if (waitUntilEnabled) {
			await this.code.waitForElement(`.extension-editor .monaco-action-bar .action-item:not(.disabled) .extension-action[title="Disable this extension"]`);
		}
	}

}
