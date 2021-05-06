/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationCache, ConfigurationKey } from 'vs/workbench/services/configuration/common/configuration';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';

export class ConfigurationCache implements IConfigurationCache {

	needsCaching(resource: URI): boolean {
		// Cache all non user data resources
		return ![Schemas.file, Schemas.userData, Schemas.tmp].includes(resource.scheme);
	}

	async read(key: ConfigurationKey): Promise<string> {
		return '';
	}

	async write(key: ConfigurationKey, content: string): Promise<void> {
	}

	async remove(key: ConfigurationKey): Promise<void> {
	}
}
