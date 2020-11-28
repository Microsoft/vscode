/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as platform from 'vs/base/common/platform';
import { IWatcherRequest } from 'vs/platform/files/node/watcher/unix/watcher';

suite('Chokidar normalizeRoots', async () => {

	// Load `chokidarWatcherService` within the suite to prevent all tests
	// from failing to start if `chokidar` was not properly installed
	const { normalizeRoots } = await import('vs/platform/files/node/watcher/unix/chokidarWatcherService');

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
