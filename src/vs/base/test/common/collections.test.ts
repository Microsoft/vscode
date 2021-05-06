/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as collections from 'vs/base/common/collections';

suite('Collections', () => {

	test('forEach', () => {
		collections.forEach({}, () => assert(false));
		collections.forEach(Object.create(null), () => assert(false));

		let count = 0;
		collections.forEach({ toString: 123 }, () => count++);
		assert.strictEqual(count, 1);

		count = 0;
		let dict = Object.create(null);
		dict['toString'] = 123;
		collections.forEach(dict, () => count++);
		assert.strictEqual(count, 1);

		collections.forEach(dict, () => false);

		collections.forEach(dict, (x, remove) => remove());
		assert.strictEqual(dict['toString'], undefined);

		// don't iterate over properties that are not on the object itself
		let test = Object.create({ 'derived': true });
		collections.forEach(test, () => assert(false));
	});

	test('groupBy', () => {

		const group1 = 'a', group2 = 'b';
		const value1 = 1, value2 = 2, value3 = 3;
		let source = [
			{ key: group1, value: value1 },
			{ key: group1, value: value2 },
			{ key: group2, value: value3 },
		];

		let grouped = collections.groupBy(source, x => x.key);

		// Group 1
		assert.strictEqual(grouped[group1].length, 2);
		assert.strictEqual(grouped[group1][0].value, value1);
		assert.strictEqual(grouped[group1][1].value, value2);

		// Group 2
		assert.strictEqual(grouped[group2].length, 1);
		assert.strictEqual(grouped[group2][0].value, value3);
	});

	test('groupByNumber', () => {

		const group1 = 1, group2 = 2;
		const value1 = 'a', value2 = 'b', value3 = 'c';
		let source = [
			{ key: group1, value: value1 },
			{ key: group1, value: value2 },
			{ key: group2, value: value3 },
		];

		let grouped = collections.groupByNumber(source, x => x.key);

		// Group 1
		assert.strictEqual(grouped.get(group1)!.length, 2);
		assert.strictEqual(grouped.get(group1)![0].value, value1);
		assert.strictEqual(grouped.get(group1)![1].value, value2);

		// Group 2
		assert.strictEqual(grouped.get(group2)!.length, 1);
		assert.strictEqual(grouped.get(group2)![0].value, value3);
	});
});
