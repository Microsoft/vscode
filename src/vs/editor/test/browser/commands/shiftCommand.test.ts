/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ShiftCommand } from 'vs/editor/common/commands/shiftCommand';
import { Range } from 'vs/editor/common/core/range';
import { Selection } from 'vs/editor/common/core/selection';
import { IIdentifiedSingleEditOperation } from 'vs/editor/common/model';
import { LanguageIdentifier } from 'vs/editor/common/modes';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { getEditOperation, testCommand } from 'vs/editor/test/browser/testCommand';
import { withEditorModel } from 'vs/editor/test/common/editorTestUtils';
import { MockMode } from 'vs/editor/test/common/mocks/mockMode';
import { javascriptOnEnterRules } from 'vs/editor/test/common/modes/supports/javascriptOnEnterRules';
import { EditorAutoIndentStrategy } from 'vs/editor/common/config/editorOptions';

/**
 * Create single edit operation
 */
export function createSingleEditOp(text: string, positionLineNumber: number, positionColumn: number, selectionLineNumber: number = positionLineNumber, selectionColumn: number = positionColumn): IIdentifiedSingleEditOperation {
	return {
		range: new Range(selectionLineNumber, selectionColumn, positionLineNumber, positionColumn),
		text: text,
		forceMoveMarkers: false
	};
}

class DocBlockCommentMode extends MockMode {

	private static readonly _id = new LanguageIdentifier('commentMode', 3);

	constructor() {
		super(DocBlockCommentMode._id);
		this._register(LanguageConfigurationRegistry.register(this.getLanguageIdentifier(), {
			brackets: [
				['(', ')'],
				['{', '}'],
				['[', ']']
			],

			onEnterRules: javascriptOnEnterRules
		}));
	}
}

function testShiftCommand(lines: string[], languageIdentifier: LanguageIdentifier | null, useTabStops: boolean, selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
	testCommand(lines, languageIdentifier, selection, (sel) => new ShiftCommand(sel, {
		isUnshift: false,
		tabSize: 4,
		indentSize: 4,
		insertSpaces: false,
		useTabStops: useTabStops,
		autoIndent: EditorAutoIndentStrategy.Full,
	}), expectedLines, expectedSelection);
}

function testUnshiftCommand(lines: string[], languageIdentifier: LanguageIdentifier | null, useTabStops: boolean, selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
	testCommand(lines, languageIdentifier, selection, (sel) => new ShiftCommand(sel, {
		isUnshift: true,
		tabSize: 4,
		indentSize: 4,
		insertSpaces: false,
		useTabStops: useTabStops,
		autoIndent: EditorAutoIndentStrategy.Full,
	}), expectedLines, expectedSelection);
}

function withDockBlockCommentMode(callback: (mode: DocBlockCommentMode) => void): void {
	let mode = new DocBlockCommentMode();
	callback(mode);
	mode.dispose();
}

suite('Editor Commands - ShiftCommand', () => {

	// --------- shift

	test('Bug 9503: Shifting without any selection', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 1, 1, 1),
			[
				'\tMy First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(1, 2, 1, 2)
		);
	});

	test('shift on single line selection 1', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 3, 1, 1),
			[
				'\tMy First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(1, 4, 1, 1)
		);
	});

	test('shift on single line selection 2', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 1, 1, 3),
			[
				'\tMy First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(1, 1, 1, 4)
		);
	});

	test('simple shift', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 1, 2, 1),
			[
				'\tMy First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(1, 1, 2, 1)
		);
	});

	test('shifting on two separate lines', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 1, 2, 1),
			[
				'\tMy First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(1, 1, 2, 1)
		);

		testShiftCommand(
			[
				'\tMy First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(2, 1, 3, 1),
			[
				'\tMy First Line',
				'\t\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(2, 1, 3, 1)
		);
	});

	test('shifting on two lines', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 2, 2, 2),
			[
				'\tMy First Line',
				'\t\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(1, 3, 2, 2)
		);
	});

	test('shifting on two lines again', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(2, 2, 1, 2),
			[
				'\tMy First Line',
				'\t\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(2, 2, 1, 3)
		);
	});

	test('shifting at end of file', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(4, 1, 5, 2),
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'\t123'
			],
			new Selection(4, 1, 5, 3)
		);
	});

	test('issue #1120 TAB should not indent empty lines in a multi-line selection', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 1, 5, 2),
			[
				'\tMy First Line',
				'\t\t\tMy Second Line',
				'\t\tThird Line',
				'',
				'\t123'
			],
			new Selection(1, 1, 5, 3)
		);

		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(4, 1, 5, 1),
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'\t',
				'123'
			],
			new Selection(4, 1, 5, 1)
		);
	});

	// --------- unshift

	test('unshift on single line selection 1', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(2, 3, 2, 1),
			[
				'My First Line',
				'\t\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(2, 3, 2, 1)
		);
	});

	test('unshift on single line selection 2', () => {
		testShiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(2, 1, 2, 3),
			[
				'My First Line',
				'\t\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(2, 1, 2, 3)
		);
	});

	test('simple unshift', () => {
		testUnshiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 1, 2, 1),
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(1, 1, 2, 1)
		);
	});

	test('unshifting on two lines 1', () => {
		testUnshiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 2, 2, 2),
			[
				'My First Line',
				'\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(1, 2, 2, 2)
		);
	});

	test('unshifting on two lines 2', () => {
		testUnshiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(2, 3, 2, 1),
			[
				'My First Line',
				'\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(2, 2, 2, 1)
		);
	});

	test('unshifting at the end of the file', () => {
		testUnshiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(4, 1, 5, 2),
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(4, 1, 5, 2)
		);
	});

	test('unshift many times + shift', () => {
		testUnshiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 1, 5, 4),
			[
				'My First Line',
				'\tMy Second Line',
				'Third Line',
				'',
				'123'
			],
			new Selection(1, 1, 5, 4)
		);

		testUnshiftCommand(
			[
				'My First Line',
				'\tMy Second Line',
				'Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 1, 5, 4),
			[
				'My First Line',
				'My Second Line',
				'Third Line',
				'',
				'123'
			],
			new Selection(1, 1, 5, 4)
		);

		testShiftCommand(
			[
				'My First Line',
				'My Second Line',
				'Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(1, 1, 5, 4),
			[
				'\tMy First Line',
				'\tMy Second Line',
				'\tThird Line',
				'',
				'\t123'
			],
			new Selection(1, 1, 5, 5)
		);
	});

	test('Bug 9119: Unshift from first column doesn\'t work', () => {
		testUnshiftCommand(
			[
				'My First Line',
				'\t\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			null,
			true,
			new Selection(2, 1, 2, 1),
			[
				'My First Line',
				'\tMy Second Line',
				'    Third Line',
				'',
				'123'
			],
			new Selection(2, 1, 2, 1)
		);
	});

	test('issue #348: indenting around doc block comments', () => {
		withDockBlockCommentMode((mode) => {

			testShiftCommand(
				[
					'',
					'/**',
					' * a doc comment',
					' */',
					'function hello() {}'
				],
				mode.getLanguageIdentifier(),
				true,
				new Selection(1, 1, 5, 20),
				[
					'',
					'\t/**',
					'\t * a doc comment',
					'\t */',
					'\tfunction hello() {}'
				],
				new Selection(1, 1, 5, 21)
			);

			testUnshiftCommand(
				[
					'',
					'/**',
					' * a doc comment',
					' */',
					'function hello() {}'
				],
				mode.getLanguageIdentifier(),
				true,
				new Selection(1, 1, 5, 20),
				[
					'',
					'/**',
					' * a doc comment',
					' */',
					'function hello() {}'
				],
				new Selection(1, 1, 5, 20)
			);

			testUnshiftCommand(
				[
					'\t',
					'\t/**',
					'\t * a doc comment',
					'\t */',
					'\tfunction hello() {}'
				],
				mode.getLanguageIdentifier(),
				true,
				new Selection(1, 1, 5, 21),
				[
					'',
					'/**',
					' * a doc comment',
					' */',
					'function hello() {}'
				],
				new Selection(1, 1, 5, 20)
			);

		});
	});

	test('issue #1609: Wrong indentation of block comments', () => {
		withDockBlockCommentMode((mode) => {
			testShiftCommand(
				[
					'',
					'/**',
					' * test',
					' *',
					' * @type {number}',
					' */',
					'var foo = 0;'
				],
				mode.getLanguageIdentifier(),
				true,
				new Selection(1, 1, 7, 13),
				[
					'',
					'\t/**',
					'\t * test',
					'\t *',
					'\t * @type {number}',
					'\t */',
					'\tvar foo = 0;'
				],
				new Selection(1, 1, 7, 14)
			);
		});
	});

	test('issue #1620: a) Line indent doesn\'t handle leading whitespace properly', () => {
		testCommand(
			[
				'   Written | Numeric',
				'       one | 1',
				'       two | 2',
				'     three | 3',
				'      four | 4',
				'      five | 5',
				'       six | 6',
				'     seven | 7',
				'     eight | 8',
				'      nine | 9',
				'       ten | 10',
				'    eleven | 11',
				'',
			],
			null,
			new Selection(1, 1, 13, 1),
			(sel) => new ShiftCommand(sel, {
				isUnshift: false,
				tabSize: 4,
				indentSize: 4,
				insertSpaces: true,
				useTabStops: false,
				autoIndent: EditorAutoIndentStrategy.Full,
			}),
			[
				'       Written | Numeric',
				'           one | 1',
				'           two | 2',
				'         three | 3',
				'          four | 4',
				'          five | 5',
				'           six | 6',
				'         seven | 7',
				'         eight | 8',
				'          nine | 9',
				'           ten | 10',
				'        eleven | 11',
				'',
			],
			new Selection(1, 1, 13, 1)
		);
	});

	test('issue #1620: b) Line indent doesn\'t handle leading whitespace properly', () => {
		testCommand(
			[
				'       Written | Numeric',
				'           one | 1',
				'           two | 2',
				'         three | 3',
				'          four | 4',
				'          five | 5',
				'           six | 6',
				'         seven | 7',
				'         eight | 8',
				'          nine | 9',
				'           ten | 10',
				'        eleven | 11',
				'',
			],
			null,
			new Selection(1, 1, 13, 1),
			(sel) => new ShiftCommand(sel, {
				isUnshift: true,
				tabSize: 4,
				indentSize: 4,
				insertSpaces: true,
				useTabStops: false,
				autoIndent: EditorAutoIndentStrategy.Full,
			}),
			[
				'   Written | Numeric',
				'       one | 1',
				'       two | 2',
				'     three | 3',
				'      four | 4',
				'      five | 5',
				'       six | 6',
				'     seven | 7',
				'     eight | 8',
				'      nine | 9',
				'       ten | 10',
				'    eleven | 11',
				'',
			],
			new Selection(1, 1, 13, 1)
		);
	});

	test('issue #1620: c) Line indent doesn\'t handle leading whitespace properly', () => {
		testCommand(
			[
				'       Written | Numeric',
				'           one | 1',
				'           two | 2',
				'         three | 3',
				'          four | 4',
				'          five | 5',
				'           six | 6',
				'         seven | 7',
				'         eight | 8',
				'          nine | 9',
				'           ten | 10',
				'        eleven | 11',
				'',
			],
			null,
			new Selection(1, 1, 13, 1),
			(sel) => new ShiftCommand(sel, {
				isUnshift: true,
				tabSize: 4,
				indentSize: 4,
				insertSpaces: false,
				useTabStops: false,
				autoIndent: EditorAutoIndentStrategy.Full,
			}),
			[
				'   Written | Numeric',
				'       one | 1',
				'       two | 2',
				'     three | 3',
				'      four | 4',
				'      five | 5',
				'       six | 6',
				'     seven | 7',
				'     eight | 8',
				'      nine | 9',
				'       ten | 10',
				'    eleven | 11',
				'',
			],
			new Selection(1, 1, 13, 1)
		);
	});

	test('issue #1620: d) Line indent doesn\'t handle leading whitespace properly', () => {
		testCommand(
			[
				'\t   Written | Numeric',
				'\t       one | 1',
				'\t       two | 2',
				'\t     three | 3',
				'\t      four | 4',
				'\t      five | 5',
				'\t       six | 6',
				'\t     seven | 7',
				'\t     eight | 8',
				'\t      nine | 9',
				'\t       ten | 10',
				'\t    eleven | 11',
				'',
			],
			null,
			new Selection(1, 1, 13, 1),
			(sel) => new ShiftCommand(sel, {
				isUnshift: true,
				tabSize: 4,
				indentSize: 4,
				insertSpaces: true,
				useTabStops: false,
				autoIndent: EditorAutoIndentStrategy.Full,
			}),
			[
				'   Written | Numeric',
				'       one | 1',
				'       two | 2',
				'     three | 3',
				'      four | 4',
				'      five | 5',
				'       six | 6',
				'     seven | 7',
				'     eight | 8',
				'      nine | 9',
				'       ten | 10',
				'    eleven | 11',
				'',
			],
			new Selection(1, 1, 13, 1)
		);
	});

	test('issue Microsoft/monaco-editor#443: Indentation of a single row deletes selected text in some cases', () => {
		testCommand(
			[
				'Hello world!',
				'another line'
			],
			null,
			new Selection(1, 1, 1, 13),
			(sel) => new ShiftCommand(sel, {
				isUnshift: false,
				tabSize: 4,
				indentSize: 4,
				insertSpaces: false,
				useTabStops: true,
				autoIndent: EditorAutoIndentStrategy.Full,
			}),
			[
				'\tHello world!',
				'another line'
			],
			new Selection(1, 1, 1, 14)
		);
	});

	test('bug #16815:Shift+Tab doesn\'t go back to tabstop', () => {

		let repeatStr = (str: string, cnt: number): string => {
			let r = '';
			for (let i = 0; i < cnt; i++) {
				r += str;
			}
			return r;
		};

		let testOutdent = (tabSize: number, indentSize: number, insertSpaces: boolean, lineText: string, expectedIndents: number) => {
			const oneIndent = insertSpaces ? repeatStr(' ', indentSize) : '\t';
			let expectedIndent = repeatStr(oneIndent, expectedIndents);
			if (lineText.length > 0) {
				_assertUnshiftCommand(tabSize, indentSize, insertSpaces, [lineText + 'aaa'], [createSingleEditOp(expectedIndent, 1, 1, 1, lineText.length + 1)]);
			} else {
				_assertUnshiftCommand(tabSize, indentSize, insertSpaces, [lineText + 'aaa'], []);
			}
		};

		let testIndent = (tabSize: number, indentSize: number, insertSpaces: boolean, lineText: string, expectedIndents: number) => {
			const oneIndent = insertSpaces ? repeatStr(' ', indentSize) : '\t';
			let expectedIndent = repeatStr(oneIndent, expectedIndents);
			_assertShiftCommand(tabSize, indentSize, insertSpaces, [lineText + 'aaa'], [createSingleEditOp(expectedIndent, 1, 1, 1, lineText.length + 1)]);
		};

		let testIndentation = (tabSize: number, indentSize: number, lineText: string, expectedOnOutdent: number, expectedOnIndent: number) => {
			testOutdent(tabSize, indentSize, true, lineText, expectedOnOutdent);
			testOutdent(tabSize, indentSize, false, lineText, expectedOnOutdent);

			testIndent(tabSize, indentSize, true, lineText, expectedOnIndent);
			testIndent(tabSize, indentSize, false, lineText, expectedOnIndent);
		};

		// insertSpaces: true
		// 0 => 0
		testIndentation(4, 4, '', 0, 1);

		// 1 => 0
		testIndentation(4, 4, '\t', 0, 2);
		testIndentation(4, 4, ' ', 0, 1);
		testIndentation(4, 4, ' \t', 0, 2);
		testIndentation(4, 4, '  ', 0, 1);
		testIndentation(4, 4, '  \t', 0, 2);
		testIndentation(4, 4, '   ', 0, 1);
		testIndentation(4, 4, '   \t', 0, 2);
		testIndentation(4, 4, '    ', 0, 2);

		// 2 => 1
		testIndentation(4, 4, '\t\t', 1, 3);
		testIndentation(4, 4, '\t ', 1, 2);
		testIndentation(4, 4, '\t \t', 1, 3);
		testIndentation(4, 4, '\t  ', 1, 2);
		testIndentation(4, 4, '\t  \t', 1, 3);
		testIndentation(4, 4, '\t   ', 1, 2);
		testIndentation(4, 4, '\t   \t', 1, 3);
		testIndentation(4, 4, '\t    ', 1, 3);
		testIndentation(4, 4, ' \t\t', 1, 3);
		testIndentation(4, 4, ' \t ', 1, 2);
		testIndentation(4, 4, ' \t \t', 1, 3);
		testIndentation(4, 4, ' \t  ', 1, 2);
		testIndentation(4, 4, ' \t  \t', 1, 3);
		testIndentation(4, 4, ' \t   ', 1, 2);
		testIndentation(4, 4, ' \t   \t', 1, 3);
		testIndentation(4, 4, ' \t    ', 1, 3);
		testIndentation(4, 4, '  \t\t', 1, 3);
		testIndentation(4, 4, '  \t ', 1, 2);
		testIndentation(4, 4, '  \t \t', 1, 3);
		testIndentation(4, 4, '  \t  ', 1, 2);
		testIndentation(4, 4, '  \t  \t', 1, 3);
		testIndentation(4, 4, '  \t   ', 1, 2);
		testIndentation(4, 4, '  \t   \t', 1, 3);
		testIndentation(4, 4, '  \t    ', 1, 3);
		testIndentation(4, 4, '   \t\t', 1, 3);
		testIndentation(4, 4, '   \t ', 1, 2);
		testIndentation(4, 4, '   \t \t', 1, 3);
		testIndentation(4, 4, '   \t  ', 1, 2);
		testIndentation(4, 4, '   \t  \t', 1, 3);
		testIndentation(4, 4, '   \t   ', 1, 2);
		testIndentation(4, 4, '   \t   \t', 1, 3);
		testIndentation(4, 4, '   \t    ', 1, 3);
		testIndentation(4, 4, '    \t', 1, 3);
		testIndentation(4, 4, '     ', 1, 2);
		testIndentation(4, 4, '     \t', 1, 3);
		testIndentation(4, 4, '      ', 1, 2);
		testIndentation(4, 4, '      \t', 1, 3);
		testIndentation(4, 4, '       ', 1, 2);
		testIndentation(4, 4, '       \t', 1, 3);
		testIndentation(4, 4, '        ', 1, 3);

		// 3 => 2
		testIndentation(4, 4, '         ', 2, 3);

		function _assertUnshiftCommand(tabSize: number, indentSize: number, insertSpaces: boolean, text: string[], expected: IIdentifiedSingleEditOperation[]): void {
			return withEditorModel(text, (model) => {
				let op = new ShiftCommand(new Selection(1, 1, text.length + 1, 1), {
					isUnshift: true,
					tabSize: tabSize,
					indentSize: indentSize,
					insertSpaces: insertSpaces,
					useTabStops: true,
					autoIndent: EditorAutoIndentStrategy.Full,
				});
				let actual = getEditOperation(model, op);
				assert.deepEqual(actual, expected);
			});
		}

		function _assertShiftCommand(tabSize: number, indentSize: number, insertSpaces: boolean, text: string[], expected: IIdentifiedSingleEditOperation[]): void {
			return withEditorModel(text, (model) => {
				let op = new ShiftCommand(new Selection(1, 1, text.length + 1, 1), {
					isUnshift: false,
					tabSize: tabSize,
					indentSize: indentSize,
					insertSpaces: insertSpaces,
					useTabStops: true,
					autoIndent: EditorAutoIndentStrategy.Full,
				});
				let actual = getEditOperation(model, op);
				assert.deepEqual(actual, expected);
			});
		}
	});

});
