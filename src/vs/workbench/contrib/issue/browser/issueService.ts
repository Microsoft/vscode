/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { normalizeGitHubUrl } from 'vs/platform/issue/common/issueReporterUtil';
import { IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionType } from 'vs/platform/extensions/common/extensions';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IProductService } from 'vs/platform/product/common/productService';

export const IWebIssueService = createDecorator<IWebIssueService>('webIssueService');

export interface IIssueReporterOptions {
	extensionId?: string;
}

export interface IWebIssueService {
	readonly _serviceBrand: undefined;
	openReporter(options?: IIssueReporterOptions): Promise<void>;
}

export class WebIssueService implements IWebIssueService {
	declare readonly _serviceBrand: undefined;

	constructor(
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IProductService private readonly productService: IProductService
	) { }

	async openReporter(options: IIssueReporterOptions): Promise<void> {
		let repositoryUrl = this.productService.reportIssueUrl;
		if (options.extensionId) {
			const extensionGitHubUrl = await this.getExtensionGitHubUrl(options.extensionId);
			if (extensionGitHubUrl) {
				repositoryUrl = extensionGitHubUrl + '/issues/new';
			}
		}

		if (repositoryUrl) {
			return this.openerService.open(URI.parse(repositoryUrl)).then(_ => { });
		} else {
			throw new Error(`Unable to find issue reporting url for ${options.extensionId}`);
		}
	}

	private async getExtensionGitHubUrl(extensionId: string): Promise<string> {
		let repositoryUrl = '';

		const extensions = await this.extensionManagementService.getInstalled(ExtensionType.User);
		const selectedExtension = extensions.filter(ext => ext.identifier.id === extensionId)[0];
		const bugsUrl = selectedExtension?.manifest.bugs?.url;
		const extensionUrl = selectedExtension?.manifest.repository?.url;

		// If given, try to match the extension's bug url
		if (bugsUrl && bugsUrl.match(/^https?:\/\/github\.com\/(.*)/)) {
			repositoryUrl = normalizeGitHubUrl(bugsUrl);
		} else if (extensionUrl && extensionUrl.match(/^https?:\/\/github\.com\/(.*)/)) {
			repositoryUrl = normalizeGitHubUrl(extensionUrl);
		}

		return repositoryUrl;
	}
}
