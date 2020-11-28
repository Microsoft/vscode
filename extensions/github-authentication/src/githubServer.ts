/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vscode-nls';
import * as vscode from 'vscode';
import fetch, { Response } from 'node-fetch';
import { v4 as uuid } from 'uuid';
import { PromiseAdapter, promiseFromEvent } from './common/utils';
import Logger from './common/logger';

const localize = nls.loadMessageBundle();

export const NETWORK_ERROR = 'network error';
const AUTH_RELAY_SERVER = 'vscode-auth.github.com';

class UriEventHandler extends vscode.EventEmitter<vscode.Uri> implements vscode.UriHandler {
	public handleUri(uri: vscode.Uri) {
		this.fire(uri);
	}
}

export const uriHandler = new UriEventHandler;

const onDidManuallyProvideToken = new vscode.EventEmitter<string | undefined>();



function parseQuery(uri: vscode.Uri) {
	return uri.query.split('&').reduce((prev: any, current) => {
		const queryString = current.split('=');
		prev[queryString[0]] = queryString[1];
		return prev;
	}, {});
}

export class GitHubServer {
	private _statusBarItem: vscode.StatusBarItem | undefined;

	private _pendingStates = new Map<string, string[]>();
	private _codeExchangePromises = new Map<string, Promise<string>>();

	private isTestEnvironment(url: vscode.Uri): boolean {
		return url.authority === 'vscode-web-test-playground.azurewebsites.net' || url.authority.startsWith('localhost:');
	}

	public async login(scopes: string): Promise<string> {
		Logger.info('Logging in...');
		this.updateStatusBarItem(true);

		const state = uuid();
		const callbackUri = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://vscode.github-authentication/did-authenticate`));

		if (this.isTestEnvironment(callbackUri)) {
			const token = await vscode.window.showInputBox({ prompt: 'GitHub Personal Access Token', ignoreFocusOut: true });
			if (!token) { throw new Error('Sign in failed: No token provided'); }

			const tokenScopes = await this.getScopes(token); // Example: ['repo', 'user']
			const scopesList = scopes.split(' '); // Example: 'read:user repo user:email'
			if (!scopesList.every(scope => {
				const included = tokenScopes.includes(scope);
				if (included || !scope.includes(':')) {
					return included;
				}

				return scope.split(':').some(splitScopes => {
					return tokenScopes.includes(splitScopes);
				});
			})) {
				throw new Error(`The provided token is does not match the requested scopes: ${scopes}`);
			}

			this.updateStatusBarItem(false);
			return token;
		} else {
			const existingStates = this._pendingStates.get(scopes) || [];
			this._pendingStates.set(scopes, [...existingStates, state]);

			const uri = vscode.Uri.parse(`https://${AUTH_RELAY_SERVER}/authorize/?callbackUri=${encodeURIComponent(callbackUri.toString())}&scope=${scopes}&state=${state}&responseType=code&authServer=https://github.com`);
			await vscode.env.openExternal(uri);
		}

		// Register a single listener for the URI callback, in case the user starts the login process multiple times
		// before completing it.
		let existingPromise = this._codeExchangePromises.get(scopes);
		if (!existingPromise) {
			existingPromise = promiseFromEvent(uriHandler.event, this.exchangeCodeForToken(scopes));
			this._codeExchangePromises.set(scopes, existingPromise);
		}

		return Promise.race([
			existingPromise,
			promiseFromEvent<string | undefined, string>(onDidManuallyProvideToken.event, (token: string | undefined): string => { if (!token) { throw new Error('Cancelled'); } return token; })
		]).finally(() => {
			this._pendingStates.delete(scopes);
			this._codeExchangePromises.delete(scopes);
			this.updateStatusBarItem(false);
		});
	}

	private exchangeCodeForToken: (scopes: string) => PromiseAdapter<vscode.Uri, string> =
		(scopes) => async (uri, resolve, reject) => {
			Logger.info('Exchanging code for token...');
			const query = parseQuery(uri);
			const code = query.code;

			const acceptedStates = this._pendingStates.get(scopes) || [];
			if (!acceptedStates.includes(query.state)) {
				reject('Received mismatched state');
				return;
			}

			try {
				const result = await fetch(`https://${AUTH_RELAY_SERVER}/token?code=${code}&state=${query.state}`, {
					method: 'POST',
					headers: {
						Accept: 'application/json'
					}
				});

				if (result.ok) {
					const json = await result.json();
					Logger.info('Token exchange success!');
					resolve(json.access_token);
				} else {
					reject(result.statusText);
				}
			} catch (ex) {
				reject(ex);
			}
		};

	private updateStatusBarItem(isStart?: boolean) {
		if (isStart && !this._statusBarItem) {
			this._statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left);
			this._statusBarItem.text = localize('signingIn', "$(mark-github) Signing in to github.com...");
			this._statusBarItem.command = 'github.provide-token';
			this._statusBarItem.show();
		}

		if (!isStart && this._statusBarItem) {
			this._statusBarItem.dispose();
			this._statusBarItem = undefined;
		}
	}

	public async manuallyProvideToken() {
		const uriOrToken = await vscode.window.showInputBox({ prompt: 'Token', ignoreFocusOut: true });
		if (!uriOrToken) {
			onDidManuallyProvideToken.fire(undefined);
			return;
		}

		try {
			const uri = vscode.Uri.parse(uriOrToken);
			if (!uri.scheme || uri.scheme === 'file') { throw new Error; }
			uriHandler.handleUri(uri);
		} catch (e) {
			// If it doesn't look like a URI, treat it as a token.
			Logger.info('Treating input as token');
			onDidManuallyProvideToken.fire(uriOrToken);
		}
	}

	private async getScopes(token: string): Promise<string[]> {
		try {
			Logger.info('Getting token scopes...');
			const result = await fetch('https://api.github.com', {
				headers: {
					Authorization: `token ${token}`,
					'User-Agent': 'Visual-Studio-Code'
				}
			});

			if (result.ok) {
				const scopes = result.headers.get('X-OAuth-Scopes');
				return scopes ? scopes.split(',').map(scope => scope.trim()) : [];
			} else {
				Logger.error(`Getting scopes failed: ${result.statusText}`);
				throw new Error(result.statusText);
			}
		} catch (ex) {
			Logger.error(ex.message);
			throw new Error(NETWORK_ERROR);
		}
	}

	public async getUserInfo(token: string): Promise<{ id: string, accountName: string }> {
		let result: Response;
		try {
			Logger.info('Getting user info...');
			result = await fetch('https://api.github.com/user', {
				headers: {
					Authorization: `token ${token}`,
					'User-Agent': 'Visual-Studio-Code'
				}
			});
		} catch (ex) {
			Logger.error(ex.message);
			throw new Error(NETWORK_ERROR);
		}

		if (result.ok) {
			const json = await result.json();
			Logger.info('Got account info!');
			return { id: json.id, accountName: json.login };
		} else {
			Logger.error(`Getting account info failed: ${result.statusText}`);
			throw new Error(result.statusText);
		}
	}
}
