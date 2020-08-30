/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as platform from 'vs/base/common/platform';

suite('Keytar', () => {

	test('loads and is functional', function (done) {
		if (platform.isLinux) {
			// Skip test due to set up issue with Travis.
			this.skip();
			return;
		}
		(async () => {
			const keytar = await import('keytar');
			const name = `VSCode Test ${Math.floor(Math.random() * 1e9)}`;
			try {
				await keytar.setPassword(name, 'foo', 'bar');
				assert.equal(await keytar.findPassword(name), 'bar');
				assert.equal((await keytar.findCredentials(name)).length, 1);
				assert.equal(await keytar.getPassword(name, 'foo'), 'bar');
				await keytar.deletePassword(name, 'foo');
				assert.equal(await keytar.getPassword(name, 'foo'), undefined);
			} catch (err) {
				// try to clean up
				try {
					await keytar.deletePassword(name, 'foo');
				} finally {
					// eslint-disable-next-line no-unsafe-finally
					throw err;
				}
			}
		})().then(done, done);
	});
});
