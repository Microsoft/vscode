/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { commands, ExtensionContext, Uri, window, workspace } from 'vscode';
import { ChangeStore } from './changeStore';
import { ContextStore } from './contextStore';
import { VirtualFS } from './fs';
import { GitHubApiContext, GitHubApi } from './github/api';
import { GitHubFS } from './github/fs';
import { VirtualSCM } from './scm';
import { StatusBar } from './statusbar';

const repositoryRegex = /^(?:(?:https:\/\/)?github.com\/)?([^\/]+)\/([^\/]+?)(?:\/|.git|$)/i;

export async function activate(context: ExtensionContext) {
	const contextStore = new ContextStore<GitHubApiContext>('codespace', GitHubFS.scheme, context.workspaceState);
	const changeStore = new ChangeStore(context.workspaceState);

	const githubApi = new GitHubApi(contextStore);
	const gitHubFS = new GitHubFS(githubApi);
	const virtualFS = new VirtualFS('codespace', contextStore, changeStore, gitHubFS);

	context.subscriptions.push(
		githubApi,
		gitHubFS,
		virtualFS,
		new VirtualSCM(GitHubFS.scheme, githubApi, changeStore),
		new StatusBar(contextStore, changeStore),
	);

	commands.registerCommand('githubBrowser.openRepository', async () => {
		const value = await window.showInputBox({
			placeHolder: 'e.g. https://github.com/microsoft/vscode',
			prompt: 'Enter a GitHub repository url',
			validateInput: value => repositoryRegex.test(value) ? undefined : 'Invalid repository url'
		});

		if (value) {
			const match = repositoryRegex.exec(value);
			if (match) {
				const [, owner, repo] = match;

				const uri = Uri.parse(`codespace://HEAD/${owner}/${repo}`);
				openWorkspace(uri, repo, 'currentWindow');
			}
		}
	});
}

export function getRelativePath(rootUri: Uri, uri: Uri) {
	return uri.path.substr(rootUri.path.length + 1);
}

export function getRootUri(uri: Uri) {
	return workspace.getWorkspaceFolder(uri)?.uri;
}

export function isChild(folderPath: string, filePath: string) {
	return isDescendent(folderPath, filePath) && filePath.substr(folderPath.length + (folderPath.endsWith('/') ? 0 : 1)).split('/').length === 1;
}

export function isDescendent(folderPath: string, filePath: string) {
	return folderPath.length === 0 || filePath.startsWith(folderPath.endsWith('/') ? folderPath : `${folderPath}/`);
}

const shaRegex = /^[0-9a-f]{40}$/;
export function isSha(ref: string) {
	return shaRegex.test(ref);
}

function openWorkspace(uri: Uri, name: string, location: 'currentWindow' | 'newWindow' | 'addToCurrentWorkspace') {
	if (location === 'addToCurrentWorkspace') {
		const count = (workspace.workspaceFolders && workspace.workspaceFolders.length) || 0;
		return workspace.updateWorkspaceFolders(count, 0, { uri: uri, name: name });
	}

	return commands.executeCommand('vscode.openFolder', uri, location === 'newWindow');
}
