/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
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
