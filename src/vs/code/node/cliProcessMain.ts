/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { raceTimeout } from 'vs/base/common/async';
import * as semver from 'vs/base/common/semver/semver';
import product from 'vs/platform/product/common/product';
import * as path from 'vs/base/common/path';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { InstantiationService } from 'vs/platform/instantiation/common/instantiationService';
import { IEnvironmentService, INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { NativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IExtensionManagementService, IExtensionGalleryService, IGalleryExtension, ILocalExtension, InstallOptions } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionManagementService } from 'vs/platform/extensionManagement/node/extensionManagementService';
import { ExtensionGalleryService } from 'vs/platform/extensionManagement/common/extensionGalleryService';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { combinedAppender, NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { TelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { resolveCommonProperties } from 'vs/platform/telemetry/node/commonProperties';
import { IRequestService } from 'vs/platform/request/common/request';
import { RequestService } from 'vs/platform/request/node/requestService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ConfigurationService } from 'vs/platform/configuration/common/configurationService';
import { AppInsightsAppender } from 'vs/platform/telemetry/node/appInsightsAppender';
import { mkdirp, writeFile } from 'vs/base/node/pfs';
import { getBaseLabel } from 'vs/base/common/labels';
import { IStateService } from 'vs/platform/state/node/state';
import { StateService } from 'vs/platform/state/node/stateService';
import { ILogService, getLogLevel, LogLevel, ConsoleLogService, MultiplexLogService } from 'vs/platform/log/common/log';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { areSameExtensions, adoptToGalleryExtensionId, getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { URI } from 'vs/base/common/uri';
import { getManifest } from 'vs/platform/extensionManagement/node/extensionManagementUtil';
import { IExtensionManifest, ExtensionType, isLanguagePackExtension, EXTENSION_CATEGORIES } from 'vs/platform/extensions/common/extensions';
import { CancellationToken } from 'vs/base/common/cancellation';
import { LocalizationsService } from 'vs/platform/localizations/node/localizations';
import { Schemas } from 'vs/base/common/network';
import { SpdLogService } from 'vs/platform/log/node/spdlogService';
import { buildTelemetryMessage } from 'vs/platform/telemetry/node/telemetry';
import { FileService } from 'vs/platform/files/common/fileService';
import { IFileService } from 'vs/platform/files/common/files';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { IProductService } from 'vs/platform/product/common/productService';

const notFound = (id: string) => localize('notFound', "Extension '{0}' not found.", id);
const notInstalled = (id: string) => localize('notInstalled', "Extension '{0}' is not installed.", id);
const useId = localize('useId', "Make sure you use the full extension ID, including the publisher, e.g.: {0}", 'ms-dotnettools.csharp');

function getId(manifest: IExtensionManifest, withVersion?: boolean): string {
	if (withVersion) {
		return `${manifest.publisher}.${manifest.name}@${manifest.version}`;
	} else {
		return `${manifest.publisher}.${manifest.name}`;
	}
}

const EXTENSION_ID_REGEX = /^([^.]+\..+)@(\d+\.\d+\.\d+(-.*)?)$/;

export function getIdAndVersion(id: string): [string, string | undefined] {
	const matches = EXTENSION_ID_REGEX.exec(id);
	if (matches && matches[1]) {
		return [adoptToGalleryExtensionId(matches[1]), matches[2]];
	}
	return [adoptToGalleryExtensionId(id), undefined];
}

type InstallExtensionInfo = { id: string, version?: string, installOptions: InstallOptions };

export class Main {

	constructor(
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@INativeEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IExtensionManagementService private readonly extensionManagementService: IExtensionManagementService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
	) { }

	async run(argv: NativeParsedArgs): Promise<void> {
		if (argv['install-source']) {
			await this.setInstallSource(argv['install-source']);
		} else if (argv['list-extensions']) {
			await this.listExtensions(!!argv['show-versions'], argv['category']);
		} else if (argv['install-extension'] || argv['install-builtin-extension']) {
			await this.installExtensions(argv['install-extension'] || [], argv['install-builtin-extension'] || [], !!argv['do-not-sync'], !!argv['force']);
		} else if (argv['uninstall-extension']) {
			await this.uninstallExtension(argv['uninstall-extension'], !!argv['force']);
		} else if (argv['locate-extension']) {
			await this.locateExtension(argv['locate-extension']);
		} else if (argv['telemetry']) {
			console.log(buildTelemetryMessage(this.environmentService.appRoot, this.environmentService.extensionsPath));
		}
	}

	private setInstallSource(installSource: string): Promise<void> {
		return writeFile(this.environmentService.installSourcePath, installSource.slice(0, 30));
	}

	private async listExtensions(showVersions: boolean, category?: string): Promise<void> {
		let extensions = await this.extensionManagementService.getInstalled(ExtensionType.User);
		const categories = EXTENSION_CATEGORIES.map(c => c.toLowerCase());
		if (category && category !== '') {
			if (categories.indexOf(category.toLowerCase()) < 0) {
				console.log('Invalid category please enter a valid category. To list valid categories run --category without a category specified');
				return;
			}
			extensions = extensions.filter(e => {
				if (e.manifest.categories) {
					const lowerCaseCategories: string[] = e.manifest.categories.map(c => c.toLowerCase());
					return lowerCaseCategories.indexOf(category.toLowerCase()) > -1;
				}
				return false;
			});
		} else if (category === '') {
			console.log('Possible Categories: ');
			categories.forEach(category => {
				console.log(category);
			});
			return;
		}
		extensions.forEach(e => console.log(getId(e.manifest, showVersions)));
	}

	async installExtensions(extensions: string[], builtinExtensionIds: string[], isMachineScoped: boolean, force: boolean): Promise<void> {
		const failed: string[] = [];
		const installedExtensionsManifests: IExtensionManifest[] = [];
		if (extensions.length) {
			console.log(localize('installingExtensions', "Installing extensions..."));
		}

		const installed = await this.extensionManagementService.getInstalled(ExtensionType.User);
		const checkIfNotInstalled = (id: string, version?: string): boolean => {
			const installedExtension = installed.find(i => areSameExtensions(i.identifier, { id }));
			if (installedExtension) {
				if (!version && !force) {
					console.log(localize('alreadyInstalled-checkAndUpdate', "Extension '{0}' v{1} is already installed. Use '--force' option to update to latest version or provide '@<version>' to install a specific version, for example: '{2}@1.2.3'.", id, installedExtension.manifest.version, id));
					return false;
				}
				if (version && installedExtension.manifest.version === version) {
					console.log(localize('alreadyInstalled', "Extension '{0}' is already installed.", `${id}@${version}`));
					return false;
				}
			}
			return true;
		};
		const vsixs: string[] = [];
		const installExtensionInfos: InstallExtensionInfo[] = [];
		for (const extension of extensions) {
			if (/\.vsix$/i.test(extension)) {
				vsixs.push(extension);
			} else {
				const [id, version] = getIdAndVersion(extension);
				if (checkIfNotInstalled(id, version)) {
					installExtensionInfos.push({ id, version, installOptions: { isBuiltin: false, isMachineScoped } });
				}
			}
		}
		for (const extension of builtinExtensionIds) {
			const [id, version] = getIdAndVersion(extension);
			if (checkIfNotInstalled(id, version)) {
				installExtensionInfos.push({ id, version, installOptions: { isBuiltin: true, isMachineScoped: false } });
			}
		}

		if (vsixs.length) {
			await Promise.all(vsixs.map(async vsix => {
				try {
					const manifest = await this.installVSIX(vsix, force);
					if (manifest) {
						installedExtensionsManifests.push(manifest);
					}
				} catch (err) {
					console.error(err.message || err.stack || err);
					failed.push(vsix);
				}
			}));
		}

		if (installExtensionInfos.length) {

			const galleryExtensions = await this.getGalleryExtensions(installExtensionInfos);

			await Promise.all(installExtensionInfos.map(async extensionInfo => {
				const gallery = galleryExtensions.get(extensionInfo.id.toLowerCase());
				if (gallery) {
					try {
						const manifest = await this.installFromGallery(extensionInfo, gallery, installed, force);
						if (manifest) {
							installedExtensionsManifests.push(manifest);
						}
					} catch (err) {
						console.error(err.message || err.stack || err);
						failed.push(extensionInfo.id);
					}
				} else {
					console.error(`${notFound(extensionInfo.version ? `${extensionInfo.id}@${extensionInfo.version}` : extensionInfo.id)}\n${useId}`);
					failed.push(extensionInfo.id);
				}
			}));

		}

		if (installedExtensionsManifests.some(manifest => isLanguagePackExtension(manifest))) {
			await this.updateLocalizationsCache();
		}

		if (failed.length) {
			throw new Error(localize('installation failed', "Failed Installing Extensions: {0}", failed.join(', ')));
		}
	}

	private async installVSIX(vsix: string, force: boolean): Promise<IExtensionManifest | null> {
		vsix = path.isAbsolute(vsix) ? vsix : path.join(process.cwd(), vsix);
		const manifest = await getManifest(vsix);
		const valid = await this.validate(manifest, force);
		if (valid) {
			try {
				await this.extensionManagementService.install(URI.file(vsix));
				console.log(localize('successVsixInstall', "Extension '{0}' was successfully installed.", getBaseLabel(vsix)));
				return manifest;
			} catch (error) {
				if (isPromiseCanceledError(error)) {
					console.log(localize('cancelVsixInstall', "Cancelled installing extension '{0}'.", getBaseLabel(vsix)));
					return null;
				} else {
					throw error;
				}
			}
		}
		return null;
	}

	private async getGalleryExtensions(extensions: InstallExtensionInfo[]): Promise<Map<string, IGalleryExtension>> {
		const extensionIds = extensions.filter(({ version }) => version === undefined).map(({ id }) => id);
		const extensionsWithIdAndVersion = extensions.filter(({ version }) => version !== undefined);

		const galleryExtensions = new Map<string, IGalleryExtension>();
		await Promise.all([
			(async () => {
				const result = await this.extensionGalleryService.getExtensions(extensionIds, CancellationToken.None);
				result.forEach(extension => galleryExtensions.set(extension.identifier.id.toLowerCase(), extension));
			})(),
			Promise.all(extensionsWithIdAndVersion.map(async ({ id, version }) => {
				const extension = await this.extensionGalleryService.getCompatibleExtension({ id }, version);
				if (extension) {
					galleryExtensions.set(extension.identifier.id.toLowerCase(), extension);
				}
			}))
		]);

		return galleryExtensions;
	}

	private async installFromGallery({ id, version, installOptions }: InstallExtensionInfo, galleryExtension: IGalleryExtension, installed: ILocalExtension[], force: boolean): Promise<IExtensionManifest | null> {
		const manifest = await this.extensionGalleryService.getManifest(galleryExtension, CancellationToken.None);
		const installedExtension = installed.find(e => areSameExtensions(e.identifier, galleryExtension.identifier));
		if (installedExtension) {
			if (galleryExtension.version === installedExtension.manifest.version) {
				console.log(localize('alreadyInstalled', "Extension '{0}' is already installed.", version ? `${id}@${version}` : id));
				return null;
			}
			console.log(localize('updateMessage', "Updating the extension '{0}' to the version {1}", id, galleryExtension.version));
		}

		try {
			if (installOptions.isBuiltin) {
				console.log(localize('installing builtin ', "Installing builtin extension '{0}' v{1}...", id, galleryExtension.version));
			} else {
				console.log(localize('installing', "Installing extension '{0}' v{1}...", id, galleryExtension.version));
			}
			await this.extensionManagementService.installFromGallery(galleryExtension, installOptions);
			console.log(localize('successInstall', "Extension '{0}' v{1} was successfully installed.", id, galleryExtension.version));
			return manifest;
		} catch (error) {
			if (isPromiseCanceledError(error)) {
				console.log(localize('cancelInstall', "Cancelled installing extension '{0}'.", id));
				return null;
			} else {
				throw error;
			}
		}
	}

	private async validate(manifest: IExtensionManifest, force: boolean): Promise<boolean> {
		if (!manifest) {
			throw new Error('Invalid vsix');
		}

		const extensionIdentifier = { id: getGalleryExtensionId(manifest.publisher, manifest.name) };
		const installedExtensions = await this.extensionManagementService.getInstalled(ExtensionType.User);
		const newer = installedExtensions.find(local => areSameExtensions(extensionIdentifier, local.identifier) && semver.gt(local.manifest.version, manifest.version));

		if (newer && !force) {
			console.log(localize('forceDowngrade', "A newer version of extension '{0}' v{1} is already installed. Use '--force' option to downgrade to older version.", newer.identifier.id, newer.manifest.version, manifest.version));
			return false;
		}

		return true;
	}

	private async uninstallExtension(extensions: string[], force: boolean): Promise<void> {
		async function getExtensionId(extensionDescription: string): Promise<string> {
			if (!/\.vsix$/i.test(extensionDescription)) {
				return extensionDescription;
			}

			const zipPath = path.isAbsolute(extensionDescription) ? extensionDescription : path.join(process.cwd(), extensionDescription);
			const manifest = await getManifest(zipPath);
			return getId(manifest);
		}

		const uninstalledExtensions: ILocalExtension[] = [];
		for (const extension of extensions) {
			const id = await getExtensionId(extension);
			const installed = await this.extensionManagementService.getInstalled();
			const extensionToUninstall = installed.find(e => areSameExtensions(e.identifier, { id }));
			if (!extensionToUninstall) {
				throw new Error(`${notInstalled(id)}\n${useId}`);
			}
			if (extensionToUninstall.type === ExtensionType.System) {
				console.log(localize('builtin', "Extension '{0}' is a Built-in extension and cannot be installed", id));
				return;
			}
			if (extensionToUninstall.isBuiltin && !force) {
				console.log(localize('forceUninstall', "Extension '{0}' is marked as a Built-in extension by user. Please use '--force' option to uninstall it.", id));
				return;
			}
			console.log(localize('uninstalling', "Uninstalling {0}...", id));
			await this.extensionManagementService.uninstall(extensionToUninstall);
			uninstalledExtensions.push(extensionToUninstall);
			console.log(localize('successUninstall', "Extension '{0}' was successfully uninstalled!", id));
		}

		if (uninstalledExtensions.some(e => isLanguagePackExtension(e.manifest))) {
			await this.updateLocalizationsCache();
		}
	}

	private async locateExtension(extensions: string[]): Promise<void> {
		const installed = await this.extensionManagementService.getInstalled();
		extensions.forEach(e => {
			installed.forEach(i => {
				if (i.identifier.id === e) {
					if (i.location.scheme === Schemas.file) {
						console.log(i.location.fsPath);
						return;
					}
				}
			});
		});
	}

	private async updateLocalizationsCache(): Promise<void> {
		const localizationService = this.instantiationService.createInstance(LocalizationsService);
		await localizationService.update();
		localizationService.dispose();
	}
}

const eventPrefix = 'monacoworkbench';

export async function main(argv: NativeParsedArgs): Promise<void> {
	const services = new ServiceCollection();
	const disposables = new DisposableStore();

	const environmentService = new NativeEnvironmentService(argv);
	const logLevel = getLogLevel(environmentService);
	const loggers: ILogService[] = [];
	loggers.push(new SpdLogService('cli', environmentService.logsPath, logLevel));
	if (logLevel === LogLevel.Trace) {
		loggers.push(new ConsoleLogService(logLevel));
	}
	const logService = new MultiplexLogService(loggers);
	process.once('exit', () => logService.dispose());
	logService.info('main', argv);

	await Promise.all<void | undefined>([environmentService.appSettingsHome.fsPath, environmentService.extensionsPath]
		.map((path): undefined | Promise<void> => path ? mkdirp(path) : undefined));

	// Files
	const fileService = new FileService(logService);
	disposables.add(fileService);
	services.set(IFileService, fileService);

	const diskFileSystemProvider = new DiskFileSystemProvider(logService);
	disposables.add(diskFileSystemProvider);
	fileService.registerProvider(Schemas.file, diskFileSystemProvider);

	const configurationService = new ConfigurationService(environmentService.settingsResource, fileService);
	disposables.add(configurationService);
	await configurationService.initialize();

	services.set(IEnvironmentService, environmentService);
	services.set(INativeEnvironmentService, environmentService);

	services.set(ILogService, logService);
	services.set(IConfigurationService, configurationService);
	services.set(IStateService, new SyncDescriptor(StateService));
	services.set(IProductService, { _serviceBrand: undefined, ...product });

	const instantiationService: IInstantiationService = new InstantiationService(services);

	return instantiationService.invokeFunction(async accessor => {
		const stateService = accessor.get(IStateService);

		const { appRoot, extensionsPath, extensionDevelopmentLocationURI, isBuilt, installSourcePath } = environmentService;

		const services = new ServiceCollection();
		services.set(IRequestService, new SyncDescriptor(RequestService));
		services.set(IExtensionManagementService, new SyncDescriptor(ExtensionManagementService));
		services.set(IExtensionGalleryService, new SyncDescriptor(ExtensionGalleryService));

		const appenders: AppInsightsAppender[] = [];
		if (isBuilt && !extensionDevelopmentLocationURI && !environmentService.disableTelemetry && product.enableTelemetry) {
			if (product.aiConfig && product.aiConfig.asimovKey) {
				appenders.push(new AppInsightsAppender(eventPrefix, null, product.aiConfig.asimovKey));
			}

			const config: ITelemetryServiceConfig = {
				appender: combinedAppender(...appenders),
				sendErrorTelemetry: false,
				commonProperties: resolveCommonProperties(product.commit, product.version, stateService.getItem('telemetry.machineId'), product.msftInternalDomains, installSourcePath),
				piiPaths: [appRoot, extensionsPath]
			};

			services.set(ITelemetryService, new SyncDescriptor(TelemetryService, [config]));

		} else {
			services.set(ITelemetryService, NullTelemetryService);
		}

		const instantiationService2 = instantiationService.createChild(services);
		const main = instantiationService2.createInstance(Main);

		try {
			await main.run(argv);

			// Flush the remaining data in AI adapter.
			// If it does not complete in 1 second, exit the process.
			await raceTimeout(combinedAppender(...appenders).flush(), 1000);
		} finally {
			disposables.dispose();
		}
	});
}
