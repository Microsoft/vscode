/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tmpdir } from 'os';
import { generateUuid } from 'vs/base/common/uuid';
import { ILocalExtension, IExtensionManagementService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { URI } from 'vs/base/common/uri';
import { ExtensionManagementService as BaseExtensionManagementService } from 'vs/workbench/services/extensionManagement/common/extensionManagementService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IExtensionManagementServer } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { Schemas } from 'vs/base/common/network';
import * as path from 'vs/base/common/path';

export class ExtensionManagementService extends BaseExtensionManagementService {

	protected async installVSIX(vsix: URI, server: IExtensionManagementServer): Promise<ILocalExtension> {
		if (vsix.scheme === Schemas.vscodeRemote && server === this.extensionManagementServerService.localExtensionManagementServer) {
			const downloadedLocation = URI.file(path.join(tmpdir(), generateUuid()));
			await this.downloadService.download(vsix, downloadedLocation);
			vsix = downloadedLocation;
		}
		return server.extensionManagementService.install(vsix);
	}
}

registerSingleton(IExtensionManagementService, ExtensionManagementService);
