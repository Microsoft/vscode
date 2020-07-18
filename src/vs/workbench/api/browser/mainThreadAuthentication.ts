/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import * as modes from 'vs/editor/common/modes';
import * as nls from 'vs/nls';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IAuthenticationService, AllowedExtension, readAllowedExtensions } from 'vs/workbench/services/authentication/browser/authenticationService';
import { ExtHostAuthenticationShape, ExtHostContext, IExtHostContext, MainContext, MainThreadAuthenticationShape } from '../common/extHost.protocol';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import Severity from 'vs/base/common/severity';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { fromNow } from 'vs/base/common/date';

const VSO_ALLOWED_EXTENSIONS = ['github.vscode-pull-request-github', 'github.vscode-pull-request-github-insiders', 'vscode.git', 'ms-vsonline.vsonline', 'vscode.github-browser'];

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

	storageService.store(accountKey, JSON.stringify(usages), StorageScope.GLOBAL);
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
		private readonly storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
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
		const quickPick = this.quickInputService.createQuickPick<{ label: string, description: string, extension: AllowedExtension }>();
		quickPick.canSelectMany = true;
		const allowedExtensions = readAllowedExtensions(this.storageService, this.id, accountName);
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
			this.storageService.store(`${this.id}-${accountName}`, JSON.stringify(updatedAllowedList), StorageScope.GLOBAL);

			quickPick.dispose();
		});

		quickPick.onDidHide(() => {
			quickPick.dispose();
		});

		quickPick.show();
	}

	private async registerCommandsAndContextMenuItems(): Promise<void> {
		const sessions = await this._proxy.$getSessions(this.id);
		sessions.forEach(session => this.registerSession(session));
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

		this.storageKeysSyncRegistryService.registerStorageKey({ key: `${this.id}-${session.account.label}`, version: 1 });
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
		@IStorageKeysSyncRegistryService private readonly storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@IQuickInputService private readonly quickInputService: IQuickInputService
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
	}

	$getProviderIds(): Promise<string[]> {
		return Promise.resolve(this.authenticationService.getProviderIds());
	}

	async $registerAuthenticationProvider(id: string, label: string, supportsMultipleAccounts: boolean): Promise<void> {
		const provider = new MainThreadAuthenticationProvider(this._proxy, id, label, supportsMultipleAccounts, this.notificationService, this.storageKeysSyncRegistryService, this.storageService, this.quickInputService, this.dialogService);
		await provider.initialize();
		this.authenticationService.registerAuthenticationProvider(id, provider);
	}

	$unregisterAuthenticationProvider(id: string): void {
		this.authenticationService.unregisterAuthenticationProvider(id);
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
				await this.$setTrustedExtension(providerId, session.account.label, extensionId, extensionName);
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
					this.storageService.store(`${providerId}-${accountName}`, JSON.stringify(allowList), StorageScope.GLOBAL);
				}

				this.storageService.store(`${extensionName}-${providerId}`, session.id, StorageScope.GLOBAL);

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
		if (remoteConnection && remoteConnection.remoteAuthority && remoteConnection.remoteAuthority.startsWith('vsonline') && VSO_ALLOWED_EXTENSIONS.includes(extensionId)) {
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
			this.storageService.store(`${providerId}-${accountName}`, JSON.stringify(allowList), StorageScope.GLOBAL);
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

	async $setTrustedExtension(providerId: string, accountName: string, extensionId: string, extensionName: string): Promise<void> {
		const allowList = readAllowedExtensions(this.storageService, providerId, accountName);
		if (!allowList.find(allowed => allowed.id === extensionId)) {
			allowList.push({ id: extensionId, name: extensionName });
			this.storageService.store(`${providerId}-${accountName}`, JSON.stringify(allowList), StorageScope.GLOBAL);
		}
	}
}
