/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import severity from 'vs/base/common/severity';
import { Action } from 'vs/base/common/actions';
import { Disposable, MutableDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IActivityService, NumberBadge, IBadge, ProgressBadge } from 'vs/workbench/services/activity/common/activity';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IUpdateService, State as UpdateState, StateType, IUpdate } from 'vs/platform/update/common/update';
import * as semver from 'semver-umd';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ReleaseNotesManager } from './releaseNotesEditor';
import { isWindows } from 'vs/base/common/platform';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { RawContextKey, IContextKey, IContextKeyService, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ShowCurrentReleaseNotesActionId, CheckForVSCodeUpdateActionId } from 'vs/workbench/contrib/update/common/update';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { IProductService } from 'vs/platform/product/common/productService';
import product from 'vs/platform/product/common/product';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';

export const CONTEXT_UPDATE_STATE = new RawContextKey<string>('updateState', StateType.Idle);

let releaseNotesManager: ReleaseNotesManager | undefined = undefined;

function showReleaseNotes(instantiationService: IInstantiationService, version: string) {
	if (!releaseNotesManager) {
		releaseNotesManager = instantiationService.createInstance(ReleaseNotesManager);
	}

	return instantiationService.invokeFunction(accessor => releaseNotesManager!.show(accessor, version));
}

export class OpenLatestReleaseNotesInBrowserAction extends Action {

	constructor(
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService
	) {
		super('update.openLatestReleaseNotes', nls.localize('releaseNotes', "Release Notes"), undefined, true);
	}

	async run(): Promise<void> {
		if (this.productService.releaseNotesUrl) {
			const uri = URI.parse(this.productService.releaseNotesUrl);
			await this.openerService.open(uri);
		} else {
			throw new Error(nls.localize('update.noReleaseNotesOnline', "This version of {0} does not have release notes online", this.productService.nameLong));
		}
	}
}

export abstract class AbstractShowReleaseNotesAction extends Action {

	constructor(
		id: string,
		label: string,
		private version: string,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super(id, label, undefined, true);
	}

	async run(): Promise<void> {
		if (!this.enabled) {
			return;
		}
		this.enabled = false;

		try {
			await showReleaseNotes(this.instantiationService, this.version);
		} catch (err) {
			const action = this.instantiationService.createInstance(OpenLatestReleaseNotesInBrowserAction);
			try {
				await action.run();
			} catch (err2) {
				throw new Error(`${err.message} and ${err2.message}`);
			}
		}
	}
}

export class ShowReleaseNotesAction extends AbstractShowReleaseNotesAction {

	constructor(
		version: string,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super('update.showReleaseNotes', nls.localize('releaseNotes', "Release Notes"), version, instantiationService);
	}
}

export class ShowCurrentReleaseNotesAction extends AbstractShowReleaseNotesAction {

	static readonly ID = ShowCurrentReleaseNotesActionId;
	static readonly LABEL = nls.localize('showReleaseNotes', "Show Release Notes");
	static readonly AVAILABE = !!product.releaseNotesUrl;

	constructor(
		id = ShowCurrentReleaseNotesAction.ID,
		label = ShowCurrentReleaseNotesAction.LABEL,
		@IInstantiationService instantiationService: IInstantiationService,
		@IProductService productService: IProductService
	) {
		super(id, label, productService.version, instantiationService);
	}
}

export class ProductContribution implements IWorkbenchContribution {

	private static readonly KEY = 'releaseNotes/lastVersion';

	constructor(
		@IStorageService storageService: IStorageService,
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService notificationService: INotificationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IOpenerService openerService: IOpenerService,
		@IConfigurationService configurationService: IConfigurationService,
		@IHostService hostService: IHostService,
		@IProductService productService: IProductService
	) {
		hostService.hadLastFocus().then(hadLastFocus => {
			if (!hadLastFocus) {
				return;
			}

			const lastVersion = storageService.get(ProductContribution.KEY, StorageScope.GLOBAL, '');
			const shouldShowReleaseNotes = configurationService.getValue<boolean>('update.showReleaseNotes');

			// was there an update? if so, open release notes
			const releaseNotesUrl = productService.releaseNotesUrl;
			if (shouldShowReleaseNotes && !environmentService.skipReleaseNotes && releaseNotesUrl && lastVersion && productService.version !== lastVersion) {
				showReleaseNotes(instantiationService, productService.version)
					.then(undefined, () => {
						notificationService.prompt(
							severity.Info,
							nls.localize('read the release notes', "Welcome to {0} v{1}! Would you like to read the Release Notes?", productService.nameLong, productService.version),
							[{
								label: nls.localize('releaseNotes', "Release Notes"),
								run: () => {
									const uri = URI.parse(releaseNotesUrl);
									openerService.open(uri);
								}
							}],
							{ sticky: true }
						);
					});
			}

			// should we show the new license?
			if (productService.licenseUrl && lastVersion && semver.satisfies(lastVersion, '<1.0.0') && semver.satisfies(productService.version, '>=1.0.0')) {
				notificationService.info(nls.localize('licenseChanged', "Our license terms have changed, please click [here]({0}) to go through them.", productService.licenseUrl));
			}

			storageService.store(ProductContribution.KEY, productService.version, StorageScope.GLOBAL);
		});
	}
}

export class UpdateContribution extends Disposable implements IWorkbenchContribution {

	private state: UpdateState;
	private readonly badgeDisposable = this._register(new MutableDisposable());
	private updateStateContextKey: IContextKey<string>;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INotificationService private readonly notificationService: INotificationService,
		@IDialogService private readonly dialogService: IDialogService,
		@IUpdateService private readonly updateService: IUpdateService,
		@IActivityService private readonly activityService: IActivityService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IProductService private readonly productService: IProductService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IStorageKeysSyncRegistryService storageKeysSyncRegistryService: IStorageKeysSyncRegistryService
	) {
		super();
		this.state = updateService.state;
		this.updateStateContextKey = CONTEXT_UPDATE_STATE.bindTo(this.contextKeyService);

		// opt-in to syncing
		storageKeysSyncRegistryService.registerStorageKey({ key: 'neverShowAgain:update/win32-fast-updates', version: 1 });

		this._register(updateService.onStateChange(this.onUpdateStateChange, this));
		this.onUpdateStateChange(this.updateService.state);

		/*
		The `update/lastKnownVersion` and `update/updateNotificationTime` storage keys are used in
		combination to figure out when to show a message to the user that he should update.

		This message should appear if the user has received an update notification but hasn't
		updated since 5 days.
		*/

		const currentVersion = this.productService.commit;
		const lastKnownVersion = this.storageService.get('update/lastKnownVersion', StorageScope.GLOBAL);

		// if current version != stored version, clear both fields
		if (currentVersion !== lastKnownVersion) {
			this.storageService.remove('update/lastKnownVersion', StorageScope.GLOBAL);
			this.storageService.remove('update/updateNotificationTime', StorageScope.GLOBAL);
		}

		this.registerGlobalActivityActions();
	}

	private onUpdateStateChange(state: UpdateState): void {
		this.updateStateContextKey.set(state.type);

		switch (state.type) {
			case StateType.Idle:
				if (state.error) {
					this.onError(state.error);
				} else if (this.state.type === StateType.CheckingForUpdates && this.state.context === this.environmentService.configuration.sessionId) {
					this.onUpdateNotAvailable();
				}
				break;

			case StateType.AvailableForDownload:
				this.onUpdateAvailable(state.update);
				break;

			case StateType.Downloaded:
				this.onUpdateDownloaded(state.update);
				break;

			case StateType.Updating:
				this.onUpdateUpdating(state.update);
				break;

			case StateType.Ready:
				this.onUpdateReady(state.update);
				break;
		}

		let badge: IBadge | undefined = undefined;
		let clazz: string | undefined;
		let priority: number | undefined = undefined;

		if (state.type === StateType.AvailableForDownload || state.type === StateType.Downloaded || state.type === StateType.Ready) {
			badge = new NumberBadge(1, () => nls.localize('updateIsReady', "New {0} update available.", this.productService.nameShort));
		} else if (state.type === StateType.CheckingForUpdates || state.type === StateType.Downloading || state.type === StateType.Updating) {
			badge = new ProgressBadge(() => nls.localize('checkingForUpdates', "Checking for Updates..."));
			clazz = 'progress-badge';
			priority = 1;
		}

		this.badgeDisposable.clear();

		if (badge) {
			this.badgeDisposable.value = this.activityService.showGlobalActivity({ badge, clazz, priority });
		}

		this.state = state;
	}

	private onError(error: string): void {
		error = error.replace(/See https:\/\/github\.com\/Squirrel\/Squirrel\.Mac\/issues\/182 for more information/, 'See [this link](https://github.com/Microsoft/vscode/issues/7426#issuecomment-425093469) for more information');

		this.notificationService.notify({
			severity: Severity.Error,
			message: error,
			source: nls.localize('update service', "Update Service"),
		});
	}

	private onUpdateNotAvailable(): void {
		this.dialogService.show(
			severity.Info,
			nls.localize('noUpdatesAvailable', "There are currently no updates available."),
			[nls.localize('ok', "OK")]
		);
	}

	// linux
	private onUpdateAvailable(update: IUpdate): void {
		if (!this.shouldShowNotification()) {
			return;
		}

		this.notificationService.prompt(
			severity.Info,
			nls.localize('thereIsUpdateAvailable', "There is an available update."),
			[{
				label: nls.localize('download update', "Download Update"),
				run: () => this.updateService.downloadUpdate()
			}, {
				label: nls.localize('later', "Later"),
				run: () => { }
			}, {
				label: nls.localize('releaseNotes', "Release Notes"),
				run: () => {
					const action = this.instantiationService.createInstance(ShowReleaseNotesAction, update.productVersion);
					action.run();
					action.dispose();
				}
			}],
			{ sticky: true }
		);
	}

	// windows fast updates (target === system)
	private onUpdateDownloaded(update: IUpdate): void {
		if (!this.shouldShowNotification()) {
			return;
		}

		this.notificationService.prompt(
			severity.Info,
			nls.localize('updateAvailable', "There's an update available: {0} {1}", this.productService.nameLong, update.productVersion),
			[{
				label: nls.localize('installUpdate', "Install Update"),
				run: () => this.updateService.applyUpdate()
			}, {
				label: nls.localize('later', "Later"),
				run: () => { }
			}, {
				label: nls.localize('releaseNotes', "Release Notes"),
				run: () => {
					const action = this.instantiationService.createInstance(ShowReleaseNotesAction, update.productVersion);
					action.run();
					action.dispose();
				}
			}],
			{ sticky: true }
		);
	}

	// windows fast updates
	private onUpdateUpdating(update: IUpdate): void {
		if (isWindows && this.productService.target === 'user') {
			return;
		}

		// windows fast updates (target === system)
		this.notificationService.prompt(
			severity.Info,
			nls.localize('updateInstalling', "{0} {1} is being installed in the background; we'll let you know when it's done.", this.productService.nameLong, update.productVersion),
			[],
			{
				neverShowAgain: { id: 'neverShowAgain:update/win32-fast-updates', isSecondary: true }
			}
		);
	}

	// windows and mac
	private onUpdateReady(update: IUpdate): void {
		if (!(isWindows && this.productService.target !== 'user') && !this.shouldShowNotification()) {
			return;
		}

		const actions = [{
			label: nls.localize('updateNow', "Update Now"),
			run: () => this.updateService.quitAndInstall()
		}, {
			label: nls.localize('later', "Later"),
			run: () => { }
		}];

		// TODO@joao check why snap updates send `update` as falsy
		if (update.productVersion) {
			actions.push({
				label: nls.localize('releaseNotes', "Release Notes"),
				run: () => {
					const action = this.instantiationService.createInstance(ShowReleaseNotesAction, update.productVersion);
					action.run();
					action.dispose();
				}
			});
		}

		// windows user fast updates and mac
		this.notificationService.prompt(
			severity.Info,
			nls.localize('updateAvailableAfterRestart', "Restart {0} to apply the latest update.", this.productService.nameLong),
			actions,
			{ sticky: true }
		);
	}

	private shouldShowNotification(): boolean {
		const currentVersion = this.productService.commit;
		const currentMillis = new Date().getTime();
		const lastKnownVersion = this.storageService.get('update/lastKnownVersion', StorageScope.GLOBAL);

		// if version != stored version, save version and date
		if (currentVersion !== lastKnownVersion) {
			this.storageService.store('update/lastKnownVersion', currentVersion!, StorageScope.GLOBAL);
			this.storageService.store('update/updateNotificationTime', currentMillis, StorageScope.GLOBAL);
		}

		const updateNotificationMillis = this.storageService.getNumber('update/updateNotificationTime', StorageScope.GLOBAL, currentMillis);
		const diffDays = (currentMillis - updateNotificationMillis) / (1000 * 60 * 60 * 24);

		return diffDays > 5;
	}

	private registerGlobalActivityActions(): void {
		CommandsRegistry.registerCommand('update.check', () => this.updateService.checkForUpdates(this.environmentService.configuration.sessionId));
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '6_update',
			command: {
				id: 'update.check',
				title: nls.localize('checkForUpdates', "Check for Updates...")
			},
			when: CONTEXT_UPDATE_STATE.isEqualTo(StateType.Idle)
		});

		CommandsRegistry.registerCommand('update.checking', () => { });
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '6_update',
			command: {
				id: 'update.checking',
				title: nls.localize('checkingForUpdates', "Checking for Updates..."),
				precondition: ContextKeyExpr.false()
			},
			when: CONTEXT_UPDATE_STATE.isEqualTo(StateType.CheckingForUpdates)
		});

		CommandsRegistry.registerCommand('update.downloadNow', () => this.updateService.downloadUpdate());
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '6_update',
			command: {
				id: 'update.downloadNow',
				title: nls.localize('download update', "Download Update")
			},
			when: CONTEXT_UPDATE_STATE.isEqualTo(StateType.AvailableForDownload)
		});

		CommandsRegistry.registerCommand('update.downloading', () => { });
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '6_update',
			command: {
				id: 'update.downloading',
				title: nls.localize('DownloadingUpdate', "Downloading Update..."),
				precondition: ContextKeyExpr.false()
			},
			when: CONTEXT_UPDATE_STATE.isEqualTo(StateType.Downloading)
		});

		CommandsRegistry.registerCommand('update.install', () => this.updateService.applyUpdate());
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '6_update',
			command: {
				id: 'update.install',
				title: nls.localize('installUpdate...', "Install Update...")
			},
			when: CONTEXT_UPDATE_STATE.isEqualTo(StateType.Downloaded)
		});

		CommandsRegistry.registerCommand('update.updating', () => { });
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '6_update',
			command: {
				id: 'update.updating',
				title: nls.localize('installingUpdate', "Installing Update..."),
				precondition: ContextKeyExpr.false()
			},
			when: CONTEXT_UPDATE_STATE.isEqualTo(StateType.Updating)
		});

		CommandsRegistry.registerCommand('update.restart', () => this.updateService.quitAndInstall());
		MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
			group: '6_update',
			command: {
				id: 'update.restart',
				title: nls.localize('restartToUpdate', "Restart to Update (1)")
			},
			when: CONTEXT_UPDATE_STATE.isEqualTo(StateType.Ready)
		});
	}
}

export class SwitchProductQualityContribution extends Disposable implements IWorkbenchContribution {

	constructor(
		@IProductService private readonly productService: IProductService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService
	) {
		super();

		this.registerGlobalActivityActions();
	}

	private registerGlobalActivityActions(): void {
		const quality = this.productService.quality;
		const productQualityChangeHandler = this.environmentService.options?.productQualityChangeHandler;
		if (productQualityChangeHandler && (quality === 'stable' || quality === 'insider')) {
			const newQuality = quality === 'stable' ? 'insider' : 'stable';
			const commandId = `update.switchQuality.${newQuality}`;
			CommandsRegistry.registerCommand(commandId, async accessor => {
				const dialogService = accessor.get(IDialogService);

				const res = await dialogService.confirm({
					type: 'info',
					message: nls.localize('relaunchMessage', "Changing the version requires a reload to take effect"),
					detail: newQuality === 'insider' ?
						nls.localize('relaunchDetailInsiders', "Press the reload button to switch to the nightly pre-production version of VSCode.") :
						nls.localize('relaunchDetailStable', "Press the reload button to switch to the monthly released stable version of VSCode."),
					primaryButton: nls.localize('reload', "&&Reload")
				});

				if (res.confirmed) {
					productQualityChangeHandler(newQuality);
				}
			});
			MenuRegistry.appendMenuItem(MenuId.GlobalActivity, {
				group: '6_update',
				command: {
					id: commandId,
					title: newQuality === 'insider' ? nls.localize('switchToInsiders', "Switch to Insiders Version...") : nls.localize('switchToStable', "Switch to Stable Version...")
				}
			});
		}
	}
}

export class CheckForVSCodeUpdateAction extends Action {

	static readonly ID = CheckForVSCodeUpdateActionId;
	static LABEL = nls.localize('checkForUpdates', "Check for Updates...");

	constructor(
		id: string,
		label: string,
		@IWorkbenchEnvironmentService private readonly workbenchEnvironmentService: IWorkbenchEnvironmentService,
		@IUpdateService private readonly updateService: IUpdateService,
	) {
		super(id, label, undefined, true);
	}

	run(): Promise<void> {
		return this.updateService.checkForUpdates(this.workbenchEnvironmentService.configuration.sessionId);
	}
}

