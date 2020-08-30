/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { AbcTextEditorProvider } from './customTextEditor';

export function activate(context: vscode.ExtensionContext) {
	context.subscriptions.push(new AbcTextEditorProvider(context).register());
}
