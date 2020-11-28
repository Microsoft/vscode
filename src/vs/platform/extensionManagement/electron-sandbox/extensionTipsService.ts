/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { basename, join, } from 'vs/base/common/path';
import { IProductService } from 'vs/platform/product/common/productService';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { process } from 'vs/base/parts/sandbox/electron-sandbox/globals';
import { IFileService } from 'vs/platform/files/common/files';
import { isWindows } from 'vs/base/common/platform';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { IExecutableBasedExtensionTip, IExtensionManagementService, ILocalExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { forEach, IStringDictionary } from 'vs/base/common/collections';
import { IRequestService } from 'vs/platform/request/common/request';
import { ILogService } from 'vs/platform/log/common/log';
import { ExtensionTipsService as BaseExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionTipsService';
import { disposableTimeout, timeout } from 'vs/base/common/async';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IExtensionRecommendationNotificationService, RecommendationsNotificationResult, RecommendationSource } from 'vs/platform/extensionRecommendations/common/extensionRecommendations';
import { localize } from 'vs/nls';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';

type ExeExtensionRecommendationsClassification = {
	extensionId: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
	exeName: { classification: 'PublicNonPersonalData', purpose: 'FeatureInsight' };
};

type IExeBasedExtensionTips = {
	readonly exeFriendlyName: string,
	readonly windowsPath?: string,
	readonly recommendations: { extensionId: string, extensionName: string, isExtensionPack: boolean }[];
};

const promptedExecutableTipsStorageKey = 'extensionTips/promptedExecutableTips';
const lastPromptedMediumImpExeTimeStorageKey = 'extensionTips/lastPromptedMediumImpExeTime';

export class ExtensionTipsService extends BaseExtensionTipsService {

	_serviceBrand: any;

	private readonly highImportanceExecutableTips: Map<string, IExeBasedExtensionTips> = new Map<string, IExeBasedExtensionTips>();
	private readonly mediumImportanceExecutableTips: Map<string, IExeBasedExtensionTips> = new Map<string, IExeBasedExtensionTips>();
	private readonly allOtherExecutableTips: Map<string, IExeBasedExtensionTips> = new Map<string, IExeBasedExtensionTips>();

	private highImportanceTipsByExe = new Map<string, IExecutableBasedExtensionTip[]>();
	private mediumImportanceTipsByExe = new Map<string, IExecutableBasedExtensionTip[]>();

	constructor(
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IStorageService private readonly storageService: IStorageService,
		@IExtensionRecommendationNotificationService private readonly extensionRecommendationNotificationService: IExtensionRecommendationNotificationService,
		@IFileService fileService: IFileService,
		@IProductService productService: IProductService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
	) {
		super(fileService, productService, requestService, logService);
		if (productService.exeBasedExtensionTips) {
			forEach(productService.exeBasedExtensionTips, ({ key, value: exeBasedExtensionTip }) => {
				const highImportanceRecommendations: { extensionId: string, extensionName: string, isExtensionPack: boolean }[] = [];
				const mediumImportanceRecommendations: { extensionId: string, extensionName: string, isExtensionPack: boolean }[] = [];
				const otherRecommendations: { extensionId: string, extensionName: string, isExtensionPack: boolean }[] = [];
				forEach(exeBasedExtensionTip.recommendations, ({ key: extensionId, value }) => {
					if (value.important) {
						if (exeBasedExtensionTip.important) {
							highImportanceRecommendations.push({ extensionId, extensionName: value.name, isExtensionPack: !!value.isExtensionPack });
						} else {
							mediumImportanceRecommendations.push({ extensionId, extensionName: value.name, isExtensionPack: !!value.isExtensionPack });
						}
					} else {
						otherRecommendations.push({ extensionId, extensionName: value.name, isExtensionPack: !!value.isExtensionPack });
					}
				});
				if (highImportanceRecommendations.length) {
					this.highImportanceExecutableTips.set(key, { exeFriendlyName: exeBasedExtensionTip.friendlyName, windowsPath: exeBasedExtensionTip.windowsPath, recommendations: highImportanceRecommendations });
				}
				if (mediumImportanceRecommendations.length) {
					this.mediumImportanceExecutableTips.set(key, { exeFriendlyName: exeBasedExtensionTip.friendlyName, windowsPath: exeBasedExtensionTip.windowsPath, recommendations: mediumImportanceRecommendations });
				}
				if (otherRecommendations.length) {
					this.allOtherExecutableTips.set(key, { exeFriendlyName: exeBasedExtensionTip.friendlyName, windowsPath: exeBasedExtensionTip.windowsPath, recommendations: otherRecommendations });
				}
			});
		}

		/*
			3s has come out to be the good number to fetch and prompt important exe based recommendations
			Also fetch important exe based recommendations for reporting telemetry
		*/
		timeout(3000).then(async () => {
			await this.collectTips();
			this.promptHighImportanceExeBasedTip();
			this.promptMediumImportanceExeBasedTip();
		});
	}

	async getImportantExecutableBasedTips(): Promise<IExecutableBasedExtensionTip[]> {
		const highImportanceExeTips = await this.getValidExecutableBasedExtensionTips(this.highImportanceExecutableTips);
		const mediumImportanceExeTips = await this.getValidExecutableBasedExtensionTips(this.mediumImportanceExecutableTips);
		return [...highImportanceExeTips, ...mediumImportanceExeTips];
	}

	getOtherExecutableBasedTips(): Promise<IExecutableBasedExtensionTip[]> {
		return this.getValidExecutableBasedExtensionTips(this.allOtherExecutableTips);
	}

	private async collectTips(): Promise<void> {
		const highImportanceExeTips = await this.getValidExecutableBasedExtensionTips(this.highImportanceExecutableTips);
		const mediumImportanceExeTips = await this.getValidExecutableBasedExtensionTips(this.mediumImportanceExecutableTips);
		const local = await this.extensionManagementService.getInstalled();

		this.highImportanceTipsByExe = this.groupImportantTipsByExe(highImportanceExeTips, local);
		this.mediumImportanceTipsByExe = this.groupImportantTipsByExe(mediumImportanceExeTips, local);
	}

	private groupImportantTipsByExe(importantExeBasedTips: IExecutableBasedExtensionTip[], local: ILocalExtension[]): Map<string, IExecutableBasedExtensionTip[]> {
		const importantExeBasedRecommendations = new Map<string, IExecutableBasedExtensionTip>();
		importantExeBasedTips.forEach(tip => importantExeBasedRecommendations.set(tip.extensionId.toLowerCase(), tip));

		const { installed, uninstalled: recommendations } = this.groupByInstalled([...importantExeBasedRecommendations.keys()], local);

		/* Log installed and uninstalled exe based recommendations */
		for (const extensionId of installed) {
			const tip = importantExeBasedRecommendations.get(extensionId);
			if (tip) {
				this.telemetryService.publicLog2<{ exeName: string, extensionId: string }, ExeExtensionRecommendationsClassification>('exeExtensionRecommendations:alreadyInstalled', { extensionId, exeName: basename(tip.windowsPath!) });
			}
		}
		for (const extensionId of recommendations) {
			const tip = importantExeBasedRecommendations.get(extensionId);
			if (tip) {
				this.telemetryService.publicLog2<{ exeName: string, extensionId: string }, ExeExtensionRecommendationsClassification>('exeExtensionRecommendations:notInstalled', { extensionId, exeName: basename(tip.windowsPath!) });
			}
		}

		const promptedExecutableTips = this.getPromptedExecutableTips();
		const tipsByExe = new Map<string, IExecutableBasedExtensionTip[]>();
		for (const extensionId of recommendations) {
			const tip = importantExeBasedRecommendations.get(extensionId);
			if (tip && (!promptedExecutableTips[tip.exeName] || !promptedExecutableTips[tip.exeName].includes(tip.extensionId))) {
				let tips = tipsByExe.get(tip.exeName);
				if (!tips) {
					tips = [];
					tipsByExe.set(tip.exeName, tips);
				}
				tips.push(tip);
			}
		}

		return tipsByExe;
	}

	/**
	 * High importance tips are prompted once per restart session
	 */
	private promptHighImportanceExeBasedTip(): void {
		if (this.highImportanceTipsByExe.size === 0) {
			return;
		}

		const [exeName, tips] = [...this.highImportanceTipsByExe.entries()][0];
		this.promptExeRecommendations(tips)
			.then(result => {
				switch (result) {
					case RecommendationsNotificationResult.Accepted:
						this.addToRecommendedExecutables(tips[0].exeName, tips);
						break;
					case RecommendationsNotificationResult.Ignored:
						this.highImportanceTipsByExe.delete(exeName);
						break;
					case RecommendationsNotificationResult.TooMany:
						// Too many notifications. Schedule the prompt after one hour
						const disposable = this._register(disposableTimeout(() => { disposable.dispose(); this.promptHighImportanceExeBasedTip(); }, 60 * 60 * 1000 /* 1 hour */));
						break;
				}
			});
	}

	/**
	 * Medium importance tips are prompted once per 7 days
	 */
	private promptMediumImportanceExeBasedTip(): void {
		if (this.mediumImportanceTipsByExe.size === 0) {
			return;
		}

		const lastPromptedMediumExeTime = this.getLastPromptedMediumExeTime();
		const timeSinceLastPrompt = Date.now() - lastPromptedMediumExeTime;
		const promptInterval = 7 * 24 * 60 * 60 * 1000; // 7 Days
		if (timeSinceLastPrompt < promptInterval) {
			// Wait until interval and prompt
			const disposable = this._register(disposableTimeout(() => { disposable.dispose(); this.promptMediumImportanceExeBasedTip(); }, promptInterval - timeSinceLastPrompt));
			return;
		}

		const [exeName, tips] = [...this.mediumImportanceTipsByExe.entries()][0];
		this.promptExeRecommendations(tips)
			.then(result => {
				switch (result) {
					case RecommendationsNotificationResult.Accepted:
						// Accepted: Update the last prompted time and caches.
						this.updateLastPromptedMediumExeTime(Date.now());
						this.mediumImportanceTipsByExe.delete(exeName);
						this.addToRecommendedExecutables(tips[0].exeName, tips);

						// Schedule the next recommendation for next internval
						const disposable1 = this._register(disposableTimeout(() => { disposable1.dispose(); this.promptMediumImportanceExeBasedTip(); }, promptInterval));
						break;

					case RecommendationsNotificationResult.Ignored:
						// Ignored: Remove from the cache and prompt next recommendation
						this.mediumImportanceTipsByExe.delete(exeName);
						this.promptMediumImportanceExeBasedTip();
						break;

					case RecommendationsNotificationResult.TooMany:
						// Too many notifications. Schedule the prompt after one hour
						const disposable2 = this._register(disposableTimeout(() => { disposable2.dispose(); this.promptMediumImportanceExeBasedTip(); }, 60 * 60 * 1000 /* 1 hour */));
						break;
				}
			});
	}

	private promptExeRecommendations(tips: IExecutableBasedExtensionTip[]): Promise<RecommendationsNotificationResult> {
		const extensionIds = tips.map(({ extensionId }) => extensionId.toLowerCase());
		const message = localize({ key: 'exeRecommended', comment: ['Placeholder string is the name of the software that is installed.'] }, "You have {0} installed on your system. Do you want to install the recommended extensions for it?", tips[0].exeFriendlyName);
		return this.extensionRecommendationNotificationService.promptImportantExtensionsInstallNotification(extensionIds, message, `@exe:"${tips[0].exeName}"`, RecommendationSource.EXE);
	}

	private getLastPromptedMediumExeTime(): number {
		let value = this.storageService.getNumber(lastPromptedMediumImpExeTimeStorageKey, StorageScope.GLOBAL);
		if (!value) {
			value = Date.now();
			this.updateLastPromptedMediumExeTime(value);
		}
		return value;
	}

	private updateLastPromptedMediumExeTime(value: number): void {
		this.storageService.store(lastPromptedMediumImpExeTimeStorageKey, value, StorageScope.GLOBAL, StorageTarget.MACHINE);
	}

	private getPromptedExecutableTips(): IStringDictionary<string[]> {
		return JSON.parse(this.storageService.get(promptedExecutableTipsStorageKey, StorageScope.GLOBAL, '{}'));
	}

	private addToRecommendedExecutables(exeName: string, tips: IExecutableBasedExtensionTip[]) {
		const promptedExecutableTips = this.getPromptedExecutableTips();
		promptedExecutableTips[exeName] = tips.map(({ extensionId }) => extensionId.toLowerCase());
		this.storageService.store(promptedExecutableTipsStorageKey, JSON.stringify(promptedExecutableTips), StorageScope.GLOBAL, StorageTarget.USER);
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

	private async getValidExecutableBasedExtensionTips(executableTips: Map<string, IExeBasedExtensionTips>): Promise<IExecutableBasedExtensionTip[]> {
		const result: IExecutableBasedExtensionTip[] = [];

		const checkedExecutables: Map<string, boolean> = new Map<string, boolean>();
		for (const exeName of executableTips.keys()) {
			const extensionTip = executableTips.get(exeName);
			if (!extensionTip || !isNonEmptyArray(extensionTip.recommendations)) {
				continue;
			}

			const exePaths: string[] = [];
			if (isWindows) {
				if (extensionTip.windowsPath) {
					exePaths.push(extensionTip.windowsPath.replace('%USERPROFILE%', process.env['USERPROFILE']!)
						.replace('%ProgramFiles(x86)%', process.env['ProgramFiles(x86)']!)
						.replace('%ProgramFiles%', process.env['ProgramFiles']!)
						.replace('%APPDATA%', process.env['APPDATA']!)
						.replace('%WINDIR%', process.env['WINDIR']!));
				}
			} else {
				exePaths.push(join('/usr/local/bin', exeName));
				exePaths.push(join('/usr/bin', exeName));
				exePaths.push(join(this.environmentService.userHome.fsPath, exeName));
			}

			for (const exePath of exePaths) {
				let exists = checkedExecutables.get(exePath);
				if (exists === undefined) {
					exists = await this.fileService.exists(URI.file(exePath));
					checkedExecutables.set(exePath, exists);
				}
				if (exists) {
					for (const { extensionId, extensionName, isExtensionPack } of extensionTip.recommendations) {
						result.push({
							extensionId,
							extensionName,
							isExtensionPack,
							exeName,
							exeFriendlyName: extensionTip.exeFriendlyName,
							windowsPath: extensionTip.windowsPath,
						});
					}
				}
			}
		}

		return result;
	}

}
