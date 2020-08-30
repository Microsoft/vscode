/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
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

	async waitForExtensionsViewlet(): Promise<any> {
		await this.code.waitForElement(SEARCH_BOX);
	}

	async searchForExtension(id: string): Promise<any> {
		await this.code.waitAndClick(SEARCH_BOX);
		await this.code.waitForActiveElement(SEARCH_BOX);
		await this.code.waitForTypeInEditor(SEARCH_BOX, `@id:${id}`);
	}

	async installExtension(id: string): Promise<void> {
		await this.searchForExtension(id);
		await this.code.waitAndClick(`div.extensions-viewlet[id="workbench.view.extensions"] .monaco-list-row[data-extension-id="${id}"] .extension-list-item li[class='action-item'] .extension-action.install`);
		await this.code.waitForElement(`.extension-editor .monaco-action-bar .action-item:not(.disabled) .extension-action.uninstall`);
	}
}
