/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { strictEqual, ok, equal } from 'assert';
import { StorageScope, InMemoryStorageService } from 'vs/platform/storage/common/storage';
import { NativeStorageService } from 'vs/platform/storage/node/storageService';
import { generateUuid } from 'vs/base/common/uuid';
import { join } from 'vs/base/common/path';
import { tmpdir } from 'os';
import { mkdirp, rimraf, RimRafMode } from 'vs/base/node/pfs';
import { NullLogService } from 'vs/platform/log/common/log';
import { EnvironmentService } from 'vs/platform/environment/node/environmentService';
import { parseArgs, OPTIONS } from 'vs/platform/environment/node/argv';
import { InMemoryStorageDatabase } from 'vs/base/parts/storage/common/storage';
import { URI } from 'vs/base/common/uri';

suite('StorageService', () => {

	test('Remove Data (global, in-memory)', () => {
		removeData(StorageScope.GLOBAL);
	});

	test('Remove Data (workspace, in-memory)', () => {
		removeData(StorageScope.WORKSPACE);
	});

	function removeData(scope: StorageScope): void {
		const storage = new InMemoryStorageService();

		storage.store('test.remove', 'foobar', scope);
		strictEqual('foobar', storage.get('test.remove', scope, (undefined)!));

		storage.remove('test.remove', scope);
		ok(!storage.get('test.remove', scope, (undefined)!));
	}

	test('Get Data, Integer, Boolean (global, in-memory)', () => {
		storeData(StorageScope.GLOBAL);
	});

	test('Get Data, Integer, Boolean (workspace, in-memory)', () => {
		storeData(StorageScope.WORKSPACE);
	});

	function storeData(scope: StorageScope): void {
		const storage = new InMemoryStorageService();

		strictEqual(storage.get('test.get', scope, 'foobar'), 'foobar');
		strictEqual(storage.get('test.get', scope, ''), '');
		strictEqual(storage.getNumber('test.getNumber', scope, 5), 5);
		strictEqual(storage.getNumber('test.getNumber', scope, 0), 0);
		strictEqual(storage.getBoolean('test.getBoolean', scope, true), true);
		strictEqual(storage.getBoolean('test.getBoolean', scope, false), false);

		storage.store('test.get', 'foobar', scope);
		strictEqual(storage.get('test.get', scope, (undefined)!), 'foobar');

		storage.store('test.get', '', scope);
		strictEqual(storage.get('test.get', scope, (undefined)!), '');

		storage.store('test.getNumber', 5, scope);
		strictEqual(storage.getNumber('test.getNumber', scope, (undefined)!), 5);

		storage.store('test.getNumber', 0, scope);
		strictEqual(storage.getNumber('test.getNumber', scope, (undefined)!), 0);

		storage.store('test.getBoolean', true, scope);
		strictEqual(storage.getBoolean('test.getBoolean', scope, (undefined)!), true);

		storage.store('test.getBoolean', false, scope);
		strictEqual(storage.getBoolean('test.getBoolean', scope, (undefined)!), false);

		strictEqual(storage.get('test.getDefault', scope, 'getDefault'), 'getDefault');
		strictEqual(storage.getNumber('test.getNumberDefault', scope, 5), 5);
		strictEqual(storage.getBoolean('test.getBooleanDefault', scope, true), true);
	}

	function uniqueStorageDir(): string {
		const id = generateUuid();

		return join(tmpdir(), 'vsctests', id, 'storage2', id);
	}

	test('Migrate Data', async () => {
		class StorageTestEnvironmentService extends EnvironmentService {

			constructor(private workspaceStorageFolderPath: URI, private _extensionsPath: string) {
				super(parseArgs(process.argv, OPTIONS), process.execPath);
			}

			get workspaceStorageHome(): URI {
				return this.workspaceStorageFolderPath;
			}

			get extensionsPath(): string {
				return this._extensionsPath;
			}
		}

		const storageDir = uniqueStorageDir();
		await mkdirp(storageDir);

		const storage = new NativeStorageService(new InMemoryStorageDatabase(), new NullLogService(), new StorageTestEnvironmentService(URI.file(storageDir), storageDir));
		await storage.initialize({ id: String(Date.now()) });

		storage.store('bar', 'foo', StorageScope.WORKSPACE);
		storage.store('barNumber', 55, StorageScope.WORKSPACE);
		storage.store('barBoolean', true, StorageScope.GLOBAL);

		await storage.migrate({ id: String(Date.now() + 100) });

		equal(storage.get('bar', StorageScope.WORKSPACE), 'foo');
		equal(storage.getNumber('barNumber', StorageScope.WORKSPACE), 55);
		equal(storage.getBoolean('barBoolean', StorageScope.GLOBAL), true);

		await storage.close();
		await rimraf(storageDir, RimRafMode.MOVE);
	});
});
