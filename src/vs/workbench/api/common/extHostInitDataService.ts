/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInitData } from './extHost.protocol';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const IExtHostInitDataService = createDecorator<IExtHostInitDataService>('IExtHostInitDataService');

export interface IExtHostInitDataService extends Readonly<IInitData> {
	readonly _serviceBrand: undefined;
}

