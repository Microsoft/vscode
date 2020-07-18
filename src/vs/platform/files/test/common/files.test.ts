/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { isEqual, isEqualOrParent } from 'vs/base/common/extpath';
import { FileChangeType, FileChangesEvent, isParent } from 'vs/platform/files/common/files';
import { isLinux, isMacintosh, isWindows } from 'vs/base/common/platform';
import { toResource } from 'vs/base/test/common/utils';
import { extUri } from 'vs/base/common/resources';

suite('Files', () => {

	test('FileChangesEvent', function () {
		let changes = [
			{ resource: toResource.call(this, '/foo/updated.txt'), type: FileChangeType.UPDATED },
			{ resource: toResource.call(this, '/foo/otherupdated.txt'), type: FileChangeType.UPDATED },
			{ resource: toResource.call(this, '/added.txt'), type: FileChangeType.ADDED },
			{ resource: toResource.call(this, '/bar/deleted.txt'), type: FileChangeType.DELETED },
			{ resource: toResource.call(this, '/bar/folder'), type: FileChangeType.DELETED }
		];

		let r1 = new FileChangesEvent(changes, extUri);

		assert(!r1.contains(toResource.call(this, '/foo'), FileChangeType.UPDATED));
		assert(r1.contains(toResource.call(this, '/foo/updated.txt'), FileChangeType.UPDATED));
		assert(!r1.contains(toResource.call(this, '/foo/updated.txt'), FileChangeType.ADDED));
		assert(!r1.contains(toResource.call(this, '/foo/updated.txt'), FileChangeType.DELETED));

		assert(r1.contains(toResource.call(this, '/bar/folder'), FileChangeType.DELETED));
		assert(r1.contains(toResource.call(this, '/bar/folder/somefile'), FileChangeType.DELETED));
		assert(r1.contains(toResource.call(this, '/bar/folder/somefile/test.txt'), FileChangeType.DELETED));
		assert(!r1.contains(toResource.call(this, '/bar/folder2/somefile'), FileChangeType.DELETED));

		assert.strictEqual(5, r1.changes.length);
		assert.strictEqual(1, r1.getAdded().length);
		assert.strictEqual(true, r1.gotAdded());
		assert.strictEqual(2, r1.getUpdated().length);
		assert.strictEqual(true, r1.gotUpdated());
		assert.strictEqual(2, r1.getDeleted().length);
		assert.strictEqual(true, r1.gotDeleted());
	});

	function testIsEqual(testMethod: (pA: string, pB: string, ignoreCase: boolean) => boolean): void {

		// corner cases
		assert(testMethod('', '', true));
		assert(!testMethod(null!, '', true));
		assert(!testMethod(undefined!, '', true));

		// basics (string)
		assert(testMethod('/', '/', true));
		assert(testMethod('/some', '/some', true));
		assert(testMethod('/some/path', '/some/path', true));

		assert(testMethod('c:\\', 'c:\\', true));
		assert(testMethod('c:\\some', 'c:\\some', true));
		assert(testMethod('c:\\some\\path', 'c:\\some\\path', true));

		assert(testMethod('/someöäü/path', '/someöäü/path', true));
		assert(testMethod('c:\\someöäü\\path', 'c:\\someöäü\\path', true));

		assert(!testMethod('/some/path', '/some/other/path', true));
		assert(!testMethod('c:\\some\\path', 'c:\\some\\other\\path', true));
		assert(!testMethod('c:\\some\\path', 'd:\\some\\path', true));

		assert(testMethod('/some/path', '/some/PATH', true));
		assert(testMethod('/someöäü/path', '/someÖÄÜ/PATH', true));
		assert(testMethod('c:\\some\\path', 'c:\\some\\PATH', true));
		assert(testMethod('c:\\someöäü\\path', 'c:\\someÖÄÜ\\PATH', true));
		assert(testMethod('c:\\some\\path', 'C:\\some\\PATH', true));
	}

	test('isEqual (ignoreCase)', function () {
		testIsEqual(isEqual);

		// basics (uris)
		assert(isEqual(URI.file('/some/path').fsPath, URI.file('/some/path').fsPath, true));
		assert(isEqual(URI.file('c:\\some\\path').fsPath, URI.file('c:\\some\\path').fsPath, true));

		assert(isEqual(URI.file('/someöäü/path').fsPath, URI.file('/someöäü/path').fsPath, true));
		assert(isEqual(URI.file('c:\\someöäü\\path').fsPath, URI.file('c:\\someöäü\\path').fsPath, true));

		assert(!isEqual(URI.file('/some/path').fsPath, URI.file('/some/other/path').fsPath, true));
		assert(!isEqual(URI.file('c:\\some\\path').fsPath, URI.file('c:\\some\\other\\path').fsPath, true));

		assert(isEqual(URI.file('/some/path').fsPath, URI.file('/some/PATH').fsPath, true));
		assert(isEqual(URI.file('/someöäü/path').fsPath, URI.file('/someÖÄÜ/PATH').fsPath, true));
		assert(isEqual(URI.file('c:\\some\\path').fsPath, URI.file('c:\\some\\PATH').fsPath, true));
		assert(isEqual(URI.file('c:\\someöäü\\path').fsPath, URI.file('c:\\someÖÄÜ\\PATH').fsPath, true));
		assert(isEqual(URI.file('c:\\some\\path').fsPath, URI.file('C:\\some\\PATH').fsPath, true));
	});

	test('isParent (ignorecase)', function () {
		if (isWindows) {
			assert(isParent('c:\\some\\path', 'c:\\', true));
			assert(isParent('c:\\some\\path', 'c:\\some', true));
			assert(isParent('c:\\some\\path', 'c:\\some\\', true));
			assert(isParent('c:\\someöäü\\path', 'c:\\someöäü', true));
			assert(isParent('c:\\someöäü\\path', 'c:\\someöäü\\', true));
			assert(isParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\bar', true));
			assert(isParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\bar\\', true));

			assert(isParent('c:\\some\\path', 'C:\\', true));
			assert(isParent('c:\\some\\path', 'c:\\SOME', true));
			assert(isParent('c:\\some\\path', 'c:\\SOME\\', true));

			assert(!isParent('c:\\some\\path', 'd:\\', true));
			assert(!isParent('c:\\some\\path', 'c:\\some\\path', true));
			assert(!isParent('c:\\some\\path', 'd:\\some\\path', true));
			assert(!isParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\barr', true));
			assert(!isParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\bar\\test', true));
		}

		if (isMacintosh || isLinux) {
			assert(isParent('/some/path', '/', true));
			assert(isParent('/some/path', '/some', true));
			assert(isParent('/some/path', '/some/', true));
			assert(isParent('/someöäü/path', '/someöäü', true));
			assert(isParent('/someöäü/path', '/someöäü/', true));
			assert(isParent('/foo/bar/test.ts', '/foo/bar', true));
			assert(isParent('/foo/bar/test.ts', '/foo/bar/', true));

			assert(isParent('/some/path', '/SOME', true));
			assert(isParent('/some/path', '/SOME/', true));
			assert(isParent('/someöäü/path', '/SOMEÖÄÜ', true));
			assert(isParent('/someöäü/path', '/SOMEÖÄÜ/', true));

			assert(!isParent('/some/path', '/some/path', true));
			assert(!isParent('/foo/bar/test.ts', '/foo/barr', true));
			assert(!isParent('/foo/bar/test.ts', '/foo/bar/test', true));
		}
	});

	test('isEqualOrParent (ignorecase)', function () {

		// same assertions apply as with isEqual()
		testIsEqual(isEqualOrParent); //

		if (isWindows) {
			assert(isEqualOrParent('c:\\some\\path', 'c:\\', true));
			assert(isEqualOrParent('c:\\some\\path', 'c:\\some', true));
			assert(isEqualOrParent('c:\\some\\path', 'c:\\some\\', true));
			assert(isEqualOrParent('c:\\someöäü\\path', 'c:\\someöäü', true));
			assert(isEqualOrParent('c:\\someöäü\\path', 'c:\\someöäü\\', true));
			assert(isEqualOrParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\bar', true));
			assert(isEqualOrParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\bar\\', true));
			assert(isEqualOrParent('c:\\some\\path', 'c:\\some\\path', true));
			assert(isEqualOrParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\bar\\test.ts', true));

			assert(isEqualOrParent('c:\\some\\path', 'C:\\', true));
			assert(isEqualOrParent('c:\\some\\path', 'c:\\SOME', true));
			assert(isEqualOrParent('c:\\some\\path', 'c:\\SOME\\', true));

			assert(!isEqualOrParent('c:\\some\\path', 'd:\\', true));
			assert(!isEqualOrParent('c:\\some\\path', 'd:\\some\\path', true));
			assert(!isEqualOrParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\barr', true));
			assert(!isEqualOrParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\bar\\test', true));
			assert(!isEqualOrParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\bar\\test.', true));
			assert(!isEqualOrParent('c:\\foo\\bar\\test.ts', 'c:\\foo\\BAR\\test.', true));
		}

		if (isMacintosh || isLinux) {
			assert(isEqualOrParent('/some/path', '/', true));
			assert(isEqualOrParent('/some/path', '/some', true));
			assert(isEqualOrParent('/some/path', '/some/', true));
			assert(isEqualOrParent('/someöäü/path', '/someöäü', true));
			assert(isEqualOrParent('/someöäü/path', '/someöäü/', true));
			assert(isEqualOrParent('/foo/bar/test.ts', '/foo/bar', true));
			assert(isEqualOrParent('/foo/bar/test.ts', '/foo/bar/', true));
			assert(isEqualOrParent('/some/path', '/some/path', true));

			assert(isEqualOrParent('/some/path', '/SOME', true));
			assert(isEqualOrParent('/some/path', '/SOME/', true));
			assert(isEqualOrParent('/someöäü/path', '/SOMEÖÄÜ', true));
			assert(isEqualOrParent('/someöäü/path', '/SOMEÖÄÜ/', true));

			assert(!isEqualOrParent('/foo/bar/test.ts', '/foo/barr', true));
			assert(!isEqualOrParent('/foo/bar/test.ts', '/foo/bar/test', true));
			assert(!isEqualOrParent('foo/bar/test.ts', 'foo/bar/test.', true));
			assert(!isEqualOrParent('foo/bar/test.ts', 'foo/BAR/test.', true));
		}
	});
});
