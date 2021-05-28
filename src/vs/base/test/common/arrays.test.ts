/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import * as arrays from 'vs/base/common/arrays';

suite('Arrays', () => {
	test('findFirst', () => {
		const array = [1, 4, 5, 7, 55, 59, 60, 61, 64, 69];

		let idx = arrays.findFirstInSorted(array, e => e >= 0);
		assert.strictEqual(array[idx], 1);

		idx = arrays.findFirstInSorted(array, e => e > 1);
		assert.strictEqual(array[idx], 4);

		idx = arrays.findFirstInSorted(array, e => e >= 8);
		assert.strictEqual(array[idx], 55);

		idx = arrays.findFirstInSorted(array, e => e >= 61);
		assert.strictEqual(array[idx], 61);

		idx = arrays.findFirstInSorted(array, e => e >= 69);
		assert.strictEqual(array[idx], 69);

		idx = arrays.findFirstInSorted(array, e => e >= 70);
		assert.strictEqual(idx, array.length);

		idx = arrays.findFirstInSorted([], e => e >= 0);
		assert.strictEqual(array[idx], 1);
	});

	test('quickSelect', () => {

		function assertMedian(expexted: number, data: number[], nth: number = Math.floor(data.length / 2)) {
			const compare = (a: number, b: number) => a - b;
			let actual1 = arrays.quickSelect(nth, data, compare);
			assert.strictEqual(actual1, expexted);

			let actual2 = data.slice().sort(compare)[nth];
			assert.strictEqual(actual2, expexted);
		}

		assertMedian(5, [9, 1, 0, 2, 3, 4, 6, 8, 7, 10, 5]);
		assertMedian(8, [9, 1, 0, 2, 3, 4, 6, 8, 7, 10, 5], 8);
		assertMedian(8, [13, 4, 8]);
		assertMedian(4, [13, 4, 8, 4, 4]);
		assertMedian(13, [13, 4, 8], 2);
	});

	test('sortedDiff', () => {
		function compare(a: number, b: number): number {
			return a - b;
		}

		let d = arrays.sortedDiff([1, 2, 4], [], compare);
		assert.deepStrictEqual(d, [
			{ start: 0, deleteCount: 3, toInsert: [] }
		]);

		d = arrays.sortedDiff([], [1, 2, 4], compare);
		assert.deepStrictEqual(d, [
			{ start: 0, deleteCount: 0, toInsert: [1, 2, 4] }
		]);

		d = arrays.sortedDiff([1, 2, 4], [1, 2, 4], compare);
		assert.deepStrictEqual(d, []);

		d = arrays.sortedDiff([1, 2, 4], [2, 3, 4, 5], compare);
		assert.deepStrictEqual(d, [
			{ start: 0, deleteCount: 1, toInsert: [] },
			{ start: 2, deleteCount: 0, toInsert: [3] },
			{ start: 3, deleteCount: 0, toInsert: [5] },
		]);

		d = arrays.sortedDiff([2, 3, 4, 5], [1, 2, 4], compare);
		assert.deepStrictEqual(d, [
			{ start: 0, deleteCount: 0, toInsert: [1] },
			{ start: 1, deleteCount: 1, toInsert: [] },
			{ start: 3, deleteCount: 1, toInsert: [] },
		]);

		d = arrays.sortedDiff([1, 3, 5, 7], [5, 9, 11], compare);
		assert.deepStrictEqual(d, [
			{ start: 0, deleteCount: 2, toInsert: [] },
			{ start: 3, deleteCount: 1, toInsert: [9, 11] }
		]);

		d = arrays.sortedDiff([1, 3, 7], [5, 9, 11], compare);
		assert.deepStrictEqual(d, [
			{ start: 0, deleteCount: 3, toInsert: [5, 9, 11] }
		]);
	});

	test('delta sorted arrays', function () {
		function compare(a: number, b: number): number {
			return a - b;
		}

		let d = arrays.delta([1, 2, 4], [], compare);
		assert.deepStrictEqual(d.removed, [1, 2, 4]);
		assert.deepStrictEqual(d.added, []);

		d = arrays.delta([], [1, 2, 4], compare);
		assert.deepStrictEqual(d.removed, []);
		assert.deepStrictEqual(d.added, [1, 2, 4]);

		d = arrays.delta([1, 2, 4], [1, 2, 4], compare);
		assert.deepStrictEqual(d.removed, []);
		assert.deepStrictEqual(d.added, []);

		d = arrays.delta([1, 2, 4], [2, 3, 4, 5], compare);
		assert.deepStrictEqual(d.removed, [1]);
		assert.deepStrictEqual(d.added, [3, 5]);

		d = arrays.delta([2, 3, 4, 5], [1, 2, 4], compare);
		assert.deepStrictEqual(d.removed, [3, 5]);
		assert.deepStrictEqual(d.added, [1]);

		d = arrays.delta([1, 3, 5, 7], [5, 9, 11], compare);
		assert.deepStrictEqual(d.removed, [1, 3, 7]);
		assert.deepStrictEqual(d.added, [9, 11]);

		d = arrays.delta([1, 3, 7], [5, 9, 11], compare);
		assert.deepStrictEqual(d.removed, [1, 3, 7]);
		assert.deepStrictEqual(d.added, [5, 9, 11]);
	});

	test('binarySearch', () => {
		function compare(a: number, b: number): number {
			return a - b;
		}
		const array = [1, 4, 5, 7, 55, 59, 60, 61, 64, 69];

		assert.strictEqual(arrays.binarySearch(array, 1, compare), 0);
		assert.strictEqual(arrays.binarySearch(array, 5, compare), 2);

		// insertion point
		assert.strictEqual(arrays.binarySearch(array, 0, compare), ~0);
		assert.strictEqual(arrays.binarySearch(array, 6, compare), ~3);
		assert.strictEqual(arrays.binarySearch(array, 70, compare), ~10);

	});

	test('distinct', () => {
		function compare(a: string): string {
			return a;
		}

		assert.deepStrictEqual(arrays.distinct(['32', '4', '5'], compare), ['32', '4', '5']);
		assert.deepStrictEqual(arrays.distinct(['32', '4', '5', '4'], compare), ['32', '4', '5']);
		assert.deepStrictEqual(arrays.distinct(['32', 'constructor', '5', '1'], compare), ['32', 'constructor', '5', '1']);
		assert.deepStrictEqual(arrays.distinct(['32', 'constructor', 'proto', 'proto', 'constructor'], compare), ['32', 'constructor', 'proto']);
		assert.deepStrictEqual(arrays.distinct(['32', '4', '5', '32', '4', '5', '32', '4', '5', '5'], compare), ['32', '4', '5']);
	});

	test('top', () => {
		const cmp = (a: number, b: number) => {
			assert.strictEqual(typeof a, 'number', 'typeof a');
			assert.strictEqual(typeof b, 'number', 'typeof b');
			return a - b;
		};

		assert.deepStrictEqual(arrays.top([], cmp, 1), []);
		assert.deepStrictEqual(arrays.top([1], cmp, 0), []);
		assert.deepStrictEqual(arrays.top([1, 2], cmp, 1), [1]);
		assert.deepStrictEqual(arrays.top([2, 1], cmp, 1), [1]);
		assert.deepStrictEqual(arrays.top([1, 3, 2], cmp, 2), [1, 2]);
		assert.deepStrictEqual(arrays.top([3, 2, 1], cmp, 3), [1, 2, 3]);
		assert.deepStrictEqual(arrays.top([4, 6, 2, 7, 8, 3, 5, 1], cmp, 3), [1, 2, 3]);
	});

	test('topAsync', async () => {
		const cmp = (a: number, b: number) => {
			assert.strictEqual(typeof a, 'number', 'typeof a');
			assert.strictEqual(typeof b, 'number', 'typeof b');
			return a - b;
		};

		await testTopAsync(cmp, 1);
		return testTopAsync(cmp, 2);
	});

	async function testTopAsync(cmp: any, m: number) {
		{
			const result = await arrays.topAsync([], cmp, 1, m);
			assert.deepStrictEqual(result, []);
		}
		{
			const result = await arrays.topAsync([1], cmp, 0, m);
			assert.deepStrictEqual(result, []);
		}
		{
			const result = await arrays.topAsync([1, 2], cmp, 1, m);
			assert.deepStrictEqual(result, [1]);
		}
		{
			const result = await arrays.topAsync([2, 1], cmp, 1, m);
			assert.deepStrictEqual(result, [1]);
		}
		{
			const result = await arrays.topAsync([1, 3, 2], cmp, 2, m);
			assert.deepStrictEqual(result, [1, 2]);
		}
		{
			const result = await arrays.topAsync([3, 2, 1], cmp, 3, m);
			assert.deepStrictEqual(result, [1, 2, 3]);
		}
		{
			const result = await arrays.topAsync([4, 6, 2, 7, 8, 3, 5, 1], cmp, 3, m);
			assert.deepStrictEqual(result, [1, 2, 3]);
		}
	}

	test('coalesce', () => {
		let a: Array<number | null> = arrays.coalesce([null, 1, null, 2, 3]);
		assert.strictEqual(a.length, 3);
		assert.strictEqual(a[0], 1);
		assert.strictEqual(a[1], 2);
		assert.strictEqual(a[2], 3);

		arrays.coalesce([null, 1, null, undefined, undefined, 2, 3]);
		assert.strictEqual(a.length, 3);
		assert.strictEqual(a[0], 1);
		assert.strictEqual(a[1], 2);
		assert.strictEqual(a[2], 3);

		let b: number[] = [];
		b[10] = 1;
		b[20] = 2;
		b[30] = 3;
		b = arrays.coalesce(b);
		assert.strictEqual(b.length, 3);
		assert.strictEqual(b[0], 1);
		assert.strictEqual(b[1], 2);
		assert.strictEqual(b[2], 3);

		let sparse: number[] = [];
		sparse[0] = 1;
		sparse[1] = 1;
		sparse[17] = 1;
		sparse[1000] = 1;
		sparse[1001] = 1;

		assert.strictEqual(sparse.length, 1002);

		sparse = arrays.coalesce(sparse);
		assert.strictEqual(sparse.length, 5);
	});

	test('coalesce - inplace', function () {
		let a: Array<number | null> = [null, 1, null, 2, 3];
		arrays.coalesceInPlace(a);
		assert.strictEqual(a.length, 3);
		assert.strictEqual(a[0], 1);
		assert.strictEqual(a[1], 2);
		assert.strictEqual(a[2], 3);

		a = [null, 1, null, undefined!, undefined!, 2, 3];
		arrays.coalesceInPlace(a);
		assert.strictEqual(a.length, 3);
		assert.strictEqual(a[0], 1);
		assert.strictEqual(a[1], 2);
		assert.strictEqual(a[2], 3);

		let b: number[] = [];
		b[10] = 1;
		b[20] = 2;
		b[30] = 3;
		arrays.coalesceInPlace(b);
		assert.strictEqual(b.length, 3);
		assert.strictEqual(b[0], 1);
		assert.strictEqual(b[1], 2);
		assert.strictEqual(b[2], 3);

		let sparse: number[] = [];
		sparse[0] = 1;
		sparse[1] = 1;
		sparse[17] = 1;
		sparse[1000] = 1;
		sparse[1001] = 1;

		assert.strictEqual(sparse.length, 1002);

		arrays.coalesceInPlace(sparse);
		assert.strictEqual(sparse.length, 5);
	});

	test('insert, remove', function () {
		const array: string[] = [];
		const remove = arrays.insert(array, 'foo');
		assert.strictEqual(array[0], 'foo');

		remove();
		assert.strictEqual(array.length, 0);
	});

	test('splice', function () {
		// negative start index, absolute value greater than the length
		let array = [1, 2, 3, 4, 5];
		arrays.splice(array, -6, 3, [6, 7]);
		assert.strictEqual(array.length, 4);
		assert.strictEqual(array[0], 6);
		assert.strictEqual(array[1], 7);
		assert.strictEqual(array[2], 4);
		assert.strictEqual(array[3], 5);

		// negative start index, absolute value less than the length
		array = [1, 2, 3, 4, 5];
		arrays.splice(array, -3, 3, [6, 7]);
		assert.strictEqual(array.length, 4);
		assert.strictEqual(array[0], 1);
		assert.strictEqual(array[1], 2);
		assert.strictEqual(array[2], 6);
		assert.strictEqual(array[3], 7);

		// Start index less than the length
		array = [1, 2, 3, 4, 5];
		arrays.splice(array, 3, 3, [6, 7]);
		assert.strictEqual(array.length, 5);
		assert.strictEqual(array[0], 1);
		assert.strictEqual(array[1], 2);
		assert.strictEqual(array[2], 3);
		assert.strictEqual(array[3], 6);
		assert.strictEqual(array[4], 7);

		// Start index greater than the length
		array = [1, 2, 3, 4, 5];
		arrays.splice(array, 6, 3, [6, 7]);
		assert.strictEqual(array.length, 7);
		assert.strictEqual(array[0], 1);
		assert.strictEqual(array[1], 2);
		assert.strictEqual(array[2], 3);
		assert.strictEqual(array[3], 4);
		assert.strictEqual(array[4], 5);
		assert.strictEqual(array[5], 6);
		assert.strictEqual(array[6], 7);
	});
});
