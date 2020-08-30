/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IExtensionManagementService, IExtensionGalleryService, InstallOperation, DidInstallExtensionEvent } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionRecommendationsService, ExtensionRecommendationReason, RecommendationChangeNotification, IExtensionRecommendation, ExtensionRecommendationSource, EnablementState, IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IStorageService, StorageScope, IWorkspaceStorageChangeEvent } from 'vs/platform/storage/common/storage';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ConfigurationKey, IExtension, IExtensionsConfiguration, IExtensionsWorkbenchService, ShowRecommendationsOnlyOnDemandKey } from 'vs/workbench/contrib/extensions/common/extensions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { distinct, shuffle } from 'vs/base/common/arrays';
import { Emitter, Event } from 'vs/base/common/event';
import { assign } from 'vs/base/common/objects';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { LifecyclePhase, ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { DynamicWorkspaceRecommendations } from 'vs/workbench/contrib/extensions/browser/dynamicWorkspaceRecommendations';
import { ExeBasedRecommendations } from 'vs/workbench/contrib/extensions/browser/exeBasedRecommendations';
import { ExperimentalRecommendations } from 'vs/workbench/contrib/extensions/browser/experimentalRecommendations';
import { WorkspaceRecommendations } from 'vs/workbench/contrib/extensions/browser/workspaceRecommendations';
import { FileBasedRecommendations } from 'vs/workbench/contrib/extensions/browser/fileBasedRecommendations';
import { KeymapRecommendations } from 'vs/workbench/contrib/extensions/browser/keymapRecommendations';
import { ExtensionRecommendation } from 'vs/workbench/contrib/extensions/browser/extensionRecommendations';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { ConfigBasedRecommendations } from 'vs/workbench/contrib/extensions/browser/configBasedRecommendations';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import Severity from 'vs/base/common/severity';
import { localize } from 'vs/nls';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { SearchExtensionsAction } from 'vs/workbench/contrib/extensions/browser/extensionsActions';
import { CancellationToken } from 'vs/base/common/cancellation';

type IgnoreRecommendationClassification = {
	recommendationReason: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	extensionId: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
};

type ExtensionWorkspaceRecommendationsNotificationClassification = {
	userReaction: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

const ignoredRecommendationsStorageKey = 'extensionsAssistant/ignored_recommendations';
const ignoreWorkspaceRecommendationsStorageKey = 'extensionsAssistant/workspaceRecommendationsIgnore';

export class ExtensionRecommendationsService extends Disposable implements IExtensionRecommendationsService {

	declare readonly _serviceBrand: undefined;

	// Recommendations
	private readonly fileBasedRecommendations: FileBasedRecommendations;
	private readonly workspaceRecommendations: WorkspaceRecommendations;
	private readonly experimentalRecommendations: ExperimentalRecommendations;
	private readonly configBasedRecommendations: ConfigBasedRecommendations;
	private readonly exeBasedRecommendations: ExeBasedRecommendations;
	private readonly dynamicWorkspaceRecommendations: DynamicWorkspaceRecommendations;
	private readonly keymapRecommendations: KeymapRecommendations;

	// Ignored Recommendations
	private globallyIgnoredRecommendations: string[] = [];

	public readonly activationPromise: Promise<void>;
	private sessionSeed: number;

	private readonly _onRecommendationChange = this._register(new Emitter<RecommendationChangeNotification>());
	onRecommendationChange: Event<RecommendationChangeNotification> = this._onRecommendationChange.event;

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IStorageKeysSyncRegistryService storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
		@INotificationService private readonly notificationService: INotificationService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
	) {
		super();

		storageKeysSyncRegistryService.registerStorageKey({ key: ignoredRecommendationsStorageKey, version: 1 });

		const isExtensionAllowedToBeRecommended = (extensionId: string) => this.isExtensionAllowedToBeRecommended(extensionId);
		this.workspaceRecommendations = instantiationService.createInstance(WorkspaceRecommendations, isExtensionAllowedToBeRecommended);
		this.fileBasedRecommendations = instantiationService.createInstance(FileBasedRecommendations, isExtensionAllowedToBeRecommended);
		this.experimentalRecommendations = instantiationService.createInstance(ExperimentalRecommendations, isExtensionAllowedToBeRecommended);
		this.configBasedRecommendations = instantiationService.createInstance(ConfigBasedRecommendations, isExtensionAllowedToBeRecommended);
		this.exeBasedRecommendations = instantiationService.createInstance(ExeBasedRecommendations, isExtensionAllowedToBeRecommended);
		this.dynamicWorkspaceRecommendations = instantiationService.createInstance(DynamicWorkspaceRecommendations, isExtensionAllowedToBeRecommended);
		this.keymapRecommendations = instantiationService.createInstance(KeymapRecommendations, isExtensionAllowedToBeRecommended);

		if (!this.isEnabled()) {
			this.sessionSeed = 0;
			this.activationPromise = Promise.resolve();
			return;
		}

		this.sessionSeed = +new Date();
		this.globallyIgnoredRecommendations = this.getCachedIgnoredRecommendations();

		// Activation
		this.activationPromise = this.activate();

		this._register(this.extensionManagementService.onDidInstallExtension(e => this.onDidInstallExtension(e)));
		this._register(this.storageService.onDidChangeStorage(e => this.onDidStorageChange(e)));
	}

	private async activate(): Promise<void> {
		await this.lifecycleService.when(LifecyclePhase.Restored);

		// activate all recommendations
		await Promise.all([
			this.workspaceRecommendations.activate(),
			this.fileBasedRecommendations.activate(),
			this.experimentalRecommendations.activate(),
			this.keymapRecommendations.activate(),
			this.lifecycleService.when(LifecyclePhase.Eventually)
				.then(() => {
					if (!this.configurationService.getValue<boolean>(ShowRecommendationsOnlyOnDemandKey)) {
						this.activateProactiveRecommendations();
					}
				})
		]);

		await this.promptWorkspaceRecommendations();
		this._register(Event.any(this.workspaceRecommendations.onDidChangeRecommendations, this.configBasedRecommendations.onDidChangeRecommendations)(() => this.promptWorkspaceRecommendations()));
	}

	private isEnabled(): boolean {
		return this.galleryService.isEnabled() && !this.environmentService.extensionDevelopmentLocationURI;
	}

	private async activateProactiveRecommendations(): Promise<void> {
		await Promise.all([this.dynamicWorkspaceRecommendations.activate(), this.exeBasedRecommendations.activate(), this.configBasedRecommendations.activate()]);
	}

	getAllRecommendationsWithReason(): { [id: string]: { reasonId: ExtensionRecommendationReason, reasonText: string }; } {
		/* Activate proactive recommendations */
		this.activateProactiveRecommendations();

		const output: { [id: string]: { reasonId: ExtensionRecommendationReason, reasonText: string }; } = Object.create(null);

		const allRecommendations = [
			...this.dynamicWorkspaceRecommendations.recommendations,
			...this.configBasedRecommendations.recommendations,
			...this.exeBasedRecommendations.recommendations,
			...this.experimentalRecommendations.recommendations,
			...this.fileBasedRecommendations.recommendations,
			...this.workspaceRecommendations.recommendations,
			...this.keymapRecommendations.recommendations,
		];

		for (const { extensionId, reason } of allRecommendations) {
			if (this.isExtensionAllowedToBeRecommended(extensionId)) {
				output[extensionId.toLowerCase()] = reason;
			}
		}

		return output;
	}

	async getConfigBasedRecommendations(): Promise<IExtensionRecommendation[]> {
		await this.configBasedRecommendations.activate();
		return this.toExtensionRecommendations(this.configBasedRecommendations.recommendations);
	}

	async getOtherRecommendations(): Promise<IExtensionRecommendation[]> {
		await this.activateProactiveRecommendations();

		const recommendations = [
			...this.configBasedRecommendations.otherRecommendations,
			...this.exeBasedRecommendations.otherRecommendations,
			...this.dynamicWorkspaceRecommendations.recommendations,
			...this.experimentalRecommendations.recommendations
		];

		const extensionIds = distinct(recommendations.map(e => e.extensionId))
			.filter(extensionId => this.isExtensionAllowedToBeRecommended(extensionId));

		shuffle(extensionIds, this.sessionSeed);

		return extensionIds.map(extensionId => {
			const sources: ExtensionRecommendationSource[] = distinct(recommendations.filter(r => r.extensionId === extensionId).map(r => r.source));
			return (<IExtensionRecommendation>{ extensionId, sources });
		});
	}

	async getImportantRecommendations(): Promise<IExtensionRecommendation[]> {
		await this.activateProactiveRecommendations();

		const recommendations = [
			...this.fileBasedRecommendations.importantRecommendations,
			...this.configBasedRecommendations.importantRecommendations,
			...this.exeBasedRecommendations.importantRecommendations,
		];

		const extensionIds = distinct(recommendations.map(e => e.extensionId))
			.filter(extensionId => this.isExtensionAllowedToBeRecommended(extensionId));

		shuffle(extensionIds, this.sessionSeed);

		return extensionIds.map(extensionId => {
			const sources: ExtensionRecommendationSource[] = distinct(recommendations.filter(r => r.extensionId === extensionId).map(r => r.source));
			return (<IExtensionRecommendation>{ extensionId, sources });
		});
	}

	getKeymapRecommendations(): IExtensionRecommendation[] {
		return this.toExtensionRecommendations(this.keymapRecommendations.recommendations);
	}

	async getWorkspaceRecommendations(): Promise<IExtensionRecommendation[]> {
		if (!this.isEnabled()) {
			return [];
		}
		await this.workspaceRecommendations.activate();
		return this.toExtensionRecommendations(this.workspaceRecommendations.recommendations);
	}

	async getExeBasedRecommendations(exe?: string): Promise<{ important: IExtensionRecommendation[], others: IExtensionRecommendation[] }> {
		await this.exeBasedRecommendations.activate();
		const { important, others } = exe ? this.exeBasedRecommendations.getRecommendations(exe)
			: { important: this.exeBasedRecommendations.importantRecommendations, others: this.exeBasedRecommendations.otherRecommendations };
		return { important: this.toExtensionRecommendations(important), others: this.toExtensionRecommendations(others) };
	}

	getFileBasedRecommendations(): IExtensionRecommendation[] {
		return this.toExtensionRecommendations(this.fileBasedRecommendations.recommendations);
	}

	getIgnoredRecommendations(): ReadonlyArray<string> {
		return this.globallyIgnoredRecommendations;
	}

	toggleIgnoredRecommendation(extensionId: string, shouldIgnore: boolean) {
		extensionId = extensionId.toLowerCase();
		const ignored = this.globallyIgnoredRecommendations.indexOf(extensionId) !== -1;
		if (ignored === shouldIgnore) {
			return;
		}

		if (shouldIgnore) {
			const reason = this.getAllRecommendationsWithReason()[extensionId];
			if (reason && reason.reasonId) {
				this.telemetryService.publicLog2<{ extensionId: string, recommendationReason: ExtensionRecommendationReason }, IgnoreRecommendationClassification>('extensionsRecommendations:ignoreRecommendation', { extensionId, recommendationReason: reason.reasonId });
			}
		}

		this.globallyIgnoredRecommendations = shouldIgnore ? [...this.globallyIgnoredRecommendations, extensionId] : this.globallyIgnoredRecommendations.filter(id => id !== extensionId);
		this.storeCachedIgnoredRecommendations(this.globallyIgnoredRecommendations);
		this._onRecommendationChange.fire({ extensionId, isRecommended: !shouldIgnore });
	}

	private onDidInstallExtension(e: DidInstallExtensionEvent): void {
		if (e.gallery && e.operation === InstallOperation.Install) {
			const extRecommendations = this.getAllRecommendationsWithReason() || {};
			const recommendationReason = extRecommendations[e.gallery.identifier.id.toLowerCase()];
			if (recommendationReason) {
				/* __GDPR__
					"extensionGallery:install:recommendations" : {
						"recommendationReason": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
						"${include}": [
							"${GalleryExtensionTelemetryData}"
						]
					}
				*/
				this.telemetryService.publicLog('extensionGallery:install:recommendations', assign(e.gallery.telemetryData, { recommendationReason: recommendationReason.reasonId }));
			}
		}
	}

	private toExtensionRecommendations(recommendations: ReadonlyArray<ExtensionRecommendation>): IExtensionRecommendation[] {
		const extensionIds = distinct(recommendations.map(e => e.extensionId))
			.filter(extensionId => this.isExtensionAllowedToBeRecommended(extensionId));

		return extensionIds.map(extensionId => {
			const sources: ExtensionRecommendationSource[] = distinct(recommendations.filter(r => r.extensionId === extensionId).map(r => r.source));
			return (<IExtensionRecommendation>{ extensionId, sources });
		});
	}

	private isExtensionAllowedToBeRecommended(id: string): boolean {
		const allIgnoredRecommendations = [
			...this.globallyIgnoredRecommendations,
			...this.workspaceRecommendations.ignoredRecommendations
		];
		return allIgnoredRecommendations.indexOf(id.toLowerCase()) === -1;
	}

	private async getInstallableExtensions(extensionIds: string[]): Promise<IExtension[]> {
		const extensions: IExtension[] = [];
		const pager = await this.extensionsWorkbenchService.queryGallery({ names: extensionIds, pageSize: extensionIds.length, source: 'install-recommendations' }, CancellationToken.None);
		for (const extension of pager.firstPage) {
			if (extension.gallery && (await this.extensionManagementService.canInstall(extension.gallery))) {
				extensions.push(extension);
			}
		}
		return extensions;
	}

	private async promptWorkspaceRecommendations(): Promise<void> {
		const allowedRecommendations = [...this.workspaceRecommendations.recommendations, ...this.configBasedRecommendations.importantRecommendations]
			.map(({ extensionId }) => extensionId)
			.filter(extensionId => this.isExtensionAllowedToBeRecommended(extensionId));

		const config = this.configurationService.getValue<IExtensionsConfiguration>(ConfigurationKey);
		if (allowedRecommendations.length === 0
			|| config.ignoreRecommendations || config.showRecommendationsOnlyOnDemand
			|| this.storageService.getBoolean(ignoreWorkspaceRecommendationsStorageKey, StorageScope.WORKSPACE, false)) {
			return;
		}

		let installed = await this.extensionManagementService.getInstalled();
		installed = installed.filter(l => this.extensionEnablementService.getEnablementState(l) !== EnablementState.DisabledByExtensionKind); // Filter extensions disabled by kind
		const recommendations = allowedRecommendations.filter(extensionId => installed.every(local => !areSameExtensions({ id: extensionId }, local.identifier)));

		if (!recommendations.length) {
			return;
		}

		const extensions = await this.getInstallableExtensions(recommendations);
		if (!extensions.length) {
			return;
		}

		const searchValue = '@recommended ';
		this.notificationService.prompt(
			Severity.Info,
			localize('workspaceRecommended', "Do you want to install the recommended extensions for this repository?"),
			[{
				label: localize('install', "Install"),
				run: async () => {
					this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'install' });
					await Promise.all(extensions.map(async extension => {
						this.extensionsWorkbenchService.open(extension, { pinned: true });
						await this.extensionManagementService.installFromGallery(extension.gallery!);
					}));
				}
			}, {
				label: localize('showRecommendations', "Show Recommendations"),
				run: async () => {
					this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'show' });
					const action = this.instantiationService.createInstance(SearchExtensionsAction, searchValue);
					try {
						await action.run();
					} finally {
						action.dispose();
					}
				}
			}, {
				label: localize('neverShowAgain', "Don't Show Again"),
				isSecondary: true,
				run: () => {
					this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'neverShowAgain' });
					this.storageService.store(ignoreWorkspaceRecommendationsStorageKey, true, StorageScope.WORKSPACE);
				}
			}],
			{
				sticky: true,
				onCancel: () => {
					this.telemetryService.publicLog2<{ userReaction: string }, ExtensionWorkspaceRecommendationsNotificationClassification>('extensionWorkspaceRecommendations:popup', { userReaction: 'cancelled' });
				}
			}
		);
	}

	private onDidStorageChange(e: IWorkspaceStorageChangeEvent): void {
		if (e.key === ignoredRecommendationsStorageKey && e.scope === StorageScope.GLOBAL
			&& this.ignoredRecommendationsValue !== this.getStoredIgnoredRecommendationsValue() /* This checks if current window changed the value or not */) {
			this._ignoredRecommendationsValue = undefined;
			this.globallyIgnoredRecommendations = this.getCachedIgnoredRecommendations();
		}
	}

	private getCachedIgnoredRecommendations(): string[] {
		const ignoredRecommendations: string[] = JSON.parse(this.ignoredRecommendationsValue);
		return ignoredRecommendations.map(e => e.toLowerCase());
	}

	private storeCachedIgnoredRecommendations(ignoredRecommendations: string[]): void {
		this.ignoredRecommendationsValue = JSON.stringify(ignoredRecommendations);
	}

	private _ignoredRecommendationsValue: string | undefined;
	private get ignoredRecommendationsValue(): string {
		if (!this._ignoredRecommendationsValue) {
			this._ignoredRecommendationsValue = this.getStoredIgnoredRecommendationsValue();
		}

		return this._ignoredRecommendationsValue;
	}

	private set ignoredRecommendationsValue(ignoredRecommendationsValue: string) {
		if (this.ignoredRecommendationsValue !== ignoredRecommendationsValue) {
			this._ignoredRecommendationsValue = ignoredRecommendationsValue;
			this.setStoredIgnoredRecommendationsValue(ignoredRecommendationsValue);
		}
	}

	private getStoredIgnoredRecommendationsValue(): string {
		return this.storageService.get(ignoredRecommendationsStorageKey, StorageScope.GLOBAL, '[]');
	}

	private setStoredIgnoredRecommendationsValue(value: string): void {
		this.storageService.store(ignoredRecommendationsStorageKey, value, StorageScope.GLOBAL);
	}

}
