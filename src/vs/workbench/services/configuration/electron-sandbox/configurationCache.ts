/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationCache, ConfigurationKey } from 'vs/workbench/services/configuration/common/configuration';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { FileOperationError, FileOperationResult, IFileService } from 'vs/platform/files/common/files';
import { joinPath } from 'vs/base/common/resources';
import { VSBuffer } from 'vs/base/common/buffer';
import { Queue } from 'vs/base/common/async';

export class ConfigurationCache implements IConfigurationCache {

	private readonly cachedConfigurations: Map<string, CachedConfiguration> = new Map<string, CachedConfiguration>();

	constructor(private readonly cacheHome: URI, private readonly fileService: IFileService) {
	}

	needsCaching(resource: URI): boolean {
		// Cache all non native resources
		return ![Schemas.file, Schemas.userData].includes(resource.scheme);
	}

	read(key: ConfigurationKey): Promise<string> {
		return this.getCachedConfiguration(key).read();
	}

	write(key: ConfigurationKey, content: string): Promise<void> {
		return this.getCachedConfiguration(key).save(content);
	}

	remove(key: ConfigurationKey): Promise<void> {
		return this.getCachedConfiguration(key).remove();
	}

	private getCachedConfiguration({ type, key }: ConfigurationKey): CachedConfiguration {
		const k = `${type}:${key}`;
		let cachedConfiguration = this.cachedConfigurations.get(k);
		if (!cachedConfiguration) {
			cachedConfiguration = new CachedConfiguration({ type, key }, this.cacheHome, this.fileService);
			this.cachedConfigurations.set(k, cachedConfiguration);
		}
		return cachedConfiguration;
	}
}

class CachedConfiguration {

	private queue: Queue<void>;
	private cachedConfigurationFolderResource: URI;
	private cachedConfigurationFileResource: URI;

	constructor(
		{ type, key }: ConfigurationKey,
		cacheHome: URI,
		private readonly fileService: IFileService
	) {
		this.cachedConfigurationFolderResource = joinPath(cacheHome, 'CachedConfigurations', type, key);
		this.cachedConfigurationFileResource = joinPath(this.cachedConfigurationFolderResource, type === 'workspaces' ? 'workspace.json' : 'configuration.json');
		this.queue = new Queue<void>();
	}

	async read(): Promise<string> {
		try {
			const content = await this.fileService.readFile(this.cachedConfigurationFileResource);
			return content.value.toString();
		} catch (e) {
			return '';
		}
	}

	async save(content: string): Promise<void> {
		const created = await this.createCachedFolder();
		if (created) {
			await this.queue.queue(async () => {
				await this.fileService.writeFile(this.cachedConfigurationFileResource, VSBuffer.fromString(content));
			});
		}
	}

	async remove(): Promise<void> {
		try {
			await this.queue.queue(() => this.fileService.del(this.cachedConfigurationFolderResource, { recursive: true, useTrash: false }));
		} catch (error) {
			if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {
				throw error;
			}
		}
	}

	private async createCachedFolder(): Promise<boolean> {
		if (await this.fileService.exists(this.cachedConfigurationFolderResource)) {
			return true;
		}
		try {
			await this.fileService.createFolder(this.cachedConfigurationFolderResource);
			return true;
		} catch (error) {
			return false;
		}
	}
}

