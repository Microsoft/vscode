/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TrackedRangeStickiness } from 'vs/editor/common/model';
import { IntervalNode, IntervalTree, NodeColor, SENTINEL, getNodeColor, intervalCompare, nodeAcceptEdit, setNodeStickiness } from 'vs/editor/common/model/intervalTree';

const GENERATE_TESTS = false;
let TEST_COUNT = GENERATE_TESTS ? 10000 : 0;
let PRINT_TREE = false;
const MIN_INTERVAL_START = 1;
const MAX_INTERVAL_END = 100;
const MIN_INSERTS = 1;
const MAX_INSERTS = 30;
const MIN_CHANGE_CNT = 10;
const MAX_CHANGE_CNT = 20;

suite('IntervalTree', () => {

	class Interval {
		_intervalBrand: void;

		public start: number;
		public end: number;

		constructor(start: number, end: number) {
			this.start = start;
			this.end = end;
		}
	}

	class Oracle {
		public intervals: Interval[];

		constructor() {
			this.intervals = [];
		}

		public insert(interval: Interval): Interval {
			this.intervals.push(interval);
			this.intervals.sort((a, b) => {
				if (a.start === b.start) {
					return a.end - b.end;
				}
				return a.start - b.start;
			});
			return interval;
		}

		public delete(interval: Interval): void {
			for (let i = 0, len = this.intervals.length; i < len; i++) {
				if (this.intervals[i] === interval) {
					this.intervals.splice(i, 1);
					return;
				}
			}
		}

		public search(interval: Interval): Interval[] {
			let result: Interval[] = [];
			for (let i = 0, len = this.intervals.length; i < len; i++) {
				let int = this.intervals[i];
				if (int.start <= interval.end && int.end >= interval.start) {
					result.push(int);
				}
			}
			return result;
		}
	}

	class TestState {
		private _oracle: Oracle = new Oracle();
		private _tree: IntervalTree = new IntervalTree();
		private _lastNodeId = -1;
		private _treeNodes: Array<IntervalNode | null> = [];
		private _oracleNodes: Array<Interval | null> = [];

		public acceptOp(op: IOperation): void {

			if (op.type === 'insert') {
				if (PRINT_TREE) {
					console.log(`insert: {${JSON.stringify(new Interval(op.begin, op.end))}}`);
				}
				let nodeId = (++this._lastNodeId);
				this._treeNodes[nodeId] = new IntervalNode(null!, op.begin, op.end);
				this._tree.insert(this._treeNodes[nodeId]!);
				this._oracleNodes[nodeId] = this._oracle.insert(new Interval(op.begin, op.end));
			} else if (op.type === 'delete') {
				if (PRINT_TREE) {
					console.log(`delete: {${JSON.stringify(this._oracleNodes[op.id])}}`);
				}
				this._tree.delete(this._treeNodes[op.id]!);
				this._oracle.delete(this._oracleNodes[op.id]!);

				this._treeNodes[op.id] = null;
				this._oracleNodes[op.id] = null;
			} else if (op.type === 'change') {

				this._tree.delete(this._treeNodes[op.id]!);
				this._treeNodes[op.id]!.reset(0, op.begin, op.end, null!);
				this._tree.insert(this._treeNodes[op.id]!);

				this._oracle.delete(this._oracleNodes[op.id]!);
				this._oracleNodes[op.id]!.start = op.begin;
				this._oracleNodes[op.id]!.end = op.end;
				this._oracle.insert(this._oracleNodes[op.id]!);

			} else {
				let actualNodes = this._tree.intervalSearch(op.begin, op.end, 0, false, 0);
				let actual = actualNodes.map(n => new Interval(n.cachedAbsoluteStart, n.cachedAbsoluteEnd));
				let expected = this._oracle.search(new Interval(op.begin, op.end));
				assert.deepEqual(actual, expected);
				return;
			}

			if (PRINT_TREE) {
				printTree(this._tree);
			}

			assertTreeInvariants(this._tree);

			let actual = this._tree.getAllInOrder().map(n => new Interval(n.cachedAbsoluteStart, n.cachedAbsoluteEnd));
			let expected = this._oracle.intervals;
			assert.deepEqual(actual, expected);
		}

		public getExistingNodeId(index: number): number {
			let currIndex = -1;
			for (let i = 0; i < this._treeNodes.length; i++) {
				if (this._treeNodes[i] === null) {
					continue;
				}
				currIndex++;
				if (currIndex === index) {
					return i;
				}
			}
			throw new Error('unexpected');
		}
	}

	interface IInsertOperation {
		type: 'insert';
		begin: number;
		end: number;
	}

	interface IDeleteOperation {
		type: 'delete';
		id: number;
	}

	interface IChangeOperation {
		type: 'change';
		id: number;
		begin: number;
		end: number;
	}

	interface ISearchOperation {
		type: 'search';
		begin: number;
		end: number;
	}

	type IOperation = IInsertOperation | IDeleteOperation | IChangeOperation | ISearchOperation;

	function testIntervalTree(ops: IOperation[]): void {
		let state = new TestState();
		for (let i = 0; i < ops.length; i++) {
			state.acceptOp(ops[i]);
		}
	}

	function getRandomInt(min: number, max: number): number {
		return Math.floor(Math.random() * (max - min + 1)) + min;
	}

	function getRandomRange(min: number, max: number): [number, number] {
		let begin = getRandomInt(min, max);
		let length: number;
		if (getRandomInt(1, 10) <= 2) {
			// large range
			length = getRandomInt(0, max - begin);
		} else {
			// small range
			length = getRandomInt(0, Math.min(max - begin, 10));
		}
		return [begin, begin + length];
	}

	class AutoTest {
		private _ops: IOperation[] = [];
		private _state: TestState = new TestState();
		private _insertCnt: number;
		private _deleteCnt: number;
		private _changeCnt: number;

		constructor() {
			this._insertCnt = getRandomInt(MIN_INSERTS, MAX_INSERTS);
			this._changeCnt = getRandomInt(MIN_CHANGE_CNT, MAX_CHANGE_CNT);
			this._deleteCnt = 0;
		}

		private _doRandomInsert(): void {
			let range = getRandomRange(MIN_INTERVAL_START, MAX_INTERVAL_END);
			this._run({
				type: 'insert',
				begin: range[0],
				end: range[1]
			});
		}

		private _doRandomDelete(): void {
			let idx = getRandomInt(Math.floor(this._deleteCnt / 2), this._deleteCnt - 1);
			this._run({
				type: 'delete',
				id: this._state.getExistingNodeId(idx)
			});
		}

		private _doRandomChange(): void {
			let idx = getRandomInt(0, this._deleteCnt - 1);
			let range = getRandomRange(MIN_INTERVAL_START, MAX_INTERVAL_END);
			this._run({
				type: 'change',
				id: this._state.getExistingNodeId(idx),
				begin: range[0],
				end: range[1]
			});
		}

		public run() {
			while (this._insertCnt > 0 || this._deleteCnt > 0 || this._changeCnt > 0) {
				if (this._insertCnt > 0) {
					this._doRandomInsert();
					this._insertCnt--;
					this._deleteCnt++;
				} else if (this._changeCnt > 0) {
					this._doRandomChange();
					this._changeCnt--;
				} else {
					this._doRandomDelete();
					this._deleteCnt--;
				}

				// Let's also search for something...
				let searchRange = getRandomRange(MIN_INTERVAL_START, MAX_INTERVAL_END);
				this._run({
					type: 'search',
					begin: searchRange[0],
					end: searchRange[1]
				});
			}
		}

		private _run(op: IOperation): void {
			this._ops.push(op);
			this._state.acceptOp(op);
		}

		public print(): void {
			console.log(`testIntervalTree(${JSON.stringify(this._ops)})`);
		}

	}

	suite('generated', () => {
		test('gen01', () => {
			testIntervalTree([
				{ type: 'insert', begin: 28, end: 35 },
				{ type: 'insert', begin: 52, end: 54 },
				{ type: 'insert', begin: 63, end: 69 }
			]);
		});

		test('gen02', () => {
			testIntervalTree([
				{ type: 'insert', begin: 80, end: 89 },
				{ type: 'insert', begin: 92, end: 100 },
				{ type: 'insert', begin: 99, end: 99 }
			]);
		});

		test('gen03', () => {
			testIntervalTree([
				{ type: 'insert', begin: 89, end: 96 },
				{ type: 'insert', begin: 71, end: 74 },
				{ type: 'delete', id: 1 }
			]);
		});

		test('gen04', () => {
			testIntervalTree([
				{ type: 'insert', begin: 44, end: 46 },
				{ type: 'insert', begin: 85, end: 88 },
				{ type: 'delete', id: 0 }
			]);
		});

		test('gen05', () => {
			testIntervalTree([
				{ type: 'insert', begin: 82, end: 90 },
				{ type: 'insert', begin: 69, end: 73 },
				{ type: 'delete', id: 0 },
				{ type: 'delete', id: 1 }
			]);
		});

		test('gen06', () => {
			testIntervalTree([
				{ type: 'insert', begin: 41, end: 63 },
				{ type: 'insert', begin: 98, end: 98 },
				{ type: 'insert', begin: 47, end: 51 },
				{ type: 'delete', id: 2 }
			]);
		});

		test('gen07', () => {
			testIntervalTree([
				{ type: 'insert', begin: 24, end: 26 },
				{ type: 'insert', begin: 11, end: 28 },
				{ type: 'insert', begin: 27, end: 30 },
				{ type: 'insert', begin: 80, end: 85 },
				{ type: 'delete', id: 1 }
			]);
		});

		test('gen08', () => {
			testIntervalTree([
				{ type: 'insert', begin: 100, end: 100 },
				{ type: 'insert', begin: 100, end: 100 }
			]);
		});

		test('gen09', () => {
			testIntervalTree([
				{ type: 'insert', begin: 58, end: 65 },
				{ type: 'insert', begin: 82, end: 96 },
				{ type: 'insert', begin: 58, end: 65 }
			]);
		});

		test('gen10', () => {
			testIntervalTree([
				{ type: 'insert', begin: 32, end: 40 },
				{ type: 'insert', begin: 25, end: 29 },
				{ type: 'insert', begin: 24, end: 32 }
			]);
		});

		test('gen11', () => {
			testIntervalTree([
				{ type: 'insert', begin: 25, end: 70 },
				{ type: 'insert', begin: 99, end: 100 },
				{ type: 'insert', begin: 46, end: 51 },
				{ type: 'insert', begin: 57, end: 57 },
				{ type: 'delete', id: 2 }
			]);
		});

		test('gen12', () => {
			testIntervalTree([
				{ type: 'insert', begin: 20, end: 26 },
				{ type: 'insert', begin: 10, end: 18 },
				{ type: 'insert', begin: 99, end: 99 },
				{ type: 'insert', begin: 37, end: 59 },
				{ type: 'delete', id: 2 }
			]);
		});

		test('gen13', () => {
			testIntervalTree([
				{ type: 'insert', begin: 3, end: 91 },
				{ type: 'insert', begin: 57, end: 57 },
				{ type: 'insert', begin: 35, end: 44 },
				{ type: 'insert', begin: 72, end: 81 },
				{ type: 'delete', id: 2 }
			]);
		});

		test('gen14', () => {
			testIntervalTree([
				{ type: 'insert', begin: 58, end: 61 },
				{ type: 'insert', begin: 34, end: 35 },
				{ type: 'insert', begin: 56, end: 62 },
				{ type: 'insert', begin: 69, end: 78 },
				{ type: 'delete', id: 0 }
			]);
		});

		test('gen15', () => {
			testIntervalTree([
				{ type: 'insert', begin: 63, end: 69 },
				{ type: 'insert', begin: 17, end: 24 },
				{ type: 'insert', begin: 3, end: 13 },
				{ type: 'insert', begin: 84, end: 94 },
				{ type: 'insert', begin: 18, end: 23 },
				{ type: 'insert', begin: 96, end: 98 },
				{ type: 'delete', id: 1 }
			]);
		});

		test('gen16', () => {
			testIntervalTree([
				{ type: 'insert', begin: 27, end: 27 },
				{ type: 'insert', begin: 42, end: 87 },
				{ type: 'insert', begin: 42, end: 49 },
				{ type: 'insert', begin: 69, end: 71 },
				{ type: 'insert', begin: 20, end: 27 },
				{ type: 'insert', begin: 8, end: 9 },
				{ type: 'insert', begin: 42, end: 49 },
				{ type: 'delete', id: 1 }
			]);
		});

		test('gen17', () => {
			testIntervalTree([
				{ type: 'insert', begin: 21, end: 23 },
				{ type: 'insert', begin: 83, end: 87 },
				{ type: 'insert', begin: 56, end: 58 },
				{ type: 'insert', begin: 1, end: 55 },
				{ type: 'insert', begin: 56, end: 59 },
				{ type: 'insert', begin: 58, end: 60 },
				{ type: 'insert', begin: 56, end: 65 },
				{ type: 'delete', id: 1 },
				{ type: 'delete', id: 0 },
				{ type: 'delete', id: 6 }
			]);
		});

		test('gen18', () => {
			testIntervalTree([
				{ type: 'insert', begin: 25, end: 25 },
				{ type: 'insert', begin: 67, end: 79 },
				{ type: 'delete', id: 0 },
				{ type: 'search', begin: 65, end: 75 }
			]);
		});

		test('force delta overflow', () => {
			// Search the IntervalNode ctor for FORCE_OVERFLOWING_TEST
			// to force that this test leads to a delta normalization
			testIntervalTree([
				{ type: 'insert', begin: 686081138593427, end: 733009856502260 },
				{ type: 'insert', begin: 591031326181669, end: 591031326181672 },
				{ type: 'insert', begin: 940037682731896, end: 940037682731903 },
				{ type: 'insert', begin: 598413641151120, end: 598413641151128 },
				{ type: 'insert', begin: 800564156553344, end: 800564156553351 },
				{ type: 'insert', begin: 894198957565481, end: 894198957565491 }
			]);
		});
	});

	// TEST_COUNT = 0;
	// PRINT_TREE = true;

	for (let i = 0; i < TEST_COUNT; i++) {
		if (i % 100 === 0) {
			console.log(`TEST ${i + 1}/${TEST_COUNT}`);
		}
		let test = new AutoTest();

		try {
			test.run();
		} catch (err) {
			console.log(err);
			test.print();
			return;
		}
	}

	suite('searching', () => {

		function createCormenTree(): IntervalTree {
			let r = new IntervalTree();
			let data: [number, number][] = [
				[16, 21],
				[8, 9],
				[25, 30],
				[5, 8],
				[15, 23],
				[17, 19],
				[26, 26],
				[0, 3],
				[6, 10],
				[19, 20]
			];
			data.forEach((int) => {
				let node = new IntervalNode(null!, int[0], int[1]);
				r.insert(node);
			});
			return r;
		}

		const T = createCormenTree();

		function assertIntervalSearch(start: number, end: number, expected: [number, number][]): void {
			let actualNodes = T.intervalSearch(start, end, 0, false, 0);
			let actual = actualNodes.map((n) => <[number, number]>[n.cachedAbsoluteStart, n.cachedAbsoluteEnd]);
			assert.deepEqual(actual, expected);
		}

		test('cormen 1->2', () => {
			assertIntervalSearch(
				1, 2,
				[
					[0, 3],
				]
			);
		});

		test('cormen 4->8', () => {
			assertIntervalSearch(
				4, 8,
				[
					[5, 8],
					[6, 10],
					[8, 9],
				]
			);
		});

		test('cormen 10->15', () => {
			assertIntervalSearch(
				10, 15,
				[
					[6, 10],
					[15, 23],
				]
			);
		});

		test('cormen 21->25', () => {
			assertIntervalSearch(
				21, 25,
				[
					[15, 23],
					[16, 21],
					[25, 30],
				]
			);
		});

		test('cormen 24->24', () => {
			assertIntervalSearch(
				24, 24,
				[
				]
			);
		});
	});
});

suite('IntervalTree', () => {
	function assertNodeAcceptEdit(msg: string, nodeStart: number, nodeEnd: number, nodeStickiness: TrackedRangeStickiness, start: number, end: number, textLength: number, forceMoveMarkers: boolean, expectedNodeStart: number, expectedNodeEnd: number): void {
		let node = new IntervalNode('', nodeStart, nodeEnd);
		setNodeStickiness(node, nodeStickiness);
		nodeAcceptEdit(node, start, end, textLength, forceMoveMarkers);
		assert.deepEqual([node.start, node.end], [expectedNodeStart, expectedNodeEnd], msg);
	}

	test('nodeAcceptEdit', () => {
		// A. collapsed decoration
		{
			// no-op
			assertNodeAcceptEdit('A.000', 0, 0, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 0, 0, 0, false, 0, 0);
			assertNodeAcceptEdit('A.001', 0, 0, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 0, 0, 0, false, 0, 0);
			assertNodeAcceptEdit('A.002', 0, 0, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 0, 0, 0, false, 0, 0);
			assertNodeAcceptEdit('A.003', 0, 0, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 0, 0, 0, false, 0, 0);
			assertNodeAcceptEdit('A.004', 0, 0, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 0, 0, 0, true, 0, 0);
			assertNodeAcceptEdit('A.005', 0, 0, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 0, 0, 0, true, 0, 0);
			assertNodeAcceptEdit('A.006', 0, 0, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 0, 0, 0, true, 0, 0);
			assertNodeAcceptEdit('A.007', 0, 0, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 0, 0, 0, true, 0, 0);
			// insertion
			assertNodeAcceptEdit('A.008', 0, 0, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 0, 0, 1, false, 0, 1);
			assertNodeAcceptEdit('A.009', 0, 0, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 0, 0, 1, false, 1, 1);
			assertNodeAcceptEdit('A.010', 0, 0, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 0, 0, 1, false, 0, 0);
			assertNodeAcceptEdit('A.011', 0, 0, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 0, 0, 1, false, 1, 1);
			assertNodeAcceptEdit('A.012', 0, 0, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 0, 0, 1, true, 1, 1);
			assertNodeAcceptEdit('A.013', 0, 0, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 0, 0, 1, true, 1, 1);
			assertNodeAcceptEdit('A.014', 0, 0, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 0, 0, 1, true, 1, 1);
			assertNodeAcceptEdit('A.015', 0, 0, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 0, 0, 1, true, 1, 1);
		}

		// B. non collapsed decoration
		{
			// no-op
			assertNodeAcceptEdit('B.000', 0, 5, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 0, 0, 0, false, 0, 5);
			assertNodeAcceptEdit('B.001', 0, 5, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 0, 0, 0, false, 0, 5);
			assertNodeAcceptEdit('B.002', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 0, 0, 0, false, 0, 5);
			assertNodeAcceptEdit('B.003', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 0, 0, 0, false, 0, 5);
			assertNodeAcceptEdit('B.004', 0, 5, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 0, 0, 0, true, 0, 5);
			assertNodeAcceptEdit('B.005', 0, 5, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 0, 0, 0, true, 0, 5);
			assertNodeAcceptEdit('B.006', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 0, 0, 0, true, 0, 5);
			assertNodeAcceptEdit('B.007', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 0, 0, 0, true, 0, 5);
			// insertion at start
			assertNodeAcceptEdit('B.008', 0, 5, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 0, 0, 1, false, 0, 6);
			assertNodeAcceptEdit('B.009', 0, 5, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 0, 0, 1, false, 1, 6);
			assertNodeAcceptEdit('B.010', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 0, 0, 1, false, 0, 6);
			assertNodeAcceptEdit('B.011', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 0, 0, 1, false, 1, 6);
			assertNodeAcceptEdit('B.012', 0, 5, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 0, 0, 1, true, 1, 6);
			assertNodeAcceptEdit('B.013', 0, 5, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 0, 0, 1, true, 1, 6);
			assertNodeAcceptEdit('B.014', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 0, 0, 1, true, 1, 6);
			assertNodeAcceptEdit('B.015', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 0, 0, 1, true, 1, 6);
			// insertion in middle
			assertNodeAcceptEdit('B.016', 0, 5, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 2, 2, 1, false, 0, 6);
			assertNodeAcceptEdit('B.017', 0, 5, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 2, 2, 1, false, 0, 6);
			assertNodeAcceptEdit('B.018', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 2, 2, 1, false, 0, 6);
			assertNodeAcceptEdit('B.019', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 2, 2, 1, false, 0, 6);
			assertNodeAcceptEdit('B.020', 0, 5, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 2, 2, 1, true, 0, 6);
			assertNodeAcceptEdit('B.021', 0, 5, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 2, 2, 1, true, 0, 6);
			assertNodeAcceptEdit('B.022', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 2, 2, 1, true, 0, 6);
			assertNodeAcceptEdit('B.023', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 2, 2, 1, true, 0, 6);
			// insertion at end
			assertNodeAcceptEdit('B.024', 0, 5, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 5, 1, false, 0, 6);
			assertNodeAcceptEdit('B.025', 0, 5, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 5, 1, false, 0, 5);
			assertNodeAcceptEdit('B.026', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 5, 1, false, 0, 5);
			assertNodeAcceptEdit('B.027', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 5, 1, false, 0, 6);
			assertNodeAcceptEdit('B.028', 0, 5, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 5, 1, true, 0, 6);
			assertNodeAcceptEdit('B.029', 0, 5, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 5, 1, true, 0, 6);
			assertNodeAcceptEdit('B.030', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 5, 1, true, 0, 6);
			assertNodeAcceptEdit('B.031', 0, 5, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 5, 1, true, 0, 6);

			// replace with larger text until start
			assertNodeAcceptEdit('B.032', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 4, 5, 2, false, 5, 11);
			assertNodeAcceptEdit('B.033', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 4, 5, 2, false, 6, 11);
			assertNodeAcceptEdit('B.034', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 4, 5, 2, false, 5, 11);
			assertNodeAcceptEdit('B.035', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 4, 5, 2, false, 6, 11);
			assertNodeAcceptEdit('B.036', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 4, 5, 2, true, 6, 11);
			assertNodeAcceptEdit('B.037', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 4, 5, 2, true, 6, 11);
			assertNodeAcceptEdit('B.038', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 4, 5, 2, true, 6, 11);
			assertNodeAcceptEdit('B.039', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 4, 5, 2, true, 6, 11);
			// replace with smaller text until start
			assertNodeAcceptEdit('B.040', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 3, 5, 1, false, 4, 9);
			assertNodeAcceptEdit('B.041', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 3, 5, 1, false, 4, 9);
			assertNodeAcceptEdit('B.042', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 3, 5, 1, false, 4, 9);
			assertNodeAcceptEdit('B.043', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 3, 5, 1, false, 4, 9);
			assertNodeAcceptEdit('B.044', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 3, 5, 1, true, 4, 9);
			assertNodeAcceptEdit('B.045', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 3, 5, 1, true, 4, 9);
			assertNodeAcceptEdit('B.046', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 3, 5, 1, true, 4, 9);
			assertNodeAcceptEdit('B.047', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 3, 5, 1, true, 4, 9);

			// replace with larger text select start
			assertNodeAcceptEdit('B.048', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 4, 6, 3, false, 5, 11);
			assertNodeAcceptEdit('B.049', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 4, 6, 3, false, 5, 11);
			assertNodeAcceptEdit('B.050', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 4, 6, 3, false, 5, 11);
			assertNodeAcceptEdit('B.051', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 4, 6, 3, false, 5, 11);
			assertNodeAcceptEdit('B.052', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 4, 6, 3, true, 7, 11);
			assertNodeAcceptEdit('B.053', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 4, 6, 3, true, 7, 11);
			assertNodeAcceptEdit('B.054', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 4, 6, 3, true, 7, 11);
			assertNodeAcceptEdit('B.055', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 4, 6, 3, true, 7, 11);
			// replace with smaller text select start
			assertNodeAcceptEdit('B.056', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 4, 6, 1, false, 5, 9);
			assertNodeAcceptEdit('B.057', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 4, 6, 1, false, 5, 9);
			assertNodeAcceptEdit('B.058', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 4, 6, 1, false, 5, 9);
			assertNodeAcceptEdit('B.059', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 4, 6, 1, false, 5, 9);
			assertNodeAcceptEdit('B.060', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 4, 6, 1, true, 5, 9);
			assertNodeAcceptEdit('B.061', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 4, 6, 1, true, 5, 9);
			assertNodeAcceptEdit('B.062', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 4, 6, 1, true, 5, 9);
			assertNodeAcceptEdit('B.063', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 4, 6, 1, true, 5, 9);

			// replace with larger text from start
			assertNodeAcceptEdit('B.064', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 6, 2, false, 5, 11);
			assertNodeAcceptEdit('B.065', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 6, 2, false, 5, 11);
			assertNodeAcceptEdit('B.066', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 6, 2, false, 5, 11);
			assertNodeAcceptEdit('B.067', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 6, 2, false, 5, 11);
			assertNodeAcceptEdit('B.068', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 6, 2, true, 7, 11);
			assertNodeAcceptEdit('B.069', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 6, 2, true, 7, 11);
			assertNodeAcceptEdit('B.070', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 6, 2, true, 7, 11);
			assertNodeAcceptEdit('B.071', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 6, 2, true, 7, 11);
			// replace with smaller text from start
			assertNodeAcceptEdit('B.072', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 7, 1, false, 5, 9);
			assertNodeAcceptEdit('B.073', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 7, 1, false, 5, 9);
			assertNodeAcceptEdit('B.074', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 7, 1, false, 5, 9);
			assertNodeAcceptEdit('B.075', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 7, 1, false, 5, 9);
			assertNodeAcceptEdit('B.076', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 7, 1, true, 6, 9);
			assertNodeAcceptEdit('B.077', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 7, 1, true, 6, 9);
			assertNodeAcceptEdit('B.078', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 7, 1, true, 6, 9);
			assertNodeAcceptEdit('B.079', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 7, 1, true, 6, 9);

			// replace with larger text to end
			assertNodeAcceptEdit('B.080', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 9, 10, 2, false, 5, 11);
			assertNodeAcceptEdit('B.081', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 9, 10, 2, false, 5, 10);
			assertNodeAcceptEdit('B.082', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 9, 10, 2, false, 5, 10);
			assertNodeAcceptEdit('B.083', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 9, 10, 2, false, 5, 11);
			assertNodeAcceptEdit('B.084', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 9, 10, 2, true, 5, 11);
			assertNodeAcceptEdit('B.085', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 9, 10, 2, true, 5, 11);
			assertNodeAcceptEdit('B.086', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 9, 10, 2, true, 5, 11);
			assertNodeAcceptEdit('B.087', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 9, 10, 2, true, 5, 11);
			// replace with smaller text to end
			assertNodeAcceptEdit('B.088', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 8, 10, 1, false, 5, 9);
			assertNodeAcceptEdit('B.089', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 8, 10, 1, false, 5, 9);
			assertNodeAcceptEdit('B.090', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 8, 10, 1, false, 5, 9);
			assertNodeAcceptEdit('B.091', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 8, 10, 1, false, 5, 9);
			assertNodeAcceptEdit('B.092', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 8, 10, 1, true, 5, 9);
			assertNodeAcceptEdit('B.093', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 8, 10, 1, true, 5, 9);
			assertNodeAcceptEdit('B.094', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 8, 10, 1, true, 5, 9);
			assertNodeAcceptEdit('B.095', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 8, 10, 1, true, 5, 9);

			// replace with larger text select end
			assertNodeAcceptEdit('B.096', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 9, 11, 3, false, 5, 10);
			assertNodeAcceptEdit('B.097', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 9, 11, 3, false, 5, 10);
			assertNodeAcceptEdit('B.098', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 9, 11, 3, false, 5, 10);
			assertNodeAcceptEdit('B.099', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 9, 11, 3, false, 5, 10);
			assertNodeAcceptEdit('B.100', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 9, 11, 3, true, 5, 12);
			assertNodeAcceptEdit('B.101', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 9, 11, 3, true, 5, 12);
			assertNodeAcceptEdit('B.102', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 9, 11, 3, true, 5, 12);
			assertNodeAcceptEdit('B.103', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 9, 11, 3, true, 5, 12);
			// replace with smaller text select end
			assertNodeAcceptEdit('B.104', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 9, 11, 1, false, 5, 10);
			assertNodeAcceptEdit('B.105', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 9, 11, 1, false, 5, 10);
			assertNodeAcceptEdit('B.106', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 9, 11, 1, false, 5, 10);
			assertNodeAcceptEdit('B.107', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 9, 11, 1, false, 5, 10);
			assertNodeAcceptEdit('B.108', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 9, 11, 1, true, 5, 10);
			assertNodeAcceptEdit('B.109', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 9, 11, 1, true, 5, 10);
			assertNodeAcceptEdit('B.110', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 9, 11, 1, true, 5, 10);
			assertNodeAcceptEdit('B.111', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 9, 11, 1, true, 5, 10);

			// replace with larger text from end
			assertNodeAcceptEdit('B.112', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 10, 11, 3, false, 5, 10);
			assertNodeAcceptEdit('B.113', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 10, 11, 3, false, 5, 10);
			assertNodeAcceptEdit('B.114', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 10, 11, 3, false, 5, 10);
			assertNodeAcceptEdit('B.115', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 10, 11, 3, false, 5, 10);
			assertNodeAcceptEdit('B.116', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 10, 11, 3, true, 5, 13);
			assertNodeAcceptEdit('B.117', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 10, 11, 3, true, 5, 13);
			assertNodeAcceptEdit('B.118', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 10, 11, 3, true, 5, 13);
			assertNodeAcceptEdit('B.119', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 10, 11, 3, true, 5, 13);
			// replace with smaller text from end
			assertNodeAcceptEdit('B.120', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 10, 12, 1, false, 5, 10);
			assertNodeAcceptEdit('B.121', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 10, 12, 1, false, 5, 10);
			assertNodeAcceptEdit('B.122', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 10, 12, 1, false, 5, 10);
			assertNodeAcceptEdit('B.123', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 10, 12, 1, false, 5, 10);
			assertNodeAcceptEdit('B.124', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 10, 12, 1, true, 5, 11);
			assertNodeAcceptEdit('B.125', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 10, 12, 1, true, 5, 11);
			assertNodeAcceptEdit('B.126', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 10, 12, 1, true, 5, 11);
			assertNodeAcceptEdit('B.127', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 10, 12, 1, true, 5, 11);

			// delete until start
			assertNodeAcceptEdit('B.128', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 4, 5, 0, false, 4, 9);
			assertNodeAcceptEdit('B.129', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 4, 5, 0, false, 4, 9);
			assertNodeAcceptEdit('B.130', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 4, 5, 0, false, 4, 9);
			assertNodeAcceptEdit('B.131', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 4, 5, 0, false, 4, 9);
			assertNodeAcceptEdit('B.132', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 4, 5, 0, true, 4, 9);
			assertNodeAcceptEdit('B.133', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 4, 5, 0, true, 4, 9);
			assertNodeAcceptEdit('B.134', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 4, 5, 0, true, 4, 9);
			assertNodeAcceptEdit('B.135', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 4, 5, 0, true, 4, 9);

			// delete select start
			assertNodeAcceptEdit('B.136', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 4, 6, 0, false, 4, 8);
			assertNodeAcceptEdit('B.137', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 4, 6, 0, false, 4, 8);
			assertNodeAcceptEdit('B.138', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 4, 6, 0, false, 4, 8);
			assertNodeAcceptEdit('B.139', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 4, 6, 0, false, 4, 8);
			assertNodeAcceptEdit('B.140', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 4, 6, 0, true, 4, 8);
			assertNodeAcceptEdit('B.141', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 4, 6, 0, true, 4, 8);
			assertNodeAcceptEdit('B.142', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 4, 6, 0, true, 4, 8);
			assertNodeAcceptEdit('B.143', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 4, 6, 0, true, 4, 8);

			// delete from start
			assertNodeAcceptEdit('B.144', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 6, 0, false, 5, 9);
			assertNodeAcceptEdit('B.145', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 6, 0, false, 5, 9);
			assertNodeAcceptEdit('B.146', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 6, 0, false, 5, 9);
			assertNodeAcceptEdit('B.147', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 6, 0, false, 5, 9);
			assertNodeAcceptEdit('B.148', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 6, 0, true, 5, 9);
			assertNodeAcceptEdit('B.149', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 6, 0, true, 5, 9);
			assertNodeAcceptEdit('B.150', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 6, 0, true, 5, 9);
			assertNodeAcceptEdit('B.151', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 6, 0, true, 5, 9);

			// delete to end
			assertNodeAcceptEdit('B.152', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 9, 10, 0, false, 5, 9);
			assertNodeAcceptEdit('B.153', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 9, 10, 0, false, 5, 9);
			assertNodeAcceptEdit('B.154', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 9, 10, 0, false, 5, 9);
			assertNodeAcceptEdit('B.155', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 9, 10, 0, false, 5, 9);
			assertNodeAcceptEdit('B.156', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 9, 10, 0, true, 5, 9);
			assertNodeAcceptEdit('B.157', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 9, 10, 0, true, 5, 9);
			assertNodeAcceptEdit('B.158', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 9, 10, 0, true, 5, 9);
			assertNodeAcceptEdit('B.159', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 9, 10, 0, true, 5, 9);

			// delete select end
			assertNodeAcceptEdit('B.160', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 9, 11, 0, false, 5, 9);
			assertNodeAcceptEdit('B.161', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 9, 11, 0, false, 5, 9);
			assertNodeAcceptEdit('B.162', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 9, 11, 0, false, 5, 9);
			assertNodeAcceptEdit('B.163', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 9, 11, 0, false, 5, 9);
			assertNodeAcceptEdit('B.164', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 9, 11, 0, true, 5, 9);
			assertNodeAcceptEdit('B.165', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 9, 11, 0, true, 5, 9);
			assertNodeAcceptEdit('B.166', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 9, 11, 0, true, 5, 9);
			assertNodeAcceptEdit('B.167', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 9, 11, 0, true, 5, 9);

			// delete from end
			assertNodeAcceptEdit('B.168', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 10, 11, 0, false, 5, 10);
			assertNodeAcceptEdit('B.169', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 10, 11, 0, false, 5, 10);
			assertNodeAcceptEdit('B.170', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 10, 11, 0, false, 5, 10);
			assertNodeAcceptEdit('B.171', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 10, 11, 0, false, 5, 10);
			assertNodeAcceptEdit('B.172', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 10, 11, 0, true, 5, 10);
			assertNodeAcceptEdit('B.173', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 10, 11, 0, true, 5, 10);
			assertNodeAcceptEdit('B.174', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 10, 11, 0, true, 5, 10);
			assertNodeAcceptEdit('B.175', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 10, 11, 0, true, 5, 10);

			// replace with larger text entire
			assertNodeAcceptEdit('B.176', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 10, 3, false, 5, 8);
			assertNodeAcceptEdit('B.177', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 10, 3, false, 5, 8);
			assertNodeAcceptEdit('B.178', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 10, 3, false, 5, 8);
			assertNodeAcceptEdit('B.179', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 10, 3, false, 5, 8);
			assertNodeAcceptEdit('B.180', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 10, 3, true, 8, 8);
			assertNodeAcceptEdit('B.181', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 10, 3, true, 8, 8);
			assertNodeAcceptEdit('B.182', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 10, 3, true, 8, 8);
			assertNodeAcceptEdit('B.183', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 10, 3, true, 8, 8);
			// replace with smaller text entire
			assertNodeAcceptEdit('B.184', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 10, 7, false, 5, 12);
			assertNodeAcceptEdit('B.185', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 10, 7, false, 5, 10);
			assertNodeAcceptEdit('B.186', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 10, 7, false, 5, 10);
			assertNodeAcceptEdit('B.187', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 10, 7, false, 5, 12);
			assertNodeAcceptEdit('B.188', 5, 10, TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges, 5, 10, 7, true, 12, 12);
			assertNodeAcceptEdit('B.189', 5, 10, TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges, 5, 10, 7, true, 12, 12);
			assertNodeAcceptEdit('B.190', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingBefore, 5, 10, 7, true, 12, 12);
			assertNodeAcceptEdit('B.191', 5, 10, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter, 5, 10, 7, true, 12, 12);

		}
	});
});

function printTree(T: IntervalTree): void {
	if (T.root === SENTINEL) {
		console.log(`~~ empty`);
		return;
	}
	let out: string[] = [];
	_printTree(T, T.root, '', 0, out);
	console.log(out.join(''));
}

function _printTree(T: IntervalTree, n: IntervalNode, indent: string, delta: number, out: string[]): void {
	out.push(`${indent}[${getNodeColor(n) === NodeColor.Red ? 'R' : 'B'},${n.delta}, ${n.start}->${n.end}, ${n.maxEnd}] : {${delta + n.start}->${delta + n.end}}, maxEnd: ${n.maxEnd + delta}\n`);
	if (n.left !== SENTINEL) {
		_printTree(T, n.left, indent + '    ', delta, out);
	} else {
		out.push(`${indent}    NIL\n`);
	}
	if (n.right !== SENTINEL) {
		_printTree(T, n.right, indent + '    ', delta + n.delta, out);
	} else {
		out.push(`${indent}    NIL\n`);
	}
}

//#region Assertion

function assertTreeInvariants(T: IntervalTree): void {
	assert(getNodeColor(SENTINEL) === NodeColor.Black);
	assert(SENTINEL.parent === SENTINEL);
	assert(SENTINEL.left === SENTINEL);
	assert(SENTINEL.right === SENTINEL);
	assert(SENTINEL.start === 0);
	assert(SENTINEL.end === 0);
	assert(SENTINEL.delta === 0);
	assert(T.root.parent === SENTINEL);
	assertValidTree(T);
}

function depth(n: IntervalNode): number {
	if (n === SENTINEL) {
		// The leafs are black
		return 1;
	}
	assert(depth(n.left) === depth(n.right));
	return (getNodeColor(n) === NodeColor.Black ? 1 : 0) + depth(n.left);
}

function assertValidNode(n: IntervalNode, delta: number): void {
	if (n === SENTINEL) {
		return;
	}

	let l = n.left;
	let r = n.right;

	if (getNodeColor(n) === NodeColor.Red) {
		assert(getNodeColor(l) === NodeColor.Black);
		assert(getNodeColor(r) === NodeColor.Black);
	}

	let expectedMaxEnd = n.end;
	if (l !== SENTINEL) {
		assert(intervalCompare(l.start + delta, l.end + delta, n.start + delta, n.end + delta) <= 0);
		expectedMaxEnd = Math.max(expectedMaxEnd, l.maxEnd);
	}
	if (r !== SENTINEL) {
		assert(intervalCompare(n.start + delta, n.end + delta, r.start + delta + n.delta, r.end + delta + n.delta) <= 0);
		expectedMaxEnd = Math.max(expectedMaxEnd, r.maxEnd + n.delta);
	}
	assert(n.maxEnd === expectedMaxEnd);

	assertValidNode(l, delta);
	assertValidNode(r, delta + n.delta);
}

function assertValidTree(T: IntervalTree): void {
	if (T.root === SENTINEL) {
		return;
	}
	assert(getNodeColor(T.root) === NodeColor.Black);
	assert(depth(T.root.left) === depth(T.root.right));
	assertValidNode(T.root, 0);
}

//#endregion

