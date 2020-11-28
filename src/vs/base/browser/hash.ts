/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { StringSHA1, toHexString } from 'vs/base/common/hash';

export async function sha1Hex(str: string): Promise<string> {

	// Prefer to use browser's crypto module
	if (globalThis?.crypto?.subtle) {
		const hash = await globalThis.crypto.subtle.digest({ name: 'sha-1' }, VSBuffer.fromString(str).buffer);

		return toHexString(hash);
	}

	// Otherwise fallback to `StringSHA1`
	else {
		const computer = new StringSHA1();
		computer.update(str);

		return computer.digest();
	}
}
