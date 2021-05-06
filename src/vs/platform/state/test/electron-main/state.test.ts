/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { tmpdir } from 'os';
import { promises } from 'fs';
import { join } from 'vs/base/common/path';
import { flakySuite, getRandomTestPath } from 'vs/base/test/node/testUtils';
import { FileStorage } from 'vs/platform/state/electron-main/stateMainService';
import { rimraf, writeFileSync } from 'vs/base/node/pfs';
import { NullLogService } from 'vs/platform/log/common/log';

flakySuite('StateMainService', () => {

	let testDir: string;

	setup(() => {
		testDir = getRandomTestPath(tmpdir(), 'vsctests', 'statemainservice');

		return promises.mkdir(testDir, { recursive: true });
	});

	teardown(() => {
		return rimraf(testDir);
	});

	test('Basics', async function () {
		const storageFile = join(testDir, 'storage.json');
		writeFileSync(storageFile, '');

		let service = new FileStorage(storageFile, new NullLogService());
		await service.init();

		service.setItem('some.key', 'some.value');
		assert.strictEqual(service.getItem('some.key'), 'some.value');

		service.removeItem('some.key');
		assert.strictEqual(service.getItem('some.key', 'some.default'), 'some.default');

		assert.ok(!service.getItem('some.unknonw.key'));

		service.setItem('some.other.key', 'some.other.value');

		await service.flush();

		service = new FileStorage(storageFile, new NullLogService());
		await service.init();

		assert.strictEqual(service.getItem('some.other.key'), 'some.other.value');

		service.setItem('some.other.key', 'some.other.value');
		assert.strictEqual(service.getItem('some.other.key'), 'some.other.value');

		service.setItem('some.undefined.key', undefined);
		assert.strictEqual(service.getItem('some.undefined.key', 'some.default'), 'some.default');

		service.setItem('some.null.key', null);
		assert.strictEqual(service.getItem('some.null.key', 'some.default'), 'some.default');

		service.setItems([
			{ key: 'some.setItems.key1', data: 'some.value' },
			{ key: 'some.setItems.key2', data: 0 },
			{ key: 'some.setItems.key3', data: true },
			{ key: 'some.setItems.key4', data: null },
			{ key: 'some.setItems.key5', data: undefined }
		]);

		assert.strictEqual(service.getItem('some.setItems.key1'), 'some.value');
		assert.strictEqual(service.getItem('some.setItems.key2'), 0);
		assert.strictEqual(service.getItem('some.setItems.key3'), true);
		assert.strictEqual(service.getItem('some.setItems.key4'), undefined);
		assert.strictEqual(service.getItem('some.setItems.key5'), undefined);

		service.setItems([
			{ key: 'some.setItems.key1', data: undefined },
			{ key: 'some.setItems.key2', data: undefined },
			{ key: 'some.setItems.key3', data: undefined },
			{ key: 'some.setItems.key4', data: null },
			{ key: 'some.setItems.key5', data: undefined }
		]);

		assert.strictEqual(service.getItem('some.setItems.key1'), undefined);
		assert.strictEqual(service.getItem('some.setItems.key2'), undefined);
		assert.strictEqual(service.getItem('some.setItems.key3'), undefined);
		assert.strictEqual(service.getItem('some.setItems.key4'), undefined);
		assert.strictEqual(service.getItem('some.setItems.key5'), undefined);
	});

	test('Multiple ops are buffered and applied', async function () {
		const storageFile = join(testDir, 'storage.json');
		writeFileSync(storageFile, '');

		let service = new FileStorage(storageFile, new NullLogService());
		await service.init();

		service.setItem('some.key1', 'some.value1');
		service.setItem('some.key2', 'some.value2');
		service.setItem('some.key3', 'some.value3');
		service.setItem('some.key4', 'some.value4');
		service.removeItem('some.key4');

		assert.strictEqual(service.getItem('some.key1'), 'some.value1');
		assert.strictEqual(service.getItem('some.key2'), 'some.value2');
		assert.strictEqual(service.getItem('some.key3'), 'some.value3');
		assert.strictEqual(service.getItem('some.key4'), undefined);

		await service.flush();

		service = new FileStorage(storageFile, new NullLogService());
		await service.init();

		assert.strictEqual(service.getItem('some.key1'), 'some.value1');
		assert.strictEqual(service.getItem('some.key2'), 'some.value2');
		assert.strictEqual(service.getItem('some.key3'), 'some.value3');
		assert.strictEqual(service.getItem('some.key4'), undefined);
	});

	test('Used before init', async function () {
		const storageFile = join(testDir, 'storage.json');
		writeFileSync(storageFile, '');

		let service = new FileStorage(storageFile, new NullLogService());

		service.setItem('some.key1', 'some.value1');
		service.setItem('some.key2', 'some.value2');
		service.setItem('some.key3', 'some.value3');
		service.setItem('some.key4', 'some.value4');
		service.removeItem('some.key4');

		assert.strictEqual(service.getItem('some.key1'), 'some.value1');
		assert.strictEqual(service.getItem('some.key2'), 'some.value2');
		assert.strictEqual(service.getItem('some.key3'), 'some.value3');
		assert.strictEqual(service.getItem('some.key4'), undefined);

		await service.init();

		assert.strictEqual(service.getItem('some.key1'), undefined);
		assert.strictEqual(service.getItem('some.key2'), undefined);
		assert.strictEqual(service.getItem('some.key3'), undefined);
		assert.strictEqual(service.getItem('some.key4'), undefined);
	});
});
