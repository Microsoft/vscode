/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISignService } from 'vs/platform/sign/common/sign';

export class SignService implements ISignService {

	declare readonly _serviceBrand: undefined;

	private readonly _tkn: string | null;

	constructor(token: string | undefined) {
		this._tkn = token || null;
	}

	async sign(value: string): Promise<string> {
		return Promise.resolve(this._tkn || '');
	}
}
