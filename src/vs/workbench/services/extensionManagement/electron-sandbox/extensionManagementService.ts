/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { ILocalExtension, IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { URI } from 'vs/base/common/uri';
import { ExtensionManagementService as BaseExtensionManagementService } from 'vs/workbench/services/extensionManagement/common/extensionManagementService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IExtensionManagementServer, IExtensionManagementServerService, IWorkbenchExtensioManagementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { Schemas } from 'vs/base/common/network';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IDownloadService } from 'vs/platform/download/common/download';
import { IProductService } from 'vs/platform/product/common/productService';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { joinPath } from 'vs/base/common/resources';
import { IUserDataAutoSyncEnablementService, IUserDataSyncResourceEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';

export class ExtensionManagementService extends BaseExtensionManagementService {

	constructor(
		@INativeWorkbenchEnvironmentService private readonly environmentService: INativeWorkbenchEnvironmentService,
		@IExtensionManagementServerService extensionManagementServerService: IExtensionManagementServerService,
		@IExtensionGalleryService extensionGalleryService: IExtensionGalleryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IProductService productService: IProductService,
		@IDownloadService downloadService: IDownloadService,
		@IUserDataAutoSyncEnablementService userDataAutoSyncEnablementService: IUserDataAutoSyncEnablementService,
		@IUserDataSyncResourceEnablementService userDataSyncResourceEnablementService: IUserDataSyncResourceEnablementService,
		@IDialogService dialogService: IDialogService,
	) {
		super(extensionManagementServerService, extensionGalleryService, configurationService, productService, downloadService, userDataAutoSyncEnablementService, userDataSyncResourceEnablementService, dialogService);
	}

	protected async installVSIX(vsix: URI, server: IExtensionManagementServer): Promise<ILocalExtension> {
		if (vsix.scheme === Schemas.vscodeRemote && server === this.extensionManagementServerService.localExtensionManagementServer) {
			const downloadedLocation = joinPath(this.environmentService.tmpDir, generateUuid());
			await this.downloadService.download(vsix, downloadedLocation);
			vsix = downloadedLocation;
		}
		return server.extensionManagementService.install(vsix);
	}
}

registerSingleton(IWorkbenchExtensioManagementService, ExtensionManagementService);
