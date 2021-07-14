/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { WebFS } from './WebFS';

const SCHEME = 'webfs';

export async function activate(context: vscode.ExtensionContext) {
	if (typeof window !== 'undefined') {
		const webFs = await enableFs(context);
		enableSearch(context, webFs);
	}
}

async function enableFs(context: vscode.ExtensionContext): Promise<WebFS> {
	const webFs = new WebFS();
	context.subscriptions.push(vscode.workspace.registerFileSystemProvider(SCHEME, webFs, { isCaseSensitive: true }));
	const initialized = await webFs.exists(vscode.Uri.parse('webfs:/'));
	if (!initialized) {
		const textEncoder = new TextEncoder();

		await webFs.createDirectory(vscode.Uri.parse(`webfs:/`));
		await webFs.writeFile(vscode.Uri.parse(`webfs:/MANUAL.md`), textEncoder.encode(MANUAL), {
			create: true,
			overwrite: true
		});
		vscode.commands.executeCommand('vscode.open', vscode.Uri.parse(`webfs:/MANUAL.md`));
	}
	return webFs;
}

function enableSearch(context: vscode.ExtensionContext, webFs: WebFS): void {
	// @ts-ignore
	context.subscriptions.push(vscode.workspace.registerFileSearchProvider(SCHEME, webFs));
	// @ts-ignore
	context.subscriptions.push(vscode.workspace.registerTextSearchProvider(SCHEME, webFs));
}

const MANUAL = `# vscode: Web Standalone

## What's this?

- vscode on WebStorage(IndexedDB) backend

## Open your project

- Create your directroy on Filer(←)
- Open URL with folder query like https://mizchi-vscode-playground.netlify.com/?folder=webfs:/my-project
`;
