/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import * as modes from 'vs/editor/common/modes';
import * as nls from 'vs/nls';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IAuthenticationService, AllowedExtension, readAllowedExtensions, getAuthenticationProviderActivationEvent } from 'vs/workbench/services/authentication/browser/authenticationService';
import { ExtHostAuthenticationShape, ExtHostContext, IExtHostContext, MainContext, MainThreadAuthenticationShape } from '../common/extHost.protocol';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import Severity from 'vs/base/common/severity';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { fromNow } from 'vs/base/common/date';
import { ActivationKind, IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { isWeb } from 'vs/base/common/platform';
import { IEncryptionService } from 'vs/workbench/services/encryption/common/encryptionService';
import { IProductService } from 'vs/platform/product/common/productService';
import { ICredentialsService } from 'vs/workbench/services/credentials/common/credentials';

const VSO_ALLOWED_EXTENSIONS = ['github.vscode-pull-request-github', 'github.vscode-pull-request-github-insiders', 'vscode.git', 'ms-vsonline.vsonline', 'vscode.github-browser', 'ms-vscode.github-browser', 'github.codespaces'];

interface IAccountUsage {
	extensionId: string;
	extensionName: string;
	lastUsed: number;
}

function readAccountUsages(storageService: IStorageService, providerId: string, accountName: string,): IAccountUsage[] {
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

function removeAccountUsage(storageService: IStorageService, providerId: string, accountName: string): void {
	const accountKey = `${providerId}-${accountName}-usages`;
	storageService.remove(accountKey, StorageScope.GLOBAL);
}

function addAccountUsage(storageService: IStorageService, providerId: string, accountName: string, extensionId: string, extensionName: string) {
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

export class MainThreadAuthenticationProvider extends Disposable {
	private _accounts = new Map<string, string[]>(); // Map account name to session ids
	private _sessions = new Map<string, string>(); // Map account id to name

	constructor(
		private readonly _proxy: ExtHostAuthenticationShape,
		public readonly id: string,
		public readonly label: string,
		public readonly supportsMultipleAccounts: boolean,
		private readonly notificationService: INotificationService,
		private readonly storageService: IStorageService,
		private readonly quickInputService: IQuickInputService,
		private readonly dialogService: IDialogService
	) {
		super();
	}

	public async initialize(): Promise<void> {
		return this.registerCommandsAndContextMenuItems();
	}

	public hasSessions(): boolean {
		return !!this._sessions.size;
	}

	public manageTrustedExtensions(accountName: string) {
		const allowedExtensions = readAllowedExtensions(this.storageService, this.id, accountName);

		if (!allowedExtensions.length) {
			this.dialogService.show(Severity.Info, nls.localize('noTrustedExtensions', "This account has not been used by any extensions."), []);
			return;
		}

		const quickPick = this.quickInputService.createQuickPick<{ label: string, description: string, extension: AllowedExtension }>();
		quickPick.canSelectMany = true;
		const usages = readAccountUsages(this.storageService, this.id, accountName);
		const items = allowedExtensions.map(extension => {
			const usage = usages.find(usage => extension.id === usage.extensionId);
			return {
				label: extension.name,
				description: usage
					? nls.localize({ key: 'accountLastUsedDate', comment: ['The placeholder {0} is a string with time information, such as "3 days ago"'] }, "Last used this account {0}", fromNow(usage.lastUsed, true))
					: nls.localize('notUsed', "Has not used this account"),
				extension
			};
		});

		quickPick.items = items;
		quickPick.selectedItems = items;
		quickPick.title = nls.localize('manageTrustedExtensions', "Manage Trusted Extensions");
		quickPick.placeholder = nls.localize('manageExensions', "Choose which extensions can access this account");

		quickPick.onDidAccept(() => {
			const updatedAllowedList = quickPick.selectedItems.map(item => item.extension);
			this.storageService.store(`${this.id}-${accountName}`, JSON.stringify(updatedAllowedList), StorageScope.GLOBAL, StorageTarget.USER);

			quickPick.dispose();
		});

		quickPick.onDidHide(() => {
			quickPick.dispose();
		});

		quickPick.show();
	}

	private async registerCommandsAndContextMenuItems(): Promise<void> {
		try {
			const sessions = await this._proxy.$getSessions(this.id);
			sessions.forEach(session => this.registerSession(session));
		} catch (_) {
			// Ignore
		}
	}

	private registerSession(session: modes.AuthenticationSession) {
		this._sessions.set(session.id, session.account.label);

		const existingSessionsForAccount = this._accounts.get(session.account.label);
		if (existingSessionsForAccount) {
			this._accounts.set(session.account.label, existingSessionsForAccount.concat(session.id));
			return;
		} else {
			this._accounts.set(session.account.label, [session.id]);
		}
	}

	async signOut(accountName: string): Promise<void> {
		const accountUsages = readAccountUsages(this.storageService, this.id, accountName);
		const sessionsForAccount = this._accounts.get(accountName);

		const result = await this.dialogService.confirm({
			title: nls.localize('signOutConfirm', "Sign out of {0}", accountName),
			message: accountUsages.length
				? nls.localize('signOutMessagve', "The account {0} has been used by: \n\n{1}\n\n Sign out of these features?", accountName, accountUsages.map(usage => usage.extensionName).join('\n'))
				: nls.localize('signOutMessageSimple', "Sign out of {0}?", accountName)
		});

		if (result.confirmed) {
			sessionsForAccount?.forEach(sessionId => this.logout(sessionId));
			removeAccountUsage(this.storageService, this.id, accountName);
			this.storageService.remove(`${this.id}-${accountName}`, StorageScope.GLOBAL);
		}
	}

	async getSessions(): Promise<ReadonlyArray<modes.AuthenticationSession>> {
		return this._proxy.$getSessions(this.id);
	}

	async updateSessionItems(event: modes.AuthenticationSessionsChangeEvent): Promise<void> {
		const { added, removed } = event;
		const session = await this._proxy.$getSessions(this.id);
		const addedSessions = session.filter(session => added.some(id => id === session.id));

		removed.forEach(sessionId => {
			const accountName = this._sessions.get(sessionId);
			if (accountName) {
				this._sessions.delete(sessionId);
				let sessionsForAccount = this._accounts.get(accountName) || [];
				const sessionIndex = sessionsForAccount.indexOf(sessionId);
				sessionsForAccount.splice(sessionIndex);

				if (!sessionsForAccount.length) {
					this._accounts.delete(accountName);
				}
			}
		});

		addedSessions.forEach(session => this.registerSession(session));
	}

	login(scopes: string[]): Promise<modes.AuthenticationSession> {
		return this._proxy.$login(this.id, scopes);
	}

	async logout(sessionId: string): Promise<void> {
		await this._proxy.$logout(this.id, sessionId);
		this.notificationService.info(nls.localize('signedOut', "Successfully signed out."));
	}
}

@extHostNamedCustomer(MainContext.MainThreadAuthentication)
export class MainThreadAuthentication extends Disposable implements MainThreadAuthenticationShape {
	private readonly _proxy: ExtHostAuthenticationShape;

	constructor(
		extHostContext: IExtHostContext,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@ICredentialsService private readonly credentialsService: ICredentialsService,
		@IEncryptionService private readonly encryptionService: IEncryptionService,
		@IProductService private readonly productService: IProductService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostAuthentication);

		this._register(this.authenticationService.onDidChangeSessions(e => {
			this._proxy.$onDidChangeAuthenticationSessions(e.providerId, e.label, e.event);
		}));

		this._register(this.authenticationService.onDidRegisterAuthenticationProvider(info => {
			this._proxy.$onDidChangeAuthenticationProviders([info], []);
		}));

		this._register(this.authenticationService.onDidUnregisterAuthenticationProvider(info => {
			this._proxy.$onDidChangeAuthenticationProviders([], [info]);
		}));

		this._proxy.$setProviders(this.authenticationService.declaredProviders);

		this._register(this.authenticationService.onDidChangeDeclaredProviders(e => {
			this._proxy.$setProviders(e);
		}));

		this._register(this.credentialsService.onDidChangePassword(_ => {
			this._proxy.$onDidChangePassword();
		}));
	}

	$getProviderIds(): Promise<string[]> {
		return Promise.resolve(this.authenticationService.getProviderIds());
	}

	async $registerAuthenticationProvider(id: string, label: string, supportsMultipleAccounts: boolean): Promise<void> {
		const provider = new MainThreadAuthenticationProvider(this._proxy, id, label, supportsMultipleAccounts, this.notificationService, this.storageService, this.quickInputService, this.dialogService);
		await provider.initialize();
		this.authenticationService.registerAuthenticationProvider(id, provider);
	}

	$unregisterAuthenticationProvider(id: string): void {
		this.authenticationService.unregisterAuthenticationProvider(id);
	}

	$ensureProvider(id: string): Promise<void> {
		return this.extensionService.activateByEvent(getAuthenticationProviderActivationEvent(id), ActivationKind.Immediate);
	}

	$sendDidChangeSessions(id: string, event: modes.AuthenticationSessionsChangeEvent): void {
		this.authenticationService.sessionsUpdate(id, event);
	}

	$getSessions(id: string): Promise<ReadonlyArray<modes.AuthenticationSession>> {
		return this.authenticationService.getSessions(id);
	}

	$login(providerId: string, scopes: string[]): Promise<modes.AuthenticationSession> {
		return this.authenticationService.login(providerId, scopes);
	}

	$logout(providerId: string, sessionId: string): Promise<void> {
		return this.authenticationService.logout(providerId, sessionId);
	}

	async $requestNewSession(providerId: string, scopes: string[], extensionId: string, extensionName: string): Promise<void> {
		return this.authenticationService.requestNewSession(providerId, scopes, extensionId, extensionName);
	}

	async $getSession(providerId: string, scopes: string[], extensionId: string, extensionName: string, options: { createIfNone: boolean, clearSessionPreference: boolean }): Promise<modes.AuthenticationSession | undefined> {
		const orderedScopes = scopes.sort().join(' ');
		const sessions = (await this.$getSessions(providerId)).filter(session => session.scopes.slice().sort().join(' ') === orderedScopes);
		const label = this.authenticationService.getLabel(providerId);

		if (sessions.length) {
			if (!this.authenticationService.supportsMultipleAccounts(providerId)) {
				const session = sessions[0];
				const allowed = await this.$getSessionsPrompt(providerId, session.account.label, label, extensionId, extensionName);
				if (allowed) {
					return session;
				} else {
					throw new Error('User did not consent to login.');
				}
			}

			// On renderer side, confirm consent, ask user to choose between accounts if multiple sessions are valid
			const selected = await this.$selectSession(providerId, label, extensionId, extensionName, sessions, scopes, !!options.clearSessionPreference);
			return sessions.find(session => session.id === selected.id);
		} else {
			if (options.createIfNone) {
				const isAllowed = await this.$loginPrompt(label, extensionName);
				if (!isAllowed) {
					throw new Error('User did not consent to login.');
				}

				const session = await this.authenticationService.login(providerId, scopes);
				await this.$setTrustedExtensionAndAccountPreference(providerId, session.account.label, extensionId, extensionName, session.id);
				return session;
			} else {
				await this.$requestNewSession(providerId, scopes, extensionId, extensionName);
				return undefined;
			}
		}
	}

	async $selectSession(providerId: string, providerName: string, extensionId: string, extensionName: string, potentialSessions: modes.AuthenticationSession[], scopes: string[], clearSessionPreference: boolean): Promise<modes.AuthenticationSession> {
		if (!potentialSessions.length) {
			throw new Error('No potential sessions found');
		}

		if (clearSessionPreference) {
			this.storageService.remove(`${extensionName}-${providerId}`, StorageScope.GLOBAL);
		} else {
			const existingSessionPreference = this.storageService.get(`${extensionName}-${providerId}`, StorageScope.GLOBAL);
			if (existingSessionPreference) {
				const matchingSession = potentialSessions.find(session => session.id === existingSessionPreference);
				if (matchingSession) {
					const allowed = await this.$getSessionsPrompt(providerId, matchingSession.account.label, providerName, extensionId, extensionName);
					if (allowed) {
						return matchingSession;
					}
				}
			}
		}

		return new Promise((resolve, reject) => {
			const quickPick = this.quickInputService.createQuickPick<{ label: string, session?: modes.AuthenticationSession }>();
			quickPick.ignoreFocusOut = true;
			const items: { label: string, session?: modes.AuthenticationSession }[] = potentialSessions.map(session => {
				return {
					label: session.account.label,
					session
				};
			});

			items.push({
				label: nls.localize('useOtherAccount', "Sign in to another account")
			});

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
				const selected = quickPick.selectedItems[0];

				const session = selected.session ?? await this.authenticationService.login(providerId, scopes);

				const accountName = session.account.label;

				const allowList = readAllowedExtensions(this.storageService, providerId, accountName);
				if (!allowList.find(allowed => allowed.id === extensionId)) {
					allowList.push({ id: extensionId, name: extensionName });
					this.storageService.store(`${providerId}-${accountName}`, JSON.stringify(allowList), StorageScope.GLOBAL, StorageTarget.USER);
				}

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

	async $getSessionsPrompt(providerId: string, accountName: string, providerName: string, extensionId: string, extensionName: string): Promise<boolean> {
		const allowList = readAllowedExtensions(this.storageService, providerId, accountName);
		const extensionData = allowList.find(extension => extension.id === extensionId);
		if (extensionData) {
			addAccountUsage(this.storageService, providerId, accountName, extensionId, extensionName);
			return true;
		}

		const remoteConnection = this.remoteAgentService.getConnection();
		const isVSO = remoteConnection !== null
			? remoteConnection.remoteAuthority.startsWith('vsonline')
			: isWeb;

		if (isVSO && VSO_ALLOWED_EXTENSIONS.includes(extensionId)) {
			addAccountUsage(this.storageService, providerId, accountName, extensionId, extensionName);
			return true;
		}

		const { choice } = await this.dialogService.show(
			Severity.Info,
			nls.localize('confirmAuthenticationAccess', "The extension '{0}' wants to access the {1} account '{2}'.", extensionName, providerName, accountName),
			[nls.localize('allow', "Allow"), nls.localize('cancel', "Cancel")],
			{
				cancelId: 1
			}
		);

		const allow = choice === 0;
		if (allow) {
			addAccountUsage(this.storageService, providerId, accountName, extensionId, extensionName);
			allowList.push({ id: extensionId, name: extensionName });
			this.storageService.store(`${providerId}-${accountName}`, JSON.stringify(allowList), StorageScope.GLOBAL, StorageTarget.USER);
		}

		return allow;
	}

	async $loginPrompt(providerName: string, extensionName: string): Promise<boolean> {
		const { choice } = await this.dialogService.show(
			Severity.Info,
			nls.localize('confirmLogin', "The extension '{0}' wants to sign in using {1}.", extensionName, providerName),
			[nls.localize('allow', "Allow"), nls.localize('cancel', "Cancel")],
			{
				cancelId: 1
			}
		);

		return choice === 0;
	}

	async $setTrustedExtensionAndAccountPreference(providerId: string, accountName: string, extensionId: string, extensionName: string, sessionId: string): Promise<void> {
		const allowList = readAllowedExtensions(this.storageService, providerId, accountName);
		if (!allowList.find(allowed => allowed.id === extensionId)) {
			allowList.push({ id: extensionId, name: extensionName });
			this.storageService.store(`${providerId}-${accountName}`, JSON.stringify(allowList), StorageScope.GLOBAL, StorageTarget.USER);
		}

		this.storageService.store(`${extensionName}-${providerId}`, sessionId, StorageScope.GLOBAL, StorageTarget.MACHINE);
		addAccountUsage(this.storageService, providerId, accountName, extensionId, extensionName);
	}

	private getFullKey(extensionId: string): string {
		return `${this.productService.urlProtocol}${extensionId}`;
	}

	async $getPassword(extensionId: string, key: string): Promise<string | undefined> {
		const fullKey = this.getFullKey(extensionId);
		const password = await this.credentialsService.getPassword(fullKey, key);
		const decrypted = password && await this.encryptionService.decrypt(password);

		if (decrypted) {
			try {
				const value = JSON.parse(decrypted);
				if (value.extensionId === extensionId) {
					return value.content;
				}
			} catch (_) {
				throw new Error('Cannot get password');
			}
		}

		return undefined;
	}

	async $setPassword(extensionId: string, key: string, value: string): Promise<void> {
		const fullKey = this.getFullKey(extensionId);
		const toEncrypt = JSON.stringify({
			extensionId,
			content: value
		});
		const encrypted = await this.encryptionService.encrypt(toEncrypt);
		return this.credentialsService.setPassword(fullKey, key, encrypted);
	}

	async $deletePassword(extensionId: string, key: string): Promise<void> {
		try {
			const fullKey = this.getFullKey(extensionId);
			await this.credentialsService.deletePassword(fullKey, key);
		} catch (_) {
			throw new Error('Cannot delete password');
		}
	}
}
