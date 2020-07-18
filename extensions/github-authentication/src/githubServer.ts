/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vscode-nls';
import * as vscode from 'vscode';
import fetch from 'node-fetch';
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

const onDidManuallyProvideToken = new vscode.EventEmitter<string>();

const exchangeCodeForToken: (state: string) => PromiseAdapter<vscode.Uri, string> =
	(state) => async (uri, resolve, reject) => {
		Logger.info('Exchanging code for token...');
		const query = parseQuery(uri);
		const code = query.code;

		if (query.state !== state) {
			reject('Received mismatched state');
			return;
		}

		try {
			const result = await fetch(`https://${AUTH_RELAY_SERVER}/token?code=${code}&state=${state}`, {
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

function parseQuery(uri: vscode.Uri) {
	return uri.query.split('&').reduce((prev: any, current) => {
		const queryString = current.split('=');
		prev[queryString[0]] = queryString[1];
		return prev;
	}, {});
}

export class GitHubServer {
	private _statusBarItem: vscode.StatusBarItem | undefined;

	private isTestEnvironment(url: vscode.Uri): boolean {
		return url.authority === 'vscode-web-test-playground.azurewebsites.net' || url.authority.startsWith('localhost:');
	}

	public async login(scopes: string): Promise<string> {
		Logger.info('Logging in...');
		this.updateStatusBarItem(true);

		const state = uuid();
		const callbackUri = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://vscode.github-authentication/did-authenticate`));

		if (this.isTestEnvironment(callbackUri)) {
			const token = await vscode.window.showInputBox({ prompt: 'Token', ignoreFocusOut: true });
			if (!token) { throw new Error('Sign in failed: No token provided'); }
			this.updateStatusBarItem(false);
			return token;
		} else {
			const uri = vscode.Uri.parse(`https://${AUTH_RELAY_SERVER}/authorize/?callbackUri=${encodeURIComponent(callbackUri.toString())}&scope=${scopes}&state=${state}&responseType=code&authServer=https://github.com`);
			await vscode.env.openExternal(uri);
		}

		return Promise.race([
			promiseFromEvent(uriHandler.event, exchangeCodeForToken(state)),
			promiseFromEvent<string, string>(onDidManuallyProvideToken.event)
		]).finally(() => {
			this.updateStatusBarItem(false);
		});
	}

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
		if (!uriOrToken) { return; }
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

	public async getUserInfo(token: string): Promise<{ id: string, accountName: string }> {
		try {
			Logger.info('Getting user info...');
			const result = await fetch('https://api.github.com/user', {
				headers: {
					Authorization: `token ${token}`,
					'User-Agent': 'Visual-Studio-Code'
				}
			});

			if (result.ok) {
				const json = await result.json();
				Logger.info('Got account info!');
				return { id: json.id, accountName: json.login };
			} else {
				Logger.error(`Getting account info failed: ${result.statusText}`);
				throw new Error(result.statusText);
			}
		} catch (ex) {
			Logger.error(ex.message);
			throw new Error(NETWORK_ERROR);
		}
	}
}
