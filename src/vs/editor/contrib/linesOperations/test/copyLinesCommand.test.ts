/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Selection } from 'vs/editor/common/core/selection';
import { CopyLinesCommand } from 'vs/editor/contrib/linesOperations/copyLinesCommand';
import { testCommand } from 'vs/editor/test/browser/testCommand';
import { withTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { DuplicateSelectionAction } from 'vs/editor/contrib/linesOperations/linesOperations';

function testCopyLinesDownCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
	testCommand(lines, null, selection, (sel) => new CopyLinesCommand(sel, true), expectedLines, expectedSelection);
}

function testCopyLinesUpCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
	testCommand(lines, null, selection, (sel) => new CopyLinesCommand(sel, false), expectedLines, expectedSelection);
}

suite('Editor Contrib - Copy Lines Command', () => {

	test('copy first line down', function () {
		testCopyLinesDownCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 3, 1, 1),
			[
				'first',
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 3, 2, 1)
		);
	});

	test('copy first line up', function () {
		testCopyLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 3, 1, 1),
			[
				'first',
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 3, 1, 1)
		);
	});

	test('copy last line down', function () {
		testCopyLinesDownCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(5, 3, 5, 1),
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth',
				'fifth'
			],
			new Selection(6, 3, 6, 1)
		);
	});

	test('copy last line up', function () {
		testCopyLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(5, 3, 5, 1),
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth',
				'fifth'
			],
			new Selection(5, 3, 5, 1)
		);
	});

	test('issue #1322: copy line up', function () {
		testCopyLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(3, 11, 3, 11),
			[
				'first',
				'second line',
				'third line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(3, 11, 3, 11)
		);
	});

	test('issue #1322: copy last line up', function () {
		testCopyLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(5, 6, 5, 6),
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth',
				'fifth'
			],
			new Selection(5, 6, 5, 6)
		);
	});

	test('copy many lines up', function () {
		testCopyLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(4, 3, 2, 1),
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(4, 3, 2, 1)
		);
	});

	test('ignore empty selection', function () {
		testCopyLinesUpCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 1, 1, 1),
			[
				'first',
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 1, 1, 1)
		);
	});
});

suite('Editor Contrib - Duplicate Selection', () => {

	const duplicateSelectionAction = new DuplicateSelectionAction();

	function testDuplicateSelectionAction(lines: string[], selections: Selection[], expectedLines: string[], expectedSelections: Selection[]): void {
		withTestCodeEditor(lines.join('\n'), {}, (editor) => {
			editor.setSelections(selections);
			duplicateSelectionAction.run(null!, editor, {});
			assert.deepEqual(editor.getValue(), expectedLines.join('\n'));
			assert.deepEqual(editor.getSelections()!.map(s => s.toString()), expectedSelections.map(s => s.toString()));
		});
	}

	test('empty selection', function () {
		testDuplicateSelectionAction(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			[new Selection(2, 2, 2, 2), new Selection(3, 2, 3, 2)],
			[
				'first',
				'second line',
				'second line',
				'third line',
				'third line',
				'fourth line',
				'fifth'
			],
			[new Selection(3, 2, 3, 2), new Selection(5, 2, 5, 2)]
		);
	});

	test('with selection', function () {
		testDuplicateSelectionAction(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			[new Selection(2, 1, 2, 4), new Selection(3, 1, 3, 4)],
			[
				'first',
				'secsecond line',
				'thithird line',
				'fourth line',
				'fifth'
			],
			[new Selection(2, 4, 2, 7), new Selection(3, 4, 3, 7)]
		);
	});
});
