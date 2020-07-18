/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import 'mocha';
import * as assert from 'assert';
import { joinPath, normalizePath, resolvePath, extname } from '../requests';

suite('requests', () => {
	test('join', async function () {
		assert.equal(joinPath('foo://a/foo/bar', 'x'), 'foo://a/foo/bar/x');
		assert.equal(joinPath('foo://a/foo/bar/', 'x'), 'foo://a/foo/bar/x');
		assert.equal(joinPath('foo://a/foo/bar/', '/x'), 'foo://a/foo/bar/x');
		assert.equal(joinPath('foo://a/foo/bar/', 'x/'), 'foo://a/foo/bar/x/');
		assert.equal(joinPath('foo://a/foo/bar/', 'x', 'y'), 'foo://a/foo/bar/x/y');
		assert.equal(joinPath('foo://a/foo/bar/', 'x/', '/y'), 'foo://a/foo/bar/x/y');
		assert.equal(joinPath('foo://a/foo/bar/', '.', '/y'), 'foo://a/foo/bar/y');
		assert.equal(joinPath('foo://a/foo/bar/', 'x/y/z', '..'), 'foo://a/foo/bar/x/y');
	});

	test('resolve', async function () {
		assert.equal(resolvePath('foo://a/foo/bar', 'x'), 'foo://a/foo/bar/x');
		assert.equal(resolvePath('foo://a/foo/bar/', 'x'), 'foo://a/foo/bar/x');
		assert.equal(resolvePath('foo://a/foo/bar/', '/x'), 'foo://a/x');
		assert.equal(resolvePath('foo://a/foo/bar/', 'x/'), 'foo://a/foo/bar/x/');
	});

	test('normalize', async function () {
		function assertNormalize(path: string, expected: string) {
			assert.equal(normalizePath(path.split('/')), expected, path);
		}
		assertNormalize('a', 'a');
		assertNormalize('/a', '/a');
		assertNormalize('a/', 'a/');
		assertNormalize('a/b', 'a/b');
		assertNormalize('/a/foo/bar/x', '/a/foo/bar/x');
		assertNormalize('/a/foo/bar//x', '/a/foo/bar/x');
		assertNormalize('/a/foo/bar///x', '/a/foo/bar/x');
		assertNormalize('/a/foo/bar/x/', '/a/foo/bar/x/');
		assertNormalize('a/foo/bar/x/', 'a/foo/bar/x/');
		assertNormalize('a/foo/bar/x//', 'a/foo/bar/x/');
		assertNormalize('//a/foo/bar/x//', '/a/foo/bar/x/');
		assertNormalize('a/.', 'a');
		assertNormalize('a/./b', 'a/b');
		assertNormalize('a/././b', 'a/b');
		assertNormalize('a/n/../b', 'a/b');
		assertNormalize('a/n/../', 'a/');
		assertNormalize('a/n/../', 'a/');
		assertNormalize('/a/n/../..', '/');
		assertNormalize('..', '');
		assertNormalize('/..', '/');
	});

	test('extname', async function () {
		function assertExtName(input: string, expected: string) {
			assert.equal(extname(input), expected, input);
		}
		assertExtName('foo://a/foo/bar', '');
		assertExtName('foo://a/foo/bar.foo', '.foo');
		assertExtName('foo://a/foo/.foo', '');
	});
});
