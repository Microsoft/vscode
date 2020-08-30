/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import * as uuid from 'vs/base/common/uuid';
import * as pfs from 'vs/base/node/pfs';
import { realcaseSync, realpath, realpathSync } from 'vs/base/node/extpath';

suite('Extpath', () => {

	test('realcase', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'extpath', id);

		await pfs.mkdirp(newDir, 493);

		// assume case insensitive file system
		if (process.platform === 'win32' || process.platform === 'darwin') {
			const upper = newDir.toUpperCase();
			const real = realcaseSync(upper);

			if (real) { // can be null in case of permission errors
				assert.notEqual(real, upper);
				assert.equal(real.toUpperCase(), upper);
				assert.equal(real, newDir);
			}
		}

		// linux, unix, etc. -> assume case sensitive file system
		else {
			const real = realcaseSync(newDir);
			assert.equal(real, newDir);
		}

		await pfs.rimraf(parentDir, pfs.RimRafMode.MOVE);
	});

	test('realpath', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'extpath', id);

		await pfs.mkdirp(newDir, 493);

		const realpathVal = await realpath(newDir);
		assert.ok(realpathVal);

		await pfs.rimraf(parentDir, pfs.RimRafMode.MOVE);
	});

	test('realpathSync', async () => {
		const id = uuid.generateUuid();
		const parentDir = path.join(os.tmpdir(), 'vsctests', id);
		const newDir = path.join(parentDir, 'extpath', id);

		await pfs.mkdirp(newDir, 493);

		let realpath!: string;
		try {
			realpath = realpathSync(newDir);
		} catch (error) {
			assert.ok(!error);
		}
		assert.ok(realpath!);

		await pfs.rimraf(parentDir, pfs.RimRafMode.MOVE);
	});
});
