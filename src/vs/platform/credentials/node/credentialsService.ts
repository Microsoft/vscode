/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ICredentialsService } from 'vs/platform/credentials/common/credentials';
import { IdleValue } from 'vs/base/common/async';

type KeytarModule = typeof import('keytar');
export class KeytarCredentialsService implements ICredentialsService {

	declare readonly _serviceBrand: undefined;

	private readonly _keytar = new IdleValue<Promise<KeytarModule>>(() => import('keytar'));

	async getPassword(service: string, account: string): Promise<string | null> {
		const keytar = await this._keytar.value;
		return keytar.getPassword(service, account);
	}

	async setPassword(service: string, account: string, password: string): Promise<void> {
		const keytar = await this._keytar.value;
		return keytar.setPassword(service, account, password);
	}

	async deletePassword(service: string, account: string): Promise<boolean> {
		const keytar = await this._keytar.value;
		return keytar.deletePassword(service, account);
	}

	async findPassword(service: string): Promise<string | null> {
		const keytar = await this._keytar.value;
		return keytar.findPassword(service);
	}

	async findCredentials(service: string): Promise<Array<{ account: string, password: string }>> {
		const keytar = await this._keytar.value;
		return keytar.findCredentials(service);
	}
}
