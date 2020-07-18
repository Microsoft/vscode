/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

export async function sha256(s: string | Uint8Array): Promise<string> {
	const createHash = require('sha.js');
	return createHash('sha256').update(s).digest('base64');
}
