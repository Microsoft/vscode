/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { activateEmmetExtension } from '../emmetCommon';

export function activate(context: vscode.ExtensionContext) {
	activateEmmetExtension(context);
}
