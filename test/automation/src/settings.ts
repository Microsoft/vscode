/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as path from 'path';
import { Editor } from './editor';
import { Editors } from './editors';
import { Code } from './code';
import { QuickAccess } from './quickaccess';

export class SettingsEditor {

	constructor(private code: Code, private userDataPath: string, private editors: Editors, private editor: Editor, private quickaccess: QuickAccess) { }

	async addUserSetting(setting: string, value: string): Promise<void> {
		await this.openSettings();
		await this.editor.waitForEditorFocus('settings.json', 1);

		await this.code.dispatchKeybinding('right');
		await this.editor.waitForTypeInEditor('settings.json', `"${setting}": ${value}`);
		await this.editors.saveOpenedFile();
	}

	async clearUserSettings(): Promise<void> {
		const settingsPath = path.join(this.userDataPath, 'User', 'settings.json');
		await new Promise((c, e) => fs.writeFile(settingsPath, '{\n}', 'utf8', err => err ? e(err) : c()));

		await this.openSettings();
		await this.editor.waitForEditorContents('settings.json', c => c === '{}');
	}

	private async openSettings(): Promise<void> {
		await this.quickaccess.runCommand('workbench.action.openSettingsJson');
	}
}
