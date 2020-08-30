/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export function isWeb(): boolean {
	// @ts-expect-error
	return typeof navigator !== 'undefined' && vscode.env.uiKind === vscode.UIKind.Web;
}
