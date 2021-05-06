/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TerminalRecorder } from 'vs/platform/terminal/common/terminalRecorder';
import { ReplayEntry } from 'vs/platform/terminal/common/terminalProcess';

function eventsEqual(recorder: TerminalRecorder, expected: ReplayEntry[]) {
	const actual = recorder.generateReplayEvent().events;
	for (let i = 0; i < expected.length; i++) {
		assert.deepStrictEqual(actual[i], expected[i]);
	}
}

suite('TerminalRecorder', () => {
	test('should record dimensions', () => {
		const recorder = new TerminalRecorder(1, 2);
		eventsEqual(recorder, [
			{ cols: 1, rows: 2, data: '' }
		]);
		recorder.recordData('a');
		recorder.recordResize(3, 4);
		eventsEqual(recorder, [
			{ cols: 1, rows: 2, data: 'a' },
			{ cols: 3, rows: 4, data: '' }
		]);
	});
	test('should ignore resize events without data', () => {
		const recorder = new TerminalRecorder(1, 2);
		eventsEqual(recorder, [
			{ cols: 1, rows: 2, data: '' }
		]);
		recorder.recordResize(3, 4);
		eventsEqual(recorder, [
			{ cols: 3, rows: 4, data: '' }
		]);
	});
	test('should record data and combine it into the previous resize event', () => {
		const recorder = new TerminalRecorder(1, 2);
		recorder.recordData('a');
		recorder.recordData('b');
		recorder.recordResize(3, 4);
		recorder.recordData('c');
		recorder.recordData('d');
		eventsEqual(recorder, [
			{ cols: 1, rows: 2, data: 'ab' },
			{ cols: 3, rows: 4, data: 'cd' }
		]);
	});
});
