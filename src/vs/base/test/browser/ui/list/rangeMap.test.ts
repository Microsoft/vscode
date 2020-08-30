/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { RangeMap, groupIntersect, consolidate } from 'vs/base/browser/ui/list/rangeMap';
import { Range } from 'vs/base/common/range';

suite('RangeMap', () => {
	let rangeMap: RangeMap;

	setup(() => {
		rangeMap = new RangeMap();
	});

	test('intersection', () => {
		assert.deepEqual(Range.intersect({ start: 0, end: 0 }, { start: 0, end: 0 }), { start: 0, end: 0 });
		assert.deepEqual(Range.intersect({ start: 0, end: 0 }, { start: 5, end: 5 }), { start: 0, end: 0 });
		assert.deepEqual(Range.intersect({ start: 0, end: 1 }, { start: 5, end: 6 }), { start: 0, end: 0 });
		assert.deepEqual(Range.intersect({ start: 5, end: 6 }, { start: 0, end: 1 }), { start: 0, end: 0 });
		assert.deepEqual(Range.intersect({ start: 0, end: 5 }, { start: 2, end: 2 }), { start: 0, end: 0 });
		assert.deepEqual(Range.intersect({ start: 0, end: 1 }, { start: 0, end: 1 }), { start: 0, end: 1 });
		assert.deepEqual(Range.intersect({ start: 0, end: 10 }, { start: 0, end: 5 }), { start: 0, end: 5 });
		assert.deepEqual(Range.intersect({ start: 0, end: 5 }, { start: 0, end: 10 }), { start: 0, end: 5 });
		assert.deepEqual(Range.intersect({ start: 0, end: 10 }, { start: 5, end: 10 }), { start: 5, end: 10 });
		assert.deepEqual(Range.intersect({ start: 5, end: 10 }, { start: 0, end: 10 }), { start: 5, end: 10 });
		assert.deepEqual(Range.intersect({ start: 0, end: 10 }, { start: 2, end: 8 }), { start: 2, end: 8 });
		assert.deepEqual(Range.intersect({ start: 2, end: 8 }, { start: 0, end: 10 }), { start: 2, end: 8 });
		assert.deepEqual(Range.intersect({ start: 0, end: 10 }, { start: 5, end: 15 }), { start: 5, end: 10 });
		assert.deepEqual(Range.intersect({ start: 5, end: 15 }, { start: 0, end: 10 }), { start: 5, end: 10 });
	});

	test('multiIntersect', () => {
		assert.deepEqual(
			groupIntersect(
				{ start: 0, end: 0 },
				[{ range: { start: 0, end: 10 }, size: 1 }]
			),
			[]
		);

		assert.deepEqual(
			groupIntersect(
				{ start: 10, end: 20 },
				[{ range: { start: 0, end: 10 }, size: 1 }]
			),
			[]
		);

		assert.deepEqual(
			groupIntersect(
				{ start: 2, end: 8 },
				[{ range: { start: 0, end: 10 }, size: 1 }]
			),
			[{ range: { start: 2, end: 8 }, size: 1 }]
		);

		assert.deepEqual(
			groupIntersect(
				{ start: 2, end: 8 },
				[{ range: { start: 0, end: 10 }, size: 1 }, { range: { start: 10, end: 20 }, size: 5 }]
			),
			[{ range: { start: 2, end: 8 }, size: 1 }]
		);

		assert.deepEqual(
			groupIntersect(
				{ start: 12, end: 18 },
				[{ range: { start: 0, end: 10 }, size: 1 }, { range: { start: 10, end: 20 }, size: 5 }]
			),
			[{ range: { start: 12, end: 18 }, size: 5 }]
		);

		assert.deepEqual(
			groupIntersect(
				{ start: 2, end: 18 },
				[{ range: { start: 0, end: 10 }, size: 1 }, { range: { start: 10, end: 20 }, size: 5 }]
			),
			[{ range: { start: 2, end: 10 }, size: 1 }, { range: { start: 10, end: 18 }, size: 5 }]
		);

		assert.deepEqual(
			groupIntersect(
				{ start: 2, end: 28 },
				[{ range: { start: 0, end: 10 }, size: 1 }, { range: { start: 10, end: 20 }, size: 5 }, { range: { start: 20, end: 30 }, size: 10 }]
			),
			[{ range: { start: 2, end: 10 }, size: 1 }, { range: { start: 10, end: 20 }, size: 5 }, { range: { start: 20, end: 28 }, size: 10 }]
		);
	});

	test('consolidate', () => {
		assert.deepEqual(consolidate([]), []);

		assert.deepEqual(
			consolidate([{ range: { start: 0, end: 10 }, size: 1 }]),
			[{ range: { start: 0, end: 10 }, size: 1 }]
		);

		assert.deepEqual(
			consolidate([
				{ range: { start: 0, end: 10 }, size: 1 },
				{ range: { start: 10, end: 20 }, size: 1 }
			]),
			[{ range: { start: 0, end: 20 }, size: 1 }]
		);

		assert.deepEqual(
			consolidate([
				{ range: { start: 0, end: 10 }, size: 1 },
				{ range: { start: 10, end: 20 }, size: 1 },
				{ range: { start: 20, end: 100 }, size: 1 }
			]),
			[{ range: { start: 0, end: 100 }, size: 1 }]
		);

		assert.deepEqual(
			consolidate([
				{ range: { start: 0, end: 10 }, size: 1 },
				{ range: { start: 10, end: 20 }, size: 5 },
				{ range: { start: 20, end: 30 }, size: 10 }
			]),
			[
				{ range: { start: 0, end: 10 }, size: 1 },
				{ range: { start: 10, end: 20 }, size: 5 },
				{ range: { start: 20, end: 30 }, size: 10 }
			]
		);

		assert.deepEqual(
			consolidate([
				{ range: { start: 0, end: 10 }, size: 1 },
				{ range: { start: 10, end: 20 }, size: 2 },
				{ range: { start: 20, end: 100 }, size: 2 }
			]),
			[
				{ range: { start: 0, end: 10 }, size: 1 },
				{ range: { start: 10, end: 100 }, size: 2 }
			]
		);
	});

	test('empty', () => {
		assert.equal(rangeMap.size, 0);
		assert.equal(rangeMap.count, 0);
	});

	const one = { size: 1 };
	const two = { size: 2 };
	const three = { size: 3 };
	const five = { size: 5 };
	const ten = { size: 10 };

	test('length & count', () => {
		rangeMap.splice(0, 0, [one]);
		assert.equal(rangeMap.size, 1);
		assert.equal(rangeMap.count, 1);
	});

	test('length & count #2', () => {
		rangeMap.splice(0, 0, [one, one, one, one, one]);
		assert.equal(rangeMap.size, 5);
		assert.equal(rangeMap.count, 5);
	});

	test('length & count #3', () => {
		rangeMap.splice(0, 0, [five]);
		assert.equal(rangeMap.size, 5);
		assert.equal(rangeMap.count, 1);
	});

	test('length & count #4', () => {
		rangeMap.splice(0, 0, [five, five, five, five, five]);
		assert.equal(rangeMap.size, 25);
		assert.equal(rangeMap.count, 5);
	});

	test('insert', () => {
		rangeMap.splice(0, 0, [five, five, five, five, five]);
		assert.equal(rangeMap.size, 25);
		assert.equal(rangeMap.count, 5);

		rangeMap.splice(0, 0, [five, five, five, five, five]);
		assert.equal(rangeMap.size, 50);
		assert.equal(rangeMap.count, 10);

		rangeMap.splice(5, 0, [ten, ten]);
		assert.equal(rangeMap.size, 70);
		assert.equal(rangeMap.count, 12);

		rangeMap.splice(12, 0, [{ size: 200 }]);
		assert.equal(rangeMap.size, 270);
		assert.equal(rangeMap.count, 13);
	});

	test('delete', () => {
		rangeMap.splice(0, 0, [five, five, five, five, five,
			five, five, five, five, five,
			five, five, five, five, five,
			five, five, five, five, five]);
		assert.equal(rangeMap.size, 100);
		assert.equal(rangeMap.count, 20);

		rangeMap.splice(10, 5);
		assert.equal(rangeMap.size, 75);
		assert.equal(rangeMap.count, 15);

		rangeMap.splice(0, 1);
		assert.equal(rangeMap.size, 70);
		assert.equal(rangeMap.count, 14);

		rangeMap.splice(1, 13);
		assert.equal(rangeMap.size, 5);
		assert.equal(rangeMap.count, 1);

		rangeMap.splice(1, 1);
		assert.equal(rangeMap.size, 5);
		assert.equal(rangeMap.count, 1);
	});

	test('insert & delete', () => {
		assert.equal(rangeMap.size, 0);
		assert.equal(rangeMap.count, 0);

		rangeMap.splice(0, 0, [one]);
		assert.equal(rangeMap.size, 1);
		assert.equal(rangeMap.count, 1);

		rangeMap.splice(0, 1);
		assert.equal(rangeMap.size, 0);
		assert.equal(rangeMap.count, 0);
	});

	test('insert & delete #2', () => {
		rangeMap.splice(0, 0, [one, one, one, one, one,
			one, one, one, one, one]);
		rangeMap.splice(2, 6);
		assert.equal(rangeMap.count, 4);
		assert.equal(rangeMap.size, 4);
	});

	test('insert & delete #3', () => {
		rangeMap.splice(0, 0, [one, one, one, one, one,
			one, one, one, one, one,
			two, two, two, two, two,
			two, two, two, two, two]);
		rangeMap.splice(8, 4);
		assert.equal(rangeMap.count, 16);
		assert.equal(rangeMap.size, 24);
	});

	test('insert & delete #3', () => {
		rangeMap.splice(0, 0, [one, one, one, one, one,
			one, one, one, one, one,
			two, two, two, two, two,
			two, two, two, two, two]);
		rangeMap.splice(5, 0, [three, three, three, three, three]);
		assert.equal(rangeMap.count, 25);
		assert.equal(rangeMap.size, 45);

		rangeMap.splice(4, 7);
		assert.equal(rangeMap.count, 18);
		assert.equal(rangeMap.size, 28);
	});

	suite('indexAt, positionAt', () => {
		test('empty', () => {
			assert.equal(rangeMap.indexAt(0), 0);
			assert.equal(rangeMap.indexAt(10), 0);
			assert.equal(rangeMap.indexAt(-1), -1);
			assert.equal(rangeMap.positionAt(0), -1);
			assert.equal(rangeMap.positionAt(10), -1);
			assert.equal(rangeMap.positionAt(-1), -1);
		});

		test('simple', () => {
			rangeMap.splice(0, 0, [one]);
			assert.equal(rangeMap.indexAt(0), 0);
			assert.equal(rangeMap.indexAt(1), 1);
			assert.equal(rangeMap.positionAt(0), 0);
			assert.equal(rangeMap.positionAt(1), -1);
		});

		test('simple #2', () => {
			rangeMap.splice(0, 0, [ten]);
			assert.equal(rangeMap.indexAt(0), 0);
			assert.equal(rangeMap.indexAt(5), 0);
			assert.equal(rangeMap.indexAt(9), 0);
			assert.equal(rangeMap.indexAt(10), 1);
			assert.equal(rangeMap.positionAt(0), 0);
			assert.equal(rangeMap.positionAt(1), -1);
		});

		test('insert', () => {
			rangeMap.splice(0, 0, [one, one, one, one, one, one, one, one, one, one]);
			assert.equal(rangeMap.indexAt(0), 0);
			assert.equal(rangeMap.indexAt(1), 1);
			assert.equal(rangeMap.indexAt(5), 5);
			assert.equal(rangeMap.indexAt(9), 9);
			assert.equal(rangeMap.indexAt(10), 10);
			assert.equal(rangeMap.indexAt(11), 10);

			rangeMap.splice(10, 0, [one, one, one, one, one, one, one, one, one, one]);
			assert.equal(rangeMap.indexAt(10), 10);
			assert.equal(rangeMap.indexAt(19), 19);
			assert.equal(rangeMap.indexAt(20), 20);
			assert.equal(rangeMap.indexAt(21), 20);
			assert.equal(rangeMap.positionAt(0), 0);
			assert.equal(rangeMap.positionAt(1), 1);
			assert.equal(rangeMap.positionAt(19), 19);
			assert.equal(rangeMap.positionAt(20), -1);
		});

		test('delete', () => {
			rangeMap.splice(0, 0, [one, one, one, one, one, one, one, one, one, one]);
			rangeMap.splice(2, 6);

			assert.equal(rangeMap.indexAt(0), 0);
			assert.equal(rangeMap.indexAt(1), 1);
			assert.equal(rangeMap.indexAt(3), 3);
			assert.equal(rangeMap.indexAt(4), 4);
			assert.equal(rangeMap.indexAt(5), 4);
			assert.equal(rangeMap.positionAt(0), 0);
			assert.equal(rangeMap.positionAt(1), 1);
			assert.equal(rangeMap.positionAt(3), 3);
			assert.equal(rangeMap.positionAt(4), -1);
		});

		test('delete #2', () => {
			rangeMap.splice(0, 0, [ten, ten, ten, ten, ten, ten, ten, ten, ten, ten]);
			rangeMap.splice(2, 6);

			assert.equal(rangeMap.indexAt(0), 0);
			assert.equal(rangeMap.indexAt(1), 0);
			assert.equal(rangeMap.indexAt(30), 3);
			assert.equal(rangeMap.indexAt(40), 4);
			assert.equal(rangeMap.indexAt(50), 4);
			assert.equal(rangeMap.positionAt(0), 0);
			assert.equal(rangeMap.positionAt(1), 10);
			assert.equal(rangeMap.positionAt(2), 20);
			assert.equal(rangeMap.positionAt(3), 30);
			assert.equal(rangeMap.positionAt(4), -1);
		});
	});
});
