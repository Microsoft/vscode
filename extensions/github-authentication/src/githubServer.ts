/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as https from 'https';
import * as nls from 'vscode-nls';
import * as vscode from 'vscode';
import * as uuid from 'uuid';
import { PromiseAdapter, promiseFromEvent } from './common/utils';
import Logger from './common/logger';
import ClientRegistrar from './common/clientRegistrar';

const localize = nls.loadMessageBundle();

export const NETWORK_ERROR = 'network error';
const AUTH_RELAY_SERVER = 'vscode-auth.github.com';

class UriEventHandler extends vscode.EventEmitter<vscode.Uri> implements vscode.UriHandler {
	public handleUri(uri: vscode.Uri) {
		this.fire(uri);
	}
}

export const uriHandler = new UriEventHandler;

const exchangeCodeForToken: (state: string, host: string, getPath: (code: string) => string) => PromiseAdapter<vscode.Uri, string> =
	(state, host, getPath) => async (uri, resolve, reject) => {
		Logger.info('Exchanging code for token...');
		const query = parseQuery(uri);
		const code = query.code;

		if (query.state !== state) {
			reject('Received mismatched state');
			return;
		}

		const post = https.request({
			host: host,
			path: getPath(code),
			method: 'POST',
			headers: {
				Accept: 'application/json'
			}
		}, result => {
			const buffer: Buffer[] = [];
			result.on('data', (chunk: Buffer) => {
				buffer.push(chunk);
			});
			result.on('end', () => {
				if (result.statusCode === 200) {
					const json = JSON.parse(Buffer.concat(buffer).toString());
					Logger.info('Token exchange success!');
					resolve(json.access_token);
				} else {
					reject(new Error(result.statusMessage));
				}
			});
		});

		post.end();
		post.on('error', err => {
			reject(err);
		});
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

	public async login(scopes: string): Promise<string> {
		Logger.info('Logging in...');
		this.updateStatusBarItem(true);

		const state = uuid();
		const callbackUri = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://vscode.github-authentication/did-authenticate`));
		let uri = vscode.Uri.parse(`https://${AUTH_RELAY_SERVER}/authorize/?callbackUri=${encodeURIComponent(callbackUri.toString())}&scope=${scopes}&state=${state}&responseType=code`);
		if (scopes === 'vso') {
			const clientDetails = ClientRegistrar.getGitHubAppDetails();
			uri = vscode.Uri.parse(`https://github.com/login/oauth/authorize?redirect_uri=${encodeURIComponent(callbackUri.toString())}&scope=${scopes}&state=${state}&client_id=${clientDetails.id}`);
		}

		vscode.env.openExternal(uri);

		return promiseFromEvent(uriHandler.event, exchangeCodeForToken(state,
			scopes === 'vso' ? 'github.com' : AUTH_RELAY_SERVER,
			(code) => {
				if (scopes === 'vso') {
					const clientDetails = ClientRegistrar.getGitHubAppDetails();
					return `/login/oauth/access_token?client_id=${clientDetails.id}&client_secret=${clientDetails.secret}&state=${state}&code=${code}`;
				} else {
					return `/token?code=${code}&state=${state}`;
				}
			})).finally(() => {
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
			Logger.error(e);
			vscode.window.showErrorMessage(localize('unexpectedInput', "The input did not matched the expected format"));
		}
	}

	public async hasUserInstallation(token: string): Promise<boolean> {
		return new Promise((resolve, reject) => {
			Logger.info('Getting user installations...');
			const post = https.request({
				host: 'api.github.com',
				path: `/user/installations`,
				method: 'GET',
				headers: {
					Accept: 'application/vnd.github.machine-man-preview+json',
					Authorization: `token ${token}`,
					'User-Agent': 'Visual-Studio-Code'
				}
			}, result => {
				const buffer: Buffer[] = [];
				result.on('data', (chunk: Buffer) => {
					buffer.push(chunk);
				});
				result.on('end', () => {
					if (result.statusCode === 200) {
						const json = JSON.parse(Buffer.concat(buffer).toString());
						Logger.info('Got installation info!');
						const hasInstallation = json.installations.some((installation: { app_slug: string }) => installation.app_slug === 'microsoft-visual-studio-code');
						resolve(hasInstallation);
					} else {
						reject(new Error(result.statusMessage));
					}
				});
			});

			post.end();
			post.on('error', err => {
				reject(err);
			});
		});
	}

	public async installApp(): Promise<string> {
		const clientDetails = ClientRegistrar.getGitHubAppDetails();
		const state = uuid();
		const uri = vscode.Uri.parse(`https://github.com/apps/microsoft-visual-studio-code/installations/new?state=${state}`);

		vscode.env.openExternal(uri);
		return promiseFromEvent(uriHandler.event, exchangeCodeForToken(state, 'github.com', (code) => `/login/oauth/access_token?client_id=${clientDetails.id}&client_secret=${clientDetails.secret}&state=${state}&code=${code}`));
	}

	public async getUserInfo(token: string): Promise<{ id: string, accountName: string }> {
		return new Promise((resolve, reject) => {
			Logger.info('Getting account info...');
			const post = https.request({
				host: 'api.github.com',
				path: `/user`,
				method: 'GET',
				headers: {
					Authorization: `token ${token}`,
					'User-Agent': 'Visual-Studio-Code'
				}
			}, result => {
				const buffer: Buffer[] = [];
				result.on('data', (chunk: Buffer) => {
					buffer.push(chunk);
				});
				result.on('end', () => {
					if (result.statusCode === 200) {
						const json = JSON.parse(Buffer.concat(buffer).toString());
						Logger.info('Got account info!');
						resolve({ id: json.id, accountName: json.login });
					} else {
						Logger.error(`Getting account info failed: ${result.statusMessage}`);
						reject(new Error(result.statusMessage));
					}
				});
			});

			post.end();
			post.on('error', err => {
				Logger.error(err.message);
				reject(new Error(NETWORK_ERROR));
			});
		});
	}

	public async validateToken(token: string): Promise<void> {
		return new Promise(async (resolve, reject) => {
			const callbackUri = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://vscode.github-authentication/did-authenticate`));
			const clientDetails = ClientRegistrar.getClientDetails(callbackUri);
			const detailsString = `${clientDetails.id}:${clientDetails.secret}`;

			const payload = JSON.stringify({ access_token: token });

			Logger.info('Validating token...');
			const post = https.request({
				host: 'api.github.com',
				path: `/applications/${clientDetails.id}/token`,
				method: 'POST',
				headers: {
					Authorization: `Basic ${Buffer.from(detailsString).toString('base64')}`,
					'User-Agent': 'Visual-Studio-Code',
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(payload)
				}
			}, result => {
				const buffer: Buffer[] = [];
				result.on('data', (chunk: Buffer) => {
					buffer.push(chunk);
				});
				result.on('end', () => {
					if (result.statusCode === 200) {
						Logger.info('Validated token!');
						resolve();
					} else {
						Logger.info(`Validating token failed: ${result.statusMessage}`);
						reject(new Error(result.statusMessage));
					}
				});
			});

			post.write(payload);
			post.end();
			post.on('error', err => {
				Logger.error(err.message);
				reject(new Error(NETWORK_ERROR));
			});
		});
	}

	public async revokeToken(token: string): Promise<void> {
		return new Promise(async (resolve, reject) => {
			const callbackUri = await vscode.env.asExternalUri(vscode.Uri.parse(`${vscode.env.uriScheme}://vscode.github-authentication/did-authenticate`));
			const clientDetails = ClientRegistrar.getClientDetails(callbackUri);
			const detailsString = `${clientDetails.id}:${clientDetails.secret}`;

			const payload = JSON.stringify({ access_token: token });

			Logger.info('Revoking token...');
			const post = https.request({
				host: 'api.github.com',
				path: `/applications/${clientDetails.id}/token`,
				method: 'DELETE',
				headers: {
					Authorization: `Basic ${Buffer.from(detailsString).toString('base64')}`,
					'User-Agent': 'Visual-Studio-Code',
					'Content-Type': 'application/json',
					'Content-Length': Buffer.byteLength(payload)
				}
			}, result => {
				const buffer: Buffer[] = [];
				result.on('data', (chunk: Buffer) => {
					buffer.push(chunk);
				});
				result.on('end', () => {
					if (result.statusCode === 204) {
						Logger.info('Revoked token!');
						resolve();
					} else {
						Logger.info(`Revoking token failed: ${result.statusMessage}`);
						reject(new Error(result.statusMessage));
					}
				});
			});

			post.write(payload);
			post.end();
			post.on('error', err => {
				reject(err);
			});
		});
	}
}
