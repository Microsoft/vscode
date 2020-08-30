/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equal } from 'assert';
import { FileStorageDatabase } from 'vs/platform/storage/browser/storageService';
import { generateUuid } from 'vs/base/common/uuid';
import { join } from 'vs/base/common/path';
import { tmpdir } from 'os';
import { rimraf, RimRafMode } from 'vs/base/node/pfs';
import { NullLogService } from 'vs/platform/log/common/log';
import { Storage } from 'vs/base/parts/storage/common/storage';
import { URI } from 'vs/base/common/uri';
import { FileService } from 'vs/platform/files/common/fileService';
import { getRandomTestPath } from 'vs/base/test/node/testUtils';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';

suite('Storage', () => {

	const parentDir = getRandomTestPath(tmpdir(), 'vsctests', 'storageservice');

	let fileService: FileService;
	let fileProvider: DiskFileSystemProvider;
	let testDir: string;

	const disposables = new DisposableStore();

	setup(async () => {
		const logService = new NullLogService();

		fileService = new FileService(logService);
		disposables.add(fileService);

		fileProvider = new DiskFileSystemProvider(logService);
		disposables.add(fileService.registerProvider(Schemas.file, fileProvider));
		disposables.add(fileProvider);

		const id = generateUuid();
		testDir = join(parentDir, id);
	});

	teardown(async () => {
		disposables.clear();

		await rimraf(parentDir, RimRafMode.MOVE);
	});

	test('File Based Storage', async () => {
		let storage = new Storage(new FileStorageDatabase(URI.file(join(testDir, 'storage.json')), false, fileService));

		await storage.init();

		storage.set('bar', 'foo');
		storage.set('barNumber', 55);
		storage.set('barBoolean', true);

		equal(storage.get('bar'), 'foo');
		equal(storage.get('barNumber'), '55');
		equal(storage.get('barBoolean'), 'true');

		await storage.close();

		storage = new Storage(new FileStorageDatabase(URI.file(join(testDir, 'storage.json')), false, fileService));

		await storage.init();

		equal(storage.get('bar'), 'foo');
		equal(storage.get('barNumber'), '55');
		equal(storage.get('barBoolean'), 'true');

		storage.delete('bar');
		storage.delete('barNumber');
		storage.delete('barBoolean');

		equal(storage.get('bar', 'undefined'), 'undefined');
		equal(storage.get('barNumber', 'undefinedNumber'), 'undefinedNumber');
		equal(storage.get('barBoolean', 'undefinedBoolean'), 'undefinedBoolean');

		await storage.close();

		storage = new Storage(new FileStorageDatabase(URI.file(join(testDir, 'storage.json')), false, fileService));

		await storage.init();

		equal(storage.get('bar', 'undefined'), 'undefined');
		equal(storage.get('barNumber', 'undefinedNumber'), 'undefinedNumber');
		equal(storage.get('barBoolean', 'undefinedBoolean'), 'undefinedBoolean');
	});
});
