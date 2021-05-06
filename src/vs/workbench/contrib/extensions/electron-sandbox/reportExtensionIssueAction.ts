/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IProductService } from 'vs/platform/product/common/productService';
import { Action } from 'vs/base/common/actions';
import { IExtension } from 'vs/workbench/contrib/extensions/common/extensions';
import { IExtensionsStatus, IExtensionHostProfile } from 'vs/workbench/services/extensions/common/extensions';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { ExtensionType, IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';

const builtinExtensionIssueUrl = 'https://github.com/microsoft/vscode';

export class ReportExtensionIssueAction extends Action {

	private static readonly _id = 'workbench.extensions.action.reportExtensionIssue';
	private static readonly _label = nls.localize('reportExtensionIssue', "Report Issue");

	private _url: string | undefined;

	constructor(
		private extension: {
			description: IExtensionDescription;
			marketplaceInfo: IExtension;
			status?: IExtensionsStatus;
			unresponsiveProfile?: IExtensionHostProfile
		},
		@IOpenerService private readonly openerService: IOpenerService,
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IProductService private readonly productService: IProductService,
		@INativeHostService private readonly nativeHostService: INativeHostService
	) {
		super(ReportExtensionIssueAction._id, ReportExtensionIssueAction._label, 'extension-action report-issue');

		this.enabled = extension.description.isBuiltin || (!!extension.description.repository && !!extension.description.repository.url);
	}

	override async run(): Promise<void> {
		if (!this._url) {
			this._url = await this._generateNewIssueUrl(this.extension);
		}
		this.openerService.open(URI.parse(this._url));
	}

	private async _generateNewIssueUrl(extension: {
		description: IExtensionDescription;
		marketplaceInfo: IExtension;
		status?: IExtensionsStatus;
		unresponsiveProfile?: IExtensionHostProfile
	}): Promise<string> {
		let baseUrl = extension.marketplaceInfo && extension.marketplaceInfo.type === ExtensionType.User && extension.description.repository ? extension.description.repository.url : undefined;
		if (!baseUrl && extension.description.isBuiltin) {
			baseUrl = builtinExtensionIssueUrl;
		}
		if (!!baseUrl) {
			baseUrl = `${baseUrl.indexOf('.git') !== -1 ? baseUrl.substr(0, baseUrl.length - 4) : baseUrl}/issues/new/`;
		} else {
			baseUrl = this.productService.reportIssueUrl!;
		}

		let reason = 'Bug';
		let title = 'Extension issue';
		let message = ':warning: We have written the needed data into your clipboard. Please paste! :warning:';
		this.clipboardService.writeText('```json \n' + JSON.stringify(extension.status, null, '\t') + '\n```');

		const os = await this.nativeHostService.getOSProperties();
		const osVersion = `${os.type} ${os.arch} ${os.release}`;
		const queryStringPrefix = baseUrl.indexOf('?') === -1 ? '?' : '&';
		const body = encodeURIComponent(
			`- Issue Type: \`${reason}\`
- Extension Name: \`${extension.description.name}\`
- Extension Version: \`${extension.description.version}\`
- OS Version: \`${osVersion}\`
- VS Code version: \`${this.productService.version}\`\n\n${message}`
		);

		return `${baseUrl}${queryStringPrefix}body=${body}&title=${encodeURIComponent(title)}`;
	}
}
