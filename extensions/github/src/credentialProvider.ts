/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CredentialsProvider, Credentials, API as GitAPI } from './typings/git';
import { workspace, Uri, Disposable } from 'vscode';
import { getSession } from './auth';

const EmptyDisposable: Disposable = { dispose() { } };

class GitHubCredentialProvider implements CredentialsProvider {

	async getCredentials(host: Uri): Promise<Credentials | undefined> {
		if (!/github\.com/i.test(host.authority)) {
			return;
		}

		const session = await getSession();
		return { username: session.account.id, password: session.accessToken };
	}
}

export class GithubCredentialProviderManager {

	private providerDisposable: Disposable = EmptyDisposable;
	private readonly disposable: Disposable;

	private _enabled = false;
	private set enabled(enabled: boolean) {
		if (this._enabled === enabled) {
			return;
		}

		this._enabled = enabled;

		if (enabled) {
			this.providerDisposable = this.gitAPI.registerCredentialsProvider(new GitHubCredentialProvider());
		} else {
			this.providerDisposable.dispose();
		}
	}

	constructor(private gitAPI: GitAPI) {
		this.disposable = workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('github')) {
				this.refresh();
			}
		});

		this.refresh();
	}

	private refresh(): void {
		const config = workspace.getConfiguration('github', null);
		const enabled = config.get<boolean>('gitAuthentication', true);
		this.enabled = !!enabled;
	}

	dispose(): void {
		this.enabled = false;
		this.disposable.dispose();
	}
}
