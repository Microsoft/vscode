/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IUserDataSyncService, IAuthenticationProvider, isAuthenticationProvider, IUserDataAutoSyncService, SyncResource, IResourcePreview, ISyncResourcePreview, Change, IManualSyncTask, IUserDataSyncStoreManagementService, UserDataSyncStoreType, SyncStatus } from 'vs/platform/userDataSync/common/userDataSync';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IUserDataSyncWorkbenchService, IUserDataSyncAccount, AccountStatus, CONTEXT_SYNC_ENABLEMENT, CONTEXT_SYNC_STATE, CONTEXT_ACCOUNT_STATE, SHOW_SYNC_LOG_COMMAND_ID, getSyncAreaLabel, IUserDataSyncPreview, IUserDataSyncResource, CONTEXT_ENABLE_SYNC_MERGES_VIEW, SYNC_MERGES_VIEW_ID, CONTEXT_ENABLE_ACTIVITY_VIEWS, SYNC_VIEW_CONTAINER_ID, SYNC_TITLE } from 'vs/workbench/services/userDataSync/common/userDataSync';
import { AuthenticationSession, AuthenticationSessionsChangeEvent } from 'vs/editor/common/modes';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';
import { flatten, equals } from 'vs/base/common/arrays';
import { getAuthenticationProviderActivationEvent, getCurrentAuthenticationSessionInfo, IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { IUserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { IQuickInputService, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { IStorageService, IWorkspaceStorageChangeEvent, StorageScope } from 'vs/platform/storage/common/storage';
import { ILogService } from 'vs/platform/log/common/log';
import { IProductService } from 'vs/platform/product/common/productService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { localize } from 'vs/nls';
import { canceled } from 'vs/base/common/errors';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { Action } from 'vs/base/common/actions';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';
import { isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { IViewsService, ViewContainerLocation, IViewDescriptorService } from 'vs/workbench/common/views';
import { isNative } from 'vs/base/common/platform';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';

type UserAccountClassification = {
	id: { classification: 'EndUserPseudonymizedInformation', purpose: 'BusinessInsight' };
};

type FirstTimeSyncClassification = {
	action: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

type UserAccountEvent = {
	id: string;
};

type FirstTimeSyncAction = 'pull' | 'push' | 'merge' | 'manual';

type AccountQuickPickItem = { label: string, authenticationProvider: IAuthenticationProvider, account?: UserDataSyncAccount, description?: string };

class UserDataSyncAccount implements IUserDataSyncAccount {

	constructor(readonly authenticationProviderId: string, private readonly session: AuthenticationSession) { }

	get sessionId(): string { return this.session.id; }
	get accountName(): string { return this.session.account.label; }
	get accountId(): string { return this.session.account.id; }
	get token(): string { return this.session.accessToken; }
}

export class UserDataSyncWorkbenchService extends Disposable implements IUserDataSyncWorkbenchService {

	_serviceBrand: any;

	private static DONOT_USE_WORKBENCH_SESSION_STORAGE_KEY = 'userDataSyncAccount.donotUseWorkbenchSession';
	private static CACHED_SESSION_STORAGE_KEY = 'userDataSyncAccountPreference';

	private _authenticationProviders: IAuthenticationProvider[] = [];
	get enabled() { return this._authenticationProviders.length > 0; }

	private availableAuthenticationProviders: IAuthenticationProvider[] = [];
	get authenticationProviders() { return this.availableAuthenticationProviders; }

	private _accountStatus: AccountStatus = AccountStatus.Uninitialized;
	get accountStatus(): AccountStatus { return this._accountStatus; }
	private readonly _onDidChangeAccountStatus = this._register(new Emitter<AccountStatus>());
	readonly onDidChangeAccountStatus = this._onDidChangeAccountStatus.event;

	private _all: Map<string, UserDataSyncAccount[]> = new Map<string, UserDataSyncAccount[]>();
	get all(): UserDataSyncAccount[] { return flatten([...this._all.values()]); }

	get current(): UserDataSyncAccount | undefined { return this.all.filter(account => this.isCurrentAccount(account))[0]; }

	private readonly syncEnablementContext: IContextKey<boolean>;
	private readonly syncStatusContext: IContextKey<string>;
	private readonly accountStatusContext: IContextKey<string>;
	private readonly mergesViewEnablementContext: IContextKey<boolean>;
	private readonly activityViewsEnablementContext: IContextKey<boolean>;

	readonly userDataSyncPreview: UserDataSyncPreview = this._register(new UserDataSyncPreview(this.userDataSyncService));

	constructor(
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IUserDataSyncAccountService private readonly userDataSyncAccountService: IUserDataSyncAccountService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IStorageService private readonly storageService: IStorageService,
		@IUserDataAutoSyncService private readonly userDataAutoSyncService: IUserDataAutoSyncService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ILogService private readonly logService: ILogService,
		@IProductService private readonly productService: IProductService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@INotificationService private readonly notificationService: INotificationService,
		@IProgressService private readonly progressService: IProgressService,
		@IDialogService private readonly dialogService: IDialogService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewsService private readonly viewsService: IViewsService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IUserDataSyncStoreManagementService private readonly userDataSyncStoreManagementService: IUserDataSyncStoreManagementService,
		@IHostService private readonly hostService: IHostService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
	) {
		super();
		this._authenticationProviders = this.userDataSyncStoreManagementService.userDataSyncStore?.authenticationProviders || [];
		this.syncEnablementContext = CONTEXT_SYNC_ENABLEMENT.bindTo(contextKeyService);
		this.syncStatusContext = CONTEXT_SYNC_STATE.bindTo(contextKeyService);
		this.accountStatusContext = CONTEXT_ACCOUNT_STATE.bindTo(contextKeyService);
		this.activityViewsEnablementContext = CONTEXT_ENABLE_ACTIVITY_VIEWS.bindTo(contextKeyService);
		this.mergesViewEnablementContext = CONTEXT_ENABLE_SYNC_MERGES_VIEW.bindTo(contextKeyService);

		if (this._authenticationProviders.length) {
			this.syncStatusContext.set(this.userDataSyncService.status);
			this._register(userDataSyncService.onDidChangeStatus(status => this.syncStatusContext.set(status)));
			this.syncEnablementContext.set(userDataAutoSyncService.isEnabled());
			this._register(userDataAutoSyncService.onDidChangeEnablement(enabled => this.syncEnablementContext.set(enabled)));

			this.waitAndInitialize();
		}
	}

	private isSupportedAuthenticationProviderId(authenticationProviderId: string): boolean {
		return this._authenticationProviders.some(({ id }) => id === authenticationProviderId);
	}

	private async waitAndInitialize(): Promise<void> {
		await this.extensionService.whenInstalledExtensionsRegistered();

		/* activate unregistered providers */
		const unregisteredProviders = this._authenticationProviders.filter(({ id }) => !this.authenticationService.isAuthenticationProviderRegistered(id));
		if (unregisteredProviders.length) {
			await Promise.all(unregisteredProviders.map(({ id }) => this.extensionService.activateByEvent(getAuthenticationProviderActivationEvent(id))));
		}

		/* wait until one of the providers is availabe */
		await Event.toPromise(Event.filter(this.authenticationService.onDidRegisterAuthenticationProvider, ({ id }) => this.isSupportedAuthenticationProviderId(id)));

		/* initialize */
		await this.initialize();
	}

	private async initialize(): Promise<void> {
		const authenticationSession = this.environmentService.options?.credentialsProvider ? await getCurrentAuthenticationSessionInfo(this.environmentService, this.productService) : undefined;
		if (this.currentSessionId === undefined && this.useWorkbenchSessionId && (authenticationSession?.id || this.environmentService.options?.authenticationSessionId)) {
			this.currentSessionId = authenticationSession?.id || this.environmentService.options?.authenticationSessionId;
			this.useWorkbenchSessionId = false;
		}

		await this.update();

		this._register(
			Event.any(
				Event.filter(
					Event.any(
						this.authenticationService.onDidRegisterAuthenticationProvider,
						this.authenticationService.onDidUnregisterAuthenticationProvider,
					), info => this.isSupportedAuthenticationProviderId(info.id)),
				Event.filter(this.userDataSyncAccountService.onTokenFailed, isSuccessive => !isSuccessive))
				(() => this.update()));

		this._register(Event.filter(this.authenticationService.onDidChangeSessions, e => this.isSupportedAuthenticationProviderId(e.providerId))(({ event }) => this.onDidChangeSessions(event)));
		this._register(this.storageService.onDidChangeStorage(e => this.onDidChangeStorage(e)));
		this._register(Event.filter(this.userDataSyncAccountService.onTokenFailed, isSuccessive => isSuccessive)(() => this.onDidSuccessiveAuthFailures()));
	}

	private async update(): Promise<void> {

		this.availableAuthenticationProviders = this._authenticationProviders.filter(({ id }) => this.authenticationService.isAuthenticationProviderRegistered(id));

		const allAccounts: Map<string, UserDataSyncAccount[]> = new Map<string, UserDataSyncAccount[]>();
		for (const { id } of this.availableAuthenticationProviders) {
			const accounts = await this.getAccounts(id);
			allAccounts.set(id, accounts);
		}

		this._all = allAccounts;
		const current = this.current;
		await this.updateToken(current);
		this.updateAccountStatus(current ? AccountStatus.Available : AccountStatus.Unavailable);
	}

	private async getAccounts(authenticationProviderId: string): Promise<UserDataSyncAccount[]> {
		let accounts: Map<string, UserDataSyncAccount> = new Map<string, UserDataSyncAccount>();
		let currentAccount: UserDataSyncAccount | null = null;

		const sessions = await this.authenticationService.getSessions(authenticationProviderId) || [];
		for (const session of sessions) {
			const account: UserDataSyncAccount = new UserDataSyncAccount(authenticationProviderId, session);
			accounts.set(account.accountName, account);
			if (this.isCurrentAccount(account)) {
				currentAccount = account;
			}
		}

		if (currentAccount) {
			// Always use current account if available
			accounts.set(currentAccount.accountName, currentAccount);
		}

		return [...accounts.values()];
	}

	private async updateToken(current: UserDataSyncAccount | undefined): Promise<void> {
		let value: { token: string, authenticationProviderId: string } | undefined = undefined;
		if (current) {
			try {
				this.logService.trace('Settings Sync: Updating the token for the account', current.accountName);
				const token = current.token;
				this.logService.trace('Settings Sync: Token updated for the account', current.accountName);
				value = { token, authenticationProviderId: current.authenticationProviderId };
			} catch (e) {
				this.logService.error(e);
			}
		}
		await this.userDataSyncAccountService.updateAccount(value);
	}

	private updateAccountStatus(accountStatus: AccountStatus): void {
		if (this._accountStatus !== accountStatus) {
			const previous = this._accountStatus;
			this.logService.debug('Sync account status changed', previous, accountStatus);

			this._accountStatus = accountStatus;
			this.accountStatusContext.set(accountStatus);
			this._onDidChangeAccountStatus.fire(accountStatus);
		}
	}

	async turnOn(): Promise<void> {
		if (this.userDataAutoSyncService.isEnabled()) {
			return;
		}
		if (this.userDataSyncService.status !== SyncStatus.Idle) {
			throw new Error('Cannont turn on sync while syncing');
		}

		const picked = await this.pick();
		if (!picked) {
			throw canceled();
		}

		// User did not pick an account or login failed
		if (this.accountStatus !== AccountStatus.Available) {
			throw new Error(localize('no account', "No account available"));
		}

		const syncTitle = SYNC_TITLE;
		const title = `${syncTitle} [(${localize('details', "details")})](command:${SHOW_SYNC_LOG_COMMAND_ID})`;
		const manualSyncTask = await this.userDataSyncService.createManualSyncTask();
		const disposable = this.lifecycleService.onBeforeShutdown(e => e.veto(this.onBeforeShutdown(manualSyncTask)));

		try {
			await this.syncBeforeTurningOn(title, manualSyncTask);
		} finally {
			disposable.dispose();
		}

		await this.userDataAutoSyncService.turnOn();
		this.notificationService.info(localize('sync turned on', "{0} is turned on", title));
	}

	turnoff(everywhere: boolean): Promise<void> {
		return this.userDataAutoSyncService.turnOff(everywhere);
	}

	private async onBeforeShutdown(manualSyncTask: IManualSyncTask): Promise<boolean> {
		const result = await this.dialogService.confirm({
			type: 'warning',
			message: localize('sync in progress', "Settings Sync is being turned on. Would you like to cancel it?"),
			title: localize('settings sync', "Settings Sync"),
			primaryButton: localize('yes', "Yes"),
			secondaryButton: localize('no', "No"),
		});
		if (result.confirmed) {
			await manualSyncTask.stop();
		}
		return !result.confirmed;
	}

	private async syncBeforeTurningOn(title: string, manualSyncTask: IManualSyncTask): Promise<void> {

		/* Make sure sync started on clean local state */
		await this.userDataSyncService.resetLocal();

		try {
			let action: FirstTimeSyncAction = 'manual';

			await this.progressService.withProgress({
				location: ProgressLocation.Notification,
				title,
				delay: 500,
			}, async progress => {
				progress.report({ message: localize('turning on', "Turning on...") });

				const preview = await manualSyncTask.preview();
				const hasRemoteData = manualSyncTask.manifest !== null;
				const hasLocalData = await this.userDataSyncService.hasLocalData();
				const hasMergesFromAnotherMachine = preview.some(([syncResource, { isLastSyncFromCurrentMachine, resourcePreviews }]) =>
					syncResource !== SyncResource.GlobalState && !isLastSyncFromCurrentMachine
					&& resourcePreviews.some(r => r.localChange !== Change.None || r.remoteChange !== Change.None));

				action = await this.getFirstTimeSyncAction(hasRemoteData, hasLocalData, hasMergesFromAnotherMachine);
				const progressDisposable = manualSyncTask.onSynchronizeResources(synchronizingResources =>
					synchronizingResources.length ? progress.report({ message: localize('syncing resource', "Syncing {0}...", getSyncAreaLabel(synchronizingResources[0][0])) }) : undefined);
				try {
					switch (action) {
						case 'merge':
							await manualSyncTask.merge();
							if (manualSyncTask.status !== SyncStatus.HasConflicts) {
								await manualSyncTask.apply();
							}
							return;
						case 'pull': return await manualSyncTask.pull();
						case 'push': return await manualSyncTask.push();
						case 'manual': return;
					}
				} finally {
					progressDisposable.dispose();
				}
			});
			if (manualSyncTask.status === SyncStatus.HasConflicts) {
				await this.dialogService.show(
					Severity.Warning,
					localize('conflicts detected', "Conflicts Detected"),
					[localize('merge Manually', "Merge Manually...")],
					{
						detail: localize('resolve', "Unable to merge due to conflicts. Please merge manually to continue..."),
					}
				);
				await manualSyncTask.discardConflicts();
				action = 'manual';
			}
			if (action === 'manual') {
				await this.syncManually(manualSyncTask);
			}
		} catch (error) {
			await manualSyncTask.stop();
			throw error;
		} finally {
			manualSyncTask.dispose();
		}
	}

	private async getFirstTimeSyncAction(hasRemoteData: boolean, hasLocalData: boolean, hasMergesFromAnotherMachine: boolean): Promise<FirstTimeSyncAction> {

		if (!hasLocalData /* no data on local */
			|| !hasRemoteData /* no data on remote */
			|| !hasMergesFromAnotherMachine /* no merges with another machine  */
		) {
			return 'merge';
		}

		const result = await this.dialogService.show(
			Severity.Info,
			localize('merge or replace', "Merge or Replace"),
			[
				localize('merge', "Merge"),
				localize('replace local', "Replace Local"),
				localize('merge Manually', "Merge Manually..."),
				localize('cancel', "Cancel"),
			],
			{
				cancelId: 3,
				detail: localize('first time sync detail', "It looks like you last synced from another machine.\nWould you like to merge or replace with your data in the cloud?"),
			}
		);
		switch (result.choice) {
			case 0:
				this.telemetryService.publicLog2<{ action: string }, FirstTimeSyncClassification>('sync/firstTimeSync', { action: 'merge' });
				return 'merge';
			case 1:
				this.telemetryService.publicLog2<{ action: string }, FirstTimeSyncClassification>('sync/firstTimeSync', { action: 'pull' });
				return 'pull';
			case 2:
				this.telemetryService.publicLog2<{ action: string }, FirstTimeSyncClassification>('sync/firstTimeSync', { action: 'manual' });
				return 'manual';
		}
		this.telemetryService.publicLog2<{ action: string }, FirstTimeSyncClassification>('sync/firstTimeSync', { action: 'cancelled' });
		throw canceled();
	}

	private async syncManually(task: IManualSyncTask): Promise<void> {
		const visibleViewContainer = this.viewsService.getVisibleViewContainer(ViewContainerLocation.Sidebar);
		const preview = await task.preview();
		this.userDataSyncPreview.setManualSyncPreview(task, preview);

		this.mergesViewEnablementContext.set(true);
		await this.waitForActiveSyncViews();
		await this.viewsService.openView(SYNC_MERGES_VIEW_ID);

		const error = await Event.toPromise(this.userDataSyncPreview.onDidCompleteManualSync);
		this.userDataSyncPreview.unsetManualSyncPreview();

		this.mergesViewEnablementContext.set(false);
		if (visibleViewContainer) {
			this.viewsService.openViewContainer(visibleViewContainer.id);
		} else {
			const viewContainer = this.viewDescriptorService.getViewContainerByViewId(SYNC_MERGES_VIEW_ID);
			this.viewsService.closeViewContainer(viewContainer!.id);
		}

		if (error) {
			throw error;
		}
	}

	async resetSyncedData(): Promise<void> {
		const result = await this.dialogService.confirm({
			message: localize('reset', "This will clear your data in the cloud and stop sync on all your devices."),
			title: localize('reset title', "Clear"),
			type: 'info',
			primaryButton: localize('reset button', "Reset"),
		});
		if (result.confirmed) {
			await this.userDataSyncService.resetRemote();
		}
	}

	async showSyncActivity(): Promise<void> {
		this.activityViewsEnablementContext.set(true);
		await this.waitForActiveSyncViews();
		await this.viewsService.openViewContainer(SYNC_VIEW_CONTAINER_ID);
	}

	async switchSyncService(type: UserDataSyncStoreType): Promise<void> {
		if (!this.userDataSyncStoreManagementService.userDataSyncStore
			|| !this.userDataSyncStoreManagementService.userDataSyncStore.insidersUrl
			|| !this.userDataSyncStoreManagementService.userDataSyncStore.stableUrl) {
			return;
		}
		await this.userDataSyncStoreManagementService.switch(type);
		const res = await this.dialogService.confirm({
			type: 'info',
			message: isNative ?
				localize('relaunchMessage', "Switching settings sync service requires a restart to take effect.") :
				localize('relaunchMessageWeb', "Switching settings sync service requires a reload to take effect."),
			detail: isNative ?
				localize('relaunchDetail', "Press the restart button to restart {0} and switch.", this.productService.nameLong) :
				localize('relaunchDetailWeb', "Press the reload button to reload {0} and switch.", this.productService.nameLong),
			primaryButton: isNative ?
				localize('restart', "&&Restart") :
				localize('restartWeb', "&&Reload"),
		});
		if (res.confirmed) {
			this.hostService.restart();
		}
	}

	private async waitForActiveSyncViews(): Promise<void> {
		const viewContainer = this.viewDescriptorService.getViewContainerById(SYNC_VIEW_CONTAINER_ID);
		if (viewContainer) {
			const model = this.viewDescriptorService.getViewContainerModel(viewContainer);
			if (!model.activeViewDescriptors.length) {
				await Event.toPromise(Event.filter(model.onDidChangeActiveViewDescriptors, e => model.activeViewDescriptors.length > 0));
			}
		}
	}

	private isCurrentAccount(account: UserDataSyncAccount): boolean {
		return account.sessionId === this.currentSessionId;
	}

	async signIn(): Promise<void> {
		await this.pick();
	}

	private async pick(): Promise<boolean> {
		const result = await this.doPick();
		if (!result) {
			return false;
		}
		let sessionId: string, accountName: string, accountId: string;
		if (isAuthenticationProvider(result)) {
			const session = await this.authenticationService.login(result.id, result.scopes);
			sessionId = session.id;
			accountName = session.account.label;
			accountId = session.account.id;
		} else {
			sessionId = result.sessionId;
			accountName = result.accountName;
			accountId = result.accountId;
		}
		await this.switch(sessionId, accountName, accountId);
		return true;
	}

	private async doPick(): Promise<UserDataSyncAccount | IAuthenticationProvider | undefined> {
		if (this.availableAuthenticationProviders.length === 0) {
			return undefined;
		}

		await this.update();

		// Single auth provider and no accounts available
		if (this.availableAuthenticationProviders.length === 1 && !this.all.length) {
			return this.availableAuthenticationProviders[0];
		}

		return new Promise<UserDataSyncAccount | IAuthenticationProvider | undefined>(async (c, e) => {
			let result: UserDataSyncAccount | IAuthenticationProvider | undefined;
			const disposables: DisposableStore = new DisposableStore();
			const quickPick = this.quickInputService.createQuickPick<AccountQuickPickItem>();
			disposables.add(quickPick);

			quickPick.title = SYNC_TITLE;
			quickPick.ok = false;
			quickPick.placeholder = localize('choose account placeholder', "Select an account");
			quickPick.ignoreFocusOut = true;
			quickPick.items = this.createQuickpickItems();

			disposables.add(quickPick.onDidAccept(() => {
				result = quickPick.selectedItems[0]?.account ? quickPick.selectedItems[0]?.account : quickPick.selectedItems[0]?.authenticationProvider;
				quickPick.hide();
			}));
			disposables.add(quickPick.onDidHide(() => {
				disposables.dispose();
				c(result);
			}));
			quickPick.show();
		});
	}

	private createQuickpickItems(): (AccountQuickPickItem | IQuickPickSeparator)[] {
		const quickPickItems: (AccountQuickPickItem | IQuickPickSeparator)[] = [];

		// Signed in Accounts
		if (this.all.length) {
			const authenticationProviders = [...this.availableAuthenticationProviders].sort(({ id }) => id === this.current?.authenticationProviderId ? -1 : 1);
			quickPickItems.push({ type: 'separator', label: localize('signed in', "Signed in") });
			for (const authenticationProvider of authenticationProviders) {
				const accounts = (this._all.get(authenticationProvider.id) || []).sort(({ sessionId }) => sessionId === this.current?.sessionId ? -1 : 1);
				const providerName = this.authenticationService.getLabel(authenticationProvider.id);
				for (const account of accounts) {
					quickPickItems.push({
						label: `${account.accountName} (${providerName})`,
						description: account.sessionId === this.current?.sessionId ? localize('last used', "Last Used with Sync") : undefined,
						account,
						authenticationProvider,
					});
				}
			}
			quickPickItems.push({ type: 'separator', label: localize('others', "Others") });
		}

		// Account proviers
		for (const authenticationProvider of this.availableAuthenticationProviders) {
			const signedInForProvider = this.all.some(account => account.authenticationProviderId === authenticationProvider.id);
			if (!signedInForProvider || this.authenticationService.supportsMultipleAccounts(authenticationProvider.id)) {
				const providerName = this.authenticationService.getLabel(authenticationProvider.id);
				quickPickItems.push({ label: localize('sign in using account', "Sign in with {0}", providerName), authenticationProvider });
			}
		}

		return quickPickItems;
	}

	private async switch(sessionId: string, accountName: string, accountId: string): Promise<void> {
		const currentAccount = this.current;
		if (this.userDataAutoSyncService.isEnabled() && (currentAccount && currentAccount.accountName !== accountName)) {
			// accounts are switched while sync is enabled.
		}
		this.currentSessionId = sessionId;
		this.telemetryService.publicLog2<UserAccountEvent, UserAccountClassification>('sync.userAccount', { id: accountId });
		await this.update();
	}

	private async onDidSuccessiveAuthFailures(): Promise<void> {
		this.telemetryService.publicLog2('sync/successiveAuthFailures');
		this.currentSessionId = undefined;
		await this.update();

		this.notificationService.notify({
			severity: Severity.Error,
			message: localize('successive auth failures', "Settings sync was turned off because of successive authorization failures. Please sign in again to continue synchronizing"),
			actions: {
				primary: [new Action('sign in', localize('sign in', "Sign in"), undefined, true, () => this.signIn())]
			}
		});
	}

	private onDidChangeSessions(e: AuthenticationSessionsChangeEvent): void {
		if (this.currentSessionId && e.removed.includes(this.currentSessionId)) {
			this.currentSessionId = undefined;
		}
		this.update();
	}

	private onDidChangeStorage(e: IWorkspaceStorageChangeEvent): void {
		if (e.key === UserDataSyncWorkbenchService.CACHED_SESSION_STORAGE_KEY && e.scope === StorageScope.GLOBAL
			&& this.currentSessionId !== this.getStoredCachedSessionId() /* This checks if current window changed the value or not */) {
			this._cachedCurrentSessionId = null;
			this.update();
		}
	}

	private _cachedCurrentSessionId: string | undefined | null = null;
	private get currentSessionId(): string | undefined {
		if (this._cachedCurrentSessionId === null) {
			this._cachedCurrentSessionId = this.getStoredCachedSessionId();
		}
		return this._cachedCurrentSessionId;
	}

	private set currentSessionId(cachedSessionId: string | undefined) {
		if (this._cachedCurrentSessionId !== cachedSessionId) {
			this._cachedCurrentSessionId = cachedSessionId;
			if (cachedSessionId === undefined) {
				this.storageService.remove(UserDataSyncWorkbenchService.CACHED_SESSION_STORAGE_KEY, StorageScope.GLOBAL);
			} else {
				this.storageService.store(UserDataSyncWorkbenchService.CACHED_SESSION_STORAGE_KEY, cachedSessionId, StorageScope.GLOBAL);
			}
		}
	}

	private getStoredCachedSessionId(): string | undefined {
		return this.storageService.get(UserDataSyncWorkbenchService.CACHED_SESSION_STORAGE_KEY, StorageScope.GLOBAL);
	}

	private get useWorkbenchSessionId(): boolean {
		return !this.storageService.getBoolean(UserDataSyncWorkbenchService.DONOT_USE_WORKBENCH_SESSION_STORAGE_KEY, StorageScope.GLOBAL, false);
	}

	private set useWorkbenchSessionId(useWorkbenchSession: boolean) {
		this.storageService.store(UserDataSyncWorkbenchService.DONOT_USE_WORKBENCH_SESSION_STORAGE_KEY, !useWorkbenchSession, StorageScope.GLOBAL);
	}

}

class UserDataSyncPreview extends Disposable implements IUserDataSyncPreview {

	private _resources: ReadonlyArray<IUserDataSyncResource> = [];
	get resources() { return Object.freeze(this._resources); }
	private _onDidChangeResources = this._register(new Emitter<ReadonlyArray<IUserDataSyncResource>>());
	readonly onDidChangeResources = this._onDidChangeResources.event;

	private _conflicts: ReadonlyArray<IUserDataSyncResource> = [];
	get conflicts() { return Object.freeze(this._conflicts); }
	private _onDidChangeConflicts = this._register(new Emitter<ReadonlyArray<IUserDataSyncResource>>());
	readonly onDidChangeConflicts = this._onDidChangeConflicts.event;

	private _onDidCompleteManualSync = this._register(new Emitter<Error | undefined>());
	readonly onDidCompleteManualSync = this._onDidCompleteManualSync.event;
	private manualSync: { preview: [SyncResource, ISyncResourcePreview][], task: IManualSyncTask, disposables: DisposableStore } | undefined;

	constructor(
		private readonly userDataSyncService: IUserDataSyncService
	) {
		super();
		this.updateConflicts(userDataSyncService.conflicts);
		this._register(userDataSyncService.onDidChangeConflicts(conflicts => this.updateConflicts(conflicts)));
	}

	setManualSyncPreview(task: IManualSyncTask, preview: [SyncResource, ISyncResourcePreview][]): void {
		const disposables = new DisposableStore();
		this.manualSync = { task, preview, disposables };
		this.updateResources();
	}

	unsetManualSyncPreview(): void {
		if (this.manualSync) {
			this.manualSync.disposables.dispose();
			this.manualSync = undefined;
		}
		this.updateResources();
	}

	async accept(syncResource: SyncResource, resource: URI, content?: string | null): Promise<void> {
		if (this.manualSync) {
			const syncPreview = await this.manualSync.task.accept(resource, content);
			this.updatePreview(syncPreview);
		} else {
			await this.userDataSyncService.accept(syncResource, resource, content, false);
		}
	}

	async merge(resource: URI): Promise<void> {
		if (!this.manualSync) {
			throw new Error('Can merge only while syncing manually');
		}
		const syncPreview = await this.manualSync.task.merge(resource);
		this.updatePreview(syncPreview);
	}

	async discard(resource: URI): Promise<void> {
		if (!this.manualSync) {
			throw new Error('Can discard only while syncing manually');
		}
		const syncPreview = await this.manualSync.task.discard(resource);
		this.updatePreview(syncPreview);
	}

	async apply(): Promise<void> {
		if (!this.manualSync) {
			throw new Error('Can apply only while syncing manually');
		}

		try {
			const syncPreview = await this.manualSync.task.apply();
			this.updatePreview(syncPreview);
			if (!this._resources.length) {
				this._onDidCompleteManualSync.fire(undefined);
			}
		} catch (error) {
			await this.manualSync.task.stop();
			this.updatePreview([]);
			this._onDidCompleteManualSync.fire(error);
		}
	}

	async cancel(): Promise<void> {
		if (!this.manualSync) {
			throw new Error('Can cancel only while syncing manually');
		}
		await this.manualSync.task.stop();
		this.updatePreview([]);
		this._onDidCompleteManualSync.fire(canceled());
	}

	async pull(): Promise<void> {
		if (!this.manualSync) {
			throw new Error('Can pull only while syncing manually');
		}
		await this.manualSync.task.pull();
		this.updatePreview([]);
	}

	async push(): Promise<void> {
		if (!this.manualSync) {
			throw new Error('Can push only while syncing manually');
		}
		await this.manualSync.task.push();
		this.updatePreview([]);
	}

	private updatePreview(preview: [SyncResource, ISyncResourcePreview][]) {
		if (this.manualSync) {
			this.manualSync.preview = preview;
			this.updateResources();
		}
	}

	private updateConflicts(conflicts: [SyncResource, IResourcePreview[]][]): void {
		const newConflicts = this.toUserDataSyncResourceGroups(conflicts);
		if (!equals(newConflicts, this._conflicts, (a, b) => isEqual(a.local, b.local))) {
			this._conflicts = newConflicts;
			this._onDidChangeConflicts.fire(this.conflicts);
		}
	}

	private updateResources(): void {
		const newResources = this.toUserDataSyncResourceGroups(
			(this.manualSync?.preview || [])
				.map(([syncResource, syncResourcePreview]) =>
					([
						syncResource,
						syncResourcePreview.resourcePreviews
					]))
		);
		if (!equals(newResources, this._resources, (a, b) => isEqual(a.local, b.local) && a.mergeState === b.mergeState)) {
			this._resources = newResources;
			this._onDidChangeResources.fire(this.resources);
		}
	}

	private toUserDataSyncResourceGroups(syncResourcePreviews: [SyncResource, IResourcePreview[]][]): IUserDataSyncResource[] {
		return flatten(
			syncResourcePreviews.map(([syncResource, resourcePreviews]) =>
				resourcePreviews.map<IUserDataSyncResource>(({ localResource, remoteResource, previewResource, acceptedResource, localChange, remoteChange, mergeState }) =>
					({ syncResource, local: localResource, remote: remoteResource, merged: previewResource, accepted: acceptedResource, localChange, remoteChange, mergeState })))
		);
	}

}

registerSingleton(IUserDataSyncWorkbenchService, UserDataSyncWorkbenchService);
