/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionTipsService, IExecutableBasedExtensionTip, IExtensionManagementService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ExtensionRecommendations, ExtensionRecommendation } from 'vs/workbench/contrib/extensions/browser/extensionRecommendations';
import { timeout } from 'vs/base/common/async';
import { localize } from 'vs/nls';
import { IInstantiationService, optional } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { basename } from 'vs/base/common/path';
import { ExtensionRecommendationReason } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { ITASExperimentService } from 'vs/workbench/services/experiment/common/experimentService';
import { IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';

type ExeExtensionRecommendationsClassification = {
	extensionId: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
	exeName: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
};

export class ExeBasedRecommendations extends ExtensionRecommendations {

	private _otherTips: IExecutableBasedExtensionTip[] = [];
	private _importantTips: IExecutableBasedExtensionTip[] = [];

	get otherRecommendations(): ReadonlyArray<ExtensionRecommendation> { return this._otherTips.map(tip => this.toExtensionRecommendation(tip)); }
	get importantRecommendations(): ReadonlyArray<ExtensionRecommendation> { return this._importantTips.map(tip => this.toExtensionRecommendation(tip)); }

	get recommendations(): ReadonlyArray<ExtensionRecommendation> { return [...this.importantRecommendations, ...this.otherRecommendations]; }

	private readonly tasExperimentService: ITASExperimentService | undefined;

	constructor(
		isExtensionAllowedToBeRecommended: (extensionId: string) => boolean,
		@IExtensionTipsService private readonly extensionTipsService: IExtensionTipsService,
		@IExtensionManagementService extensionManagementService: IExtensionManagementService,
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@optional(ITASExperimentService) tasExperimentService: ITASExperimentService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@INotificationService notificationService: INotificationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
		@IStorageKeysSyncRegistryService storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
	) {
		super(isExtensionAllowedToBeRecommended, instantiationService, configurationService, notificationService, telemetryService, storageService, extensionsWorkbenchService, extensionManagementService, storageKeysSyncRegistryService);
		this.tasExperimentService = tasExperimentService;

		/*
			3s has come out to be the good number to fetch and prompt important exe based recommendations
			Also fetch important exe based recommendations for reporting telemetry
		*/
		timeout(3000).then(() => this.fetchAndPromptImportantExeBasedRecommendations());
	}

	getRecommendations(exe: string): { important: ExtensionRecommendation[], others: ExtensionRecommendation[] } {
		const important = this._importantTips
			.filter(tip => tip.exeName.toLowerCase() === exe.toLowerCase())
			.map(tip => this.toExtensionRecommendation(tip));

		const others = this._otherTips
			.filter(tip => tip.exeName.toLowerCase() === exe.toLowerCase())
			.map(tip => this.toExtensionRecommendation(tip));

		return { important, others };
	}

	protected async doActivate(): Promise<void> {
		this._otherTips = await this.extensionTipsService.getOtherExecutableBasedTips();
		await this.fetchImportantExeBasedRecommendations();
	}

	private _importantExeBasedRecommendations: Promise<Map<string, IExecutableBasedExtensionTip>> | undefined;
	private async fetchImportantExeBasedRecommendations(): Promise<Map<string, IExecutableBasedExtensionTip>> {
		if (!this._importantExeBasedRecommendations) {
			this._importantExeBasedRecommendations = this.doFetchImportantExeBasedRecommendations();
		}
		return this._importantExeBasedRecommendations;
	}

	private async doFetchImportantExeBasedRecommendations(): Promise<Map<string, IExecutableBasedExtensionTip>> {
		const importantExeBasedRecommendations = new Map<string, IExecutableBasedExtensionTip>();
		this._importantTips = await this.extensionTipsService.getImportantExecutableBasedTips();
		this._importantTips.forEach(tip => importantExeBasedRecommendations.set(tip.extensionId.toLowerCase(), tip));
		return importantExeBasedRecommendations;
	}

	private async fetchAndPromptImportantExeBasedRecommendations(): Promise<void> {
		const importantExeBasedRecommendations = await this.fetchImportantExeBasedRecommendations();

		const local = await this.extensionManagementService.getInstalled();
		const { installed, uninstalled } = this.groupByInstalled([...importantExeBasedRecommendations.keys()], local);

		/* Log installed and uninstalled exe based recommendations */
		for (const extensionId of installed) {
			const tip = importantExeBasedRecommendations.get(extensionId);
			if (tip) {
				this.telemetryService.publicLog2<{ exeName: string, extensionId: string }, ExeExtensionRecommendationsClassification>('exeExtensionRecommendations:alreadyInstalled', { extensionId, exeName: basename(tip.windowsPath!) });
			}
		}
		for (const extensionId of uninstalled) {
			const tip = importantExeBasedRecommendations.get(extensionId);
			if (tip) {
				this.telemetryService.publicLog2<{ exeName: string, extensionId: string }, ExeExtensionRecommendationsClassification>('exeExtensionRecommendations:notInstalled', { extensionId, exeName: basename(tip.windowsPath!) });
			}
		}

		this.promptImportantExeBasedRecommendations(uninstalled, importantExeBasedRecommendations);
	}

	private async promptImportantExeBasedRecommendations(recommendations: string[], importantExeBasedRecommendations: Map<string, IExecutableBasedExtensionTip>): Promise<void> {
		if (this.hasToIgnoreRecommendationNotifications()) {
			return;
		}
		recommendations = this.filterIgnoredOrNotAllowed(recommendations);
		if (recommendations.length === 0) {
			return;
		}

		const recommendationsByExe = new Map<string, IExecutableBasedExtensionTip[]>();
		for (const extensionId of recommendations) {
			const tip = importantExeBasedRecommendations.get(extensionId);
			if (tip) {
				let tips = recommendationsByExe.get(tip.exeFriendlyName);
				if (!tips) {
					tips = [];
					recommendationsByExe.set(tip.exeFriendlyName, tips);
				}
				tips.push(tip);
			}
		}

		for (const [, tips] of recommendationsByExe) {
			const extensionIds = tips.map(({ extensionId }) => extensionId.toLowerCase());
			if (this.tasExperimentService && extensionIds.indexOf('ms-vscode-remote.remote-wsl') !== -1) {
				await this.tasExperimentService.getTreatment<boolean>('wslpopupaa');
			}

			const message = localize('exeRecommended', "You have {0} installed on your system. Do you want to install the recommended extensions for it?", tips[0].exeFriendlyName);
			this.promptImportantExtensionsInstallNotification(extensionIds, message, `@exe:"${tips[0].exeName}"`);
		}
	}

	private groupByInstalled(recommendationsToSuggest: string[], local: ILocalExtension[]): { installed: string[], uninstalled: string[] } {
		const installed: string[] = [], uninstalled: string[] = [];
		const installedExtensionsIds = local.reduce((result, i) => { result.add(i.identifier.id.toLowerCase()); return result; }, new Set<string>());
		recommendationsToSuggest.forEach(id => {
			if (installedExtensionsIds.has(id.toLowerCase())) {
				installed.push(id);
			} else {
				uninstalled.push(id);
			}
		});
		return { installed, uninstalled };
	}

	private toExtensionRecommendation(tip: IExecutableBasedExtensionTip): ExtensionRecommendation {
		return {
			extensionId: tip.extensionId.toLowerCase(),
			source: 'executable',
			reason: {
				reasonId: ExtensionRecommendationReason.Executable,
				reasonText: localize('exeBasedRecommendation', "This extension is recommended because you have {0} installed.", tip.exeFriendlyName || basename(tip.windowsPath!))
			}
		};
	}

}

