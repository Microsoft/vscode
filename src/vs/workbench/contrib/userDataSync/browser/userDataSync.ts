/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { getErrorMessage, isPromiseCanceledError } from 'vs/base/common/errors';
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
import { ContextKeyEqualsExpr, ContextKeyExpr, IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IQuickInputService, IQuickPickItem, IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import {
	IUserDataAutoSyncService, IUserDataSyncService, registerConfiguration,
	SyncResource, SyncStatus, UserDataSyncError, UserDataSyncErrorCode, USER_DATA_SYNC_SCHEME, IUserDataSyncResourceEnablementService,
	getSyncResourceFromLocalPreview, IResourcePreview, IUserDataSyncStoreManagementService, UserDataSyncStoreType, IUserDataSyncStore, IUserDataAutoSyncEnablementService
} from 'vs/platform/userDataSync/common/userDataSync';
import { FloatingClickWidget } from 'vs/workbench/browser/codeeditor';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IEditorInput, EditorResourceAccessor, SideBySideEditor } from 'vs/workbench/common/editor';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import * as Constants from 'vs/workbench/contrib/logs/common/logConstants';
import { IOutputService } from 'vs/workbench/contrib/output/common/output';
import { IActivityService, IBadge, NumberBadge, ProgressBadge } from 'vs/workbench/services/activity/common/activity';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { IUserDataSyncAccountService } from 'vs/platform/userDataSync/common/userDataSyncAccount';
import { fromNow } from 'vs/base/common/date';
import { IProductService } from 'vs/platform/product/common/productService';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IAuthenticationService } from 'vs/workbench/services/authentication/browser/authenticationService';
import { Registry } from 'vs/platform/registry/common/platform';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewContainerLocation, IViewContainersRegistry, Extensions, ViewContainer } from 'vs/workbench/common/views';
import { UserDataSyncDataViews } from 'vs/workbench/contrib/userDataSync/browser/userDataSyncViews';
import { IUserDataSyncWorkbenchService, getSyncAreaLabel, AccountStatus, CONTEXT_SYNC_STATE, CONTEXT_SYNC_ENABLEMENT, CONTEXT_ACCOUNT_STATE, CONFIGURE_SYNC_COMMAND_ID, SHOW_SYNC_LOG_COMMAND_ID, SYNC_VIEW_CONTAINER_ID, SYNC_TITLE, SYNC_VIEW_ICON } from 'vs/workbench/services/userDataSync/common/userDataSync';
import { Codicon } from 'vs/base/common/codicons';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';

const CONTEXT_CONFLICTS_SOURCES = new RawContextKey<string>('conflictsSources', '');

type ConfigureSyncQuickPickItem = { id: SyncResource, label: string, description?: string };

type SyncConflictsClassification = {
	source: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	action?: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
};

const turnOnSyncCommand = { id: 'workbench.userDataSync.actions.turnOn', title: localize('turn on sync with category', "{0}: Turn On...", SYNC_TITLE) };
const turnOffSyncCommand = { id: 'workbench.userDataSync.actions.turnOff', title: localize('stop sync', "{0}: Turn Off", SYNC_TITLE) };
const configureSyncCommand = { id: CONFIGURE_SYNC_COMMAND_ID, title: localize('configure sync', "{0}: Configure...", SYNC_TITLE) };
const resolveSettingsConflictsCommand = { id: 'workbench.userDataSync.actions.resolveSettingsConflicts', title: localize('showConflicts', "{0}: Show Settings Conflicts", SYNC_TITLE) };
const resolveKeybindingsConflictsCommand = { id: 'workbench.userDataSync.actions.resolveKeybindingsConflicts', title: localize('showKeybindingsConflicts', "{0}: Show Keybindings Conflicts", SYNC_TITLE) };
const resolveSnippetsConflictsCommand = { id: 'workbench.userDataSync.actions.resolveSnippetsConflicts', title: localize('showSnippetsConflicts', "{0}: Show User Snippets Conflicts", SYNC_TITLE) };
const syncNowCommand = {
	id: 'workbench.userDataSync.actions.syncNow',
	title: localize('sync now', "{0}: Sync Now", SYNC_TITLE),
	description(userDataSyncService: IUserDataSyncService): string | undefined {
		if (userDataSyncService.status === SyncStatus.Syncing) {
			return localize('syncing', "syncing");
		}
		if (userDataSyncService.lastSyncTime) {
			return localize('synced with time', "synced {0}", fromNow(userDataSyncService.lastSyncTime, true));
		}
		return undefined;
	}
};
const showSyncSettingsCommand = { id: 'workbench.userDataSync.actions.settings', title: localize('sync settings', "{0}: Show Settings", SYNC_TITLE), };
const showSyncedDataCommand = { id: 'workbench.userDataSync.actions.showSyncedData', title: localize('show synced data', "{0}: Show Synced Data", SYNC_TITLE), };

const CONTEXT_TURNING_ON_STATE = new RawContextKey<false>('userDataSyncTurningOn', false);

export class UserDataSyncWorkbenchContribution extends Disposable implements IWorkbenchContribution {

	private readonly turningOnSyncContext: IContextKey<boolean>;
	private readonly conflictsSources: IContextKey<string>;

	private readonly globalActivityBadgeDisposable = this._register(new MutableDisposable());
	private readonly accountBadgeDisposable = this._register(new MutableDisposable());

	constructor(
		@IUserDataSyncResourceEnablementService private readonly userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@IUserDataSyncService private readonly userDataSyncService: IUserDataSyncService,
		@IUserDataSyncWorkbenchService private readonly userDataSyncWorkbenchService: IUserDataSyncWorkbenchService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IActivityService private readonly activityService: IActivityService,
		@INotificationService private readonly notificationService: INotificationService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IDialogService private readonly dialogService: IDialogService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IOutputService private readonly outputService: IOutputService,
		@IUserDataSyncAccountService readonly authTokenService: IUserDataSyncAccountService,
		@IUserDataAutoSyncEnablementService private readonly userDataAutoSyncEnablementService: IUserDataAutoSyncEnablementService,
		@IUserDataAutoSyncService userDataAutoSyncService: IUserDataAutoSyncService,
		@ITextModelService textModelResolverService: ITextModelService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IProductService private readonly productService: IProductService,
		@IStorageService private readonly storageService: IStorageService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IAuthenticationService private readonly authenticationService: IAuthenticationService,
		@IUserDataSyncStoreManagementService private readonly userDataSyncStoreManagementService: IUserDataSyncStoreManagementService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		this.turningOnSyncContext = CONTEXT_TURNING_ON_STATE.bindTo(contextKeyService);
		this.conflictsSources = CONTEXT_CONFLICTS_SOURCES.bindTo(contextKeyService);

		if (userDataSyncWorkbenchService.enabled) {
			registerConfiguration();

			this.updateAccountBadge();
			this.updateGlobalActivityBadge();
			this.onDidChangeConflicts(this.userDataSyncService.conflicts);

			this._register(Event.any(
				Event.debounce(userDataSyncService.onDidChangeStatus, () => undefined, 500),
				this.userDataAutoSyncEnablementService.onDidChangeEnablement,
				this.userDataSyncWorkbenchService.onDidChangeAccountStatus
			)(() => {
				this.updateAccountBadge();
				this.updateGlobalActivityBadge();
			}));
			this._register(userDataSyncService.onDidChangeConflicts(() => this.onDidChangeConflicts(this.userDataSyncService.conflicts)));
			this._register(userDataAutoSyncEnablementService.onDidChangeEnablement(() => this.onDidChangeConflicts(this.userDataSyncService.conflicts)));
			this._register(userDataSyncService.onSyncErrors(errors => this.onSynchronizerErrors(errors)));
			this._register(userDataAutoSyncService.onError(error => this.onAutoSyncError(error)));

			this.registerActions();
			this.registerViews();

			textModelResolverService.registerTextModelContentProvider(USER_DATA_SYNC_SCHEME, instantiationService.createInstance(UserDataRemoteContentProvider));
			registerEditorContribution(AcceptChangesContribution.ID, AcceptChangesContribution);

			this._register(Event.any(userDataSyncService.onDidChangeStatus, userDataAutoSyncEnablementService.onDidChangeEnablement)
				(() => this.turningOnSync = !userDataAutoSyncEnablementService.isEnabled() && userDataSyncService.status !== SyncStatus.Idle));
		}
	}

	private get turningOnSync(): boolean {
		return !!this.turningOnSyncContext.get();
	}

	private set turningOnSync(turningOn: boolean) {
		this.turningOnSyncContext.set(turningOn);
		this.updateGlobalActivityBadge();
	}

	private readonly conflictsDisposables = new Map<SyncResource, IDisposable>();
	private onDidChangeConflicts(conflicts: [SyncResource, IResourcePreview[]][]) {
		if (!this.userDataAutoSyncEnablementService.isEnabled()) {
			return;
		}
		this.updateGlobalActivityBadge();
		if (conflicts.length) {
			const conflictsSources: SyncResource[] = conflicts.map(([syncResource]) => syncResource);
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

			for (const [syncResource, conflicts] of this.userDataSyncService.conflicts) {
				const conflictsEditorInputs = this.getConflictsEditorInputs(syncResource);

				// close stale conflicts editor previews
				if (conflictsEditorInputs.length) {
					conflictsEditorInputs.forEach(input => {
						if (!conflicts.some(({ previewResource }) => isEqual(previewResource, input.primary.resource))) {
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
								label: localize('replace remote', "Replace Remote"),
								run: () => {
									this.telemetryService.publicLog2<{ source: string, action: string }, SyncConflictsClassification>('sync/handleConflicts', { source: syncResource, action: 'acceptLocal' });
									this.acceptLocal(syncResource, conflicts);
								}
							},
							{
								label: localize('replace local', "Replace Local"),
								run: () => {
									this.telemetryService.publicLog2<{ source: string, action: string }, SyncConflictsClassification>('sync/handleConflicts', { source: syncResource, action: 'acceptRemote' });
									this.acceptRemote(syncResource, conflicts);
								}
							},
							{
								label: localize('show conflicts', "Show Conflicts"),
								run: () => {
									this.telemetryService.publicLog2<{ source: string, action?: string }, SyncConflictsClassification>('sync/showConflicts', { source: syncResource });
									this.handleConflicts([syncResource, conflicts]);
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

	private async acceptRemote(syncResource: SyncResource, conflicts: IResourcePreview[]) {
		try {
			for (const conflict of conflicts) {
				await this.userDataSyncService.accept(syncResource, conflict.remoteResource, undefined, this.userDataAutoSyncEnablementService.isEnabled());
			}
		} catch (e) {
			this.notificationService.error(localize('accept failed', "Error while accepting changes. Please check [logs]({0}) for more details.", `command:${SHOW_SYNC_LOG_COMMAND_ID}`));
		}
	}

	private async acceptLocal(syncResource: SyncResource, conflicts: IResourcePreview[]): Promise<void> {
		try {
			for (const conflict of conflicts) {
				await this.userDataSyncService.accept(syncResource, conflict.localResource, undefined, this.userDataAutoSyncEnablementService.isEnabled());
			}
		} catch (e) {
			this.notificationService.error(localize('accept failed', "Error while accepting changes. Please check [logs]({0}) for more details.", `command:${SHOW_SYNC_LOG_COMMAND_ID}`));
		}
	}

	private onAutoSyncError(error: UserDataSyncError): void {
		switch (error.code) {
			case UserDataSyncErrorCode.SessionExpired:
				this.notificationService.notify({
					severity: Severity.Info,
					message: localize('session expired', "Settings sync was turned off because current session is expired, please sign in again to turn on sync."),
					actions: {
						primary: [new Action('turn on sync', localize('turn on sync', "Turn on Settings Sync..."), undefined, true, () => this.turnOn())]
					}
				});
				break;
			case UserDataSyncErrorCode.TurnedOff:
				this.notificationService.notify({
					severity: Severity.Info,
					message: localize('turned off', "Settings sync was turned off from another device, please turn on sync again."),
					actions: {
						primary: [new Action('turn on sync', localize('turn on sync', "Turn on Settings Sync..."), undefined, true, () => this.turnOn())]
					}
				});
				break;
			case UserDataSyncErrorCode.TooLarge:
				if (error.resource === SyncResource.Keybindings || error.resource === SyncResource.Settings) {
					this.disableSync(error.resource);
					const sourceArea = getSyncAreaLabel(error.resource);
					this.handleTooLargeError(error.resource, localize('too large', "Disabled syncing {0} because size of the {1} file to sync is larger than {2}. Please open the file and reduce the size and enable sync", sourceArea.toLowerCase(), sourceArea.toLowerCase(), '100kb'), error);
				}
				break;
			case UserDataSyncErrorCode.IncompatibleLocalContent:
			case UserDataSyncErrorCode.Gone:
			case UserDataSyncErrorCode.UpgradeRequired:
				const message = localize('error upgrade required', "Settings sync is disabled because the current version ({0}, {1}) is not compatible with the sync service. Please update before turning on sync.", this.productService.version, this.productService.commit);
				const operationId = error.operationId ? localize('operationId', "Operation Id: {0}", error.operationId) : undefined;
				this.notificationService.notify({
					severity: Severity.Error,
					message: operationId ? `${message} ${operationId}` : message,
				});
				break;
			case UserDataSyncErrorCode.IncompatibleRemoteContent:
				this.notificationService.notify({
					severity: Severity.Error,
					message: localize('error reset required', "Settings sync is disabled because your data in the cloud is older than that of the client. Please clear your data in the cloud before turning on sync."),
					actions: {
						primary: [
							new Action('reset', localize('reset', "Clear Data in Cloud..."), undefined, true, () => this.userDataSyncWorkbenchService.resetSyncedData()),
							new Action('show synced data', localize('show synced data action', "Show Synced Data"), undefined, true, () => this.userDataSyncWorkbenchService.showSyncActivity())
						]
					}
				});
				return;

			case UserDataSyncErrorCode.ServiceChanged:
				this.notificationService.notify({
					severity: Severity.Info,
					message: this.userDataSyncStoreManagementService.userDataSyncStore?.type === 'insiders' ?
						localize('service switched to insiders', "Settings Sync has been switched to insiders service") :
						localize('service switched to stable', "Settings Sync has been switched to stable service"),
				});

				return;

			case UserDataSyncErrorCode.DefaultServiceChanged:
				// Settings sync is using separate service
				if (this.userDataAutoSyncEnablementService.isEnabled()) {
					this.notificationService.notify({
						severity: Severity.Info,
						message: localize('using separate service', "Settings sync now uses a separate service, more information is available in the [Settings Sync Documentation](https://aka.ms/vscode-settings-sync-help#_syncing-stable-versus-insiders)."),
					});
				}

				// If settings sync got turned off then ask user to turn on sync again.
				else {
					this.notificationService.notify({
						severity: Severity.Info,
						message: localize('service changed and turned off', "Settings sync was turned off because {0} now uses a separate service. Please turn on sync again.", this.productService.nameLong),
						actions: {
							primary: [new Action('turn on sync', localize('turn on sync', "Turn on Settings Sync..."), undefined, true, () => this.turnOn())]
						}
					});
				}
				return;
		}
	}

	private handleTooLargeError(resource: SyncResource, message: string, error: UserDataSyncError): void {
		const operationId = error.operationId ? localize('operationId', "Operation Id: {0}", error.operationId) : undefined;
		this.notificationService.notify({
			severity: Severity.Error,
			message: operationId ? `${message} ${operationId}` : message,
			actions: {
				primary: [new Action('open sync file', localize('open file', "Open {0} File", getSyncAreaLabel(resource)), undefined, true,
					() => resource === SyncResource.Settings ? this.preferencesService.openGlobalSettings(true) : this.preferencesService.openGlobalKeybindingSettings(true))]
			}
		});
	}

	private readonly invalidContentErrorDisposables = new Map<SyncResource, IDisposable>();
	private onSynchronizerErrors(errors: [SyncResource, UserDataSyncError][]): void {
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
		const resource = source === SyncResource.Settings ? this.environmentService.settingsResource : this.environmentService.keybindingsResource;
		if (isEqual(resource, EditorResourceAccessor.getCanonicalUri(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY }))) {
			// Do not show notification if the file in error is active
			return;
		}
		const errorArea = getSyncAreaLabel(source);
		const handle = this.notificationService.notify({
			severity: Severity.Error,
			message: localize('errorInvalidConfiguration', "Unable to sync {0} because the content in the file is not valid. Please open the file and correct it.", errorArea.toLowerCase()),
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

	private async updateGlobalActivityBadge(): Promise<void> {
		this.globalActivityBadgeDisposable.clear();

		let badge: IBadge | undefined = undefined;
		let clazz: string | undefined;
		let priority: number | undefined = undefined;

		if (this.userDataSyncService.conflicts.length && this.userDataAutoSyncEnablementService.isEnabled()) {
			badge = new NumberBadge(this.userDataSyncService.conflicts.reduce((result, [, conflicts]) => { return result + conflicts.length; }, 0), () => localize('has conflicts', "{0}: Conflicts Detected", SYNC_TITLE));
		} else if (this.turningOnSync) {
			badge = new ProgressBadge(() => localize('turning on syncing', "Turning on Settings Sync..."));
			clazz = 'progress-badge';
			priority = 1;
		}

		if (badge) {
			this.globalActivityBadgeDisposable.value = this.activityService.showGlobalActivity({ badge, clazz, priority });
		}
	}

	private async updateAccountBadge(): Promise<void> {
		this.accountBadgeDisposable.clear();

		let badge: IBadge | undefined = undefined;

		if (this.userDataSyncService.status !== SyncStatus.Uninitialized && this.userDataAutoSyncEnablementService.isEnabled() && this.userDataSyncWorkbenchService.accountStatus === AccountStatus.Unavailable) {
			badge = new NumberBadge(1, () => localize('sign in to sync', "Sign in to Sync Settings"));
		}

		if (badge) {
			this.accountBadgeDisposable.value = this.activityService.showAccountsActivity({ badge, clazz: undefined, priority: undefined });
		}
	}

	private async turnOn(): Promise<void> {
		try {
			if (!this.userDataSyncWorkbenchService.authenticationProviders.length) {
				throw new Error(localize('no authentication providers', "No authentication providers are available."));
			}
			if (!this.storageService.getBoolean('sync.donotAskPreviewConfirmation', StorageScope.GLOBAL, false)) {
				if (!await this.askForConfirmation()) {
					return;
				}
			}
			const turnOn = await this.askToConfigure();
			if (!turnOn) {
				return;
			}
			if (this.userDataSyncStoreManagementService.userDataSyncStore?.canSwitch) {
				await this.selectSettingsSyncService(this.userDataSyncStoreManagementService.userDataSyncStore);
			}
			await this.userDataSyncWorkbenchService.turnOn();
			this.storageService.store('sync.donotAskPreviewConfirmation', true, StorageScope.GLOBAL, StorageTarget.MACHINE);
		} catch (e) {
			if (isPromiseCanceledError(e)) {
				return;
			}
			if (e instanceof UserDataSyncError) {
				switch (e.code) {
					case UserDataSyncErrorCode.TooLarge:
						if (e.resource === SyncResource.Keybindings || e.resource === SyncResource.Settings) {
							this.handleTooLargeError(e.resource, localize('too large while starting sync', "Settings sync cannot be turned on because size of the {0} file to sync is larger than {1}. Please open the file and reduce the size and turn on sync", getSyncAreaLabel(e.resource).toLowerCase(), '100kb'), e);
							return;
						}
						break;
					case UserDataSyncErrorCode.IncompatibleLocalContent:
					case UserDataSyncErrorCode.Gone:
					case UserDataSyncErrorCode.UpgradeRequired:
						const message = localize('error upgrade required while starting sync', "Settings sync cannot be turned on because the current version ({0}, {1}) is not compatible with the sync service. Please update before turning on sync.", this.productService.version, this.productService.commit);
						const operationId = e.operationId ? localize('operationId', "Operation Id: {0}", e.operationId) : undefined;
						this.notificationService.notify({
							severity: Severity.Error,
							message: operationId ? `${message} ${operationId}` : message,
						});
						return;
					case UserDataSyncErrorCode.IncompatibleRemoteContent:
						this.notificationService.notify({
							severity: Severity.Error,
							message: localize('error reset required while starting sync', "Settings sync cannot be turned on because your data in the cloud is older than that of the client. Please clear your data in the cloud before turning on sync."),
							actions: {
								primary: [
									new Action('reset', localize('reset', "Clear Data in Cloud..."), undefined, true, () => this.userDataSyncWorkbenchService.resetSyncedData()),
									new Action('show synced data', localize('show synced data action', "Show Synced Data"), undefined, true, () => this.userDataSyncWorkbenchService.showSyncActivity())
								]
							}
						});
						return;
					case UserDataSyncErrorCode.Unauthorized:
						this.notificationService.error(localize('auth failed', "Error while turning on Settings Sync: Authentication failed."));
						return;
				}
				this.notificationService.error(localize('turn on failed with user data sync error', "Error while turning on Settings Sync. Please check [logs]({0}) for more details.", `command:${SHOW_SYNC_LOG_COMMAND_ID}`));
			} else {
				this.notificationService.error(localize({ key: 'turn on failed', comment: ['Substitution is for error reason'] }, "Error while turning on Settings Sync. {0}", getErrorMessage(e)));
			}
		}
	}

	private async askForConfirmation(): Promise<boolean> {
		const result = await this.dialogService.show(
			Severity.Info,
			localize('sync preview message', "Synchronizing your settings is a preview feature, please read the documentation before turning it on."),
			[
				localize('turn on', "Turn On"),
				localize('open doc', "Open Documentation"),
				localize('cancel', "Cancel"),
			],
			{
				cancelId: 2
			}
		);
		switch (result.choice) {
			case 1: this.openerService.open(URI.parse('https://aka.ms/vscode-settings-sync-help')); return false;
			case 2: return false;
		}
		return true;
	}

	private async askToConfigure(): Promise<boolean> {
		return new Promise<boolean>((c, e) => {
			const disposables: DisposableStore = new DisposableStore();
			const quickPick = this.quickInputService.createQuickPick<ConfigureSyncQuickPickItem>();
			disposables.add(quickPick);
			quickPick.title = SYNC_TITLE;
			quickPick.ok = false;
			quickPick.customButton = true;
			quickPick.customLabel = localize('sign in and turn on', "Sign in & Turn on");
			quickPick.description = localize('configure and turn on sync detail', "Please sign in to synchronize your data across devices.");
			quickPick.canSelectMany = true;
			quickPick.ignoreFocusOut = true;
			quickPick.hideInput = true;
			quickPick.hideCheckAll = true;

			const items = this.getConfigureSyncQuickPickItems();
			quickPick.items = items;
			quickPick.selectedItems = items.filter(item => this.userDataSyncResourceEnablementService.isResourceEnabled(item.id));
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

	private getConfigureSyncQuickPickItems(): ConfigureSyncQuickPickItem[] {
		return [{
			id: SyncResource.Settings,
			label: getSyncAreaLabel(SyncResource.Settings)
		}, {
			id: SyncResource.Keybindings,
			label: getSyncAreaLabel(SyncResource.Keybindings),
			description: this.configurationService.getValue('settingsSync.keybindingsPerPlatform') ? localize('per platform', "for each platform") : undefined
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
			const wasEnabled = this.userDataSyncResourceEnablementService.isResourceEnabled(item.id);
			const isEnabled = !!selectedItems.filter(selected => selected.id === item.id)[0];
			if (wasEnabled !== isEnabled) {
				this.userDataSyncResourceEnablementService.setResourceEnablement(item.id!, isEnabled);
			}
		}
	}

	private async configureSyncOptions(): Promise<void> {
		return new Promise((c, e) => {
			const disposables: DisposableStore = new DisposableStore();
			const quickPick = this.quickInputService.createQuickPick<ConfigureSyncQuickPickItem>();
			disposables.add(quickPick);
			quickPick.title = localize('configure sync', "{0}: Configure...", SYNC_TITLE);
			quickPick.placeholder = localize('configure sync placeholder', "Choose what to sync");
			quickPick.canSelectMany = true;
			quickPick.ignoreFocusOut = true;
			quickPick.ok = true;
			const items = this.getConfigureSyncQuickPickItems();
			quickPick.items = items;
			quickPick.selectedItems = items.filter(item => this.userDataSyncResourceEnablementService.isResourceEnabled(item.id));
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

	private async turnOff(): Promise<void> {
		const result = await this.dialogService.confirm({
			type: 'info',
			message: localize('turn off sync confirmation', "Do you want to turn off sync?"),
			detail: localize('turn off sync detail', "Your settings, keybindings, extensions, snippets and UI State will no longer be synced."),
			primaryButton: localize({ key: 'turn off', comment: ['&& denotes a mnemonic'] }, "&&Turn off"),
			checkbox: this.userDataSyncWorkbenchService.accountStatus === AccountStatus.Available ? {
				label: localize('turn off sync everywhere', "Turn off sync on all your devices and clear the data from the cloud.")
			} : undefined
		});
		if (result.confirmed) {
			return this.userDataSyncWorkbenchService.turnoff(!!result.checkboxChecked);
		}
	}

	private disableSync(source: SyncResource): void {
		switch (source) {
			case SyncResource.Settings: return this.userDataSyncResourceEnablementService.setResourceEnablement(SyncResource.Settings, false);
			case SyncResource.Keybindings: return this.userDataSyncResourceEnablementService.setResourceEnablement(SyncResource.Keybindings, false);
			case SyncResource.Snippets: return this.userDataSyncResourceEnablementService.setResourceEnablement(SyncResource.Snippets, false);
			case SyncResource.Extensions: return this.userDataSyncResourceEnablementService.setResourceEnablement(SyncResource.Extensions, false);
			case SyncResource.GlobalState: return this.userDataSyncResourceEnablementService.setResourceEnablement(SyncResource.GlobalState, false);
		}
	}

	private getConflictsEditorInputs(syncResource: SyncResource): DiffEditorInput[] {
		return this.editorService.editors.filter(input => {
			const resource = input instanceof DiffEditorInput ? input.primary.resource : input.resource;
			return resource && getSyncResourceFromLocalPreview(resource!, this.environmentService) === syncResource;
		}) as DiffEditorInput[];
	}

	private getAllConflictsEditorInputs(): IEditorInput[] {
		return this.editorService.editors.filter(input => {
			const resource = input instanceof DiffEditorInput ? input.primary.resource : input.resource;
			return resource && getSyncResourceFromLocalPreview(resource!, this.environmentService) !== undefined;
		});
	}

	private async handleSyncResourceConflicts(resource: SyncResource): Promise<void> {
		const syncResourceCoflicts = this.userDataSyncService.conflicts.filter(([syncResource]) => syncResource === resource)[0];
		if (syncResourceCoflicts) {
			this.handleConflicts(syncResourceCoflicts);
		}
	}

	private async handleConflicts([syncResource, conflicts]: [SyncResource, IResourcePreview[]]): Promise<void> {
		for (const conflict of conflicts) {
			const leftResourceName = localize({ key: 'leftResourceName', comment: ['remote as in file in cloud'] }, "{0} (Remote)", basename(conflict.remoteResource));
			const rightResourceName = localize('merges', "{0} (Merges)", basename(conflict.previewResource));
			await this.editorService.openEditor({
				leftResource: conflict.remoteResource,
				rightResource: conflict.previewResource,
				label: localize('sideBySideLabels', "{0} ↔ {1}", leftResourceName, rightResourceName),
				description: localize('sideBySideDescription', "Settings Sync"),
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

	private async selectSettingsSyncService(userDataSyncStore: IUserDataSyncStore): Promise<void> {
		return new Promise<void>((c, e) => {
			const disposables: DisposableStore = new DisposableStore();
			const quickPick = disposables.add(this.quickInputService.createQuickPick<{ id: UserDataSyncStoreType, label: string, description?: string }>());
			quickPick.title = localize('switchSyncService.title', "{0}: Select Service", SYNC_TITLE);
			quickPick.description = localize('switchSyncService.description', "Ensure you are using the same settings sync service when syncing with multiple environments");
			quickPick.hideInput = true;
			quickPick.ignoreFocusOut = true;
			const getDescription = (url: URI): string | undefined => {
				const isDefault = isEqual(url, userDataSyncStore.defaultUrl);
				if (isDefault) {
					return localize('default', "Default");
				}
				return undefined;
			};
			quickPick.items = [
				{
					id: 'insiders',
					label: localize('insiders', "Insiders"),
					description: getDescription(userDataSyncStore.insidersUrl)
				},
				{
					id: 'stable',
					label: localize('stable', "Stable"),
					description: getDescription(userDataSyncStore.stableUrl)
				}
			];
			disposables.add(quickPick.onDidAccept(async () => {
				try {
					await this.userDataSyncStoreManagementService.switch(quickPick.selectedItems[0].id);
					c();
				} catch (error) {
					e(error);
				} finally {
					quickPick.hide();
				}
			}));
			disposables.add(quickPick.onDidHide(() => disposables.dispose()));
			quickPick.show();
		});
	}

	private registerActions(): void {
		if (this.userDataAutoSyncEnablementService.canToggleEnablement()) {
			this.registerTurnOnSyncAction();
			this.registerTurnOffSyncAction();
		}
		this.registerTurninOnSyncAction();
		this.registerSignInAction(); // When Sync is turned on from CLI
		this.registerShowSettingsConflictsAction();
		this.registerShowKeybindingsConflictsAction();
		this.registerShowSnippetsConflictsAction();

		this.registerEnableSyncViewsAction();
		this.registerManageSyncAction();
		this.registerSyncNowAction();
		this.registerConfigureSyncAction();
		this.registerShowSettingsAction();
		this.registerShowLogAction();
		this.registerResetSyncDataAction();
	}

	private registerTurnOnSyncAction(): void {
		const turnOnSyncWhenContext = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT.toNegated(), CONTEXT_ACCOUNT_STATE.notEqualsTo(AccountStatus.Uninitialized), CONTEXT_TURNING_ON_STATE.negate());
		CommandsRegistry.registerCommand(turnOnSyncCommand.id, () => this.turnOn());
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_sync',
			command: {
				id: turnOnSyncCommand.id,
				title: localize('global activity turn on sync', "Turn on Settings Sync...")
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
				title: localize('global activity turn on sync', "Turn on Settings Sync...")
			},
			when: turnOnSyncWhenContext,
		});
		MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			group: '1_sync',
			command: {
				id: turnOnSyncCommand.id,
				title: localize('global activity turn on sync', "Turn on Settings Sync...")
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
					title: localize('turnin on sync', "Turning on Settings Sync..."),
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
					title: localize('sign in global', "Sign in to Sync Settings"),
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
					await that.userDataSyncWorkbenchService.signIn();
				} catch (e) {
					that.notificationService.error(e);
				}
			}
		}));
		this._register(MenuRegistry.appendMenuItem(MenuId.AccountsContext, {
			group: '1_sync',
			command: {
				id,
				title: localize('sign in accounts', "Sign in to Sync Settings (1)"),
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
				title: localize('resolveConflicts_global', "{0}: Show Settings Conflicts (1)", SYNC_TITLE),
			},
			when: resolveSettingsConflictsWhenContext,
			order: 2
		});
		MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '5_sync',
			command: {
				id: resolveSettingsConflictsCommand.id,
				title: localize('resolveConflicts_global', "{0}: Show Settings Conflicts (1)", SYNC_TITLE),
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
				title: localize('resolveKeybindingsConflicts_global', "{0}: Show Keybindings Conflicts (1)", SYNC_TITLE),
			},
			when: resolveKeybindingsConflictsWhenContext,
			order: 2
		});
		MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '5_sync',
			command: {
				id: resolveKeybindingsConflictsCommand.id,
				title: localize('resolveKeybindingsConflicts_global', "{0}: Show Keybindings Conflicts (1)", SYNC_TITLE),
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
		const conflicts: IResourcePreview[] | undefined = this.userDataSyncService.conflicts.filter(([syncResource]) => syncResource === SyncResource.Snippets)[0]?.[1];
		this._snippetsConflictsActionsDisposable.add(CommandsRegistry.registerCommand(resolveSnippetsConflictsCommand.id, () => this.handleSyncResourceConflicts(SyncResource.Snippets)));
		this._snippetsConflictsActionsDisposable.add(MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '5_sync',
			command: {
				id: resolveSnippetsConflictsCommand.id,
				title: localize('resolveSnippetsConflicts_global', "{0}: Show User Snippets Conflicts ({1})", SYNC_TITLE, conflicts?.length || 1),
			},
			when: resolveSnippetsConflictsWhenContext,
			order: 2
		}));
		this._snippetsConflictsActionsDisposable.add(MenuRegistry.appendMenuItem(MenuId.MenubarPreferencesMenu, {
			group: '5_sync',
			command: {
				id: resolveSnippetsConflictsCommand.id,
				title: localize('resolveSnippetsConflicts_global', "{0}: Show User Snippets Conflicts ({1})", SYNC_TITLE, conflicts?.length || 1),
			},
			when: resolveSnippetsConflictsWhenContext,
			order: 2
		}));
		this._snippetsConflictsActionsDisposable.add(MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: resolveSnippetsConflictsCommand,
			when: resolveSnippetsConflictsWhenContext,
		}));
	}

	private registerManageSyncAction(): void {
		const that = this;
		const when = ContextKeyExpr.and(CONTEXT_SYNC_ENABLEMENT, CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Available), CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized));
		this._register(registerAction2(class SyncStatusAction extends Action2 {
			constructor() {
				super({
					id: 'workbench.userDataSync.actions.manage',
					title: localize('sync is on', "Settings Sync is On"),
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
				return new Promise<void>((c, e) => {
					const quickInputService = accessor.get(IQuickInputService);
					const commandService = accessor.get(ICommandService);
					const disposables = new DisposableStore();
					const quickPick = quickInputService.createQuickPick();
					disposables.add(quickPick);
					const items: Array<IQuickPickItem | IQuickPickSeparator> = [];
					if (that.userDataSyncService.conflicts.length) {
						for (const [syncResource] of that.userDataSyncService.conflicts) {
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
					items.push({ id: showSyncedDataCommand.id, label: showSyncedDataCommand.title });
					items.push({ type: 'separator' });
					items.push({ id: syncNowCommand.id, label: syncNowCommand.title, description: syncNowCommand.description(that.userDataSyncService) });
					if (that.userDataAutoSyncEnablementService.canToggleEnablement()) {
						const account = that.userDataSyncWorkbenchService.current;
						items.push({ id: turnOffSyncCommand.id, label: turnOffSyncCommand.title, description: account ? `${account.accountName} (${that.authenticationService.getLabel(account.authenticationProviderId)})` : undefined });
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

	private registerEnableSyncViewsAction(): void {
		const that = this;
		const when = ContextKeyExpr.and(CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Available), CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized));
		this._register(registerAction2(class SyncStatusAction extends Action2 {
			constructor() {
				super({
					id: showSyncedDataCommand.id,
					title: { value: localize('workbench.action.showSyncRemoteBackup', "Show Synced Data"), original: `Show Synced Data` },
					category: { value: SYNC_TITLE, original: `Settings Sync` },
					precondition: when,
					menu: {
						id: MenuId.CommandPalette,
						when
					}
				});
			}
			run(accessor: ServicesAccessor): Promise<void> {
				return that.userDataSyncWorkbenchService.showSyncActivity();
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
					menu: {
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_ENABLEMENT, CONTEXT_ACCOUNT_STATE.isEqualTo(AccountStatus.Available), CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized))
					}
				});
			}
			run(accessor: ServicesAccessor): Promise<any> {
				return that.userDataSyncWorkbenchService.syncNow();
			}
		}));
	}

	private registerTurnOffSyncAction(): void {
		const that = this;
		this._register(registerAction2(class StopSyncAction extends Action2 {
			constructor() {
				super({
					id: turnOffSyncCommand.id,
					title: turnOffSyncCommand.title,
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
						that.notificationService.error(localize('turn off failed', "Error while turning off Settings Sync. Please check [logs]({0}) for more details.", `command:${SHOW_SYNC_LOG_COMMAND_ID}`));
					}
				}
			}
		}));
	}

	private registerConfigureSyncAction(): void {
		const that = this;
		const when = ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized), CONTEXT_SYNC_ENABLEMENT);
		this._register(registerAction2(class ConfigureSyncAction extends Action2 {
			constructor() {
				super({
					id: configureSyncCommand.id,
					title: configureSyncCommand.title,
					icon: Codicon.settingsGear,
					tooltip: localize('configure', "Configure..."),
					menu: [{
						id: MenuId.CommandPalette,
						when
					}, {
						id: MenuId.ViewContainerTitle,
						when: ContextKeyEqualsExpr.create('viewContainer', SYNC_VIEW_CONTAINER_ID),
						group: 'navigation',
						order: 2
					}]
				});
			}
			run(): any { return that.configureSyncOptions(); }
		}));
	}

	private registerShowLogAction(): void {
		const that = this;
		this._register(registerAction2(class ShowSyncActivityAction extends Action2 {
			constructor() {
				super({
					id: SHOW_SYNC_LOG_COMMAND_ID,
					title: localize('show sync log title', "{0}: Show Log", SYNC_TITLE),
					tooltip: localize('show sync log toolrip', "Show Log"),
					icon: Codicon.output,
					menu: [{
						id: MenuId.CommandPalette,
						when: ContextKeyExpr.and(CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized)),
					}, {
						id: MenuId.ViewContainerTitle,
						when: ContextKeyEqualsExpr.create('viewContainer', SYNC_VIEW_CONTAINER_ID),
						group: 'navigation',
						order: 1
					}],
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

	private registerViews(): void {
		const container = this.registerViewContainer();
		this.registerDataViews(container);
	}

	private registerViewContainer(): ViewContainer {
		return Registry.as<IViewContainersRegistry>(Extensions.ViewContainersRegistry).registerViewContainer(
			{
				id: SYNC_VIEW_CONTAINER_ID,
				title: SYNC_TITLE,
				ctorDescriptor: new SyncDescriptor(
					ViewPaneContainer,
					[SYNC_VIEW_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]
				),
				icon: SYNC_VIEW_ICON,
				hideIfEmpty: true,
			}, ViewContainerLocation.Sidebar);
	}

	private registerResetSyncDataAction(): void {
		const that = this;
		this._register(registerAction2(class extends Action2 {
			constructor() {
				super({
					id: 'workbench.actions.syncData.reset',
					title: localize('workbench.actions.syncData.reset', "Clear Data in Cloud..."),
					menu: [{
						id: MenuId.ViewContainerTitle,
						when: ContextKeyEqualsExpr.create('viewContainer', SYNC_VIEW_CONTAINER_ID)
					}],
				});
			}
			run(): any { return that.userDataSyncWorkbenchService.resetSyncedData(); }
		}));
	}

	private registerDataViews(container: ViewContainer): void {
		this._register(this.instantiationService.createInstance(UserDataSyncDataViews, container));
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
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IUserDataAutoSyncEnablementService private readonly userDataAutoSyncEnablementService: IUserDataAutoSyncEnablementService,
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

		if (!this.userDataAutoSyncEnablementService.isEnabled()) {
			return false;
		}

		const syncResourceConflicts = this.getSyncResourceConflicts(model.uri);
		if (!syncResourceConflicts) {
			return false;
		}

		if (syncResourceConflicts[1].some(({ previewResource }) => isEqual(previewResource, model.uri))) {
			return true;
		}

		if (syncResourceConflicts[1].some(({ remoteResource }) => isEqual(remoteResource, model.uri))) {
			return this.configurationService.getValue<boolean>('diffEditor.renderSideBySide');
		}

		return false;
	}

	private createAcceptChangesWidgetRenderer(): void {
		if (!this.acceptChangesButton) {
			const resource = this.editor.getModel()!.uri;
			const [syncResource, conflicts] = this.getSyncResourceConflicts(resource)!;
			const isRemote = conflicts.some(({ remoteResource }) => isEqual(remoteResource, resource));
			const acceptRemoteLabel = localize('accept remote', "Accept Remote");
			const acceptMergesLabel = localize('accept merges', "Accept Merges");
			const acceptRemoteButtonLabel = localize('accept remote button', "Accept &&Remote");
			const acceptMergesButtonLabel = localize('accept merges button', "Accept &&Merges");
			this.acceptChangesButton = this.instantiationService.createInstance(FloatingClickWidget, this.editor, isRemote ? acceptRemoteLabel : acceptMergesLabel, null);
			this._register(this.acceptChangesButton.onClick(async () => {
				const model = this.editor.getModel();
				if (model) {
					this.telemetryService.publicLog2<{ source: string, action: string }, SyncConflictsClassification>('sync/handleConflicts', { source: syncResource, action: isRemote ? 'acceptRemote' : 'acceptLocal' });
					const syncAreaLabel = getSyncAreaLabel(syncResource);
					const result = await this.dialogService.confirm({
						type: 'info',
						title: isRemote
							? localize('Sync accept remote', "{0}: {1}", SYNC_TITLE, acceptRemoteLabel)
							: localize('Sync accept merges', "{0}: {1}", SYNC_TITLE, acceptMergesLabel),
						message: isRemote
							? localize('confirm replace and overwrite local', "Would you like to accept remote {0} and replace local {1}?", syncAreaLabel.toLowerCase(), syncAreaLabel.toLowerCase())
							: localize('confirm replace and overwrite remote', "Would you like to accept merges and replace remote {0}?", syncAreaLabel.toLowerCase()),
						primaryButton: isRemote ? acceptRemoteButtonLabel : acceptMergesButtonLabel
					});
					if (result.confirmed) {
						try {
							await this.userDataSyncService.accept(syncResource, model.uri, model.getValue(), true);
						} catch (e) {
							if (e instanceof UserDataSyncError && e.code === UserDataSyncErrorCode.LocalPreconditionFailed) {
								const syncResourceCoflicts = this.userDataSyncService.conflicts.filter(syncResourceCoflicts => syncResourceCoflicts[0] === syncResource)[0];
								if (syncResourceCoflicts && conflicts.some(conflict => isEqual(conflict.previewResource, model.uri) || isEqual(conflict.remoteResource, model.uri))) {
									this.notificationService.warn(localize('update conflicts', "Could not resolve conflicts as there is new local version available. Please try again."));
								}
							} else {
								this.notificationService.error(localize('accept failed', "Error while accepting changes. Please check [logs]({0}) for more details.", `command:${SHOW_SYNC_LOG_COMMAND_ID}`));
							}
						}
					}
				}
			}));

			this.acceptChangesButton.render();
		}
	}

	private getSyncResourceConflicts(resource: URI): [SyncResource, IResourcePreview[]] | undefined {
		return this.userDataSyncService.conflicts.filter(([, conflicts]) => conflicts.some(({ previewResource, remoteResource }) => isEqual(previewResource, resource) || isEqual(remoteResource, resource)))[0];
	}

	private disposeAcceptChangesWidgetRenderer(): void {
		dispose(this.acceptChangesButton);
		this.acceptChangesButton = undefined;
	}

	override dispose(): void {
		this.disposeAcceptChangesWidgetRenderer();
		super.dispose();
	}
}
