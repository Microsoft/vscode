/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IExtensionManagementService, IExtensionGalleryService, InstallOperation, DidInstallExtensionEvent } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionRecommendationsService, ExtensionRecommendationReason, IExtensionIgnoredRecommendationsService } from 'vs/workbench/services/extensionRecommendations/common/extensionRecommendations';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { distinct, shuffle } from 'vs/base/common/arrays';
import { Emitter, Event } from 'vs/base/common/event';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { LifecyclePhase, ILifecycleService } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { DynamicWorkspaceRecommendations } from 'vs/workbench/contrib/extensions/browser/dynamicWorkspaceRecommendations';
import { ExeBasedRecommendations } from 'vs/workbench/contrib/extensions/browser/exeBasedRecommendations';
import { ExperimentalRecommendations } from 'vs/workbench/contrib/extensions/browser/experimentalRecommendations';
import { WorkspaceRecommendations } from 'vs/workbench/contrib/extensions/browser/workspaceRecommendations';
import { FileBasedRecommendations } from 'vs/workbench/contrib/extensions/browser/fileBasedRecommendations';
import { KeymapRecommendations } from 'vs/workbench/contrib/extensions/browser/keymapRecommendations';
import { ExtensionRecommendation } from 'vs/workbench/contrib/extensions/browser/extensionRecommendations';
import { ConfigBasedRecommendations } from 'vs/workbench/contrib/extensions/browser/configBasedRecommendations';
import { IExtensionRecommendationNotificationService } from 'vs/platform/extensionRecommendations/common/extensionRecommendations';

type IgnoreRecommendationClassification = {
	recommendationReason: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
	extensionId: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
};

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

	public readonly activationPromise: Promise<void>;
	private sessionSeed: number;

	private _onDidChangeRecommendations = this._register(new Emitter<void>());
	readonly onDidChangeRecommendations = this._onDidChangeRecommendations.event;

	constructor(
		@IInstantiationService instantiationService: IInstantiationService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IExtensionIgnoredRecommendationsService private readonly extensionRecommendationsManagementService: IExtensionIgnoredRecommendationsService,
		@IExtensionRecommendationNotificationService private readonly extensionRecommendationNotificationService: IExtensionRecommendationNotificationService,
	) {
		super();

		this.workspaceRecommendations = instantiationService.createInstance(WorkspaceRecommendations);
		this.fileBasedRecommendations = instantiationService.createInstance(FileBasedRecommendations);
		this.experimentalRecommendations = instantiationService.createInstance(ExperimentalRecommendations);
		this.configBasedRecommendations = instantiationService.createInstance(ConfigBasedRecommendations);
		this.exeBasedRecommendations = instantiationService.createInstance(ExeBasedRecommendations);
		this.dynamicWorkspaceRecommendations = instantiationService.createInstance(DynamicWorkspaceRecommendations);
		this.keymapRecommendations = instantiationService.createInstance(KeymapRecommendations);

		if (!this.isEnabled()) {
			this.sessionSeed = 0;
			this.activationPromise = Promise.resolve();
			return;
		}

		this.sessionSeed = +new Date();

		// Activation
		this.activationPromise = this.activate();

		this._register(this.extensionManagementService.onDidInstallExtension(e => this.onDidInstallExtension(e)));
	}

	private async activate(): Promise<void> {
		await this.lifecycleService.when(LifecyclePhase.Restored);

		// activate all recommendations
		await Promise.all([
			this.workspaceRecommendations.activate(),
			this.fileBasedRecommendations.activate(),
			this.experimentalRecommendations.activate(),
			this.keymapRecommendations.activate(),
		]);

		this._register(Event.any(this.workspaceRecommendations.onDidChangeRecommendations, this.configBasedRecommendations.onDidChangeRecommendations, this.extensionRecommendationsManagementService.onDidChangeIgnoredRecommendations)(() => this._onDidChangeRecommendations.fire()));
		this._register(this.extensionRecommendationsManagementService.onDidChangeGlobalIgnoredRecommendation(({ extensionId, isRecommended }) => {
			if (!isRecommended) {
				const reason = this.getAllRecommendationsWithReason()[extensionId];
				if (reason && reason.reasonId) {
					this.telemetryService.publicLog2<{ extensionId: string, recommendationReason: ExtensionRecommendationReason }, IgnoreRecommendationClassification>('extensionsRecommendations:ignoreRecommendation', { extensionId, recommendationReason: reason.reasonId });
				}
			}
		}));

		await this.promptWorkspaceRecommendations();
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

	async getConfigBasedRecommendations(): Promise<{ important: string[], others: string[] }> {
		await this.configBasedRecommendations.activate();
		return {
			important: this.toExtensionRecommendations(this.configBasedRecommendations.importantRecommendations),
			others: this.toExtensionRecommendations(this.configBasedRecommendations.otherRecommendations)
		};
	}

	async getOtherRecommendations(): Promise<string[]> {
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

		return extensionIds;
	}

	async getImportantRecommendations(): Promise<string[]> {
		await this.activateProactiveRecommendations();

		const recommendations = [
			...this.fileBasedRecommendations.importantRecommendations,
			...this.configBasedRecommendations.importantRecommendations,
			...this.exeBasedRecommendations.importantRecommendations,
		];

		const extensionIds = distinct(recommendations.map(e => e.extensionId))
			.filter(extensionId => this.isExtensionAllowedToBeRecommended(extensionId));

		shuffle(extensionIds, this.sessionSeed);

		return extensionIds;
	}

	getKeymapRecommendations(): string[] {
		return this.toExtensionRecommendations(this.keymapRecommendations.recommendations);
	}

	async getWorkspaceRecommendations(): Promise<string[]> {
		if (!this.isEnabled()) {
			return [];
		}
		await this.workspaceRecommendations.activate();
		return this.toExtensionRecommendations(this.workspaceRecommendations.recommendations);
	}

	async getExeBasedRecommendations(exe?: string): Promise<{ important: string[], others: string[] }> {
		await this.exeBasedRecommendations.activate();
		const { important, others } = exe ? this.exeBasedRecommendations.getRecommendations(exe)
			: { important: this.exeBasedRecommendations.importantRecommendations, others: this.exeBasedRecommendations.otherRecommendations };
		return { important: this.toExtensionRecommendations(important), others: this.toExtensionRecommendations(others) };
	}

	getFileBasedRecommendations(): string[] {
		return this.toExtensionRecommendations(this.fileBasedRecommendations.recommendations);
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
				this.telemetryService.publicLog('extensionGallery:install:recommendations', { ...e.gallery.telemetryData, recommendationReason: recommendationReason.reasonId });
			}
		}
	}

	private toExtensionRecommendations(recommendations: ReadonlyArray<ExtensionRecommendation>): string[] {
		const extensionIds = distinct(recommendations.map(e => e.extensionId))
			.filter(extensionId => this.isExtensionAllowedToBeRecommended(extensionId));

		return extensionIds;
	}

	private isExtensionAllowedToBeRecommended(extensionId: string): boolean {
		return !this.extensionRecommendationsManagementService.ignoredRecommendations.includes(extensionId.toLowerCase());
	}

	private async promptWorkspaceRecommendations(): Promise<void> {
		const allowedRecommendations = [...this.workspaceRecommendations.recommendations, ...this.configBasedRecommendations.importantRecommendations]
			.map(({ extensionId }) => extensionId)
			.filter(extensionId => this.isExtensionAllowedToBeRecommended(extensionId));

		if (allowedRecommendations.length) {
			await this.extensionRecommendationNotificationService.promptWorkspaceRecommendations(allowedRecommendations);
		}
	}



}
