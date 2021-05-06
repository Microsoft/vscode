/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { URI } from 'vs/base/common/uri';

export const IChecksumService = createDecorator<IChecksumService>('checksumService');

export interface IChecksumService {

	readonly _serviceBrand: undefined;

	/**
	 * Computes the checksum of the contents of the resource.
	 */
	checksum(resource: URI): Promise<string>;
}
