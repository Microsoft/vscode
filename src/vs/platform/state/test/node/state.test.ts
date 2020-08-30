/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import { getRandomTestPath } from 'vs/base/test/node/testUtils';
import { FileStorage } from 'vs/platform/state/node/stateService';
import { mkdirp, rimraf, RimRafMode, writeFileSync } from 'vs/base/node/pfs';

suite('StateService', () => {
	const parentDir = getRandomTestPath(os.tmpdir(), 'vsctests', 'stateservice');
	const storageFile = path.join(parentDir, 'storage.json');

	teardown(async () => {
		await rimraf(parentDir, RimRafMode.MOVE);
	});

	test('Basics', async () => {
		await mkdirp(parentDir);
		writeFileSync(storageFile, '');

		let service = new FileStorage(storageFile, () => null);

		service.setItem('some.key', 'some.value');
		assert.equal(service.getItem('some.key'), 'some.value');

		service.removeItem('some.key');
		assert.equal(service.getItem('some.key', 'some.default'), 'some.default');

		assert.ok(!service.getItem('some.unknonw.key'));

		service.setItem('some.other.key', 'some.other.value');

		service = new FileStorage(storageFile, () => null);

		assert.equal(service.getItem('some.other.key'), 'some.other.value');

		service.setItem('some.other.key', 'some.other.value');
		assert.equal(service.getItem('some.other.key'), 'some.other.value');

		service.setItem('some.undefined.key', undefined);
		assert.equal(service.getItem('some.undefined.key', 'some.default'), 'some.default');

		service.setItem('some.null.key', null);
		assert.equal(service.getItem('some.null.key', 'some.default'), 'some.default');
	});
});
