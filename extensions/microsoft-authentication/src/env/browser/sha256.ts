/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

export async function sha256(s: string | Uint8Array): Promise<string> {
	const createHash = require('sha.js');
	return createHash('sha256').update(s).digest('base64');
}
