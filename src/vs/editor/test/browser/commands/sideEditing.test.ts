/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { EditOperation } from 'vs/editor/common/core/editOperation';
import { Position } from 'vs/editor/common/core/position';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { withTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';

function testCommand(lines: string[], selections: Selection[], edits: IIdentifiedSingleEditOperation[], expectedLines: string[], expectedSelections: Selection[]): void {
	withTestCodeEditor(lines, {}, (editor, viewModel) => {
		const model = editor.getModel()!;

		viewModel.setSelections('tests', selections);

		model.applyEdits(edits);

		assert.deepEqual(model.getLinesContent(), expectedLines);

		let actualSelections = viewModel.getSelections();
		assert.deepEqual(actualSelections.map(s => s.toString()), expectedSelections.map(s => s.toString()));

	});
}

suite('Editor Side Editing - collapsed selection', () => {

	test('replace at selection', () => {
		testCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth'
			],
			[new Selection(1, 1, 1, 1)],
			[
				EditOperation.replace(new Selection(1, 1, 1, 1), 'something ')
			],
			[
				'something first',
				'second line',
				'third line',
				'fourth'
			],
			[new Selection(1, 1, 1, 11)]
		);
	});

	test('replace at selection 2', () => {
		testCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth'
			],
			[new Selection(1, 1, 1, 6)],
			[
				EditOperation.replace(new Selection(1, 1, 1, 6), 'something')
			],
			[
				'something',
				'second line',
				'third line',
				'fourth'
			],
			[new Selection(1, 1, 1, 10)]
		);
	});

	test('insert at selection', () => {
		testCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth'
			],
			[new Selection(1, 1, 1, 1)],
			[
				EditOperation.insert(new Position(1, 1), 'something ')
			],
			[
				'something first',
				'second line',
				'third line',
				'fourth'
			],
			[new Selection(1, 11, 1, 11)]
		);
	});

	test('insert at selection sitting on max column', () => {
		testCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth'
			],
			[new Selection(1, 6, 1, 6)],
			[
				EditOperation.insert(new Position(1, 6), ' something\nnew ')
			],
			[
				'first something',
				'new ',
				'second line',
				'third line',
				'fourth'
			],
			[new Selection(2, 5, 2, 5)]
		);
	});

	test('issue #3994: replace on top of selection', () => {
		testCommand(
			[
				'$obj = New-Object "system.col"'
			],
			[new Selection(1, 30, 1, 30)],
			[
				EditOperation.replaceMove(new Range(1, 19, 1, 31), '"System.Collections"')
			],
			[
				'$obj = New-Object "System.Collections"'
			],
			[new Selection(1, 39, 1, 39)]
		);
	});

	test('issue #15267: Suggestion that adds a line - cursor goes to the wrong line ', () => {
		testCommand(
			[
				'package main',
				'',
				'import (',
				'	"fmt"',
				')',
				'',
				'func main(',
				'	fmt.Println(strings.Con)',
				'}'
			],
			[new Selection(8, 25, 8, 25)],
			[
				EditOperation.replaceMove(new Range(5, 1, 5, 1), '\t\"strings\"\n')
			],
			[
				'package main',
				'',
				'import (',
				'	"fmt"',
				'	"strings"',
				')',
				'',
				'func main(',
				'	fmt.Println(strings.Con)',
				'}'
			],
			[new Selection(9, 25, 9, 25)]
		);
	});

	test('issue #15236: Selections broke after deleting text using vscode.TextEditor.edit ', () => {
		testCommand(
			[
				'foofoofoo, foofoofoo, bar'
			],
			[new Selection(1, 1, 1, 10), new Selection(1, 12, 1, 21)],
			[
				EditOperation.replace(new Range(1, 1, 1, 10), ''),
				EditOperation.replace(new Range(1, 12, 1, 21), ''),
			],
			[
				', , bar'
			],
			[new Selection(1, 1, 1, 1), new Selection(1, 3, 1, 3)]
		);
	});
});

suite('SideEditing', () => {

	const LINES = [
		'My First Line',
		'My Second Line',
		'Third Line'
	];

	function _runTest(selection: Selection, editRange: Range, editText: string, editForceMoveMarkers: boolean, expected: Selection, msg: string): void {
		withTestCodeEditor(LINES.join('\n'), {}, (editor, viewModel) => {
			viewModel.setSelections('tests', [selection]);
			editor.getModel().applyEdits([{
				range: editRange,
				text: editText,
				forceMoveMarkers: editForceMoveMarkers
			}]);
			const actual = viewModel.getSelection();
			assert.deepEqual(actual.toString(), expected.toString(), msg);
		});
	}

	function runTest(selection: Range, editRange: Range, editText: string, expected: Selection[][]): void {
		const sel1 = new Selection(selection.startLineNumber, selection.startColumn, selection.endLineNumber, selection.endColumn);
		_runTest(sel1, editRange, editText, false, expected[0][0], '0-0-regular-no-force');
		_runTest(sel1, editRange, editText, true, expected[1][0], '1-0-regular-force');

		// RTL selection
		const sel2 = new Selection(selection.endLineNumber, selection.endColumn, selection.startLineNumber, selection.startColumn);
		_runTest(sel2, editRange, editText, false, expected[0][1], '0-1-inverse-no-force');
		_runTest(sel2, editRange, editText, true, expected[1][1], '1-1-inverse-force');
	}

	suite('insert', () => {
		suite('collapsed sel', () => {
			test('before', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 3, 1, 3), 'xx',
					[
						[new Selection(1, 6, 1, 6), new Selection(1, 6, 1, 6)],
						[new Selection(1, 6, 1, 6), new Selection(1, 6, 1, 6)],
					]
				);
			});
			test('equal', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 4, 1, 4), 'xx',
					[
						[new Selection(1, 4, 1, 6), new Selection(1, 4, 1, 6)],
						[new Selection(1, 6, 1, 6), new Selection(1, 6, 1, 6)],
					]
				);
			});
			test('after', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 5, 1, 5), 'xx',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
					]
				);
			});
		});
		suite('non-collapsed dec', () => {
			test('before', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 3), 'xx',
					[
						[new Selection(1, 6, 1, 11), new Selection(1, 11, 1, 6)],
						[new Selection(1, 6, 1, 11), new Selection(1, 11, 1, 6)],
					]
				);
			});
			test('start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 4), 'xx',
					[
						[new Selection(1, 4, 1, 11), new Selection(1, 11, 1, 4)],
						[new Selection(1, 6, 1, 11), new Selection(1, 11, 1, 6)],
					]
				);
			});
			test('inside', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 5), 'xx',
					[
						[new Selection(1, 4, 1, 11), new Selection(1, 11, 1, 4)],
						[new Selection(1, 4, 1, 11), new Selection(1, 11, 1, 4)],
					]
				);
			});
			test('end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 9, 1, 9), 'xx',
					[
						[new Selection(1, 4, 1, 11), new Selection(1, 11, 1, 4)],
						[new Selection(1, 4, 1, 11), new Selection(1, 11, 1, 4)],
					]
				);
			});
			test('after', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 10, 1, 10), 'xx',
					[
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
					]
				);
			});
		});
	});

	suite('delete', () => {
		suite('collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 1, 1, 3), '',
					[
						[new Selection(1, 2, 1, 2), new Selection(1, 2, 1, 2)],
						[new Selection(1, 2, 1, 2), new Selection(1, 2, 1, 2)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 2, 1, 4), '',
					[
						[new Selection(1, 2, 1, 2), new Selection(1, 2, 1, 2)],
						[new Selection(1, 2, 1, 2), new Selection(1, 2, 1, 2)],
					]
				);
			});
			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 3, 1, 5), '',
					[
						[new Selection(1, 3, 1, 3), new Selection(1, 3, 1, 3)],
						[new Selection(1, 3, 1, 3), new Selection(1, 3, 1, 3)],
					]
				);
			});
			test('edit.start >= range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 4, 1, 6), '',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
					]
				);
			});
			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 5, 1, 7), '',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
					]
				);
			});
		});
		suite('non-collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 1, 1, 3), '',
					[
						[new Selection(1, 2, 1, 7), new Selection(1, 7, 1, 2)],
						[new Selection(1, 2, 1, 7), new Selection(1, 7, 1, 2)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 2, 1, 4), '',
					[
						[new Selection(1, 2, 1, 7), new Selection(1, 7, 1, 2)],
						[new Selection(1, 2, 1, 7), new Selection(1, 7, 1, 2)],
					]
				);
			});
			test('edit.start < range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 5), '',
					[
						[new Selection(1, 3, 1, 7), new Selection(1, 7, 1, 3)],
						[new Selection(1, 3, 1, 7), new Selection(1, 7, 1, 3)],
					]
				);
			});

			test('edit.start < range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 9), '',
					[
						[new Selection(1, 3, 1, 3), new Selection(1, 3, 1, 3)],
						[new Selection(1, 3, 1, 3), new Selection(1, 3, 1, 3)],
					]
				);
			});

			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 10), '',
					[
						[new Selection(1, 3, 1, 3), new Selection(1, 3, 1, 3)],
						[new Selection(1, 3, 1, 3), new Selection(1, 3, 1, 3)],
					]
				);
			});

			test('edit.start == range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 6), '',
					[
						[new Selection(1, 4, 1, 7), new Selection(1, 7, 1, 4)],
						[new Selection(1, 4, 1, 7), new Selection(1, 7, 1, 4)],
					]
				);
			});

			test('edit.start == range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 9), '',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
					]
				);
			});

			test('edit.start == range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 10), '',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
					]
				);
			});

			test('edit.start > range.start && edit.start < range.end && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 7), '',
					[
						[new Selection(1, 4, 1, 7), new Selection(1, 7, 1, 4)],
						[new Selection(1, 4, 1, 7), new Selection(1, 7, 1, 4)],
					]
				);
			});

			test('edit.start > range.start && edit.start < range.end && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 9), '',
					[
						[new Selection(1, 4, 1, 5), new Selection(1, 5, 1, 4)],
						[new Selection(1, 4, 1, 5), new Selection(1, 5, 1, 4)],
					]
				);
			});

			test('edit.start > range.start && edit.start < range.end && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 10), '',
					[
						[new Selection(1, 4, 1, 5), new Selection(1, 5, 1, 4)],
						[new Selection(1, 4, 1, 5), new Selection(1, 5, 1, 4)],
					]
				);
			});

			test('edit.start == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 9, 1, 11), '',
					[
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
					]
				);
			});

			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 10, 1, 11), '',
					[
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
					]
				);
			});
		});
	});

	suite('replace short', () => {
		suite('collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 1, 1, 3), 'c',
					[
						[new Selection(1, 3, 1, 3), new Selection(1, 3, 1, 3)],
						[new Selection(1, 3, 1, 3), new Selection(1, 3, 1, 3)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 2, 1, 4), 'c',
					[
						[new Selection(1, 3, 1, 3), new Selection(1, 3, 1, 3)],
						[new Selection(1, 3, 1, 3), new Selection(1, 3, 1, 3)],
					]
				);
			});
			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 3, 1, 5), 'c',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
					]
				);
			});
			test('edit.start >= range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 4, 1, 6), 'c',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 5, 1, 5), new Selection(1, 5, 1, 5)],
					]
				);
			});
			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 5, 1, 7), 'c',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
					]
				);
			});
		});
		suite('non-collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 1, 1, 3), 'c',
					[
						[new Selection(1, 3, 1, 8), new Selection(1, 8, 1, 3)],
						[new Selection(1, 3, 1, 8), new Selection(1, 8, 1, 3)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 2, 1, 4), 'c',
					[
						[new Selection(1, 3, 1, 8), new Selection(1, 8, 1, 3)],
						[new Selection(1, 3, 1, 8), new Selection(1, 8, 1, 3)],
					]
				);
			});
			test('edit.start < range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 5), 'c',
					[
						[new Selection(1, 4, 1, 8), new Selection(1, 8, 1, 4)],
						[new Selection(1, 4, 1, 8), new Selection(1, 8, 1, 4)],
					]
				);
			});
			test('edit.start < range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 9), 'c',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
					]
				);
			});
			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 10), 'c',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
					]
				);
			});
			test('edit.start == range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 6), 'c',
					[
						[new Selection(1, 4, 1, 8), new Selection(1, 8, 1, 4)],
						[new Selection(1, 5, 1, 8), new Selection(1, 8, 1, 5)],
					]
				);
			});
			test('edit.start == range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 9), 'c',
					[
						[new Selection(1, 4, 1, 5), new Selection(1, 5, 1, 4)],
						[new Selection(1, 5, 1, 5), new Selection(1, 5, 1, 5)],
					]
				);
			});
			test('edit.start == range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 10), 'c',
					[
						[new Selection(1, 4, 1, 5), new Selection(1, 5, 1, 4)],
						[new Selection(1, 5, 1, 5), new Selection(1, 5, 1, 5)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 7), 'c',
					[
						[new Selection(1, 4, 1, 8), new Selection(1, 8, 1, 4)],
						[new Selection(1, 4, 1, 8), new Selection(1, 8, 1, 4)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 9), 'c',
					[
						[new Selection(1, 4, 1, 6), new Selection(1, 6, 1, 4)],
						[new Selection(1, 4, 1, 6), new Selection(1, 6, 1, 4)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 10), 'c',
					[
						[new Selection(1, 4, 1, 6), new Selection(1, 6, 1, 4)],
						[new Selection(1, 4, 1, 6), new Selection(1, 6, 1, 4)],
					]
				);
			});
			test('edit.start == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 9, 1, 11), 'c',
					[
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
						[new Selection(1, 4, 1, 10), new Selection(1, 10, 1, 4)],
					]
				);
			});
			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 10, 1, 11), 'c',
					[
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
					]
				);
			});
		});
	});

	suite('replace long', () => {
		suite('collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 1, 1, 3), 'cccc',
					[
						[new Selection(1, 6, 1, 6), new Selection(1, 6, 1, 6)],
						[new Selection(1, 6, 1, 6), new Selection(1, 6, 1, 6)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 2, 1, 4), 'cccc',
					[
						[new Selection(1, 4, 1, 6), new Selection(1, 4, 1, 6)],
						[new Selection(1, 6, 1, 6), new Selection(1, 6, 1, 6)],
					]
				);
			});
			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 3, 1, 5), 'cccc',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 7, 1, 7), new Selection(1, 7, 1, 7)],
					]
				);
			});
			test('edit.start >= range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 4, 1, 6), 'cccc',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 8, 1, 8), new Selection(1, 8, 1, 8)],
					]
				);
			});
			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 4),
					new Range(1, 5, 1, 7), 'cccc',
					[
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
						[new Selection(1, 4, 1, 4), new Selection(1, 4, 1, 4)],
					]
				);
			});
		});
		suite('non-collapsed dec', () => {
			test('edit.end < range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 1, 1, 3), 'cccc',
					[
						[new Selection(1, 6, 1, 11), new Selection(1, 11, 1, 6)],
						[new Selection(1, 6, 1, 11), new Selection(1, 11, 1, 6)],
					]
				);
			});
			test('edit.end <= range.start', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 2, 1, 4), 'cccc',
					[
						[new Selection(1, 4, 1, 11), new Selection(1, 11, 1, 4)],
						[new Selection(1, 6, 1, 11), new Selection(1, 11, 1, 6)],
					]
				);
			});
			test('edit.start < range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 5), 'cccc',
					[
						[new Selection(1, 4, 1, 11), new Selection(1, 11, 1, 4)],
						[new Selection(1, 7, 1, 11), new Selection(1, 11, 1, 7)],
					]
				);
			});
			test('edit.start < range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 9), 'cccc',
					[
						[new Selection(1, 4, 1, 7), new Selection(1, 7, 1, 4)],
						[new Selection(1, 7, 1, 7), new Selection(1, 7, 1, 7)],
					]
				);
			});
			test('edit.start < range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 3, 1, 10), 'cccc',
					[
						[new Selection(1, 4, 1, 7), new Selection(1, 7, 1, 4)],
						[new Selection(1, 7, 1, 7), new Selection(1, 7, 1, 7)],
					]
				);
			});
			test('edit.start == range.start && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 6), 'cccc',
					[
						[new Selection(1, 4, 1, 11), new Selection(1, 11, 1, 4)],
						[new Selection(1, 8, 1, 11), new Selection(1, 11, 1, 8)],
					]
				);
			});
			test('edit.start == range.start && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 9), 'cccc',
					[
						[new Selection(1, 4, 1, 8), new Selection(1, 8, 1, 4)],
						[new Selection(1, 8, 1, 8), new Selection(1, 8, 1, 8)],
					]
				);
			});
			test('edit.start == range.start && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 4, 1, 10), 'cccc',
					[
						[new Selection(1, 4, 1, 8), new Selection(1, 8, 1, 4)],
						[new Selection(1, 8, 1, 8), new Selection(1, 8, 1, 8)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end < range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 7), 'cccc',
					[
						[new Selection(1, 4, 1, 11), new Selection(1, 11, 1, 4)],
						[new Selection(1, 4, 1, 11), new Selection(1, 11, 1, 4)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 9), 'cccc',
					[
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
					]
				);
			});
			test('edit.start > range.start && edit.start < range.end && edit.end > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 5, 1, 10), 'cccc',
					[
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
					]
				);
			});
			test('edit.start == range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 9, 1, 11), 'cccc',
					[
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
						[new Selection(1, 4, 1, 13), new Selection(1, 13, 1, 4)],
					]
				);
			});
			test('edit.start > range.end', () => {
				runTest(
					new Range(1, 4, 1, 9),
					new Range(1, 10, 1, 11), 'cccc',
					[
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
						[new Selection(1, 4, 1, 9), new Selection(1, 9, 1, 4)],
					]
				);
			});
		});
	});
});
