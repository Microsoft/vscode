/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IConfigurationCache, ConfigurationKey } from 'vs/workbench/services/configuration/common/configuration';

export class ConfigurationCache implements IConfigurationCache {

	async read(key: ConfigurationKey): Promise<string> {
		return '';
	}

	async write(key: ConfigurationKey, content: string): Promise<void> {
	}

	async remove(key: ConfigurationKey): Promise<void> {
	}
}
