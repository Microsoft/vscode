/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as fs from 'fs';
import { join } from 'vs/base/common/path';
import { release, tmpdir, hostname } from 'os';
import { resolveWorkbenchCommonProperties } from 'vs/workbench/services/telemetry/electron-sandbox/workbenchCommonProperties';
import { getRandomTestPath } from 'vs/base/test/node/testUtils';
import { IStorageService, StorageScope, InMemoryStorageService, StorageTarget } from 'vs/platform/storage/common/storage';
import { rimraf } from 'vs/base/node/pfs';
import { timeout } from 'vs/base/common/async';
import { IFileService } from 'vs/platform/files/common/files';
import { FileService } from 'vs/platform/files/common/fileService';
import { NullLogService } from 'vs/platform/log/common/log';
import { Schemas } from 'vs/base/common/network';
import { DiskFileSystemProvider } from 'vs/platform/files/node/diskFileSystemProvider';

suite('Telemetry - common properties', function () {
	const parentDir = getRandomTestPath(tmpdir(), 'vsctests', 'telemetryservice');
	const installSource = join(parentDir, 'installSource');

	const commit: string = (undefined)!;
	const version: string = (undefined)!;
	let testStorageService: IStorageService;
	let testFileService: IFileService;
	let diskFileSystemProvider: DiskFileSystemProvider;

	setup(() => {
		testStorageService = new InMemoryStorageService();
		const logService = new NullLogService();
		testFileService = new FileService(logService);

		diskFileSystemProvider = new DiskFileSystemProvider(logService);
		testFileService.registerProvider(Schemas.file, diskFileSystemProvider);
	});

	teardown(() => {
		diskFileSystemProvider.dispose();

		return rimraf(parentDir);
	});

	test('default', async function () {
		await fs.promises.mkdir(parentDir, { recursive: true });
		fs.writeFileSync(installSource, 'my.install.source');
		const props = await resolveWorkbenchCommonProperties(testStorageService, testFileService, release(), hostname(), commit, version, 'someMachineId', undefined, installSource);
		assert.ok('commitHash' in props);
		assert.ok('sessionID' in props);
		assert.ok('timestamp' in props);
		assert.ok('common.platform' in props);
		assert.ok('common.nodePlatform' in props);
		assert.ok('common.nodeArch' in props);
		assert.ok('common.timesincesessionstart' in props);
		assert.ok('common.sequence' in props);
		// assert.ok('common.version.shell' in first.data); // only when running on electron
		// assert.ok('common.version.renderer' in first.data);
		assert.ok('common.platformVersion' in props, 'platformVersion');
		assert.ok('version' in props);
		assert.strictEqual(props['common.source'], 'my.install.source');
		assert.ok('common.firstSessionDate' in props, 'firstSessionDate');
		assert.ok('common.lastSessionDate' in props, 'lastSessionDate'); // conditional, see below, 'lastSessionDate'ow
		assert.ok('common.isNewSession' in props, 'isNewSession');
		// machine id et al
		assert.ok('common.instanceId' in props, 'instanceId');
		assert.ok('common.machineId' in props, 'machineId');
		fs.unlinkSync(installSource);
		const props_1 = await resolveWorkbenchCommonProperties(testStorageService, testFileService, release(), hostname(), commit, version, 'someMachineId', undefined, installSource);
		assert.ok(!('common.source' in props_1));
	});

	test('lastSessionDate when aviablale', async function () {

		testStorageService.store('telemetry.lastSessionDate', new Date().toUTCString(), StorageScope.GLOBAL, StorageTarget.MACHINE);

		const props = await resolveWorkbenchCommonProperties(testStorageService, testFileService, release(), hostname(), commit, version, 'someMachineId', undefined, installSource);
		assert.ok('common.lastSessionDate' in props); // conditional, see below
		assert.ok('common.isNewSession' in props);
		assert.strictEqual(props['common.isNewSession'], '0');
	});

	test('values chance on ask', async function () {
		const props = await resolveWorkbenchCommonProperties(testStorageService, testFileService, release(), hostname(), commit, version, 'someMachineId', undefined, installSource);
		let value1 = props['common.sequence'];
		let value2 = props['common.sequence'];
		assert.ok(value1 !== value2, 'seq');

		value1 = props['timestamp'];
		value2 = props['timestamp'];
		assert.ok(value1 !== value2, 'timestamp');

		value1 = props['common.timesincesessionstart'];
		await timeout(10);
		value2 = props['common.timesincesessionstart'];
		assert.ok(value1 !== value2, 'timesincesessionstart');
	});
});
