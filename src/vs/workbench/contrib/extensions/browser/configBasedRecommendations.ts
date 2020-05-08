/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionTipsService, IExtensionManagementService, ILocalExtension, IConfigBasedExtensionTip } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ExtensionRecommendations, ExtensionRecommendation } from 'vs/workbench/contrib/extensions/browser/extensionRecommendations';
import { localize } from 'vs/nls';
import { ExtensionType } from 'vs/platform/extensions/common/extensions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { ExtensionRecommendationReason } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { IWorkspaceContextService, IWorkspaceFoldersChangeEvent } from 'vs/platform/workspace/common/workspace';
import { distinct } from 'vs/base/common/arrays';
import { values } from 'vs/base/common/map';

export class ConfigBasedRecommendations extends ExtensionRecommendations {

	private importantTips: IConfigBasedExtensionTip[] = [];
	private otherTips: IConfigBasedExtensionTip[] = [];

	private _recommendations: ExtensionRecommendation[] = [];
	get recommendations(): ReadonlyArray<ExtensionRecommendation> { return this._recommendations; }

	constructor(
		isExtensionAllowedToBeRecommended: (extensionId: string) => boolean,
		@IExtensionTipsService private readonly extensionTipsService: IExtensionTipsService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@INotificationService notificationService: INotificationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
		@IStorageKeysSyncRegistryService storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
	) {
		super(isExtensionAllowedToBeRecommended, instantiationService, configurationService, notificationService, telemetryService, storageService, storageKeysSyncRegistryService);
	}

	protected async doActivate(): Promise<void> {
		await this.fetch();
		this._register(this.workspaceContextService.onDidChangeWorkspaceFolders(e => this.onWorkspaceFoldersChanged(e)));
		this.promptWorkspaceRecommendations();
	}

	private async fetch(): Promise<void> {
		const workspace = this.workspaceContextService.getWorkspace();
		const importantTips: Map<string, IConfigBasedExtensionTip> = new Map<string, IConfigBasedExtensionTip>();
		const otherTips: Map<string, IConfigBasedExtensionTip> = new Map<string, IConfigBasedExtensionTip>();
		for (const folder of workspace.folders) {
			const configBasedTips = await this.extensionTipsService.getConfigBasedTips(folder.uri);
			for (const tip of configBasedTips) {
				if (tip.important) {
					importantTips.set(tip.extensionId, tip);
				} else {
					otherTips.set(tip.extensionId, tip);
				}
			}
		}
		this.importantTips = values(importantTips);
		this.otherTips = values(otherTips).filter(tip => !importantTips.has(tip.extensionId));
		this._recommendations = [...this.importantTips, ...this.otherTips].map(tip => this.toExtensionRecommendation(tip));
	}

	private async promptWorkspaceRecommendations(): Promise<void> {
		if (this.hasToIgnoreRecommendationNotifications()) {
			return;
		}

		if (this.importantTips.length === 0) {
			return;
		}

		const local = await this.extensionManagementService.getInstalled(ExtensionType.User);
		const { uninstalled } = this.groupByInstalled(distinct(this.importantTips.map(({ extensionId }) => extensionId)), local);
		if (uninstalled.length === 0) {
			return;
		}

		const importantExtensions = this.filterIgnoredOrNotAllowed(uninstalled);
		if (importantExtensions.length === 0) {
			return;
		}

		for (const extension of importantExtensions) {
			const tip = this.importantTips.filter(tip => tip.extensionId === extension)[0];
			const message = tip.isExtensionPack ? localize('extensionPackRecommended', "The '{0}' extension pack is recommended for this workspace.", tip.extensionName)
				: localize('extensionRecommended', "The '{0}' extension is recommended for this workspace.", tip.extensionName);
			this.promptImportantExtensionInstallNotification(extension, message);
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

	private async onWorkspaceFoldersChanged(event: IWorkspaceFoldersChangeEvent): Promise<void> {
		if (event.added.length) {
			const oldImportantRecommended = this.importantTips;
			await this.fetch();
			// Suggest only if at least one of the newly added recommendations was not suggested before
			if (this.importantTips.some(current => oldImportantRecommended.every(old => current.extensionId !== old.extensionId))) {
				return this.promptWorkspaceRecommendations();
			}
		}
	}

	private toExtensionRecommendation(tip: IConfigBasedExtensionTip): ExtensionRecommendation {
		return {
			extensionId: tip.extensionId,
			source: 'config',
			reason: {
				reasonId: ExtensionRecommendationReason.WorkspaceConfig,
				reasonText: localize('exeBasedRecommendation', "This extension is recommended because of the current workspace configuration")
			}
		};
	}

}
