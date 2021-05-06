/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionType, IExtensionIdentifier, IExtensionManifest, ITranslatedScannedExtension } from 'vs/platform/extensions/common/extensions';
import { IExtensionManagementService, ILocalExtension, InstallExtensionEvent, DidInstallExtensionEvent, DidUninstallExtensionEvent, IGalleryExtension, IReportedExtension, IGalleryMetadata, InstallOperation } from 'vs/platform/extensionManagement/common/extensionManagement';
import { Event, Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IWebExtensionsScannerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { ILogService } from 'vs/platform/log/common/log';
import { Disposable } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';

export class WebExtensionManagementService extends Disposable implements IExtensionManagementService {

	declare readonly _serviceBrand: undefined;

	private readonly _onInstallExtension = this._register(new Emitter<InstallExtensionEvent>());
	readonly onInstallExtension: Event<InstallExtensionEvent> = this._onInstallExtension.event;

	private readonly _onDidInstallExtension = this._register(new Emitter<DidInstallExtensionEvent>());
	readonly onDidInstallExtension: Event<DidInstallExtensionEvent> = this._onDidInstallExtension.event;

	private readonly _onUninstallExtension = this._register(new Emitter<IExtensionIdentifier>());
	readonly onUninstallExtension: Event<IExtensionIdentifier> = this._onUninstallExtension.event;

	private _onDidUninstallExtension = this._register(new Emitter<DidUninstallExtensionEvent>());
	onDidUninstallExtension: Event<DidUninstallExtensionEvent> = this._onDidUninstallExtension.event;

	constructor(
		@IWebExtensionsScannerService private readonly webExtensionsScannerService: IWebExtensionsScannerService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	async getInstalled(type?: ExtensionType): Promise<ILocalExtension[]> {
		const extensions = await this.webExtensionsScannerService.scanAndTranslateExtensions(type);
		return Promise.all(extensions.map(e => this.toLocalExtension(e)));
	}

	async canInstall(gallery: IGalleryExtension): Promise<boolean> {
		return this.webExtensionsScannerService.canAddExtension(gallery);
	}

	async installFromGallery(gallery: IGalleryExtension): Promise<ILocalExtension> {
		if (!(await this.canInstall(gallery))) {
			throw new Error(localize('cannot be installed', "Cannot install '{0}' because this extension is not a web extension.", gallery.displayName || gallery.name));
		}
		this.logService.info('Installing extension:', gallery.identifier.id);
		this._onInstallExtension.fire({ identifier: gallery.identifier, gallery });
		try {
			const existingExtension = await this.getUserExtension(gallery.identifier);
			const scannedExtension = await this.webExtensionsScannerService.addExtension(gallery);
			const local = await this.toLocalExtension(scannedExtension);
			if (existingExtension && existingExtension.manifest.version !== gallery.version) {
				await this.webExtensionsScannerService.removeExtension(existingExtension.identifier, existingExtension.manifest.version);
			}
			this._onDidInstallExtension.fire({ local, identifier: gallery.identifier, operation: InstallOperation.Install, gallery });
			return local;
		} catch (error) {
			this._onDidInstallExtension.fire({ error, identifier: gallery.identifier, operation: InstallOperation.Install, gallery });
			throw error;
		}
	}

	async uninstall(extension: ILocalExtension): Promise<void> {
		this._onUninstallExtension.fire(extension.identifier);
		try {
			await this.webExtensionsScannerService.removeExtension(extension.identifier);
			this._onDidUninstallExtension.fire({ identifier: extension.identifier });
		} catch (error) {
			this.logService.error(error);
			this._onDidUninstallExtension.fire({ error, identifier: extension.identifier });
			throw error;
		}
	}

	async updateMetadata(local: ILocalExtension, metadata: IGalleryMetadata): Promise<ILocalExtension> {
		return local;
	}

	private async getUserExtension(identifier: IExtensionIdentifier): Promise<ILocalExtension | undefined> {
		const userExtensions = await this.getInstalled(ExtensionType.User);
		return userExtensions.find(e => areSameExtensions(e.identifier, identifier));
	}

	private async toLocalExtension(scannedExtension: ITranslatedScannedExtension): Promise<ILocalExtension> {
		return {
			type: scannedExtension.type,
			identifier: scannedExtension.identifier,
			manifest: scannedExtension.packageJSON,
			location: scannedExtension.location,
			isMachineScoped: false,
			publisherId: null,
			publisherDisplayName: null,
			isBuiltin: scannedExtension.type === ExtensionType.System
		};
	}

	zip(extension: ILocalExtension): Promise<URI> { throw new Error('unsupported'); }
	unzip(zipLocation: URI): Promise<IExtensionIdentifier> { throw new Error('unsupported'); }
	getManifest(vsix: URI): Promise<IExtensionManifest> { throw new Error('unsupported'); }
	install(vsix: URI): Promise<ILocalExtension> { throw new Error('unsupported'); }
	reinstallFromGallery(extension: ILocalExtension): Promise<void> { throw new Error('unsupported'); }
	getExtensionsReport(): Promise<IReportedExtension[]> { throw new Error('unsupported'); }
	updateExtensionScope(): Promise<ILocalExtension> { throw new Error('unsupported'); }
}
