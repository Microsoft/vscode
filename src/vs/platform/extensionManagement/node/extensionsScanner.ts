/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as semver from 'semver-umd';
import { Disposable } from 'vs/base/common/lifecycle';
import * as pfs from 'vs/base/node/pfs';
import * as path from 'vs/base/common/path';
import { ILogService } from 'vs/platform/log/common/log';
import { ILocalExtension, IGalleryMetadata, ExtensionManagementError } from 'vs/platform/extensionManagement/common/extensionManagement';
import { ExtensionType, IExtensionManifest, IExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { areSameExtensions, ExtensionIdentifierWithVersion, groupByExtension, getGalleryExtensionId } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { Limiter, Queue } from 'vs/base/common/async';
import { URI } from 'vs/base/common/uri';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { getPathFromAmdModule } from 'vs/base/common/amd';
import { localizeManifest } from 'vs/platform/extensionManagement/common/extensionNls';
import { localize } from 'vs/nls';
import { IProductService } from 'vs/platform/product/common/productService';
import { CancellationToken } from 'vscode';
import { extract, ExtractError } from 'vs/base/node/zip';
import { isWindows } from 'vs/base/common/platform';
import { flatten } from 'vs/base/common/arrays';
import { assign } from 'vs/base/common/objects';

const ERROR_SCANNING_SYS_EXTENSIONS = 'scanningSystem';
const ERROR_SCANNING_USER_EXTENSIONS = 'scanningUser';
const INSTALL_ERROR_EXTRACTING = 'extracting';
const INSTALL_ERROR_DELETING = 'deleting';
const INSTALL_ERROR_RENAMING = 'renaming';

export type IMetadata = Partial<IGalleryMetadata & { isMachineScoped: boolean; }>;

export class ExtensionsScanner extends Disposable {

	private readonly systemExtensionsPath: string;
	private readonly extensionsPath: string;
	private readonly uninstalledPath: string;
	private readonly uninstalledFileLimiter: Queue<any>;

	constructor(
		private readonly beforeRemovingExtension: (e: ILocalExtension) => Promise<void>,
		@ILogService private readonly logService: ILogService,
		@IEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IProductService private readonly productService: IProductService,
	) {
		super();
		this.systemExtensionsPath = environmentService.builtinExtensionsPath;
		this.extensionsPath = environmentService.extensionsPath!;
		this.uninstalledPath = path.join(this.extensionsPath, '.obsolete');
		this.uninstalledFileLimiter = new Queue();
	}

	async cleanUp(): Promise<void> {
		await this.removeUninstalledExtensions();
		await this.removeOutdatedExtensions();
	}

	async scanExtensions(type: ExtensionType | null): Promise<ILocalExtension[]> {
		const promises: Promise<ILocalExtension[]>[] = [];

		if (type === null || type === ExtensionType.System) {
			promises.push(this.scanSystemExtensions().then(null, e => Promise.reject(new ExtensionManagementError(this.joinErrors(e).message, ERROR_SCANNING_SYS_EXTENSIONS))));
		}

		if (type === null || type === ExtensionType.User) {
			promises.push(this.scanUserExtensions(true).then(null, e => Promise.reject(new ExtensionManagementError(this.joinErrors(e).message, ERROR_SCANNING_USER_EXTENSIONS))));
		}

		return Promise.all<ILocalExtension[]>(promises).then(flatten, errors => Promise.reject(this.joinErrors(errors)));
	}

	async scanUserExtensions(excludeOutdated: boolean): Promise<ILocalExtension[]> {
		this.logService.trace('Started scanning user extensions');
		let [uninstalled, extensions] = await Promise.all([this.getUninstalledExtensions(), this.scanAllUserExtensions()]);
		extensions = extensions.filter(e => !uninstalled[new ExtensionIdentifierWithVersion(e.identifier, e.manifest.version).key()]);
		if (excludeOutdated) {
			const byExtension: ILocalExtension[][] = groupByExtension(extensions, e => e.identifier);
			extensions = byExtension.map(p => p.sort((a, b) => semver.rcompare(a.manifest.version, b.manifest.version))[0]);
		}
		this.logService.trace('Scanned user extensions:', extensions.length);
		return extensions;
	}

	async scanAllUserExtensions(): Promise<ILocalExtension[]> {
		return this.scanExtensionsInDir(this.extensionsPath, ExtensionType.User);
	}

	async extractUserExtension(identifierWithVersion: ExtensionIdentifierWithVersion, zipPath: string, token: CancellationToken): Promise<ILocalExtension> {
		const { identifier } = identifierWithVersion;
		const folderName = identifierWithVersion.key();
		const tempPath = path.join(this.extensionsPath, `.${folderName}`);
		const extensionPath = path.join(this.extensionsPath, folderName);

		try {
			await pfs.rimraf(extensionPath);
		} catch (error) {
			try {
				await pfs.rimraf(extensionPath);
			} catch (e) { /* ignore */ }
			throw new ExtensionManagementError(localize('errorDeleting', "Unable to delete the existing folder '{0}' while installing the extension '{1}'. Please delete the folder manually and try again", extensionPath, identifier.id), INSTALL_ERROR_DELETING);
		}

		await this.extractAtLocation(identifier, zipPath, tempPath, token);
		try {
			await this.rename(identifier, tempPath, extensionPath, Date.now() + (2 * 60 * 1000) /* Retry for 2 minutes */);
			this.logService.info('Renamed to', extensionPath);
		} catch (error) {
			this.logService.info('Rename failed. Deleting from extracted location', tempPath);
			try {
				pfs.rimraf(tempPath);
			} catch (e) { /* ignore */ }
			throw error;
		}

		let local: ILocalExtension | null = null;
		try {
			local = await this.scanExtension(folderName, this.extensionsPath, ExtensionType.User);
		} catch (e) { /*ignore */ }

		if (local) {
			return local;
		}
		throw new Error(localize('cannot read', "Cannot read the extension from {0}", this.extensionsPath));
	}

	async saveMetadataForLocalExtension(local: ILocalExtension, metadata: IMetadata): Promise<ILocalExtension> {
		this.setMetadata(local, metadata);

		// unset if false
		metadata.isMachineScoped = metadata.isMachineScoped || undefined;
		const manifestPath = path.join(local.location.fsPath, 'package.json');
		const raw = await pfs.readFile(manifestPath, 'utf8');
		const { manifest } = await this.parseManifest(raw);
		assign(manifest, { __metadata: metadata });
		await pfs.writeFile(manifestPath, JSON.stringify(manifest, null, '\t'));
		return local;
	}

	getUninstalledExtensions(): Promise<{ [id: string]: boolean; }> {
		return this.withUninstalledExtensions(uninstalled => uninstalled);
	}

	async withUninstalledExtensions<T>(fn: (uninstalled: { [id: string]: boolean; }) => T): Promise<T> {
		return this.uninstalledFileLimiter.queue(async () => {
			let result: T | null = null;
			return pfs.readFile(this.uninstalledPath, 'utf8')
				.then(undefined, err => err.code === 'ENOENT' ? Promise.resolve('{}') : Promise.reject(err))
				.then<{ [id: string]: boolean }>(raw => { try { return JSON.parse(raw); } catch (e) { return {}; } })
				.then(uninstalled => { result = fn(uninstalled); return uninstalled; })
				.then(uninstalled => {
					if (Object.keys(uninstalled).length === 0) {
						return pfs.rimraf(this.uninstalledPath);
					} else {
						const raw = JSON.stringify(uninstalled);
						return pfs.writeFile(this.uninstalledPath, raw);
					}
				})
				.then(() => result);
		});
	}

	async removeExtension(extension: ILocalExtension, type: string): Promise<void> {
		this.logService.trace(`Deleting ${type} extension from disk`, extension.identifier.id, extension.location.fsPath);
		await pfs.rimraf(extension.location.fsPath);
		this.logService.info('Deleted from disk', extension.identifier.id, extension.location.fsPath);
	}

	async removeUninstalledExtension(extension: ILocalExtension): Promise<void> {
		await this.removeExtension(extension, 'uninstalled');
		await this.withUninstalledExtensions(uninstalled => delete uninstalled[new ExtensionIdentifierWithVersion(extension.identifier, extension.manifest.version).key()]);
	}

	private extractAtLocation(identifier: IExtensionIdentifier, zipPath: string, location: string, token: CancellationToken): Promise<void> {
		this.logService.trace(`Started extracting the extension from ${zipPath} to ${location}`);
		return pfs.rimraf(location)
			.then(
				() => extract(zipPath, location, { sourcePath: 'extension', overwrite: true }, token)
					.then(
						() => this.logService.info(`Extracted extension to ${location}:`, identifier.id),
						e => pfs.rimraf(location).finally(() => { })
							.then(() => Promise.reject(new ExtensionManagementError(e.message, e instanceof ExtractError && e.type ? e.type : INSTALL_ERROR_EXTRACTING)))),
				e => Promise.reject(new ExtensionManagementError(this.joinErrors(e).message, INSTALL_ERROR_DELETING)));
	}

	private rename(identifier: IExtensionIdentifier, extractPath: string, renamePath: string, retryUntil: number): Promise<void> {
		return pfs.rename(extractPath, renamePath)
			.then(undefined, error => {
				if (isWindows && error && error.code === 'EPERM' && Date.now() < retryUntil) {
					this.logService.info(`Failed renaming ${extractPath} to ${renamePath} with 'EPERM' error. Trying again...`, identifier.id);
					return this.rename(identifier, extractPath, renamePath, retryUntil);
				}
				return Promise.reject(new ExtensionManagementError(error.message || localize('renameError', "Unknown error while renaming {0} to {1}", extractPath, renamePath), error.code || INSTALL_ERROR_RENAMING));
			});
	}

	private async scanSystemExtensions(): Promise<ILocalExtension[]> {
		this.logService.trace('Started scanning system extensions');
		const systemExtensionsPromise = this.scanDefaultSystemExtensions();
		if (this.environmentService.isBuilt) {
			return systemExtensionsPromise;
		}

		// Scan other system extensions during development
		const devSystemExtensionsPromise = this.scanDevSystemExtensions();
		const [systemExtensions, devSystemExtensions] = await Promise.all([systemExtensionsPromise, devSystemExtensionsPromise]);
		return [...systemExtensions, ...devSystemExtensions];
	}

	private async scanExtensionsInDir(dir: string, type: ExtensionType): Promise<ILocalExtension[]> {
		const limiter = new Limiter<any>(10);
		const extensionsFolders = await pfs.readdir(dir);
		const extensions = await Promise.all<ILocalExtension>(extensionsFolders.map(extensionFolder => limiter.queue(() => this.scanExtension(extensionFolder, dir, type))));
		return extensions.filter(e => e && e.identifier);
	}

	private async scanExtension(folderName: string, root: string, type: ExtensionType): Promise<ILocalExtension | null> {
		if (type === ExtensionType.User && folderName.indexOf('.') === 0) { // Do not consider user extension folder starting with `.`
			return null;
		}
		const extensionPath = path.join(root, folderName);
		try {
			const children = await pfs.readdir(extensionPath);
			const { manifest, metadata } = await this.readManifest(extensionPath);
			const readme = children.filter(child => /^readme(\.txt|\.md|)$/i.test(child))[0];
			const readmeUrl = readme ? URI.file(path.join(extensionPath, readme)) : undefined;
			const changelog = children.filter(child => /^changelog(\.txt|\.md|)$/i.test(child))[0];
			const changelogUrl = changelog ? URI.file(path.join(extensionPath, changelog)) : undefined;
			const identifier = { id: getGalleryExtensionId(manifest.publisher, manifest.name) };
			const local = <ILocalExtension>{ type, identifier, manifest, location: URI.file(extensionPath), readmeUrl, changelogUrl, publisherDisplayName: null, publisherId: null, isMachineScoped: false };
			if (metadata) {
				this.setMetadata(local, metadata);
			}
			return local;
		} catch (e) {
			this.logService.trace(e);
			return null;
		}
	}

	private async scanDefaultSystemExtensions(): Promise<ILocalExtension[]> {
		const result = await this.scanExtensionsInDir(this.systemExtensionsPath, ExtensionType.System);
		this.logService.trace('Scanned system extensions:', result.length);
		return result;
	}

	private async scanDevSystemExtensions(): Promise<ILocalExtension[]> {
		const devSystemExtensionsList = this.getDevSystemExtensionsList();
		if (devSystemExtensionsList.length) {
			const result = await this.scanExtensionsInDir(this.devSystemExtensionsPath, ExtensionType.System);
			this.logService.trace('Scanned dev system extensions:', result.length);
			return result.filter(r => devSystemExtensionsList.some(id => areSameExtensions(r.identifier, { id })));
		} else {
			return [];
		}
	}

	private setMetadata(local: ILocalExtension, metadata: IMetadata): void {
		local.publisherDisplayName = metadata.publisherDisplayName || null;
		local.publisherId = metadata.publisherId || null;
		local.identifier.uuid = metadata.id;
		local.isMachineScoped = !!metadata.isMachineScoped;
	}

	private async removeUninstalledExtensions(): Promise<void> {
		const uninstalled = await this.getUninstalledExtensions();
		const extensions = await this.scanAllUserExtensions(); // All user extensions
		const installed: Set<string> = new Set<string>();
		for (const e of extensions) {
			if (!uninstalled[new ExtensionIdentifierWithVersion(e.identifier, e.manifest.version).key()]) {
				installed.add(e.identifier.id.toLowerCase());
			}
		}
		const byExtension: ILocalExtension[][] = groupByExtension(extensions, e => e.identifier);
		await Promise.all(byExtension.map(async e => {
			const latest = e.sort((a, b) => semver.rcompare(a.manifest.version, b.manifest.version))[0];
			if (!installed.has(latest.identifier.id.toLowerCase())) {
				await this.beforeRemovingExtension(latest);
			}
		}));
		const toRemove: ILocalExtension[] = extensions.filter(e => uninstalled[new ExtensionIdentifierWithVersion(e.identifier, e.manifest.version).key()]);
		await Promise.all(toRemove.map(e => this.removeUninstalledExtension(e)));
	}

	private async removeOutdatedExtensions(): Promise<void> {
		const extensions = await this.scanAllUserExtensions();
		const toRemove: ILocalExtension[] = [];

		// Outdated extensions
		const byExtension: ILocalExtension[][] = groupByExtension(extensions, e => e.identifier);
		toRemove.push(...flatten(byExtension.map(p => p.sort((a, b) => semver.rcompare(a.manifest.version, b.manifest.version)).slice(1))));

		await Promise.all(toRemove.map(extension => this.removeExtension(extension, 'outdated')));
	}

	private getDevSystemExtensionsList(): string[] {
		return (this.productService.builtInExtensions || []).map(e => e.name);
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

	private _devSystemExtensionsPath: string | null = null;
	private get devSystemExtensionsPath(): string {
		if (!this._devSystemExtensionsPath) {
			this._devSystemExtensionsPath = path.normalize(path.join(getPathFromAmdModule(require, ''), '..', '.build', 'builtInExtensions'));
		}
		return this._devSystemExtensionsPath;
	}

	private async readManifest(extensionPath: string): Promise<{ manifest: IExtensionManifest; metadata: IMetadata | null; }> {
		const promises = [
			pfs.readFile(path.join(extensionPath, 'package.json'), 'utf8')
				.then(raw => this.parseManifest(raw)),
			pfs.readFile(path.join(extensionPath, 'package.nls.json'), 'utf8')
				.then(undefined, err => err.code !== 'ENOENT' ? Promise.reject<string>(err) : '{}')
				.then(raw => JSON.parse(raw))
		];

		const [{ manifest, metadata }, translations] = await Promise.all(promises);
		return {
			manifest: localizeManifest(manifest, translations),
			metadata
		};
	}

	private parseManifest(raw: string): Promise<{ manifest: IExtensionManifest; metadata: IMetadata | null; }> {
		return new Promise((c, e) => {
			try {
				const manifest = JSON.parse(raw);
				const metadata = manifest.__metadata || null;
				delete manifest.__metadata;
				c({ manifest, metadata });
			} catch (err) {
				e(new Error(localize('invalidManifest', "Extension invalid: package.json is not a JSON file.")));
			}
		});
	}
}
