/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver-umd';
import { IBuiltinExtensionsScannerService, IScannedExtension, ExtensionType, IExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWebExtensionsScannerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { isWeb } from 'vs/base/common/platform';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { joinPath } from 'vs/base/common/resources';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { Queue } from 'vs/base/common/async';
import { VSBuffer } from 'vs/base/common/buffer';
import { asText, isSuccess, IRequestService } from 'vs/platform/request/common/request';
import { ILogService } from 'vs/platform/log/common/log';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IGalleryExtension } from 'vs/platform/extensionManagement/common/extensionManagement';
import { groupByExtension, areSameExtensions, getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IStaticExtension } from 'vs/workbench/workbench.web.api';

interface IUserExtension {
	identifier: IExtensionIdentifier;
	version: string;
	uri: URI;
	readmeUri?: URI;
	changelogUri?: URI;
	packageNLSUri?: URI;
}

interface IStoredUserExtension {
	identifier: IExtensionIdentifier;
	version: string;
	uri: UriComponents;
	readmeUri?: UriComponents;
	changelogUri?: UriComponents;
	packageNLSUri?: UriComponents;
}

const AssetTypeWebResource = 'Microsoft.VisualStudio.Code.WebResources';

function getExtensionLocation(assetUri: URI): URI { return joinPath(assetUri, AssetTypeWebResource, 'extension'); }

export class WebExtensionsScannerService implements IWebExtensionsScannerService {

	declare readonly _serviceBrand: undefined;

	private readonly systemExtensionsPromise: Promise<IScannedExtension[]> = Promise.resolve([]);
	private readonly defaultExtensionsPromise: Promise<IScannedExtension[]> = Promise.resolve([]);
	private readonly extensionsResource: URI | undefined = undefined;
	private readonly userExtensionsResourceLimiter: Queue<IUserExtension[]> = new Queue<IUserExtension[]>();

	constructor(
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IBuiltinExtensionsScannerService private readonly builtinExtensionsScannerService: IBuiltinExtensionsScannerService,
		@IFileService private readonly fileService: IFileService,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		if (isWeb) {
			this.extensionsResource = joinPath(environmentService.userRoamingDataHome, 'extensions.json');
			this.systemExtensionsPromise = this.builtinExtensionsScannerService.scanBuiltinExtensions();
			this.defaultExtensionsPromise = this.readDefaultExtensions();
		}
	}

	private async readDefaultExtensions(): Promise<IScannedExtension[]> {
		const staticExtensions = this.environmentService.options && Array.isArray(this.environmentService.options.staticExtensions) ? this.environmentService.options.staticExtensions : [];
		const defaultUserWebExtensions = await this.readDefaultUserWebExtensions();
		return [...staticExtensions, ...defaultUserWebExtensions].map<IScannedExtension>(e => ({
			identifier: { id: getGalleryExtensionId(e.packageJSON.publisher, e.packageJSON.name) },
			location: e.extensionLocation,
			type: ExtensionType.User,
			packageJSON: e.packageJSON,
		}));
	}

	private async readDefaultUserWebExtensions(): Promise<IStaticExtension[]> {
		const result: IStaticExtension[] = [];
		const defaultUserWebExtensions = this.configurationService.getValue<{ location: string }[]>('_extensions.defaultUserWebExtensions') || [];
		for (const webExtension of defaultUserWebExtensions) {
			const extensionLocation = URI.parse(webExtension.location);
			const manifestLocation = joinPath(extensionLocation, 'package.json');
			const context = await this.requestService.request({ type: 'GET', url: manifestLocation.toString(true) }, CancellationToken.None);
			if (!isSuccess(context)) {
				this.logService.warn('Skipped default user web extension as there is an error while fetching manifest', manifestLocation);
				continue;
			}
			const content = await asText(context);
			if (!content) {
				this.logService.warn('Skipped default user web extension as there is manifest is not found', manifestLocation);
				continue;
			}
			const packageJSON = JSON.parse(content);
			result.push({
				packageJSON,
				extensionLocation,
			});
		}
		return result;
	}

	async scanExtensions(type?: ExtensionType): Promise<IScannedExtension[]> {
		const extensions = [];
		if (type === undefined || type === ExtensionType.System) {
			const systemExtensions = await this.systemExtensionsPromise;
			extensions.push(...systemExtensions);
		}
		if (type === undefined || type === ExtensionType.User) {
			const staticExtensions = await this.defaultExtensionsPromise;
			extensions.push(...staticExtensions);
			const userExtensions = await this.scanUserExtensions();
			extensions.push(...userExtensions);
		}
		return extensions;
	}

	async addExtension(galleryExtension: IGalleryExtension): Promise<IScannedExtension> {
		if (!galleryExtension.assetTypes.some(type => type.startsWith(AssetTypeWebResource))) {
			throw new Error(`Missing ${AssetTypeWebResource} asset type`);
		}

		const packageNLSUri = joinPath(getExtensionLocation(galleryExtension.assetUri), 'package.nls.json');
		const context = await this.requestService.request({ type: 'GET', url: packageNLSUri.toString() }, CancellationToken.None);
		const packageNLSExists = isSuccess(context);

		const userExtensions = await this.readUserExtensions();
		const userExtension: IUserExtension = {
			identifier: galleryExtension.identifier,
			version: galleryExtension.version,
			uri: galleryExtension.assetUri,
			readmeUri: galleryExtension.assets.readme ? URI.parse(galleryExtension.assets.readme.uri) : undefined,
			changelogUri: galleryExtension.assets.changelog ? URI.parse(galleryExtension.assets.changelog.uri) : undefined,
			packageNLSUri: packageNLSExists ? packageNLSUri : undefined
		};
		userExtensions.push(userExtension);
		await this.writeUserExtensions(userExtensions);

		const scannedExtension = await this.toScannedExtension(userExtension);
		if (scannedExtension) {
			return scannedExtension;
		}
		throw new Error('Error while scanning extension');
	}

	async removeExtension(identifier: IExtensionIdentifier, version?: string): Promise<void> {
		let userExtensions = await this.readUserExtensions();
		userExtensions = userExtensions.filter(extension => !(areSameExtensions(extension.identifier, identifier) && version ? extension.version === version : true));
		await this.writeUserExtensions(userExtensions);
	}

	private async scanUserExtensions(): Promise<IScannedExtension[]> {
		let userExtensions = await this.readUserExtensions();
		const byExtension: IUserExtension[][] = groupByExtension(userExtensions, e => e.identifier);
		userExtensions = byExtension.map(p => p.sort((a, b) => semver.rcompare(a.version, b.version))[0]);
		const scannedExtensions: IScannedExtension[] = [];
		await Promise.all(userExtensions.map(async userExtension => {
			try {
				const scannedExtension = await this.toScannedExtension(userExtension);
				if (scannedExtension) {
					scannedExtensions.push(scannedExtension);
				}
			} catch (error) {
				this.logService.error(error, 'Error while scanning user extension', userExtension.identifier.id);
			}
		}));
		return scannedExtensions;
	}

	private async toScannedExtension(userExtension: IUserExtension): Promise<IScannedExtension | null> {
		const context = await this.requestService.request({ type: 'GET', url: joinPath(userExtension.uri, 'Microsoft.VisualStudio.Code.Manifest').toString() }, CancellationToken.None);
		if (isSuccess(context)) {
			const content = await asText(context);
			if (content) {
				const packageJSON = JSON.parse(content);
				return {
					identifier: userExtension.identifier,
					location: getExtensionLocation(userExtension.uri),
					packageJSON,
					type: ExtensionType.User,
					readmeUrl: userExtension.readmeUri,
					changelogUrl: userExtension.changelogUri,
					packageNLSUrl: userExtension.packageNLSUri,
				};
			}
		}
		return null;
	}

	private async readUserExtensions(): Promise<IUserExtension[]> {
		if (!this.extensionsResource) {
			return [];
		}
		return this.userExtensionsResourceLimiter.queue(async () => {
			try {
				const content = await this.fileService.readFile(this.extensionsResource!);
				const storedUserExtensions: IStoredUserExtension[] = JSON.parse(content.value.toString());
				return storedUserExtensions.map(e => ({
					identifier: e.identifier,
					version: e.version,
					uri: URI.revive(e.uri),
					readmeUri: URI.revive(e.readmeUri),
					changelogUri: URI.revive(e.changelogUri),
					packageNLSUri: URI.revive(e.packageNLSUri),
				}));
			} catch (error) { /* Ignore */ }
			return [];
		});
	}

	private writeUserExtensions(userExtensions: IUserExtension[]): Promise<IUserExtension[]> {
		if (!this.extensionsResource) {
			throw new Error('unsupported');
		}
		return this.userExtensionsResourceLimiter.queue(async () => {
			const storedUserExtensions: IStoredUserExtension[] = userExtensions.map(e => ({
				identifier: e.identifier,
				version: e.version,
				uri: e.uri.toJSON(),
				readmeUri: e.readmeUri?.toJSON(),
				changelogUri: e.changelogUri?.toJSON(),
				packageNLSUri: e.packageNLSUri?.toJSON(),
			}));
			await this.fileService.writeFile(this.extensionsResource!, VSBuffer.fromString(JSON.stringify(storedUserExtensions)));
			return userExtensions;
		});
	}

}

registerSingleton(IWebExtensionsScannerService, WebExtensionsScannerService);
