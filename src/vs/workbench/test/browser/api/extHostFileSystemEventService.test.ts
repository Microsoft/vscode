/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { ExtHostFileSystemEventService } from 'vs/workbench/api/common/extHostFileSystemEventService';
import { IMainContext } from 'vs/workbench/api/common/extHost.protocol';
import { NullLogService } from 'vs/platform/log/common/log';

suite('ExtHostFileSystemEventService', () => {


	test('FileSystemWatcher ignore events properties are reversed #26851', function () {

		const protocol: IMainContext = {
			getProxy: () => { return undefined!; },
			set: undefined!,
			assertRegistered: undefined!,
			drain: undefined!
		};

		const watcher1 = new ExtHostFileSystemEventService(protocol, new NullLogService(), undefined!).createFileSystemWatcher('**/somethingInteresting', false, false, false);
		assert.equal(watcher1.ignoreChangeEvents, false);
		assert.equal(watcher1.ignoreCreateEvents, false);
		assert.equal(watcher1.ignoreDeleteEvents, false);

		const watcher2 = new ExtHostFileSystemEventService(protocol, new NullLogService(), undefined!).createFileSystemWatcher('**/somethingBoring', true, true, true);
		assert.equal(watcher2.ignoreChangeEvents, true);
		assert.equal(watcher2.ignoreCreateEvents, true);
		assert.equal(watcher2.ignoreDeleteEvents, true);
	});

});
