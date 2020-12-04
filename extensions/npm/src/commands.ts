/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vscode-nls';
import * as vscode from 'vscode';

import {
	detectNpmScriptsForFolder,
	findScriptAtPosition,
	runScript,
	FolderTaskItem
} from './tasks';

const localize = nls.loadMessageBundle();

export function runSelectedScript(context: vscode.ExtensionContext) {
	let editor = vscode.window.activeTextEditor;
	if (!editor) {
		return;
	}
	let document = editor.document;
	let contents = document.getText();
	let selection = editor.selection;
	let offset = document.offsetAt(selection.anchor);

	let script = findScriptAtPosition(contents, offset);
	if (script) {
		runScript(context, script, document);
	} else {
		let message = localize('noScriptFound', 'Could not find a valid npm script at the selection.');
		vscode.window.showErrorMessage(message);
	}
}

export async function selectAndRunScriptFromFolder(context: vscode.ExtensionContext, selectedFolder: vscode.Uri) {
	let taskList: FolderTaskItem[] = await detectNpmScriptsForFolder(context, selectedFolder);

	if (taskList && taskList.length > 0) {
		const quickPick = vscode.window.createQuickPick<FolderTaskItem>();
		quickPick.title = 'Run NPM script in Folder';
		quickPick.placeholder = 'Select an npm script';
		quickPick.items = taskList;

		const toDispose: vscode.Disposable[] = [];

		let pickPromise = new Promise<FolderTaskItem | undefined>((c) => {
			toDispose.push(quickPick.onDidAccept(() => {
				toDispose.forEach(d => d.dispose());
				c(quickPick.selectedItems[0]);
			}));
			toDispose.push(quickPick.onDidHide(() => {
				toDispose.forEach(d => d.dispose());
				c(undefined);
			}));
		});
		quickPick.show();
		let result = await pickPromise;
		quickPick.dispose();
		if (result) {
			vscode.tasks.executeTask(result.task);
		}
	}
	else {
		vscode.window.showInformationMessage(`No npm scripts found in ${selectedFolder.fsPath}`, { modal: true });
	}
}
