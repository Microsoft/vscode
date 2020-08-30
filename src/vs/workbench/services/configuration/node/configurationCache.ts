/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as pfs from 'vs/base/node/pfs';
import { join } from 'vs/base/common/path';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IConfigurationCache, ConfigurationKey } from 'vs/workbench/services/configuration/common/configuration';

export class ConfigurationCache implements IConfigurationCache {

	private readonly cachedConfigurations: Map<string, CachedConfiguration> = new Map<string, CachedConfiguration>();

	constructor(private readonly environmentService: INativeEnvironmentService) {
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
			cachedConfiguration = new CachedConfiguration({ type, key }, this.environmentService);
			this.cachedConfigurations.set(k, cachedConfiguration);
		}
		return cachedConfiguration;
	}

}


class CachedConfiguration {

	private cachedConfigurationFolderPath: string;
	private cachedConfigurationFilePath: string;

	constructor(
		{ type, key }: ConfigurationKey,
		environmentService: INativeEnvironmentService
	) {
		this.cachedConfigurationFolderPath = join(environmentService.userDataPath, 'CachedConfigurations', type, key);
		this.cachedConfigurationFilePath = join(this.cachedConfigurationFolderPath, type === 'workspaces' ? 'workspace.json' : 'configuration.json');
	}

	async read(): Promise<string> {
		try {
			const content = await pfs.readFile(this.cachedConfigurationFilePath);
			return content.toString();
		} catch (e) {
			return '';
		}
	}

	async save(content: string): Promise<void> {
		const created = await this.createCachedFolder();
		if (created) {
			await pfs.writeFile(this.cachedConfigurationFilePath, content);
		}
	}

	remove(): Promise<void> {
		return pfs.rimraf(this.cachedConfigurationFolderPath);
	}

	private createCachedFolder(): Promise<boolean> {
		return Promise.resolve(pfs.exists(this.cachedConfigurationFolderPath))
			.then(undefined, () => false)
			.then(exists => exists ? exists : pfs.mkdirp(this.cachedConfigurationFolderPath).then(() => true, () => false));
	}
}

