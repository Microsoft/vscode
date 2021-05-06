/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IExtensionManagementService, IGalleryExtension, IExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionManagement';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IProductService } from 'vs/platform/product/common/productService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ExtensionManagementChannelClient } from 'vs/platform/extensionManagement/common/extensionManagementIpc';
import { IExtensionManifestPropertiesService } from 'vs/workbench/services/extensions/common/extensionManifestPropertiesService';

export class WebRemoteExtensionManagementService extends ExtensionManagementChannelClient implements IExtensionManagementService {

	constructor(
		channel: IChannel,
		@IExtensionGalleryService protected readonly galleryService: IExtensionGalleryService,
		@IConfigurationService protected readonly configurationService: IConfigurationService,
		@IProductService protected readonly productService: IProductService,
		@IExtensionManifestPropertiesService protected readonly extensionManifestPropertiesService: IExtensionManifestPropertiesService,
	) {
		super(channel);
	}

	override async canInstall(extension: IGalleryExtension): Promise<boolean> {
		const manifest = await this.galleryService.getManifest(extension, CancellationToken.None);
		return !!manifest && this.extensionManifestPropertiesService.canExecuteOnWorkspace(manifest);
	}

}
