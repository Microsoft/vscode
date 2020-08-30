/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { SmoothScrollingOperation, SmoothScrollingUpdate } from 'vs/base/common/scrollable';

class TestSmoothScrollingOperation extends SmoothScrollingOperation {

	constructor(from: number, to: number, viewportSize: number, startTime: number, duration: number) {
		duration = duration + 10;
		startTime = startTime - 10;

		super(
			{ scrollLeft: 0, scrollTop: from, width: 0, height: viewportSize },
			{ scrollLeft: 0, scrollTop: to, width: 0, height: viewportSize },
			startTime,
			duration
		);
	}

	public testTick(now: number): SmoothScrollingUpdate {
		return this._tick(now);
	}

}

suite('SmoothScrollingOperation', () => {

	const VIEWPORT_HEIGHT = 800;
	const ANIMATION_DURATION = 125;
	const LINE_HEIGHT = 20;

	function extractLines(scrollable: TestSmoothScrollingOperation, now: number): [number, number] {
		let scrollTop = scrollable.testTick(now).scrollTop;
		let scrollBottom = scrollTop + VIEWPORT_HEIGHT;

		const startLineNumber = Math.floor(scrollTop / LINE_HEIGHT);
		const endLineNumber = Math.ceil(scrollBottom / LINE_HEIGHT);

		return [startLineNumber, endLineNumber];
	}

	function simulateSmoothScroll(from: number, to: number): [number, number][] {
		const scrollable = new TestSmoothScrollingOperation(from, to, VIEWPORT_HEIGHT, 0, ANIMATION_DURATION);

		let result: [number, number][] = [], resultLen = 0;
		result[resultLen++] = extractLines(scrollable, 0);
		result[resultLen++] = extractLines(scrollable, 25);
		result[resultLen++] = extractLines(scrollable, 50);
		result[resultLen++] = extractLines(scrollable, 75);
		result[resultLen++] = extractLines(scrollable, 100);
		result[resultLen++] = extractLines(scrollable, 125);
		return result;
	}

	function assertSmoothScroll(from: number, to: number, expected: [number, number][]): void {
		const actual = simulateSmoothScroll(from, to);
		assert.deepEqual(actual, expected);
	}

	test('scroll 25 lines (40 fit)', () => {
		assertSmoothScroll(0, 500, [
			[5, 46],
			[14, 55],
			[20, 61],
			[23, 64],
			[24, 65],
			[25, 65],
		]);
	});

	test('scroll 75 lines (40 fit)', () => {
		assertSmoothScroll(0, 1500, [
			[15, 56],
			[44, 85],
			[62, 103],
			[71, 112],
			[74, 115],
			[75, 115],
		]);
	});

	test('scroll 100 lines (40 fit)', () => {
		assertSmoothScroll(0, 2000, [
			[20, 61],
			[59, 100],
			[82, 123],
			[94, 135],
			[99, 140],
			[100, 140],
		]);
	});

	test('scroll 125 lines (40 fit)', () => {
		assertSmoothScroll(0, 2500, [
			[16, 57],
			[29, 70],
			[107, 148],
			[119, 160],
			[124, 165],
			[125, 165],
		]);
	});

	test('scroll 500 lines (40 fit)', () => {
		assertSmoothScroll(0, 10000, [
			[16, 57],
			[29, 70],
			[482, 523],
			[494, 535],
			[499, 540],
			[500, 540],
		]);
	});

});
