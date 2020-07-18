/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { LinesLayout, EditorWhitespace } from 'vs/editor/common/viewLayout/linesLayout';

suite('Editor ViewLayout - LinesLayout', () => {

	function insertWhitespace(linesLayout: LinesLayout, afterLineNumber: number, ordinal: number, heightInPx: number, minWidth: number): string {
		let id: string;
		linesLayout.changeWhitespace((accessor) => {
			id = accessor.insertWhitespace(afterLineNumber, ordinal, heightInPx, minWidth);
		});
		return id!;
	}

	function changeOneWhitespace(linesLayout: LinesLayout, id: string, newAfterLineNumber: number, newHeight: number): void {
		linesLayout.changeWhitespace((accessor) => {
			accessor.changeOneWhitespace(id, newAfterLineNumber, newHeight);
		});
	}

	function removeWhitespace(linesLayout: LinesLayout, id: string): void {
		linesLayout.changeWhitespace((accessor) => {
			accessor.removeWhitespace(id);
		});
	}

	test('LinesLayout 1', () => {

		// Start off with 10 lines
		let linesLayout = new LinesLayout(10, 10, 0, 0);

		// lines: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
		// whitespace: -
		assert.equal(linesLayout.getLinesTotalHeight(), 100);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 10);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 20);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 30);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 40);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 50);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 60);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 70);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 80);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 90);

		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(0), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(1), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(5), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(9), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(10), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(11), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(15), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(19), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(20), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(21), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(29), 3);

		// Add whitespace of height 5px after 2nd line
		insertWhitespace(linesLayout, 2, 0, 5, 0);
		// lines: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
		// whitespace: a(2,5)
		assert.equal(linesLayout.getLinesTotalHeight(), 105);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 10);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 25);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 35);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 45);

		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(0), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(1), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(9), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(10), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(20), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(21), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(24), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(25), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(35), 4);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(45), 5);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(104), 10);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(105), 10);

		// Add two more whitespaces of height 5px
		insertWhitespace(linesLayout, 3, 0, 5, 0);
		insertWhitespace(linesLayout, 4, 0, 5, 0);
		// lines: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
		// whitespace: a(2,5), b(3, 5), c(4, 5)
		assert.equal(linesLayout.getLinesTotalHeight(), 115);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 10);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 25);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 40);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 55);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 65);

		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(0), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(1), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(9), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(10), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(19), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(20), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(34), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(35), 4);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(49), 4);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(50), 5);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(64), 5);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(65), 6);

		assert.equal(linesLayout.getVerticalOffsetForWhitespaceIndex(0), 20); // 20 -> 25
		assert.equal(linesLayout.getVerticalOffsetForWhitespaceIndex(1), 35); // 35 -> 40
		assert.equal(linesLayout.getVerticalOffsetForWhitespaceIndex(2), 50);

		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(0), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(19), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(20), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(21), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(22), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(23), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(24), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(25), 1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(26), 1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(34), 1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(35), 1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(36), 1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(39), 1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(40), 2);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(41), 2);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(49), 2);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(50), 2);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(51), 2);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(54), 2);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(55), -1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(1000), -1);

	});

	test('LinesLayout 2', () => {

		// Start off with 10 lines and one whitespace after line 2, of height 5
		let linesLayout = new LinesLayout(10, 1, 0, 0);
		let a = insertWhitespace(linesLayout, 2, 0, 5, 0);

		// 10 lines
		// whitespace: - a(2,5)
		assert.equal(linesLayout.getLinesTotalHeight(), 15);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 1);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 7);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 8);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 9);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 10);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 11);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 12);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 13);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 14);

		// Change whitespace height
		// 10 lines
		// whitespace: - a(2,10)
		changeOneWhitespace(linesLayout, a, 2, 10);
		assert.equal(linesLayout.getLinesTotalHeight(), 20);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 1);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 12);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 13);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 14);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 15);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 16);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 17);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 18);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 19);

		// Change whitespace position
		// 10 lines
		// whitespace: - a(5,10)
		changeOneWhitespace(linesLayout, a, 5, 10);
		assert.equal(linesLayout.getLinesTotalHeight(), 20);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 1);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 2);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 3);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 4);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 15);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 16);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 17);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 18);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 19);

		// Pretend that lines 5 and 6 were deleted
		// 8 lines
		// whitespace: - a(4,10)
		linesLayout.onLinesDeleted(5, 6);
		assert.equal(linesLayout.getLinesTotalHeight(), 18);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 1);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 2);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 3);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 14);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 15);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 16);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 17);

		// Insert two lines at the beginning
		// 10 lines
		// whitespace: - a(6,10)
		linesLayout.onLinesInserted(1, 2);
		assert.equal(linesLayout.getLinesTotalHeight(), 20);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 1);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 2);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 3);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 4);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 5);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 16);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 17);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 18);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 19);

		// Remove whitespace
		// 10 lines
		removeWhitespace(linesLayout, a);
		assert.equal(linesLayout.getLinesTotalHeight(), 10);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 1);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 2);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 3);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 4);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 5);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 6);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 7);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 8);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 9);
	});

	test('LinesLayout Padding', () => {
		// Start off with 10 lines
		let linesLayout = new LinesLayout(10, 10, 15, 20);

		// lines: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
		// whitespace: -
		assert.equal(linesLayout.getLinesTotalHeight(), 135);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 15);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 25);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 35);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 45);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 55);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 65);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 75);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 85);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 95);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 105);

		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(0), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(10), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(15), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(24), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(25), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(34), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(35), 3);

		// Add whitespace of height 5px after 2nd line
		insertWhitespace(linesLayout, 2, 0, 5, 0);
		// lines: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
		// whitespace: a(2,5)
		assert.equal(linesLayout.getLinesTotalHeight(), 140);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 15);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 25);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 40);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 50);

		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(0), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(10), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(25), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(34), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(35), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(39), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(40), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(41), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(49), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(50), 4);

		// Add two more whitespaces of height 5px
		insertWhitespace(linesLayout, 3, 0, 5, 0);
		insertWhitespace(linesLayout, 4, 0, 5, 0);
		// lines: [0, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]
		// whitespace: a(2,5), b(3, 5), c(4, 5)
		assert.equal(linesLayout.getLinesTotalHeight(), 150);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 15);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 25);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 40);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 55);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 70);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 80);

		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(0), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(15), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(24), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(30), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(35), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(39), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(40), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(49), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(50), 4);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(54), 4);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(55), 4);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(64), 4);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(65), 5);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(69), 5);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(70), 5);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(80), 6);

		assert.equal(linesLayout.getVerticalOffsetForWhitespaceIndex(0), 35); // 35 -> 40
		assert.equal(linesLayout.getVerticalOffsetForWhitespaceIndex(1), 50); // 50 -> 55
		assert.equal(linesLayout.getVerticalOffsetForWhitespaceIndex(2), 65);

		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(0), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(34), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(35), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(39), 0);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(40), 1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(49), 1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(50), 1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(54), 1);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(55), 2);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(64), 2);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(65), 2);
		assert.equal(linesLayout.getWhitespaceIndexAtOrAfterVerticallOffset(70), -1);
	});

	test('LinesLayout getLineNumberAtOrAfterVerticalOffset', () => {
		let linesLayout = new LinesLayout(10, 1, 0, 0);
		insertWhitespace(linesLayout, 6, 0, 10, 0);

		// 10 lines
		// whitespace: - a(6,10)
		assert.equal(linesLayout.getLinesTotalHeight(), 20);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 1);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 2);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 3);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 4);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 5);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 16);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 17);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 18);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 19);

		// Do some hit testing
		// line      [1, 2, 3, 4, 5, 6,  7,  8,  9, 10]
		// vertical: [0, 1, 2, 3, 4, 5, 16, 17, 18, 19]
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(-100), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(-1), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(0), 1);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(1), 2);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(2), 3);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(3), 4);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(4), 5);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(5), 6);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(6), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(7), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(8), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(9), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(10), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(11), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(12), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(13), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(14), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(15), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(16), 7);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(17), 8);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(18), 9);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(19), 10);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(20), 10);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(21), 10);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(22), 10);
		assert.equal(linesLayout.getLineNumberAtOrAfterVerticalOffset(23), 10);
	});

	test('LinesLayout getCenteredLineInViewport', () => {
		let linesLayout = new LinesLayout(10, 1, 0, 0);
		insertWhitespace(linesLayout, 6, 0, 10, 0);

		// 10 lines
		// whitespace: - a(6,10)
		assert.equal(linesLayout.getLinesTotalHeight(), 20);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 1);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 2);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 3);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 4);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 5);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 16);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 17);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 18);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 19);

		// Find centered line in viewport 1
		// line      [1, 2, 3, 4, 5, 6,  7,  8,  9, 10]
		// vertical: [0, 1, 2, 3, 4, 5, 16, 17, 18, 19]
		assert.equal(linesLayout.getLinesViewportData(0, 1).centeredLineNumber, 1);
		assert.equal(linesLayout.getLinesViewportData(0, 2).centeredLineNumber, 2);
		assert.equal(linesLayout.getLinesViewportData(0, 3).centeredLineNumber, 2);
		assert.equal(linesLayout.getLinesViewportData(0, 4).centeredLineNumber, 3);
		assert.equal(linesLayout.getLinesViewportData(0, 5).centeredLineNumber, 3);
		assert.equal(linesLayout.getLinesViewportData(0, 6).centeredLineNumber, 4);
		assert.equal(linesLayout.getLinesViewportData(0, 7).centeredLineNumber, 4);
		assert.equal(linesLayout.getLinesViewportData(0, 8).centeredLineNumber, 5);
		assert.equal(linesLayout.getLinesViewportData(0, 9).centeredLineNumber, 5);
		assert.equal(linesLayout.getLinesViewportData(0, 10).centeredLineNumber, 6);
		assert.equal(linesLayout.getLinesViewportData(0, 11).centeredLineNumber, 6);
		assert.equal(linesLayout.getLinesViewportData(0, 12).centeredLineNumber, 6);
		assert.equal(linesLayout.getLinesViewportData(0, 13).centeredLineNumber, 6);
		assert.equal(linesLayout.getLinesViewportData(0, 14).centeredLineNumber, 6);
		assert.equal(linesLayout.getLinesViewportData(0, 15).centeredLineNumber, 6);
		assert.equal(linesLayout.getLinesViewportData(0, 16).centeredLineNumber, 6);
		assert.equal(linesLayout.getLinesViewportData(0, 17).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 18).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 19).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 21).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 22).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 23).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 24).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 25).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 26).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 27).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 28).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 29).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 30).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 31).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 32).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(0, 33).centeredLineNumber, 7);

		// Find centered line in viewport 2
		// line      [1, 2, 3, 4, 5, 6,  7,  8,  9, 10]
		// vertical: [0, 1, 2, 3, 4, 5, 16, 17, 18, 19]
		assert.equal(linesLayout.getLinesViewportData(0, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(1, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(2, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(3, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(4, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(5, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(6, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(7, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(8, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(9, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(10, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(11, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(12, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(13, 20).centeredLineNumber, 7);
		assert.equal(linesLayout.getLinesViewportData(14, 20).centeredLineNumber, 8);
		assert.equal(linesLayout.getLinesViewportData(15, 20).centeredLineNumber, 8);
		assert.equal(linesLayout.getLinesViewportData(16, 20).centeredLineNumber, 9);
		assert.equal(linesLayout.getLinesViewportData(17, 20).centeredLineNumber, 9);
		assert.equal(linesLayout.getLinesViewportData(18, 20).centeredLineNumber, 10);
		assert.equal(linesLayout.getLinesViewportData(19, 20).centeredLineNumber, 10);
		assert.equal(linesLayout.getLinesViewportData(20, 23).centeredLineNumber, 10);
		assert.equal(linesLayout.getLinesViewportData(21, 23).centeredLineNumber, 10);
		assert.equal(linesLayout.getLinesViewportData(22, 23).centeredLineNumber, 10);
	});

	test('LinesLayout getLinesViewportData 1', () => {
		let linesLayout = new LinesLayout(10, 10, 0, 0);
		insertWhitespace(linesLayout, 6, 0, 100, 0);

		// 10 lines
		// whitespace: - a(6,100)
		assert.equal(linesLayout.getLinesTotalHeight(), 200);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 10);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 20);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 30);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 40);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 50);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 160);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 170);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 180);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 190);

		// viewport 0->50
		let viewportData = linesLayout.getLinesViewportData(0, 50);
		assert.equal(viewportData.startLineNumber, 1);
		assert.equal(viewportData.endLineNumber, 5);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 1);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 5);
		assert.deepEqual(viewportData.relativeVerticalOffset, [0, 10, 20, 30, 40]);

		// viewport 1->51
		viewportData = linesLayout.getLinesViewportData(1, 51);
		assert.equal(viewportData.startLineNumber, 1);
		assert.equal(viewportData.endLineNumber, 6);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 2);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 5);
		assert.deepEqual(viewportData.relativeVerticalOffset, [0, 10, 20, 30, 40, 50]);

		// viewport 5->55
		viewportData = linesLayout.getLinesViewportData(5, 55);
		assert.equal(viewportData.startLineNumber, 1);
		assert.equal(viewportData.endLineNumber, 6);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 2);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 5);
		assert.deepEqual(viewportData.relativeVerticalOffset, [0, 10, 20, 30, 40, 50]);

		// viewport 10->60
		viewportData = linesLayout.getLinesViewportData(10, 60);
		assert.equal(viewportData.startLineNumber, 2);
		assert.equal(viewportData.endLineNumber, 6);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 2);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 6);
		assert.deepEqual(viewportData.relativeVerticalOffset, [10, 20, 30, 40, 50]);

		// viewport 50->100
		viewportData = linesLayout.getLinesViewportData(50, 100);
		assert.equal(viewportData.startLineNumber, 6);
		assert.equal(viewportData.endLineNumber, 6);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 6);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 6);
		assert.deepEqual(viewportData.relativeVerticalOffset, [50]);

		// viewport 60->110
		viewportData = linesLayout.getLinesViewportData(60, 110);
		assert.equal(viewportData.startLineNumber, 7);
		assert.equal(viewportData.endLineNumber, 7);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 7);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 7);
		assert.deepEqual(viewportData.relativeVerticalOffset, [160]);

		// viewport 65->115
		viewportData = linesLayout.getLinesViewportData(65, 115);
		assert.equal(viewportData.startLineNumber, 7);
		assert.equal(viewportData.endLineNumber, 7);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 7);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 7);
		assert.deepEqual(viewportData.relativeVerticalOffset, [160]);

		// viewport 50->159
		viewportData = linesLayout.getLinesViewportData(50, 159);
		assert.equal(viewportData.startLineNumber, 6);
		assert.equal(viewportData.endLineNumber, 6);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 6);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 6);
		assert.deepEqual(viewportData.relativeVerticalOffset, [50]);

		// viewport 50->160
		viewportData = linesLayout.getLinesViewportData(50, 160);
		assert.equal(viewportData.startLineNumber, 6);
		assert.equal(viewportData.endLineNumber, 6);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 6);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 6);
		assert.deepEqual(viewportData.relativeVerticalOffset, [50]);

		// viewport 51->161
		viewportData = linesLayout.getLinesViewportData(51, 161);
		assert.equal(viewportData.startLineNumber, 6);
		assert.equal(viewportData.endLineNumber, 7);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 7);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 7);
		assert.deepEqual(viewportData.relativeVerticalOffset, [50, 160]);


		// viewport 150->169
		viewportData = linesLayout.getLinesViewportData(150, 169);
		assert.equal(viewportData.startLineNumber, 7);
		assert.equal(viewportData.endLineNumber, 7);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 7);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 7);
		assert.deepEqual(viewportData.relativeVerticalOffset, [160]);

		// viewport 159->169
		viewportData = linesLayout.getLinesViewportData(159, 169);
		assert.equal(viewportData.startLineNumber, 7);
		assert.equal(viewportData.endLineNumber, 7);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 7);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 7);
		assert.deepEqual(viewportData.relativeVerticalOffset, [160]);

		// viewport 160->169
		viewportData = linesLayout.getLinesViewportData(160, 169);
		assert.equal(viewportData.startLineNumber, 7);
		assert.equal(viewportData.endLineNumber, 7);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 7);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 7);
		assert.deepEqual(viewportData.relativeVerticalOffset, [160]);


		// viewport 160->1000
		viewportData = linesLayout.getLinesViewportData(160, 1000);
		assert.equal(viewportData.startLineNumber, 7);
		assert.equal(viewportData.endLineNumber, 10);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 7);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 10);
		assert.deepEqual(viewportData.relativeVerticalOffset, [160, 170, 180, 190]);
	});

	test('LinesLayout getLinesViewportData 2 & getWhitespaceViewportData', () => {
		let linesLayout = new LinesLayout(10, 10, 0, 0);
		let a = insertWhitespace(linesLayout, 6, 0, 100, 0);
		let b = insertWhitespace(linesLayout, 7, 0, 50, 0);

		// 10 lines
		// whitespace: - a(6,100), b(7, 50)
		assert.equal(linesLayout.getLinesTotalHeight(), 250);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(1), 0);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(2), 10);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(3), 20);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(4), 30);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(5), 40);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(6), 50);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(7), 160);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(8), 220);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(9), 230);
		assert.equal(linesLayout.getVerticalOffsetForLineNumber(10), 240);

		// viewport 50->160
		let viewportData = linesLayout.getLinesViewportData(50, 160);
		assert.equal(viewportData.startLineNumber, 6);
		assert.equal(viewportData.endLineNumber, 6);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 6);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 6);
		assert.deepEqual(viewportData.relativeVerticalOffset, [50]);
		let whitespaceData = linesLayout.getWhitespaceViewportData(50, 160);
		assert.deepEqual(whitespaceData, [{
			id: a,
			afterLineNumber: 6,
			verticalOffset: 60,
			height: 100
		}]);

		// viewport 50->219
		viewportData = linesLayout.getLinesViewportData(50, 219);
		assert.equal(viewportData.startLineNumber, 6);
		assert.equal(viewportData.endLineNumber, 7);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 6);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 7);
		assert.deepEqual(viewportData.relativeVerticalOffset, [50, 160]);
		whitespaceData = linesLayout.getWhitespaceViewportData(50, 219);
		assert.deepEqual(whitespaceData, [{
			id: a,
			afterLineNumber: 6,
			verticalOffset: 60,
			height: 100
		}, {
			id: b,
			afterLineNumber: 7,
			verticalOffset: 170,
			height: 50
		}]);

		// viewport 50->220
		viewportData = linesLayout.getLinesViewportData(50, 220);
		assert.equal(viewportData.startLineNumber, 6);
		assert.equal(viewportData.endLineNumber, 7);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 6);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 7);
		assert.deepEqual(viewportData.relativeVerticalOffset, [50, 160]);

		// viewport 50->250
		viewportData = linesLayout.getLinesViewportData(50, 250);
		assert.equal(viewportData.startLineNumber, 6);
		assert.equal(viewportData.endLineNumber, 10);
		assert.equal(viewportData.completelyVisibleStartLineNumber, 6);
		assert.equal(viewportData.completelyVisibleEndLineNumber, 10);
		assert.deepEqual(viewportData.relativeVerticalOffset, [50, 160, 220, 230, 240]);
	});

	test('LinesLayout getWhitespaceAtVerticalOffset', () => {
		let linesLayout = new LinesLayout(10, 10, 0, 0);
		let a = insertWhitespace(linesLayout, 6, 0, 100, 0);
		let b = insertWhitespace(linesLayout, 7, 0, 50, 0);

		let whitespace = linesLayout.getWhitespaceAtVerticalOffset(0);
		assert.equal(whitespace, null);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(59);
		assert.equal(whitespace, null);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(60);
		assert.equal(whitespace!.id, a);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(61);
		assert.equal(whitespace!.id, a);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(159);
		assert.equal(whitespace!.id, a);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(160);
		assert.equal(whitespace, null);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(161);
		assert.equal(whitespace, null);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(169);
		assert.equal(whitespace, null);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(170);
		assert.equal(whitespace!.id, b);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(171);
		assert.equal(whitespace!.id, b);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(219);
		assert.equal(whitespace!.id, b);

		whitespace = linesLayout.getWhitespaceAtVerticalOffset(220);
		assert.equal(whitespace, null);
	});

	test('LinesLayout', () => {

		const linesLayout = new LinesLayout(100, 20, 0, 0);

		// Insert a whitespace after line number 2, of height 10
		const a = insertWhitespace(linesLayout, 2, 0, 10, 0);
		// whitespaces: a(2, 10)
		assert.equal(linesLayout.getWhitespacesCount(), 1);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 10);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 10);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 10);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 10);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 10);

		// Insert a whitespace again after line number 2, of height 20
		let b = insertWhitespace(linesLayout, 2, 0, 20, 0);
		// whitespaces: a(2, 10), b(2, 20)
		assert.equal(linesLayout.getWhitespacesCount(), 2);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 10);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 20);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 10);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 30);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 30);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 30);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 30);

		// Change last inserted whitespace height to 30
		changeOneWhitespace(linesLayout, b, 2, 30);
		// whitespaces: a(2, 10), b(2, 30)
		assert.equal(linesLayout.getWhitespacesCount(), 2);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 10);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 30);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 10);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 40);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 40);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 40);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 40);

		// Remove last inserted whitespace
		removeWhitespace(linesLayout, b);
		// whitespaces: a(2, 10)
		assert.equal(linesLayout.getWhitespacesCount(), 1);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 10);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 10);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 10);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 10);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 10);

		// Add a whitespace before the first line of height 50
		b = insertWhitespace(linesLayout, 0, 0, 50, 0);
		// whitespaces: b(0, 50), a(2, 10)
		assert.equal(linesLayout.getWhitespacesCount(), 2);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 0);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 50);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 10);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 50);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 60);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 60);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 60);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 60);

		// Add a whitespace after line 4 of height 20
		insertWhitespace(linesLayout, 4, 0, 20, 0);
		// whitespaces: b(0, 50), a(2, 10), c(4, 20)
		assert.equal(linesLayout.getWhitespacesCount(), 3);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 0);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 50);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 10);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(2), 4);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(2), 20);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 50);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 60);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(2), 80);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 80);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 60);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 60);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(5), 80);

		// Add a whitespace after line 3 of height 30
		insertWhitespace(linesLayout, 3, 0, 30, 0);
		// whitespaces: b(0, 50), a(2, 10), d(3, 30), c(4, 20)
		assert.equal(linesLayout.getWhitespacesCount(), 4);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 0);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 50);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 10);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(2), 3);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(2), 30);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(3), 4);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(3), 20);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 50);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 60);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(2), 90);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(3), 110);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 110);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 60);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 90);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(5), 110);

		// Change whitespace after line 2 to height of 100
		changeOneWhitespace(linesLayout, a, 2, 100);
		// whitespaces: b(0, 50), a(2, 100), d(3, 30), c(4, 20)
		assert.equal(linesLayout.getWhitespacesCount(), 4);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 0);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 50);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 100);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(2), 3);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(2), 30);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(3), 4);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(3), 20);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 50);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 150);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(2), 180);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(3), 200);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 200);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 150);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 180);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(5), 200);

		// Remove whitespace after line 2
		removeWhitespace(linesLayout, a);
		// whitespaces: b(0, 50), d(3, 30), c(4, 20)
		assert.equal(linesLayout.getWhitespacesCount(), 3);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 0);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 50);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 3);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 30);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(2), 4);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(2), 20);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 50);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 80);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(2), 100);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 100);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 80);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(5), 100);

		// Remove whitespace before line 1
		removeWhitespace(linesLayout, b);
		// whitespaces: d(3, 30), c(4, 20)
		assert.equal(linesLayout.getWhitespacesCount(), 2);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 3);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 30);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 4);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 20);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 30);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 50);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 30);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(5), 50);

		// Delete line 1
		linesLayout.onLinesDeleted(1, 1);
		// whitespaces: d(2, 30), c(3, 20)
		assert.equal(linesLayout.getWhitespacesCount(), 2);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 2);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 30);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 3);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 20);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 30);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 50);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 30);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(5), 50);

		// Insert a line before line 1
		linesLayout.onLinesInserted(1, 1);
		// whitespaces: d(3, 30), c(4, 20)
		assert.equal(linesLayout.getWhitespacesCount(), 2);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 3);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 30);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 4);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 20);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 30);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 50);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 30);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(5), 50);

		// Delete line 4
		linesLayout.onLinesDeleted(4, 4);
		// whitespaces: d(3, 30), c(3, 20)
		assert.equal(linesLayout.getWhitespacesCount(), 2);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 3);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(0), 30);
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 3);
		assert.equal(linesLayout.getHeightForWhitespaceIndex(1), 20);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(0), 30);
		assert.equal(linesLayout.getWhitespacesAccumulatedHeight(1), 50);
		assert.equal(linesLayout.getWhitespacesTotalHeight(), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(1), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(2), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(3), 0);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(4), 50);
		assert.equal(linesLayout.getWhitespaceAccumulatedHeightBeforeLineNumber(5), 50);
	});

	test('LinesLayout findInsertionIndex', () => {

		const makeInternalWhitespace = (afterLineNumbers: number[], ordinal: number = 0) => {
			return afterLineNumbers.map((afterLineNumber) => new EditorWhitespace('', afterLineNumber, ordinal, 0, 0));
		};

		let arr: EditorWhitespace[];

		arr = makeInternalWhitespace([]);
		assert.equal(LinesLayout.findInsertionIndex(arr, 0, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 1, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 2, 0), 0);

		arr = makeInternalWhitespace([1]);
		assert.equal(LinesLayout.findInsertionIndex(arr, 0, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 1, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 2, 0), 1);

		arr = makeInternalWhitespace([1, 3]);
		assert.equal(LinesLayout.findInsertionIndex(arr, 0, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 1, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 2, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 3, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 4, 0), 2);

		arr = makeInternalWhitespace([1, 3, 5]);
		assert.equal(LinesLayout.findInsertionIndex(arr, 0, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 1, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 2, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 3, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 4, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 5, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 6, 0), 3);

		arr = makeInternalWhitespace([1, 3, 5], 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 0, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 1, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 2, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 3, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 4, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 5, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 6, 0), 3);

		arr = makeInternalWhitespace([1, 3, 5, 7]);
		assert.equal(LinesLayout.findInsertionIndex(arr, 0, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 1, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 2, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 3, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 4, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 5, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 6, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 7, 0), 4);
		assert.equal(LinesLayout.findInsertionIndex(arr, 8, 0), 4);

		arr = makeInternalWhitespace([1, 3, 5, 7, 9]);
		assert.equal(LinesLayout.findInsertionIndex(arr, 0, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 1, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 2, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 3, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 4, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 5, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 6, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 7, 0), 4);
		assert.equal(LinesLayout.findInsertionIndex(arr, 8, 0), 4);
		assert.equal(LinesLayout.findInsertionIndex(arr, 9, 0), 5);
		assert.equal(LinesLayout.findInsertionIndex(arr, 10, 0), 5);

		arr = makeInternalWhitespace([1, 3, 5, 7, 9, 11]);
		assert.equal(LinesLayout.findInsertionIndex(arr, 0, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 1, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 2, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 3, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 4, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 5, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 6, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 7, 0), 4);
		assert.equal(LinesLayout.findInsertionIndex(arr, 8, 0), 4);
		assert.equal(LinesLayout.findInsertionIndex(arr, 9, 0), 5);
		assert.equal(LinesLayout.findInsertionIndex(arr, 10, 0), 5);
		assert.equal(LinesLayout.findInsertionIndex(arr, 11, 0), 6);
		assert.equal(LinesLayout.findInsertionIndex(arr, 12, 0), 6);

		arr = makeInternalWhitespace([1, 3, 5, 7, 9, 11, 13]);
		assert.equal(LinesLayout.findInsertionIndex(arr, 0, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 1, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 2, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 3, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 4, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 5, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 6, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 7, 0), 4);
		assert.equal(LinesLayout.findInsertionIndex(arr, 8, 0), 4);
		assert.equal(LinesLayout.findInsertionIndex(arr, 9, 0), 5);
		assert.equal(LinesLayout.findInsertionIndex(arr, 10, 0), 5);
		assert.equal(LinesLayout.findInsertionIndex(arr, 11, 0), 6);
		assert.equal(LinesLayout.findInsertionIndex(arr, 12, 0), 6);
		assert.equal(LinesLayout.findInsertionIndex(arr, 13, 0), 7);
		assert.equal(LinesLayout.findInsertionIndex(arr, 14, 0), 7);

		arr = makeInternalWhitespace([1, 3, 5, 7, 9, 11, 13, 15]);
		assert.equal(LinesLayout.findInsertionIndex(arr, 0, 0), 0);
		assert.equal(LinesLayout.findInsertionIndex(arr, 1, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 2, 0), 1);
		assert.equal(LinesLayout.findInsertionIndex(arr, 3, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 4, 0), 2);
		assert.equal(LinesLayout.findInsertionIndex(arr, 5, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 6, 0), 3);
		assert.equal(LinesLayout.findInsertionIndex(arr, 7, 0), 4);
		assert.equal(LinesLayout.findInsertionIndex(arr, 8, 0), 4);
		assert.equal(LinesLayout.findInsertionIndex(arr, 9, 0), 5);
		assert.equal(LinesLayout.findInsertionIndex(arr, 10, 0), 5);
		assert.equal(LinesLayout.findInsertionIndex(arr, 11, 0), 6);
		assert.equal(LinesLayout.findInsertionIndex(arr, 12, 0), 6);
		assert.equal(LinesLayout.findInsertionIndex(arr, 13, 0), 7);
		assert.equal(LinesLayout.findInsertionIndex(arr, 14, 0), 7);
		assert.equal(LinesLayout.findInsertionIndex(arr, 15, 0), 8);
		assert.equal(LinesLayout.findInsertionIndex(arr, 16, 0), 8);
	});

	test('LinesLayout changeWhitespaceAfterLineNumber & getFirstWhitespaceIndexAfterLineNumber', () => {
		const linesLayout = new LinesLayout(100, 20, 0, 0);

		const a = insertWhitespace(linesLayout, 0, 0, 1, 0);
		const b = insertWhitespace(linesLayout, 7, 0, 1, 0);
		const c = insertWhitespace(linesLayout, 3, 0, 1, 0);

		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 0
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 0);
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), c); // 3
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 3);
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), b); // 7
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(2), 7);

		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(1), 1); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(2), 1); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(3), 1); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(4), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(5), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(6), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(7), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(8), -1); // --

		// Do not really move a
		changeOneWhitespace(linesLayout, a, 1, 1);

		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 1
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 1);
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), c); // 3
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 3);
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), b); // 7
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(2), 7);

		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(1), 0); // a
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(2), 1); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(3), 1); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(4), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(5), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(6), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(7), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(8), -1); // --


		// Do not really move a
		changeOneWhitespace(linesLayout, a, 2, 1);

		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 2
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 2);
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), c); // 3
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 3);
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), b); // 7
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(2), 7);

		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(1), 0); // a
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(2), 0); // a
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(3), 1); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(4), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(5), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(6), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(7), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(8), -1); // --


		// Change a to conflict with c => a gets placed after c
		changeOneWhitespace(linesLayout, a, 3, 1);

		assert.equal(linesLayout.getIdForWhitespaceIndex(0), c); // 3
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 3);
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), a); // 3
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 3);
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), b); // 7
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(2), 7);

		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(1), 0); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(2), 0); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(3), 0); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(4), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(5), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(6), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(7), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(8), -1); // --


		// Make a no-op
		changeOneWhitespace(linesLayout, c, 3, 1);

		assert.equal(linesLayout.getIdForWhitespaceIndex(0), c); // 3
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 3);
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), a); // 3
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 3);
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), b); // 7
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(2), 7);

		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(1), 0); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(2), 0); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(3), 0); // c
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(4), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(5), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(6), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(7), 2); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(8), -1); // --



		// Conflict c with b => c gets placed after b
		changeOneWhitespace(linesLayout, c, 7, 1);

		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 3
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(0), 3);
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), b); // 7
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(1), 7);
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), c); // 7
		assert.equal(linesLayout.getAfterLineNumberForWhitespaceIndex(2), 7);

		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(1), 0); // a
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(2), 0); // a
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(3), 0); // a
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(4), 1); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(5), 1); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(6), 1); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(7), 1); // b
		assert.equal(linesLayout.getFirstWhitespaceIndexAfterLineNumber(8), -1); // --
	});

	test('LinesLayout Bug', () => {
		const linesLayout = new LinesLayout(100, 20, 0, 0);

		const a = insertWhitespace(linesLayout, 0, 0, 1, 0);
		const b = insertWhitespace(linesLayout, 7, 0, 1, 0);

		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 0
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), b); // 7

		const c = insertWhitespace(linesLayout, 3, 0, 1, 0);

		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 0
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), c); // 3
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), b); // 7

		const d = insertWhitespace(linesLayout, 2, 0, 1, 0);
		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 0
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), d); // 2
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), c); // 3
		assert.equal(linesLayout.getIdForWhitespaceIndex(3), b); // 7

		const e = insertWhitespace(linesLayout, 8, 0, 1, 0);
		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 0
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), d); // 2
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), c); // 3
		assert.equal(linesLayout.getIdForWhitespaceIndex(3), b); // 7
		assert.equal(linesLayout.getIdForWhitespaceIndex(4), e); // 8

		const f = insertWhitespace(linesLayout, 11, 0, 1, 0);
		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 0
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), d); // 2
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), c); // 3
		assert.equal(linesLayout.getIdForWhitespaceIndex(3), b); // 7
		assert.equal(linesLayout.getIdForWhitespaceIndex(4), e); // 8
		assert.equal(linesLayout.getIdForWhitespaceIndex(5), f); // 11

		const g = insertWhitespace(linesLayout, 10, 0, 1, 0);
		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 0
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), d); // 2
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), c); // 3
		assert.equal(linesLayout.getIdForWhitespaceIndex(3), b); // 7
		assert.equal(linesLayout.getIdForWhitespaceIndex(4), e); // 8
		assert.equal(linesLayout.getIdForWhitespaceIndex(5), g); // 10
		assert.equal(linesLayout.getIdForWhitespaceIndex(6), f); // 11

		const h = insertWhitespace(linesLayout, 0, 0, 1, 0);
		assert.equal(linesLayout.getIdForWhitespaceIndex(0), a); // 0
		assert.equal(linesLayout.getIdForWhitespaceIndex(1), h); // 0
		assert.equal(linesLayout.getIdForWhitespaceIndex(2), d); // 2
		assert.equal(linesLayout.getIdForWhitespaceIndex(3), c); // 3
		assert.equal(linesLayout.getIdForWhitespaceIndex(4), b); // 7
		assert.equal(linesLayout.getIdForWhitespaceIndex(5), e); // 8
		assert.equal(linesLayout.getIdForWhitespaceIndex(6), g); // 10
		assert.equal(linesLayout.getIdForWhitespaceIndex(7), f); // 11
	});
});
