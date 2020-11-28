/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IAction } from 'vs/base/common/actions';
import { distinct } from 'vs/base/common/arrays';
import { CancelablePromise, createCancelablePromise, raceCancellablePromises, raceCancellation, timeout } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { DisposableStore, MutableDisposable } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IExtensionRecommendationNotificationService, RecommendationsNotificationResult, RecommendationSource } from 'vs/platform/extensionRecommendations/common/extensionRecommendations';
import { IInstantiationService, optional } from 'vs/platform/instantiation/common/instantiation';
import { INotificationHandle, INotificationService, IPromptChoice, IPromptChoiceWithMenu, Severity } from 'vs/platform/notification/common/notification';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IUserDataAutoSyncEnablementService, IUserDataSyncResourceEnablementService, SyncResource } from 'vs/platform/userDataSync/common/userDataSync';
import { SearchExtensionsAction } from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { IExtension, IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';
import { ITASExperimentService } from 'vs/workbench/services/experiment/common/experimentService';
import { EnablementState, IWorkbenchExtensioManagementService, IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IExtensionIgnoredRecommendationsService } from 'vs/workbench/services/extensionRecommendations/common/extensionRecommendations';

type ExtensionRecommendationsNotificationClassification = {
	userReaction: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	extensionId?: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
};

type ExtensionWorkspaceRecommendationsNotificationClassification = {
	userReaction: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

const ignoreImportantExtensionRecommendationStorageKey = 'extensionsAssistant/importantRecommendationsIgnore';
const donotShowWorkspaceRecommendationsStorageKey = 'extensionsAssistant/workspaceRecommendationsIgnore';
const choiceNever = localize('neverShowAgain', "Don't Show Again");

type RecommendationsNotificationActions = {
	onDidInstallRecommendedExtensions(extensions: IExtension[]): void;
	onDidShowRecommendedExtensions(extensions: IExtension[]): void;
	onDidCancelRecommendedExtensions(extensions: IExtension[]): void;
	onDidNeverShowRecommendedExtensionsAgain(extensions: IExtension[]): void;
};

class RecommendationsNotification {

	private _onDidClose = new Emitter<void>();
	readonly onDidClose = this._onDidClose.event;

	private _onDidChangeVisibility = new Emitter<boolean>();
	readonly onDidChangeVisibility = this._onDidChangeVisibility.event;

	private notificationHandle: INotificationHandle | undefined;
	private cancelled: boolean = false;

	constructor(
		private readonly severity: Severity,
		private readonly message: string,
		private readonly choices: IPromptChoice[],
		private readonly notificationService: INotificationService
	) { }

	show(): void {
		if (!this.notificationHandle) {
			this.updateNotificationHandle(this.notificationService.prompt(this.severity, this.message, this.choices, { sticky: true, onCancel: () => this.cancelled = true }));
		}
	}

	hide(): void {
		if (this.notificationHandle) {
			this.onDidCloseDisposable.clear();
			this.notificationHandle.close();
			this.cancelled = false;
			this.updateNotificationHandle(this.notificationService.prompt(this.severity, this.message, this.choices, { silent: true, sticky: false, onCancel: () => this.cancelled = true }));
		}
	}

	isCancelled(): boolean {
		return this.cancelled;
	}

	private onDidCloseDisposable = new MutableDisposable();
	private onDidChangeVisibilityDisposable = new MutableDisposable();
	private updateNotificationHandle(notificationHandle: INotificationHandle) {
		this.onDidCloseDisposable.clear();
		this.onDidChangeVisibilityDisposable.clear();
		this.notificationHandle = notificationHandle;

		this.onDidCloseDisposable.value = this.notificationHandle.onDidClose(() => {
			this.onDidCloseDisposable.dispose();
			this.onDidChangeVisibilityDisposable.dispose();

			this._onDidClose.fire();

			this._onDidClose.dispose();
			this._onDidChangeVisibility.dispose();
		});
		this.onDidChangeVisibilityDisposable.value = this.notificationHandle.onDidChangeVisibility((e) => this._onDidChangeVisibility.fire(e));
	}
}

type PendingRecommendationsNotification = { recommendationsNotification: RecommendationsNotification, source: RecommendationSource, token: CancellationToken };
type VisibleRecommendationsNotification = { recommendationsNotification: RecommendationsNotification, source: RecommendationSource, from: number };

export class ExtensionRecommendationNotificationService implements IExtensionRecommendationNotificationService {

	declare readonly _serviceBrand: undefined;

	private readonly tasExperimentService: ITASExperimentService | undefined;

	// Ignored Important Recommendations
	get ignoredRecommendations(): string[] {
		return distinct([...(<string[]>JSON.parse(this.storageService.get(ignoreImportantExtensionRecommendationStorageKey, StorageScope.GLOBAL, '[]')))].map(i => i.toLowerCase()));
	}

	private recommendedExtensions: string[] = [];
	private recommendationSources: RecommendationSource[] = [];

	private hideVisibleNotificationPromise: CancelablePromise<void> | undefined;
	private visibleNotification: VisibleRecommendationsNotification | undefined;
	private pendingNotificaitons: PendingRecommendationsNotification[] = [];

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@INotificationService private readonly notificationService: INotificationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IWorkbenchExtensioManagementService private readonly extensionManagementService: IWorkbenchExtensioManagementService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@IExtensionIgnoredRecommendationsService private readonly extensionIgnoredRecommendationsService: IExtensionIgnoredRecommendationsService,
		@IUserDataAutoSyncEnablementService private readonly userDataAutoSyncEnablementService: IUserDataAutoSyncEnablementService,
		@IUserDataSyncResourceEnablementService private readonly userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@optional(ITASExperimentService) tasExperimentService: ITASExperimentService,
	) {
		this.tasExperimentService = tasExperimentService;
	}

	hasToIgnoreRecommendationNotifications(): boolean {
		const config = this.configurationService.getValue<{ ignoreRecommendations: boolean, showRecommendationsOnlyOnDemand?: boolean }>('extensions');
		return config.ignoreRecommendations || !!config.showRecommendationsOnlyOnDemand;
	}

	async promptImportantExtensionsInstallNotification(extensionIds: string[], message: string, searchValue: string, source: RecommendationSource): Promise<RecommendationsNotificationResult> {
		const ignoredRecommendations = [...this.extensionIgnoredRecommendationsService.ignoredRecommendations, ...this.ignoredRecommendations];
		extensionIds = extensionIds.filter(id => !ignoredRecommendations.includes(id));
		if (!extensionIds.length) {
			return RecommendationsNotificationResult.Ignored;
		}

		return this.promptRecommendationsNotification(extensionIds, message, searchValue, source, {
			onDidInstallRecommendedExtensions: (extensions: IExtension[]) => extensions.forEach(extension => this.telemetryService.publicLog2<{ userReaction: string, extensionId: string }, ExtensionRecommendationsNotificationClassification>('extensionRecommendations:popup', { userReaction: 'install', extensionId: extension.identifier.id })),
			onDidShowRecommendedExtensions: (extensions: IExtension[]) => extensions.forEach(extension => this.telemetryService.publicLog2<{ userReaction: string, extensionId: string }, ExtensionRecommendationsNotificationClassification>('extensionRecommendations:popup', { userReaction: 'show', extensionId: extension.identifier.id })),
			onDidCancelRecommendedExtensions: (extensions: IExtension[]) => extensions.forEach(extension => this.telemetryService.publicLog2<{ userReaction: string, extensionId: string }, ExtensionRecommendationsNotificationClassification>('extensionRecommendations:popup', { userReaction: 'cancelled', extensionId: extension.identifier.id })),
			onDidNeverShowRecommendedExtensionsAgain: (extensions: IExtension[]) => {
				for (const extension of extensions) {
					this.addToImportantRecommendationsIgnore(extension.identifier.id);
					this.telemetryService.publicLog2<{ userReaction: string, extensionId: string }, ExtensionRecommendationsNotificationClassification>('extensionRecommendations:popup', { userReaction: 'neverShowAgain', extensionId: extension.identifier.id });
				}
				this.notificationService.prompt(
					Severity.Info,
					localize('ignoreExtensionRecommendations', "Do you want to ignore all extension recommendations?"),
					[{
						label: localize('ignoreAll', "Yes, Ignore All"),
						run: () => this.setIgnoreRecommendationsConfig(true)
					}, {
						label: localize('no', "No"),
						run: () => this.setIgnoreRecommendationsConfig(false)
					}]
				);
			},
		});
	}

	async promptWorkspaceRecommendations(recommendations: string[]): Promise<void> {
		if (this.storageService.getBoolean(donotShowWorkspaceRecommendationsStorageKey, StorageScope.WORKSPACE, false)) {
			return;
		}

		let installed = await this.extensionManagementService.getInstalled();
		installed = installed.filter(l => this.extensionEnablementService.getEnablementState(l) !== EnablementState.DisabledByExtensionKind); // Filter extensions disabled by kind
		recommendations = recommendations.filter(extensionId => installed.every(local => !areSameExtensions({ id: extensionId }, local.identifier)));
		if (!recommendations.length) {
			return;
		}

		const result = await this.promptRecommendationsNotification(recommendations, localize('workspaceRecommended', "Do you want to install the recommended extensions for this repository?"), '@recommended ', RecommendationSource.WORKSPACE, {
			onDidInstallRecommendedExtensions: () => this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'install' }),
			onDidShowRecommendedExtensions: () => this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'show' }),
			onDidCancelRecommendedExtensions: () => this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'cancelled' }),
			onDidNeverShowRecommendedExtensionsAgain: () => this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'neverShowAgain' }),
		});

		if (result === RecommendationsNotificationResult.Accepted) {
			this.storageService.store(donotShowWorkspaceRecommendationsStorageKey, true, StorageScope.WORKSPACE, StorageTarget.USER);
		}

	}

	private async promptRecommendationsNotification(extensionIds: string[], message: string, searchValue: string, source: RecommendationSource, recommendationsNotificationActions: RecommendationsNotificationActions): Promise<RecommendationsNotificationResult> {

		if (this.hasToIgnoreRecommendationNotifications()) {
			return RecommendationsNotificationResult.Ignored;
		}

		// Ignore exe recommendation if the window
		// 		=> has shown an exe based recommendation already
		// 		=> or has shown any two recommendations already
		if (source === RecommendationSource.EXE && (this.recommendationSources.includes(RecommendationSource.EXE) || this.recommendationSources.length >= 2)) {
			return RecommendationsNotificationResult.TooMany;
		}

		// Ignore exe recommendation if recommendations are already shown
		if (source === RecommendationSource.EXE && extensionIds.every(id => this.recommendedExtensions.includes(id))) {
			return RecommendationsNotificationResult.Ignored;
		}

		const extensions = await this.getInstallableExtensions(extensionIds);
		if (!extensions.length) {
			return RecommendationsNotificationResult.Ignored;
		}

		if (this.tasExperimentService && extensionIds.indexOf('ms-vscode-remote.remote-wsl') !== -1) {
			await this.tasExperimentService.getTreatment<boolean>('wslpopupaa');
		}

		this.recommendedExtensions = distinct([...this.recommendedExtensions, ...extensionIds]);

		return raceCancellablePromises([
			this.showRecommendationsNotification(extensions, message, searchValue, source, recommendationsNotificationActions),
			this.waitUntilRecommendationsAreInstalled(extensions)
		]);

	}

	private showRecommendationsNotification(extensions: IExtension[], message: string, searchValue: string, source: RecommendationSource,
		{ onDidInstallRecommendedExtensions, onDidShowRecommendedExtensions, onDidCancelRecommendedExtensions, onDidNeverShowRecommendedExtensionsAgain }: RecommendationsNotificationActions): CancelablePromise<RecommendationsNotificationResult> {
		return createCancelablePromise<RecommendationsNotificationResult>(async token => {
			let accepted = false;
			const choices: (IPromptChoice | IPromptChoiceWithMenu)[] = [];
			const installExtensions = async (isMachineScoped?: boolean) => {
				this.runAction(this.instantiationService.createInstance(SearchExtensionsAction, searchValue));
				onDidInstallRecommendedExtensions(extensions);
				await Promise.all([
					Promise.all(extensions.map(extension => this.extensionsWorkbenchService.open(extension, { pinned: true }))),
					this.extensionManagementService.installExtensions(extensions.map(e => e.gallery!), { isMachineScoped })
				]);
			};
			choices.push({
				label: localize('install', "Install"),
				run: () => installExtensions(),
				menu: this.userDataAutoSyncEnablementService.isEnabled() && this.userDataSyncResourceEnablementService.isResourceEnabled(SyncResource.Extensions) ? [{
					label: localize('install and do no sync', "Install (Do not sync)"),
					run: () => installExtensions(true)
				}] : undefined,
			});
			choices.push(...[{
				label: localize('show recommendations', "Show Recommendations"),
				run: async () => {
					onDidShowRecommendedExtensions(extensions);
					for (const extension of extensions) {
						this.extensionsWorkbenchService.open(extension, { pinned: true });
					}
					this.runAction(this.instantiationService.createInstance(SearchExtensionsAction, searchValue));
				}
			}, {
				label: choiceNever,
				isSecondary: true,
				run: () => {
					onDidNeverShowRecommendedExtensionsAgain(extensions);
				}
			}]);
			try {
				accepted = await this.doShowRecommendationsNotification(Severity.Info, message, choices, source, token);
			} catch (error) {
				if (!isPromiseCanceledError(error)) {
					throw error;
				}
			}

			if (accepted) {
				return RecommendationsNotificationResult.Accepted;
			} else {
				onDidCancelRecommendedExtensions(extensions);
				return RecommendationsNotificationResult.Cancelled;
			}

		});
	}

	private waitUntilRecommendationsAreInstalled(extensions: IExtension[]): CancelablePromise<RecommendationsNotificationResult.Accepted> {
		const installedExtensions: string[] = [];
		const disposables = new DisposableStore();
		return createCancelablePromise(async token => {
			disposables.add(token.onCancellationRequested(e => disposables.dispose()));
			return new Promise<RecommendationsNotificationResult.Accepted>((c, e) => {
				disposables.add(this.extensionManagementService.onInstallExtension(e => {
					installedExtensions.push(e.identifier.id.toLowerCase());
					if (extensions.every(e => installedExtensions.includes(e.identifier.id.toLowerCase()))) {
						c(RecommendationsNotificationResult.Accepted);
					}
				}));
			});
		});
	}

	/**
	 * Show recommendations in Queue
	 * At any time only one recommendation is shown
	 * If a new recommendation comes in
	 * 		=> If no recommendation is visible, show it immediately
	 *		=> Otherwise, add to the pending queue
	 * 			=> If it is not exe based and has higher or same priority as current, hide the current notification after showing it for 3s.
	 * 			=> Otherwise wait until the current notification is hidden.
	 */
	private async doShowRecommendationsNotification(severity: Severity, message: string, choices: IPromptChoice[], source: RecommendationSource, token: CancellationToken): Promise<boolean> {
		const disposables = new DisposableStore();
		try {
			this.recommendationSources.push(source);
			const recommendationsNotification = new RecommendationsNotification(severity, message, choices, this.notificationService);
			Event.once(Event.filter(recommendationsNotification.onDidChangeVisibility, e => !e))(() => this.showNextNotification());
			if (this.visibleNotification) {
				const index = this.pendingNotificaitons.length;
				token.onCancellationRequested(() => this.pendingNotificaitons.splice(index, 1), disposables);
				this.pendingNotificaitons.push({ recommendationsNotification, source, token });
				if (source !== RecommendationSource.EXE && source <= this.visibleNotification!.source) {
					this.hideVisibleNotification(3000);
				}
			} else {
				this.visibleNotification = { recommendationsNotification, source, from: Date.now() };
				recommendationsNotification.show();
			}
			await raceCancellation(Event.toPromise(recommendationsNotification.onDidClose), token);
			return !recommendationsNotification.isCancelled();
		} finally {
			disposables.dispose();
		}
	}

	private showNextNotification(): void {
		const index = this.getNextPendingNotificationIndex();
		const [nextNotificaiton] = index > -1 ? this.pendingNotificaitons.splice(index, 1) : [];

		// Show the next notification after a delay of 500ms (after the current notification is dismissed)
		timeout(nextNotificaiton ? 500 : 0)
			.then(() => {
				this.unsetVisibileNotification();
				if (nextNotificaiton) {
					this.visibleNotification = { recommendationsNotification: nextNotificaiton.recommendationsNotification, source: nextNotificaiton.source, from: Date.now() };
					nextNotificaiton.recommendationsNotification.show();
				}
			});
	}

	/**
	 * Return the recent high priroity pending notification
	 */
	private getNextPendingNotificationIndex(): number {
		let index = this.pendingNotificaitons.length - 1;
		if (this.pendingNotificaitons.length) {
			for (let i = 0; i < this.pendingNotificaitons.length; i++) {
				if (this.pendingNotificaitons[i].source <= this.pendingNotificaitons[index].source) {
					index = i;
				}
			}
		}
		return index;
	}

	private hideVisibleNotification(timeInMillis: number): void {
		if (this.visibleNotification && !this.hideVisibleNotificationPromise) {
			const visibleNotification = this.visibleNotification;
			this.hideVisibleNotificationPromise = timeout(Math.max(timeInMillis - (Date.now() - visibleNotification.from), 0));
			this.hideVisibleNotificationPromise.then(() => visibleNotification!.recommendationsNotification.hide());
		}
	}

	private unsetVisibileNotification(): void {
		this.hideVisibleNotificationPromise?.cancel();
		this.hideVisibleNotificationPromise = undefined;
		this.visibleNotification = undefined;
	}

	private async getInstallableExtensions(extensionIds: string[]): Promise<IExtension[]> {
		const extensions: IExtension[] = [];
		if (extensionIds.length) {
			const pager = await this.extensionsWorkbenchService.queryGallery({ names: extensionIds, pageSize: extensionIds.length, source: 'install-recommendations' }, CancellationToken.None);
			for (const extension of pager.firstPage) {
				if (extension.gallery && (await this.extensionManagementService.canInstall(extension.gallery))) {
					extensions.push(extension);
				}
			}
		}
		return extensions;
	}

	private async runAction(action: IAction): Promise<void> {
		try {
			await action.run();
		} finally {
			action.dispose();
		}
	}

	private addToImportantRecommendationsIgnore(id: string) {
		const importantRecommendationsIgnoreList = [...this.ignoredRecommendations];
		if (!importantRecommendationsIgnoreList.includes(id.toLowerCase())) {
			importantRecommendationsIgnoreList.push(id.toLowerCase());
			this.storageService.store(ignoreImportantExtensionRecommendationStorageKey, JSON.stringify(importantRecommendationsIgnoreList), StorageScope.GLOBAL, StorageTarget.USER);
		}
	}

	private setIgnoreRecommendationsConfig(configVal: boolean) {
		this.configurationService.updateValue('extensions.ignoreRecommendations', configVal);
	}
}
