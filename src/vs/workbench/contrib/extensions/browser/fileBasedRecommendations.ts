/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionManagementService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { ExtensionRecommendations, ExtensionRecommendation } from 'vs/workbench/contrib/extensions/browser/extensionRecommendations';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { ExtensionRecommendationSource, ExtensionRecommendationReason } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IExtensionsViewPaneContainer, IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';
import { CancellationToken } from 'vs/base/common/cancellation';
import { localize } from 'vs/nls';
import { StorageScope, IStorageService } from 'vs/platform/storage/common/storage';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IProductService } from 'vs/platform/product/common/productService';
import { forEach, IStringDictionary } from 'vs/base/common/collections';
import { ITextModel } from 'vs/editor/common/model';
import { Schemas } from 'vs/base/common/network';
import { extname } from 'vs/base/common/resources';
import { match } from 'vs/base/common/glob';
import { URI } from 'vs/base/common/uri';
import { MIME_UNKNOWN, guessMimeTypes } from 'vs/base/common/mime';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IStorageKeysSyncRegistryService } from 'vs/platform/userDataSync/common/storageKeys';
import { setImmediate } from 'vs/base/common/platform';

type FileExtensionSuggestionClassification = {
	userReaction: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	fileExtension: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
};

const recommendationsStorageKey = 'extensionsAssistant/recommendations';
const searchMarketplace = localize('searchMarketplace', "Search Marketplace");
const milliSecondsInADay = 1000 * 60 * 60 * 24;
const processedFileExtensions: string[] = [];

export class FileBasedRecommendations extends ExtensionRecommendations {

	private readonly extensionTips: IStringDictionary<string> = Object.create(null);
	private readonly importantExtensionTips: IStringDictionary<{ name: string; pattern: string; isExtensionPack?: boolean }> = Object.create(null);

	private fileBasedRecommendationsByPattern: IStringDictionary<string[]> = Object.create(null);
	private fileBasedRecommendations: IStringDictionary<{ recommendedTime: number, sources: ExtensionRecommendationSource[] }> = Object.create(null);

	get recommendations(): ReadonlyArray<ExtensionRecommendation> {
		const recommendations: ExtensionRecommendation[] = [];
		Object.keys(this.fileBasedRecommendations)
			.sort((a, b) => {
				if (this.fileBasedRecommendations[a].recommendedTime === this.fileBasedRecommendations[b].recommendedTime) {
					if (this.importantExtensionTips[a]) {
						return -1;
					}
					if (this.importantExtensionTips[b]) {
						return 1;
					}
				}
				return this.fileBasedRecommendations[a].recommendedTime > this.fileBasedRecommendations[b].recommendedTime ? -1 : 1;
			})
			.forEach(extensionId => {
				for (const source of this.fileBasedRecommendations[extensionId].sources) {
					recommendations.push({
						extensionId,
						source,
						reason: {
							reasonId: ExtensionRecommendationReason.File,
							reasonText: localize('fileBasedRecommendation', "This extension is recommended based on the files you recently opened.")
						}
					});
				}
			});
		return recommendations;
	}

	constructor(
		isExtensionAllowedToBeRecommended: (extensionId: string) => boolean,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IViewletService private readonly viewletService: IViewletService,
		@IModelService private readonly modelService: IModelService,
		@IProductService productService: IProductService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@INotificationService notificationService: INotificationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
		@IStorageKeysSyncRegistryService storageKeysSyncRegistryService: IStorageKeysSyncRegistryService,
	) {
		super(isExtensionAllowedToBeRecommended, instantiationService, configurationService, notificationService, telemetryService, storageService, storageKeysSyncRegistryService);

		if (productService.extensionTips) {
			forEach(productService.extensionTips, ({ key, value }) => this.extensionTips[key.toLowerCase()] = value);
		}
		if (productService.extensionImportantTips) {
			forEach(productService.extensionImportantTips, ({ key, value }) => this.importantExtensionTips[key.toLowerCase()] = value);
		}
	}

	protected async doActivate(): Promise<void> {
		const allRecommendations: string[] = [];

		// group extension recommendations by pattern, like {**/*.md} -> [ext.foo1, ext.bar2]
		forEach(this.extensionTips, ({ key: extensionId, value: pattern }) => {
			const ids = this.fileBasedRecommendationsByPattern[pattern] || [];
			ids.push(extensionId);
			this.fileBasedRecommendationsByPattern[pattern] = ids;
			allRecommendations.push(extensionId);
		});
		forEach(this.importantExtensionTips, ({ key: extensionId, value }) => {
			const ids = this.fileBasedRecommendationsByPattern[value.pattern] || [];
			ids.push(extensionId);
			this.fileBasedRecommendationsByPattern[value.pattern] = ids;
			allRecommendations.push(extensionId);
		});

		const cachedRecommendations = this.getCachedRecommendations();
		const now = Date.now();
		// Retire existing recommendations if they are older than a week or are not part of this.productService.extensionTips anymore
		forEach(cachedRecommendations, ({ key, value }) => {
			const diff = (now - value) / milliSecondsInADay;
			if (diff <= 7 && allRecommendations.indexOf(key) > -1) {
				this.fileBasedRecommendations[key] = { recommendedTime: value, sources: ['cached'] };
			}
		});

		this._register(this.modelService.onModelAdded(this.promptRecommendationsForModel, this));
		this.modelService.getModels().forEach(model => this.promptRecommendationsForModel(model));
	}

	/**
	 * Prompt the user to either install the recommended extension for the file type in the current editor model
	 * or prompt to search the marketplace if it has extensions that can support the file type
	 */
	private promptRecommendationsForModel(model: ITextModel): void {
		const uri = model.uri;
		const supportedSchemes = [Schemas.untitled, Schemas.file, Schemas.vscodeRemote];
		if (!uri || supportedSchemes.indexOf(uri.scheme) === -1) {
			return;
		}

		let fileExtension = extname(uri);
		if (fileExtension) {
			if (processedFileExtensions.indexOf(fileExtension) > -1) {
				return;
			}
			processedFileExtensions.push(fileExtension);
		}

		// re-schedule this bit of the operation to be off the critical path - in case glob-match is slow
		setImmediate(() => this.promptRecommendations(uri, fileExtension));
	}

	private async promptRecommendations(uri: URI, fileExtension: string): Promise<void> {
		const recommendationsToPrompt: string[] = [];
		forEach(this.fileBasedRecommendationsByPattern, ({ key: pattern, value: extensionIds }) => {
			if (match(pattern, uri.toString())) {
				for (const extensionId of extensionIds) {
					// Add to recommendation to prompt if it is an important tip
					// Only prompt if the pattern matches the extensionImportantTips pattern
					// Otherwise, assume pattern is from extensionTips, which means it should be a file based "passive" recommendation
					if (this.importantExtensionTips[extensionId]?.pattern === pattern) {
						recommendationsToPrompt.push(extensionId);
					}
					// Update file based recommendations
					const filedBasedRecommendation = this.fileBasedRecommendations[extensionId] || { recommendedTime: Date.now(), sources: [] };
					filedBasedRecommendation.recommendedTime = Date.now();
					if (!filedBasedRecommendation.sources.some(s => s instanceof URI && s.toString() === uri.toString())) {
						filedBasedRecommendation.sources.push(uri);
					}
					this.fileBasedRecommendations[extensionId.toLowerCase()] = filedBasedRecommendation;
				}
			}
		});

		this.storeCachedRecommendations();

		if (this.hasToIgnoreRecommendationNotifications()) {
			return;
		}

		const installed = await this.extensionManagementService.getInstalled();
		if (await this.promptRecommendedExtensionForFileType(recommendationsToPrompt, installed)) {
			return;
		}

		if (fileExtension) {
			fileExtension = fileExtension.substr(1); // Strip the dot
		}
		if (!fileExtension) {
			return;
		}

		await this.extensionService.whenInstalledExtensionsRegistered();
		const mimeTypes = guessMimeTypes(uri);
		if (mimeTypes.length !== 1 || mimeTypes[0] !== MIME_UNKNOWN) {
			return;
		}

		this.promptRecommendedExtensionForFileExtension(fileExtension, installed);
	}

	private async promptRecommendedExtensionForFileType(recommendations: string[], installed: ILocalExtension[]): Promise<boolean> {

		recommendations = this.filterIgnoredOrNotAllowed(recommendations);
		if (recommendations.length === 0) {
			return false;
		}

		recommendations = this.filterInstalled(recommendations, installed);
		if (recommendations.length === 0) {
			return false;
		}

		const extensionId = recommendations[0];
		const entry = this.importantExtensionTips[extensionId];
		if (!entry) {
			return false;
		}
		const extensionName = entry.name;
		let message = localize('reallyRecommended2', "The '{0}' extension is recommended for this file type.", extensionName);
		if (entry.isExtensionPack) {
			message = localize('reallyRecommendedExtensionPack', "The '{0}' extension pack is recommended for this file type.", extensionName);
		}

		this.promptImportantExtensionInstallNotification(extensionId, message);
		return true;
	}

	private async promptRecommendedExtensionForFileExtension(fileExtension: string, installed: ILocalExtension[]): Promise<void> {
		const fileExtensionSuggestionIgnoreList = <string[]>JSON.parse(this.storageService.get('extensionsAssistant/fileExtensionsSuggestionIgnore', StorageScope.GLOBAL, '[]'));
		if (fileExtensionSuggestionIgnoreList.indexOf(fileExtension) > -1) {
			return;
		}

		const text = `ext:${fileExtension}`;
		const pager = await this.extensionsWorkbenchService.queryGallery({ text, pageSize: 100 }, CancellationToken.None);
		if (pager.firstPage.length === 0) {
			return;
		}

		const installedExtensionsIds = installed.reduce((result, i) => { result.add(i.identifier.id.toLowerCase()); return result; }, new Set<string>());
		if (pager.firstPage.some(e => installedExtensionsIds.has(e.identifier.id.toLowerCase()))) {
			return;
		}

		this.notificationService.prompt(
			Severity.Info,
			localize('showLanguageExtensions', "The Marketplace has extensions that can help with '.{0}' files", fileExtension),
			[{
				label: searchMarketplace,
				run: () => {
					this.telemetryService.publicLog2<{ userReaction: string, fileExtension: string }, FileExtensionSuggestionClassification>('fileExtensionSuggestion:popup', { userReaction: 'ok', fileExtension });
					this.viewletService.openViewlet('workbench.view.extensions', true)
						.then(viewlet => viewlet?.getViewPaneContainer() as IExtensionsViewPaneContainer)
						.then(viewlet => {
							viewlet.search(`ext:${fileExtension}`);
							viewlet.focus();
						});
				}
			}, {
				label: localize('dontShowAgainExtension', "Don't Show Again for '.{0}' files", fileExtension),
				run: () => {
					fileExtensionSuggestionIgnoreList.push(fileExtension);
					this.storageService.store(
						'extensionsAssistant/fileExtensionsSuggestionIgnore',
						JSON.stringify(fileExtensionSuggestionIgnoreList),
						StorageScope.GLOBAL
					);
					this.telemetryService.publicLog2<{ userReaction: string, fileExtension: string }, FileExtensionSuggestionClassification>('fileExtensionSuggestion:popup', { userReaction: 'neverShowAgain', fileExtension });
				}
			}],
			{
				sticky: true,
				onCancel: () => {
					this.telemetryService.publicLog2<{ userReaction: string, fileExtension: string }, FileExtensionSuggestionClassification>('fileExtensionSuggestion:popup', { userReaction: 'cancelled', fileExtension });
				}
			}
		);
	}

	private filterInstalled(recommendationsToSuggest: string[], installed: ILocalExtension[]): string[] {
		const installedExtensionsIds = installed.reduce((result, i) => { result.add(i.identifier.id.toLowerCase()); return result; }, new Set<string>());
		return recommendationsToSuggest.filter(id => !installedExtensionsIds.has(id.toLowerCase()));
	}

	private getCachedRecommendations(): IStringDictionary<number> {
		let storedRecommendations = JSON.parse(this.storageService.get(recommendationsStorageKey, StorageScope.GLOBAL, '[]'));
		if (Array.isArray<string>(storedRecommendations)) {
			storedRecommendations = storedRecommendations.reduce((result, id) => { result[id] = Date.now(); return result; }, <IStringDictionary<number>>{});
		}
		const result: IStringDictionary<number> = {};
		forEach(storedRecommendations, ({ key, value }) => {
			if (typeof value === 'number') {
				result[key.toLowerCase()] = value;
			}
		});
		return result;
	}

	private storeCachedRecommendations(): void {
		const storedRecommendations: IStringDictionary<number> = {};
		forEach(this.fileBasedRecommendations, ({ key, value }) => storedRecommendations[key] = value.recommendedTime);
		this.storageService.store(recommendationsStorageKey, JSON.stringify(storedRecommendations), StorageScope.GLOBAL);
	}
}

