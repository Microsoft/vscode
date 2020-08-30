/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import * as crypto from 'crypto';
import { once } from 'vs/base/common/functional';

export function checksum(path: string, sha1hash: string | undefined): Promise<void> {
	const promise = new Promise<string | undefined>((c, e) => {
		const input = fs.createReadStream(path);
		const hash = crypto.createHash('sha1');
		input.pipe(hash);

		const done = once((err?: Error, result?: string) => {
			input.removeAllListeners();
			hash.removeAllListeners();

			if (err) {
				e(err);
			} else {
				c(result);
			}
		});

		input.once('error', done);
		input.once('end', done);
		hash.once('error', done);
		hash.once('data', (data: Buffer) => done(undefined, data.toString('hex')));
	});

	return promise.then(hash => {
		if (hash !== sha1hash) {
			return Promise.reject(new Error('Hash mismatch'));
		}

		return Promise.resolve();
	});
}
