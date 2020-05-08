/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CredentialsProvider, Credentials } from './api/git';
import { IDisposable, filterEvent, EmptyDisposable } from './util';
import { workspace, Uri, AuthenticationSession, authentication } from 'vscode';
import { Askpass } from './askpass';

export class GitHubCredentialProvider implements CredentialsProvider {

	async getCredentials(host: Uri): Promise<Credentials | undefined> {
		if (!/github\.com/i.test(host.authority)) {
			return;
		}

		const session = await this.getSession();
		return { username: session.account.id, password: await session.getAccessToken() };
	}

	private async getSession(): Promise<AuthenticationSession> {
		const authenticationSessions = await authentication.getSessions('github', ['repo']);

		if (authenticationSessions.length) {
			return await authenticationSessions[0];
		} else {
			return await authentication.login('github', ['repo']);
		}
	}
}

export class GithubCredentialProviderManager {

	private providerDisposable: IDisposable = EmptyDisposable;
	private readonly disposable: IDisposable;

	private _enabled = false;
	private set enabled(enabled: boolean) {
		if (this._enabled === enabled) {
			return;
		}

		this._enabled = enabled;

		if (enabled) {
			this.providerDisposable = this.askpass.registerCredentialsProvider(new GitHubCredentialProvider());
		} else {
			this.providerDisposable.dispose();
		}
	}

	constructor(private readonly askpass: Askpass) {
		this.disposable = filterEvent(workspace.onDidChangeConfiguration, e => e.affectsConfiguration('git'))(this.refresh, this);
		this.refresh();
	}

	private refresh(): void {
		this.enabled = workspace.getConfiguration('git', null).get('githubAuthentication', true);
	}

	dispose(): void {
		this.enabled = false;
		this.disposable.dispose();
	}
}
