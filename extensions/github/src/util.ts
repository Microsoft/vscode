/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function dispose(arg: vscode.Disposable | Iterable<vscode.Disposable>): void {
	if (arg instanceof vscode.Disposable) {
		arg.dispose();
	} else {
		for (const disposable of arg) {
			disposable.dispose();
		}
	}
}

export function combinedDisposable(disposables: Iterable<vscode.Disposable>): vscode.Disposable {
	return {
		dispose() {
			dispose(disposables);
		}
	};
}
