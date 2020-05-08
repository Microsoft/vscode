/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import * as modes from 'vs/editor/common/modes';
import { Emitter, Event } from 'vs/base/common/event';
import { IMainContext, MainContext, MainThreadAuthenticationShape, ExtHostAuthenticationShape } from 'vs/workbench/api/common/extHost.protocol';
import { Disposable } from 'vs/workbench/api/common/extHostTypes';
import { IExtensionDescription, ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';

export class ExtHostAuthentication implements ExtHostAuthenticationShape {
	private _proxy: MainThreadAuthenticationShape;
	private _authenticationProviders: Map<string, vscode.AuthenticationProvider> = new Map<string, vscode.AuthenticationProvider>();

	private _onDidChangeAuthenticationProviders = new Emitter<vscode.AuthenticationProvidersChangeEvent>();
	readonly onDidChangeAuthenticationProviders: Event<vscode.AuthenticationProvidersChangeEvent> = this._onDidChangeAuthenticationProviders.event;

	private _onDidChangeSessions = new Emitter<{ [providerId: string]: vscode.AuthenticationSessionsChangeEvent }>();
	readonly onDidChangeSessions: Event<{ [providerId: string]: vscode.AuthenticationSessionsChangeEvent }> = this._onDidChangeSessions.event;

	constructor(mainContext: IMainContext) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadAuthentication);
	}

	get providerIds(): string[] {
		const ids: string[] = [];
		this._authenticationProviders.forEach(provider => {
			ids.push(provider.id);
		});

		return ids;
	}

	async getSessions(requestingExtension: IExtensionDescription, providerId: string, scopes: string[]): Promise<readonly vscode.AuthenticationSession[]> {
		const provider = this._authenticationProviders.get(providerId);
		if (!provider) {
			throw new Error(`No authentication provider with id '${providerId}' is currently registered.`);
		}

		const extensionId = ExtensionIdentifier.toKey(requestingExtension.identifier);
		const orderedScopes = scopes.sort().join(' ');

		return (await provider.getSessions())
			.filter(session => session.scopes.sort().join(' ') === orderedScopes)
			.map(session => {
				return {
					id: session.id,
					account: session.account,
					scopes: session.scopes,
					getAccessToken: async () => {
						const isAllowed = await this._proxy.$getSessionsPrompt(
							provider.id,
							session.account.displayName,
							provider.displayName,
							extensionId,
							requestingExtension.displayName || requestingExtension.name);

						if (!isAllowed) {
							throw new Error('User did not consent to token access.');
						}

						return session.getAccessToken();
					}
				};
			});
	}

	async login(requestingExtension: IExtensionDescription, providerId: string, scopes: string[]): Promise<vscode.AuthenticationSession> {
		const provider = this._authenticationProviders.get(providerId);
		if (!provider) {
			throw new Error(`No authentication provider with id '${providerId}' is currently registered.`);
		}

		const extensionName = requestingExtension.displayName || requestingExtension.name;
		const isAllowed = await this._proxy.$loginPrompt(provider.displayName, extensionName);
		if (!isAllowed) {
			throw new Error('User did not consent to login.');
		}

		const session = await provider.login(scopes);
		await this._proxy.$setTrustedExtension(provider.id, session.account.displayName, ExtensionIdentifier.toKey(requestingExtension.identifier), extensionName);
		return {
			id: session.id,
			account: session.account,
			scopes: session.scopes,
			getAccessToken: async () => {
				const isAllowed = await this._proxy.$getSessionsPrompt(
					provider.id,
					session.account.displayName,
					provider.displayName,
					ExtensionIdentifier.toKey(requestingExtension.identifier),
					requestingExtension.displayName || requestingExtension.name);

				if (!isAllowed) {
					throw new Error('User did not consent to token access.');
				}

				return session.getAccessToken();
			}
		};
	}

	async logout(providerId: string, sessionId: string): Promise<void> {
		const provider = this._authenticationProviders.get(providerId);
		if (!provider) {
			throw new Error(`No authentication provider with id '${providerId}' is currently registered.`);
		}

		return provider.logout(sessionId);
	}

	registerAuthenticationProvider(provider: vscode.AuthenticationProvider): vscode.Disposable {
		if (this._authenticationProviders.get(provider.id)) {
			throw new Error(`An authentication provider with id '${provider.id}' is already registered.`);
		}

		this._authenticationProviders.set(provider.id, provider);

		const listener = provider.onDidChangeSessions(e => {
			this._proxy.$onDidChangeSessions(provider.id, e);
			this._onDidChangeSessions.fire({ [provider.id]: e });
		});

		this._proxy.$registerAuthenticationProvider(provider.id, provider.displayName);
		this._onDidChangeAuthenticationProviders.fire({ added: [provider.id], removed: [] });

		return new Disposable(() => {
			listener.dispose();
			this._authenticationProviders.delete(provider.id);
			this._proxy.$unregisterAuthenticationProvider(provider.id);
			this._onDidChangeAuthenticationProviders.fire({ added: [], removed: [provider.id] });
		});
	}

	$login(providerId: string, scopes: string[]): Promise<modes.AuthenticationSession> {
		const authProvider = this._authenticationProviders.get(providerId);
		if (authProvider) {
			return Promise.resolve(authProvider.login(scopes));
		}

		throw new Error(`Unable to find authentication provider with handle: ${providerId}`);
	}

	$logout(providerId: string, sessionId: string): Promise<void> {
		const authProvider = this._authenticationProviders.get(providerId);
		if (authProvider) {
			return Promise.resolve(authProvider.logout(sessionId));
		}

		throw new Error(`Unable to find authentication provider with handle: ${providerId}`);
	}

	$getSessions(providerId: string): Promise<ReadonlyArray<modes.AuthenticationSession>> {
		const authProvider = this._authenticationProviders.get(providerId);
		if (authProvider) {
			return Promise.resolve(authProvider.getSessions());
		}

		throw new Error(`Unable to find authentication provider with handle: ${providerId}`);
	}

	async $getSessionAccessToken(providerId: string, sessionId: string): Promise<string> {
		const authProvider = this._authenticationProviders.get(providerId);
		if (authProvider) {
			const sessions = await authProvider.getSessions();
			const session = sessions.find(session => session.id === sessionId);
			if (session) {
				return session.getAccessToken();
			}

			throw new Error(`Unable to find session with id: ${sessionId}`);
		}

		throw new Error(`Unable to find authentication provider with handle: ${providerId}`);
	}
}
