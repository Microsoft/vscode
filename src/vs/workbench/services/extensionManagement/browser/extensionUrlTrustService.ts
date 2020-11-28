/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionUrlTrustService } from 'vs/platform/extensionManagement/common/extensionUrlTrust';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

class ExtensionUrlTrustService implements IExtensionUrlTrustService {

	declare readonly _serviceBrand: undefined;

	async isExtensionUrlTrusted(): Promise<boolean> {
		return false;
	}
}

registerSingleton(IExtensionUrlTrustService, ExtensionUrlTrustService);
