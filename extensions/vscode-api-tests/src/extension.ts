/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AbcEditorProvider } from './abcEditor';

export function activate(context: vscode.ExtensionContext) {
	enableCustomEditors(context);
}

export function enableCustomEditors(context: vscode.ExtensionContext) {
	context.subscriptions.push(new AbcEditorProvider(context).register());
}
