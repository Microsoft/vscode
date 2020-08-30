/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ResourceTree } from 'vs/base/common/resourceTree';
import { URI } from 'vs/base/common/uri';

suite('ResourceTree', function () {
	test('ctor', function () {
		const tree = new ResourceTree<string, null>(null);
		assert.equal(tree.root.childrenCount, 0);
	});

	test('simple', function () {
		const tree = new ResourceTree<string, null>(null);

		tree.add(URI.file('/foo/bar.txt'), 'bar contents');
		assert.equal(tree.root.childrenCount, 1);

		let foo = tree.root.get('foo')!;
		assert(foo);
		assert.equal(foo.childrenCount, 1);

		let bar = foo.get('bar.txt')!;
		assert(bar);
		assert.equal(bar.element, 'bar contents');

		tree.add(URI.file('/hello.txt'), 'hello contents');
		assert.equal(tree.root.childrenCount, 2);

		let hello = tree.root.get('hello.txt')!;
		assert(hello);
		assert.equal(hello.element, 'hello contents');

		tree.delete(URI.file('/foo/bar.txt'));
		assert.equal(tree.root.childrenCount, 1);
		hello = tree.root.get('hello.txt')!;
		assert(hello);
		assert.equal(hello.element, 'hello contents');
	});

	test('folders with data', function () {
		const tree = new ResourceTree<string, null>(null);

		assert.equal(tree.root.childrenCount, 0);

		tree.add(URI.file('/foo'), 'foo');
		assert.equal(tree.root.childrenCount, 1);
		assert.equal(tree.root.get('foo')!.element, 'foo');

		tree.add(URI.file('/bar'), 'bar');
		assert.equal(tree.root.childrenCount, 2);
		assert.equal(tree.root.get('bar')!.element, 'bar');

		tree.add(URI.file('/foo/file.txt'), 'file');
		assert.equal(tree.root.childrenCount, 2);
		assert.equal(tree.root.get('foo')!.element, 'foo');
		assert.equal(tree.root.get('bar')!.element, 'bar');
		assert.equal(tree.root.get('foo')!.get('file.txt')!.element, 'file');

		tree.delete(URI.file('/foo'));
		assert.equal(tree.root.childrenCount, 1);
		assert(!tree.root.get('foo'));
		assert.equal(tree.root.get('bar')!.element, 'bar');

		tree.delete(URI.file('/bar'));
		assert.equal(tree.root.childrenCount, 0);
		assert(!tree.root.get('foo'));
		assert(!tree.root.get('bar'));
	});
});
