/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBuiltinExtensionsScannerService, IScannedExtension, ExtensionType, IExtensionIdentifier, ITranslatedScannedExtension } from 'vs/platform/extensions/common/extensions';
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
import type { IStaticExtension } from 'vs/workbench/workbench.web.api';
import { Disposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { localizeManifest } from 'vs/platform/extensionManagement/common/extensionNls';
import { localize } from 'vs/nls';
import * as semver from 'vs/base/common/semver/semver';
import { isArray } from 'vs/base/common/types';

interface IUserExtension {
	identifier: IExtensionIdentifier;
	version: string;
	location: URI;
	readmeUri?: URI;
	changelogUri?: URI;
	packageNLSUri?: URI;
}

interface IStoredUserExtension {
	identifier: IExtensionIdentifier;
	version: string;
	location: UriComponents;
	readmeUri?: UriComponents;
	changelogUri?: UriComponents;
	packageNLSUri?: UriComponents;
}

export class WebExtensionsScannerService extends Disposable implements IWebExtensionsScannerService {

	declare readonly _serviceBrand: undefined;

	private readonly systemExtensionsPromise: Promise<IScannedExtension[]> = Promise.resolve([]);
	private readonly defaultExtensionsPromise: Promise<IScannedExtension[]> = Promise.resolve([]);
	private readonly extensionsResource: URI | undefined = undefined;
	private readonly userExtensionsResourceLimiter: Queue<IUserExtension[]> = new Queue<IUserExtension[]>();

	private userExtensionsPromise: Promise<IScannedExtension[]> | undefined;

	constructor(
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IBuiltinExtensionsScannerService private readonly builtinExtensionsScannerService: IBuiltinExtensionsScannerService,
		@IFileService private readonly fileService: IFileService,
		@IRequestService private readonly requestService: IRequestService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		if (isWeb) {
			this.extensionsResource = joinPath(environmentService.userRoamingDataHome, 'extensions.json');
			this.systemExtensionsPromise = this.readSystemExtensions();
			this.defaultExtensionsPromise = this.readDefaultExtensions();
			if (this.extensionsResource) {
				this._register(Event.filter(this.fileService.onDidFilesChange, e => e.contains(this.extensionsResource!))(() => this.userExtensionsPromise = undefined));
			}
		}
	}

	private async readSystemExtensions(): Promise<IScannedExtension[]> {
		const extensions = await this.builtinExtensionsScannerService.scanBuiltinExtensions();
		return extensions.concat(this.getStaticExtensions(true));
	}

	/**
	 * All extensions defined via `staticExtensions`
	 */
	private getStaticExtensions(builtin: boolean): IScannedExtension[] {
		const staticExtensions = this.environmentService.options && Array.isArray(this.environmentService.options.staticExtensions) ? this.environmentService.options.staticExtensions : [];
		const result: IScannedExtension[] = [];
		for (const e of staticExtensions) {
			if (Boolean(e.isBuiltin) === builtin) {
				const scannedExtension = this.parseStaticExtension(e, builtin, false);
				if (scannedExtension) {
					result.push(scannedExtension);
				}
			}
		}
		return result;
	}

	/**
	 * All dev extensions
	 */
	private getDevExtensions(): IScannedExtension[] {
		const devExtensions = this.environmentService.options?.developmentOptions?.extensions;
		const result: IScannedExtension[] = [];
		if (Array.isArray(devExtensions)) {
			for (const e of devExtensions) {
				const scannedExtension = this.parseStaticExtension(e, false, true);
				if (scannedExtension) {
					result.push(scannedExtension);
				}
			}
		}
		return result;
	}

	private async readDefaultExtensions(): Promise<IScannedExtension[]> {
		const defaultUserWebExtensions = await this.readDefaultUserWebExtensions();
		const extensions: IScannedExtension[] = [];
		for (const e of defaultUserWebExtensions) {
			const scannedExtension = this.parseStaticExtension(e, false, false);
			if (scannedExtension) {
				extensions.push(scannedExtension);
			}
		}
		return extensions.concat(this.getStaticExtensions(false), this.getDevExtensions());
	}

	private parseStaticExtension(e: IStaticExtension, builtin: boolean, isUnderDevelopment: boolean): IScannedExtension | null {
		const extensionLocation = URI.revive(e.extensionLocation);
		try {
			return {
				identifier: { id: getGalleryExtensionId(e.packageJSON.publisher, e.packageJSON.name) },
				location: extensionLocation,
				type: builtin ? ExtensionType.System : ExtensionType.User,
				packageJSON: e.packageJSON,
				isUnderDevelopment
			};
		} catch (error) {
			this.logService.error(`Error while parsing extension ${extensionLocation.toString()}`);
			this.logService.error(error);
		}
		return null;
	}

	private async readDefaultUserWebExtensions(): Promise<IStaticExtension[]> {
		const result: IStaticExtension[] = [];
		const defaultUserWebExtensions = this.configurationService.getValue<{ location: string }[]>('_extensions.defaultUserWebExtensions');
		if (isArray(defaultUserWebExtensions)) {
			for (const webExtension of defaultUserWebExtensions) {
				try {
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
				} catch (error) {
					this.logService.warn('Skipped default user web extension as there is an error while fetching manifest', webExtension);
				}
			}
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
			if (!this.userExtensionsPromise) {
				this.userExtensionsPromise = this.scanUserExtensions();
			}
			const userExtensions = await this.userExtensionsPromise;
			extensions.push(...userExtensions);
		}
		return extensions;
	}

	async scanAndTranslateExtensions(type?: ExtensionType): Promise<ITranslatedScannedExtension[]> {
		const extensions = await this.scanExtensions(type);
		return Promise.all(extensions.map((ext) => this._translateScannedExtension(ext)));
	}

	async scanAndTranslateSingleExtension(extensionLocation: URI, extensionType: ExtensionType): Promise<ITranslatedScannedExtension | null> {
		const extension = await this._scanSingleExtension(extensionLocation, extensionType);
		if (extension) {
			return this._translateScannedExtension(extension);
		}
		return null;
	}

	private async _scanSingleExtension(extensionLocation: URI, extensionType: ExtensionType): Promise<IScannedExtension | null> {
		if (extensionType === ExtensionType.System) {
			const systemExtensions = await this.systemExtensionsPromise;
			return this._findScannedExtension(systemExtensions, extensionLocation);
		}

		const staticExtensions = await this.defaultExtensionsPromise;
		const userExtensions = await this.scanUserExtensions();
		return this._findScannedExtension(staticExtensions.concat(userExtensions), extensionLocation);
	}

	private _findScannedExtension(candidates: IScannedExtension[], extensionLocation: URI): IScannedExtension | null {
		for (const candidate of candidates) {
			if (candidate.location.toString() === extensionLocation.toString()) {
				return candidate;
			}
		}
		return null;
	}

	private async _translateScannedExtension(scannedExtension: IScannedExtension): Promise<ITranslatedScannedExtension> {
		let manifest = scannedExtension.packageJSON;
		if (scannedExtension.packageNLS) {
			// package.nls.json is inlined
			try {
				manifest = localizeManifest(manifest, scannedExtension.packageNLS);
			} catch (error) {
				console.log(error);
				/* ignore */
			}
		} else if (scannedExtension.packageNLSUrl) {
			// package.nls.json needs to be fetched
			try {
				const context = await this.requestService.request({ type: 'GET', url: scannedExtension.packageNLSUrl.toString() }, CancellationToken.None);
				if (isSuccess(context)) {
					const content = await asText(context);
					if (content) {
						manifest = localizeManifest(manifest, JSON.parse(content));
					}
				}
			} catch (error) { /* ignore */ }
		}
		return {
			identifier: scannedExtension.identifier,
			location: scannedExtension.location,
			type: scannedExtension.type,
			packageJSON: manifest,
			readmeUrl: scannedExtension.readmeUrl,
			changelogUrl: scannedExtension.changelogUrl,
			isUnderDevelopment: scannedExtension.isUnderDevelopment
		};
	}

	canAddExtension(galleryExtension: IGalleryExtension): boolean {
		return !!galleryExtension.properties.webExtension && !!galleryExtension.webResource;
	}

	async addExtension(galleryExtension: IGalleryExtension): Promise<IScannedExtension> {
		if (!this.canAddExtension(galleryExtension)) {
			throw new Error(localize('cannot be installed', "Cannot install '{0}' because this extension is not a web extension.", galleryExtension.displayName || galleryExtension.name));
		}

		const extensionLocation = galleryExtension.webResource!;
		const packageNLSUri = joinPath(extensionLocation, 'package.nls.json');
		const context = await this.requestService.request({ type: 'GET', url: packageNLSUri.toString() }, CancellationToken.None);
		const packageNLSExists = isSuccess(context);

		const userExtensions = await this.readUserExtensions();
		const userExtension: IUserExtension = {
			identifier: galleryExtension.identifier,
			version: galleryExtension.version,
			location: extensionLocation,
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
		userExtensions = userExtensions.filter(extension => !(areSameExtensions(extension.identifier, identifier) && (version ? extension.version === version : true)));
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
		const context = await this.requestService.request({ type: 'GET', url: joinPath(userExtension.location, 'package.json').toString() }, CancellationToken.None);
		if (isSuccess(context)) {
			const content = await asText(context);
			if (content) {
				const packageJSON = JSON.parse(content);
				return {
					identifier: userExtension.identifier,
					location: userExtension.location,
					packageJSON,
					type: ExtensionType.User,
					readmeUrl: userExtension.readmeUri,
					changelogUrl: userExtension.changelogUri,
					packageNLSUrl: userExtension.packageNLSUri,
					isUnderDevelopment: false
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
				const storedUserExtensions: IStoredUserExtension[] = this.parseExtensions(content.value.toString());
				return storedUserExtensions.map(e => ({
					identifier: e.identifier,
					version: e.version,
					location: URI.revive(e.location),
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
				location: e.location.toJSON(),
				readmeUri: e.readmeUri?.toJSON(),
				changelogUri: e.changelogUri?.toJSON(),
				packageNLSUri: e.packageNLSUri?.toJSON(),
			}));
			await this.fileService.writeFile(this.extensionsResource!, VSBuffer.fromString(JSON.stringify(storedUserExtensions)));
			this.userExtensionsPromise = undefined;
			return userExtensions;
		});
	}

	private parseExtensions(content: string): IStoredUserExtension[] {
		const storedUserExtensions: (IStoredUserExtension & { uri?: UriComponents })[] = JSON.parse(content.toString());
		return storedUserExtensions.map(e => {
			const location = e.uri ? joinPath(URI.revive(e.uri), 'Microsoft.VisualStudio.Code.WebResources', 'extension') : e.location;
			return { ...e, location };
		});
	}

}

registerSingleton(IWebExtensionsScannerService, WebExtensionsScannerService);
