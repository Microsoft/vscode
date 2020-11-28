/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Selection } from 'vs/editor/common/core/selection';
import { TokenizationResult2 } from 'vs/editor/common/core/token';
import * as modes from 'vs/editor/common/modes';
import { CommentRule } from 'vs/editor/common/modes/languageConfiguration';
import { LanguageConfigurationRegistry } from 'vs/editor/common/modes/languageConfigurationRegistry';
import { NULL_STATE } from 'vs/editor/common/modes/nullMode';
import { ILinePreflightData, IPreflightData, ISimpleModel, LineCommentCommand, Type } from 'vs/editor/contrib/comment/lineCommentCommand';
import { testCommand } from 'vs/editor/test/browser/testCommand';
import { CommentMode } from 'vs/editor/test/common/commentMode';
import { MockMode } from 'vs/editor/test/common/mocks/mockMode';

suite('Editor Contrib - Line Comment Command', () => {

	function testLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
		let mode = new CommentMode({ lineComment: '!@#', blockComment: ['<!@#', '#@!>'] });
		testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new LineCommentCommand(sel, 4, Type.Toggle, true, true), expectedLines, expectedSelection);
		mode.dispose();
	}

	function testAddLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
		let mode = new CommentMode({ lineComment: '!@#', blockComment: ['<!@#', '#@!>'] });
		testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new LineCommentCommand(sel, 4, Type.ForceAdd, true, true), expectedLines, expectedSelection);
		mode.dispose();
	}

	test('comment single line', function () {
		testLineCommentCommand(
			[
				'some text',
				'\tsome more text'
			],
			new Selection(1, 1, 1, 1),
			[
				'!@# some text',
				'\tsome more text'
			],
			new Selection(1, 5, 1, 5)
		);
	});

	test('case insensitive', function () {
		function testLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
			let mode = new CommentMode({ lineComment: 'rem' });
			testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new LineCommentCommand(sel, 4, Type.Toggle, true, true), expectedLines, expectedSelection);
			mode.dispose();
		}

		testLineCommentCommand(
			[
				'REM some text'
			],
			new Selection(1, 1, 1, 1),
			[
				'some text'
			],
			new Selection(1, 1, 1, 1)
		);
	});

	function createSimpleModel(lines: string[]): ISimpleModel {
		return {
			getLineContent: (lineNumber: number) => {
				return lines[lineNumber - 1];
			}
		};
	}

	function createBasicLinePreflightData(commentTokens: string[]): ILinePreflightData[] {
		return commentTokens.map((commentString) => {
			const r: ILinePreflightData = {
				ignore: false,
				commentStr: commentString,
				commentStrOffset: 0,
				commentStrLength: commentString.length
			};
			return r;
		});
	}

	test('_analyzeLines', () => {
		let r: IPreflightData;

		r = LineCommentCommand._analyzeLines(Type.Toggle, true, createSimpleModel([
			'\t\t',
			'    ',
			'    c',
			'\t\td'
		]), createBasicLinePreflightData(['//', 'rem', '!@#', '!@#']), 1, true, false);
		if (!r.supported) {
			throw new Error(`unexpected`);
		}

		assert.equal(r.shouldRemoveComments, false);

		// Does not change `commentStr`
		assert.equal(r.lines[0].commentStr, '//');
		assert.equal(r.lines[1].commentStr, 'rem');
		assert.equal(r.lines[2].commentStr, '!@#');
		assert.equal(r.lines[3].commentStr, '!@#');

		// Fills in `isWhitespace`
		assert.equal(r.lines[0].ignore, true);
		assert.equal(r.lines[1].ignore, true);
		assert.equal(r.lines[2].ignore, false);
		assert.equal(r.lines[3].ignore, false);

		// Fills in `commentStrOffset`
		assert.equal(r.lines[0].commentStrOffset, 2);
		assert.equal(r.lines[1].commentStrOffset, 4);
		assert.equal(r.lines[2].commentStrOffset, 4);
		assert.equal(r.lines[3].commentStrOffset, 2);


		r = LineCommentCommand._analyzeLines(Type.Toggle, true, createSimpleModel([
			'\t\t',
			'    rem ',
			'    !@# c',
			'\t\t!@#d'
		]), createBasicLinePreflightData(['//', 'rem', '!@#', '!@#']), 1, true, false);
		if (!r.supported) {
			throw new Error(`unexpected`);
		}

		assert.equal(r.shouldRemoveComments, true);

		// Does not change `commentStr`
		assert.equal(r.lines[0].commentStr, '//');
		assert.equal(r.lines[1].commentStr, 'rem');
		assert.equal(r.lines[2].commentStr, '!@#');
		assert.equal(r.lines[3].commentStr, '!@#');

		// Fills in `isWhitespace`
		assert.equal(r.lines[0].ignore, true);
		assert.equal(r.lines[1].ignore, false);
		assert.equal(r.lines[2].ignore, false);
		assert.equal(r.lines[3].ignore, false);

		// Fills in `commentStrOffset`
		assert.equal(r.lines[0].commentStrOffset, 2);
		assert.equal(r.lines[1].commentStrOffset, 4);
		assert.equal(r.lines[2].commentStrOffset, 4);
		assert.equal(r.lines[3].commentStrOffset, 2);

		// Fills in `commentStrLength`
		assert.equal(r.lines[0].commentStrLength, 2);
		assert.equal(r.lines[1].commentStrLength, 4);
		assert.equal(r.lines[2].commentStrLength, 4);
		assert.equal(r.lines[3].commentStrLength, 3);
	});

	test('_normalizeInsertionPoint', () => {

		const runTest = (mixedArr: any[], tabSize: number, expected: number[], testName: string) => {
			const model = createSimpleModel(mixedArr.filter((item, idx) => idx % 2 === 0));
			const offsets = mixedArr.filter((item, idx) => idx % 2 === 1).map(offset => {
				return {
					commentStrOffset: offset,
					ignore: false
				};
			});
			LineCommentCommand._normalizeInsertionPoint(model, offsets, 1, tabSize);
			const actual = offsets.map(item => item.commentStrOffset);
			assert.deepEqual(actual, expected, testName);
		};

		// Bug 16696:[comment] comments not aligned in this case
		runTest([
			'  XX', 2,
			'    YY', 4
		], 4, [0, 0], 'Bug 16696');

		runTest([
			'\t\t\tXX', 3,
			'    \tYY', 5,
			'        ZZ', 8,
			'\t\tTT', 2
		], 4, [2, 5, 8, 2], 'Test1');

		runTest([
			'\t\t\t   XX', 6,
			'    \t\t\t\tYY', 8,
			'        ZZ', 8,
			'\t\t    TT', 6
		], 4, [2, 5, 8, 2], 'Test2');

		runTest([
			'\t\t', 2,
			'\t\t\t', 3,
			'\t\t\t\t', 4,
			'\t\t\t', 3
		], 4, [2, 2, 2, 2], 'Test3');

		runTest([
			'\t\t', 2,
			'\t\t\t', 3,
			'\t\t\t\t', 4,
			'\t\t\t', 3,
			'    ', 4
		], 2, [2, 2, 2, 2, 4], 'Test4');

		runTest([
			'\t\t', 2,
			'\t\t\t', 3,
			'\t\t\t\t', 4,
			'\t\t\t', 3,
			'    ', 4
		], 4, [1, 1, 1, 1, 4], 'Test5');

		runTest([
			' \t', 2,
			'  \t', 3,
			'   \t', 4,
			'    ', 4,
			'\t', 1
		], 4, [2, 3, 4, 4, 1], 'Test6');

		runTest([
			' \t\t', 3,
			'  \t\t', 4,
			'   \t\t', 5,
			'    \t', 5,
			'\t', 1
		], 4, [2, 3, 4, 4, 1], 'Test7');

		runTest([
			'\t', 1,
			'    ', 4
		], 4, [1, 4], 'Test8:4');
		runTest([
			'\t', 1,
			'   ', 3
		], 4, [0, 0], 'Test8:3');
		runTest([
			'\t', 1,
			'  ', 2
		], 4, [0, 0], 'Test8:2');
		runTest([
			'\t', 1,
			' ', 1
		], 4, [0, 0], 'Test8:1');
		runTest([
			'\t', 1,
			'', 0
		], 4, [0, 0], 'Test8:0');
	});

	test('detects indentation', function () {
		testLineCommentCommand(
			[
				'\tsome text',
				'\tsome more text'
			],
			new Selection(2, 2, 1, 1),
			[
				'\t!@# some text',
				'\t!@# some more text'
			],
			new Selection(2, 2, 1, 1)
		);
	});

	test('detects mixed indentation', function () {
		testLineCommentCommand(
			[
				'\tsome text',
				'    some more text'
			],
			new Selection(2, 2, 1, 1),
			[
				'\t!@# some text',
				'    !@# some more text'
			],
			new Selection(2, 2, 1, 1)
		);
	});

	test('ignores whitespace lines', function () {
		testLineCommentCommand(
			[
				'\tsome text',
				'\t   ',
				'',
				'\tsome more text'
			],
			new Selection(4, 2, 1, 1),
			[
				'\t!@# some text',
				'\t   ',
				'',
				'\t!@# some more text'
			],
			new Selection(4, 2, 1, 1)
		);
	});

	test('removes its own', function () {
		testLineCommentCommand(
			[
				'\t!@# some text',
				'\t   ',
				'\t\t!@# some more text'
			],
			new Selection(3, 2, 1, 1),
			[
				'\tsome text',
				'\t   ',
				'\t\tsome more text'
			],
			new Selection(3, 2, 1, 1)
		);
	});

	test('works in only whitespace', function () {
		testLineCommentCommand(
			[
				'\t    ',
				'\t',
				'\t\tsome more text'
			],
			new Selection(3, 1, 1, 1),
			[
				'\t!@#     ',
				'\t!@# ',
				'\t\tsome more text'
			],
			new Selection(3, 1, 1, 1)
		);
	});

	test('bug 9697 - whitespace before comment token', function () {
		testLineCommentCommand(
			[
				'\t !@#first',
				'\tsecond line'
			],
			new Selection(1, 1, 1, 1),
			[
				'\t first',
				'\tsecond line'
			],
			new Selection(1, 1, 1, 1)
		);
	});

	test('bug 10162 - line comment before caret', function () {
		testLineCommentCommand(
			[
				'first!@#',
				'\tsecond line'
			],
			new Selection(1, 1, 1, 1),
			[
				'!@# first!@#',
				'\tsecond line'
			],
			new Selection(1, 5, 1, 5)
		);
	});

	test('comment single line - leading whitespace', function () {
		testLineCommentCommand(
			[
				'first!@#',
				'\tsecond line'
			],
			new Selection(2, 3, 2, 1),
			[
				'first!@#',
				'\t!@# second line'
			],
			new Selection(2, 7, 2, 1)
		);
	});

	test('ignores invisible selection', function () {
		testLineCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 1, 1, 1),
			[
				'!@# first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 1, 1, 5)
		);
	});

	test('multiple lines', function () {
		testLineCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 4, 1, 1),
			[
				'!@# first',
				'!@# \tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 8, 1, 5)
		);
	});

	test('multiple modes on multiple lines', function () {
		testLineCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(4, 4, 3, 1),
			[
				'first',
				'\tsecond line',
				'!@# third line',
				'!@# fourth line',
				'fifth'
			],
			new Selection(4, 8, 3, 5)
		);
	});

	test('toggle single line', function () {
		testLineCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 1),
			[
				'!@# first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 5, 1, 5)
		);

		testLineCommentCommand(
			[
				'!@# first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 4, 1, 4),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 1)
		);
	});

	test('toggle multiple lines', function () {
		testLineCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 4, 1, 1),
			[
				'!@# first',
				'!@# \tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 8, 1, 5)
		);

		testLineCommentCommand(
			[
				'!@# first',
				'!@# \tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 7, 1, 4),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 3, 1, 1)
		);
	});

	test('issue #5964: Ctrl+/ to create comment when cursor is at the beginning of the line puts the cursor in a strange position', () => {
		testLineCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 1),
			[
				'!@# first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 5, 1, 5)
		);
	});

	test('issue #35673: Comment hotkeys throws the cursor before the comment', () => {
		testLineCommentCommand(
			[
				'first',
				'',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 1, 2, 1),
			[
				'first',
				'!@# ',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 5, 2, 5)
		);

		testLineCommentCommand(
			[
				'first',
				'\t',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 2, 2, 2),
			[
				'first',
				'\t!@# ',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 6, 2, 6)
		);
	});

	test('issue #2837 "Add Line Comment" fault when blank lines involved', function () {
		testAddLineCommentCommand(
			[
				'    if displayName == "":',
				'        displayName = groupName',
				'    description = getAttr(attributes, "description")',
				'    mailAddress = getAttr(attributes, "mail")',
				'',
				'    print "||Group name|%s|" % displayName',
				'    print "||Description|%s|" % description',
				'    print "||Email address|[mailto:%s]|" % mailAddress`',
			],
			new Selection(1, 1, 8, 56),
			[
				'    !@# if displayName == "":',
				'    !@#     displayName = groupName',
				'    !@# description = getAttr(attributes, "description")',
				'    !@# mailAddress = getAttr(attributes, "mail")',
				'',
				'    !@# print "||Group name|%s|" % displayName',
				'    !@# print "||Description|%s|" % description',
				'    !@# print "||Email address|[mailto:%s]|" % mailAddress`',
			],
			new Selection(1, 1, 8, 60)
		);
	});

	test('issue #47004: Toggle comments shouldn\'t move cursor', () => {
		testAddLineCommentCommand(
			[
				'    A line',
				'    Another line'
			],
			new Selection(2, 7, 1, 1),
			[
				'    !@# A line',
				'    !@# Another line'
			],
			new Selection(2, 11, 1, 1)
		);
	});

	test('insertSpace false', () => {
		function testLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
			let mode = new CommentMode({ lineComment: '!@#' });
			testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new LineCommentCommand(sel, 4, Type.Toggle, false, true), expectedLines, expectedSelection);
			mode.dispose();
		}

		testLineCommentCommand(
			[
				'some text'
			],
			new Selection(1, 1, 1, 1),
			[
				'!@#some text'
			],
			new Selection(1, 4, 1, 4)
		);
	});

	test('insertSpace false does not remove space', () => {
		function testLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
			let mode = new CommentMode({ lineComment: '!@#' });
			testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new LineCommentCommand(sel, 4, Type.Toggle, false, true), expectedLines, expectedSelection);
			mode.dispose();
		}

		testLineCommentCommand(
			[
				'!@#    some text'
			],
			new Selection(1, 1, 1, 1),
			[
				'    some text'
			],
			new Selection(1, 1, 1, 1)
		);
	});

	suite('ignoreEmptyLines false', () => {
		function testLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
			let mode = new CommentMode({ lineComment: '!@#', blockComment: ['<!@#', '#@!>'] });
			testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new LineCommentCommand(sel, 4, Type.Toggle, true, false), expectedLines, expectedSelection);
			mode.dispose();
		}

		test('does not ignore whitespace lines', () => {
			testLineCommentCommand(
				[
					'\tsome text',
					'\t   ',
					'',
					'\tsome more text'
				],
				new Selection(4, 2, 1, 1),
				[
					'!@# \tsome text',
					'!@# \t   ',
					'!@# ',
					'!@# \tsome more text'
				],
				new Selection(4, 6, 1, 5)
			);
		});

		test('removes its own', function () {
			testLineCommentCommand(
				[
					'\t!@# some text',
					'\t   ',
					'\t\t!@# some more text'
				],
				new Selection(3, 2, 1, 1),
				[
					'\tsome text',
					'\t   ',
					'\t\tsome more text'
				],
				new Selection(3, 2, 1, 1)
			);
		});

		test('works in only whitespace', function () {
			testLineCommentCommand(
				[
					'\t    ',
					'\t',
					'\t\tsome more text'
				],
				new Selection(3, 1, 1, 1),
				[
					'\t!@#     ',
					'\t!@# ',
					'\t\tsome more text'
				],
				new Selection(3, 1, 1, 1)
			);
		});

		test('comments single line', function () {
			testLineCommentCommand(
				[
					'some text',
					'\tsome more text'
				],
				new Selection(1, 1, 1, 1),
				[
					'!@# some text',
					'\tsome more text'
				],
				new Selection(1, 5, 1, 5)
			);
		});

		test('detects indentation', function () {
			testLineCommentCommand(
				[
					'\tsome text',
					'\tsome more text'
				],
				new Selection(2, 2, 1, 1),
				[
					'\t!@# some text',
					'\t!@# some more text'
				],
				new Selection(2, 2, 1, 1)
			);
		});
	});
});

suite('Editor Contrib - Line Comment As Block Comment', () => {

	function testLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
		let mode = new CommentMode({ lineComment: '', blockComment: ['(', ')'] });
		testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new LineCommentCommand(sel, 4, Type.Toggle, true, true), expectedLines, expectedSelection);
		mode.dispose();
	}

	test('fall back to block comment command', function () {
		testLineCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 1),
			[
				'( first )',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 3, 1, 3)
		);
	});

	test('fall back to block comment command - toggle', function () {
		testLineCommentCommand(
			[
				'(first)',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 7, 1, 2),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 6, 1, 1)
		);
	});

	test('bug 9513 - expand single line to uncomment auto block', function () {
		testLineCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 1),
			[
				'( first )',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 3, 1, 3)
		);
	});

	test('bug 9691 - always expand selection to line boundaries', function () {
		testLineCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(3, 2, 1, 3),
			[
				'( first',
				'\tsecond line',
				'third line )',
				'fourth line',
				'fifth'
			],
			new Selection(3, 2, 1, 5)
		);

		testLineCommentCommand(
			[
				'(first',
				'\tsecond line',
				'third line)',
				'fourth line',
				'fifth'
			],
			new Selection(3, 11, 1, 2),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(3, 11, 1, 1)
		);
	});
});

suite('Editor Contrib - Line Comment As Block Comment 2', () => {
	function testLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
		let mode = new CommentMode({ lineComment: null, blockComment: ['<!@#', '#@!>'] });
		testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new LineCommentCommand(sel, 4, Type.Toggle, true, true), expectedLines, expectedSelection);
		mode.dispose();
	}

	test('no selection => uses indentation', function () {
		testLineCommentCommand(
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\t<!@#fifth#@!>\t\t'
			],
			new Selection(1, 1, 1, 1),
			[
				'\t\t<!@# first\t     #@!>',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\t<!@#fifth#@!>\t\t'
			],
			new Selection(1, 1, 1, 1)
		);

		testLineCommentCommand(
			[
				'\t\t<!@#first\t    #@!>',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\t<!@#fifth#@!>\t\t'
			],
			new Selection(1, 1, 1, 1),
			[
				'\t\tfirst\t   ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\t<!@#fifth#@!>\t\t'
			],
			new Selection(1, 1, 1, 1)
		);
	});

	test('can remove', function () {
		testLineCommentCommand(
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\t<!@#fifth#@!>\t\t'
			],
			new Selection(5, 1, 5, 1),
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\tfifth\t\t'
			],
			new Selection(5, 1, 5, 1)
		);

		testLineCommentCommand(
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\t<!@#fifth#@!>\t\t'
			],
			new Selection(5, 3, 5, 3),
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\tfifth\t\t'
			],
			new Selection(5, 3, 5, 3)
		);

		testLineCommentCommand(
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\t<!@#fifth#@!>\t\t'
			],
			new Selection(5, 4, 5, 4),
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\tfifth\t\t'
			],
			new Selection(5, 3, 5, 3)
		);

		testLineCommentCommand(
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\t<!@#fifth#@!>\t\t'
			],
			new Selection(5, 16, 5, 3),
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\tfifth\t\t'
			],
			new Selection(5, 8, 5, 3)
		);

		testLineCommentCommand(
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\t<!@#fifth#@!>\t\t'
			],
			new Selection(5, 12, 5, 7),
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\tfifth\t\t'
			],
			new Selection(5, 8, 5, 3)
		);

		testLineCommentCommand(
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\t<!@#fifth#@!>\t\t'
			],
			new Selection(5, 18, 5, 18),
			[
				'\t\tfirst\t    ',
				'\t\tsecond line',
				'\tthird line',
				'fourth line',
				'\t\tfifth\t\t'
			],
			new Selection(5, 10, 5, 10)
		);
	});

	test('issue #993: Remove comment does not work consistently in HTML', () => {
		testLineCommentCommand(
			[
				'     asd qwe',
				'     asd qwe',
				''
			],
			new Selection(1, 1, 3, 1),
			[
				'     <!@# asd qwe',
				'     asd qwe #@!>',
				''
			],
			new Selection(1, 1, 3, 1)
		);

		testLineCommentCommand(
			[
				'     <!@#asd qwe',
				'     asd qwe#@!>',
				''
			],
			new Selection(1, 1, 3, 1),
			[
				'     asd qwe',
				'     asd qwe',
				''
			],
			new Selection(1, 1, 3, 1)
		);
	});
});

suite('Editor Contrib - Line Comment in mixed modes', () => {

	const OUTER_LANGUAGE_ID = new modes.LanguageIdentifier('outerMode', 3);
	const INNER_LANGUAGE_ID = new modes.LanguageIdentifier('innerMode', 4);

	class OuterMode extends MockMode {
		constructor(commentsConfig: CommentRule) {
			super(OUTER_LANGUAGE_ID);
			this._register(LanguageConfigurationRegistry.register(this.getLanguageIdentifier(), {
				comments: commentsConfig
			}));

			this._register(modes.TokenizationRegistry.register(this.getLanguageIdentifier().language, {
				getInitialState: (): modes.IState => NULL_STATE,
				tokenize: () => {
					throw new Error('not implemented');
				},
				tokenize2: (line: string, state: modes.IState): TokenizationResult2 => {
					let languageId = (/^  /.test(line) ? INNER_LANGUAGE_ID : OUTER_LANGUAGE_ID);

					let tokens = new Uint32Array(1 << 1);
					tokens[(0 << 1)] = 0;
					tokens[(0 << 1) + 1] = (
						(modes.ColorId.DefaultForeground << modes.MetadataConsts.FOREGROUND_OFFSET)
						| (languageId.id << modes.MetadataConsts.LANGUAGEID_OFFSET)
					);
					return new TokenizationResult2(tokens, state);
				}
			}));
		}
	}

	class InnerMode extends MockMode {
		constructor(commentsConfig: CommentRule) {
			super(INNER_LANGUAGE_ID);
			this._register(LanguageConfigurationRegistry.register(this.getLanguageIdentifier(), {
				comments: commentsConfig
			}));
		}
	}

	function testLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
		let outerMode = new OuterMode({ lineComment: '//', blockComment: ['/*', '*/'] });
		let innerMode = new InnerMode({ lineComment: null, blockComment: ['{/*', '*/}'] });
		testCommand(
			lines,
			outerMode.getLanguageIdentifier(),
			selection,
			(sel) => new LineCommentCommand(sel, 4, Type.Toggle, true, true),
			expectedLines,
			expectedSelection,
			true
		);
		innerMode.dispose();
		outerMode.dispose();
	}

	test('issue #24047 (part 1): Commenting code in JSX files', () => {
		testLineCommentCommand(
			[
				'import React from \'react\';',
				'const Loader = () => (',
				'  <div>',
				'    Loading...',
				'  </div>',
				');',
				'export default Loader;'
			],
			new Selection(1, 1, 7, 22),
			[
				'// import React from \'react\';',
				'// const Loader = () => (',
				'//   <div>',
				'//     Loading...',
				'//   </div>',
				'// );',
				'// export default Loader;'
			],
			new Selection(1, 4, 7, 25),
		);
	});

	test('issue #24047 (part 2): Commenting code in JSX files', () => {
		testLineCommentCommand(
			[
				'import React from \'react\';',
				'const Loader = () => (',
				'  <div>',
				'    Loading...',
				'  </div>',
				');',
				'export default Loader;'
			],
			new Selection(3, 4, 3, 4),
			[
				'import React from \'react\';',
				'const Loader = () => (',
				'  {/* <div> */}',
				'    Loading...',
				'  </div>',
				');',
				'export default Loader;'
			],
			new Selection(3, 8, 3, 8),
		);
	});

	test('issue #36173: Commenting code in JSX tag body', () => {
		testLineCommentCommand(
			[
				'<div>',
				'  {123}',
				'</div>',
			],
			new Selection(2, 4, 2, 4),
			[
				'<div>',
				'  {/* {123} */}',
				'</div>',
			],
			new Selection(2, 8, 2, 8),
		);
	});
});
