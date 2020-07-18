/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as httpRequest from 'request-light';
import * as vscode from 'vscode';
import { addJSONProviders } from './features/jsonContributions';
import { runSelectedScript, selectAndRunScriptFromFolder } from './commands';
import { NpmScriptsTreeDataProvider } from './npmView';
import { invalidateTasksCache, NpmTaskProvider, hasPackageJson } from './tasks';
import { invalidateHoverScriptsCache, NpmScriptHoverProvider } from './scriptHover';

let treeDataProvider: NpmScriptsTreeDataProvider | undefined;

export async function activate(context: vscode.ExtensionContext): Promise<void> {
	configureHttpRequest();
	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
		if (e.affectsConfiguration('http.proxy') || e.affectsConfiguration('http.proxyStrictSSL')) {
			configureHttpRequest();
		}
	}));

	const canRunNPM = canRunNpmInCurrentWorkspace();
	context.subscriptions.push(addJSONProviders(httpRequest.xhr, canRunNPM));

	treeDataProvider = registerExplorer(context);

	context.subscriptions.push(vscode.workspace.onDidChangeConfiguration((e) => {
		if (e.affectsConfiguration('npm.exclude') || e.affectsConfiguration('npm.autoDetect')) {
			invalidateTasksCache();
			if (treeDataProvider) {
				treeDataProvider.refresh();
			}
		}
		if (e.affectsConfiguration('npm.scriptExplorerAction')) {
			if (treeDataProvider) {
				treeDataProvider.refresh();
			}
		}
	}));

	registerTaskProvider(context);
	registerHoverProvider(context);

	context.subscriptions.push(vscode.commands.registerCommand('npm.runSelectedScript', runSelectedScript));

	if (await hasPackageJson()) {
		vscode.commands.executeCommand('setContext', 'npm:showScriptExplorer', true);
	}

	context.subscriptions.push(vscode.commands.registerCommand('npm.runScriptFromFolder', selectAndRunScriptFromFolder));
}

function canRunNpmInCurrentWorkspace() {
	if (vscode.workspace.workspaceFolders) {
		return vscode.workspace.workspaceFolders.some(f => f.uri.scheme === 'file');
	}
	return false;
}

function registerTaskProvider(context: vscode.ExtensionContext): vscode.Disposable | undefined {

	function invalidateScriptCaches() {
		invalidateHoverScriptsCache();
		invalidateTasksCache();
		if (treeDataProvider) {
			treeDataProvider.refresh();
		}
	}

	if (vscode.workspace.workspaceFolders) {
		let watcher = vscode.workspace.createFileSystemWatcher('**/package.json');
		watcher.onDidChange((_e) => invalidateScriptCaches());
		watcher.onDidDelete((_e) => invalidateScriptCaches());
		watcher.onDidCreate((_e) => invalidateScriptCaches());
		context.subscriptions.push(watcher);

		let workspaceWatcher = vscode.workspace.onDidChangeWorkspaceFolders((_e) => invalidateScriptCaches());
		context.subscriptions.push(workspaceWatcher);

		let provider: vscode.TaskProvider = new NpmTaskProvider();
		let disposable = vscode.tasks.registerTaskProvider('npm', provider);
		context.subscriptions.push(disposable);
		return disposable;
	}
	return undefined;
}

function registerExplorer(context: vscode.ExtensionContext): NpmScriptsTreeDataProvider | undefined {
	if (vscode.workspace.workspaceFolders) {
		let treeDataProvider = new NpmScriptsTreeDataProvider(context);
		const view = vscode.window.createTreeView('npm', { treeDataProvider: treeDataProvider, showCollapseAll: true });
		context.subscriptions.push(view);
		return treeDataProvider;
	}
	return undefined;
}

function registerHoverProvider(context: vscode.ExtensionContext): NpmScriptHoverProvider | undefined {
	if (vscode.workspace.workspaceFolders) {
		let npmSelector: vscode.DocumentSelector = {
			language: 'json',
			scheme: 'file',
			pattern: '**/package.json'
		};
		let provider = new NpmScriptHoverProvider(context);
		context.subscriptions.push(vscode.languages.registerHoverProvider(npmSelector, provider));
		return provider;
	}
	return undefined;
}

function configureHttpRequest() {
	const httpSettings = vscode.workspace.getConfiguration('http');
	httpRequest.configure(httpSettings.get<string>('proxy', ''), httpSettings.get<boolean>('proxyStrictSSL', true));
}

export function deactivate(): void {
}
