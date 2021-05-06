/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { promises } from 'fs';
import { Disposable } from 'vs/base/common/lifecycle';
import { IFileService, IFileStatWithMetadata } from 'vs/platform/files/common/files';
import { IExtensionGalleryService, IGalleryExtension, InstallOperation } from 'vs/platform/extensionManagement/common/extensionManagement';
import { INativeEnvironmentService } from 'vs/platform/environment/common/environment';
import { URI } from 'vs/base/common/uri';
import { joinPath } from 'vs/base/common/resources';
import { ExtensionIdentifierWithVersion, groupByExtension } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { ILogService } from 'vs/platform/log/common/log';
import { generateUuid } from 'vs/base/common/uuid';
import * as semver from 'vs/base/common/semver/semver';
import { isWindows } from 'vs/base/common/platform';
import { Promises } from 'vs/base/common/async';
import { getErrorMessage } from 'vs/base/common/errors';

const ExtensionIdVersionRegex = /^([^.]+\..+)-(\d+\.\d+\.\d+)$/;

export class ExtensionsDownloader extends Disposable {

	private readonly extensionsDownloadDir: URI;
	private readonly cache: number;
	private readonly cleanUpPromise: Promise<void>;

	constructor(
		@INativeEnvironmentService environmentService: INativeEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@IExtensionGalleryService private readonly extensionGalleryService: IExtensionGalleryService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
		this.extensionsDownloadDir = URI.file(environmentService.extensionsDownloadPath);
		this.cache = 20; // Cache 20 downloads
		this.cleanUpPromise = this.cleanUp();
	}

	async downloadExtension(extension: IGalleryExtension, operation: InstallOperation): Promise<URI> {
		await this.cleanUpPromise;
		const vsixName = this.getName(extension);
		const location = joinPath(this.extensionsDownloadDir, vsixName);

		// Download only if vsix does not exist
		if (!await this.fileService.exists(location)) {
			// Download to temporary location first only if vsix does not exist
			const tempLocation = joinPath(this.extensionsDownloadDir, `.${generateUuid()}`);
			if (!await this.fileService.exists(tempLocation)) {
				await this.extensionGalleryService.download(extension, tempLocation, operation);
			}

			try {
				// Rename temp location to original
				await this.rename(tempLocation, location, Date.now() + (2 * 60 * 1000) /* Retry for 2 minutes */);
			} catch (error) {
				try {
					await this.fileService.del(tempLocation);
				} catch (e) { /* ignore */ }
				if (error.code === 'ENOTEMPTY') {
					this.logService.info(`Rename failed because vsix was downloaded by another source. So ignoring renaming.`, extension.identifier.id);
				} else {
					this.logService.info(`Rename failed because of ${getErrorMessage(error)}. Deleted the vsix from downloaded location`, tempLocation.path);
					throw error;
				}
			}

		}

		return location;
	}

	async delete(location: URI): Promise<void> {
		// noop as caching is enabled always
	}

	private async rename(from: URI, to: URI, retryUntil: number): Promise<void> {
		try {
			await promises.rename(from.fsPath, to.fsPath);
		} catch (error) {
			if (isWindows && error && error.code === 'EPERM' && Date.now() < retryUntil) {
				this.logService.info(`Failed renaming ${from} to ${to} with 'EPERM' error. Trying again...`);
				return this.rename(from, to, retryUntil);
			}
			throw error;
		}
	}

	private async cleanUp(): Promise<void> {
		try {
			if (!(await this.fileService.exists(this.extensionsDownloadDir))) {
				this.logService.trace('Extension VSIX downlads cache dir does not exist');
				return;
			}
			const folderStat = await this.fileService.resolve(this.extensionsDownloadDir, { resolveMetadata: true });
			if (folderStat.children) {
				const toDelete: URI[] = [];
				const all: [ExtensionIdentifierWithVersion, IFileStatWithMetadata][] = [];
				for (const stat of folderStat.children) {
					const extension = this.parse(stat.name);
					if (extension) {
						all.push([extension, stat]);
					}
				}
				const byExtension = groupByExtension(all, ([extension]) => extension);
				const distinct: IFileStatWithMetadata[] = [];
				for (const p of byExtension) {
					p.sort((a, b) => semver.rcompare(a[0].version, b[0].version));
					toDelete.push(...p.slice(1).map(e => e[1].resource)); // Delete outdated extensions
					distinct.push(p[0][1]);
				}
				distinct.sort((a, b) => a.mtime - b.mtime); // sort by modified time
				toDelete.push(...distinct.slice(0, Math.max(0, distinct.length - this.cache)).map(s => s.resource)); // Retain minimum cacheSize and delete the rest
				await Promises.settled(toDelete.map(resource => {
					this.logService.trace('Deleting vsix from cache', resource.path);
					return this.fileService.del(resource);
				}));
			}
		} catch (e) {
			this.logService.error(e);
		}
	}

	private getName(extension: IGalleryExtension): string {
		return this.cache ? new ExtensionIdentifierWithVersion(extension.identifier, extension.version).key().toLowerCase() : generateUuid();
	}

	private parse(name: string): ExtensionIdentifierWithVersion | null {
		const matches = ExtensionIdVersionRegex.exec(name);
		return matches && matches[1] && matches[2] ? new ExtensionIdentifierWithVersion({ id: matches[1] }, matches[2]) : null;
	}
}
