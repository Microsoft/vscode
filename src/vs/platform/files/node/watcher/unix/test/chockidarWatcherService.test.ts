/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as os from 'os';
import * as path from 'vs/base/common/path';
import * as pfs from 'vs/base/node/pfs';
import { normalizeRoots, ChokidarWatcherService } from '../chokidarWatcherService';
import { IWatcherRequest } from '../watcher';
import * as platform from 'vs/base/common/platform';
import { Delayer } from 'vs/base/common/async';
import { IDiskFileChange } from 'vs/platform/files/node/watcher/watcher';
import { FileChangeType } from 'vs/platform/files/common/files';

function newRequest(basePath: string, ignored: string[] = []): IWatcherRequest {
	return { path: basePath, excludes: ignored };
}

function assertNormalizedRootPath(inputPaths: string[], expectedPaths: string[]) {
	const requests = inputPaths.map(path => newRequest(path));
	const actual = normalizeRoots(requests);
	assert.deepEqual(Object.keys(actual).sort(), expectedPaths);
}

function assertNormalizedRequests(inputRequests: IWatcherRequest[], expectedRequests: { [path: string]: IWatcherRequest[] }) {
	const actual = normalizeRoots(inputRequests);
	const actualPath = Object.keys(actual).sort();
	const expectedPaths = Object.keys(expectedRequests).sort();
	assert.deepEqual(actualPath, expectedPaths);
	for (let path of actualPath) {
		let a = expectedRequests[path].sort((r1, r2) => r1.path.localeCompare(r2.path));
		let e = expectedRequests[path].sort((r1, r2) => r1.path.localeCompare(r2.path));
		assert.deepEqual(a, e);
	}
}

function sort(changes: IDiskFileChange[]) {
	return changes.sort((c1, c2) => {
		return c1.path.localeCompare(c2.path);
	});
}

function wait(time: number) {
	return new Delayer<void>(time).trigger(() => { });
}

async function assertFileEvents(actuals: IDiskFileChange[], expected: IDiskFileChange[]) {
	let repeats = 40;
	while ((actuals.length < expected.length) && repeats-- > 0) {
		await wait(50);
	}
	assert.deepEqual(sort(actuals), sort(expected));
	actuals.length = 0;
}

suite('Chokidar normalizeRoots', () => {
	test('should not impacts roots that don\'t overlap', () => {
		if (platform.isWindows) {
			assertNormalizedRootPath(['C:\\a'], ['C:\\a']);
			assertNormalizedRootPath(['C:\\a', 'C:\\b'], ['C:\\a', 'C:\\b']);
			assertNormalizedRootPath(['C:\\a', 'C:\\b', 'C:\\c\\d\\e'], ['C:\\a', 'C:\\b', 'C:\\c\\d\\e']);
		} else {
			assertNormalizedRootPath(['/a'], ['/a']);
			assertNormalizedRootPath(['/a', '/b'], ['/a', '/b']);
			assertNormalizedRootPath(['/a', '/b', '/c/d/e'], ['/a', '/b', '/c/d/e']);
		}
	});

	test('should remove sub-folders of other roots', () => {
		if (platform.isWindows) {
			assertNormalizedRootPath(['C:\\a', 'C:\\a\\b'], ['C:\\a']);
			assertNormalizedRootPath(['C:\\a', 'C:\\b', 'C:\\a\\b'], ['C:\\a', 'C:\\b']);
			assertNormalizedRootPath(['C:\\b\\a', 'C:\\a', 'C:\\b', 'C:\\a\\b'], ['C:\\a', 'C:\\b']);
			assertNormalizedRootPath(['C:\\a', 'C:\\a\\b', 'C:\\a\\c\\d'], ['C:\\a']);
		} else {
			assertNormalizedRootPath(['/a', '/a/b'], ['/a']);
			assertNormalizedRootPath(['/a', '/b', '/a/b'], ['/a', '/b']);
			assertNormalizedRootPath(['/b/a', '/a', '/b', '/a/b'], ['/a', '/b']);
			assertNormalizedRootPath(['/a', '/a/b', '/a/c/d'], ['/a']);
			assertNormalizedRootPath(['/a/c/d/e', '/a/b/d', '/a/c/d', '/a/c/e/f', '/a/b'], ['/a/b', '/a/c/d', '/a/c/e/f']);
		}
	});

	test('should remove duplicates', () => {
		if (platform.isWindows) {
			assertNormalizedRootPath(['C:\\a', 'C:\\a\\', 'C:\\a'], ['C:\\a']);
		} else {
			assertNormalizedRootPath(['/a', '/a/', '/a'], ['/a']);
			assertNormalizedRootPath(['/a', '/b', '/a/b'], ['/a', '/b']);
			assertNormalizedRootPath(['/b/a', '/a', '/b', '/a/b'], ['/a', '/b']);
			assertNormalizedRootPath(['/a', '/a/b', '/a/c/d'], ['/a']);
		}
	});

	test('nested requests', () => {
		let p1, p2, p3;
		if (platform.isWindows) {
			p1 = 'C:\\a';
			p2 = 'C:\\a\\b';
			p3 = 'C:\\a\\b\\c';
		} else {
			p1 = '/a';
			p2 = '/a/b';
			p3 = '/a/b/c';
		}
		const r1 = newRequest(p1, ['**/*.ts']);
		const r2 = newRequest(p2, ['**/*.js']);
		const r3 = newRequest(p3, ['**/*.ts']);
		assertNormalizedRequests([r1, r2], { [p1]: [r1, r2] });
		assertNormalizedRequests([r2, r1], { [p1]: [r1, r2] });
		assertNormalizedRequests([r1, r2, r3], { [p1]: [r1, r2, r3] });
		assertNormalizedRequests([r1, r3], { [p1]: [r1] });
		assertNormalizedRequests([r2, r3], { [p2]: [r2, r3] });
	});
});

suite.skip('Chokidar watching', () => {
	const tmpdir = os.tmpdir();
	const testDir = path.join(tmpdir, 'chokidartest-' + Date.now());
	const aFolder = path.join(testDir, 'a');
	const bFolder = path.join(testDir, 'b');
	const b2Folder = path.join(bFolder, 'b2');

	const service = new ChokidarWatcherService();
	const result: IDiskFileChange[] = [];
	let error: string | null = null;

	suiteSetup(async () => {
		await pfs.mkdirp(testDir);
		await pfs.mkdirp(aFolder);
		await pfs.mkdirp(bFolder);
		await pfs.mkdirp(b2Folder);

		const opts = { verboseLogging: false, pollingInterval: 200 };
		service.watch(opts)(e => {
			if (Array.isArray(e)) {
				result.push(...e);
			}
		});
		service.onLogMessage(msg => {
			if (msg.type === 'error') {
				console.log('set error', msg.message);
				error = msg.message;
			}
		});
	});

	suiteTeardown(async () => {
		await pfs.rimraf(testDir, pfs.RimRafMode.MOVE);
		await service.stop();
	});

	setup(() => {
		result.length = 0;
		assert.equal(error, null);
	});

	teardown(() => {
		assert.equal(error, null);
	});

	test('simple file operations, single root, no ignore', async () => {
		let request: IWatcherRequest = { path: testDir, excludes: [] };
		service.setRoots([request]);
		await wait(300);

		assert.equal(service.wacherCount, 1);

		// create a file
		let testFilePath = path.join(testDir, 'file.txt');
		await pfs.writeFile(testFilePath, '');
		await assertFileEvents(result, [{ path: testFilePath, type: FileChangeType.ADDED }]);

		// modify a file
		await pfs.writeFile(testFilePath, 'Hello');
		await assertFileEvents(result, [{ path: testFilePath, type: FileChangeType.UPDATED }]);

		// create a folder
		let testFolderPath = path.join(testDir, 'newFolder');
		await pfs.mkdirp(testFolderPath);
		// copy a file
		let copiedFilePath = path.join(testFolderPath, 'file2.txt');
		await pfs.copy(testFilePath, copiedFilePath);
		await assertFileEvents(result, [{ path: copiedFilePath, type: FileChangeType.ADDED }, { path: testFolderPath, type: FileChangeType.ADDED }]);

		// delete a file
		await pfs.rimraf(copiedFilePath, pfs.RimRafMode.MOVE);
		let renamedFilePath = path.join(testFolderPath, 'file3.txt');
		// move a file
		await pfs.rename(testFilePath, renamedFilePath);
		await assertFileEvents(result, [{ path: copiedFilePath, type: FileChangeType.DELETED }, { path: testFilePath, type: FileChangeType.DELETED }, { path: renamedFilePath, type: FileChangeType.ADDED }]);

		// delete a folder
		await pfs.rimraf(testFolderPath, pfs.RimRafMode.MOVE);
		await assertFileEvents(result, [{ path: testFolderPath, type: FileChangeType.DELETED }, { path: renamedFilePath, type: FileChangeType.DELETED }]);
	});

	test('simple file operations, ignore', async () => {
		let request: IWatcherRequest = { path: testDir, excludes: ['**/b/**', '**/*.js', '.git/**'] };
		service.setRoots([request]);
		await wait(300);

		assert.equal(service.wacherCount, 1);

		// create various ignored files
		let file1 = path.join(bFolder, 'file1.txt'); // hidden
		await pfs.writeFile(file1, 'Hello');
		let file2 = path.join(b2Folder, 'file2.txt'); // hidden
		await pfs.writeFile(file2, 'Hello');
		let folder1 = path.join(bFolder, 'folder1'); // hidden
		await pfs.mkdirp(folder1);
		let folder2 = path.join(aFolder, 'b'); // hidden
		await pfs.mkdirp(folder2);
		let folder3 = path.join(testDir, '.git'); // hidden
		await pfs.mkdirp(folder3);
		let folder4 = path.join(testDir, '.git1');
		await pfs.mkdirp(folder4);
		let folder5 = path.join(aFolder, '.git');
		await pfs.mkdirp(folder5);
		let file3 = path.join(aFolder, 'file3.js'); // hidden
		await pfs.writeFile(file3, 'var x;');
		let file4 = path.join(aFolder, 'file4.txt');
		await pfs.writeFile(file4, 'Hello');
		await assertFileEvents(result, [{ path: file4, type: FileChangeType.ADDED }, { path: folder4, type: FileChangeType.ADDED }, { path: folder5, type: FileChangeType.ADDED }]);

		// move some files
		let movedFile1 = path.join(folder2, 'file1.txt'); // from ignored to ignored
		await pfs.rename(file1, movedFile1);
		let movedFile2 = path.join(aFolder, 'file2.txt'); // from ignored to visible
		await pfs.rename(file2, movedFile2);
		let movedFile3 = path.join(aFolder, 'file3.txt'); // from ignored file ext to visible
		await pfs.rename(file3, movedFile3);
		await assertFileEvents(result, [{ path: movedFile2, type: FileChangeType.ADDED }, { path: movedFile3, type: FileChangeType.ADDED }]);

		// delete all files
		await pfs.rimraf(movedFile1); // hidden
		await pfs.rimraf(movedFile2, pfs.RimRafMode.MOVE);
		await pfs.rimraf(movedFile3, pfs.RimRafMode.MOVE);
		await pfs.rimraf(folder1); // hidden
		await pfs.rimraf(folder2); // hidden
		await pfs.rimraf(folder3); // hidden
		await pfs.rimraf(folder4, pfs.RimRafMode.MOVE);
		await pfs.rimraf(folder5, pfs.RimRafMode.MOVE);
		await pfs.rimraf(file4, pfs.RimRafMode.MOVE);
		await assertFileEvents(result, [{ path: movedFile2, type: FileChangeType.DELETED }, { path: movedFile3, type: FileChangeType.DELETED }, { path: file4, type: FileChangeType.DELETED }, { path: folder4, type: FileChangeType.DELETED }, { path: folder5, type: FileChangeType.DELETED }]);
	});

	test('simple file operations, multiple roots', async () => {
		let request1: IWatcherRequest = { path: aFolder, excludes: ['**/*.js'] };
		let request2: IWatcherRequest = { path: b2Folder, excludes: ['**/*.ts'] };
		service.setRoots([request1, request2]);
		await wait(300);

		assert.equal(service.wacherCount, 2);

		// create some files
		let folderPath1 = path.join(aFolder, 'folder1');
		await pfs.mkdirp(folderPath1);
		let filePath1 = path.join(folderPath1, 'file1.json');
		await pfs.writeFile(filePath1, '');
		let filePath2 = path.join(folderPath1, 'file2.js'); // filtered
		await pfs.writeFile(filePath2, '');
		let folderPath2 = path.join(b2Folder, 'folder2');
		await pfs.mkdirp(folderPath2);
		let filePath3 = path.join(folderPath2, 'file3.ts'); // filtered
		await pfs.writeFile(filePath3, '');
		let filePath4 = path.join(testDir, 'file4.json'); // outside roots
		await pfs.writeFile(filePath4, '');

		await assertFileEvents(result, [{ path: folderPath1, type: FileChangeType.ADDED }, { path: filePath1, type: FileChangeType.ADDED }, { path: folderPath2, type: FileChangeType.ADDED }]);

		// change roots
		let request3: IWatcherRequest = { path: aFolder, excludes: ['**/*.json'] };
		service.setRoots([request3]);
		await wait(300);

		assert.equal(service.wacherCount, 1);

		// delete all
		await pfs.rimraf(folderPath1, pfs.RimRafMode.MOVE);
		await pfs.rimraf(folderPath2, pfs.RimRafMode.MOVE);
		await pfs.rimraf(filePath4, pfs.RimRafMode.MOVE);

		await assertFileEvents(result, [{ path: folderPath1, type: FileChangeType.DELETED }, { path: filePath2, type: FileChangeType.DELETED }]);
	});

	test('simple file operations, nested roots', async () => {
		let request1: IWatcherRequest = { path: testDir, excludes: ['**/b2/**'] };
		let request2: IWatcherRequest = { path: bFolder, excludes: ['**/b3/**'] };
		service.setRoots([request1, request2]);
		await wait(300);

		assert.equal(service.wacherCount, 1);

		// create files
		let filePath1 = path.join(bFolder, 'file1.xml'); // visible by both
		await pfs.writeFile(filePath1, '');
		let filePath2 = path.join(b2Folder, 'file2.xml'); // filtered by root1, but visible by root2
		await pfs.writeFile(filePath2, '');
		let folderPath1 = path.join(b2Folder, 'b3'); // filtered
		await pfs.mkdirp(folderPath1);
		let filePath3 = path.join(folderPath1, 'file3.xml'); // filtered
		await pfs.writeFile(filePath3, '');

		await assertFileEvents(result, [{ path: filePath1, type: FileChangeType.ADDED }, { path: filePath2, type: FileChangeType.ADDED }]);

		let renamedFilePath2 = path.join(folderPath1, 'file2.xml');
		// move a file
		await pfs.rename(filePath2, renamedFilePath2);
		await assertFileEvents(result, [{ path: filePath2, type: FileChangeType.DELETED }]);

		// delete all
		await pfs.rimraf(folderPath1, pfs.RimRafMode.MOVE);
		await pfs.rimraf(filePath1, pfs.RimRafMode.MOVE);

		await assertFileEvents(result, [{ path: filePath1, type: FileChangeType.DELETED }]);
	});

});

