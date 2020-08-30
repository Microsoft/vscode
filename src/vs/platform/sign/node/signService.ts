/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISignService } from 'vs/platform/sign/common/sign';

declare module vsda {
	// the signer is a native module that for historical reasons uses a lower case class name
	// eslint-disable-next-line @typescript-eslint/naming-convention
	export class signer {
		sign(arg: any): any;
	}
}

export class SignService implements ISignService {
	declare readonly _serviceBrand: undefined;

	private vsda(): Promise<typeof vsda> {
		return new Promise((resolve, reject) => require(['vsda'], resolve, reject));
	}

	async sign(value: string): Promise<string> {
		try {
			const vsda = await this.vsda();
			const signer = new vsda.signer();
			if (signer) {
				return signer.sign(value);
			}
		} catch (e) {
			// ignore errors silently
		}
		return value;
	}
}
