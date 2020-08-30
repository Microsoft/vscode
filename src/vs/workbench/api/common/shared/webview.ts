/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import type * as vscode from 'vscode';

export interface WebviewInitData {
	readonly isExtensionDevelopmentDebug: boolean;
	readonly webviewResourceRoot: string;
	readonly webviewCspSource: string;
}

export function asWebviewUri(
	initData: WebviewInitData,
	uuid: string,
	resource: vscode.Uri,
): vscode.Uri {
	const uri = initData.webviewResourceRoot
		// Make sure we preserve the scheme of the resource but convert it into a normal path segment
		// The scheme is important as we need to know if we are requesting a local or a remote resource.
		.replace('{{resource}}', resource.scheme + withoutScheme(resource))
		.replace('{{uuid}}', uuid);
	return URI.parse(uri);
}

function withoutScheme(resource: vscode.Uri): string {
	return resource.toString().replace(/^\S+?:/, '');
}
