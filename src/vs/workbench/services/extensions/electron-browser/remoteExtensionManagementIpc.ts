/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { tmpdir } from 'os';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { IExtensionManagementService, ILocalExtension, IGalleryExtension, IExtensionGalleryService, InstallOperation } from 'vs/platform/extensionManagement/common/extensionManagement';
import { URI } from 'vs/base/common/uri';
import { ExtensionType, IExtensionManifest } from 'vs/platform/extensions/common/extensions';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ILogService } from 'vs/platform/log/common/log';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { prefersExecuteOnUI } from 'vs/workbench/services/extensions/common/extensionsUtil';
import { isNonEmptyArray, toArray } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import { localize } from 'vs/nls';
import { IProductService } from 'vs/platform/product/common/productService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ExtensionManagementChannelClient } from 'vs/platform/extensionManagement/common/extensionManagementIpc';
import { generateUuid } from 'vs/base/common/uuid';
import { joinPath } from 'vs/base/common/resources';

export class RemoteExtensionManagementChannelClient extends ExtensionManagementChannelClient {

	declare readonly _serviceBrand: undefined;

	constructor(
		channel: IChannel,
		private readonly localExtensionManagementService: IExtensionManagementService,
		private readonly galleryService: IExtensionGalleryService,
		private readonly logService: ILogService,
		private readonly configurationService: IConfigurationService,
		private readonly productService: IProductService
	) {
		super(channel);
	}

	async install(vsix: URI): Promise<ILocalExtension> {
		const local = await super.install(vsix);
		await this.installUIDependenciesAndPackedExtensions(local);
		return local;
	}

	async installFromGallery(extension: IGalleryExtension): Promise<ILocalExtension> {
		const local = await this.doInstallFromGallery(extension);
		await this.installUIDependenciesAndPackedExtensions(local);
		return local;
	}

	private async doInstallFromGallery(extension: IGalleryExtension): Promise<ILocalExtension> {
		if (this.configurationService.getValue<boolean>('remote.downloadExtensionsLocally')) {
			this.logService.trace(`Download '${extension.identifier.id}' extension locally and install`);
			return this.downloadCompatibleAndInstall(extension);
		}
		try {
			const local = await super.installFromGallery(extension);
			return local;
		} catch (error) {
			try {
				this.logService.error(`Error while installing '${extension.identifier.id}' extension in the remote server.`, toErrorMessage(error));
				this.logService.info(`Trying to download '${extension.identifier.id}' extension locally and install`);
				const local = await this.downloadCompatibleAndInstall(extension);
				this.logService.info(`Successfully installed '${extension.identifier.id}' extension`);
				return local;
			} catch (e) {
				this.logService.error(e);
				throw error;
			}
		}
	}

	private async downloadCompatibleAndInstall(extension: IGalleryExtension): Promise<ILocalExtension> {
		const installed = await this.getInstalled(ExtensionType.User);
		const compatible = await this.galleryService.getCompatibleExtension(extension);
		if (!compatible) {
			return Promise.reject(new Error(localize('incompatible', "Unable to install extension '{0}' as it is not compatible with VS Code '{1}'.", extension.identifier.id, this.productService.version)));
		}
		const manifest = await this.galleryService.getManifest(compatible, CancellationToken.None);
		if (manifest) {
			const workspaceExtensions = await this.getAllWorkspaceDependenciesAndPackedExtensions(manifest, CancellationToken.None);
			await Promise.all(workspaceExtensions.map(e => this.downloadAndInstall(e, installed)));
		}
		return this.downloadAndInstall(extension, installed);
	}

	private async downloadAndInstall(extension: IGalleryExtension, installed: ILocalExtension[]): Promise<ILocalExtension> {
		const location = joinPath(URI.file(tmpdir()), generateUuid());
		await this.galleryService.download(extension, location, installed.filter(i => areSameExtensions(i.identifier, extension.identifier))[0] ? InstallOperation.Update : InstallOperation.Install);
		return super.install(location);
	}

	private async installUIDependenciesAndPackedExtensions(local: ILocalExtension): Promise<void> {
		const uiExtensions = await this.getAllUIDependenciesAndPackedExtensions(local.manifest, CancellationToken.None);
		const installed = await this.localExtensionManagementService.getInstalled();
		const toInstall = uiExtensions.filter(e => installed.every(i => !areSameExtensions(i.identifier, e.identifier)));
		await Promise.all(toInstall.map(d => this.localExtensionManagementService.installFromGallery(d)));
	}

	private async getAllUIDependenciesAndPackedExtensions(manifest: IExtensionManifest, token: CancellationToken): Promise<IGalleryExtension[]> {
		const result = new Map<string, IGalleryExtension>();
		const extensions = [...(manifest.extensionPack || []), ...(manifest.extensionDependencies || [])];
		await this.getDependenciesAndPackedExtensionsRecursively(extensions, result, true, token);
		return toArray(result.values());
	}

	private async getAllWorkspaceDependenciesAndPackedExtensions(manifest: IExtensionManifest, token: CancellationToken): Promise<IGalleryExtension[]> {
		const result = new Map<string, IGalleryExtension>();
		const extensions = [...(manifest.extensionPack || []), ...(manifest.extensionDependencies || [])];
		await this.getDependenciesAndPackedExtensionsRecursively(extensions, result, false, token);
		return toArray(result.values());
	}

	private async getDependenciesAndPackedExtensionsRecursively(toGet: string[], result: Map<string, IGalleryExtension>, uiExtension: boolean, token: CancellationToken): Promise<void> {
		if (toGet.length === 0) {
			return Promise.resolve();
		}

		const extensions = (await this.galleryService.query({ names: toGet, pageSize: toGet.length }, token)).firstPage;
		const manifests = await Promise.all(extensions.map(e => this.galleryService.getManifest(e, token)));
		const extensionsManifests: IExtensionManifest[] = [];
		for (let idx = 0; idx < extensions.length; idx++) {
			const extension = extensions[idx];
			const manifest = manifests[idx];
			if (manifest && prefersExecuteOnUI(manifest, this.productService, this.configurationService) === uiExtension) {
				result.set(extension.identifier.id.toLowerCase(), extension);
				extensionsManifests.push(manifest);
			}
		}
		toGet = [];
		for (const extensionManifest of extensionsManifests) {
			if (isNonEmptyArray(extensionManifest.extensionDependencies)) {
				for (const id of extensionManifest.extensionDependencies) {
					if (!result.has(id.toLowerCase())) {
						toGet.push(id);
					}
				}
			}
			if (isNonEmptyArray(extensionManifest.extensionPack)) {
				for (const id of extensionManifest.extensionPack) {
					if (!result.has(id.toLowerCase())) {
						toGet.push(id);
					}
				}
			}
		}
		return this.getDependenciesAndPackedExtensionsRecursively(toGet, result, uiExtension, token);
	}
}
