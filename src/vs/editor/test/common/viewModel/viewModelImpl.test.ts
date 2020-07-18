/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Range } from 'vs/editor/common/core/range';
import { EndOfLineSequence } from 'vs/editor/common/model';
import { testViewModel } from 'vs/editor/test/common/viewModel/testViewModel';
import { ViewEventHandler } from 'vs/editor/common/viewModel/viewEventHandler';
import { ViewEvent } from 'vs/editor/common/view/viewEvents';

suite('ViewModel', () => {

	test('issue #21073: SplitLinesCollection: attempt to access a \'newer\' model', () => {
		const text = [''];
		const opts = {
			lineNumbersMinChars: 1
		};
		testViewModel(text, opts, (viewModel, model) => {
			assert.equal(viewModel.getLineCount(), 1);

			viewModel.setViewport(1, 1, 1);

			model.applyEdits([{
				range: new Range(1, 1, 1, 1),
				text: [
					'line01',
					'line02',
					'line03',
					'line04',
					'line05',
					'line06',
					'line07',
					'line08',
					'line09',
					'line10',
				].join('\n')
			}]);

			assert.equal(viewModel.getLineCount(), 10);
		});
	});

	test('issue #44805: SplitLinesCollection: attempt to access a \'newer\' model', () => {
		const text = [''];
		testViewModel(text, {}, (viewModel, model) => {
			assert.equal(viewModel.getLineCount(), 1);

			model.pushEditOperations([], [{
				range: new Range(1, 1, 1, 1),
				text: '\ninsert1'
			}], () => ([]));

			model.pushEditOperations([], [{
				range: new Range(1, 1, 1, 1),
				text: '\ninsert2'
			}], () => ([]));

			model.pushEditOperations([], [{
				range: new Range(1, 1, 1, 1),
				text: '\ninsert3'
			}], () => ([]));

			let viewLineCount: number[] = [];

			viewLineCount.push(viewModel.getLineCount());
			viewModel.addViewEventHandler(new class extends ViewEventHandler {
				handleEvents(events: ViewEvent[]): void {
					// Access the view model
					viewLineCount.push(viewModel.getLineCount());
				}
			});
			model.undo();
			viewLineCount.push(viewModel.getLineCount());

			assert.deepEqual(viewLineCount, [4, 1, 1, 1, 1]);
		});
	});

	test('issue #44805: No visible lines via API call', () => {
		const text = [
			'line1',
			'line2',
			'line3'
		];
		testViewModel(text, {}, (viewModel, model) => {
			assert.equal(viewModel.getLineCount(), 3);
			viewModel.setHiddenAreas([new Range(1, 1, 3, 1)]);
			assert.ok(viewModel.getVisibleRanges() !== null);
		});
	});

	test('issue #44805: No visible lines via undoing', () => {
		const text = [
			''
		];
		testViewModel(text, {}, (viewModel, model) => {
			assert.equal(viewModel.getLineCount(), 1);

			model.pushEditOperations([], [{
				range: new Range(1, 1, 1, 1),
				text: 'line1\nline2\nline3'
			}], () => ([]));

			viewModel.setHiddenAreas([new Range(1, 1, 1, 1)]);
			assert.equal(viewModel.getLineCount(), 2);

			model.undo();
			assert.ok(viewModel.getVisibleRanges() !== null);
		});
	});

	function assertGetPlainTextToCopy(text: string[], ranges: Range[], emptySelectionClipboard: boolean, expected: string | string[]): void {
		testViewModel(text, {}, (viewModel, model) => {
			let actual = viewModel.getPlainTextToCopy(ranges, emptySelectionClipboard, false);
			assert.deepEqual(actual, expected);
		});
	}

	const USUAL_TEXT = [
		'',
		'line2',
		'line3',
		'line4',
		''
	];

	test('getPlainTextToCopy 0/1', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(2, 2, 2, 2)
			],
			false,
			''
		);
	});

	test('getPlainTextToCopy 0/1 - emptySelectionClipboard', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(2, 2, 2, 2)
			],
			true,
			'line2\n'
		);
	});

	test('getPlainTextToCopy 1/1', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(2, 2, 2, 6)
			],
			false,
			'ine2'
		);
	});

	test('getPlainTextToCopy 1/1 - emptySelectionClipboard', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(2, 2, 2, 6)
			],
			true,
			'ine2'
		);
	});

	test('getPlainTextToCopy 0/2', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(2, 2, 2, 2),
				new Range(3, 2, 3, 2),
			],
			false,
			''
		);
	});

	test('getPlainTextToCopy 0/2 - emptySelectionClipboard', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(2, 2, 2, 2),
				new Range(3, 2, 3, 2),
			],
			true,
			'line2\nline3\n'
		);
	});

	test('getPlainTextToCopy 1/2', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(2, 2, 2, 6),
				new Range(3, 2, 3, 2),
			],
			false,
			'ine2'
		);
	});

	test('getPlainTextToCopy 1/2 - emptySelectionClipboard', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(2, 2, 2, 6),
				new Range(3, 2, 3, 2),
			],
			true,
			['ine2', 'line3']
		);
	});

	test('getPlainTextToCopy 2/2', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(2, 2, 2, 6),
				new Range(3, 2, 3, 6),
			],
			false,
			['ine2', 'ine3']
		);
	});

	test('getPlainTextToCopy 2/2 reversed', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(3, 2, 3, 6),
				new Range(2, 2, 2, 6),
			],
			false,
			['ine2', 'ine3']
		);
	});

	test('getPlainTextToCopy 0/3 - emptySelectionClipboard', () => {
		assertGetPlainTextToCopy(
			USUAL_TEXT,
			[
				new Range(2, 2, 2, 2),
				new Range(2, 3, 2, 3),
				new Range(3, 2, 3, 2),
			],
			true,
			'line2\nline3\n'
		);
	});

	test('issue #22688 - always use CRLF for clipboard on Windows', () => {
		testViewModel(USUAL_TEXT, {}, (viewModel, model) => {
			model.setEOL(EndOfLineSequence.LF);
			let actual = viewModel.getPlainTextToCopy([new Range(2, 1, 5, 1)], true, true);
			assert.deepEqual(actual, 'line2\r\nline3\r\nline4\r\n');
		});
	});
});
