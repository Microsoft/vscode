/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import * as modes from 'vs/editor/common/modes';
import * as nls from 'vs/nls';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { ExtHostAuthenticationShape, ExtHostContext, IExtHostContext, MainContext, MainThreadAuthenticationShape } from '../common/extHost.protocol';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import Severity from 'vs/base/common/severity';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';

interface AllowedExtension {
	id: string;
	name: string;
}

const accountUsages = new Map<string, { [accountName: string]: string[] }>();

const VSO_ALLOWED_EXTENSIONS = ['github.vscode-pull-request-github', 'github.vscode-pull-request-github-insiders', 'vscode.git'];

function addAccountUsage(providerId: string, accountName: string, extensionOrFeatureName: string) {
	const providerAccountUsage = accountUsages.get(providerId);
	if (!providerAccountUsage) {
		accountUsages.set(providerId, { [accountName]: [extensionOrFeatureName] });
	} else {
		if (providerAccountUsage[accountName]) {
			if (!providerAccountUsage[accountName].includes(extensionOrFeatureName)) {
				providerAccountUsage[accountName].push(extensionOrFeatureName);
			}
		} else {
			providerAccountUsage[accountName] = [extensionOrFeatureName];
		}

		accountUsages.set(providerId, providerAccountUsage);
	}
}

function readAllowedExtensions(storageService: IStorageService, providerId: string, accountName: string): AllowedExtension[] {
	let trustedExtensions: AllowedExtension[] = [];
	try {
		const trustedExtensionSrc = storageService.get(`${providerId}-${accountName}`, StorageScope.GLOBAL);
		if (trustedExtensionSrc) {
			trustedExtensions = JSON.parse(trustedExtensionSrc);
		}
	} catch (err) { }

	return trustedExtensions;
}

export class MainThreadAuthenticationProvider extends Disposable {
	private _sessionMenuItems = new Map<string, IDisposable[]>();
	private _accounts = new Map<string, string[]>(); // Map account name to session ids
	private _sessions = new Map<string, string>(); // Map account id to name

	constructor(
		private readonly _proxy: ExtHostAuthenticationShape,
		public readonly id: string,
		public readonly displayName: string,
		private readonly notificationService: INotificationService,
		private readonly storageKeysSyncRegistryService: IStorageKeysSyncRegistryService
	) {
		super();
	}

	public async initialize(): Promise<void> {
		return this.registerCommandsAndContextMenuItems();
	}

	public hasSessions(): boolean {
		return !!this._sessions.size;
	}

	private manageTrustedExtensions(quickInputService: IQuickInputService, storageService: IStorageService, accountName: string) {
		const quickPick = quickInputService.createQuickPick<{ label: string, extension: AllowedExtension }>();
		quickPick.canSelectMany = true;
		const allowedExtensions = readAllowedExtensions(storageService, this.id, accountName);
		const items = allowedExtensions.map(extension => {
			return {
				label: extension.name,
				extension
			};
		});

		quickPick.items = items;
		quickPick.selectedItems = items;
		quickPick.title = nls.localize('manageTrustedExtensions', "Manage Trusted Extensions");
		quickPick.placeholder = nls.localize('manageExensions', "Choose which extensions can access this account");

		quickPick.onDidAccept(() => {
			const updatedAllowedList = quickPick.selectedItems.map(item => item.extension);
			storageService.store(`${this.id}-${accountName}`, JSON.stringify(updatedAllowedList), StorageScope.GLOBAL);

			quickPick.dispose();
		});

		quickPick.onDidHide(() => {
			quickPick.dispose();
		});

		quickPick.show();
	}

	private showUsage(quickInputService: IQuickInputService, accountName: string) {
		const quickPick = quickInputService.createQuickPick();
		const providerUsage = accountUsages.get(this.id);
		const accountUsage = (providerUsage || {})[accountName] || [];

		quickPick.items = accountUsage.map(extensionOrFeature => {
			return {
				label: extensionOrFeature
			};
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
		this._sessions.set(session.id, session.account.displayName);

		const existingSessionsForAccount = this._accounts.get(session.account.displayName);
		if (existingSessionsForAccount) {
			this._accounts.set(session.account.displayName, existingSessionsForAccount.concat(session.id));
			return;
		} else {
			this._accounts.set(session.account.displayName, [session.id]);
		}

		const menuItem = MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			group: '1_accounts',
			command: {
				id: `configureSessions${session.id}`,
				title: `${session.account.displayName} (${this.displayName})`
			},
			order: 3
		});

		this.storageKeysSyncRegistryService.registerStorageKey({ key: `${this.id}-${session.account.displayName}`, version: 1 });

		const manageCommand = CommandsRegistry.registerCommand({
			id: `configureSessions${session.id}`,
			handler: (accessor, args) => {
				const quickInputService = accessor.get(IQuickInputService);
				const storageService = accessor.get(IStorageService);
				const dialogService = accessor.get(IDialogService);

				const quickPick = quickInputService.createQuickPick();
				const showUsage = nls.localize('showUsage', "Show Extensions and Features Using This Account");
				const manage = nls.localize('manageTrustedExtensions', "Manage Trusted Extensions");
				const signOut = nls.localize('signOut', "Sign Out");
				const items = ([{ label: showUsage }, { label: manage }, { label: signOut }]);

				quickPick.items = items;

				quickPick.onDidAccept(e => {
					const selected = quickPick.selectedItems[0];
					if (selected.label === signOut) {
						this.signOut(dialogService, session);
					}

					if (selected.label === manage) {
						this.manageTrustedExtensions(quickInputService, storageService, session.account.displayName);
					}

					if (selected.label === showUsage) {
						this.showUsage(quickInputService, session.account.displayName);
					}

					quickPick.dispose();
				});

				quickPick.onDidHide(_ => {
					quickPick.dispose();
				});

				quickPick.show();
			},
		});

		this._sessionMenuItems.set(session.account.displayName, [menuItem, manageCommand]);
	}

	async signOut(dialogService: IDialogService, session: modes.AuthenticationSession): Promise<void> {
		const providerUsage = accountUsages.get(this.id);
		const accountUsage = (providerUsage || {})[session.account.displayName] || [];
		const sessionsForAccount = this._accounts.get(session.account.displayName);

		// Skip dialog if nothing is using the account
		if (!accountUsage.length) {
			accountUsages.set(this.id, { [session.account.displayName]: [] });
			sessionsForAccount?.forEach(sessionId => this.logout(sessionId));
			return;
		}

		const result = await dialogService.confirm({
			title: nls.localize('signOutConfirm', "Sign out of {0}", session.account.displayName),
			message: nls.localize('signOutMessage', "The account {0} is currently used by: \n\n{1}\n\n Sign out of these features?", session.account.displayName, accountUsage.join('\n'))
		});

		if (result.confirmed) {
			accountUsages.set(this.id, { [session.account.displayName]: [] });
			sessionsForAccount?.forEach(sessionId => this.logout(sessionId));
		}
	}

	async getSessions(): Promise<ReadonlyArray<modes.AuthenticationSession>> {
		return (await this._proxy.$getSessions(this.id)).map(session => {
			return {
				id: session.id,
				account: session.account,
				getAccessToken: () => {
					addAccountUsage(this.id, session.account.displayName, nls.localize('sync', "Preferences Sync"));
					return this._proxy.$getSessionAccessToken(this.id, session.id);
				}
			};
		});
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
					const disposeables = this._sessionMenuItems.get(accountName);
					if (disposeables) {
						disposeables.forEach(disposeable => disposeable.dispose());
						this._sessionMenuItems.delete(accountName);
					}
					this._accounts.delete(accountName);
				}
			}
		});

		addedSessions.forEach(session => this.registerSession(session));
	}

	login(scopes: string[]): Promise<modes.AuthenticationSession> {
		return this._proxy.$login(this.id, scopes).then(session => {
			return {
				id: session.id,
				account: session.account,
				getAccessToken: () => this._proxy.$getSessionAccessToken(this.id, session.id)
			};
		});
	}

	async logout(sessionId: string): Promise<void> {
		await this._proxy.$logout(this.id, sessionId);
		this.notificationService.info(nls.localize('signedOut', "Successfully signed out."));
	}

	dispose(): void {
		super.dispose();
		this._sessionMenuItems.forEach(item => item.forEach(d => d.dispose()));
		this._sessionMenuItems.clear();
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
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostAuthentication);
	}

	async $registerAuthenticationProvider(id: string, displayName: string): Promise<void> {
		const provider = new MainThreadAuthenticationProvider(this._proxy, id, displayName, this.notificationService, this.storageKeysSyncRegistryService);
		await provider.initialize();
		this.authenticationService.registerAuthenticationProvider(id, provider);
	}

	$unregisterAuthenticationProvider(id: string): void {
		this.authenticationService.unregisterAuthenticationProvider(id);
	}

	$onDidChangeSessions(id: string, event: modes.AuthenticationSessionsChangeEvent): void {
		this.authenticationService.sessionsUpdate(id, event);
	}

	async $getSessionsPrompt(providerId: string, accountName: string, providerName: string, extensionId: string, extensionName: string): Promise<boolean> {
		addAccountUsage(providerId, accountName, extensionName);

		const allowList = readAllowedExtensions(this.storageService, providerId, accountName);
		const extensionData = allowList.find(extension => extension.id === extensionId);
		if (extensionData) {
			return true;
		}

		const remoteConnection = this.remoteAgentService.getConnection();
		if (remoteConnection && remoteConnection.remoteAuthority && remoteConnection.remoteAuthority.startsWith('vsonline') && VSO_ALLOWED_EXTENSIONS.includes(extensionId)) {
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
