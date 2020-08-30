/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Code } from './code';

export class Editors {

	constructor(private code: Code) { }

	async saveOpenedFile(): Promise<any> {
		if (process.platform === 'darwin') {
			await this.code.dispatchKeybinding('cmd+s');
		} else {
			await this.code.dispatchKeybinding('ctrl+s');
		}
	}

	async selectTab(fileName: string): Promise<void> {
		await this.code.waitAndClick(`.tabs-container div.tab[data-resource-name$="${fileName}"]`);
		await this.waitForEditorFocus(fileName);
	}

	async waitForActiveEditor(fileName: string): Promise<any> {
		const selector = `.editor-instance .monaco-editor[data-uri$="${fileName}"] textarea`;
		return this.code.waitForActiveElement(selector);
	}

	async waitForEditorFocus(fileName: string): Promise<void> {
		await this.waitForActiveTab(fileName);
		await this.waitForActiveEditor(fileName);
	}

	async waitForActiveTab(fileName: string, isDirty: boolean = false): Promise<void> {
		await this.code.waitForElement(`.tabs-container div.tab.active${isDirty ? '.dirty' : ''}[aria-selected="true"][data-resource-name$="${fileName}"]`);
	}

	async waitForTab(fileName: string, isDirty: boolean = false): Promise<void> {
		await this.code.waitForElement(`.tabs-container div.tab${isDirty ? '.dirty' : ''}[data-resource-name$="${fileName}"]`);
	}

	async newUntitledFile(): Promise<void> {
		if (process.platform === 'darwin') {
			await this.code.dispatchKeybinding('cmd+n');
		} else {
			await this.code.dispatchKeybinding('ctrl+n');
		}

		await this.waitForEditorFocus('Untitled-1');
	}
}
