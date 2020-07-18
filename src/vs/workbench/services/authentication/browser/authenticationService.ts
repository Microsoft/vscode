/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, AuthenticationProviderInformation } from 'vs/editor/common/modes';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { MainThreadAuthenticationProvider } from 'vs/workbench/api/browser/mainThreadAuthentication';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';

export const IAuthenticationService = createDecorator<IAuthenticationService>('IAuthenticationService');

export interface IAuthenticationService {
	readonly _serviceBrand: undefined;

	isAuthenticationProviderRegistered(id: string): boolean;
	getProviderIds(): string[];
	registerAuthenticationProvider(id: string, provider: MainThreadAuthenticationProvider): void;
	unregisterAuthenticationProvider(id: string): void;
	requestNewSession(id: string, scopes: string[], extensionId: string, extensionName: string): void;
	sessionsUpdate(providerId: string, event: AuthenticationSessionsChangeEvent): void;

	readonly onDidRegisterAuthenticationProvider: Event<AuthenticationProviderInformation>;
	readonly onDidUnregisterAuthenticationProvider: Event<AuthenticationProviderInformation>;

	readonly onDidChangeSessions: Event<{ providerId: string, label: string, event: AuthenticationSessionsChangeEvent }>;
	getSessions(providerId: string): Promise<ReadonlyArray<AuthenticationSession>>;
	getLabel(providerId: string): string;
	supportsMultipleAccounts(providerId: string): boolean;
	login(providerId: string, scopes: string[]): Promise<AuthenticationSession>;
	logout(providerId: string, sessionId: string): Promise<void>;

	manageTrustedExtensionsForAccount(providerId: string, accountName: string): Promise<void>;
	signOutOfAccount(providerId: string, accountName: string): Promise<void>;
}

export interface AllowedExtension {
	id: string;
	name: string;
}

export function readAllowedExtensions(storageService: IStorageService, providerId: string, accountName: string): AllowedExtension[] {
	let trustedExtensions: AllowedExtension[] = [];
	try {
		const trustedExtensionSrc = storageService.get(`${providerId}-${accountName}`, StorageScope.GLOBAL);
		if (trustedExtensionSrc) {
			trustedExtensions = JSON.parse(trustedExtensionSrc);
		}
	} catch (err) { }

	return trustedExtensions;
}

export interface SessionRequest {
	disposables: IDisposable[];
	requestingExtensionIds: string[];
}

export interface SessionRequestInfo {
	[scopes: string]: SessionRequest;
}

export class AuthenticationService extends Disposable implements IAuthenticationService {
	declare readonly _serviceBrand: undefined;
	private _placeholderMenuItem: IDisposable | undefined;
	private _noAccountsMenuItem: IDisposable | undefined;
	private _signInRequestItems = new Map<string, SessionRequestInfo>();
	private _badgeDisposable: IDisposable | undefined;

	private _authenticationProviders: Map<string, MainThreadAuthenticationProvider> = new Map<string, MainThreadAuthenticationProvider>();

	private _onDidRegisterAuthenticationProvider: Emitter<AuthenticationProviderInformation> = this._register(new Emitter<AuthenticationProviderInformation>());
	readonly onDidRegisterAuthenticationProvider: Event<AuthenticationProviderInformation> = this._onDidRegisterAuthenticationProvider.event;

	private _onDidUnregisterAuthenticationProvider: Emitter<AuthenticationProviderInformation> = this._register(new Emitter<AuthenticationProviderInformation>());
	readonly onDidUnregisterAuthenticationProvider: Event<AuthenticationProviderInformation> = this._onDidUnregisterAuthenticationProvider.event;

	private _onDidChangeSessions: Emitter<{ providerId: string, label: string, event: AuthenticationSessionsChangeEvent }> = this._register(new Emitter<{ providerId: string, label: string, event: AuthenticationSessionsChangeEvent }>());
	readonly onDidChangeSessions: Event<{ providerId: string, label: string, event: AuthenticationSessionsChangeEvent }> = this._onDidChangeSessions.event;

	constructor(@IActivityService private readonly activityService: IActivityService) {
		super();
		this._placeholderMenuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			command: {
				id: 'noAuthenticationProviders',
				title: nls.localize('loading', "Loading..."),
				precondition: ContextKeyExpr.false()
			},
		});
	}

	getProviderIds(): string[] {
		const providerIds: string[] = [];
		this._authenticationProviders.forEach(provider => {
			providerIds.push(provider.id);
		});
		return providerIds;
	}

	isAuthenticationProviderRegistered(id: string): boolean {
		return this._authenticationProviders.has(id);
	}

	private updateAccountsMenuItem(): void {
		let hasSession = false;
		this._authenticationProviders.forEach(async provider => {
			hasSession = hasSession || provider.hasSessions();
		});

		if (hasSession && this._noAccountsMenuItem) {
			this._noAccountsMenuItem.dispose();
			this._noAccountsMenuItem = undefined;
		}

		if (!hasSession && !this._noAccountsMenuItem) {
			this._noAccountsMenuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
				group: '0_accounts',
				command: {
					id: 'noAccounts',
					title: nls.localize('noAccounts', "You are not signed in to any accounts"),
					precondition: ContextKeyExpr.false()
				},
			});
		}
	}

	registerAuthenticationProvider(id: string, authenticationProvider: MainThreadAuthenticationProvider): void {
		this._authenticationProviders.set(id, authenticationProvider);
		this._onDidRegisterAuthenticationProvider.fire({ id, label: authenticationProvider.label });

		if (this._placeholderMenuItem) {
			this._placeholderMenuItem.dispose();
			this._placeholderMenuItem = undefined;
		}

		this.updateAccountsMenuItem();
	}

	unregisterAuthenticationProvider(id: string): void {
		const provider = this._authenticationProviders.get(id);
		if (provider) {
			provider.dispose();
			this._authenticationProviders.delete(id);
			this._onDidUnregisterAuthenticationProvider.fire({ id, label: provider.label });
			this.updateAccountsMenuItem();
		}

		if (!this._authenticationProviders.size) {
			this._placeholderMenuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
				command: {
					id: 'noAuthenticationProviders',
					title: nls.localize('loading', "Loading..."),
					precondition: ContextKeyExpr.false()
				},
			});
		}
	}

	async sessionsUpdate(id: string, event: AuthenticationSessionsChangeEvent): Promise<void> {
		const provider = this._authenticationProviders.get(id);
		if (provider) {
			this._onDidChangeSessions.fire({ providerId: id, label: provider.label, event: event });
			await provider.updateSessionItems(event);
			this.updateAccountsMenuItem();

			if (event.added) {
				await this.updateNewSessionRequests(provider);
			}
		}
	}

	private async updateNewSessionRequests(provider: MainThreadAuthenticationProvider): Promise<void> {
		const existingRequestsForProvider = this._signInRequestItems.get(provider.id);
		if (!existingRequestsForProvider) {
			return;
		}

		const sessions = await provider.getSessions();
		let changed = false;

		Object.keys(existingRequestsForProvider).forEach(requestedScopes => {
			if (sessions.some(session => session.scopes.slice().sort().join('') === requestedScopes)) {
				// Request has been completed
				changed = true;
				const sessionRequest = existingRequestsForProvider[requestedScopes];
				sessionRequest?.disposables.forEach(item => item.dispose());

				delete existingRequestsForProvider[requestedScopes];
				if (Object.keys(existingRequestsForProvider).length === 0) {
					this._signInRequestItems.delete(provider.id);
				} else {
					this._signInRequestItems.set(provider.id, existingRequestsForProvider);
				}
			}
		});

		if (changed) {
			if (this._signInRequestItems.size === 0) {
				this._badgeDisposable?.dispose();
				this._badgeDisposable = undefined;
			} else {
				let numberOfRequests = 0;
				this._signInRequestItems.forEach(providerRequests => {
					Object.keys(providerRequests).forEach(request => {
						numberOfRequests += providerRequests[request].requestingExtensionIds.length;
					});
				});

				const badge = new NumberBadge(numberOfRequests, () => nls.localize('sign in', "Sign in requested"));
				this._badgeDisposable = this.activityService.showAccountsActivity({ badge });
			}
		}
	}

	requestNewSession(providerId: string, scopes: string[], extensionId: string, extensionName: string): void {
		const provider = this._authenticationProviders.get(providerId);
		if (provider) {
			const providerRequests = this._signInRequestItems.get(providerId);
			const scopesList = scopes.sort().join('');
			const extensionHasExistingRequest = providerRequests
				&& providerRequests[scopesList]
				&& providerRequests[scopesList].requestingExtensionIds.includes(extensionId);

			if (extensionHasExistingRequest) {
				return;
			}

			const menuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
				group: '2_signInRequests',
				command: {
					id: `${extensionId}signIn`,
					title: nls.localize(
						{
							key: 'signInRequest',
							comment: ['The placeholder {0} will be replaced with an extension name. (1) is to indicate that this menu item contributes to a badge count.']
						},
						"Sign in to use {0} (1)",
						extensionName)
				}
			});

			const signInCommand = CommandsRegistry.registerCommand({
				id: `${extensionId}signIn`,
				handler: async (accessor) => {
					const authenticationService = accessor.get(IAuthenticationService);
					const storageService = accessor.get(IStorageService);
					const session = await authenticationService.login(providerId, scopes);

					// Add extension to allow list since user explicitly signed in on behalf of it
					const allowList = readAllowedExtensions(storageService, providerId, session.account.label);
					if (!allowList.find(allowed => allowed.id === extensionId)) {
						allowList.push({ id: extensionId, name: extensionName });
						storageService.store(`${providerId}-${session.account.label}`, JSON.stringify(allowList), StorageScope.GLOBAL);
					}

					// And also set it as the preferred account for the extension
					storageService.store(`${extensionName}-${providerId}`, session.id, StorageScope.GLOBAL);
				}
			});


			if (providerRequests) {
				const existingRequest = providerRequests[scopesList] || { disposables: [], requestingExtensionIds: [] };

				providerRequests[scopesList] = {
					disposables: [...existingRequest.disposables, menuItem, signInCommand],
					requestingExtensionIds: [...existingRequest.requestingExtensionIds, extensionId]
				};
				this._signInRequestItems.set(providerId, providerRequests);
			} else {
				this._signInRequestItems.set(providerId, {
					[scopesList]: {
						disposables: [menuItem, signInCommand],
						requestingExtensionIds: [extensionId]
					}
				});
			}

			let numberOfRequests = 0;
			this._signInRequestItems.forEach(providerRequests => {
				Object.keys(providerRequests).forEach(request => {
					numberOfRequests += providerRequests[request].requestingExtensionIds.length;
				});
			});

			const badge = new NumberBadge(numberOfRequests, () => nls.localize('sign in', "Sign in requested"));
			this._badgeDisposable = this.activityService.showAccountsActivity({ badge });
		}
	}
	getLabel(id: string): string {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.label;
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	supportsMultipleAccounts(id: string): boolean {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.supportsMultipleAccounts;
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	async getSessions(id: string): Promise<ReadonlyArray<AuthenticationSession>> {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return await authProvider.getSessions();
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	async login(id: string, scopes: string[]): Promise<AuthenticationSession> {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.login(scopes);
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	async logout(id: string, sessionId: string): Promise<void> {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.logout(sessionId);
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	async manageTrustedExtensionsForAccount(id: string, accountName: string): Promise<void> {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.manageTrustedExtensions(accountName);
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	async signOutOfAccount(id: string, accountName: string): Promise<void> {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.signOut(accountName);
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}
}

registerSingleton(IAuthenticationService, AuthenticationService);
