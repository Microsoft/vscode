/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';

export interface ICredentialsProvider {
	getPassword(service: string, account: string): Promise<string | null>;
	setPassword(service: string, account: string, password: string): Promise<void>;
	deletePassword(service: string, account: string): Promise<boolean>;
	findPassword(service: string): Promise<string | null>;
	findCredentials(service: string): Promise<Array<{ account: string, password: string }>>;
}

export const ICredentialsService = createDecorator<ICredentialsService>('ICredentialsService');

export interface ICredentialsService extends ICredentialsProvider {
	readonly _serviceBrand: undefined;
}
