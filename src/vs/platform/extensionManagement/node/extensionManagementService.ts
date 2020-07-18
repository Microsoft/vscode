/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as path from 'vs/base/common/path';
import * as pfs from 'vs/base/node/pfs';
import { assign } from 'vs/base/common/objects';
import { toDisposable, Disposable } from 'vs/base/common/lifecycle';
import { isNonEmptyArray } from 'vs/base/common/arrays';
import { zip, IFile } from 'vs/base/node/zip';
import {
	IExtensionManagementService, IExtensionGalleryService, ILocalExtension,
	IGalleryExtension, IGalleryMetadata,
	InstallExtensionEvent, DidInstallExtensionEvent, DidUninstallExtensionEvent,
	StatisticType,
	IExtensionIdentifier,
	IReportedExtension,
	InstallOperation,
	INSTALL_ERROR_MALICIOUS,
	INSTALL_ERROR_INCOMPATIBLE,
	ExtensionManagementError
} from 'vs/platform/extensionManagement/common/extensionManagement';
import { areSameExtensions, getGalleryExtensionId, getMaliciousExtensionsSet, getGalleryExtensionTelemetryData, getLocalExtensionTelemetryData, ExtensionIdentifierWithVersion } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { createCancelablePromise, CancelablePromise } from 'vs/base/common/async';
import { Event, Emitter } from 'vs/base/common/event';
import * as semver from 'semver-umd';
import { URI } from 'vs/base/common/uri';
import product from 'vs/platform/product/common/product';
import { isMacintosh } from 'vs/base/common/platform';
import { ILogService } from 'vs/platform/log/common/log';
import { ExtensionsManifestCache } from 'vs/platform/extensionManagement/node/extensionsManifestCache';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { isEngineValid } from 'vs/platform/extensions/common/extensionValidator';
import { tmpdir } from 'os';
import { generateUuid } from 'vs/base/common/uuid';
import { IDownloadService } from 'vs/platform/download/common/download';
import { optional, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Schemas } from 'vs/base/common/network';
import { CancellationToken } from 'vs/base/common/cancellation';
import { getManifest } from 'vs/platform/extensionManagement/node/extensionManagementUtil';
import { IExtensionManifest, ExtensionType } from 'vs/platform/extensions/common/extensions';
import { ExtensionsDownloader } from 'vs/platform/extensionManagement/node/extensionDownloader';
import { ExtensionsScanner, IMetadata } from 'vs/platform/extensionManagement/node/extensionsScanner';
import { ExtensionsLifecycle } from 'vs/platform/extensionManagement/node/extensionLifecycle';

const INSTALL_ERROR_UNSET_UNINSTALLED = 'unsetUninstalled';
const INSTALL_ERROR_DOWNLOADING = 'downloading';
const INSTALL_ERROR_VALIDATING = 'validating';
const INSTALL_ERROR_LOCAL = 'local';
const ERROR_UNKNOWN = 'unknown';

interface InstallableExtension {
	zipPath: string;
	identifierWithVersion: ExtensionIdentifierWithVersion;
	metadata?: IMetadata;
}

export class ExtensionManagementService extends Disposable implements IExtensionManagementService {

	declare readonly _serviceBrand: undefined;

	private readonly extensionsScanner: ExtensionsScanner;
	private reportedExtensions: Promise<IReportedExtension[]> | undefined;
	private lastReportTimestamp = 0;
	private readonly installingExtensions: Map<string, CancelablePromise<ILocalExtension>> = new Map<string, CancelablePromise<ILocalExtension>>();
	private readonly uninstallingExtensions: Map<string, CancelablePromise<void>> = new Map<string, CancelablePromise<void>>();
	private readonly manifestCache: ExtensionsManifestCache;
	private readonly extensionsDownloader: ExtensionsDownloader;

	private readonly _onInstallExtension = this._register(new Emitter<InstallExtensionEvent>());
	readonly onInstallExtension: Event<InstallExtensionEvent> = this._onInstallExtension.event;

	private readonly _onDidInstallExtension = this._register(new Emitter<DidInstallExtensionEvent>());
	readonly onDidInstallExtension: Event<DidInstallExtensionEvent> = this._onDidInstallExtension.event;

	private readonly _onUninstallExtension = this._register(new Emitter<IExtensionIdentifier>());
	readonly onUninstallExtension: Event<IExtensionIdentifier> = this._onUninstallExtension.event;

	private _onDidUninstallExtension = this._register(new Emitter<DidUninstallExtensionEvent>());
	onDidUninstallExtension: Event<DidUninstallExtensionEvent> = this._onDidUninstallExtension.event;

	constructor(
		@IEnvironmentService environmentService: INativeEnvironmentService,
		@IExtensionGalleryService private readonly galleryService: IExtensionGalleryService,
		@ILogService private readonly logService: ILogService,
		@optional(IDownloadService) private downloadService: IDownloadService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		const extensionLifecycle = this._register(instantiationService.createInstance(ExtensionsLifecycle));
		this.extensionsScanner = this._register(instantiationService.createInstance(ExtensionsScanner, extension => extensionLifecycle.postUninstall(extension)));
		this.manifestCache = this._register(new ExtensionsManifestCache(environmentService, this));
		this.extensionsDownloader = this._register(instantiationService.createInstance(ExtensionsDownloader));

		this._register(toDisposable(() => {
			this.installingExtensions.forEach(promise => promise.cancel());
			this.uninstallingExtensions.forEach(promise => promise.cancel());
			this.installingExtensions.clear();
			this.uninstallingExtensions.clear();
		}));
	}

	zip(extension: ILocalExtension): Promise<URI> {
		this.logService.trace('ExtensionManagementService#zip', extension.identifier.id);
		return this.collectFiles(extension)
			.then(files => zip(path.join(tmpdir(), generateUuid()), files))
			.then<URI>(path => URI.file(path));
	}

	unzip(zipLocation: URI): Promise<IExtensionIdentifier> {
		this.logService.trace('ExtensionManagementService#unzip', zipLocation.toString());
		return this.install(zipLocation).then(local => local.identifier);
	}

	async getManifest(vsix: URI): Promise<IExtensionManifest> {
		const downloadLocation = await this.downloadVsix(vsix);
		const zipPath = path.resolve(downloadLocation.fsPath);
		return getManifest(zipPath);
	}

	private collectFiles(extension: ILocalExtension): Promise<IFile[]> {

		const collectFilesFromDirectory = async (dir: string): Promise<string[]> => {
			let entries = await pfs.readdir(dir);
			entries = entries.map(e => path.join(dir, e));
			const stats = await Promise.all(entries.map(e => pfs.stat(e)));
			let promise: Promise<string[]> = Promise.resolve([]);
			stats.forEach((stat, index) => {
				const entry = entries[index];
				if (stat.isFile()) {
					promise = promise.then(result => ([...result, entry]));
				}
				if (stat.isDirectory()) {
					promise = promise
						.then(result => collectFilesFromDirectory(entry)
							.then(files => ([...result, ...files])));
				}
			});
			return promise;
		};

		return collectFilesFromDirectory(extension.location.fsPath)
			.then(files => files.map(f => (<IFile>{ path: `extension/${path.relative(extension.location.fsPath, f)}`, localPath: f })));

	}

	install(vsix: URI, isMachineScoped?: boolean): Promise<ILocalExtension> {
		this.logService.trace('ExtensionManagementService#install', vsix.toString());
		return createCancelablePromise(token => {
			return this.downloadVsix(vsix).then(downloadLocation => {
				const zipPath = path.resolve(downloadLocation.fsPath);

				return getManifest(zipPath)
					.then(manifest => {
						const identifier = { id: getGalleryExtensionId(manifest.publisher, manifest.name) };
						let operation: InstallOperation = InstallOperation.Install;
						if (manifest.engines && manifest.engines.vscode && !isEngineValid(manifest.engines.vscode, product.version)) {
							return Promise.reject(new Error(nls.localize('incompatible', "Unable to install extension '{0}' as it is not compatible with VS Code '{1}'.", identifier.id, product.version)));
						}
						const identifierWithVersion = new ExtensionIdentifierWithVersion(identifier, manifest.version);
						return this.getInstalled(ExtensionType.User)
							.then(installedExtensions => {
								const existing = installedExtensions.filter(i => areSameExtensions(identifier, i.identifier))[0];
								if (existing) {
									isMachineScoped = isMachineScoped || existing.isMachineScoped;
									operation = InstallOperation.Update;
									if (identifierWithVersion.equals(new ExtensionIdentifierWithVersion(existing.identifier, existing.manifest.version))) {
										return this.extensionsScanner.removeExtension(existing, 'existing').then(null, e => Promise.reject(new Error(nls.localize('restartCode', "Please restart VS Code before reinstalling {0}.", manifest.displayName || manifest.name))));
									} else if (semver.gt(existing.manifest.version, manifest.version)) {
										return this.uninstallExtension(existing);
									}
								} else {
									// Remove the extension with same version if it is already uninstalled.
									// Installing a VSIX extension shall replace the existing extension always.
									return this.unsetUninstalledAndGetLocal(identifierWithVersion)
										.then(existing => {
											if (existing) {
												return this.extensionsScanner.removeExtension(existing, 'existing').then(null, e => Promise.reject(new Error(nls.localize('restartCode', "Please restart VS Code before reinstalling {0}.", manifest.displayName || manifest.name))));
											}
											return undefined;
										});
								}
								return undefined;
							})
							.then(() => {
								this.logService.info('Installing the extension:', identifier.id);
								this._onInstallExtension.fire({ identifier, zipPath });
								return this.getGalleryMetadata(getGalleryExtensionId(manifest.publisher, manifest.name))
									.then(
										metadata => this.installFromZipPath(identifierWithVersion, zipPath, { ...metadata, isMachineScoped }, operation, token),
										() => this.installFromZipPath(identifierWithVersion, zipPath, isMachineScoped ? { isMachineScoped } : undefined, operation, token))
									.then(
										local => { this.logService.info('Successfully installed the extension:', identifier.id); return local; },
										e => {
											this.logService.error('Failed to install the extension:', identifier.id, e.message);
											return Promise.reject(e);
										});
							});
					});
			});
		});
	}

	private downloadVsix(vsix: URI): Promise<URI> {
		if (vsix.scheme === Schemas.file) {
			return Promise.resolve(vsix);
		}
		if (!this.downloadService) {
			throw new Error('Download service is not available');
		}
		const downloadedLocation = path.join(tmpdir(), generateUuid());
		return this.downloadService.download(vsix, URI.file(downloadedLocation)).then(() => URI.file(downloadedLocation));
	}

	private installFromZipPath(identifierWithVersion: ExtensionIdentifierWithVersion, zipPath: string, metadata: IMetadata | undefined, operation: InstallOperation, token: CancellationToken): Promise<ILocalExtension> {
		return this.toNonCancellablePromise(this.installExtension({ zipPath, identifierWithVersion, metadata }, token)
			.then(local => this.installDependenciesAndPackExtensions(local, undefined)
				.then(
					() => local,
					error => {
						if (isNonEmptyArray(local.manifest.extensionDependencies)) {
							this.logService.warn(`Cannot install dependencies of extension:`, local.identifier.id, error.message);
						}
						if (isNonEmptyArray(local.manifest.extensionPack)) {
							this.logService.warn(`Cannot install packed extensions of extension:`, local.identifier.id, error.message);
						}
						return local;
					}))
			.then(
				local => { this._onDidInstallExtension.fire({ identifier: identifierWithVersion.identifier, zipPath, local, operation }); return local; },
				error => { this._onDidInstallExtension.fire({ identifier: identifierWithVersion.identifier, zipPath, operation, error }); return Promise.reject(error); }
			));
	}

	async installFromGallery(extension: IGalleryExtension, isMachineScoped?: boolean): Promise<ILocalExtension> {
		if (!this.galleryService.isEnabled()) {
			return Promise.reject(new Error(nls.localize('MarketPlaceDisabled', "Marketplace is not enabled")));
		}
		const startTime = new Date().getTime();

		const onDidInstallExtensionSuccess = (extension: IGalleryExtension, operation: InstallOperation, local: ILocalExtension) => {
			this.logService.info(`Extensions installed successfully:`, extension.identifier.id);
			this._onDidInstallExtension.fire({ identifier: extension.identifier, gallery: extension, local, operation });
			this.reportTelemetry(this.getTelemetryEvent(operation), getGalleryExtensionTelemetryData(extension), new Date().getTime() - startTime, undefined);
		};

		const onDidInstallExtensionFailure = (extension: IGalleryExtension, operation: InstallOperation, error: Error) => {
			const errorCode = error && (<ExtensionManagementError>error).code ? (<ExtensionManagementError>error).code : ERROR_UNKNOWN;
			this.logService.error(`Failed to install extension:`, extension.identifier.id, error ? error.message : errorCode);
			this._onDidInstallExtension.fire({ identifier: extension.identifier, gallery: extension, operation, error: errorCode });
			this.reportTelemetry(this.getTelemetryEvent(operation), getGalleryExtensionTelemetryData(extension), new Date().getTime() - startTime, error);
			if (error instanceof Error) {
				error.name = errorCode;
			}
		};

		try {
			extension = await this.checkAndGetCompatibleVersion(extension);
		} catch (error) {
			onDidInstallExtensionFailure(extension, InstallOperation.Install, error);
			return Promise.reject(error);
		}

		const key = new ExtensionIdentifierWithVersion(extension.identifier, extension.version).key();
		let cancellablePromise = this.installingExtensions.get(key);
		if (!cancellablePromise) {

			this.logService.info('Installing extension:', extension.identifier.id);
			this._onInstallExtension.fire({ identifier: extension.identifier, gallery: extension });

			let operation: InstallOperation = InstallOperation.Install;
			let cancellationToken: CancellationToken, successCallback: (local: ILocalExtension) => void, errorCallback: (e?: any) => any | null;
			cancellablePromise = createCancelablePromise(token => { cancellationToken = token; return new Promise((c, e) => { successCallback = c; errorCallback = e; }); });
			this.installingExtensions.set(key, cancellablePromise);
			try {
				const installed = await this.getInstalled(ExtensionType.User);
				const existingExtension = installed.find(i => areSameExtensions(i.identifier, extension.identifier));
				if (existingExtension) {
					operation = InstallOperation.Update;
				}

				this.downloadInstallableExtension(extension, operation)
					.then(installableExtension => {
						installableExtension.metadata.isMachineScoped = isMachineScoped || existingExtension?.isMachineScoped;
						return this.installExtension(installableExtension, cancellationToken)
							.then(local => this.extensionsDownloader.delete(URI.file(installableExtension.zipPath)).finally(() => { }).then(() => local));
					})
					.then(local => this.installDependenciesAndPackExtensions(local, existingExtension)
						.then(() => local, error => this.uninstall(local).then(() => Promise.reject(error), () => Promise.reject(error))))
					.then(
						async local => {
							if (existingExtension && semver.neq(existingExtension.manifest.version, extension.version)) {
								await this.setUninstalled(existingExtension);
							}
							this.installingExtensions.delete(key);
							onDidInstallExtensionSuccess(extension, operation, local);
							successCallback(local);
						},
						error => {
							this.installingExtensions.delete(key);
							onDidInstallExtensionFailure(extension, operation, error);
							errorCallback(error);
						});

			} catch (error) {
				this.installingExtensions.delete(key);
				onDidInstallExtensionFailure(extension, operation, error);
				return Promise.reject(error);
			}

		}

		return cancellablePromise;
	}

	private async checkAndGetCompatibleVersion(extension: IGalleryExtension): Promise<IGalleryExtension> {
		if (await this.isMalicious(extension)) {
			return Promise.reject(new ExtensionManagementError(nls.localize('malicious extension', "Can't install extension since it was reported to be problematic."), INSTALL_ERROR_MALICIOUS));
		}

		const compatibleExtension = await this.galleryService.getCompatibleExtension(extension);

		if (!compatibleExtension) {
			return Promise.reject(new ExtensionManagementError(nls.localize('notFoundCompatibleDependency', "Unable to install '{0}' extension because it is not compatible with the current version of VS Code (version {1}).", extension.identifier.id, product.version), INSTALL_ERROR_INCOMPATIBLE));
		}

		return compatibleExtension;
	}

	reinstallFromGallery(extension: ILocalExtension): Promise<void> {
		this.logService.trace('ExtensionManagementService#reinstallFromGallery', extension.identifier.id);
		if (!this.galleryService.isEnabled()) {
			return Promise.reject(new Error(nls.localize('MarketPlaceDisabled', "Marketplace is not enabled")));
		}
		return this.findGalleryExtension(extension)
			.then(galleryExtension => {
				if (galleryExtension) {
					return this.setUninstalled(extension)
						.then(() => this.extensionsScanner.removeUninstalledExtension(extension)
							.then(
								() => this.installFromGallery(galleryExtension).then(),
								e => Promise.reject(new Error(nls.localize('removeError', "Error while removing the extension: {0}. Please Quit and Start VS Code before trying again.", toErrorMessage(e))))));
				}
				return Promise.reject(new Error(nls.localize('Not a Marketplace extension', "Only Marketplace Extensions can be reinstalled")));
			});
	}

	private getTelemetryEvent(operation: InstallOperation): string {
		return operation === InstallOperation.Update ? 'extensionGallery:update' : 'extensionGallery:install';
	}

	private isMalicious(extension: IGalleryExtension): Promise<boolean> {
		return this.getExtensionsReport()
			.then(report => getMaliciousExtensionsSet(report).has(extension.identifier.id));
	}

	private downloadInstallableExtension(extension: IGalleryExtension, operation: InstallOperation): Promise<Required<InstallableExtension>> {
		const metadata = <IGalleryMetadata>{
			id: extension.identifier.uuid,
			publisherId: extension.publisherId,
			publisherDisplayName: extension.publisherDisplayName,
		};

		this.logService.trace('Started downloading extension:', extension.identifier.id);
		return this.extensionsDownloader.downloadExtension(extension, operation)
			.then(
				zip => {
					const zipPath = zip.fsPath;
					this.logService.info('Downloaded extension:', extension.identifier.id, zipPath);
					return getManifest(zipPath)
						.then(
							manifest => (<Required<InstallableExtension>>{ zipPath, identifierWithVersion: new ExtensionIdentifierWithVersion(extension.identifier, manifest.version), metadata }),
							error => Promise.reject(new ExtensionManagementError(this.joinErrors(error).message, INSTALL_ERROR_VALIDATING))
						);
				},
				error => Promise.reject(new ExtensionManagementError(this.joinErrors(error).message, INSTALL_ERROR_DOWNLOADING)));
	}

	private installExtension(installableExtension: InstallableExtension, token: CancellationToken): Promise<ILocalExtension> {
		return this.unsetUninstalledAndGetLocal(installableExtension.identifierWithVersion)
			.then(
				local => {
					if (local) {
						return local;
					}
					return this.extractAndInstall(installableExtension, token);
				},
				e => {
					if (isMacintosh) {
						return Promise.reject(new ExtensionManagementError(nls.localize('quitCode', "Unable to install the extension. Please Quit and Start VS Code before reinstalling."), INSTALL_ERROR_UNSET_UNINSTALLED));
					}
					return Promise.reject(new ExtensionManagementError(nls.localize('exitCode', "Unable to install the extension. Please Exit and Start VS Code before reinstalling."), INSTALL_ERROR_UNSET_UNINSTALLED));
				});
	}

	private unsetUninstalledAndGetLocal(identifierWithVersion: ExtensionIdentifierWithVersion): Promise<ILocalExtension | null> {
		return this.isUninstalled(identifierWithVersion)
			.then<ILocalExtension | null>(isUninstalled => {
				if (isUninstalled) {
					this.logService.trace('Removing the extension from uninstalled list:', identifierWithVersion.identifier.id);
					// If the same version of extension is marked as uninstalled, remove it from there and return the local.
					return this.unsetUninstalled(identifierWithVersion)
						.then(() => {
							this.logService.info('Removed the extension from uninstalled list:', identifierWithVersion.identifier.id);
							return this.getInstalled(ExtensionType.User);
						})
						.then(installed => installed.filter(i => new ExtensionIdentifierWithVersion(i.identifier, i.manifest.version).equals(identifierWithVersion))[0]);
				}
				return null;
			});
	}

	private async extractAndInstall({ zipPath, identifierWithVersion, metadata }: InstallableExtension, token: CancellationToken): Promise<ILocalExtension> {
		const { identifier } = identifierWithVersion;
		let local = await this.extensionsScanner.extractUserExtension(identifierWithVersion, zipPath, token);
		this.logService.info('Installation completed.', identifier.id);
		if (metadata) {
			local = await this.extensionsScanner.saveMetadataForLocalExtension(local, metadata);
		}
		return local;
	}

	private async installDependenciesAndPackExtensions(installed: ILocalExtension, existing: ILocalExtension | undefined): Promise<void> {
		if (this.galleryService.isEnabled()) {
			const dependenciesAndPackExtensions: string[] = installed.manifest.extensionDependencies || [];
			if (installed.manifest.extensionPack) {
				for (const extension of installed.manifest.extensionPack) {
					// add only those extensions which are new in currently installed extension
					if (!(existing && existing.manifest.extensionPack && existing.manifest.extensionPack.some(old => areSameExtensions({ id: old }, { id: extension })))) {
						if (dependenciesAndPackExtensions.every(e => !areSameExtensions({ id: e }, { id: extension }))) {
							dependenciesAndPackExtensions.push(extension);
						}
					}
				}
			}
			if (dependenciesAndPackExtensions.length) {
				return this.getInstalled()
					.then(installed => {
						// filter out installed extensions
						const names = dependenciesAndPackExtensions.filter(id => installed.every(({ identifier: galleryIdentifier }) => !areSameExtensions(galleryIdentifier, { id })));
						if (names.length) {
							return this.galleryService.query({ names, pageSize: dependenciesAndPackExtensions.length }, CancellationToken.None)
								.then(galleryResult => {
									const extensionsToInstall = galleryResult.firstPage;
									return Promise.all(extensionsToInstall.map(e => this.installFromGallery(e)))
										.then(undefined, errors => this.rollback(extensionsToInstall).then(() => Promise.reject(errors), () => Promise.reject(errors)));
								});
						}
						return;
					});
			}
		}
		return Promise.resolve(undefined);
	}

	private rollback(extensions: IGalleryExtension[]): Promise<void> {
		return this.getInstalled(ExtensionType.User)
			.then(installed =>
				Promise.all(installed.filter(local => extensions.some(galleryExtension => new ExtensionIdentifierWithVersion(local.identifier, local.manifest.version).equals(new ExtensionIdentifierWithVersion(galleryExtension.identifier, galleryExtension.version)))) // Check with version because we want to rollback the exact version
					.map(local => this.uninstall(local))))
			.then(() => undefined, () => undefined);
	}

	uninstall(extension: ILocalExtension): Promise<void> {
		this.logService.trace('ExtensionManagementService#uninstall', extension.identifier.id);
		return this.toNonCancellablePromise(this.getInstalled(ExtensionType.User)
			.then(installed => {
				const extensionToUninstall = installed.filter(e => areSameExtensions(e.identifier, extension.identifier))[0];
				if (extensionToUninstall) {
					return this.checkForDependenciesAndUninstall(extensionToUninstall, installed).then(undefined, error => Promise.reject(this.joinErrors(error)));
				} else {
					return Promise.reject(new Error(nls.localize('notInstalled', "Extension '{0}' is not installed.", extension.manifest.displayName || extension.manifest.name)));
				}
			}));
	}

	async updateMetadata(local: ILocalExtension, metadata: IGalleryMetadata): Promise<ILocalExtension> {
		this.logService.trace('ExtensionManagementService#updateMetadata', local.identifier.id);
		local = await this.extensionsScanner.saveMetadataForLocalExtension(local, { ...metadata, isMachineScoped: local.isMachineScoped });
		this.manifestCache.invalidate();
		return local;
	}

	private getGalleryMetadata(extensionName: string): Promise<IGalleryMetadata | undefined> {
		return this.findGalleryExtensionByName(extensionName)
			.then(galleryExtension => galleryExtension ? <IGalleryMetadata>{ id: galleryExtension.identifier.uuid, publisherDisplayName: galleryExtension.publisherDisplayName, publisherId: galleryExtension.publisherId } : undefined);
	}

	private findGalleryExtension(local: ILocalExtension): Promise<IGalleryExtension> {
		if (local.identifier.uuid) {
			return this.findGalleryExtensionById(local.identifier.uuid)
				.then(galleryExtension => galleryExtension ? galleryExtension : this.findGalleryExtensionByName(local.identifier.id));
		}
		return this.findGalleryExtensionByName(local.identifier.id);
	}

	private findGalleryExtensionById(uuid: string): Promise<IGalleryExtension> {
		return this.galleryService.query({ ids: [uuid], pageSize: 1 }, CancellationToken.None).then(galleryResult => galleryResult.firstPage[0]);
	}

	private findGalleryExtensionByName(name: string): Promise<IGalleryExtension> {
		return this.galleryService.query({ names: [name], pageSize: 1 }, CancellationToken.None).then(galleryResult => galleryResult.firstPage[0]);
	}

	private joinErrors(errorOrErrors: (Error | string) | (Array<Error | string>)): Error {
		const errors = Array.isArray(errorOrErrors) ? errorOrErrors : [errorOrErrors];
		if (errors.length === 1) {
			return errors[0] instanceof Error ? <Error>errors[0] : new Error(<string>errors[0]);
		}
		return errors.reduce<Error>((previousValue: Error, currentValue: Error | string) => {
			return new Error(`${previousValue.message}${previousValue.message ? ',' : ''}${currentValue instanceof Error ? currentValue.message : currentValue}`);
		}, new Error(''));
	}

	private checkForDependenciesAndUninstall(extension: ILocalExtension, installed: ILocalExtension[]): Promise<void> {
		return this.preUninstallExtension(extension)
			.then(() => {
				const packedExtensions = this.getAllPackExtensionsToUninstall(extension, installed);
				if (packedExtensions.length) {
					return this.uninstallExtensions(extension, packedExtensions, installed);
				}
				return this.uninstallExtensions(extension, [], installed);
			})
			.then(() => this.postUninstallExtension(extension),
				error => {
					this.postUninstallExtension(extension, new ExtensionManagementError(error instanceof Error ? error.message : error, INSTALL_ERROR_LOCAL));
					return Promise.reject(error);
				});
	}

	private uninstallExtensions(extension: ILocalExtension, otherExtensionsToUninstall: ILocalExtension[], installed: ILocalExtension[]): Promise<void> {
		const dependents = this.getDependents(extension, installed);
		if (dependents.length) {
			const remainingDependents = dependents.filter(dependent => extension !== dependent && otherExtensionsToUninstall.indexOf(dependent) === -1);
			if (remainingDependents.length) {
				return Promise.reject(new Error(this.getDependentsErrorMessage(extension, remainingDependents)));
			}
		}
		return Promise.all([this.uninstallExtension(extension), ...otherExtensionsToUninstall.map(d => this.doUninstall(d))]).then(() => undefined);
	}

	private getDependentsErrorMessage(extension: ILocalExtension, dependents: ILocalExtension[]): string {
		if (dependents.length === 1) {
			return nls.localize('singleDependentError', "Cannot uninstall extension '{0}'. Extension '{1}' depends on this.",
				extension.manifest.displayName || extension.manifest.name, dependents[0].manifest.displayName || dependents[0].manifest.name);
		}
		if (dependents.length === 2) {
			return nls.localize('twoDependentsError', "Cannot uninstall extension '{0}'. Extensions '{1}' and '{2}' depend on this.",
				extension.manifest.displayName || extension.manifest.name, dependents[0].manifest.displayName || dependents[0].manifest.name, dependents[1].manifest.displayName || dependents[1].manifest.name);
		}
		return nls.localize('multipleDependentsError', "Cannot uninstall extension '{0}'. Extensions '{1}', '{2}' and others depend on this.",
			extension.manifest.displayName || extension.manifest.name, dependents[0].manifest.displayName || dependents[0].manifest.name, dependents[1].manifest.displayName || dependents[1].manifest.name);
	}

	private getAllPackExtensionsToUninstall(extension: ILocalExtension, installed: ILocalExtension[], checked: ILocalExtension[] = []): ILocalExtension[] {
		if (checked.indexOf(extension) !== -1) {
			return [];
		}
		checked.push(extension);
		const extensionsPack = extension.manifest.extensionPack ? extension.manifest.extensionPack : [];
		if (extensionsPack.length) {
			const packedExtensions = installed.filter(i => extensionsPack.some(id => areSameExtensions({ id }, i.identifier)));
			const packOfPackedExtensions: ILocalExtension[] = [];
			for (const packedExtension of packedExtensions) {
				packOfPackedExtensions.push(...this.getAllPackExtensionsToUninstall(packedExtension, installed, checked));
			}
			return [...packedExtensions, ...packOfPackedExtensions];
		}
		return [];
	}

	private getDependents(extension: ILocalExtension, installed: ILocalExtension[]): ILocalExtension[] {
		return installed.filter(e => e.manifest.extensionDependencies && e.manifest.extensionDependencies.some(id => areSameExtensions({ id }, extension.identifier)));
	}

	private doUninstall(extension: ILocalExtension): Promise<void> {
		return this.preUninstallExtension(extension)
			.then(() => this.uninstallExtension(extension))
			.then(() => this.postUninstallExtension(extension),
				error => {
					this.postUninstallExtension(extension, new ExtensionManagementError(error instanceof Error ? error.message : error, INSTALL_ERROR_LOCAL));
					return Promise.reject(error);
				});
	}

	private preUninstallExtension(extension: ILocalExtension): Promise<void> {
		return Promise.resolve(pfs.exists(extension.location.fsPath))
			.then(exists => exists ? null : Promise.reject(new Error(nls.localize('notExists', "Could not find extension"))))
			.then(() => {
				this.logService.info('Uninstalling extension:', extension.identifier.id);
				this._onUninstallExtension.fire(extension.identifier);
			});
	}

	private uninstallExtension(local: ILocalExtension): Promise<void> {
		let promise = this.uninstallingExtensions.get(local.identifier.id);
		if (!promise) {
			// Set all versions of the extension as uninstalled
			promise = createCancelablePromise(token => this.extensionsScanner.scanUserExtensions(false)
				.then(userExtensions => this.setUninstalled(...userExtensions.filter(u => areSameExtensions(u.identifier, local.identifier))))
				.then(() => { this.uninstallingExtensions.delete(local.identifier.id); }));
			this.uninstallingExtensions.set(local.identifier.id, promise);
		}
		return promise;
	}

	private async postUninstallExtension(extension: ILocalExtension, error?: Error): Promise<void> {
		if (error) {
			this.logService.error('Failed to uninstall extension:', extension.identifier.id, error.message);
		} else {
			this.logService.info('Successfully uninstalled extension:', extension.identifier.id);
			// only report if extension has a mapped gallery extension. UUID identifies the gallery extension.
			if (extension.identifier.uuid) {
				await this.galleryService.reportStatistic(extension.manifest.publisher, extension.manifest.name, extension.manifest.version, StatisticType.Uninstall);
			}
		}
		this.reportTelemetry('extensionGallery:uninstall', getLocalExtensionTelemetryData(extension), undefined, error);
		const errorcode = error ? error instanceof ExtensionManagementError ? error.code : ERROR_UNKNOWN : undefined;
		this._onDidUninstallExtension.fire({ identifier: extension.identifier, error: errorcode });
	}

	getInstalled(type: ExtensionType | null = null): Promise<ILocalExtension[]> {
		return this.extensionsScanner.scanExtensions(type);
	}

	removeDeprecatedExtensions(): Promise<void> {
		return this.extensionsScanner.cleanUp();
	}

	private isUninstalled(identifier: ExtensionIdentifierWithVersion): Promise<boolean> {
		return this.filterUninstalled(identifier).then(uninstalled => uninstalled.length === 1);
	}

	private filterUninstalled(...identifiers: ExtensionIdentifierWithVersion[]): Promise<string[]> {
		return this.extensionsScanner.withUninstalledExtensions(allUninstalled => {
			const uninstalled: string[] = [];
			for (const identifier of identifiers) {
				if (!!allUninstalled[identifier.key()]) {
					uninstalled.push(identifier.key());
				}
			}
			return uninstalled;
		});
	}

	private setUninstalled(...extensions: ILocalExtension[]): Promise<{ [id: string]: boolean }> {
		const ids: ExtensionIdentifierWithVersion[] = extensions.map(e => new ExtensionIdentifierWithVersion(e.identifier, e.manifest.version));
		return this.extensionsScanner.withUninstalledExtensions(uninstalled => assign(uninstalled, ids.reduce((result, id) => { result[id.key()] = true; return result; }, {} as { [id: string]: boolean })));
	}

	private unsetUninstalled(extensionIdentifier: ExtensionIdentifierWithVersion): Promise<void> {
		return this.extensionsScanner.withUninstalledExtensions<void>(uninstalled => delete uninstalled[extensionIdentifier.key()]);
	}

	getExtensionsReport(): Promise<IReportedExtension[]> {
		const now = new Date().getTime();

		if (!this.reportedExtensions || now - this.lastReportTimestamp > 1000 * 60 * 5) { // 5 minute cache freshness
			this.reportedExtensions = this.updateReportCache();
			this.lastReportTimestamp = now;
		}

		return this.reportedExtensions;
	}

	private updateReportCache(): Promise<IReportedExtension[]> {
		this.logService.trace('ExtensionManagementService.refreshReportedCache');

		return this.galleryService.getExtensionsReport()
			.then(result => {
				this.logService.trace(`ExtensionManagementService.refreshReportedCache - got ${result.length} reported extensions from service`);
				return result;
			}, err => {
				this.logService.trace('ExtensionManagementService.refreshReportedCache - failed to get extension report');
				return [];
			});
	}

	private toNonCancellablePromise<T>(promise: Promise<T>): Promise<T> {
		return new Promise((c, e) => promise.then(result => c(result), error => e(error)));
	}

	private reportTelemetry(eventName: string, extensionData: any, duration?: number, error?: Error): void {
		const errorcode = error ? error instanceof ExtensionManagementError ? error.code : ERROR_UNKNOWN : undefined;
		/* __GDPR__
			"extensionGallery:install" : {
				"success": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"duration" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"errorcode": { "classification": "CallstackOrException", "purpose": "PerformanceAndHealth" },
				"recommendationReason": { "retiredFromVersion": "1.23.0", "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
				"${include}": [
					"${GalleryExtensionTelemetryData}"
				]
			}
		*/
		/* __GDPR__
			"extensionGallery:uninstall" : {
				"success": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"duration" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"errorcode": { "classification": "CallstackOrException", "purpose": "PerformanceAndHealth" },
				"${include}": [
					"${GalleryExtensionTelemetryData}"
				]
			}
		*/
		/* __GDPR__
			"extensionGallery:update" : {
				"success": { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"duration" : { "classification": "SystemMetaData", "purpose": "PerformanceAndHealth", "isMeasurement": true },
				"errorcode": { "classification": "CallstackOrException", "purpose": "PerformanceAndHealth" },
				"${include}": [
					"${GalleryExtensionTelemetryData}"
				]
			}
		*/
		this.telemetryService.publicLogError(eventName, assign(extensionData, { success: !error, duration, errorcode }));
	}
}
