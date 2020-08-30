/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export const SIGN_SERVICE_ID = 'signService';
export const ISignService = createDecorator<ISignService>(SIGN_SERVICE_ID);

export interface ISignService {
	readonly _serviceBrand: undefined;

	sign(value: string): Promise<string>;
}
