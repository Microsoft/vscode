/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as keytar from 'keytar';
import { ICredentialsService } from 'vs/platform/credentials/common/credentials';
import { IdleValue } from 'vs/base/common/async';

export class KeytarCredentialsService implements ICredentialsService {

	declare readonly _serviceBrand: undefined;

	private readonly _keytar = new IdleValue<Promise<typeof keytar>>(() => import('keytar'));

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
