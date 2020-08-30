/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function randomFilePath(args: { root: vscode.Uri, ext: string }): vscode.Uri {
	const fileName = Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 10);
	return (vscode.Uri as any).joinPath(args.root, fileName + args.ext);
}

export function closeAllEditors(): Thenable<any> {
	return vscode.commands.executeCommand('workbench.action.closeAllEditors');
}

export function disposeAll(disposables: vscode.Disposable[]) {
	vscode.Disposable.from(...disposables).dispose();
}

export function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms));
}
