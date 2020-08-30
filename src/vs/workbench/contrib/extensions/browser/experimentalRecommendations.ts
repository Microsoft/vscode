/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { ExtensionRecommendations, ExtensionRecommendation } from 'vs/workbench/contrib/extensions/browser/extensionRecommendations';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ExtensionRecommendationReason } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IExperimentService, ExperimentActionType, ExperimentState } from 'vs/workbench/contrib/experiments/common/experimentService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';

export class ExperimentalRecommendations extends ExtensionRecommendations {

	private _recommendations: ExtensionRecommendation[] = [];
	get recommendations(): ReadonlyArray<ExtensionRecommendation> { return this._recommendations; }

	constructor(
		isExtensionAllowedToBeRecommended: (extensionId: string) => boolean,
		@IExperimentService private readonly experimentService: IExperimentService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@INotificationService notificationService: INotificationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
		@IExtensionManagementService extensionManagementService: IExtensionManagementService,
		@IExtensionsWorkbenchService extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IStorageKeysSyncRegistryService storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
	) {
		super(isExtensionAllowedToBeRecommended, instantiationService, configurationService, notificationService, telemetryService, storageService, extensionsWorkbenchService, extensionManagementService, storageKeysSyncRegistryService);
	}

	/**
	 * Fetch extensions used by others on the same workspace as recommendations
	 */
	protected async doActivate(): Promise<void> {
		const experiments = await this.experimentService.getExperimentsByType(ExperimentActionType.AddToRecommendations);
		for (const { action, state } of experiments) {
			if (state === ExperimentState.Run && isNonEmptyArray(action?.properties?.recommendations) && action?.properties?.recommendationReason) {
				action.properties.recommendations.forEach((extensionId: string) => this._recommendations.push({
					extensionId: extensionId.toLowerCase(),
					source: 'experimental',
					reason: {
						reasonId: ExtensionRecommendationReason.Experimental,
						reasonText: action.properties.recommendationReason
					}
				}));
			}
		}
	}

}

