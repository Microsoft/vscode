/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IExtensionUrlTrustService = createDecorator<IExtensionUrlTrustService>('extensionUrlTrustService');

export interface IExtensionUrlTrustService {
	readonly _serviceBrand: undefined;
	isExtensionUrlTrusted(extensionId: string, url: string): Promise<boolean>;
}
