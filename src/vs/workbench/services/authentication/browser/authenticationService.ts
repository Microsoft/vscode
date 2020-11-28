/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { AuthenticationSession, AuthenticationSessionsChangeEvent, AuthenticationProviderInformation } from 'vs/editor/common/modes';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { MainThreadAuthenticationProvider } from 'vs/workbench/api/browser/mainThreadAuthentication';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IProductService } from 'vs/platform/product/common/productService';
import { isString } from 'vs/base/common/types';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { flatten } from 'vs/base/common/arrays';
import { isFalsyOrWhitespace } from 'vs/base/common/strings';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';

export function getAuthenticationProviderActivationEvent(id: string): string { return `onAuthenticationRequest:${id}`; }

export type AuthenticationSessionInfo = { readonly id: string, readonly accessToken: string, readonly providerId: string, readonly canSignOut?: boolean };
export async function getCurrentAuthenticationSessionInfo(environmentService: IWorkbenchEnvironmentService, productService: IProductService): Promise<AuthenticationSessionInfo | undefined> {
	if (environmentService.options?.credentialsProvider) {
		const authenticationSessionValue = await environmentService.options.credentialsProvider.getPassword(`${productService.urlProtocol}.login`, 'account');
		if (authenticationSessionValue) {
			const authenticationSessionInfo: AuthenticationSessionInfo = JSON.parse(authenticationSessionValue);
			if (authenticationSessionInfo
				&& isString(authenticationSessionInfo.id)
				&& isString(authenticationSessionInfo.accessToken)
				&& isString(authenticationSessionInfo.providerId)
			) {
				return authenticationSessionInfo;
			}
		}
	}
	return undefined;
}

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

	declaredProviders: AuthenticationProviderInformation[];
	readonly onDidChangeDeclaredProviders: Event<AuthenticationProviderInformation[]>;

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

CommandsRegistry.registerCommand('workbench.getCodeExchangeProxyEndpoints', function (accessor, _) {
	const environmentService = accessor.get(IWorkbenchEnvironmentService);
	return environmentService.options?.codeExchangeProxyEndpoints;
});

const authenticationDefinitionSchema: IJSONSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		id: {
			type: 'string',
			description: nls.localize('authentication.id', 'The id of the authentication provider.')
		},
		label: {
			type: 'string',
			description: nls.localize('authentication.label', 'The human readable name of the authentication provider.'),
		}
	}
};

const authenticationExtPoint = ExtensionsRegistry.registerExtensionPoint<AuthenticationProviderInformation[]>({
	extensionPoint: 'authentication',
	jsonSchema: {
		description: nls.localize({ key: 'authenticationExtensionPoint', comment: [`'Contributes' means adds here`] }, 'Contributes authentication'),
		type: 'array',
		items: authenticationDefinitionSchema
	}
});

export class AuthenticationService extends Disposable implements IAuthenticationService {
	declare readonly _serviceBrand: undefined;
	private _placeholderMenuItem: IDisposable | undefined;
	private _noAccountsMenuItem: IDisposable | undefined;
	private _signInRequestItems = new Map<string, SessionRequestInfo>();
	private _accountBadgeDisposable = this._register(new MutableDisposable());

	private _authenticationProviders: Map<string, MainThreadAuthenticationProvider> = new Map<string, MainThreadAuthenticationProvider>();

	/**
	 * All providers that have been statically declared by extensions. These may not be registered.
	 */
	declaredProviders: AuthenticationProviderInformation[] = [];

	private _onDidRegisterAuthenticationProvider: Emitter<AuthenticationProviderInformation> = this._register(new Emitter<AuthenticationProviderInformation>());
	readonly onDidRegisterAuthenticationProvider: Event<AuthenticationProviderInformation> = this._onDidRegisterAuthenticationProvider.event;

	private _onDidUnregisterAuthenticationProvider: Emitter<AuthenticationProviderInformation> = this._register(new Emitter<AuthenticationProviderInformation>());
	readonly onDidUnregisterAuthenticationProvider: Event<AuthenticationProviderInformation> = this._onDidUnregisterAuthenticationProvider.event;

	private _onDidChangeSessions: Emitter<{ providerId: string, label: string, event: AuthenticationSessionsChangeEvent }> = this._register(new Emitter<{ providerId: string, label: string, event: AuthenticationSessionsChangeEvent }>());
	readonly onDidChangeSessions: Event<{ providerId: string, label: string, event: AuthenticationSessionsChangeEvent }> = this._onDidChangeSessions.event;

	private _onDidChangeDeclaredProviders: Emitter<AuthenticationProviderInformation[]> = this._register(new Emitter<AuthenticationProviderInformation[]>());
	readonly onDidChangeDeclaredProviders: Event<AuthenticationProviderInformation[]> = this._onDidChangeDeclaredProviders.event;

	constructor(
		@IActivityService private readonly activityService: IActivityService,
		@IExtensionService private readonly extensionService: IExtensionService
	) {
		super();
		this._placeholderMenuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			command: {
				id: 'noAuthenticationProviders',
				title: nls.localize('loading', "Loading..."),
				precondition: ContextKeyExpr.false()
			},
		});

		authenticationExtPoint.setHandler((extensions, { added, removed }) => {
			added.forEach(point => {
				for (const provider of point.value) {
					if (isFalsyOrWhitespace(provider.id)) {
						point.collector.error(nls.localize('authentication.missingId', 'An authentication contribution must specify an id.'));
						continue;
					}

					if (isFalsyOrWhitespace(provider.label)) {
						point.collector.error(nls.localize('authentication.missingLabel', 'An authentication contribution must specify a label.'));
						continue;
					}

					if (!this.declaredProviders.some(p => p.id === provider.id)) {
						this.declaredProviders.push(provider);
					} else {
						point.collector.error(nls.localize('authentication.idConflict', "This authentication id '{0}' has already been registered", provider.id));
					}
				}
			});

			const removedExtPoints = flatten(removed.map(r => r.value));
			removedExtPoints.forEach(point => {
				const index = this.declaredProviders.findIndex(provider => provider.id === point.id);
				if (index > -1) {
					this.declaredProviders.splice(index, 1);
				}
			});

			this._onDidChangeDeclaredProviders.fire(this.declaredProviders);
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
			this._accountBadgeDisposable.clear();

			if (this._signInRequestItems.size > 0) {
				let numberOfRequests = 0;
				this._signInRequestItems.forEach(providerRequests => {
					Object.keys(providerRequests).forEach(request => {
						numberOfRequests += providerRequests[request].requestingExtensionIds.length;
					});
				});

				const badge = new NumberBadge(numberOfRequests, () => nls.localize('sign in', "Sign in requested"));
				this._accountBadgeDisposable.value = this.activityService.showAccountsActivity({ badge });
			}
		}
	}

	async requestNewSession(providerId: string, scopes: string[], extensionId: string, extensionName: string): Promise<void> {
		let provider = this._authenticationProviders.get(providerId);
		if (!provider) {
			// Activate has already been called for the authentication provider, but it cannot block on registering itself
			// since this is sync and returns a disposable. So, wait for registration event to fire that indicates the
			// provider is now in the map.
			await new Promise<void>((resolve, _) => {
				this.onDidRegisterAuthenticationProvider(e => {
					if (e.id === providerId) {
						provider = this._authenticationProviders.get(providerId);
						resolve();
					}
				});
			});
		}

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
						storageService.store(`${providerId}-${session.account.label}`, JSON.stringify(allowList), StorageScope.GLOBAL, StorageTarget.USER);
					}

					// And also set it as the preferred account for the extension
					storageService.store(`${extensionName}-${providerId}`, session.id, StorageScope.GLOBAL, StorageTarget.MACHINE);
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

			this._accountBadgeDisposable.clear();

			let numberOfRequests = 0;
			this._signInRequestItems.forEach(providerRequests => {
				Object.keys(providerRequests).forEach(request => {
					numberOfRequests += providerRequests[request].requestingExtensionIds.length;
				});
			});

			const badge = new NumberBadge(numberOfRequests, () => nls.localize('sign in', "Sign in requested"));
			this._accountBadgeDisposable.value = this.activityService.showAccountsActivity({ badge });
		}
	}
	getLabel(id: string): string {
		const authProvider = this.declaredProviders.find(provider => provider.id === id);
		if (authProvider) {
			return authProvider.label;
		} else {
			throw new Error(`No authentication provider '${id}' has been declared.`);
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

	private async tryActivateProvider(providerId: string): Promise<MainThreadAuthenticationProvider> {
		await this.extensionService.activateByEvent(getAuthenticationProviderActivationEvent(providerId));
		let provider = this._authenticationProviders.get(providerId);
		if (provider) {
			return provider;
		}

		// When activate has completed, the extension has made the call to `registerAuthenticationProvider`.
		// However, activate cannot block on this, so the renderer may not have gotten the event yet.
		const didRegister: Promise<MainThreadAuthenticationProvider> = new Promise((resolve, _) => {
			this.onDidRegisterAuthenticationProvider(e => {
				if (e.id === providerId) {
					provider = this._authenticationProviders.get(providerId);
					if (provider) {
						resolve(provider);
					} else {
						throw new Error(`No authentication provider '${providerId}' is currently registered.`);
					}
				}
			});
		});

		const didTimeout: Promise<MainThreadAuthenticationProvider> = new Promise((_, reject) => {
			setTimeout(() => {
				reject();
			}, 5000);
		});

		return Promise.race([didRegister, didTimeout]);
	}

	async getSessions(id: string): Promise<ReadonlyArray<AuthenticationSession>> {
		try {
			const authProvider = this._authenticationProviders.get(id) || await this.tryActivateProvider(id);
			return await authProvider.getSessions();
		} catch (_) {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	async login(id: string, scopes: string[]): Promise<AuthenticationSession> {
		try {
			const authProvider = this._authenticationProviders.get(id) || await this.tryActivateProvider(id);
			return await authProvider.login(scopes);
		} catch (_) {
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
