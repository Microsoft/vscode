/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface DocumentSelector {
	/**
	 * Selector for files which only require a basic syntax server.
	 */
	readonly syntax: vscode.DocumentFilter[];

	/**
	 * Selector for files which require semantic server support.
	 */
	readonly semantic: vscode.DocumentFilter[];
}
