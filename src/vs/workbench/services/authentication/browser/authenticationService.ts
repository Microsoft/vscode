/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { flatten } from 'vs/base/common/arrays';
import { Emitter, Event } from 'vs/base/common/event';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { Disposable, IDisposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { isWeb } from 'vs/base/common/platform';
import { isFalsyOrWhitespace } from 'vs/base/common/strings';
import { isString } from 'vs/base/common/types';
import { AuthenticationProviderInformation, AuthenticationSession, AuthenticationSessionsChangeEvent } from 'vs/editor/common/modes';
import * as nls from 'vs/nls';
import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Severity } from 'vs/platform/notification/common/notification';
import { IProductService } from 'vs/platform/product/common/productService';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { MainThreadAuthenticationProvider } from 'vs/workbench/api/browser/mainThreadAuthentication';
import { IActivityService, NumberBadge } from 'vs/workbench/services/activity/common/activity';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ActivationKind, IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';

export function getAuthenticationProviderActivationEvent(id: string): string { return `onAuthenticationRequest:${id}`; }

export interface IAccountUsage {
	extensionId: string;
	extensionName: string;
	lastUsed: number;
}

const VSO_ALLOWED_EXTENSIONS = ['github.vscode-pull-request-github', 'github.vscode-pull-request-github-insiders', 'vscode.git', 'ms-vsonline.vsonline', 'vscode.github-browser', 'ms-vscode.github-browser', 'ms-vscode.remotehub', 'ms-vscode.remotehub-insiders', 'github.codespaces'];

export function readAccountUsages(storageService: IStorageService, providerId: string, accountName: string,): IAccountUsage[] {
	const accountKey = `${providerId}-${accountName}-usages`;
	const storedUsages = storageService.get(accountKey, StorageScope.GLOBAL);
	let usages: IAccountUsage[] = [];
	if (storedUsages) {
		try {
			usages = JSON.parse(storedUsages);
		} catch (e) {
			// ignore
		}
	}

	return usages;
}

export function removeAccountUsage(storageService: IStorageService, providerId: string, accountName: string): void {
	const accountKey = `${providerId}-${accountName}-usages`;
	storageService.remove(accountKey, StorageScope.GLOBAL);
}

export function addAccountUsage(storageService: IStorageService, providerId: string, accountName: string, extensionId: string, extensionName: string) {
	const accountKey = `${providerId}-${accountName}-usages`;
	const usages = readAccountUsages(storageService, providerId, accountName);

	const existingUsageIndex = usages.findIndex(usage => usage.extensionId === extensionId);
	if (existingUsageIndex > -1) {
		usages.splice(existingUsageIndex, 1, {
			extensionId,
			extensionName,
			lastUsed: Date.now()
		});
	} else {
		usages.push({
			extensionId,
			extensionName,
			lastUsed: Date.now()
		});
	}

	storageService.store(accountKey, JSON.stringify(usages), StorageScope.GLOBAL, StorageTarget.MACHINE);
}

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
	isAccessAllowed(providerId: string, accountName: string, extensionId: string): boolean | undefined;
	updatedAllowedExtension(providerId: string, accountName: string, extensionId: string, extensionName: string, isAllowed: boolean): Promise<void>;
	showGetSessionPrompt(providerId: string, accountName: string, extensionId: string, extensionName: string): Promise<boolean>;
	selectSession(providerId: string, extensionId: string, extensionName: string, scopes: string[], possibleSessions: readonly AuthenticationSession[]): Promise<AuthenticationSession>;
	requestSessionAccess(providerId: string, extensionId: string, extensionName: string, scopes: string[], possibleSessions: readonly AuthenticationSession[]): void;
	completeSessionAccessRequest(providerId: string, extensionId: string, extensionName: string, scopes: string[]): Promise<void>
	requestNewSession(providerId: string, scopes: string[], extensionId: string, extensionName: string): Promise<void>;
	sessionsUpdate(providerId: string, event: AuthenticationSessionsChangeEvent): void;

	readonly onDidRegisterAuthenticationProvider: Event<AuthenticationProviderInformation>;
	readonly onDidUnregisterAuthenticationProvider: Event<AuthenticationProviderInformation>;

	readonly onDidChangeSessions: Event<{ providerId: string, label: string, event: AuthenticationSessionsChangeEvent }>;

	// TODO @RMacfarlane completely remove this property
	declaredProviders: AuthenticationProviderInformation[];
	readonly onDidChangeDeclaredProviders: Event<AuthenticationProviderInformation[]>;

	getSessions(id: string, scopes?: string[], activateImmediate?: boolean): Promise<ReadonlyArray<AuthenticationSession>>;
	getLabel(providerId: string): string;
	supportsMultipleAccounts(providerId: string): boolean;
	createSession(providerId: string, scopes: string[], activateImmediate?: boolean): Promise<AuthenticationSession>;
	removeSession(providerId: string, sessionId: string): Promise<void>;

	manageTrustedExtensionsForAccount(providerId: string, accountName: string): Promise<void>;
	removeAccountSessions(providerId: string, accountName: string, sessions: AuthenticationSession[]): Promise<void>;
}

export interface AllowedExtension {
	id: string;
	name: string;
	allowed?: boolean;
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
	private _signInRequestItems = new Map<string, SessionRequestInfo>();
	private _sessionAccessRequestItems = new Map<string, { [extensionId: string]: { disposables: IDisposable[], possibleSessions: AuthenticationSession[] } }>();
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
		@IExtensionService private readonly extensionService: IExtensionService,
		@IStorageService private readonly storageService: IStorageService,
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService
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

	registerAuthenticationProvider(id: string, authenticationProvider: MainThreadAuthenticationProvider): void {
		this._authenticationProviders.set(id, authenticationProvider);
		this._onDidRegisterAuthenticationProvider.fire({ id, label: authenticationProvider.label });

		if (this._placeholderMenuItem) {
			this._placeholderMenuItem.dispose();
			this._placeholderMenuItem = undefined;
		}
	}

	unregisterAuthenticationProvider(id: string): void {
		const provider = this._authenticationProviders.get(id);
		if (provider) {
			provider.dispose();
			this._authenticationProviders.delete(id);
			this._onDidUnregisterAuthenticationProvider.fire({ id, label: provider.label });

			const accessRequests = this._sessionAccessRequestItems.get(id) || {};
			Object.keys(accessRequests).forEach(extensionId => {
				this.removeAccessRequest(id, extensionId);
			});
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

			if (event.added) {
				await this.updateNewSessionRequests(provider, event.added);
			}

			if (event.removed) {
				await this.updateAccessRequests(id, event.removed);
			}

			this.updateBadgeCount();
		}
	}

	private async updateNewSessionRequests(provider: MainThreadAuthenticationProvider, addedSessions: readonly AuthenticationSession[]): Promise<void> {
		const existingRequestsForProvider = this._signInRequestItems.get(provider.id);
		if (!existingRequestsForProvider) {
			return;
		}

		Object.keys(existingRequestsForProvider).forEach(requestedScopes => {
			if (addedSessions.some(session => session.scopes.slice().sort().join('') === requestedScopes)) {
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
	}

	private async updateAccessRequests(providerId: string, removedSessions: readonly AuthenticationSession[]) {
		const providerRequests = this._sessionAccessRequestItems.get(providerId);
		if (providerRequests) {
			Object.keys(providerRequests).forEach(extensionId => {
				removedSessions.forEach(removed => {
					const indexOfSession = providerRequests[extensionId].possibleSessions.findIndex(session => session.id === removed.id);
					if (indexOfSession) {
						providerRequests[extensionId].possibleSessions.splice(indexOfSession, 1);
					}
				});

				if (!providerRequests[extensionId].possibleSessions.length) {
					this.removeAccessRequest(providerId, extensionId);
				}
			});
		}
	}

	private updateBadgeCount(): void {
		this._accountBadgeDisposable.clear();

		let numberOfRequests = 0;
		this._signInRequestItems.forEach(providerRequests => {
			Object.keys(providerRequests).forEach(request => {
				numberOfRequests += providerRequests[request].requestingExtensionIds.length;
			});
		});

		this._sessionAccessRequestItems.forEach(accessRequest => {
			numberOfRequests += Object.keys(accessRequest).length;
		});

		if (numberOfRequests > 0) {
			const badge = new NumberBadge(numberOfRequests, () => nls.localize('sign in', "Sign in requested"));
			this._accountBadgeDisposable.value = this.activityService.showAccountsActivity({ badge });
		}
	}

	private removeAccessRequest(providerId: string, extensionId: string): void {
		const providerRequests = this._sessionAccessRequestItems.get(providerId) || {};
		if (providerRequests[extensionId]) {
			providerRequests[extensionId].disposables.forEach(d => d.dispose());
			delete providerRequests[extensionId];
			this.updateBadgeCount();
		}
	}

	/**
	 * Check extension access to an account
	 * @param providerId The id of the authentication provider
	 * @param accountName The account name that access is checked for
	 * @param extensionId The id of the extension requesting access
	 * @returns Returns true or false if the user has opted to permanently grant or disallow access, and undefined
	 * if they haven't made a choice yet
	 */
	isAccessAllowed(providerId: string, accountName: string, extensionId: string): boolean | undefined {
		const allowList = readAllowedExtensions(this.storageService, providerId, accountName);
		const extensionData = allowList.find(extension => extension.id === extensionId);
		if (extensionData) {
			// This property didn't exist on this data previously, inclusion in the list at all indicates allowance
			return extensionData.allowed !== undefined
				? extensionData.allowed
				: true;
		}

		const remoteConnection = this.remoteAgentService.getConnection();
		const isVSO = remoteConnection !== null
			? remoteConnection.remoteAuthority.startsWith('vsonline') || remoteConnection.remoteAuthority.startsWith('codespaces')
			: isWeb;

		if (isVSO && VSO_ALLOWED_EXTENSIONS.includes(extensionId)) {
			return true;
		}

		return undefined;
	}

	async updatedAllowedExtension(providerId: string, accountName: string, extensionId: string, extensionName: string, isAllowed: boolean): Promise<void> {
		const allowList = readAllowedExtensions(this.storageService, providerId, accountName);
		const index = allowList.findIndex(extension => extension.id === extensionId);
		if (index === -1) {
			allowList.push({ id: extensionId, name: extensionName, allowed: isAllowed });
		} else {
			allowList[index].allowed = isAllowed;
		}

		await this.storageService.store(`${providerId}-${accountName}`, JSON.stringify(allowList), StorageScope.GLOBAL, StorageTarget.USER);
	}

	async showGetSessionPrompt(providerId: string, accountName: string, extensionId: string, extensionName: string): Promise<boolean> {
		const providerName = this.getLabel(providerId);
		const { choice } = await this.dialogService.show(
			Severity.Info,
			nls.localize('confirmAuthenticationAccess', "The extension '{0}' wants to access the {1} account '{2}'.", extensionName, providerName, accountName),
			[nls.localize('allow', "Allow"), nls.localize('deny', "Deny"), nls.localize('cancel', "Cancel")],
			{
				cancelId: 2
			}
		);

		const cancelled = choice === 2;
		const allowed = choice === 0;
		if (!cancelled) {
			this.updatedAllowedExtension(providerId, accountName, extensionId, extensionName, allowed);
			this.removeAccessRequest(providerId, extensionId);
		}

		return allowed;
	}

	async selectSession(providerId: string, extensionId: string, extensionName: string, scopes: string[], availableSessions: AuthenticationSession[]): Promise<AuthenticationSession> {
		return new Promise((resolve, reject) => {
			// This function should be used only when there are sessions to disambiguate.
			if (!availableSessions.length) {
				reject('No available sessions');
			}

			const quickPick = this.quickInputService.createQuickPick<{ label: string, session?: AuthenticationSession }>();
			quickPick.ignoreFocusOut = true;
			const items: { label: string, session?: AuthenticationSession }[] = availableSessions.map(session => {
				return {
					label: session.account.label,
					session: session
				};
			});

			items.push({
				label: nls.localize('useOtherAccount', "Sign in to another account")
			});

			const providerName = this.getLabel(providerId);

			quickPick.items = items;

			quickPick.title = nls.localize(
				{
					key: 'selectAccount',
					comment: ['The placeholder {0} is the name of an extension. {1} is the name of the type of account, such as Microsoft or GitHub.']
				},
				"The extension '{0}' wants to access a {1} account",
				extensionName,
				providerName);
			quickPick.placeholder = nls.localize('getSessionPlateholder', "Select an account for '{0}' to use or Esc to cancel", extensionName);

			quickPick.onDidAccept(async _ => {
				const session = quickPick.selectedItems[0].session ?? await this.createSession(providerId, scopes);
				const accountName = session.account.label;

				this.updatedAllowedExtension(providerId, accountName, extensionId, extensionName, true);

				this.removeAccessRequest(providerId, extensionId);
				this.storageService.store(`${extensionName}-${providerId}`, session.id, StorageScope.GLOBAL, StorageTarget.MACHINE);

				quickPick.dispose();
				resolve(session);
			});

			quickPick.onDidHide(_ => {
				if (!quickPick.selectedItems[0]) {
					reject('User did not consent to account access');
				}

				quickPick.dispose();
			});

			quickPick.show();
		});
	}

	async completeSessionAccessRequest(providerId: string, extensionId: string, extensionName: string, scopes: string[]): Promise<void> {
		const providerRequests = this._sessionAccessRequestItems.get(providerId) || {};
		const existingRequest = providerRequests[extensionId];
		if (!existingRequest) {
			return;
		}

		const possibleSessions = existingRequest.possibleSessions;
		const supportsMultipleAccounts = this.supportsMultipleAccounts(providerId);

		let session: AuthenticationSession | undefined;
		if (supportsMultipleAccounts) {
			try {
				session = await this.selectSession(providerId, extensionId, extensionName, scopes, possibleSessions);
			} catch (_) {
				// ignore cancel
			}
		} else {
			const approved = await this.showGetSessionPrompt(providerId, possibleSessions[0].account.label, extensionId, extensionName);
			if (approved) {
				session = possibleSessions[0];
			}
		}

		if (session) {
			addAccountUsage(this.storageService, providerId, session.account.label, extensionId, extensionName);
			const providerName = this.getLabel(providerId);
			this._onDidChangeSessions.fire({ providerId, label: providerName, event: { added: [], removed: [], changed: [session] } });
		}
	}

	requestSessionAccess(providerId: string, extensionId: string, extensionName: string, scopes: string[], possibleSessions: AuthenticationSession[]): void {
		const providerRequests = this._sessionAccessRequestItems.get(providerId) || {};
		const hasExistingRequest = providerRequests[extensionId];
		if (hasExistingRequest) {
			return;
		}

		const menuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			group: '3_accessRequests',
			command: {
				id: `${providerId}${extensionId}Access`,
				title: nls.localize({
					key: 'accessRequest',
					comment: ['The placeholder {0} will be replaced with an extension name. (1) is to indicate that this menu item contributes to a badge count']
				},
					"Grant access to {0}... (1)", extensionName)
			}
		});

		const accessCommand = CommandsRegistry.registerCommand({
			id: `${providerId}${extensionId}Access`,
			handler: async (accessor) => {
				const authenticationService = accessor.get(IAuthenticationService);
				authenticationService.completeSessionAccessRequest(providerId, extensionId, extensionName, scopes);
			}
		});

		providerRequests[extensionId] = { possibleSessions, disposables: [menuItem, accessCommand] };
		this._sessionAccessRequestItems.set(providerId, providerRequests);
		this.updateBadgeCount();
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
					const session = await authenticationService.createSession(providerId, scopes);

					// Add extension to allow list since user explicitly signed in on behalf of it
					this.updatedAllowedExtension(providerId, session.account.label, extensionId, extensionName, true);

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

			this.updateBadgeCount();
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

	private async tryActivateProvider(providerId: string, activateImmediate: boolean): Promise<MainThreadAuthenticationProvider> {
		await this.extensionService.activateByEvent(getAuthenticationProviderActivationEvent(providerId), activateImmediate ? ActivationKind.Immediate : ActivationKind.Normal);
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

	async getSessions(id: string, scopes?: string[], activateImmediate: boolean = false): Promise<ReadonlyArray<AuthenticationSession>> {
		try {
			const authProvider = this._authenticationProviders.get(id) || await this.tryActivateProvider(id, activateImmediate);
			return await authProvider.getSessions(scopes);
		} catch (_) {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	async createSession(id: string, scopes: string[], activateImmediate: boolean = false): Promise<AuthenticationSession> {
		try {
			const authProvider = this._authenticationProviders.get(id) || await this.tryActivateProvider(id, activateImmediate);
			return await authProvider.createSession(scopes);
		} catch (_) {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}

	async removeSession(id: string, sessionId: string): Promise<void> {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.removeSession(sessionId);
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

	async removeAccountSessions(id: string, accountName: string, sessions: AuthenticationSession[]): Promise<void> {
		const authProvider = this._authenticationProviders.get(id);
		if (authProvider) {
			return authProvider.removeAccountSessions(accountName, sessions);
		} else {
			throw new Error(`No authentication provider '${id}' is currently registered.`);
		}
	}
}

registerSingleton(IAuthenticationService, AuthenticationService);
