/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { Selection } from 'vs/editor/common/core/selection';
import { BlockCommentCommand } from 'vs/editor/contrib/comment/blockCommentCommand';
import { testCommand } from 'vs/editor/test/browser/testCommand';
import { CommentMode } from 'vs/editor/test/common/commentMode';

function testBlockCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
	let mode = new CommentMode({ lineComment: '!@#', blockComment: ['<0', '0>'] });
	testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new BlockCommentCommand(sel, true), expectedLines, expectedSelection);
	mode.dispose();
}

suite('Editor Contrib - Block Comment Command', () => {

	test('empty selection wraps itself', function () {
		testBlockCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 3, 1, 3),
			[
				'fi<0  0>rst',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 6, 1, 6)
		);
	});

	test('invisible selection ignored', function () {
		testBlockCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 1, 1, 1),
			[
				'<0 first',
				' 0>\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 4, 2, 1)
		);
	});

	test('bug9511', () => {
		testBlockCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 6, 1, 1),
			[
				'<0 first 0>',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 4, 1, 9)
		);

		testBlockCommentCommand(
			[
				'<0first0>',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 8, 1, 3),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 6)
		);
	});

	test('one line selection', function () {
		testBlockCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 6, 1, 3),
			[
				'fi<0 rst 0>',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 6, 1, 9)
		);
	});

	test('one line selection toggle', function () {
		testBlockCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 6, 1, 3),
			[
				'fi<0 rst 0>',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 6, 1, 9)
		);

		testBlockCommentCommand(
			[
				'fi<0rst0>',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 8, 1, 5),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 3, 1, 6)
		);

		testBlockCommentCommand(
			[
				'<0 first 0>',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 10, 1, 1),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 6)
		);

		testBlockCommentCommand(
			[
				'<0 first0>',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 9, 1, 1),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 6)
		);

		testBlockCommentCommand(
			[
				'<0first 0>',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 9, 1, 1),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 1, 6)
		);

		testBlockCommentCommand(
			[
				'fi<0rst0>',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 8, 1, 5),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 3, 1, 6)
		);
	});

	test('multi line selection', function () {
		testBlockCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 4, 1, 1),
			[
				'<0 first',
				'\tse 0>cond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 4, 2, 4)
		);
	});

	test('multi line selection toggle', function () {
		testBlockCommentCommand(
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 4, 1, 1),
			[
				'<0 first',
				'\tse 0>cond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 4, 2, 4)
		);

		testBlockCommentCommand(
			[
				'<0first',
				'\tse0>cond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 4, 1, 3),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 2, 4)
		);

		testBlockCommentCommand(
			[
				'<0 first',
				'\tse0>cond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 4, 1, 3),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 2, 4)
		);

		testBlockCommentCommand(
			[
				'<0first',
				'\tse 0>cond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 4, 1, 3),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 2, 4)
		);

		testBlockCommentCommand(
			[
				'<0 first',
				'\tse 0>cond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 4, 1, 3),
			[
				'first',
				'\tsecond line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 1, 2, 4)
		);
	});

	test('fuzzy removes', function () {
		testBlockCommentCommand(
			[
				'asd <0 qwe',
				'asd 0> qwe'
			],
			new Selection(2, 5, 1, 7),
			[
				'asd qwe',
				'asd qwe'
			],
			new Selection(1, 5, 2, 4)
		);

		testBlockCommentCommand(
			[
				'asd <0 qwe',
				'asd 0> qwe'
			],
			new Selection(2, 5, 1, 6),
			[
				'asd qwe',
				'asd qwe'
			],
			new Selection(1, 5, 2, 4)
		);

		testBlockCommentCommand(
			[
				'asd <0 qwe',
				'asd 0> qwe'
			],
			new Selection(2, 5, 1, 5),
			[
				'asd qwe',
				'asd qwe'
			],
			new Selection(1, 5, 2, 4)
		);

		testBlockCommentCommand(
			[
				'asd <0 qwe',
				'asd 0> qwe'
			],
			new Selection(2, 5, 1, 11),
			[
				'asd qwe',
				'asd qwe'
			],
			new Selection(1, 5, 2, 4)
		);

		testBlockCommentCommand(
			[
				'asd <0 qwe',
				'asd 0> qwe'
			],
			new Selection(2, 1, 1, 11),
			[
				'asd qwe',
				'asd qwe'
			],
			new Selection(1, 5, 2, 4)
		);

		testBlockCommentCommand(
			[
				'asd <0 qwe',
				'asd 0> qwe'
			],
			new Selection(2, 7, 1, 11),
			[
				'asd qwe',
				'asd qwe'
			],
			new Selection(1, 5, 2, 4)
		);
	});

	test('bug #30358', function () {
		testBlockCommentCommand(
			[
				'<0 start 0> middle end',
			],
			new Selection(1, 20, 1, 23),
			[
				'<0 start 0> middle <0 end 0>'
			],
			new Selection(1, 23, 1, 26)
		);

		testBlockCommentCommand(
			[
				'<0 start 0> middle <0 end 0>'
			],
			new Selection(1, 13, 1, 19),
			[
				'<0 start 0> <0 middle 0> <0 end 0>'
			],
			new Selection(1, 16, 1, 22)
		);
	});

	test('issue #34618', function () {
		testBlockCommentCommand(
			[
				'<0  0> middle end',
			],
			new Selection(1, 4, 1, 4),
			[
				' middle end'
			],
			new Selection(1, 1, 1, 1)
		);
	});

	test('', () => {
	});

	test('insertSpace false', () => {
		function testLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
			let mode = new CommentMode({ lineComment: '!@#', blockComment: ['<0', '0>'] });
			testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new BlockCommentCommand(sel, false), expectedLines, expectedSelection);
			mode.dispose();
		}

		testLineCommentCommand(
			[
				'some text'
			],
			new Selection(1, 1, 1, 5),
			[
				'<0some0> text'
			],
			new Selection(1, 3, 1, 7)
		);
	});

	test('insertSpace false does not remove space', () => {
		function testLineCommentCommand(lines: string[], selection: Selection, expectedLines: string[], expectedSelection: Selection): void {
			let mode = new CommentMode({ lineComment: '!@#', blockComment: ['<0', '0>'] });
			testCommand(lines, mode.getLanguageIdentifier(), selection, (sel) => new BlockCommentCommand(sel, false), expectedLines, expectedSelection);
			mode.dispose();
		}

		testLineCommentCommand(
			[
				'<0 some 0> text'
			],
			new Selection(1, 4, 1, 8),
			[
				' some  text'
			],
			new Selection(1, 1, 1, 7)
		);
	});
});
