/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { hash, StringSHA1 } from 'vs/base/common/hash';
import { sha1Hex } from 'vs/base/browser/hash';

suite('Hash', () => {
	test('string', () => {
		assert.equal(hash('hello'), hash('hello'));
		assert.notEqual(hash('hello'), hash('world'));
		assert.notEqual(hash('hello'), hash('olleh'));
		assert.notEqual(hash('hello'), hash('Hello'));
		assert.notEqual(hash('hello'), hash('Hello '));
		assert.notEqual(hash('h'), hash('H'));
		assert.notEqual(hash('-'), hash('_'));
	});

	test('number', () => {
		assert.equal(hash(1), hash(1));
		assert.notEqual(hash(0), hash(1));
		assert.notEqual(hash(1), hash(-1));
		assert.notEqual(hash(0x12345678), hash(0x123456789));
	});

	test('boolean', () => {
		assert.equal(hash(true), hash(true));
		assert.notEqual(hash(true), hash(false));
	});

	test('array', () => {
		assert.equal(hash([1, 2, 3]), hash([1, 2, 3]));
		assert.equal(hash(['foo', 'bar']), hash(['foo', 'bar']));
		assert.equal(hash([]), hash([]));
		assert.equal(hash([]), hash(new Array()));
		assert.notEqual(hash(['foo', 'bar']), hash(['bar', 'foo']));
		assert.notEqual(hash(['foo', 'bar']), hash(['bar', 'foo', null]));
		assert.notEqual(hash(['foo', 'bar', null]), hash(['bar', 'foo', null]));
		assert.notEqual(hash(['foo', 'bar']), hash(['bar', 'foo', undefined]));
		assert.notEqual(hash(['foo', 'bar', undefined]), hash(['bar', 'foo', undefined]));
		assert.notEqual(hash(['foo', 'bar', null]), hash(['foo', 'bar', undefined]));
	});

	test('object', () => {
		assert.equal(hash({}), hash({}));
		assert.equal(hash({}), hash(Object.create(null)));
		assert.equal(hash({ 'foo': 'bar' }), hash({ 'foo': 'bar' }));
		assert.equal(hash({ 'foo': 'bar', 'foo2': undefined }), hash({ 'foo2': undefined, 'foo': 'bar' }));
		assert.notEqual(hash({ 'foo': 'bar' }), hash({ 'foo': 'bar2' }));
		assert.notEqual(hash({}), hash([]));
	});

	test('array - unexpected collision', function () {
		const a = hash([undefined, undefined, undefined, undefined, undefined]);
		const b = hash([undefined, undefined, 'HHHHHH', [{ line: 0, character: 0 }, { line: 0, character: 0 }], undefined]);
		assert.notEqual(a, b);
	});

	test('all different', () => {
		const candidates: any[] = [
			null, undefined, {}, [], 0, false, true, '', ' ', [null], [undefined], [undefined, undefined], { '': undefined }, { [' ']: undefined },
			'ab', 'ba', ['ab']
		];
		const hashes: number[] = candidates.map(hash);
		for (let i = 0; i < hashes.length; i++) {
			assert.equal(hashes[i], hash(candidates[i])); // verify that repeated invocation returns the same hash
			for (let k = i + 1; k < hashes.length; k++) {
				assert.notEqual(hashes[i], hashes[k], `Same hash ${hashes[i]} for ${JSON.stringify(candidates[i])} and ${JSON.stringify(candidates[k])}`);
			}
		}
	});


	async function checkSHA1(str: string, expected: string) {

		// Test with StringSHA1
		const hash = new StringSHA1();
		hash.update(str);
		let actual = hash.digest();
		assert.equal(actual, expected);

		// Test with crypto.subtle
		actual = await sha1Hex(str);
		assert.equal(actual, expected);
	}

	test('sha1-1', () => {
		return checkSHA1('\udd56', '9bdb77276c1852e1fb067820472812fcf6084024');
	});

	test('sha1-2', () => {
		return checkSHA1('\udb52', '9bdb77276c1852e1fb067820472812fcf6084024');
	});

	test('sha1-3', () => {
		return checkSHA1('\uda02ꑍ', '9b483a471f22fe7e09d83f221871a987244bbd3f');
	});

	test('sha1-4', () => {
		return checkSHA1('hello', 'aaf4c61ddcc5e8a2dabede0f3b482cd9aea9434d');
	});
});
