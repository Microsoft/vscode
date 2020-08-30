/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

export interface WebviewResourceProvider {
	asWebviewUri(resource: vscode.Uri): vscode.Uri;

	readonly cspSource: string;
}

export function normalizeResource(
	base: vscode.Uri,
	resource: vscode.Uri
): vscode.Uri {
	// If we  have a windows path and are loading a workspace with an authority,
	// make sure we use a unc path with an explicit localhost authority.
	//
	// Otherwise, the `<base>` rule will insert the authority into the resolved resource
	// URI incorrectly.
	if (base.authority && !resource.authority) {
		const driveMatch = resource.path.match(/^\/(\w):\//);
		if (driveMatch) {
			return vscode.Uri.file(`\\\\localhost\\${driveMatch[1]}$\\${resource.fsPath.replace(/^\w:\\/, '')}`).with({
				fragment: resource.fragment,
				query: resource.query
			});
		}
	}
	return resource;
}
