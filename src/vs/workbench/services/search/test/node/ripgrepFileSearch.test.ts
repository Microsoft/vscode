/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as platform from 'vs/base/common/platform';
import { fixDriveC, getAbsoluteGlob } from 'vs/workbench/services/search/node/ripgrepFileSearch';

suite('RipgrepFileSearch - etc', () => {
	function testGetAbsGlob(params: string[]): void {
		const [folder, glob, expectedResult] = params;
		assert.equal(fixDriveC(getAbsoluteGlob(folder, glob)), expectedResult, JSON.stringify(params));
	}

	test('getAbsoluteGlob_win', () => {
		if (!platform.isWindows) {
			return;
		}

		[
			['C:/foo/bar', 'glob/**', '/foo\\bar\\glob\\**'],
			['c:/', 'glob/**', '/glob\\**'],
			['C:\\foo\\bar', 'glob\\**', '/foo\\bar\\glob\\**'],
			['c:\\foo\\bar', 'glob\\**', '/foo\\bar\\glob\\**'],
			['c:\\', 'glob\\**', '/glob\\**'],
			['\\\\localhost\\c$\\foo\\bar', 'glob/**', '\\\\localhost\\c$\\foo\\bar\\glob\\**'],

			// absolute paths are not resolved further
			['c:/foo/bar', '/path/something', '/path/something'],
			['c:/foo/bar', 'c:\\project\\folder', '/project\\folder']
		].forEach(testGetAbsGlob);
	});

	test('getAbsoluteGlob_posix', () => {
		if (platform.isWindows) {
			return;
		}

		[
			['/foo/bar', 'glob/**', '/foo/bar/glob/**'],
			['/', 'glob/**', '/glob/**'],

			// absolute paths are not resolved further
			['/', '/project/folder', '/project/folder'],
		].forEach(testGetAbsGlob);
	});
});
