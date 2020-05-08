/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { canceled, isPromiseCanceledError } from 'vs/base/common/errors';
import { Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, dispose, MutableDisposable, toDisposable, IDisposable } from 'vs/base/common/lifecycle';
import { isEqual, basename } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import type { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { registerEditorContribution, ServicesAccessor } from 'vs/editor/browser/editorExtensions';
import type { IEditorContribution } from 'vs/editor/common/editorCommon';
import type { ITextModel } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ITextModelContentProvider, ITextModelService } from 'vs/editor/common/services/resolverService';
import { localize } from 'vs/nls';
import { MenuId, MenuRegistry, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import {
	CONTEXT_SYNC_STATE, IUserDataAutoSyncService, IUserDataSyncService, registerConfiguration,
	SyncResource, SyncStatus, UserDataSyncError, UserDataSyncErrorCode, USER_DATA_SYNC_SCHEME, IUserDataSyncEnablementService, CONTEXT_SYNC_ENABLEMENT,
	SyncResourceConflicts, Conflict, getSyncResourceFromLocalPreview
} from 'vs/platform/userDataSync/common/userDataSync';
import { FloatingClickWidget } from 'vs/workbench/browser/parts/editor/editorWidgets';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IEditorInput, toResource, SideBySideEditor } from 'vs/workbench/common/editor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import * as Constants from 'vs/workbench/contrib/logs/common/logConstants';
import { IOutputService } from 'vs/workbench/contrib/output/common/output';
import { IActivityService, IBadge, NumberBadge, ProgressBadge } from 'vs/workbench/services/activity/common/activity';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { IAuthenticationTokenService } from 'vs/platform/authentication/common/authentication';
import { fromNow } from 'vs/base/common/date';
import { IProductService } from 'vs/platform/product/common/productService';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { UserDataSyncAccounts, AccountStatus } from 'vs/workbench/contrib/userDataSync/browser/userDataSyncAccount';

const CONTEXT_CONFLICTS_SOURCES = new RawContextKey<string>('conflictsSources', '');

type ConfigureSyncQuickPickItem = { id: SyncResource, label: string, description?: string };

function getSyncAreaLabel(source: SyncResource): string {
	switch (source) {
		case SyncResource.Settings: return localize('settings', "Settings");
		case SyncResource.Keybindings: return localize('keybindings', "Keyboard Shortcuts");
		case SyncResource.Snippets: return localize('snippets', "User Snippets");
		case SyncResource.Extensions: return localize('extensions', "Extensions");
		case SyncResource.GlobalState: return localize('ui state label', "UI State");
	}
}

type SyncConflictsClassification = {
	source: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	action?: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

type FirstTimeSyncClassification = {
	action: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

const turnOnSyncCommand = { id: 'workbench.userData.actions.syncStart', title: localize('turn on sync with category', "Preferences Sync: Turn On...") };
const stopSyncCommand = { id: 'workbench.userData.actions.stopSync', title: localize('stop sync', "Preferences Sync: Turn Off") };
const resolveSettingsConflictsCommand = { id: 'workbench.userData.actions.resolveSettingsConflicts', title: localize('showConflicts', "Preferences Sync: Show Settings Conflicts") };
const resolveKeybindingsConflictsCommand = { id: 'workbench.userData.actions.resolveKeybindingsConflicts', title: localize('showKeybindingsConflicts', "Preferences Sync: Show Keybindings Conflicts") };
const resolveSnippetsConflictsCommand = { id: 'workbench.userData.actions.resolveSnippetsConflicts', title: localize('showSnippetsConflicts', "Preferences Sync: Show User Snippets Conflicts") };
const configureSyncCommand = { id: 'workbench.userData.actions.configureSync', title: localize('configure sync', "Preferences Sync: Configure...") };
const showSyncActivityCommand = { id: 'workbench.userData.actions.showSyncActivity', title: localize('show sync log', "Preferences Sync: Show Log") };
const syncNowCommand = {
	id: 'workbench.userData.actions.syncNow',
	title: localize('sync now', "Preferences Sync: Sync Now"),
	description(userDataSyncService: IUserDataSyncService): string | undefined {
		if (userDataSyncService.status === SyncStatus.Syncing) {
			return localize('sync is on with syncing', "syncing");
		}
		if (userDataSyncService.lastSyncTime) {
			return localize('sync is on with time', "synced {0}", fromNow(userDataSyncService.lastSyncTime, true));
		}
		return undefined;
	}
};
const showSyncSettingsCommand = { id: 'workbench.userData.actions.syncSettings', title: localize('sync settings', "Preferences Sync: Show Settings"), };

const CONTEXT_TURNING_ON_STATE = new RawContextKey<false>('userDataSyncTurningOn', false);
export const CONTEXT_ACCOUNT_STATE = new RawContextKey<string>('userDataSyncAccountStatus', AccountStatus.Uninitialized);

export class UserDataSyncWorkbenchContribution extends Disposable implements IWorkbenchContribution {

	private readonly turningOnSyncContext: IContextKey<boolean>;
	private readonly syncEnablementContext: IContextKey<boolean>;
	private readonly syncStatusContext: IContextKey<string>;
	private readonly accountStatusContext: IContextKey<string>;
	private readonly conflictsSources: IContextKey<string>;

	private readonly userDataSyncAccounts: UserDataSyncAccounts;
	private readonly badgeDisposable = this._register(new MutableDisposable());

	constructor(
		@IUserDataSyncEnablementService private readonly userDataSyncEnablementService: IUserDataSyncEnablementService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IActivityService private readonly activityService: IActivityService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOutputService private readonly outputService: IOutputService,
		@IAuthenticationTokenService readonly authTokenService: IAuthenticationTokenService,
		@IUserDataAutoSyncService userDataAutoSyncService: IUserDataAutoSyncService,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IProductService private readonly productService: IProductService,
		@IStorageService private readonly storageService: IStorageService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
	) {
		super();

		this.turningOnSyncContext = CONTEXT_TURNING_ON_STATE.bindTo(contextKeyService);
		this.syncEnablementContext = CONTEXT_SYNC_ENABLEMENT.bindTo(contextKeyService);
		this.syncStatusContext = CONTEXT_SYNC_STATE.bindTo(contextKeyService);
		this.accountStatusContext = CONTEXT_ACCOUNT_STATE.bindTo(contextKeyService);
		this.conflictsSources = CONTEXT_CONFLICTS_SOURCES.bindTo(contextKeyService);

		this.userDataSyncAccounts = instantiationService.createInstance(UserDataSyncAccounts);

		if (this.userDataSyncAccounts.authenticationProviders.length) {
			registerConfiguration();

			this.onDidChangeSyncStatus(this.userDataSyncService.status);
			this.onDidChangeConflicts(this.userDataSyncService.conflicts);
			this.onDidChangeEnablement(this.userDataSyncEnablementService.isEnabled());
			this.onDidChangeAccountStatus(this.userDataSyncAccounts.status);

			this._register(Event.debounce(userDataSyncService.onDidChangeStatus, () => undefined, 500)(() => this.onDidChangeSyncStatus(this.userDataSyncService.status)));
			this._register(userDataSyncService.onDidChangeConflicts(() => this.onDidChangeConflicts(this.userDataSyncService.conflicts)));
			this._register(userDataSyncService.onSyncErrors(errors => this.onSyncErrors(errors)));
			this._register(this.userDataSyncEnablementService.onDidChangeEnablement(enabled => this.onDidChangeEnablement(enabled)));
			this._register(userDataAutoSyncService.onError(error => this.onAutoSyncError(error)));
			this._register(this.userDataSyncAccounts.onDidChangeStatus(status => this.onDidChangeAccountStatus(status)));
			this._register(this.userDataSyncAccounts.onDidSignOut(() => this.doTurnOff(false)));
			this.registerActions();

			textModelResolverService.registerTextModelContentProvider(USER_DATA_SYNC_SCHEME, instantiationService.createInstance(UserDataRemoteContentProvider));
			registerEditorContribution(AcceptChangesContribution.ID, AcceptChangesContribution);
		}
	}

	private onDidChangeAccountStatus(status: AccountStatus): void {
		this.accountStatusContext.set(status);
		this.updateBadge();
	}

	private onDidChangeSyncStatus(status: SyncStatus) {
		this.syncStatusContext.set(status);
		this.updateBadge();
	}

	private readonly conflictsDisposables = new Map<SyncResource, IDisposable>();
	private onDidChangeConflicts(conflicts: SyncResourceConflicts[]) {
		this.updateBadge();
		if (conflicts.length) {
			const conflictsSources: SyncResource[] = conflicts.map(conflict => conflict.syncResource);
			this.conflictsSources.set(conflictsSources.join(','));
			if (conflictsSources.indexOf(SyncResource.Snippets) !== -1) {
				this.registerShowSnippetsConflictsAction();
			}

			// Clear and dispose conflicts those were cleared
			this.conflictsDisposables.forEach((disposable, conflictsSource) => {
				if (conflictsSources.indexOf(conflictsSource) === -1) {
					disposable.dispose();
					this.conflictsDisposables.delete(conflictsSource);
				}
			});

			for (const { syncResource, conflicts } of this.userDataSyncService.conflicts) {
				const conflictsEditorInputs = this.getConflictsEditorInputs(syncResource);

				// close stale conflicts editor previews
				if (conflictsEditorInputs.length) {
					conflictsEditorInputs.forEach(input => {
						if (!conflicts.some(({ local }) => isEqual(local, input.master.resource))) {
							input.dispose();
						}
					});
				}

				// Show conflicts notification if not shown before
				else if (!this.conflictsDisposables.has(syncResource)) {
					const conflictsArea = getSyncAreaLabel(syncResource);
					const handle = this.notificationService.prompt(Severity.Warning, localize('conflicts detected', "Unable to sync due to conflicts in {0}. Please resolve them to continue.", conflictsArea.toLowerCase()),
						[
							{
								label: localize('accept remote', "Accept Remote"),
								run: () => {
									this.telemetryService.publicLog2<{ source: string, action: string }, SyncConflictsClassification>('sync/handleConflicts', { source: syncResource, action: 'acceptRemote' });
									this.acceptRemote(syncResource, conflicts);
								}
							},
							{
								label: localize('accept local', "Accept Local"),
								run: () => {
									this.telemetryService.publicLog2<{ source: string, action: string }, SyncConflictsClassification>('sync/handleConflicts', { source: syncResource, action: 'acceptLocal' });
									this.acceptLocal(syncResource, conflicts);
								}
							},
							{
								label: localize('show conflicts', "Show Conflicts"),
								run: () => {
									this.telemetryService.publicLog2<{ source: string, action?: string }, SyncConflictsClassification>('sync/showConflicts', { source: syncResource });
									this.handleConflicts({ syncResource, conflicts });
								}
							}
						],
						{
							sticky: true
						}
					);
					this.conflictsDisposables.set(syncResource, toDisposable(() => {

						// close the conflicts warning notification
						handle.close();

						// close opened conflicts editor previews
						const conflictsEditorInputs = this.getConflictsEditorInputs(syncResource);
						if (conflictsEditorInputs.length) {
							conflictsEditorInputs.forEach(input => input.dispose());
						}

						this.conflictsDisposables.delete(syncResource);
					}));
				}
			}
		} else {
			this.conflictsSources.reset();
			this.getAllConflictsEditorInputs().forEach(input => input.dispose());
			this.conflictsDisposables.forEach(disposable => disposable.dispose());
			this.conflictsDisposables.clear();
		}
	}

	private async acceptRemote(syncResource: SyncResource, conflicts: Conflict[]) {
		try {
			for (const conflict of conflicts) {
				const modelRef = await this.textModelResolverService.createModelReference(conflict.remote);
				await this.userDataSyncService.acceptConflict(conflict.remote, modelRef.object.textEditorModel.getValue());
				modelRef.dispose();
			}
		} catch (e) {
			this.notificationService.error(e);
		}
	}

	private async acceptLocal(syncResource: SyncResource, conflicts: Conflict[]): Promise<void> {
		try {
			for (const conflict of conflicts) {
				const modelRef = await this.textModelResolverService.createModelReference(conflict.local);
				await this.userDataSyncService.acceptConflict(conflict.local, modelRef.object.textEditorModel.getValue());
				modelRef.dispose();
			}
		} catch (e) {
			this.notificationService.error(e);
		}
	}

	private onDidChangeEnablement(enabled: boolean) {
		this.syncEnablementContext.set(enabled);
		this.updateBadge();
	}

	private onAutoSyncError(error: UserDataSyncError): void {
		switch (error.code) {
			case UserDataSyncErrorCode.TurnedOff:
			case UserDataSyncErrorCode.SessionExpired:
				this.notificationService.notify({
					severity: Severity.Info,
					message: localize('turned off', "Preferences sync was turned off from another device."),
					actions: {
						primary: [new Action('turn on sync', localize('turn on sync', "Turn on Preferences Sync..."), undefined, true, () => this.turnOn())]
					}
				});
				return;
			case UserDataSyncErrorCode.TooLarge:
				if (error.resource === SyncResource.Keybindings || error.resource === SyncResource.Settings) {
					this.disableSync(error.resource);
					const sourceArea = getSyncAreaLabel(error.resource);
					this.notificationService.notify({
						severity: Severity.Error,
						message: localize('too large', "Disabled syncing {0} because size of the {1} file to sync is larger than {2}. Please open the file and reduce the size and enable sync", sourceArea.toLowerCase(), sourceArea.toLowerCase(), '100kb'),
						actions: {
							primary: [new Action('open sync file', localize('open file', "Open {0} File", sourceArea), undefined, true,
								() => error.resource === SyncResource.Settings ? this.preferencesService.openGlobalSettings(true) : this.preferencesService.openGlobalKeybindingSettings(true))]
						}
					});
				}
				return;
			case UserDataSyncErrorCode.Incompatible:
				this.disableSync();
				this.notificationService.notify({
					severity: Severity.Error,
					message: localize('error incompatible', "Turned off sync because local data is incompatible with the data in the cloud. Please update {0} and turn on sync to continue syncing.", this.productService.nameLong),
				});
				return;
		}
	}

	private readonly invalidContentErrorDisposables = new Map<SyncResource, IDisposable>();
	private onSyncErrors(errors: [SyncResource, UserDataSyncError][]): void {
		if (errors.length) {
			for (const [source, error] of errors) {
				switch (error.code) {
					case UserDataSyncErrorCode.LocalInvalidContent:
						this.handleInvalidContentError(source);
						break;
					default:
						const disposable = this.invalidContentErrorDisposables.get(source);
						if (disposable) {
							disposable.dispose();
							this.invalidContentErrorDisposables.delete(source);
						}
				}
			}
		} else {
			this.invalidContentErrorDisposables.forEach(disposable => disposable.dispose());
			this.invalidContentErrorDisposables.clear();
		}
	}

	private handleInvalidContentError(source: SyncResource): void {
		if (this.invalidContentErrorDisposables.has(source)) {
			return;
		}
		if (source !== SyncResource.Settings && source !== SyncResource.Keybindings) {
			return;
		}
		const resource = source === SyncResource.Settings ? this.workbenchEnvironmentService.settingsResource : this.workbenchEnvironmentService.keybindingsResource;
		if (isEqual(resource, toResource(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.MASTER }))) {
			// Do not show notification if the file in error is active
			return;
		}
		const errorArea = getSyncAreaLabel(source);
		const handle = this.notificationService.notify({
			severity: Severity.Error,
			message: localize('errorInvalidConfiguration', "Unable to sync {0} because there are some errors/warnings in the file. Please open the file to correct errors/warnings in it.", errorArea.toLowerCase()),
			actions: {
				primary: [new Action('open sync file', localize('open file', "Open {0} File", errorArea), undefined, true,
					() => source === SyncResource.Settings ? this.preferencesService.openGlobalSettings(true) : this.preferencesService.openGlobalKeybindingSettings(true))]
			}
		});
		this.invalidContentErrorDisposables.set(source, toDisposable(() => {
			// close the error warning notification
			handle.close();
			this.invalidContentErrorDisposables.delete(source);
		}));
	}

	private async updateBadge(): Promise<void> {
		this.badgeDisposable.clear();

		let badge: IBadge | undefined = undefined;
		let clazz: string | undefined;
		let priority: number | undefined = undefined;

		if (this.userDataSyncService.status !== SyncStatus.Uninitialized && this.userDataSyncEnablementService.isEnabled() && this.userDataSyncAccounts.status === AccountStatus.Unavailable) {
			badge = new NumberBadge(1, () => localize('sign in to sync preferences', "Sign in to Sync Preferences"));
		} else if (this.userDataSyncService.conflicts.length) {
			badge = new NumberBadge(this.userDataSyncService.conflicts.reduce((result, syncResourceConflict) => { return result + syncResourceConflict.conflicts.length; }, 0), () => localize('has conflicts', "Preferences Sync: Conflicts Detected"));
		} else if (this.turningOnSync) {
			badge = new ProgressBadge(() => localize('turning on syncing', "Turning on Preferences Sync..."));
			clazz = 'progress-badge';
			priority = 1;
		}

		if (badge) {
			this.badgeDisposable.value = this.activityService.showGlobalActivity({ badge, clazz, priority });
		}
	}

	private get turningOnSync(): boolean {
		return !!this.turningOnSyncContext.get();
	}

	private set turningOnSync(turningOn: boolean) {
		this.turningOnSyncContext.set(turningOn);
		this.updateBadge();
	}

	private async turnOn(): Promise<void> {
		this.turningOnSync = true;
		try {
			if (!this.storageService.getBoolean('sync.donotAskPreviewConfirmation', StorageScope.GLOBAL, false)) {
				if (!await this.askForConfirmation()) {
					return;
				}
			}
			const turnOn = await this.askToConfigure();
			if (!turnOn) {
				return;
			}
			await this.doTurnOn();
			this.storageService.store('sync.donotAskPreviewConfirmation', true, StorageScope.GLOBAL);
		} finally {
			this.turningOnSync = false;
		}
	}

	private async askForConfirmation(): Promise<boolean> {
		const result = await this.dialogService.show(
			Severity.Info,
			localize('sync preview message', "Synchronizing your preferences is a preview feature, please read the documentation before turning it on."),
			[
				localize('open doc', "Open Documentation"),
				localize('turn on', "Turn On"),
				localize('cancel', "Cancel"),
			],
			{
				cancelId: 2
			}
		);
		switch (result.choice) {
			case 0: this.openerService.open(URI.parse('https://aka.ms/vscode-settings-sync-help')); return false;
			case 2: return false;
		}
		return true;
	}

	private async askToConfigure(): Promise<boolean> {
		return new Promise<boolean>((c, e) => {
			const disposables: DisposableStore = new DisposableStore();
			const quickPick = this.quickInputService.createQuickPick<ConfigureSyncQuickPickItem>();
			disposables.add(quickPick);
			quickPick.title = localize('Preferences Sync Title', "Preferences Sync");
			quickPick.ok = false;
			quickPick.customButton = true;
			if (this.userDataSyncAccounts.all.length) {
				quickPick.customLabel = localize('turn on', "Turn On");
			} else {
				const orTerm = localize({ key: 'or', comment: ['Here is the context where it is used - Sign in with your A or B or C account to synchronize your data across devices.'] }, "or");
				const displayName = this.userDataSyncAccounts.authenticationProviders.length === 1
					? this.authenticationService.getDisplayName(this.userDataSyncAccounts.authenticationProviders[0].id)
					: this.userDataSyncAccounts.authenticationProviders.map(({ id }) => this.authenticationService.getDisplayName(id)).join(` ${orTerm} `);
				quickPick.description = localize('sign in and turn on sync detail', "Sign in with your {0} account to synchronize your data across devices.", displayName);
				quickPick.customLabel = localize('sign in and turn on sync', "Sign in & Turn on");
			}
			quickPick.placeholder = localize('configure sync placeholder', "Choose what to sync");
			quickPick.canSelectMany = true;
			quickPick.ignoreFocusOut = true;
			const items = this.getConfigureSyncQuickPickItems();
			quickPick.items = items;
			quickPick.selectedItems = items.filter(item => this.userDataSyncEnablementService.isResourceEnabled(item.id));
			let accepted: boolean = false;
			disposables.add(Event.any(quickPick.onDidAccept, quickPick.onDidCustom)(() => {
				accepted = true;
				quickPick.hide();
			}));
			disposables.add(quickPick.onDidHide(() => {
				try {
					if (accepted) {
						this.updateConfiguration(items, quickPick.selectedItems);
					}
					c(accepted);
				} catch (error) {
					e(error);
				} finally {
					disposables.dispose();
				}
			}));
			quickPick.show();
		});
	}

	private async doTurnOn(): Promise<void> {
		const picked = await this.userDataSyncAccounts.pick();
		if (!picked) {
			throw canceled();
		}

		// User did not pick an account or login failed
		if (this.userDataSyncAccounts.status !== AccountStatus.Available) {
			throw new Error(localize('no account', "No account available"));
		}

		await this.handleFirstTimeSync();
		this.userDataSyncEnablementService.setEnablement(true);
		this.notificationService.info(localize('sync turned on', "Preferences sync is turned on"));
	}

	private getConfigureSyncQuickPickItems(): ConfigureSyncQuickPickItem[] {
		return [{
			id: SyncResource.Settings,
			label: getSyncAreaLabel(SyncResource.Settings)
		}, {
			id: SyncResource.Keybindings,
			label: getSyncAreaLabel(SyncResource.Keybindings)
		}, {
			id: SyncResource.Snippets,
			label: getSyncAreaLabel(SyncResource.Snippets)
		}, {
			id: SyncResource.Extensions,
			label: getSyncAreaLabel(SyncResource.Extensions)
		}, {
			id: SyncResource.GlobalState,
			label: getSyncAreaLabel(SyncResource.GlobalState),
		}];
	}

	private updateConfiguration(items: ConfigureSyncQuickPickItem[], selectedItems: ReadonlyArray<ConfigureSyncQuickPickItem>): void {
		for (const item of items) {
			const wasEnabled = this.userDataSyncEnablementService.isResourceEnabled(item.id);
			const isEnabled = !!selectedItems.filter(selected => selected.id === item.id)[0];
			if (wasEnabled !== isEnabled) {
				this.userDataSyncEnablementService.setResourceEnablement(item.id!, isEnabled);
			}
		}
	}

	private async configureSyncOptions(): Promise<void> {
		return new Promise((c, e) => {
			const disposables: DisposableStore = new DisposableStore();
			const quickPick = this.quickInputService.createQuickPick<ConfigureSyncQuickPickItem>();
			disposables.add(quickPick);
			quickPick.title = localize('configure sync', "Preferences Sync: Configure...");
			quickPick.placeholder = localize('configure sync placeholder', "Choose what to sync");
			quickPick.canSelectMany = true;
			quickPick.ignoreFocusOut = true;
			quickPick.ok = true;
			const items = this.getConfigureSyncQuickPickItems();
			quickPick.items = items;
			quickPick.selectedItems = items.filter(item => this.userDataSyncEnablementService.isResourceEnabled(item.id));
			disposables.add(quickPick.onDidAccept(async () => {
				if (quickPick.selectedItems.length) {
					this.updateConfiguration(items, quickPick.selectedItems);
					quickPick.hide();
				}
			}));
			disposables.add(quickPick.onDidHide(() => {
				disposables.dispose();
				c();
			}));
			quickPick.show();
		});
	}

	private async handleFirstTimeSync(): Promise<void> {
		const isFirstSyncWithMerge = await this.userDataSyncService.isFirstTimeSyncWithMerge();
		if (!isFirstSyncWithMerge) {
			return;
		}
		const result = await this.dialogService.show(
			Severity.Info,
			localize('firs time sync', "Sync"),
			[
				localize('merge', "Merge"),
				localize('cancel', "Cancel"),
				localize('replace', "Replace Local"),
			],
			{
				cancelId: 1,
				detail: localize('first time sync detail', "It looks like this is the first time sync is set up.\nWould you like to merge or replace with the data from the cloud?"),
			}
		);
		switch (result.choice) {
			case 0:
				this.telemetryService.publicLog2<{ action: string }, FirstTimeSyncClassification>('sync/firstTimeSync', { action: 'merge' });
				break;
			case 1:
				this.telemetryService.publicLog2<{ action: string }, FirstTimeSyncClassification>('sync/firstTimeSync', { action: 'cancelled' });
				throw canceled();
			case 2:
				this.telemetryService.publicLog2<{ action: string }, FirstTimeSyncClassification>('sync/firstTimeSync', { action: 'replace-local' });
				await this.userDataSyncService.pull();
				break;
		}
	}

	private async turnOff(): Promise<void> {
		const result = await this.dialogService.confirm({
			type: 'info',
			message: localize('turn off sync confirmation', "Do you want to turn off sync?"),
			detail: localize('turn off sync detail', "Your settings, keybindings, extensions and UI State will no longer be synced."),
			primaryButton: localize('turn off', "Turn Off"),
			checkbox: {
				label: localize('turn off sync everywhere', "Turn off sync on all your devices and clear the data from the cloud.")
			}
		});
		if (result.confirmed) {
			return this.doTurnOff(!!result.checkboxChecked);
		}
	}

	private async doTurnOff(turnOffEveryWhere: boolean): Promise<void> {
		if (!this.userDataSyncEnablementService.isEnabled()) {
			return;
		}
		if (!this.userDataSyncEnablementService.canToggleEnablement()) {
			return;
		}
		if (turnOffEveryWhere) {
			this.telemetryService.publicLog2('sync/turnOffEveryWhere');
			await this.userDataSyncService.reset();
		} else {
			await this.userDataSyncService.resetLocal();
		}
		this.disableSync();
	}

	private disableSync(source?: SyncResource): void {
		if (source === undefined) {
			this.userDataSyncEnablementService.setEnablement(false);
		} else {
			switch (source) {
				case SyncResource.Settings: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.Settings, false);
				case SyncResource.Keybindings: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.Keybindings, false);
				case SyncResource.Snippets: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.Snippets, false);
				case SyncResource.Extensions: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.Extensions, false);
				case SyncResource.GlobalState: return this.userDataSyncEnablementService.setResourceEnablement(SyncResource.GlobalState, false);
			}
		}
	}

	private getConflictsEditorInputs(syncResource: SyncResource): DiffEditorInput[] {
		return this.editorService.editors.filter(input => {
			const resource = input instanceof DiffEditorInput ? input.master.resource : input.resource;
			return resource && getSyncResourceFromLocalPreview(resource!, this.workbenchEnvironmentService) === syncResource;
		}) as DiffEditorInput[];
	}

	private getAllConflictsEditorInputs(): IEditorInput[] {
		return this.editorService.editors.filter(input => {
			const resource = input instanceof DiffEditorInput ? input.master.resource : input.resource;
			return resource && getSyncResourceFromLocalPreview(resource!, this.workbenchEnvironmentService) !== undefined;
		});
	}

	private async handleSyncResourceConflicts(resource: SyncResource): Promise<void> {
		const syncResourceCoflicts = this.userDataSyncService.conflicts.filter(({ syncResource }) => syncResource === resource)[0];
		if (syncResourceCoflicts) {
			this.handleConflicts(syncResourceCoflicts);
		}
	}

	private async handleConflicts({ syncResource, conflicts }: SyncResourceConflicts): Promise<void> {
		for (const conflict of conflicts) {
			let label: string | undefined = undefined;
			if (syncResource === SyncResource.Settings) {
				label = localize('settings conflicts preview', "Settings Conflicts (Remote ↔ Local)");
			} else if (syncResource === SyncResource.Keybindings) {
				label = localize('keybindings conflicts preview', "Keybindings Conflicts (Remote ↔ Local)");
			} else if (syncResource === SyncResource.Snippets) {
				label = localize('snippets conflicts preview', "User Snippet Conflicts (Remote ↔ Local) - {0}", basename(conflict.local));
			}
			await this.editorService.openEditor({
				leftResource: conflict.remote,
				rightResource: conflict.local,
				label,
				options: {
					preserveFocus: false,
					pinned: true,
					revealIfVisible: true,
				},
			});
		}
	}

	private showSyncActivity(): Promise<void> {
		return this.outputService.showChannel(Constants.userDataSyncLogChannelId);
	}

	private registerActions(): void {
		if (this.userDataSyncEnablementService.canToggleEnablement()) {
			this.registerTurnOnSyncAction();
			this.registerTurnOffSyncAction();
		}
		this.registerTurninOnSyncAction();
		this.registerSignInAction(); // When Sync is turned on from CLI
		this.registerShowSettingsConflictsAction();
		this.registerShowKeybindingsConflictsAction();
		this.registerShowSnippetsConflictsAction();
		this.registerSyncStatusAction();

		this.registerConfigureSyncAction();
		this.registerShowActivityAction();
		this.registerShowSettingsAction();
	}

	private registerTurnOnSyncAction(): void {
		const turnOnSyncWhenContext = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT.toNegated(), CONTEXT_ACCOUNT_STATE.notEqualsTo(AccountStatus.Uninitialized), CONTEXT_TURNING_ON_STATE.negate());
		CommandsRegistry.registerCommand(turnOnSyncCommand.id, async () => {
			try {
				await this.turnOn();
			} catch (e) {
				if (!isPromiseCanceledError(e)) {
					this.notificationService.error(localize('turn on failed', "Error while starting Sync: {0}", toErrorMessage(e)));
				}
			}
		});
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_sync',
			command: {
				id: turnOnSyncCommand.id,
				title: localize('global activity turn on sync', "Turn on Preferences Sync...")
			},
			when: turnOnSyncWhenContext,
			order: 1
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: turnOnSyncCommand,
			when: turnOnSyncWhenContext,
		});
		MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '5_sync',
			command: {
				id: turnOnSyncCommand.id,
				title: localize('global activity turn on sync', "Turn on Preferences Sync...")
			},
			when: turnOnSyncWhenContext,
		});
		MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			group: '1_sync',
			command: {
				id: turnOnSyncCommand.id,
				title: localize('global activity turn on sync', "Turn on Preferences Sync...")
			},
			when: turnOnSyncWhenContext
		});
	}

	private registerTurninOnSyncAction(): void {
		const when = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT.toNegated(), CONTEXT_ACCOUNT_STATE.notEqualsTo(AccountStatus.Uninitialized), CONTEXT_TURNING_ON_STATE);
		this._register(registerAction2(class TurningOnSyncAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.userData.actions.turningOn',
					title: localize('turnin on sync', "Turning on Preferences Sync..."),
					precondition: ContextKeyExpr.false(),
					menu: [{
						group: '5_sync',
						id: MenuId.GlobalActivity,
						when,
						order: 2
					}, {
						group: '1_sync',
						id: MenuId.AccountsContext,
						when,
					}]
				});
			}
			async run(): Promise<any> { }
		}));
	}

	private registerSignInAction(): void {
		const that = this;
		const id = 'workbench.userData.actions.signin';
		const when = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT, CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Unavailable));
		this._register(registerAction2(class StopSyncAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.userData.actions.signin',
					title: localize('sign in global', "Sign in to Sync Preferences(1)"),
					menu: {
						group: '5_sync',
						id: MenuId.GlobalActivity,
						when,
						order: 2
					}
				});
			}
			async run(): Promise<any> {
				try {
					await that.userDataSyncAccounts.pick();
				} catch (e) {
					that.notificationService.error(e);
				}
			}
		}));
		this._register(MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			group: '1_sync',
			command: {
				id,
				title: localize('sign in accounts', "Sign in to Sync Preferences"),
			},
			when
		}));
	}

	private registerShowSettingsConflictsAction(): void {
		const resolveSettingsConflictsWhenContext = ContextKeyExpr.regex(CONTEXT_CONFLICTS_SOURCES.keys()[0], /.*settings.*/i);
		CommandsRegistry.registerCommand(resolveSettingsConflictsCommand.id, () => this.handleSyncResourceConflicts(SyncResource.Settings));
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_sync',
			command: {
				id: resolveSettingsConflictsCommand.id,
				title: localize('resolveConflicts_global', "Preferences Sync: Show Settings Conflicts (1)"),
			},
			when: resolveSettingsConflictsWhenContext,
			order: 2
		});
		MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '5_sync',
			command: {
				id: resolveSettingsConflictsCommand.id,
				title: localize('resolveConflicts_global', "Preferences Sync: Show Settings Conflicts (1)"),
			},
			when: resolveSettingsConflictsWhenContext,
			order: 2
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: resolveSettingsConflictsCommand,
			when: resolveSettingsConflictsWhenContext,
		});
	}

	private registerShowKeybindingsConflictsAction(): void {
		const resolveKeybindingsConflictsWhenContext = ContextKeyExpr.regex(CONTEXT_CONFLICTS_SOURCES.keys()[0], /.*keybindings.*/i);
		CommandsRegistry.registerCommand(resolveKeybindingsConflictsCommand.id, () => this.handleSyncResourceConflicts(SyncResource.Keybindings));
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_sync',
			command: {
				id: resolveKeybindingsConflictsCommand.id,
				title: localize('resolveKeybindingsConflicts_global', "Preferences Sync: Show Keybindings Conflicts (1)"),
			},
			when: resolveKeybindingsConflictsWhenContext,
			order: 2
		});
		MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '5_sync',
			command: {
				id: resolveKeybindingsConflictsCommand.id,
				title: localize('resolveKeybindingsConflicts_global', "Preferences Sync: Show Keybindings Conflicts (1)"),
			},
			when: resolveKeybindingsConflictsWhenContext,
			order: 2
		});
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: resolveKeybindingsConflictsCommand,
			when: resolveKeybindingsConflictsWhenContext,
		});
	}

	private _snippetsConflictsActionsDisposable: DisposableStore = new DisposableStore();
	private registerShowSnippetsConflictsAction(): void {
		this._snippetsConflictsActionsDisposable.clear();
		const resolveSnippetsConflictsWhenContext = ContextKeyExpr.regex(CONTEXT_CONFLICTS_SOURCES.keys()[0], /.*snippets.*/i);
		const conflicts: Conflict[] | undefined = this.userDataSyncService.conflicts.filter(({ syncResource }) => syncResource === SyncResource.Snippets)[0]?.conflicts;
		this._snippetsConflictsActionsDisposable.add(CommandsRegistry.registerCommand(resolveSnippetsConflictsCommand.id, () => this.handleSyncResourceConflicts(SyncResource.Snippets)));
		this._snippetsConflictsActionsDisposable.add(MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_sync',
			command: {
				id: resolveSnippetsConflictsCommand.id,
				title: localize('resolveSnippetsConflicts_global', "Preferences Sync: Show User Snippets Conflicts ({0})", conflicts?.length || 1),
			},
			when: resolveSnippetsConflictsWhenContext,
			order: 2
		}));
		this._snippetsConflictsActionsDisposable.add(MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '5_sync',
			command: {
				id: resolveSnippetsConflictsCommand.id,
				title: localize('resolveSnippetsConflicts_global', "Preferences Sync: Show User Snippets Conflicts ({0})", conflicts?.length || 1),
			},
			when: resolveSnippetsConflictsWhenContext,
			order: 2
		}));
		this._snippetsConflictsActionsDisposable.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: resolveSnippetsConflictsCommand,
			when: resolveSnippetsConflictsWhenContext,
		}));
	}

	private registerSyncStatusAction(): void {
		const that = this;
		const when = ContextKeyExpr.and(CONTEXT_SYNC_ENABLEMENT, CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Available), CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized));
		this.registerSyncNowAction();
		this._register(registerAction2(class SyncStatusAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.userData.actions.syncStatus',
					title: localize('sync is on', "Preferences Sync is On"),
					menu: [
						{
							id: MenuId.GlobalActivity,
							group: '5_sync',
							when,
							order: 3
						},
						{
							id: MenuId.MenubarPreferencesMenu,
							group: '5_sync',
							when,
							order: 3,
						},
						{
							id: MenuId.AccountsContext,
							group: '1_sync',
							when,
						}
					],
				});
			}
			run(accessor: ServicesAccessor): any {
				return new Promise((c, e) => {
					const quickInputService = accessor.get(IQuickInputService);
					const commandService = accessor.get(ICommandService);
					const disposables = new DisposableStore();
					const quickPick = quickInputService.createQuickPick();
					disposables.add(quickPick);
					const items: Array<IQuickPickItem | IQuickPickSeparator> = [];
					if (that.userDataSyncService.conflicts.length) {
						for (const { syncResource } of that.userDataSyncService.conflicts) {
							switch (syncResource) {
								case SyncResource.Settings:
									items.push({ id: resolveSettingsConflictsCommand.id, label: resolveSettingsConflictsCommand.title });
									break;
								case SyncResource.Keybindings:
									items.push({ id: resolveKeybindingsConflictsCommand.id, label: resolveKeybindingsConflictsCommand.title });
									break;
								case SyncResource.Snippets:
									items.push({ id: resolveSnippetsConflictsCommand.id, label: resolveSnippetsConflictsCommand.title });
									break;
							}
						}
						items.push({ type: 'separator' });
					}
					items.push({ id: configureSyncCommand.id, label: configureSyncCommand.title });
					items.push({ id: showSyncSettingsCommand.id, label: showSyncSettingsCommand.title });
					items.push({ id: showSyncActivityCommand.id, label: showSyncActivityCommand.title });
					items.push({ type: 'separator' });
					items.push({ id: syncNowCommand.id, label: syncNowCommand.title, description: syncNowCommand.description(that.userDataSyncService) });
					if (that.userDataSyncEnablementService.canToggleEnablement()) {
						const account = that.userDataSyncAccounts.current;
						items.push({ id: stopSyncCommand.id, label: stopSyncCommand.title, description: account ? `${account.accountName} (${that.authenticationService.getDisplayName(account.authenticationProviderId)})` : undefined });
					}
					quickPick.items = items;
					disposables.add(quickPick.onDidAccept(() => {
						if (quickPick.selectedItems[0] && quickPick.selectedItems[0].id) {
							commandService.executeCommand(quickPick.selectedItems[0].id);
						}
						quickPick.hide();
					}));
					disposables.add(quickPick.onDidHide(() => {
						disposables.dispose();
						c();
					}));
					quickPick.show();
				});
			}
		}));
	}

	private registerSyncNowAction(): void {
		const that = this;
		this._register(registerAction2(class SyncNowAction extends Action2 {
			constructor() {
				super({
					id: syncNowCommand.id,
					title: syncNowCommand.title,
				});
			}
			run(): Promise<any> {
				return that.userDataSyncService.sync();
			}
		}));
	}

	private registerTurnOffSyncAction(): void {
		const that = this;
		this._register(registerAction2(class StopSyncAction extends Action2 {
			constructor() {
				super({
					id: stopSyncCommand.id,
					title: stopSyncCommand.title,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT),
					},
				});
			}
			async run(): Promise<any> {
				try {
					await that.turnOff();
				} catch (e) {
					if (!isPromiseCanceledError(e)) {
						that.notificationService.error(localize('turn off failed', "Error while turning off sync: {0}", toErrorMessage(e)));
					}
				}
			}
		}));
	}

	private registerConfigureSyncAction(): void {
		const that = this;
		this._register(registerAction2(class ShowSyncActivityAction extends Action2 {
			constructor() {
				super({
					id: configureSyncCommand.id,
					title: configureSyncCommand.title,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT),
					},
				});
			}
			run(): any { return that.configureSyncOptions(); }
		}));
	}

	private registerShowActivityAction(): void {
		const that = this;
		this._register(registerAction2(class ShowSyncActivityAction extends Action2 {
			constructor() {
				super({
					id: showSyncActivityCommand.id,
					title: showSyncActivityCommand.title,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized)),
					},
				});
			}
			run(): any { return that.showSyncActivity(); }
		}));
	}

	private registerShowSettingsAction(): void {
		this._register(registerAction2(class ShowSyncSettingsAction extends Action2 {
			constructor() {
				super({
					id: showSyncSettingsCommand.id,
					title: showSyncSettingsCommand.title,
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized)),
					},
				});
			}
			run(accessor: ServicesAccessor): any {
				accessor.get(IPreferencesService).openGlobalSettings(false, { query: '@tag:sync' });
			}
		}));
	}

}

class UserDataRemoteContentProvider implements ITextModelContentProvider {

	constructor(
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService,
	) {
	}

	provideTextContent(uri: URI): Promise<ITextModel> | null {
		if (uri.scheme === USER_DATA_SYNC_SCHEME) {
			return this.userDataSyncService.resolveContent(uri).then(content => this.modelService.createModel(content || '', this.modeService.create('jsonc'), uri));
		}
		return null;
	}
}

class AcceptChangesContribution extends Disposable implements IEditorContribution {

	static get(editor: ICodeEditor): AcceptChangesContribution {
		return editor.getContribution<AcceptChangesContribution>(AcceptChangesContribution.ID);
	}

	public static readonly ID = 'editor.contrib.acceptChangesButton';

	private acceptChangesButton: FloatingClickWidget | undefined;

	constructor(
		private editor: ICodeEditor,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
		super();

		this.update();
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.editor.onDidChangeModel(() => this.update()));
		this._register(this.userDataSyncService.onDidChangeConflicts(() => this.update()));
		this._register(Event.filter(this.configurationService.onDidChangeConfiguration, e => e.affectsConfiguration('diffEditor.renderSideBySide'))(() => this.update()));
	}

	private update(): void {
		if (!this.shouldShowButton(this.editor)) {
			this.disposeAcceptChangesWidgetRenderer();
			return;
		}

		this.createAcceptChangesWidgetRenderer();
	}

	private shouldShowButton(editor: ICodeEditor): boolean {
		const model = editor.getModel();
		if (!model) {
			return false; // we need a model
		}

		const syncResourceConflicts = this.getSyncResourceConflicts(model.uri);
		if (!syncResourceConflicts) {
			return false;
		}

		if (syncResourceConflicts.conflicts.some(({ local }) => isEqual(local, model.uri))) {
			return true;
		}

		if (syncResourceConflicts.conflicts.some(({ remote }) => isEqual(remote, model.uri))) {
			return this.configurationService.getValue<boolean>('diffEditor.renderSideBySide');
		}

		return false;
	}

	private createAcceptChangesWidgetRenderer(): void {
		if (!this.acceptChangesButton) {
			const resource = this.editor.getModel()!.uri;
			const syncResourceConflicts = this.getSyncResourceConflicts(resource)!;
			const isRemote = syncResourceConflicts.conflicts.some(({ remote }) => isEqual(remote, resource));
			const acceptRemoteLabel = localize('accept remote', "Accept Remote");
			const acceptLocalLabel = localize('accept local', "Accept Local");
			this.acceptChangesButton = this.instantiationService.createInstance(FloatingClickWidget, this.editor, isRemote ? acceptRemoteLabel : acceptLocalLabel, null);
			this._register(this.acceptChangesButton.onClick(async () => {
				const model = this.editor.getModel();
				if (model) {
					this.telemetryService.publicLog2<{ source: string, action: string }, SyncConflictsClassification>('sync/handleConflicts', { source: syncResourceConflicts.syncResource, action: isRemote ? 'acceptRemote' : 'acceptLocal' });
					const syncAreaLabel = getSyncAreaLabel(syncResourceConflicts.syncResource);
					const result = await this.dialogService.confirm({
						type: 'info',
						title: isRemote
							? localize('Sync accept remote', "Preferences Sync: {0}", acceptRemoteLabel)
							: localize('Sync accept local', "Preferences Sync: {0}", acceptLocalLabel),
						message: isRemote
							? localize('confirm replace and overwrite local', "Would you like to accept remote {0} and replace local {1}?", syncAreaLabel.toLowerCase(), syncAreaLabel.toLowerCase())
							: localize('confirm replace and overwrite remote', "Would you like to accept local {0} and replace remote {1}?", syncAreaLabel.toLowerCase(), syncAreaLabel.toLowerCase()),
						primaryButton: isRemote ? acceptRemoteLabel : acceptLocalLabel
					});
					if (result.confirmed) {
						try {
							await this.userDataSyncService.acceptConflict(model.uri, model.getValue());
						} catch (e) {
							if (e instanceof UserDataSyncError && e.code === UserDataSyncErrorCode.LocalPreconditionFailed) {
								const syncResourceCoflicts = this.userDataSyncService.conflicts.filter(({ syncResource }) => syncResource === syncResourceConflicts.syncResource)[0];
								if (syncResourceCoflicts && syncResourceCoflicts.conflicts.some(conflict => isEqual(conflict.local, model.uri) || isEqual(conflict.remote, model.uri))) {
									this.notificationService.warn(localize('update conflicts', "Could not resolve conflicts as there is new local version available. Please try again."));
								}
							} else {
								this.notificationService.error(e);
							}
						}
					}
				}
			}));

			this.acceptChangesButton.render();
		}
	}

	private getSyncResourceConflicts(resource: URI): SyncResourceConflicts | undefined {
		return this.userDataSyncService.conflicts.filter(({ conflicts }) => conflicts.some(({ local, remote }) => isEqual(local, resource) || isEqual(remote, resource)))[0];
	}

	private disposeAcceptChangesWidgetRenderer(): void {
		dispose(this.acceptChangesButton);
		this.acceptChangesButton = undefined;
	}

	dispose(): void {
		this.disposeAcceptChangesWidgetRenderer();
		super.dispose();
	}
}
