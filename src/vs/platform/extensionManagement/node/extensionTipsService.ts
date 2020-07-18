/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { join, } from 'vs/base/common/path';
import { IProductService } from 'vs/platform/product/common/productService';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { env as processEnv } from 'vs/base/common/process';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IFileService } from 'vs/platform/files/common/files';
import { isWindows } from 'vs/base/common/platform';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { IExecutableBasedExtensionTip } from 'vs/platform/extensionManagement/common/extensionManagement';
import { forEach } from 'vs/base/common/collections';
import { IRequestService } from 'vs/platform/request/common/request';
import { ILogService } from 'vs/platform/log/common/log';
import { ExtensionTipsService as BaseExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionTipsService';

type IExeBasedExtensionTips = {
	readonly exeFriendlyName: string,
	readonly windowsPath?: string,
	readonly recommendations: { extensionId: string, extensionName: string, isExtensionPack: boolean }[];
};

export class ExtensionTipsService extends BaseExtensionTipsService {

	_serviceBrand: any;

	private readonly allImportantExecutableTips: Map<string, IExeBasedExtensionTips> = new Map<string, IExeBasedExtensionTips>();
	private readonly allOtherExecutableTips: Map<string, IExeBasedExtensionTips> = new Map<string, IExeBasedExtensionTips>();

	constructor(
		@IEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IFileService fileService: IFileService,
		@IProductService productService: IProductService,
		@IRequestService requestService: IRequestService,
		@ILogService logService: ILogService,
	) {
		super(fileService, productService, requestService, logService);
		if (productService.exeBasedExtensionTips) {
			forEach(productService.exeBasedExtensionTips, ({ key, value }) => {
				const importantRecommendations: { extensionId: string, extensionName: string, isExtensionPack: boolean }[] = [];
				const otherRecommendations: { extensionId: string, extensionName: string, isExtensionPack: boolean }[] = [];
				forEach(value.recommendations, ({ key: extensionId, value }) => {
					if (value.important) {
						importantRecommendations.push({ extensionId, extensionName: value.name, isExtensionPack: !!value.isExtensionPack });
					} else {
						otherRecommendations.push({ extensionId, extensionName: value.name, isExtensionPack: !!value.isExtensionPack });
					}
				});
				if (importantRecommendations.length) {
					this.allImportantExecutableTips.set(key, { exeFriendlyName: value.friendlyName, windowsPath: value.windowsPath, recommendations: importantRecommendations });
				}
				if (otherRecommendations.length) {
					this.allOtherExecutableTips.set(key, { exeFriendlyName: value.friendlyName, windowsPath: value.windowsPath, recommendations: otherRecommendations });
				}
			});
		}
	}

	getImportantExecutableBasedTips(): Promise<IExecutableBasedExtensionTip[]> {
		return this.getValidExecutableBasedExtensionTips(this.allImportantExecutableTips);
	}

	getOtherExecutableBasedTips(): Promise<IExecutableBasedExtensionTip[]> {
		return this.getValidExecutableBasedExtensionTips(this.allOtherExecutableTips);
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
					exePaths.push(extensionTip.windowsPath.replace('%USERPROFILE%', processEnv['USERPROFILE']!)
						.replace('%ProgramFiles(x86)%', processEnv['ProgramFiles(x86)']!)
						.replace('%ProgramFiles%', processEnv['ProgramFiles']!)
						.replace('%APPDATA%', processEnv['APPDATA']!)
						.replace('%WINDIR%', processEnv['WINDIR']!));
				}
			} else {
				exePaths.push(join('/usr/local/bin', exeName));
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
