/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBuiltinExtensionsScannerService, IScannedExtension, ExtensionType, IExtensionManifest } from 'vs/platform/extensions/common/extensions';
import { isWeb } from 'vs/base/common/platform';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { URI } from 'vs/base/common/uri';
import { getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';

interface IScannedBuiltinExtension {
	extensionPath: string,
	packageJSON: IExtensionManifest,
	packageNLSPath?: string,
	readmePath?: string,
	changelogPath?: string,
}

export class BuiltinExtensionsScannerService implements IBuiltinExtensionsScannerService {

	declare readonly _serviceBrand: undefined;

	private readonly builtinExtensions: IScannedExtension[] = [];

	constructor(
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
	) {

		const builtinExtensionsServiceUrl = environmentService.options?.builtinExtensionsServiceUrl ? URI.parse(environmentService.options?.builtinExtensionsServiceUrl) : undefined;
		if (isWeb && builtinExtensionsServiceUrl) {

			let scannedBuiltinExtensions: IScannedBuiltinExtension[] = [];

			if (environmentService.isBuilt) {
				// Built time configuration (do NOT modify)
				scannedBuiltinExtensions = [/*BUILD->INSERT_BUILTIN_EXTENSIONS*/];
			} else {
				// Find builtin extensions by checking for DOM
				const builtinExtensionsElement = document.getElementById('vscode-workbench-builtin-extensions');
				const builtinExtensionsElementAttribute = builtinExtensionsElement ? builtinExtensionsElement.getAttribute('data-settings') : undefined;
				if (builtinExtensionsElementAttribute) {
					try {
						scannedBuiltinExtensions = JSON.parse(builtinExtensionsElementAttribute);
					} catch (error) { /* ignore error*/ }
				}
			}

			this.builtinExtensions = scannedBuiltinExtensions.map(e => ({
				identifier: { id: getGalleryExtensionId(e.packageJSON.publisher, e.packageJSON.name) },
				location: uriIdentityService.extUri.joinPath(builtinExtensionsServiceUrl!, e.extensionPath),
				type: ExtensionType.System,
				packageJSON: e.packageJSON,
				packageNLSUrl: e.packageNLSPath ? uriIdentityService.extUri.joinPath(builtinExtensionsServiceUrl!, e.packageNLSPath) : undefined,
				readmeUrl: e.readmePath ? uriIdentityService.extUri.joinPath(builtinExtensionsServiceUrl!, e.readmePath) : undefined,
				changelogUrl: e.changelogPath ? uriIdentityService.extUri.joinPath(builtinExtensionsServiceUrl!, e.changelogPath) : undefined,
			}));
		}
	}

	async scanBuiltinExtensions(): Promise<IScannedExtension[]> {
		if (isWeb) {
			return this.builtinExtensions;
		}
		throw new Error('not supported');
	}
}

registerSingleton(IBuiltinExtensionsScannerService, BuiltinExtensionsScannerService);
