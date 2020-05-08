/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { join, } from 'vs/base/common/path';
import { IProductService, IExeBasedExtensionTip } from 'vs/platform/product/common/productService';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { env as processEnv } from 'vs/base/common/process';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IFileService } from 'vs/platform/files/common/files';
import { isWindows } from 'vs/base/common/platform';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { IExecutableBasedExtensionTip } from 'vs/platform/extensionManagement/common/extensionManagement';
import { IStringDictionary, forEach } from 'vs/base/common/collections';
import { IRequestService } from 'vs/platform/request/common/request';
import { ILogService } from 'vs/platform/log/common/log';
import { ExtensionTipsService as BaseExtensionTipsService } from 'vs/platform/extensionManagement/common/extensionTipsService';

export class ExtensionTipsService extends BaseExtensionTipsService {

	_serviceBrand: any;

	private readonly allImportantExecutableTips: IStringDictionary<IExeBasedExtensionTip> = {};
	private readonly allOtherExecutableTips: IStringDictionary<IExeBasedExtensionTip> = {};

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
				if (value.important) {
					this.allImportantExecutableTips[key] = value;
				} else {
					this.allOtherExecutableTips[key] = value;
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

	private async getValidExecutableBasedExtensionTips(executableTips: IStringDictionary<IExeBasedExtensionTip>): Promise<IExecutableBasedExtensionTip[]> {
		const result: IExecutableBasedExtensionTip[] = [];

		const checkedExecutables: Map<string, boolean> = new Map<string, boolean>();
		for (const exeName of Object.keys(executableTips)) {
			const extensionTip = executableTips[exeName];
			if (!isNonEmptyArray(extensionTip?.recommendations)) {
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
					extensionTip.recommendations.forEach(recommendation => result.push({
						extensionId: recommendation,
						friendlyName: extensionTip.friendlyName,
						exeFriendlyName: extensionTip.exeFriendlyName,
						windowsPath: extensionTip.windowsPath,
					}));
				}
			}
		}

		return result;
	}

}
