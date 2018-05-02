/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
'use strict';

import * as assert from 'assert';
import { Selection } from 'vs/editor/common/core/selection';
import { Position } from 'vs/editor/common/core/position';
import { Handler } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { withTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { DeleteAllLeftAction, JoinLinesAction, TransposeAction, UpperCaseAction, LowerCaseAction, DeleteAllRightAction, InsertLineBeforeAction, InsertLineAfterAction, IndentLinesAction, SortLinesAscendingAction, SortLinesDescendingAction, MoveLinesUpAction, MoveLinesDownAction } from 'vs/editor/contrib/linesOperations/linesOperations';
import { Cursor } from 'vs/editor/common/controller/cursor';
import { CoreEditingCommands } from 'vs/editor/browser/controller/coreCommands';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';


suite('Editor Contrib - Line Operations', () => {
	suite('AbstractMoveLinesAction', () => {
		test('should move multiple cursors up', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesUpAction = new MoveLinesUpAction();

					let multiSelect = [new Selection(3, 6, 3, 6), new Selection(4, 6, 4, 6)];
					editor.setSelections(multiSelect);
					moveLinesUpAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'1111111',
						'3333333',
						'4444444',
						'2222222',
						'5555555'
					]);
				});
		});

		test('should move multiple cursors down', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesDownAction = new MoveLinesDownAction();

					let multiSelect = [new Selection(2, 6, 2, 6), new Selection(3, 6, 3, 6)];
					editor.setSelections(multiSelect);
					moveLinesDownAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'1111111',
						'4444444',
						'2222222',
						'3333333',
						'5555555'
					]);
				});
		});

		test('should not move multiple cursor up at line 1', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesUpAction = new MoveLinesUpAction();

					let multiSelect = [new Selection(1, 6, 1, 6), new Selection(2, 6, 2, 6)];
					editor.setSelections(multiSelect);
					moveLinesUpAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'1111111',
						'2222222',
						'3333333',
						'4444444',
						'5555555'
					]);
				});
		});

		test('should move multiple cursor down at line 1', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesDownAction = new MoveLinesDownAction();

					let multiSelect = [new Selection(1, 6, 1, 6), new Selection(2, 6, 2, 6)];
					editor.setSelections(multiSelect);
					moveLinesDownAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'3333333',
						'1111111',
						'2222222',
						'4444444',
						'5555555'
					]);
				});
		});

		test('should move multiple cursor up at last line', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesUpAction = new MoveLinesUpAction();

					let multiSelect = [new Selection(4, 6, 4, 6), new Selection(5, 6, 5, 6)];
					editor.setSelections(multiSelect);
					moveLinesUpAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'1111111',
						'2222222',
						'4444444',
						'5555555',
						'3333333'
					]);
				});
		});

		test('should not move multiple cursor down at last line', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesDownAction = new MoveLinesDownAction();

					let multiSelect = [new Selection(5, 6, 5, 6), new Selection(6, 6, 6, 6)];
					editor.setSelections(multiSelect);
					moveLinesDownAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'1111111',
						'2222222',
						'3333333',
						'4444444',
						'5555555'
					]);
				});
		});

		test('should move single cursor up at 2nd line', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesUpAction = new MoveLinesUpAction();

					let multiSelect = [new Selection(2, 6, 2, 6)];
					editor.setSelections(multiSelect);
					moveLinesUpAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'2222222',
						'1111111',
						'3333333',
						'4444444',
						'5555555'
					]);
				});
		});

		test('should move single cursor down', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesDownAction = new MoveLinesDownAction();

					let multiSelect = [new Selection(2, 6, 2, 6)];
					editor.setSelections(multiSelect);
					moveLinesDownAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'1111111',
						'3333333',
						'2222222',
						'4444444',
						'5555555'
					]);
				});
		});

		test('should not move single cursor up at line 1', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesUpAction = new MoveLinesUpAction();

					let multiSelect = [new Selection(1, 6, 1, 6)];
					editor.setSelections(multiSelect);
					moveLinesUpAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'1111111',
						'2222222',
						'3333333',
						'4444444',
						'5555555'
					]);
				});
		});

		test('should move single cursor down at line 1', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesDownAction = new MoveLinesDownAction();

					let multiSelect = [new Selection(1, 6, 1, 6)];
					editor.setSelections(multiSelect);
					moveLinesDownAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'2222222',
						'1111111',
						'3333333',
						'4444444',
						'5555555'
					]);
				});
		});

		test('should move single cursor up at last line', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesUpAction = new MoveLinesUpAction();

					let multiSelect = [new Selection(5, 6, 5, 6)];
					editor.setSelections(multiSelect);
					moveLinesUpAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'1111111',
						'2222222',
						'3333333',
						'5555555',
						'4444444'
					]);
				});
		});

		test('should not move single cursor down at last line', function () {
			withTestCodeEditor(
				[
					'1111111',
					'2222222',
					'3333333',
					'4444444',
					'5555555'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesDownAction = new MoveLinesDownAction();

					let multiSelect = [new Selection(5, 6, 5, 6)];
					editor.setSelections(multiSelect);
					moveLinesDownAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'1111111',
						'2222222',
						'3333333',
						'4444444',
						'5555555'
					]);
				});
		});

		test('move line should still work as before if there is no indentation rules', function () {
			withTestCodeEditor(
				[
					'if (true) {',
					'    var task = new Task(() => {',
					'        var work = 1234;',
					'    });',
					'}'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let moveLinesDownAction = new MoveLinesDownAction();

					let multiSelect = [new Selection(2, 1, 2, 1)];
					editor.setSelections(multiSelect);
					moveLinesDownAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'if (true) {',
						'        var work = 1234;',
						'    var task = new Task(() => {',
						'    });',
						'}'
					]);
				});
		});

	});

	suite('SortLinesAscendingAction', () => {
		test('should sort selected lines in ascending order', function () {
			withTestCodeEditor(
				[
					'omicron',
					'beta',
					'alpha'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let sortLinesAscendingAction = new SortLinesAscendingAction();

					editor.setSelection(new Selection(1, 1, 3, 5));
					sortLinesAscendingAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'alpha',
						'beta',
						'omicron'
					]);
					assert.deepEqual(editor.getSelection().toString(), new Selection(1, 1, 3, 7).toString());
				});
		});

		test('should sort multiple selections in ascending order', function () {
			withTestCodeEditor(
				[
					'omicron',
					'beta',
					'alpha',
					'',
					'omicron',
					'beta',
					'alpha'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let sortLinesAscendingAction = new SortLinesAscendingAction();

					editor.setSelections([new Selection(1, 1, 3, 5), new Selection(5, 1, 7, 5)]);
					sortLinesAscendingAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'alpha',
						'beta',
						'omicron',
						'',
						'alpha',
						'beta',
						'omicron'
					]);
					let expectedSelections = [
						new Selection(1, 1, 3, 7),
						new Selection(5, 1, 7, 7)
					];
					editor.getSelections().forEach((actualSelection, index) => {
						assert.deepEqual(actualSelection.toString(), expectedSelections[index].toString());
					});
				});
		});
	});

	suite('SortLinesDescendingAction', () => {
		test('should sort selected lines in descending order', function () {
			withTestCodeEditor(
				[
					'alpha',
					'beta',
					'omicron'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let sortLinesDescendingAction = new SortLinesDescendingAction();

					editor.setSelection(new Selection(1, 1, 3, 7));
					sortLinesDescendingAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'omicron',
						'beta',
						'alpha'
					]);
					assert.deepEqual(editor.getSelection().toString(), new Selection(1, 1, 3, 5).toString());
				});
		});

		test('should sort multiple selections in descending order', function () {
			withTestCodeEditor(
				[
					'alpha',
					'beta',
					'omicron',
					'',
					'alpha',
					'beta',
					'omicron'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let sortLinesDescendingAction = new SortLinesDescendingAction();

					editor.setSelections([new Selection(1, 1, 3, 7), new Selection(5, 1, 7, 7)]);
					sortLinesDescendingAction.run(null, editor);
					assert.deepEqual(model.getLinesContent(), [
						'omicron',
						'beta',
						'alpha',
						'',
						'omicron',
						'beta',
						'alpha'
					]);
					let expectedSelections = [
						new Selection(1, 1, 3, 5),
						new Selection(5, 1, 7, 5)
					];
					editor.getSelections().forEach((actualSelection, index) => {
						assert.deepEqual(actualSelection.toString(), expectedSelections[index].toString());
					});
				});
		});
	});


	suite('DeleteAllLeftAction', () => {
		test('should delete to the left of the cursor', function () {
			withTestCodeEditor(
				[
					'one',
					'two',
					'three'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let deleteAllLeftAction = new DeleteAllLeftAction();

					editor.setSelection(new Selection(1, 2, 1, 2));
					deleteAllLeftAction.run(null, editor);
					assert.equal(model.getLineContent(1), 'ne', '001');

					editor.setSelections([new Selection(2, 2, 2, 2), new Selection(3, 2, 3, 2)]);
					deleteAllLeftAction.run(null, editor);
					assert.equal(model.getLineContent(2), 'wo', '002');
					assert.equal(model.getLineContent(3), 'hree', '003');
				});
		});

		test('should work in multi cursor mode', function () {
			withTestCodeEditor(
				[
					'hello',
					'world',
					'hello world',
					'hello',
					'bonjour',
					'hola',
					'world',
					'hello world',
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let deleteAllLeftAction = new DeleteAllLeftAction();

					editor.setSelections([new Selection(1, 2, 1, 2), new Selection(1, 4, 1, 4)]);
					deleteAllLeftAction.run(null, editor);
					assert.equal(model.getLineContent(1), 'lo', '001');

					editor.setSelections([new Selection(2, 2, 2, 2), new Selection(2, 4, 2, 5)]);
					deleteAllLeftAction.run(null, editor);
					assert.equal(model.getLineContent(2), 'ord', '002');

					editor.setSelections([new Selection(3, 2, 3, 5), new Selection(3, 7, 3, 7)]);
					deleteAllLeftAction.run(null, editor);
					assert.equal(model.getLineContent(3), 'world', '003');

					editor.setSelections([new Selection(4, 3, 4, 3), new Selection(4, 5, 5, 4)]);
					deleteAllLeftAction.run(null, editor);
					assert.equal(model.getLineContent(4), 'lljour', '004');

					editor.setSelections([new Selection(5, 3, 6, 3), new Selection(6, 5, 7, 5), new Selection(7, 7, 7, 7)]);
					deleteAllLeftAction.run(null, editor);
					assert.equal(model.getLineContent(5), 'horlworld', '005');
				});
		});

		test('issue #36234: should push undo stop', () => {
			withTestCodeEditor(
				[
					'one',
					'two',
					'three'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let deleteAllLeftAction = new DeleteAllLeftAction();

					editor.setSelection(new Selection(1, 1, 1, 1));

					editor.trigger('keyboard', Handler.Type, { text: 'Typing some text here on line ' });
					assert.equal(model.getLineContent(1), 'Typing some text here on line one');
					assert.deepEqual(editor.getSelection(), new Selection(1, 31, 1, 31));

					deleteAllLeftAction.run(null, editor);
					assert.equal(model.getLineContent(1), 'one');
					assert.deepEqual(editor.getSelection(), new Selection(1, 1, 1, 1));

					editor.trigger('keyboard', Handler.Undo, {});
					assert.equal(model.getLineContent(1), 'Typing some text here on line one');
					assert.deepEqual(editor.getSelection(), new Selection(1, 31, 1, 31));
				});
		});
	});

	suite('JoinLinesAction', () => {
		test('should join lines and insert space if necessary', function () {
			withTestCodeEditor(
				[
					'hello',
					'world',
					'hello ',
					'world',
					'hello		',
					'	world',
					'hello   ',
					'	world',
					'',
					'',
					'hello world'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let joinLinesAction = new JoinLinesAction();

					editor.setSelection(new Selection(1, 2, 1, 2));
					joinLinesAction.run(null, editor);
					assert.equal(model.getLineContent(1), 'hello world', '001');
					assert.deepEqual(editor.getSelection().toString(), new Selection(1, 6, 1, 6).toString(), '002');

					editor.setSelection(new Selection(2, 2, 2, 2));
					joinLinesAction.run(null, editor);
					assert.equal(model.getLineContent(2), 'hello world', '003');
					assert.deepEqual(editor.getSelection().toString(), new Selection(2, 7, 2, 7).toString(), '004');

					editor.setSelection(new Selection(3, 2, 3, 2));
					joinLinesAction.run(null, editor);
					assert.equal(model.getLineContent(3), 'hello world', '005');
					assert.deepEqual(editor.getSelection().toString(), new Selection(3, 7, 3, 7).toString(), '006');

					editor.setSelection(new Selection(4, 2, 5, 3));
					joinLinesAction.run(null, editor);
					assert.equal(model.getLineContent(4), 'hello world', '007');
					assert.deepEqual(editor.getSelection().toString(), new Selection(4, 2, 4, 8).toString(), '008');

					editor.setSelection(new Selection(5, 1, 7, 3));
					joinLinesAction.run(null, editor);
					assert.equal(model.getLineContent(5), 'hello world', '009');
					assert.deepEqual(editor.getSelection().toString(), new Selection(5, 1, 5, 3).toString(), '010');
				});
		});

		test('should work in multi cursor mode', function () {
			withTestCodeEditor(
				[
					'hello',
					'world',
					'hello ',
					'world',
					'hello		',
					'	world',
					'hello   ',
					'	world',
					'',
					'',
					'hello world'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let joinLinesAction = new JoinLinesAction();

					editor.setSelections([
						/** primary cursor */
						new Selection(5, 2, 5, 2),
						new Selection(1, 2, 1, 2),
						new Selection(3, 2, 4, 2),
						new Selection(5, 4, 6, 3),
						new Selection(7, 5, 8, 4),
						new Selection(10, 1, 10, 1)
					]);

					joinLinesAction.run(null, editor);
					assert.equal(model.getLinesContent().join('\n'), 'hello world\nhello world\nhello world\nhello world\n\nhello world', '001');
					assert.deepEqual(editor.getSelections().toString(), [
						/** primary cursor */
						new Selection(3, 4, 3, 8),
						new Selection(1, 6, 1, 6),
						new Selection(2, 2, 2, 8),
						new Selection(4, 5, 4, 9),
						new Selection(6, 1, 6, 1)
					].toString(), '002');

					/** primary cursor */
					assert.deepEqual(editor.getSelection().toString(), new Selection(3, 4, 3, 8).toString(), '003');
				});
		});

		test('should push undo stop', function () {
			withTestCodeEditor(
				[
					'hello',
					'world'
				], {}, (editor, cursor) => {
					let model = editor.getModel();
					let joinLinesAction = new JoinLinesAction();

					editor.setSelection(new Selection(1, 6, 1, 6));

					editor.trigger('keyboard', Handler.Type, { text: ' my dear' });
					assert.equal(model.getLineContent(1), 'hello my dear');
					assert.deepEqual(editor.getSelection(), new Selection(1, 14, 1, 14));

					joinLinesAction.run(null, editor);
					assert.equal(model.getLineContent(1), 'hello my dear world');
					assert.deepEqual(editor.getSelection(), new Selection(1, 14, 1, 14));

					editor.trigger('keyboard', Handler.Undo, {});
					assert.equal(model.getLineContent(1), 'hello my dear');
					assert.deepEqual(editor.getSelection(), new Selection(1, 14, 1, 14));
				});
		});
	});

	test('transpose', function () {
		withTestCodeEditor(
			[
				'hello world',
				'',
				'',
				'   ',
			], {}, (editor, cursor) => {
				let model = editor.getModel();
				let transposeAction = new TransposeAction();

				editor.setSelection(new Selection(1, 1, 1, 1));
				transposeAction.run(null, editor);
				assert.equal(model.getLineContent(1), 'hello world', '001');
				assert.deepEqual(editor.getSelection().toString(), new Selection(1, 2, 1, 2).toString(), '002');

				editor.setSelection(new Selection(1, 6, 1, 6));
				transposeAction.run(null, editor);
				assert.equal(model.getLineContent(1), 'hell oworld', '003');
				assert.deepEqual(editor.getSelection().toString(), new Selection(1, 7, 1, 7).toString(), '004');

				editor.setSelection(new Selection(1, 12, 1, 12));
				transposeAction.run(null, editor);
				assert.equal(model.getLineContent(1), 'hell oworl', '005');
				assert.deepEqual(editor.getSelection().toString(), new Selection(2, 2, 2, 2).toString(), '006');

				editor.setSelection(new Selection(3, 1, 3, 1));
				transposeAction.run(null, editor);
				assert.equal(model.getLineContent(3), '', '007');
				assert.deepEqual(editor.getSelection().toString(), new Selection(4, 1, 4, 1).toString(), '008');

				editor.setSelection(new Selection(4, 2, 4, 2));
				transposeAction.run(null, editor);
				assert.equal(model.getLineContent(4), '   ', '009');
				assert.deepEqual(editor.getSelection().toString(), new Selection(4, 3, 4, 3).toString(), '010');
			}
		);

		// fix #16633
		withTestCodeEditor(
			[
				'',
				'',
				'hello',
				'world',
				'',
				'hello world',
				'',
				'hello world'
			], {}, (editor, cursor) => {
				let model = editor.getModel();
				let transposeAction = new TransposeAction();

				editor.setSelection(new Selection(1, 1, 1, 1));
				transposeAction.run(null, editor);
				assert.equal(model.getLineContent(2), '', '011');
				assert.deepEqual(editor.getSelection().toString(), new Selection(2, 1, 2, 1).toString(), '012');

				editor.setSelection(new Selection(3, 6, 3, 6));
				transposeAction.run(null, editor);
				assert.equal(model.getLineContent(4), 'oworld', '013');
				assert.deepEqual(editor.getSelection().toString(), new Selection(4, 2, 4, 2).toString(), '014');

				editor.setSelection(new Selection(6, 12, 6, 12));
				transposeAction.run(null, editor);
				assert.equal(model.getLineContent(7), 'd', '015');
				assert.deepEqual(editor.getSelection().toString(), new Selection(7, 2, 7, 2).toString(), '016');

				editor.setSelection(new Selection(8, 12, 8, 12));
				transposeAction.run(null, editor);
				assert.equal(model.getLineContent(8), 'hello world', '019');
				assert.deepEqual(editor.getSelection().toString(), new Selection(8, 12, 8, 12).toString(), '020');
			}
		);
	});

	test('toggle case', function () {
		withTestCodeEditor(
			[
				'hello world',
				'öçşğü'
			], {}, (editor, cursor) => {
				let model = editor.getModel();
				let uppercaseAction = new UpperCaseAction();
				let lowercaseAction = new LowerCaseAction();

				editor.setSelection(new Selection(1, 1, 1, 12));
				uppercaseAction.run(null, editor);
				assert.equal(model.getLineContent(1), 'HELLO WORLD', '001');
				assert.deepEqual(editor.getSelection().toString(), new Selection(1, 1, 1, 12).toString(), '002');

				editor.setSelection(new Selection(1, 1, 1, 12));
				lowercaseAction.run(null, editor);
				assert.equal(model.getLineContent(1), 'hello world', '003');
				assert.deepEqual(editor.getSelection().toString(), new Selection(1, 1, 1, 12).toString(), '004');

				editor.setSelection(new Selection(1, 3, 1, 3));
				uppercaseAction.run(null, editor);
				assert.equal(model.getLineContent(1), 'HELLO world', '005');
				assert.deepEqual(editor.getSelection().toString(), new Selection(1, 3, 1, 3).toString(), '006');

				editor.setSelection(new Selection(1, 4, 1, 4));
				lowercaseAction.run(null, editor);
				assert.equal(model.getLineContent(1), 'hello world', '007');
				assert.deepEqual(editor.getSelection().toString(), new Selection(1, 4, 1, 4).toString(), '008');

				editor.setSelection(new Selection(2, 1, 2, 6));
				uppercaseAction.run(null, editor);
				assert.equal(model.getLineContent(2), 'ÖÇŞĞÜ', '009');
				assert.deepEqual(editor.getSelection().toString(), new Selection(2, 1, 2, 6).toString(), '010');

				editor.setSelection(new Selection(2, 1, 2, 6));
				lowercaseAction.run(null, editor);
				assert.equal(model.getLineContent(2), 'öçşğü', '011');
				assert.deepEqual(editor.getSelection().toString(), new Selection(2, 1, 2, 6).toString(), '012');
			}
		);

		withTestCodeEditor(
			[
				'',
				'   '
			], {}, (editor, cursor) => {
				let model = editor.getModel();
				let uppercaseAction = new UpperCaseAction();
				let lowercaseAction = new LowerCaseAction();

				editor.setSelection(new Selection(1, 1, 1, 1));
				uppercaseAction.run(null, editor);
				assert.equal(model.getLineContent(1), '', '013');
				assert.deepEqual(editor.getSelection().toString(), new Selection(1, 1, 1, 1).toString(), '014');

				editor.setSelection(new Selection(1, 1, 1, 1));
				lowercaseAction.run(null, editor);
				assert.equal(model.getLineContent(1), '', '015');
				assert.deepEqual(editor.getSelection().toString(), new Selection(1, 1, 1, 1).toString(), '016');

				editor.setSelection(new Selection(2, 2, 2, 2));
				uppercaseAction.run(null, editor);
				assert.equal(model.getLineContent(2), '   ', '017');
				assert.deepEqual(editor.getSelection().toString(), new Selection(2, 2, 2, 2).toString(), '018');

				editor.setSelection(new Selection(2, 2, 2, 2));
				lowercaseAction.run(null, editor);
				assert.equal(model.getLineContent(2), '   ', '019');
				assert.deepEqual(editor.getSelection().toString(), new Selection(2, 2, 2, 2).toString(), '020');
			}
		);
	});

	suite('DeleteAllRightAction', () => {
		test('should be noop on empty', () => {
			withTestCodeEditor([''], {}, (editor, cursor) => {
				const model = editor.getModel();
				const action = new DeleteAllRightAction();

				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);

				editor.setSelection(new Selection(1, 1, 1, 1));
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);

				editor.setSelections([new Selection(1, 1, 1, 1), new Selection(1, 1, 1, 1), new Selection(1, 1, 1, 1)]);
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);
			});
		});

		test('should delete selected range', () => {
			withTestCodeEditor([
				'hello',
				'world'
			], {}, (editor, cursor) => {
				const model = editor.getModel();
				const action = new DeleteAllRightAction();

				editor.setSelection(new Selection(1, 2, 1, 5));
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['ho', 'world']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 2, 1, 2)]);

				editor.setSelection(new Selection(1, 1, 2, 4));
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['ld']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);

				editor.setSelection(new Selection(1, 1, 1, 3));
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);
			});
		});

		test('should delete to the right of the cursor', () => {
			withTestCodeEditor([
				'hello',
				'world'
			], {}, (editor, cursor) => {
				const model = editor.getModel();
				const action = new DeleteAllRightAction();

				editor.setSelection(new Selection(1, 3, 1, 3));
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['he', 'world']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 3, 1, 3)]);

				editor.setSelection(new Selection(2, 1, 2, 1));
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['he', '']);
				assert.deepEqual(editor.getSelections(), [new Selection(2, 1, 2, 1)]);
			});
		});

		test('should join two lines, if at the end of the line', () => {
			withTestCodeEditor([
				'hello',
				'world'
			], {}, (editor, cursor) => {
				const model = editor.getModel();
				const action = new DeleteAllRightAction();

				editor.setSelection(new Selection(1, 6, 1, 6));
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['helloworld']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 6, 1, 6)]);

				editor.setSelection(new Selection(1, 6, 1, 6));
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['hello']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 6, 1, 6)]);

				editor.setSelection(new Selection(1, 6, 1, 6));
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['hello']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 6, 1, 6)]);
			});
		});

		test('should work with multiple cursors', () => {
			withTestCodeEditor([
				'hello',
				'there',
				'world'
			], {}, (editor, cursor) => {
				const model = editor.getModel();
				const action = new DeleteAllRightAction();

				editor.setSelections([
					new Selection(1, 3, 1, 3),
					new Selection(1, 6, 1, 6),
					new Selection(3, 4, 3, 4),
				]);
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['hethere', 'wor']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);

				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['he', 'wor']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);

				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['hewor']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(1, 6, 1, 6)
				]);

				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['he']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3)
				]);

				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['he']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3)
				]);
			});
		});

		test('should work with undo/redo', () => {
			withTestCodeEditor([
				'hello',
				'there',
				'world'
			], {}, (editor, cursor) => {
				const model = editor.getModel();
				const action = new DeleteAllRightAction();

				editor.setSelections([
					new Selection(1, 3, 1, 3),
					new Selection(1, 6, 1, 6),
					new Selection(3, 4, 3, 4),
				]);
				action.run(null, editor);
				assert.deepEqual(model.getLinesContent(), ['hethere', 'wor']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);

				editor.trigger('tests', Handler.Undo, {});
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(1, 6, 1, 6),
					new Selection(3, 4, 3, 4)
				]);
				editor.trigger('tests', Handler.Redo, {});
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);
			});
		});
	});

	test('InsertLineBeforeAction', function () {
		function testInsertLineBefore(lineNumber: number, column: number, callback: (model: ITextModel, cursor: Cursor) => void): void {
			const TEXT = [
				'First line',
				'Second line',
				'Third line'
			];
			withTestCodeEditor(TEXT, {}, (editor, cursor) => {
				editor.setPosition(new Position(lineNumber, column));
				let insertLineBeforeAction = new InsertLineBeforeAction();

				insertLineBeforeAction.run(null, editor);
				callback(editor.getModel(), cursor);
			});
		}

		testInsertLineBefore(1, 3, (model, cursor) => {
			assert.deepEqual(cursor.getSelection(), new Selection(1, 1, 1, 1));
			assert.equal(model.getLineContent(1), '');
			assert.equal(model.getLineContent(2), 'First line');
			assert.equal(model.getLineContent(3), 'Second line');
			assert.equal(model.getLineContent(4), 'Third line');
		});

		testInsertLineBefore(2, 3, (model, cursor) => {
			assert.deepEqual(cursor.getSelection(), new Selection(2, 1, 2, 1));
			assert.equal(model.getLineContent(1), 'First line');
			assert.equal(model.getLineContent(2), '');
			assert.equal(model.getLineContent(3), 'Second line');
			assert.equal(model.getLineContent(4), 'Third line');
		});

		testInsertLineBefore(3, 3, (model, cursor) => {
			assert.deepEqual(cursor.getSelection(), new Selection(3, 1, 3, 1));
			assert.equal(model.getLineContent(1), 'First line');
			assert.equal(model.getLineContent(2), 'Second line');
			assert.equal(model.getLineContent(3), '');
			assert.equal(model.getLineContent(4), 'Third line');
		});
	});

	test('InsertLineAfterAction', () => {
		function testInsertLineAfter(lineNumber: number, column: number, callback: (model: ITextModel, cursor: Cursor) => void): void {
			const TEXT = [
				'First line',
				'Second line',
				'Third line'
			];
			withTestCodeEditor(TEXT, {}, (editor, cursor) => {
				editor.setPosition(new Position(lineNumber, column));
				let insertLineAfterAction = new InsertLineAfterAction();

				insertLineAfterAction.run(null, editor);
				callback(editor.getModel(), cursor);
			});
		}

		testInsertLineAfter(1, 3, (model, cursor) => {
			assert.deepEqual(cursor.getSelection(), new Selection(2, 1, 2, 1));
			assert.equal(model.getLineContent(1), 'First line');
			assert.equal(model.getLineContent(2), '');
			assert.equal(model.getLineContent(3), 'Second line');
			assert.equal(model.getLineContent(4), 'Third line');
		});

		testInsertLineAfter(2, 3, (model, cursor) => {
			assert.deepEqual(cursor.getSelection(), new Selection(3, 1, 3, 1));
			assert.equal(model.getLineContent(1), 'First line');
			assert.equal(model.getLineContent(2), 'Second line');
			assert.equal(model.getLineContent(3), '');
			assert.equal(model.getLineContent(4), 'Third line');
		});

		testInsertLineAfter(3, 3, (model, cursor) => {
			assert.deepEqual(cursor.getSelection(), new Selection(4, 1, 4, 1));
			assert.equal(model.getLineContent(1), 'First line');
			assert.equal(model.getLineContent(2), 'Second line');
			assert.equal(model.getLineContent(3), 'Third line');
			assert.equal(model.getLineContent(4), '');
		});
	});

	test('Bug 18276:[editor] Indentation broken when selection is empty', () => {

		let model = createTextModel(
			[
				'function baz() {'
			].join('\n'),
			{
				insertSpaces: false,
			}
		);

		withTestCodeEditor(null, { model: model }, (editor, cursor) => {
			let indentLinesAction = new IndentLinesAction();
			editor.setPosition(new Position(1, 2));

			indentLinesAction.run(null, editor);
			assert.equal(model.getLineContent(1), '\tfunction baz() {');
			assert.deepEqual(editor.getSelection(), new Selection(1, 3, 1, 3));

			CoreEditingCommands.Tab.runEditorCommand(null, editor, null);
			assert.equal(model.getLineContent(1), '\tf\tunction baz() {');
		});

		model.dispose();
	});
});
