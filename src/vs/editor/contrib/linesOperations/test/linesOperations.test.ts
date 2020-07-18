/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { CoreEditingCommands } from 'vs/editor/browser/controller/coreCommands';
import { Position } from 'vs/editor/common/core/position';
import { Selection } from 'vs/editor/common/core/selection';
import { Handler } from 'vs/editor/common/editorCommon';
import { ITextModel } from 'vs/editor/common/model';
import { TitleCaseAction, DeleteAllLeftAction, DeleteAllRightAction, IndentLinesAction, InsertLineAfterAction, InsertLineBeforeAction, JoinLinesAction, LowerCaseAction, SortLinesAscendingAction, SortLinesDescendingAction, TransposeAction, UpperCaseAction, DeleteLinesAction } from 'vs/editor/contrib/linesOperations/linesOperations';
import { withTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import type { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction } from 'vs/editor/browser/editorExtensions';
import { ViewModel } from 'vs/editor/common/viewModel/viewModelImpl';

function assertSelection(editor: ICodeEditor, expected: Selection | Selection[]): void {
	if (!Array.isArray(expected)) {
		expected = [expected];
	}
	assert.deepEqual(editor.getSelections(), expected);
}

function executeAction(action: EditorAction, editor: ICodeEditor): void {
	action.run(null!, editor, undefined);
}

suite('Editor Contrib - Line Operations', () => {
	suite('SortLinesAscendingAction', () => {
		test('should sort selected lines in ascending order', function () {
			withTestCodeEditor(
				[
					'omicron',
					'beta',
					'alpha'
				], {}, (editor) => {
					let model = editor.getModel()!;
					let sortLinesAscendingAction = new SortLinesAscendingAction();

					editor.setSelection(new Selection(1, 1, 3, 5));
					executeAction(sortLinesAscendingAction, editor);
					assert.deepEqual(model.getLinesContent(), [
						'alpha',
						'beta',
						'omicron'
					]);
					assertSelection(editor, new Selection(1, 1, 3, 7));
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
				], {}, (editor) => {
					let model = editor.getModel()!;
					let sortLinesAscendingAction = new SortLinesAscendingAction();

					editor.setSelections([new Selection(1, 1, 3, 5), new Selection(5, 1, 7, 5)]);
					executeAction(sortLinesAscendingAction, editor);
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
					editor.getSelections()!.forEach((actualSelection, index) => {
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
				], {}, (editor) => {
					let model = editor.getModel()!;
					let sortLinesDescendingAction = new SortLinesDescendingAction();

					editor.setSelection(new Selection(1, 1, 3, 7));
					executeAction(sortLinesDescendingAction, editor);
					assert.deepEqual(model.getLinesContent(), [
						'omicron',
						'beta',
						'alpha'
					]);
					assertSelection(editor, new Selection(1, 1, 3, 5));
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
				], {}, (editor) => {
					let model = editor.getModel()!;
					let sortLinesDescendingAction = new SortLinesDescendingAction();

					editor.setSelections([new Selection(1, 1, 3, 7), new Selection(5, 1, 7, 7)]);
					executeAction(sortLinesDescendingAction, editor);
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
					editor.getSelections()!.forEach((actualSelection, index) => {
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
				], {}, (editor) => {
					let model = editor.getModel()!;
					let deleteAllLeftAction = new DeleteAllLeftAction();

					editor.setSelection(new Selection(1, 2, 1, 2));
					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLineContent(1), 'ne');

					editor.setSelections([new Selection(2, 2, 2, 2), new Selection(3, 2, 3, 2)]);
					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLineContent(2), 'wo');
					assert.equal(model.getLineContent(3), 'hree');
				});
		});

		test('should jump to the previous line when on first column', function () {
			withTestCodeEditor(
				[
					'one',
					'two',
					'three'
				], {}, (editor) => {
					let model = editor.getModel()!;
					let deleteAllLeftAction = new DeleteAllLeftAction();

					editor.setSelection(new Selection(2, 1, 2, 1));
					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLineContent(1), 'onetwo');

					editor.setSelections([new Selection(1, 1, 1, 1), new Selection(2, 1, 2, 1)]);
					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLinesContent()[0], 'onetwothree');
					assert.equal(model.getLinesContent().length, 1);

					editor.setSelection(new Selection(1, 1, 1, 1));
					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLinesContent()[0], 'onetwothree');
				});
		});

		test('should keep deleting lines in multi cursor mode', function () {
			withTestCodeEditor(
				[
					'hi my name is Carlos Matos',
					'BCC',
					'waso waso waso',
					'my wife doesnt believe in me',
					'nonononono',
					'bitconneeeect'
				], {}, (editor) => {
					let model = editor.getModel()!;
					let deleteAllLeftAction = new DeleteAllLeftAction();

					const beforeSecondWasoSelection = new Selection(3, 5, 3, 5);
					const endOfBCCSelection = new Selection(2, 4, 2, 4);
					const endOfNonono = new Selection(5, 11, 5, 11);

					editor.setSelections([beforeSecondWasoSelection, endOfBCCSelection, endOfNonono]);

					executeAction(deleteAllLeftAction, editor);
					let selections = editor.getSelections()!;

					assert.equal(model.getLineContent(2), '');
					assert.equal(model.getLineContent(3), ' waso waso');
					assert.equal(model.getLineContent(5), '');

					assert.deepEqual([
						selections[0].startLineNumber,
						selections[0].startColumn,
						selections[0].endLineNumber,
						selections[0].endColumn
					], [3, 1, 3, 1]);

					assert.deepEqual([
						selections[1].startLineNumber,
						selections[1].startColumn,
						selections[1].endLineNumber,
						selections[1].endColumn
					], [2, 1, 2, 1]);

					assert.deepEqual([
						selections[2].startLineNumber,
						selections[2].startColumn,
						selections[2].endLineNumber,
						selections[2].endColumn
					], [5, 1, 5, 1]);

					executeAction(deleteAllLeftAction, editor);
					selections = editor.getSelections()!;

					assert.equal(model.getLineContent(1), 'hi my name is Carlos Matos waso waso');
					assert.equal(selections.length, 2);

					assert.deepEqual([
						selections[0].startLineNumber,
						selections[0].startColumn,
						selections[0].endLineNumber,
						selections[0].endColumn
					], [1, 27, 1, 27]);

					assert.deepEqual([
						selections[1].startLineNumber,
						selections[1].startColumn,
						selections[1].endLineNumber,
						selections[1].endColumn
					], [2, 29, 2, 29]);
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
				], {}, (editor) => {
					let model = editor.getModel()!;
					let deleteAllLeftAction = new DeleteAllLeftAction();

					editor.setSelections([new Selection(1, 2, 1, 2), new Selection(1, 4, 1, 4)]);
					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLineContent(1), 'lo');

					editor.setSelections([new Selection(2, 2, 2, 2), new Selection(2, 4, 2, 5)]);
					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLineContent(2), 'd');

					editor.setSelections([new Selection(3, 2, 3, 5), new Selection(3, 7, 3, 7)]);
					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLineContent(3), 'world');

					editor.setSelections([new Selection(4, 3, 4, 3), new Selection(4, 5, 5, 4)]);
					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLineContent(4), 'jour');

					editor.setSelections([new Selection(5, 3, 6, 3), new Selection(6, 5, 7, 5), new Selection(7, 7, 7, 7)]);
					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLineContent(5), 'world');
				});
		});

		test('issue #36234: should push undo stop', () => {
			withTestCodeEditor(
				[
					'one',
					'two',
					'three'
				], {}, (editor) => {
					let model = editor.getModel()!;
					let deleteAllLeftAction = new DeleteAllLeftAction();

					editor.setSelection(new Selection(1, 1, 1, 1));

					editor.trigger('keyboard', Handler.Type, { text: 'Typing some text here on line ' });
					assert.equal(model.getLineContent(1), 'Typing some text here on line one');
					assert.deepEqual(editor.getSelection(), new Selection(1, 31, 1, 31));

					executeAction(deleteAllLeftAction, editor);
					assert.equal(model.getLineContent(1), 'one');
					assert.deepEqual(editor.getSelection(), new Selection(1, 1, 1, 1));

					CoreEditingCommands.Undo.runEditorCommand(null, editor, null);
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
				], {}, (editor) => {
					let model = editor.getModel()!;
					let joinLinesAction = new JoinLinesAction();

					editor.setSelection(new Selection(1, 2, 1, 2));
					executeAction(joinLinesAction, editor);
					assert.equal(model.getLineContent(1), 'hello world');
					assertSelection(editor, new Selection(1, 6, 1, 6));

					editor.setSelection(new Selection(2, 2, 2, 2));
					executeAction(joinLinesAction, editor);
					assert.equal(model.getLineContent(2), 'hello world');
					assertSelection(editor, new Selection(2, 7, 2, 7));

					editor.setSelection(new Selection(3, 2, 3, 2));
					executeAction(joinLinesAction, editor);
					assert.equal(model.getLineContent(3), 'hello world');
					assertSelection(editor, new Selection(3, 7, 3, 7));

					editor.setSelection(new Selection(4, 2, 5, 3));
					executeAction(joinLinesAction, editor);
					assert.equal(model.getLineContent(4), 'hello world');
					assertSelection(editor, new Selection(4, 2, 4, 8));

					editor.setSelection(new Selection(5, 1, 7, 3));
					executeAction(joinLinesAction, editor);
					assert.equal(model.getLineContent(5), 'hello world');
					assertSelection(editor, new Selection(5, 1, 5, 3));
				});
		});

		test('#50471 Join lines at the end of document', function () {
			withTestCodeEditor(
				[
					'hello',
					'world'
				], {}, (editor) => {
					let model = editor.getModel()!;
					let joinLinesAction = new JoinLinesAction();

					editor.setSelection(new Selection(2, 1, 2, 1));
					executeAction(joinLinesAction, editor);
					assert.equal(model.getLineContent(1), 'hello');
					assert.equal(model.getLineContent(2), 'world');
					assertSelection(editor, new Selection(2, 6, 2, 6));
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
				], {}, (editor) => {
					let model = editor.getModel()!;
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

					executeAction(joinLinesAction, editor);
					assert.equal(model.getLinesContent().join('\n'), 'hello world\nhello world\nhello world\nhello world\n\nhello world');
					assertSelection(editor, [
						/** primary cursor */
						new Selection(3, 4, 3, 8),
						new Selection(1, 6, 1, 6),
						new Selection(2, 2, 2, 8),
						new Selection(4, 5, 4, 9),
						new Selection(6, 1, 6, 1)
					]);
				});
		});

		test('should push undo stop', function () {
			withTestCodeEditor(
				[
					'hello',
					'world'
				], {}, (editor) => {
					let model = editor.getModel()!;
					let joinLinesAction = new JoinLinesAction();

					editor.setSelection(new Selection(1, 6, 1, 6));

					editor.trigger('keyboard', Handler.Type, { text: ' my dear' });
					assert.equal(model.getLineContent(1), 'hello my dear');
					assert.deepEqual(editor.getSelection(), new Selection(1, 14, 1, 14));

					executeAction(joinLinesAction, editor);
					assert.equal(model.getLineContent(1), 'hello my dear world');
					assert.deepEqual(editor.getSelection(), new Selection(1, 14, 1, 14));

					CoreEditingCommands.Undo.runEditorCommand(null, editor, null);
					assert.equal(model.getLineContent(1), 'hello my dear');
					assert.deepEqual(editor.getSelection(), new Selection(1, 14, 1, 14));
				});
		});
	});

	test('transpose', () => {
		withTestCodeEditor(
			[
				'hello world',
				'',
				'',
				'   ',
			], {}, (editor) => {
				let model = editor.getModel()!;
				let transposeAction = new TransposeAction();

				editor.setSelection(new Selection(1, 1, 1, 1));
				executeAction(transposeAction, editor);
				assert.equal(model.getLineContent(1), 'hello world');
				assertSelection(editor, new Selection(1, 2, 1, 2));

				editor.setSelection(new Selection(1, 6, 1, 6));
				executeAction(transposeAction, editor);
				assert.equal(model.getLineContent(1), 'hell oworld');
				assertSelection(editor, new Selection(1, 7, 1, 7));

				editor.setSelection(new Selection(1, 12, 1, 12));
				executeAction(transposeAction, editor);
				assert.equal(model.getLineContent(1), 'hell oworl');
				assertSelection(editor, new Selection(2, 2, 2, 2));

				editor.setSelection(new Selection(3, 1, 3, 1));
				executeAction(transposeAction, editor);
				assert.equal(model.getLineContent(3), '');
				assertSelection(editor, new Selection(4, 1, 4, 1));

				editor.setSelection(new Selection(4, 2, 4, 2));
				executeAction(transposeAction, editor);
				assert.equal(model.getLineContent(4), '   ');
				assertSelection(editor, new Selection(4, 3, 4, 3));
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
			], {}, (editor) => {
				let model = editor.getModel()!;
				let transposeAction = new TransposeAction();

				editor.setSelection(new Selection(1, 1, 1, 1));
				executeAction(transposeAction, editor);
				assert.equal(model.getLineContent(2), '');
				assertSelection(editor, new Selection(2, 1, 2, 1));

				editor.setSelection(new Selection(3, 6, 3, 6));
				executeAction(transposeAction, editor);
				assert.equal(model.getLineContent(4), 'oworld');
				assertSelection(editor, new Selection(4, 2, 4, 2));

				editor.setSelection(new Selection(6, 12, 6, 12));
				executeAction(transposeAction, editor);
				assert.equal(model.getLineContent(7), 'd');
				assertSelection(editor, new Selection(7, 2, 7, 2));

				editor.setSelection(new Selection(8, 12, 8, 12));
				executeAction(transposeAction, editor);
				assert.equal(model.getLineContent(8), 'hello world');
				assertSelection(editor, new Selection(8, 12, 8, 12));
			}
		);
	});

	test('toggle case', function () {
		withTestCodeEditor(
			[
				'hello world',
				'öçşğü'
			], {}, (editor) => {
				let model = editor.getModel()!;
				let uppercaseAction = new UpperCaseAction();
				let lowercaseAction = new LowerCaseAction();
				let titlecaseAction = new TitleCaseAction();

				editor.setSelection(new Selection(1, 1, 1, 12));
				executeAction(uppercaseAction, editor);
				assert.equal(model.getLineContent(1), 'HELLO WORLD');
				assertSelection(editor, new Selection(1, 1, 1, 12));

				editor.setSelection(new Selection(1, 1, 1, 12));
				executeAction(lowercaseAction, editor);
				assert.equal(model.getLineContent(1), 'hello world');
				assertSelection(editor, new Selection(1, 1, 1, 12));

				editor.setSelection(new Selection(1, 3, 1, 3));
				executeAction(uppercaseAction, editor);
				assert.equal(model.getLineContent(1), 'HELLO world');
				assertSelection(editor, new Selection(1, 3, 1, 3));

				editor.setSelection(new Selection(1, 4, 1, 4));
				executeAction(lowercaseAction, editor);
				assert.equal(model.getLineContent(1), 'hello world');
				assertSelection(editor, new Selection(1, 4, 1, 4));

				editor.setSelection(new Selection(1, 1, 1, 12));
				executeAction(titlecaseAction, editor);
				assert.equal(model.getLineContent(1), 'Hello World');
				assertSelection(editor, new Selection(1, 1, 1, 12));

				editor.setSelection(new Selection(2, 1, 2, 6));
				executeAction(uppercaseAction, editor);
				assert.equal(model.getLineContent(2), 'ÖÇŞĞÜ');
				assertSelection(editor, new Selection(2, 1, 2, 6));

				editor.setSelection(new Selection(2, 1, 2, 6));
				executeAction(lowercaseAction, editor);
				assert.equal(model.getLineContent(2), 'öçşğü');
				assertSelection(editor, new Selection(2, 1, 2, 6));

				editor.setSelection(new Selection(2, 1, 2, 6));
				executeAction(titlecaseAction, editor);
				assert.equal(model.getLineContent(2), 'Öçşğü');
				assertSelection(editor, new Selection(2, 1, 2, 6));
			}
		);

		withTestCodeEditor(
			[
				'foO baR BaZ',
				'foO\'baR\'BaZ',
				'foO[baR]BaZ',
				'foO`baR~BaZ',
				'foO^baR%BaZ',
				'foO$baR!BaZ'
			], {}, (editor) => {
				let model = editor.getModel()!;
				let titlecaseAction = new TitleCaseAction();

				editor.setSelection(new Selection(1, 1, 1, 12));
				executeAction(titlecaseAction, editor);
				assert.equal(model.getLineContent(1), 'Foo Bar Baz');

				editor.setSelection(new Selection(2, 1, 2, 12));
				executeAction(titlecaseAction, editor);
				assert.equal(model.getLineContent(2), 'Foo\'Bar\'Baz');

				editor.setSelection(new Selection(3, 1, 3, 12));
				executeAction(titlecaseAction, editor);
				assert.equal(model.getLineContent(3), 'Foo[Bar]Baz');

				editor.setSelection(new Selection(4, 1, 4, 12));
				executeAction(titlecaseAction, editor);
				assert.equal(model.getLineContent(4), 'Foo`Bar~Baz');

				editor.setSelection(new Selection(5, 1, 5, 12));
				executeAction(titlecaseAction, editor);
				assert.equal(model.getLineContent(5), 'Foo^Bar%Baz');

				editor.setSelection(new Selection(6, 1, 6, 12));
				executeAction(titlecaseAction, editor);
				assert.equal(model.getLineContent(6), 'Foo$Bar!Baz');
			}
		);

		withTestCodeEditor(
			[
				'',
				'   '
			], {}, (editor) => {
				let model = editor.getModel()!;
				let uppercaseAction = new UpperCaseAction();
				let lowercaseAction = new LowerCaseAction();

				editor.setSelection(new Selection(1, 1, 1, 1));
				executeAction(uppercaseAction, editor);
				assert.equal(model.getLineContent(1), '');
				assertSelection(editor, new Selection(1, 1, 1, 1));

				editor.setSelection(new Selection(1, 1, 1, 1));
				executeAction(lowercaseAction, editor);
				assert.equal(model.getLineContent(1), '');
				assertSelection(editor, new Selection(1, 1, 1, 1));

				editor.setSelection(new Selection(2, 2, 2, 2));
				executeAction(uppercaseAction, editor);
				assert.equal(model.getLineContent(2), '   ');
				assertSelection(editor, new Selection(2, 2, 2, 2));

				editor.setSelection(new Selection(2, 2, 2, 2));
				executeAction(lowercaseAction, editor);
				assert.equal(model.getLineContent(2), '   ');
				assertSelection(editor, new Selection(2, 2, 2, 2));
			}
		);
	});

	suite('DeleteAllRightAction', () => {
		test('should be noop on empty', () => {
			withTestCodeEditor([''], {}, (editor) => {
				const model = editor.getModel()!;
				const action = new DeleteAllRightAction();

				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);

				editor.setSelection(new Selection(1, 1, 1, 1));
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);

				editor.setSelections([new Selection(1, 1, 1, 1), new Selection(1, 1, 1, 1), new Selection(1, 1, 1, 1)]);
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);
			});
		});

		test('should delete selected range', () => {
			withTestCodeEditor([
				'hello',
				'world'
			], {}, (editor) => {
				const model = editor.getModel()!;
				const action = new DeleteAllRightAction();

				editor.setSelection(new Selection(1, 2, 1, 5));
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['ho', 'world']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 2, 1, 2)]);

				editor.setSelection(new Selection(1, 1, 2, 4));
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['ld']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);

				editor.setSelection(new Selection(1, 1, 1, 3));
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);
			});
		});

		test('should delete to the right of the cursor', () => {
			withTestCodeEditor([
				'hello',
				'world'
			], {}, (editor) => {
				const model = editor.getModel()!;
				const action = new DeleteAllRightAction();

				editor.setSelection(new Selection(1, 3, 1, 3));
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['he', 'world']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 3, 1, 3)]);

				editor.setSelection(new Selection(2, 1, 2, 1));
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['he', '']);
				assert.deepEqual(editor.getSelections(), [new Selection(2, 1, 2, 1)]);
			});
		});

		test('should join two lines, if at the end of the line', () => {
			withTestCodeEditor([
				'hello',
				'world'
			], {}, (editor) => {
				const model = editor.getModel()!;
				const action = new DeleteAllRightAction();

				editor.setSelection(new Selection(1, 6, 1, 6));
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['helloworld']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 6, 1, 6)]);

				editor.setSelection(new Selection(1, 6, 1, 6));
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['hello']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 6, 1, 6)]);

				editor.setSelection(new Selection(1, 6, 1, 6));
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['hello']);
				assert.deepEqual(editor.getSelections(), [new Selection(1, 6, 1, 6)]);
			});
		});

		test('should work with multiple cursors', () => {
			withTestCodeEditor([
				'hello',
				'there',
				'world'
			], {}, (editor) => {
				const model = editor.getModel()!;
				const action = new DeleteAllRightAction();

				editor.setSelections([
					new Selection(1, 3, 1, 3),
					new Selection(1, 6, 1, 6),
					new Selection(3, 4, 3, 4),
				]);
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['hethere', 'wor']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);

				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['he', 'wor']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);

				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['hewor']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(1, 6, 1, 6)
				]);

				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['he']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3)
				]);

				executeAction(action, editor);
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
			], {}, (editor) => {
				const model = editor.getModel()!;
				const action = new DeleteAllRightAction();

				editor.setSelections([
					new Selection(1, 3, 1, 3),
					new Selection(1, 6, 1, 6),
					new Selection(3, 4, 3, 4),
				]);
				executeAction(action, editor);
				assert.deepEqual(model.getLinesContent(), ['hethere', 'wor']);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);

				CoreEditingCommands.Undo.runEditorCommand(null, editor, null);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(1, 6, 1, 6),
					new Selection(3, 4, 3, 4)
				]);
				CoreEditingCommands.Redo.runEditorCommand(null, editor, null);
				assert.deepEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);
			});
		});
	});

	test('InsertLineBeforeAction', () => {
		function testInsertLineBefore(lineNumber: number, column: number, callback: (model: ITextModel, viewModel: ViewModel) => void): void {
			const TEXT = [
				'First line',
				'Second line',
				'Third line'
			];
			withTestCodeEditor(TEXT, {}, (editor, viewModel) => {
				editor.setPosition(new Position(lineNumber, column));
				let insertLineBeforeAction = new InsertLineBeforeAction();

				executeAction(insertLineBeforeAction, editor);
				callback(editor.getModel()!, viewModel);
			});
		}

		testInsertLineBefore(1, 3, (model, viewModel) => {
			assert.deepEqual(viewModel.getSelection(), new Selection(1, 1, 1, 1));
			assert.equal(model.getLineContent(1), '');
			assert.equal(model.getLineContent(2), 'First line');
			assert.equal(model.getLineContent(3), 'Second line');
			assert.equal(model.getLineContent(4), 'Third line');
		});

		testInsertLineBefore(2, 3, (model, viewModel) => {
			assert.deepEqual(viewModel.getSelection(), new Selection(2, 1, 2, 1));
			assert.equal(model.getLineContent(1), 'First line');
			assert.equal(model.getLineContent(2), '');
			assert.equal(model.getLineContent(3), 'Second line');
			assert.equal(model.getLineContent(4), 'Third line');
		});

		testInsertLineBefore(3, 3, (model, viewModel) => {
			assert.deepEqual(viewModel.getSelection(), new Selection(3, 1, 3, 1));
			assert.equal(model.getLineContent(1), 'First line');
			assert.equal(model.getLineContent(2), 'Second line');
			assert.equal(model.getLineContent(3), '');
			assert.equal(model.getLineContent(4), 'Third line');
		});
	});

	test('InsertLineAfterAction', () => {
		function testInsertLineAfter(lineNumber: number, column: number, callback: (model: ITextModel, viewModel: ViewModel) => void): void {
			const TEXT = [
				'First line',
				'Second line',
				'Third line'
			];
			withTestCodeEditor(TEXT, {}, (editor, viewModel) => {
				editor.setPosition(new Position(lineNumber, column));
				let insertLineAfterAction = new InsertLineAfterAction();

				executeAction(insertLineAfterAction, editor);
				callback(editor.getModel()!, viewModel);
			});
		}

		testInsertLineAfter(1, 3, (model, viewModel) => {
			assert.deepEqual(viewModel.getSelection(), new Selection(2, 1, 2, 1));
			assert.equal(model.getLineContent(1), 'First line');
			assert.equal(model.getLineContent(2), '');
			assert.equal(model.getLineContent(3), 'Second line');
			assert.equal(model.getLineContent(4), 'Third line');
		});

		testInsertLineAfter(2, 3, (model, viewModel) => {
			assert.deepEqual(viewModel.getSelection(), new Selection(3, 1, 3, 1));
			assert.equal(model.getLineContent(1), 'First line');
			assert.equal(model.getLineContent(2), 'Second line');
			assert.equal(model.getLineContent(3), '');
			assert.equal(model.getLineContent(4), 'Third line');
		});

		testInsertLineAfter(3, 3, (model, viewModel) => {
			assert.deepEqual(viewModel.getSelection(), new Selection(4, 1, 4, 1));
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

		withTestCodeEditor(null, { model: model }, (editor) => {
			let indentLinesAction = new IndentLinesAction();
			editor.setPosition(new Position(1, 2));

			executeAction(indentLinesAction, editor);
			assert.equal(model.getLineContent(1), '\tfunction baz() {');
			assert.deepEqual(editor.getSelection(), new Selection(1, 3, 1, 3));

			CoreEditingCommands.Tab.runEditorCommand(null, editor, null);
			assert.equal(model.getLineContent(1), '\tf\tunction baz() {');
		});

		model.dispose();
	});

	test('issue #80736: Indenting while the cursor is at the start of a line of text causes the added spaces or tab to be selected', () => {
		const model = createTextModel(
			[
				'Some text'
			].join('\n'),
			{
				insertSpaces: false,
			}
		);

		withTestCodeEditor(null, { model: model }, (editor) => {
			const indentLinesAction = new IndentLinesAction();
			editor.setPosition(new Position(1, 1));

			executeAction(indentLinesAction, editor);
			assert.equal(model.getLineContent(1), '\tSome text');
			assert.deepEqual(editor.getSelection(), new Selection(1, 2, 1, 2));
		});

		model.dispose();
	});

	test('Indenting on empty line should move cursor', () => {
		const model = createTextModel(
			[
				''
			].join('\n')
		);

		withTestCodeEditor(null, { model: model, useTabStops: false }, (editor) => {
			const indentLinesAction = new IndentLinesAction();
			editor.setPosition(new Position(1, 1));

			executeAction(indentLinesAction, editor);
			assert.equal(model.getLineContent(1), '    ');
			assert.deepEqual(editor.getSelection(), new Selection(1, 5, 1, 5));
		});

		model.dispose();
	});

	test('issue #62112: Delete line does not work properly when multiple cursors are on line', () => {
		const TEXT = [
			'a',
			'foo boo',
			'too',
			'c',
		];
		withTestCodeEditor(TEXT, {}, (editor) => {
			editor.setSelections([
				new Selection(2, 4, 2, 4),
				new Selection(2, 8, 2, 8),
				new Selection(3, 4, 3, 4),
			]);
			const deleteLinesAction = new DeleteLinesAction();
			executeAction(deleteLinesAction, editor);

			assert.equal(editor.getValue(), 'a\nc');
		});
	});

	function testDeleteLinesCommand(initialText: string[], _initialSelections: Selection | Selection[], resultingText: string[], _resultingSelections: Selection | Selection[]): void {
		const initialSelections = Array.isArray(_initialSelections) ? _initialSelections : [_initialSelections];
		const resultingSelections = Array.isArray(_resultingSelections) ? _resultingSelections : [_resultingSelections];
		withTestCodeEditor(initialText, {}, (editor) => {
			editor.setSelections(initialSelections);
			const deleteLinesAction = new DeleteLinesAction();
			executeAction(deleteLinesAction, editor);

			assert.equal(editor.getValue(), resultingText.join('\n'));
			assert.deepEqual(editor.getSelections(), resultingSelections);
		});
	}

	test('empty selection in middle of lines', function () {
		testDeleteLinesCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 3, 2, 3),
			[
				'first',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 3, 2, 3)
		);
	});

	test('empty selection at top of lines', function () {
		testDeleteLinesCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 5, 1, 5),
			[
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 5, 1, 5)
		);
	});

	test('empty selection at end of lines', function () {
		testDeleteLinesCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(5, 2, 5, 2),
			[
				'first',
				'second line',
				'third line',
				'fourth line'
			],
			new Selection(4, 2, 4, 2)
		);
	});

	test('with selection in middle of lines', function () {
		testDeleteLinesCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(3, 3, 2, 2),
			[
				'first',
				'fourth line',
				'fifth'
			],
			new Selection(2, 2, 2, 2)
		);
	});

	test('with selection at top of lines', function () {
		testDeleteLinesCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 4, 1, 5),
			[
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 5, 1, 5)
		);
	});

	test('with selection at end of lines', function () {
		testDeleteLinesCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(5, 1, 5, 2),
			[
				'first',
				'second line',
				'third line',
				'fourth line'
			],
			new Selection(4, 2, 4, 2)
		);
	});

	test('with full line selection in middle of lines', function () {
		testDeleteLinesCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(4, 1, 2, 1),
			[
				'first',
				'fourth line',
				'fifth'
			],
			new Selection(2, 1, 2, 1)
		);
	});

	test('with full line selection at top of lines', function () {
		testDeleteLinesCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(2, 1, 1, 5),
			[
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(1, 5, 1, 5)
		);
	});

	test('with full line selection at end of lines', function () {
		testDeleteLinesCommand(
			[
				'first',
				'second line',
				'third line',
				'fourth line',
				'fifth'
			],
			new Selection(4, 1, 5, 2),
			[
				'first',
				'second line',
				'third line'
			],
			new Selection(3, 2, 3, 2)
		);
	});

	test('multicursor 1', function () {
		testDeleteLinesCommand(
			[
				'class P {',
				'',
				'    getA() {',
				'        if (true) {',
				'            return "a";',
				'        }',
				'    }',
				'',
				'    getB() {',
				'        if (true) {',
				'            return "b";',
				'        }',
				'    }',
				'',
				'    getC() {',
				'        if (true) {',
				'            return "c";',
				'        }',
				'    }',
				'}',
			],
			[
				new Selection(4, 1, 5, 1),
				new Selection(10, 1, 11, 1),
				new Selection(16, 1, 17, 1),
			],
			[
				'class P {',
				'',
				'    getA() {',
				'            return "a";',
				'        }',
				'    }',
				'',
				'    getB() {',
				'            return "b";',
				'        }',
				'    }',
				'',
				'    getC() {',
				'            return "c";',
				'        }',
				'    }',
				'}',
			],
			[
				new Selection(4, 1, 4, 1),
				new Selection(9, 1, 9, 1),
				new Selection(14, 1, 14, 1),
			]
		);
	});
});
