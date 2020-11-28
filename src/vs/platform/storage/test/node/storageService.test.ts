/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { equal } from 'assert';
import { StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { NativeStorageService } from 'vs/platform/storage/node/storageService';
import { generateUuid } from 'vs/base/common/uuid';
import { join } from 'vs/base/common/path';
import { tmpdir } from 'os';
import { mkdirp, rimraf, RimRafMode } from 'vs/base/node/pfs';
import { NullLogService } from 'vs/platform/log/common/log';
import { NativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { parseArgs, OPTIONS } from 'vs/platform/environment/node/argv';
import { InMemoryStorageDatabase } from 'vs/base/parts/storage/common/storage';
import { URI } from 'vs/base/common/uri';

suite('NativeStorageService', function () {

	function uniqueStorageDir(): string {
		const id = generateUuid();

		return join(tmpdir(), 'vsctests', id, 'storage2', id);
	}

	test('Migrate Data', async () => {

		// Given issues such as https://github.com/microsoft/vscode/issues/108113
		// we see random test failures when accessing the native file system.
		this.retries(3);
		this.timeout(1000 * 20);

		class StorageTestEnvironmentService extends NativeEnvironmentService {

			constructor(private workspaceStorageFolderPath: URI, private _extensionsPath: string) {
				super(parseArgs(process.argv, OPTIONS));
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

		storage.store('bar', 'foo', StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('barNumber', 55, StorageScope.WORKSPACE, StorageTarget.MACHINE);
		storage.store('barBoolean', true, StorageScope.GLOBAL, StorageTarget.MACHINE);

		equal(storage.get('bar', StorageScope.WORKSPACE), 'foo');
		equal(storage.getNumber('barNumber', StorageScope.WORKSPACE), 55);
		equal(storage.getBoolean('barBoolean', StorageScope.GLOBAL), true);

		await storage.migrate({ id: String(Date.now() + 100) });

		equal(storage.get('bar', StorageScope.WORKSPACE), 'foo');
		equal(storage.getNumber('barNumber', StorageScope.WORKSPACE), 55);
		equal(storage.getBoolean('barBoolean', StorageScope.GLOBAL), true);

		await storage.close();
		await rimraf(storageDir, RimRafMode.MOVE);
	});
});
