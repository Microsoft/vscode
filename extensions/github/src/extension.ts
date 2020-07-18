/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, ExtensionContext, extensions } from 'vscode';
import { GithubRemoteSourceProvider } from './remoteSourceProvider';
import { GitExtension } from './typings/git';
import { registerCommands } from './commands';
import { GithubCredentialProviderManager } from './credentialProvider';
import { dispose, combinedDisposable } from './util';
import { GithubPushErrorHandler } from './pushErrorHandler';

export function activate(context: ExtensionContext): void {
	const disposables = new Set<Disposable>();
	context.subscriptions.push(combinedDisposable(disposables));

	const init = () => {
		try {
			const gitAPI = gitExtension.getAPI(1);

			disposables.add(registerCommands(gitAPI));
			disposables.add(gitAPI.registerRemoteSourceProvider(new GithubRemoteSourceProvider(gitAPI)));
			disposables.add(new GithubCredentialProviderManager(gitAPI));
			disposables.add(gitAPI.registerPushErrorHandler(new GithubPushErrorHandler()));
		} catch (err) {
			console.error('Could not initialize GitHub extension');
			console.warn(err);
		}
	};

	const onDidChangeGitExtensionEnablement = (enabled: boolean) => {
		if (!enabled) {
			dispose(disposables);
			disposables.clear();
		} else {
			init();
		}
	};


	const gitExtension = extensions.getExtension<GitExtension>('vscode.git')!.exports;
	context.subscriptions.push(gitExtension.onDidChangeEnablement(onDidChangeGitExtensionEnablement));
	onDidChangeGitExtensionEnablement(gitExtension.enabled);
}
