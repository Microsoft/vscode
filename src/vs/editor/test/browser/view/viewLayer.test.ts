/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ILine, RenderedLinesCollection } from 'vs/editor/browser/view/viewLayer';

class TestLine implements ILine {

	_pinged = false;
	constructor(public id: string) {
	}

	onContentChanged(): void {
		this._pinged = true;
	}
	onTokensChanged(): void {
		this._pinged = true;
	}
}

interface ILinesCollectionState {
	startLineNumber: number;
	lines: string[];
	pinged: boolean[];
}

function assertState(col: RenderedLinesCollection<TestLine>, state: ILinesCollectionState): void {
	let actualState: ILinesCollectionState = {
		startLineNumber: col.getStartLineNumber(),
		lines: [],
		pinged: []
	};
	for (let lineNumber = col.getStartLineNumber(); lineNumber <= col.getEndLineNumber(); lineNumber++) {
		actualState.lines.push(col.getLine(lineNumber).id);
		actualState.pinged.push(col.getLine(lineNumber)._pinged);
	}
	assert.deepEqual(actualState, state);
}

suite('RenderedLinesCollection onLinesDeleted', () => {

	function testOnModelLinesDeleted(deleteFromLineNumber: number, deleteToLineNumber: number, expectedDeleted: string[], expectedState: ILinesCollectionState): void {
		let col = new RenderedLinesCollection<TestLine>(() => new TestLine('new'));
		col._set(6, [
			new TestLine('old6'),
			new TestLine('old7'),
			new TestLine('old8'),
			new TestLine('old9')
		]);
		let actualDeleted1 = col.onLinesDeleted(deleteFromLineNumber, deleteToLineNumber);
		let actualDeleted: string[] = [];
		if (actualDeleted1) {
			actualDeleted = actualDeleted1.map(line => line.id);
		}
		assert.deepEqual(actualDeleted, expectedDeleted);
		assertState(col, expectedState);
	}

	test('A1', () => {
		testOnModelLinesDeleted(3, 3, [], {
			startLineNumber: 5,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('A2', () => {
		testOnModelLinesDeleted(3, 4, [], {
			startLineNumber: 4,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('A3', () => {
		testOnModelLinesDeleted(3, 5, [], {
			startLineNumber: 3,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('A4', () => {
		testOnModelLinesDeleted(3, 6, ['old6'], {
			startLineNumber: 3,
			lines: ['old7', 'old8', 'old9'],
			pinged: [false, false, false]
		});
	});

	test('A5', () => {
		testOnModelLinesDeleted(3, 7, ['old6', 'old7'], {
			startLineNumber: 3,
			lines: ['old8', 'old9'],
			pinged: [false, false]
		});
	});

	test('A6', () => {
		testOnModelLinesDeleted(3, 8, ['old6', 'old7', 'old8'], {
			startLineNumber: 3,
			lines: ['old9'],
			pinged: [false]
		});
	});

	test('A7', () => {
		testOnModelLinesDeleted(3, 9, ['old6', 'old7', 'old8', 'old9'], {
			startLineNumber: 3,
			lines: [],
			pinged: []
		});
	});

	test('A8', () => {
		testOnModelLinesDeleted(3, 10, ['old6', 'old7', 'old8', 'old9'], {
			startLineNumber: 3,
			lines: [],
			pinged: []
		});
	});


	test('B1', () => {
		testOnModelLinesDeleted(5, 5, [], {
			startLineNumber: 5,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('B2', () => {
		testOnModelLinesDeleted(5, 6, ['old6'], {
			startLineNumber: 5,
			lines: ['old7', 'old8', 'old9'],
			pinged: [false, false, false]
		});
	});

	test('B3', () => {
		testOnModelLinesDeleted(5, 7, ['old6', 'old7'], {
			startLineNumber: 5,
			lines: ['old8', 'old9'],
			pinged: [false, false]
		});
	});

	test('B4', () => {
		testOnModelLinesDeleted(5, 8, ['old6', 'old7', 'old8'], {
			startLineNumber: 5,
			lines: ['old9'],
			pinged: [false]
		});
	});

	test('B5', () => {
		testOnModelLinesDeleted(5, 9, ['old6', 'old7', 'old8', 'old9'], {
			startLineNumber: 5,
			lines: [],
			pinged: []
		});
	});

	test('B6', () => {
		testOnModelLinesDeleted(5, 10, ['old6', 'old7', 'old8', 'old9'], {
			startLineNumber: 5,
			lines: [],
			pinged: []
		});
	});


	test('C1', () => {
		testOnModelLinesDeleted(6, 6, ['old6'], {
			startLineNumber: 6,
			lines: ['old7', 'old8', 'old9'],
			pinged: [false, false, false]
		});
	});

	test('C2', () => {
		testOnModelLinesDeleted(6, 7, ['old6', 'old7'], {
			startLineNumber: 6,
			lines: ['old8', 'old9'],
			pinged: [false, false]
		});
	});

	test('C3', () => {
		testOnModelLinesDeleted(6, 8, ['old6', 'old7', 'old8'], {
			startLineNumber: 6,
			lines: ['old9'],
			pinged: [false]
		});
	});

	test('C4', () => {
		testOnModelLinesDeleted(6, 9, ['old6', 'old7', 'old8', 'old9'], {
			startLineNumber: 6,
			lines: [],
			pinged: []
		});
	});

	test('C5', () => {
		testOnModelLinesDeleted(6, 10, ['old6', 'old7', 'old8', 'old9'], {
			startLineNumber: 6,
			lines: [],
			pinged: []
		});
	});


	test('D1', () => {
		testOnModelLinesDeleted(7, 7, ['old7'], {
			startLineNumber: 6,
			lines: ['old6', 'old8', 'old9'],
			pinged: [false, false, false]
		});
	});

	test('D2', () => {
		testOnModelLinesDeleted(7, 8, ['old7', 'old8'], {
			startLineNumber: 6,
			lines: ['old6', 'old9'],
			pinged: [false, false]
		});
	});

	test('D3', () => {
		testOnModelLinesDeleted(7, 9, ['old7', 'old8', 'old9'], {
			startLineNumber: 6,
			lines: ['old6'],
			pinged: [false]
		});
	});

	test('D4', () => {
		testOnModelLinesDeleted(7, 10, ['old7', 'old8', 'old9'], {
			startLineNumber: 6,
			lines: ['old6'],
			pinged: [false]
		});
	});


	test('E1', () => {
		testOnModelLinesDeleted(8, 8, ['old8'], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old9'],
			pinged: [false, false, false]
		});
	});

	test('E2', () => {
		testOnModelLinesDeleted(8, 9, ['old8', 'old9'], {
			startLineNumber: 6,
			lines: ['old6', 'old7'],
			pinged: [false, false]
		});
	});

	test('E3', () => {
		testOnModelLinesDeleted(8, 10, ['old8', 'old9'], {
			startLineNumber: 6,
			lines: ['old6', 'old7'],
			pinged: [false, false]
		});
	});


	test('F1', () => {
		testOnModelLinesDeleted(9, 9, ['old9'], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8'],
			pinged: [false, false, false]
		});
	});

	test('F2', () => {
		testOnModelLinesDeleted(9, 10, ['old9'], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8'],
			pinged: [false, false, false]
		});
	});


	test('G1', () => {
		testOnModelLinesDeleted(10, 10, [], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('G2', () => {
		testOnModelLinesDeleted(10, 11, [], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});


	test('H1', () => {
		testOnModelLinesDeleted(11, 13, [], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});
});

suite('RenderedLinesCollection onLineChanged', () => {

	function testOnModelLineChanged(changedLineNumber: number, expectedPinged: boolean, expectedState: ILinesCollectionState): void {
		let col = new RenderedLinesCollection<TestLine>(() => new TestLine('new'));
		col._set(6, [
			new TestLine('old6'),
			new TestLine('old7'),
			new TestLine('old8'),
			new TestLine('old9')
		]);
		let actualPinged = col.onLinesChanged(changedLineNumber, changedLineNumber);
		assert.deepEqual(actualPinged, expectedPinged);
		assertState(col, expectedState);
	}

	test('3', () => {
		testOnModelLineChanged(3, false, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});
	test('4', () => {
		testOnModelLineChanged(4, false, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});
	test('5', () => {
		testOnModelLineChanged(5, false, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});
	test('6', () => {
		testOnModelLineChanged(6, true, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [true, false, false, false]
		});
	});
	test('7', () => {
		testOnModelLineChanged(7, true, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, true, false, false]
		});
	});
	test('8', () => {
		testOnModelLineChanged(8, true, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, true, false]
		});
	});
	test('9', () => {
		testOnModelLineChanged(9, true, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, true]
		});
	});
	test('10', () => {
		testOnModelLineChanged(10, false, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});
	test('11', () => {
		testOnModelLineChanged(11, false, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

});

suite('RenderedLinesCollection onLinesInserted', () => {

	function testOnModelLinesInserted(insertFromLineNumber: number, insertToLineNumber: number, expectedDeleted: string[], expectedState: ILinesCollectionState): void {
		let col = new RenderedLinesCollection<TestLine>(() => new TestLine('new'));
		col._set(6, [
			new TestLine('old6'),
			new TestLine('old7'),
			new TestLine('old8'),
			new TestLine('old9')
		]);
		let actualDeleted1 = col.onLinesInserted(insertFromLineNumber, insertToLineNumber);
		let actualDeleted: string[] = [];
		if (actualDeleted1) {
			actualDeleted = actualDeleted1.map(line => line.id);
		}
		assert.deepEqual(actualDeleted, expectedDeleted);
		assertState(col, expectedState);
	}

	test('A1', () => {
		testOnModelLinesInserted(3, 3, [], {
			startLineNumber: 7,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('A2', () => {
		testOnModelLinesInserted(3, 4, [], {
			startLineNumber: 8,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('A3', () => {
		testOnModelLinesInserted(3, 5, [], {
			startLineNumber: 9,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('A4', () => {
		testOnModelLinesInserted(3, 6, [], {
			startLineNumber: 10,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('A5', () => {
		testOnModelLinesInserted(3, 7, [], {
			startLineNumber: 11,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('A6', () => {
		testOnModelLinesInserted(3, 8, [], {
			startLineNumber: 12,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('A7', () => {
		testOnModelLinesInserted(3, 9, [], {
			startLineNumber: 13,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('A8', () => {
		testOnModelLinesInserted(3, 10, [], {
			startLineNumber: 14,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});


	test('B1', () => {
		testOnModelLinesInserted(5, 5, [], {
			startLineNumber: 7,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('B2', () => {
		testOnModelLinesInserted(5, 6, [], {
			startLineNumber: 8,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('B3', () => {
		testOnModelLinesInserted(5, 7, [], {
			startLineNumber: 9,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('B4', () => {
		testOnModelLinesInserted(5, 8, [], {
			startLineNumber: 10,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('B5', () => {
		testOnModelLinesInserted(5, 9, [], {
			startLineNumber: 11,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('B6', () => {
		testOnModelLinesInserted(5, 10, [], {
			startLineNumber: 12,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});


	test('C1', () => {
		testOnModelLinesInserted(6, 6, [], {
			startLineNumber: 7,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('C2', () => {
		testOnModelLinesInserted(6, 7, [], {
			startLineNumber: 8,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('C3', () => {
		testOnModelLinesInserted(6, 8, [], {
			startLineNumber: 9,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('C4', () => {
		testOnModelLinesInserted(6, 9, [], {
			startLineNumber: 10,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('C5', () => {
		testOnModelLinesInserted(6, 10, [], {
			startLineNumber: 11,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});


	test('D1', () => {
		testOnModelLinesInserted(7, 7, ['old9'], {
			startLineNumber: 6,
			lines: ['old6', 'new', 'old7', 'old8'],
			pinged: [false, false, false, false]
		});
	});

	test('D2', () => {
		testOnModelLinesInserted(7, 8, ['old8', 'old9'], {
			startLineNumber: 6,
			lines: ['old6', 'new', 'new', 'old7'],
			pinged: [false, false, false, false]
		});
	});

	test('D3', () => {
		testOnModelLinesInserted(7, 9, ['old7', 'old8', 'old9'], {
			startLineNumber: 6,
			lines: ['old6'],
			pinged: [false]
		});
	});

	test('D4', () => {
		testOnModelLinesInserted(7, 10, ['old7', 'old8', 'old9'], {
			startLineNumber: 6,
			lines: ['old6'],
			pinged: [false]
		});
	});


	test('E1', () => {
		testOnModelLinesInserted(8, 8, ['old9'], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'new', 'old8'],
			pinged: [false, false, false, false]
		});
	});

	test('E2', () => {
		testOnModelLinesInserted(8, 9, ['old8', 'old9'], {
			startLineNumber: 6,
			lines: ['old6', 'old7'],
			pinged: [false, false]
		});
	});

	test('E3', () => {
		testOnModelLinesInserted(8, 10, ['old8', 'old9'], {
			startLineNumber: 6,
			lines: ['old6', 'old7'],
			pinged: [false, false]
		});
	});


	test('F1', () => {
		testOnModelLinesInserted(9, 9, ['old9'], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8'],
			pinged: [false, false, false]
		});
	});

	test('F2', () => {
		testOnModelLinesInserted(9, 10, ['old9'], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8'],
			pinged: [false, false, false]
		});
	});


	test('G1', () => {
		testOnModelLinesInserted(10, 10, [], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});

	test('G2', () => {
		testOnModelLinesInserted(10, 11, [], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});


	test('H1', () => {
		testOnModelLinesInserted(11, 13, [], {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});
});


suite('RenderedLinesCollection onTokensChanged', () => {

	function testOnModelTokensChanged(changedFromLineNumber: number, changedToLineNumber: number, expectedPinged: boolean, expectedState: ILinesCollectionState): void {
		let col = new RenderedLinesCollection<TestLine>(() => new TestLine('new'));
		col._set(6, [
			new TestLine('old6'),
			new TestLine('old7'),
			new TestLine('old8'),
			new TestLine('old9')
		]);
		let actualPinged = col.onTokensChanged([{ fromLineNumber: changedFromLineNumber, toLineNumber: changedToLineNumber }]);
		assert.deepEqual(actualPinged, expectedPinged);
		assertState(col, expectedState);
	}

	test('A', () => {
		testOnModelTokensChanged(3, 3, false, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});
	test('B', () => {
		testOnModelTokensChanged(3, 5, false, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});
	test('C', () => {
		testOnModelTokensChanged(3, 6, true, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [true, false, false, false]
		});
	});
	test('D', () => {
		testOnModelTokensChanged(6, 6, true, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [true, false, false, false]
		});
	});
	test('E', () => {
		testOnModelTokensChanged(5, 10, true, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [true, true, true, true]
		});
	});
	test('F', () => {
		testOnModelTokensChanged(8, 9, true, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, true, true]
		});
	});
	test('G', () => {
		testOnModelTokensChanged(8, 11, true, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, true, true]
		});
	});
	test('H', () => {
		testOnModelTokensChanged(10, 10, false, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});
	test('I', () => {
		testOnModelTokensChanged(10, 11, false, {
			startLineNumber: 6,
			lines: ['old6', 'old7', 'old8', 'old9'],
			pinged: [false, false, false, false]
		});
	});
});
