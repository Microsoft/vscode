/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SkipList } from 'vs/base/common/skipList';
import { StopWatch } from 'vs/base/common/stopwatch';
import { binarySearch } from 'vs/base/common/arrays';


suite('SkipList', function () {

	function assertValues<V>(list: SkipList<any, V>, expected: V[]) {
		assert.equal(list.size, expected.length);
		assert.deepEqual([...list.values()], expected);

		let valuesFromEntries = [...list.entries()].map(entry => entry[1]);
		assert.deepEqual(valuesFromEntries, expected);

		let valuesFromIter = [...list].map(entry => entry[1]);
		assert.deepEqual(valuesFromIter, expected);

		let i = 0;
		list.forEach((value, _key, map) => {
			assert.ok(map === list);
			assert.deepEqual(value, expected[i++]);
		});
	}

	function assertKeys<K>(list: SkipList<K, any>, expected: K[]) {
		assert.equal(list.size, expected.length);
		assert.deepEqual([...list.keys()], expected);

		let keysFromEntries = [...list.entries()].map(entry => entry[0]);
		assert.deepEqual(keysFromEntries, expected);

		let keysFromIter = [...list].map(entry => entry[0]);
		assert.deepEqual(keysFromIter, expected);

		let i = 0;
		list.forEach((_value, key, map) => {
			assert.ok(map === list);
			assert.deepEqual(key, expected[i++]);
		});
	}

	test('set/get/delete', function () {
		let list = new SkipList<number, number>((a, b) => a - b);

		assert.equal(list.get(3), undefined);
		list.set(3, 1);
		assert.equal(list.get(3), 1);
		assertValues(list, [1]);

		list.set(3, 3);
		assertValues(list, [3]);

		list.set(1, 1);
		list.set(4, 4);
		assert.equal(list.get(3), 3);
		assert.equal(list.get(1), 1);
		assert.equal(list.get(4), 4);
		assertValues(list, [1, 3, 4]);

		assert.equal(list.delete(17), false);

		assert.equal(list.delete(1), true);
		assert.equal(list.get(1), undefined);
		assert.equal(list.get(3), 3);
		assert.equal(list.get(4), 4);

		assertValues(list, [3, 4]);
	});

	test('Figure 3', function () {
		let list = new SkipList<number, boolean>((a, b) => a - b);
		list.set(3, true);
		list.set(6, true);
		list.set(7, true);
		list.set(9, true);
		list.set(12, true);
		list.set(19, true);
		list.set(21, true);
		list.set(25, true);

		assertKeys(list, [3, 6, 7, 9, 12, 19, 21, 25]);

		list.set(17, true);
		assert.deepEqual(list.size, 9);
		assertKeys(list, [3, 6, 7, 9, 12, 17, 19, 21, 25]);
	});

	test('capacity max', function () {
		let list = new SkipList<number, boolean>((a, b) => a - b, 10);
		list.set(1, true);
		list.set(2, true);
		list.set(3, true);
		list.set(4, true);
		list.set(5, true);
		list.set(6, true);
		list.set(7, true);
		list.set(8, true);
		list.set(9, true);
		list.set(10, true);
		list.set(11, true);
		list.set(12, true);

		assertKeys(list, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
	});

	const cmp = (a: number, b: number): number => {
		if (a < b) {
			return -1;
		} else if (a > b) {
			return 1;
		} else {
			return 0;
		}
	};

	function insertArraySorted(array: number[], element: number) {
		let idx = binarySearch(array, element, cmp);
		if (idx >= 0) {
			array[idx] = element;
		} else {
			idx = ~idx;
			// array = array.slice(0, idx).concat(element, array.slice(idx));
			array.splice(idx, 0, element);
		}
		return array;
	}

	function delArraySorted(array: number[], element: number) {
		let idx = binarySearch(array, element, cmp);
		if (idx >= 0) {
			// array = array.slice(0, idx).concat(array.slice(idx));
			array.splice(idx, 1);
		}
		return array;
	}


	test('perf', function () {
		this.skip();

		// data
		const max = 2 ** 16;
		const values = new Set<number>();
		for (let i = 0; i < max; i++) {
			let value = Math.floor(Math.random() * max);
			values.add(value);
		}
		console.log(values.size);

		// init
		let list = new SkipList<number, boolean>(cmp, max);
		let sw = new StopWatch(true);
		values.forEach(value => list.set(value, true));
		sw.stop();
		console.log(`[LIST] ${list.size} elements after ${sw.elapsed()}ms`);
		let array: number[] = [];
		sw = new StopWatch(true);
		values.forEach(value => array = insertArraySorted(array, value));
		sw.stop();
		console.log(`[ARRAY] ${array.length} elements after ${sw.elapsed()}ms`);

		// get
		sw = new StopWatch(true);
		let someValues = [...values].slice(0, values.size / 4);
		someValues.forEach(key => {
			let value = list.get(key); // find
			console.assert(value, '[LIST] must have ' + key);
			list.get(-key); // miss
		});
		sw.stop();
		console.log(`[LIST] retrieve ${sw.elapsed()}ms (${(sw.elapsed() / (someValues.length * 2)).toPrecision(4)}ms/op)`);
		sw = new StopWatch(true);
		someValues.forEach(key => {
			let idx = binarySearch(array, key, cmp); // find
			console.assert(idx >= 0, '[ARRAY] must have ' + key);
			binarySearch(array, -key, cmp); // miss
		});
		sw.stop();
		console.log(`[ARRAY] retrieve ${sw.elapsed()}ms (${(sw.elapsed() / (someValues.length * 2)).toPrecision(4)}ms/op)`);


		// insert
		sw = new StopWatch(true);
		someValues.forEach(key => {
			list.set(-key, false);
		});
		sw.stop();
		console.log(`[LIST] insert ${sw.elapsed()}ms (${(sw.elapsed() / someValues.length).toPrecision(4)}ms/op)`);
		sw = new StopWatch(true);
		someValues.forEach(key => {
			array = insertArraySorted(array, -key);
		});
		sw.stop();
		console.log(`[ARRAY] insert ${sw.elapsed()}ms (${(sw.elapsed() / someValues.length).toPrecision(4)}ms/op)`);

		// delete
		sw = new StopWatch(true);
		someValues.forEach(key => {
			list.delete(key); // find
			list.delete(-key); // miss
		});
		sw.stop();
		console.log(`[LIST] delete ${sw.elapsed()}ms (${(sw.elapsed() / (someValues.length * 2)).toPrecision(4)}ms/op)`);
		sw = new StopWatch(true);
		someValues.forEach(key => {
			array = delArraySorted(array, key); // find
			array = delArraySorted(array, -key); // miss
		});
		sw.stop();
		console.log(`[ARRAY] delete ${sw.elapsed()}ms (${(sw.elapsed() / (someValues.length * 2)).toPrecision(4)}ms/op)`);
	});
});
