/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IProductService } from 'vs/platform/product/common/productService';
import { IConfigBasedExtensionTip as IRawConfigBasedExtensionTip } from 'vs/base/common/product';
import { IFileService } from 'vs/platform/files/common/files';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { IExtensionTipsService, IExecutableBasedExtensionTip, IWorkspaceTips, IConfigBasedExtensionTip } from 'vs/platform/extensionManagement/common/extensionManagement';
import { forEach } from 'vs/base/common/collections';
import { IRequestService, asJson } from 'vs/platform/request/common/request';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ILogService } from 'vs/platform/log/common/log';
import { joinPath } from 'vs/base/common/resources';
import { getDomainsOfRemotes } from 'vs/platform/extensionManagement/common/configRemotes';
import { Disposable } from 'vs/base/common/lifecycle';

export class ExtensionTipsService extends Disposable implements IExtensionTipsService {

	_serviceBrand: any;

	private readonly allConfigBasedTips: Map<string, IRawConfigBasedExtensionTip> = new Map<string, IRawConfigBasedExtensionTip>();

	constructor(
		@IFileService protected readonly fileService: IFileService,
		@IProductService private readonly productService: IProductService,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		if (this.productService.configBasedExtensionTips) {
			forEach(this.productService.configBasedExtensionTips, ({ value }) => this.allConfigBasedTips.set(value.configPath, value));
		}
	}

	getConfigBasedTips(folder: URI): Promise<IConfigBasedExtensionTip[]> {
		return this.getValidConfigBasedTips(folder);
	}

	getAllWorkspacesTips(): Promise<IWorkspaceTips[]> {
		return this.fetchWorkspacesTips();
	}

	async getImportantExecutableBasedTips(): Promise<IExecutableBasedExtensionTip[]> {
		return [];
	}

	async getOtherExecutableBasedTips(): Promise<IExecutableBasedExtensionTip[]> {
		return [];
	}

	private async getValidConfigBasedTips(folder: URI): Promise<IConfigBasedExtensionTip[]> {
		const result: IConfigBasedExtensionTip[] = [];
		for (const [configPath, tip] of this.allConfigBasedTips) {
			try {
				const content = await this.fileService.readFile(joinPath(folder, configPath));
				const recommendationByRemote: Map<string, IConfigBasedExtensionTip> = new Map<string, IConfigBasedExtensionTip>();
				forEach(tip.recommendations, ({ key, value }) => {
					if (isNonEmptyArray(value.remotes)) {
						for (const remote of value.remotes) {
							recommendationByRemote.set(remote, {
								extensionId: key,
								extensionName: value.name,
								configName: tip.configName,
								important: !!value.important,
								isExtensionPack: !!value.isExtensionPack
							});
						}
					} else {
						result.push({
							extensionId: key,
							extensionName: value.name,
							configName: tip.configName,
							important: !!value.important,
							isExtensionPack: !!value.isExtensionPack
						});
					}
				});
				const domains = getDomainsOfRemotes(content.value.toString(), [...recommendationByRemote.keys()]);
				for (const domain of domains) {
					const remote = recommendationByRemote.get(domain);
					if (remote) {
						result.push(remote);
					}
				}
			} catch (error) { /* Ignore */ }
		}
		return result;
	}


	private async fetchWorkspacesTips(): Promise<IWorkspaceTips[]> {
		if (!this.productService.extensionsGallery?.recommendationsUrl) {
			return [];
		}
		try {
			const context = await this.requestService.request({ type: 'GET', url: this.productService.extensionsGallery?.recommendationsUrl }, CancellationToken.None);
			if (context.res.statusCode !== 200) {
				return [];
			}
			const result = await asJson<{ workspaceRecommendations?: IWorkspaceTips[] }>(context);
			if (!result) {
				return [];
			}
			return result.workspaceRecommendations || [];
		} catch (error) {
			this.logService.error(error);
			return [];
		}
	}

}
