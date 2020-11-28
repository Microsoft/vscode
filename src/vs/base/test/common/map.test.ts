/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceMap, TernarySearchTree, PathIterator, StringIterator, LinkedMap, Touch, LRUCache, UriIterator, ConfigKeysIterator } from 'vs/base/common/map';
import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { extUriIgnorePathCase } from 'vs/base/common/resources';

suite('Map', () => {

	test('LinkedMap - Simple', () => {
		let map = new LinkedMap<string, string>();
		map.set('ak', 'av');
		map.set('bk', 'bv');
		assert.deepStrictEqual([...map.keys()], ['ak', 'bk']);
		assert.deepStrictEqual([...map.values()], ['av', 'bv']);
		assert.equal(map.first, 'av');
		assert.equal(map.last, 'bv');
	});

	test('LinkedMap - Touch Old one', () => {
		let map = new LinkedMap<string, string>();
		map.set('ak', 'av');
		map.set('ak', 'av', Touch.AsOld);
		assert.deepStrictEqual([...map.keys()], ['ak']);
		assert.deepStrictEqual([...map.values()], ['av']);
	});

	test('LinkedMap - Touch New one', () => {
		let map = new LinkedMap<string, string>();
		map.set('ak', 'av');
		map.set('ak', 'av', Touch.AsNew);
		assert.deepStrictEqual([...map.keys()], ['ak']);
		assert.deepStrictEqual([...map.values()], ['av']);
	});

	test('LinkedMap - Touch Old two', () => {
		let map = new LinkedMap<string, string>();
		map.set('ak', 'av');
		map.set('bk', 'bv');
		map.set('bk', 'bv', Touch.AsOld);
		assert.deepStrictEqual([...map.keys()], ['bk', 'ak']);
		assert.deepStrictEqual([...map.values()], ['bv', 'av']);
	});

	test('LinkedMap - Touch New two', () => {
		let map = new LinkedMap<string, string>();
		map.set('ak', 'av');
		map.set('bk', 'bv');
		map.set('ak', 'av', Touch.AsNew);
		assert.deepStrictEqual([...map.keys()], ['bk', 'ak']);
		assert.deepStrictEqual([...map.values()], ['bv', 'av']);
	});

	test('LinkedMap - Touch Old from middle', () => {
		let map = new LinkedMap<string, string>();
		map.set('ak', 'av');
		map.set('bk', 'bv');
		map.set('ck', 'cv');
		map.set('bk', 'bv', Touch.AsOld);
		assert.deepStrictEqual([...map.keys()], ['bk', 'ak', 'ck']);
		assert.deepStrictEqual([...map.values()], ['bv', 'av', 'cv']);
	});

	test('LinkedMap - Touch New from middle', () => {
		let map = new LinkedMap<string, string>();
		map.set('ak', 'av');
		map.set('bk', 'bv');
		map.set('ck', 'cv');
		map.set('bk', 'bv', Touch.AsNew);
		assert.deepStrictEqual([...map.keys()], ['ak', 'ck', 'bk']);
		assert.deepStrictEqual([...map.values()], ['av', 'cv', 'bv']);
	});

	test('LinkedMap - basics', function () {
		const map = new LinkedMap<string, any>();

		assert.equal(map.size, 0);

		map.set('1', 1);
		map.set('2', '2');
		map.set('3', true);

		const obj = Object.create(null);
		map.set('4', obj);

		const date = Date.now();
		map.set('5', date);

		assert.equal(map.size, 5);
		assert.equal(map.get('1'), 1);
		assert.equal(map.get('2'), '2');
		assert.equal(map.get('3'), true);
		assert.equal(map.get('4'), obj);
		assert.equal(map.get('5'), date);
		assert.ok(!map.get('6'));

		map.delete('6');
		assert.equal(map.size, 5);
		assert.equal(map.delete('1'), true);
		assert.equal(map.delete('2'), true);
		assert.equal(map.delete('3'), true);
		assert.equal(map.delete('4'), true);
		assert.equal(map.delete('5'), true);

		assert.equal(map.size, 0);
		assert.ok(!map.get('5'));
		assert.ok(!map.get('4'));
		assert.ok(!map.get('3'));
		assert.ok(!map.get('2'));
		assert.ok(!map.get('1'));

		map.set('1', 1);
		map.set('2', '2');
		map.set('3', true);

		assert.ok(map.has('1'));
		assert.equal(map.get('1'), 1);
		assert.equal(map.get('2'), '2');
		assert.equal(map.get('3'), true);

		map.clear();

		assert.equal(map.size, 0);
		assert.ok(!map.get('1'));
		assert.ok(!map.get('2'));
		assert.ok(!map.get('3'));
		assert.ok(!map.has('1'));
	});

	test('LinkedMap - Iterators', () => {
		const map = new LinkedMap<number, any>();
		map.set(1, 1);
		map.set(2, 2);
		map.set(3, 3);

		for (const elem of map.keys()) {
			assert.ok(elem);
		}

		for (const elem of map.values()) {
			assert.ok(elem);
		}

		for (const elem of map.entries()) {
			assert.ok(elem);
		}

		{
			const keys = map.keys();
			const values = map.values();
			const entries = map.entries();
			map.get(1);
			keys.next();
			values.next();
			entries.next();
		}

		{
			const keys = map.keys();
			const values = map.values();
			const entries = map.entries();
			map.get(1, Touch.AsNew);

			let exceptions: number = 0;
			try {
				keys.next();
			} catch (err) {
				exceptions++;
			}
			try {
				values.next();
			} catch (err) {
				exceptions++;
			}
			try {
				entries.next();
			} catch (err) {
				exceptions++;
			}

			assert.strictEqual(exceptions, 3);
		}
	});

	test('LinkedMap - LRU Cache simple', () => {
		const cache = new LRUCache<number, number>(5);

		[1, 2, 3, 4, 5].forEach(value => cache.set(value, value));
		assert.strictEqual(cache.size, 5);
		cache.set(6, 6);
		assert.strictEqual(cache.size, 5);
		assert.deepStrictEqual([...cache.keys()], [2, 3, 4, 5, 6]);
		cache.set(7, 7);
		assert.strictEqual(cache.size, 5);
		assert.deepStrictEqual([...cache.keys()], [3, 4, 5, 6, 7]);
		let values: number[] = [];
		[3, 4, 5, 6, 7].forEach(key => values.push(cache.get(key)!));
		assert.deepStrictEqual(values, [3, 4, 5, 6, 7]);
	});

	test('LinkedMap - LRU Cache get', () => {
		const cache = new LRUCache<number, number>(5);

		[1, 2, 3, 4, 5].forEach(value => cache.set(value, value));
		assert.strictEqual(cache.size, 5);
		assert.deepStrictEqual([...cache.keys()], [1, 2, 3, 4, 5]);
		cache.get(3);
		assert.deepStrictEqual([...cache.keys()], [1, 2, 4, 5, 3]);
		cache.peek(4);
		assert.deepStrictEqual([...cache.keys()], [1, 2, 4, 5, 3]);
		let values: number[] = [];
		[1, 2, 3, 4, 5].forEach(key => values.push(cache.get(key)!));
		assert.deepStrictEqual(values, [1, 2, 3, 4, 5]);
	});

	test('LinkedMap - LRU Cache limit', () => {
		const cache = new LRUCache<number, number>(10);

		for (let i = 1; i <= 10; i++) {
			cache.set(i, i);
		}
		assert.strictEqual(cache.size, 10);
		cache.limit = 5;
		assert.strictEqual(cache.size, 5);
		assert.deepStrictEqual([...cache.keys()], [6, 7, 8, 9, 10]);
		cache.limit = 20;
		assert.strictEqual(cache.size, 5);
		for (let i = 11; i <= 20; i++) {
			cache.set(i, i);
		}
		assert.deepEqual(cache.size, 15);
		let values: number[] = [];
		for (let i = 6; i <= 20; i++) {
			values.push(cache.get(i)!);
			assert.strictEqual(cache.get(i), i);
		}
		assert.deepStrictEqual([...cache.values()], values);
	});

	test('LinkedMap - LRU Cache limit with ratio', () => {
		const cache = new LRUCache<number, number>(10, 0.5);

		for (let i = 1; i <= 10; i++) {
			cache.set(i, i);
		}
		assert.strictEqual(cache.size, 10);
		cache.set(11, 11);
		assert.strictEqual(cache.size, 5);
		assert.deepStrictEqual([...cache.keys()], [7, 8, 9, 10, 11]);
		let values: number[] = [];
		[...cache.keys()].forEach(key => values.push(cache.get(key)!));
		assert.deepStrictEqual(values, [7, 8, 9, 10, 11]);
		assert.deepStrictEqual([...cache.values()], values);
	});

	test('LinkedMap - toJSON / fromJSON', () => {
		let map = new LinkedMap<string, string>();
		map.set('ak', 'av');
		map.set('bk', 'bv');
		map.set('ck', 'cv');

		const json = map.toJSON();
		map = new LinkedMap<string, string>();
		map.fromJSON(json);

		let i = 0;
		map.forEach((value, key) => {
			if (i === 0) {
				assert.equal(key, 'ak');
				assert.equal(value, 'av');
			} else if (i === 1) {
				assert.equal(key, 'bk');
				assert.equal(value, 'bv');
			} else if (i === 2) {
				assert.equal(key, 'ck');
				assert.equal(value, 'cv');
			}
			i++;
		});
	});

	test('LinkedMap - delete Head and Tail', function () {
		const map = new LinkedMap<string, number>();

		assert.equal(map.size, 0);

		map.set('1', 1);
		assert.equal(map.size, 1);
		map.delete('1');
		assert.equal(map.get('1'), undefined);
		assert.equal(map.size, 0);
		assert.equal([...map.keys()].length, 0);
	});

	test('LinkedMap - delete Head', function () {
		const map = new LinkedMap<string, number>();

		assert.equal(map.size, 0);

		map.set('1', 1);
		map.set('2', 2);
		assert.equal(map.size, 2);
		map.delete('1');
		assert.equal(map.get('2'), 2);
		assert.equal(map.size, 1);
		assert.equal([...map.keys()].length, 1);
		assert.equal([...map.keys()][0], 2);
	});

	test('LinkedMap - delete Tail', function () {
		const map = new LinkedMap<string, number>();

		assert.equal(map.size, 0);

		map.set('1', 1);
		map.set('2', 2);
		assert.equal(map.size, 2);
		map.delete('2');
		assert.equal(map.get('1'), 1);
		assert.equal(map.size, 1);
		assert.equal([...map.keys()].length, 1);
		assert.equal([...map.keys()][0], 1);
	});


	test('PathIterator', () => {
		const iter = new PathIterator();
		iter.reset('file:///usr/bin/file.txt');

		assert.equal(iter.value(), 'file:');
		assert.equal(iter.hasNext(), true);
		assert.equal(iter.cmp('file:'), 0);
		assert.ok(iter.cmp('a') < 0);
		assert.ok(iter.cmp('aile:') < 0);
		assert.ok(iter.cmp('z') > 0);
		assert.ok(iter.cmp('zile:') > 0);

		iter.next();
		assert.equal(iter.value(), 'usr');
		assert.equal(iter.hasNext(), true);

		iter.next();
		assert.equal(iter.value(), 'bin');
		assert.equal(iter.hasNext(), true);

		iter.next();
		assert.equal(iter.value(), 'file.txt');
		assert.equal(iter.hasNext(), false);

		iter.next();
		assert.equal(iter.value(), '');
		assert.equal(iter.hasNext(), false);
		iter.next();
		assert.equal(iter.value(), '');
		assert.equal(iter.hasNext(), false);

		//
		iter.reset('/foo/bar/');
		assert.equal(iter.value(), 'foo');
		assert.equal(iter.hasNext(), true);

		iter.next();
		assert.equal(iter.value(), 'bar');
		assert.equal(iter.hasNext(), false);
	});

	test('URIIterator', function () {
		const iter = new UriIterator(() => false);
		iter.reset(URI.parse('file:///usr/bin/file.txt'));

		assert.equal(iter.value(), 'file');
		// assert.equal(iter.cmp('FILE'), 0);
		assert.equal(iter.cmp('file'), 0);
		assert.equal(iter.hasNext(), true);
		iter.next();

		assert.equal(iter.value(), 'usr');
		assert.equal(iter.hasNext(), true);
		iter.next();

		assert.equal(iter.value(), 'bin');
		assert.equal(iter.hasNext(), true);
		iter.next();

		assert.equal(iter.value(), 'file.txt');
		assert.equal(iter.hasNext(), false);


		iter.reset(URI.parse('file://share/usr/bin/file.txt?foo'));

		// scheme
		assert.equal(iter.value(), 'file');
		// assert.equal(iter.cmp('FILE'), 0);
		assert.equal(iter.cmp('file'), 0);
		assert.equal(iter.hasNext(), true);
		iter.next();

		// authority
		assert.equal(iter.value(), 'share');
		assert.equal(iter.cmp('SHARe'), 0);
		assert.equal(iter.hasNext(), true);
		iter.next();

		// path
		assert.equal(iter.value(), 'usr');
		assert.equal(iter.hasNext(), true);
		iter.next();

		// path
		assert.equal(iter.value(), 'bin');
		assert.equal(iter.hasNext(), true);
		iter.next();

		// path
		assert.equal(iter.value(), 'file.txt');
		assert.equal(iter.hasNext(), true);
		iter.next();

		// query
		assert.equal(iter.value(), 'foo');
		assert.equal(iter.cmp('z') > 0, true);
		assert.equal(iter.cmp('a') < 0, true);
		assert.equal(iter.hasNext(), false);
	});

	function assertTernarySearchTree<E>(trie: TernarySearchTree<string, E>, ...elements: [string, E][]) {
		const map = new Map<string, E>();
		for (const [key, value] of elements) {
			map.set(key, value);
		}
		map.forEach((value, key) => {
			assert.equal(trie.get(key), value);
		});

		// forEach
		let forEachCount = 0;
		trie.forEach((element, key) => {
			assert.equal(element, map.get(key));
			forEachCount++;
		});
		assert.equal(map.size, forEachCount);

		// iterator
		let iterCount = 0;
		for (let [key, value] of trie) {
			assert.equal(value, map.get(key));
			iterCount++;
		}
		assert.equal(map.size, iterCount);
	}

	test('TernarySearchTree - set', function () {

		let trie = TernarySearchTree.forStrings<number>();
		trie.set('foobar', 1);
		trie.set('foobaz', 2);

		assertTernarySearchTree(trie, ['foobar', 1], ['foobaz', 2]); // longer

		trie = TernarySearchTree.forStrings<number>();
		trie.set('foobar', 1);
		trie.set('fooba', 2);
		assertTernarySearchTree(trie, ['foobar', 1], ['fooba', 2]); // shorter

		trie = TernarySearchTree.forStrings<number>();
		trie.set('foo', 1);
		trie.set('foo', 2);
		assertTernarySearchTree(trie, ['foo', 2]);

		trie = TernarySearchTree.forStrings<number>();
		trie.set('foo', 1);
		trie.set('foobar', 2);
		trie.set('bar', 3);
		trie.set('foob', 4);
		trie.set('bazz', 5);

		assertTernarySearchTree(trie,
			['foo', 1],
			['foobar', 2],
			['bar', 3],
			['foob', 4],
			['bazz', 5]
		);
	});

	test('TernarySearchTree - findLongestMatch', function () {

		let trie = TernarySearchTree.forStrings<number>();
		trie.set('foo', 1);
		trie.set('foobar', 2);
		trie.set('foobaz', 3);

		assert.equal(trie.findSubstr('f'), undefined);
		assert.equal(trie.findSubstr('z'), undefined);
		assert.equal(trie.findSubstr('foo'), 1);
		assert.equal(trie.findSubstr('fooö'), 1);
		assert.equal(trie.findSubstr('fooba'), 1);
		assert.equal(trie.findSubstr('foobarr'), 2);
		assert.equal(trie.findSubstr('foobazrr'), 3);
	});

	test('TernarySearchTree - basics', function () {
		let trie = new TernarySearchTree<string, number>(new StringIterator());

		trie.set('foo', 1);
		trie.set('bar', 2);
		trie.set('foobar', 3);

		assert.equal(trie.get('foo'), 1);
		assert.equal(trie.get('bar'), 2);
		assert.equal(trie.get('foobar'), 3);
		assert.equal(trie.get('foobaz'), undefined);
		assert.equal(trie.get('foobarr'), undefined);

		assert.equal(trie.findSubstr('fo'), undefined);
		assert.equal(trie.findSubstr('foo'), 1);
		assert.equal(trie.findSubstr('foooo'), 1);


		trie.delete('foobar');
		trie.delete('bar');
		assert.equal(trie.get('foobar'), undefined);
		assert.equal(trie.get('bar'), undefined);

		trie.set('foobar', 17);
		trie.set('barr', 18);
		assert.equal(trie.get('foobar'), 17);
		assert.equal(trie.get('barr'), 18);
		assert.equal(trie.get('bar'), undefined);
	});

	test('TernarySearchTree - delete & cleanup', function () {
		// normal delete
		let trie = new TernarySearchTree<string, number>(new StringIterator());
		trie.set('foo', 1);
		trie.set('foobar', 2);
		trie.set('bar', 3);
		assertTernarySearchTree(trie, ['foo', 1], ['foobar', 2], ['bar', 3]);
		trie.delete('foo');
		assertTernarySearchTree(trie, ['foobar', 2], ['bar', 3]);
		trie.delete('foobar');
		assertTernarySearchTree(trie, ['bar', 3]);

		// superstr-delete
		trie = new TernarySearchTree<string, number>(new StringIterator());
		trie.set('foo', 1);
		trie.set('foobar', 2);
		trie.set('bar', 3);
		trie.set('foobarbaz', 4);
		trie.deleteSuperstr('foo');
		assertTernarySearchTree(trie, ['foo', 1], ['bar', 3]);

		trie = new TernarySearchTree<string, number>(new StringIterator());
		trie.set('foo', 1);
		trie.set('foobar', 2);
		trie.set('bar', 3);
		trie.set('foobarbaz', 4);
		trie.deleteSuperstr('fo');
		assertTernarySearchTree(trie, ['bar', 3]);

		// trie = new TernarySearchTree<string, number>(new StringIterator());
		// trie.set('foo', 1);
		// trie.set('foobar', 2);
		// trie.set('bar', 3);
		// trie.deleteSuperStr('f');
		// assertTernarySearchTree(trie, ['bar', 3]);
	});

	test('TernarySearchTree (PathSegments) - basics', function () {
		let trie = new TernarySearchTree<string, number>(new PathIterator());

		trie.set('/user/foo/bar', 1);
		trie.set('/user/foo', 2);
		trie.set('/user/foo/flip/flop', 3);

		assert.equal(trie.get('/user/foo/bar'), 1);
		assert.equal(trie.get('/user/foo'), 2);
		assert.equal(trie.get('/user//foo'), 2);
		assert.equal(trie.get('/user\\foo'), 2);
		assert.equal(trie.get('/user/foo/flip/flop'), 3);

		assert.equal(trie.findSubstr('/user/bar'), undefined);
		assert.equal(trie.findSubstr('/user/foo'), 2);
		assert.equal(trie.findSubstr('\\user\\foo'), 2);
		assert.equal(trie.findSubstr('/user//foo'), 2);
		assert.equal(trie.findSubstr('/user/foo/ba'), 2);
		assert.equal(trie.findSubstr('/user/foo/far/boo'), 2);
		assert.equal(trie.findSubstr('/user/foo/bar'), 1);
		assert.equal(trie.findSubstr('/user/foo/bar/far/boo'), 1);
	});

	test('TernarySearchTree (PathSegments) - lookup', function () {

		const map = new TernarySearchTree<string, number>(new PathIterator());
		map.set('/user/foo/bar', 1);
		map.set('/user/foo', 2);
		map.set('/user/foo/flip/flop', 3);

		assert.equal(map.get('/foo'), undefined);
		assert.equal(map.get('/user'), undefined);
		assert.equal(map.get('/user/foo'), 2);
		assert.equal(map.get('/user/foo/bar'), 1);
		assert.equal(map.get('/user/foo/bar/boo'), undefined);
	});

	test('TernarySearchTree (PathSegments) - superstr', function () {

		const map = new TernarySearchTree<string, number>(new PathIterator());
		map.set('/user/foo/bar', 1);
		map.set('/user/foo', 2);
		map.set('/user/foo/flip/flop', 3);
		map.set('/usr/foo', 4);

		let item: IteratorResult<[string, number]>;
		let iter = map.findSuperstr('/user');

		item = iter!.next();
		assert.equal(item.value[1], 2);
		assert.equal(item.done, false);
		item = iter!.next();
		assert.equal(item.value[1], 1);
		assert.equal(item.done, false);
		item = iter!.next();
		assert.equal(item.value[1], 3);
		assert.equal(item.done, false);
		item = iter!.next();
		assert.equal(item.value, undefined);
		assert.equal(item.done, true);

		iter = map.findSuperstr('/usr');
		item = iter!.next();
		assert.equal(item.value[1], 4);
		assert.equal(item.done, false);

		item = iter!.next();
		assert.equal(item.value, undefined);
		assert.equal(item.done, true);

		assert.equal(map.findSuperstr('/not'), undefined);
		assert.equal(map.findSuperstr('/us'), undefined);
		assert.equal(map.findSuperstr('/usrr'), undefined);
		assert.equal(map.findSuperstr('/userr'), undefined);
	});


	test('TernarySearchTree (PathSegments) - delete_superstr', function () {

		const map = new TernarySearchTree<string, number>(new PathIterator());
		map.set('/user/foo/bar', 1);
		map.set('/user/foo', 2);
		map.set('/user/foo/flip/flop', 3);
		map.set('/usr/foo', 4);

		assertTernarySearchTree(map,
			['/user/foo/bar', 1],
			['/user/foo', 2],
			['/user/foo/flip/flop', 3],
			['/usr/foo', 4],
		);

		// not a segment
		map.deleteSuperstr('/user/fo');
		assertTernarySearchTree(map,
			['/user/foo/bar', 1],
			['/user/foo', 2],
			['/user/foo/flip/flop', 3],
			['/usr/foo', 4],
		);

		// delete a segment
		map.set('/user/foo/bar', 1);
		map.set('/user/foo', 2);
		map.set('/user/foo/flip/flop', 3);
		map.set('/usr/foo', 4);
		map.deleteSuperstr('/user/foo');
		assertTernarySearchTree(map,
			['/user/foo', 2], ['/usr/foo', 4],
		);
	});

	test('TernarySearchTree (URI) - basics', function () {
		let trie = new TernarySearchTree<URI, number>(new UriIterator(() => false));

		trie.set(URI.file('/user/foo/bar'), 1);
		trie.set(URI.file('/user/foo'), 2);
		trie.set(URI.file('/user/foo/flip/flop'), 3);

		assert.equal(trie.get(URI.file('/user/foo/bar')), 1);
		assert.equal(trie.get(URI.file('/user/foo')), 2);
		assert.equal(trie.get(URI.file('/user/foo/flip/flop')), 3);

		assert.equal(trie.findSubstr(URI.file('/user/bar')), undefined);
		assert.equal(trie.findSubstr(URI.file('/user/foo')), 2);
		assert.equal(trie.findSubstr(URI.file('/user/foo/ba')), 2);
		assert.equal(trie.findSubstr(URI.file('/user/foo/far/boo')), 2);
		assert.equal(trie.findSubstr(URI.file('/user/foo/bar')), 1);
		assert.equal(trie.findSubstr(URI.file('/user/foo/bar/far/boo')), 1);
	});

	test('TernarySearchTree (URI) - lookup', function () {

		const map = new TernarySearchTree<URI, number>(new UriIterator(() => false));
		map.set(URI.parse('http://foo.bar/user/foo/bar'), 1);
		map.set(URI.parse('http://foo.bar/user/foo?query'), 2);
		map.set(URI.parse('http://foo.bar/user/foo?QUERY'), 3);
		map.set(URI.parse('http://foo.bar/user/foo/flip/flop'), 3);

		assert.equal(map.get(URI.parse('http://foo.bar/foo')), undefined);
		assert.equal(map.get(URI.parse('http://foo.bar/user')), undefined);
		assert.equal(map.get(URI.parse('http://foo.bar/user/foo/bar')), 1);
		assert.equal(map.get(URI.parse('http://foo.bar/user/foo?query')), 2);
		assert.equal(map.get(URI.parse('http://foo.bar/user/foo?Query')), undefined);
		assert.equal(map.get(URI.parse('http://foo.bar/user/foo?QUERY')), 3);
		assert.equal(map.get(URI.parse('http://foo.bar/user/foo/bar/boo')), undefined);
	});

	test('TernarySearchTree (URI) - lookup, casing', function () {

		const map = new TernarySearchTree<URI, number>(new UriIterator(uri => /^https?$/.test(uri.scheme)));
		map.set(URI.parse('http://foo.bar/user/foo/bar'), 1);
		assert.equal(map.get(URI.parse('http://foo.bar/USER/foo/bar')), 1);

		map.set(URI.parse('foo://foo.bar/user/foo/bar'), 1);
		assert.equal(map.get(URI.parse('foo://foo.bar/USER/foo/bar')), undefined);
	});

	test('TernarySearchTree (URI) - superstr', function () {

		const map = new TernarySearchTree<URI, number>(new UriIterator(() => false));
		map.set(URI.file('/user/foo/bar'), 1);
		map.set(URI.file('/user/foo'), 2);
		map.set(URI.file('/user/foo/flip/flop'), 3);
		map.set(URI.file('/usr/foo'), 4);

		let item: IteratorResult<[URI, number]>;
		let iter = map.findSuperstr(URI.file('/user'))!;

		item = iter.next();
		assert.equal(item.value[1], 2);
		assert.equal(item.done, false);
		item = iter.next();
		assert.equal(item.value[1], 1);
		assert.equal(item.done, false);
		item = iter.next();
		assert.equal(item.value[1], 3);
		assert.equal(item.done, false);
		item = iter.next();
		assert.equal(item.value, undefined);
		assert.equal(item.done, true);

		iter = map.findSuperstr(URI.file('/usr'))!;
		item = iter.next();
		assert.equal(item.value[1], 4);
		assert.equal(item.done, false);

		item = iter.next();
		assert.equal(item.value, undefined);
		assert.equal(item.done, true);

		iter = map.findSuperstr(URI.file('/'))!;
		item = iter.next();
		assert.equal(item.value[1], 2);
		assert.equal(item.done, false);
		item = iter.next();
		assert.equal(item.value[1], 1);
		assert.equal(item.done, false);
		item = iter.next();
		assert.equal(item.value[1], 3);
		assert.equal(item.done, false);
		item = iter.next();
		assert.equal(item.value[1], 4);
		assert.equal(item.done, false);
		item = iter.next();
		assert.equal(item.value, undefined);
		assert.equal(item.done, true);

		assert.equal(map.findSuperstr(URI.file('/not')), undefined);
		assert.equal(map.findSuperstr(URI.file('/us')), undefined);
		assert.equal(map.findSuperstr(URI.file('/usrr')), undefined);
		assert.equal(map.findSuperstr(URI.file('/userr')), undefined);
	});

	test('TernarySearchTree (ConfigKeySegments) - basics', function () {
		let trie = new TernarySearchTree<string, number>(new ConfigKeysIterator());

		trie.set('config.foo.bar', 1);
		trie.set('config.foo', 2);
		trie.set('config.foo.flip.flop', 3);

		assert.equal(trie.get('config.foo.bar'), 1);
		assert.equal(trie.get('config.foo'), 2);
		assert.equal(trie.get('config.foo.flip.flop'), 3);

		assert.equal(trie.findSubstr('config.bar'), undefined);
		assert.equal(trie.findSubstr('config.foo'), 2);
		assert.equal(trie.findSubstr('config.foo.ba'), 2);
		assert.equal(trie.findSubstr('config.foo.far.boo'), 2);
		assert.equal(trie.findSubstr('config.foo.bar'), 1);
		assert.equal(trie.findSubstr('config.foo.bar.far.boo'), 1);
	});

	test('TernarySearchTree (ConfigKeySegments) - lookup', function () {

		const map = new TernarySearchTree<string, number>(new ConfigKeysIterator());
		map.set('config.foo.bar', 1);
		map.set('config.foo', 2);
		map.set('config.foo.flip.flop', 3);

		assert.equal(map.get('foo'), undefined);
		assert.equal(map.get('config'), undefined);
		assert.equal(map.get('config.foo'), 2);
		assert.equal(map.get('config.foo.bar'), 1);
		assert.equal(map.get('config.foo.bar.boo'), undefined);
	});

	test('TernarySearchTree (ConfigKeySegments) - superstr', function () {

		const map = new TernarySearchTree<string, number>(new ConfigKeysIterator());
		map.set('config.foo.bar', 1);
		map.set('config.foo', 2);
		map.set('config.foo.flip.flop', 3);
		map.set('boo', 4);

		let item: IteratorResult<[string, number]>;
		let iter = map.findSuperstr('config');

		item = iter!.next();
		assert.equal(item.value[1], 2);
		assert.equal(item.done, false);
		item = iter!.next();
		assert.equal(item.value[1], 1);
		assert.equal(item.done, false);
		item = iter!.next();
		assert.equal(item.value[1], 3);
		assert.equal(item.done, false);
		item = iter!.next();
		assert.equal(item.value, undefined);
		assert.equal(item.done, true);

		assert.equal(map.findSuperstr('foo'), undefined);
		assert.equal(map.findSuperstr('config.foo.no'), undefined);
		assert.equal(map.findSuperstr('config.foop'), undefined);
	});


	test('TernarySearchTree (ConfigKeySegments) - delete_superstr', function () {

		const map = new TernarySearchTree<string, number>(new ConfigKeysIterator());
		map.set('config.foo.bar', 1);
		map.set('config.foo', 2);
		map.set('config.foo.flip.flop', 3);
		map.set('boo', 4);

		assertTernarySearchTree(map,
			['config.foo.bar', 1],
			['config.foo', 2],
			['config.foo.flip.flop', 3],
			['boo', 4],
		);

		// not a segment
		map.deleteSuperstr('config.fo');
		assertTernarySearchTree(map,
			['config.foo.bar', 1],
			['config.foo', 2],
			['config.foo.flip.flop', 3],
			['boo', 4],
		);

		// delete a segment
		map.set('config.foo.bar', 1);
		map.set('config.foo', 2);
		map.set('config.foo.flip.flop', 3);
		map.set('config.boo', 4);
		map.deleteSuperstr('config.foo');
		assertTernarySearchTree(map,
			['config.foo', 2], ['boo', 4],
		);
	});

	test('ResourceMap - basics', function () {
		const map = new ResourceMap<any>();

		const resource1 = URI.parse('some://1');
		const resource2 = URI.parse('some://2');
		const resource3 = URI.parse('some://3');
		const resource4 = URI.parse('some://4');
		const resource5 = URI.parse('some://5');
		const resource6 = URI.parse('some://6');

		assert.equal(map.size, 0);

		let res = map.set(resource1, 1);
		assert.ok(res === map);
		map.set(resource2, '2');
		map.set(resource3, true);

		const values = [...map.values()];
		assert.equal(values[0], 1);
		assert.equal(values[1], '2');
		assert.equal(values[2], true);

		let counter = 0;
		map.forEach((value, key, mapObj) => {
			assert.equal(value, values[counter++]);
			assert.ok(URI.isUri(key));
			assert.ok(map === mapObj);
		});

		const obj = Object.create(null);
		map.set(resource4, obj);

		const date = Date.now();
		map.set(resource5, date);

		assert.equal(map.size, 5);
		assert.equal(map.get(resource1), 1);
		assert.equal(map.get(resource2), '2');
		assert.equal(map.get(resource3), true);
		assert.equal(map.get(resource4), obj);
		assert.equal(map.get(resource5), date);
		assert.ok(!map.get(resource6));

		map.delete(resource6);
		assert.equal(map.size, 5);
		assert.ok(map.delete(resource1));
		assert.ok(map.delete(resource2));
		assert.ok(map.delete(resource3));
		assert.ok(map.delete(resource4));
		assert.ok(map.delete(resource5));

		assert.equal(map.size, 0);
		assert.ok(!map.get(resource5));
		assert.ok(!map.get(resource4));
		assert.ok(!map.get(resource3));
		assert.ok(!map.get(resource2));
		assert.ok(!map.get(resource1));

		map.set(resource1, 1);
		map.set(resource2, '2');
		map.set(resource3, true);

		assert.ok(map.has(resource1));
		assert.equal(map.get(resource1), 1);
		assert.equal(map.get(resource2), '2');
		assert.equal(map.get(resource3), true);

		map.clear();

		assert.equal(map.size, 0);
		assert.ok(!map.get(resource1));
		assert.ok(!map.get(resource2));
		assert.ok(!map.get(resource3));
		assert.ok(!map.has(resource1));

		map.set(resource1, false);
		map.set(resource2, 0);

		assert.ok(map.has(resource1));
		assert.ok(map.has(resource2));
	});

	test('ResourceMap - files (do NOT ignorecase)', function () {
		const map = new ResourceMap<any>();

		const fileA = URI.parse('file://some/filea');
		const fileB = URI.parse('some://some/other/fileb');
		const fileAUpper = URI.parse('file://SOME/FILEA');

		map.set(fileA, 'true');
		assert.equal(map.get(fileA), 'true');

		assert.ok(!map.get(fileAUpper));

		assert.ok(!map.get(fileB));

		map.set(fileAUpper, 'false');
		assert.equal(map.get(fileAUpper), 'false');

		assert.equal(map.get(fileA), 'true');

		const windowsFile = URI.file('c:\\test with %25\\c#code');
		const uncFile = URI.file('\\\\shäres\\path\\c#\\plugin.json');

		map.set(windowsFile, 'true');
		map.set(uncFile, 'true');

		assert.equal(map.get(windowsFile), 'true');
		assert.equal(map.get(uncFile), 'true');
	});

	test('ResourceMap - files (ignorecase)', function () {
		const map = new ResourceMap<any>(uri => extUriIgnorePathCase.getComparisonKey(uri));

		const fileA = URI.parse('file://some/filea');
		const fileB = URI.parse('some://some/other/fileb');
		const fileAUpper = URI.parse('file://SOME/FILEA');

		map.set(fileA, 'true');
		assert.equal(map.get(fileA), 'true');

		assert.equal(map.get(fileAUpper), 'true');

		assert.ok(!map.get(fileB));

		map.set(fileAUpper, 'false');
		assert.equal(map.get(fileAUpper), 'false');

		assert.equal(map.get(fileA), 'false');

		const windowsFile = URI.file('c:\\test with %25\\c#code');
		const uncFile = URI.file('\\\\shäres\\path\\c#\\plugin.json');

		map.set(windowsFile, 'true');
		map.set(uncFile, 'true');

		assert.equal(map.get(windowsFile), 'true');
		assert.equal(map.get(uncFile), 'true');
	});
});
