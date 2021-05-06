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
import { TitleCaseAction, DeleteAllLeftAction, DeleteAllRightAction, IndentLinesAction, InsertLineAfterAction, InsertLineBeforeAction, JoinLinesAction, LowerCaseAction, SortLinesAscendingAction, SortLinesDescendingAction, TransposeAction, UpperCaseAction, DeleteLinesAction, SnakeCaseAction } from 'vs/editor/contrib/linesOperations/linesOperations';
import { withTestCodeEditor } from 'vs/editor/test/browser/testCodeEditor';
import { createTextModel } from 'vs/editor/test/common/editorTestUtils';
import type { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { EditorAction } from 'vs/editor/browser/editorExtensions';
import { ViewModel } from 'vs/editor/common/viewModel/viewModelImpl';

function assertSelection(editor: ICodeEditor, expected: Selection | Selection[]): void {
	if (!Array.isArray(expected)) {
		expected = [expected];
	}
	assert.deepStrictEqual(editor.getSelections(), expected);
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
					assert.deepStrictEqual(model.getLinesContent(), [
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
					assert.deepStrictEqual(model.getLinesContent(), [
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
						assert.deepStrictEqual(actualSelection.toString(), expectedSelections[index].toString());
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
					assert.deepStrictEqual(model.getLinesContent(), [
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
					assert.deepStrictEqual(model.getLinesContent(), [
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
						assert.deepStrictEqual(actualSelection.toString(), expectedSelections[index].toString());
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
					assert.strictEqual(model.getLineContent(1), 'ne');

					editor.setSelections([new Selection(2, 2, 2, 2), new Selection(3, 2, 3, 2)]);
					executeAction(deleteAllLeftAction, editor);
					assert.strictEqual(model.getLineContent(2), 'wo');
					assert.strictEqual(model.getLineContent(3), 'hree');
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
					assert.strictEqual(model.getLineContent(1), 'onetwo');

					editor.setSelections([new Selection(1, 1, 1, 1), new Selection(2, 1, 2, 1)]);
					executeAction(deleteAllLeftAction, editor);
					assert.strictEqual(model.getLinesContent()[0], 'onetwothree');
					assert.strictEqual(model.getLinesContent().length, 1);

					editor.setSelection(new Selection(1, 1, 1, 1));
					executeAction(deleteAllLeftAction, editor);
					assert.strictEqual(model.getLinesContent()[0], 'onetwothree');
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

					assert.strictEqual(model.getLineContent(2), '');
					assert.strictEqual(model.getLineContent(3), ' waso waso');
					assert.strictEqual(model.getLineContent(5), '');

					assert.deepStrictEqual([
						selections[0].startLineNumber,
						selections[0].startColumn,
						selections[0].endLineNumber,
						selections[0].endColumn
					], [3, 1, 3, 1]);

					assert.deepStrictEqual([
						selections[1].startLineNumber,
						selections[1].startColumn,
						selections[1].endLineNumber,
						selections[1].endColumn
					], [2, 1, 2, 1]);

					assert.deepStrictEqual([
						selections[2].startLineNumber,
						selections[2].startColumn,
						selections[2].endLineNumber,
						selections[2].endColumn
					], [5, 1, 5, 1]);

					executeAction(deleteAllLeftAction, editor);
					selections = editor.getSelections()!;

					assert.strictEqual(model.getLineContent(1), 'hi my name is Carlos Matos waso waso');
					assert.strictEqual(selections.length, 2);

					assert.deepStrictEqual([
						selections[0].startLineNumber,
						selections[0].startColumn,
						selections[0].endLineNumber,
						selections[0].endColumn
					], [1, 27, 1, 27]);

					assert.deepStrictEqual([
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
					assert.strictEqual(model.getLineContent(1), 'lo');

					editor.setSelections([new Selection(2, 2, 2, 2), new Selection(2, 4, 2, 5)]);
					executeAction(deleteAllLeftAction, editor);
					assert.strictEqual(model.getLineContent(2), 'd');

					editor.setSelections([new Selection(3, 2, 3, 5), new Selection(3, 7, 3, 7)]);
					executeAction(deleteAllLeftAction, editor);
					assert.strictEqual(model.getLineContent(3), 'world');

					editor.setSelections([new Selection(4, 3, 4, 3), new Selection(4, 5, 5, 4)]);
					executeAction(deleteAllLeftAction, editor);
					assert.strictEqual(model.getLineContent(4), 'jour');

					editor.setSelections([new Selection(5, 3, 6, 3), new Selection(6, 5, 7, 5), new Selection(7, 7, 7, 7)]);
					executeAction(deleteAllLeftAction, editor);
					assert.strictEqual(model.getLineContent(5), 'world');
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
					assert.strictEqual(model.getLineContent(1), 'Typing some text here on line one');
					assert.deepStrictEqual(editor.getSelection(), new Selection(1, 31, 1, 31));

					executeAction(deleteAllLeftAction, editor);
					assert.strictEqual(model.getLineContent(1), 'one');
					assert.deepStrictEqual(editor.getSelection(), new Selection(1, 1, 1, 1));

					CoreEditingCommands.Undo.runEditorCommand(null, editor, null);
					assert.strictEqual(model.getLineContent(1), 'Typing some text here on line one');
					assert.deepStrictEqual(editor.getSelection(), new Selection(1, 31, 1, 31));
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
					assert.strictEqual(model.getLineContent(1), 'hello world');
					assertSelection(editor, new Selection(1, 6, 1, 6));

					editor.setSelection(new Selection(2, 2, 2, 2));
					executeAction(joinLinesAction, editor);
					assert.strictEqual(model.getLineContent(2), 'hello world');
					assertSelection(editor, new Selection(2, 7, 2, 7));

					editor.setSelection(new Selection(3, 2, 3, 2));
					executeAction(joinLinesAction, editor);
					assert.strictEqual(model.getLineContent(3), 'hello world');
					assertSelection(editor, new Selection(3, 7, 3, 7));

					editor.setSelection(new Selection(4, 2, 5, 3));
					executeAction(joinLinesAction, editor);
					assert.strictEqual(model.getLineContent(4), 'hello world');
					assertSelection(editor, new Selection(4, 2, 4, 8));

					editor.setSelection(new Selection(5, 1, 7, 3));
					executeAction(joinLinesAction, editor);
					assert.strictEqual(model.getLineContent(5), 'hello world');
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
					assert.strictEqual(model.getLineContent(1), 'hello');
					assert.strictEqual(model.getLineContent(2), 'world');
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
					assert.strictEqual(model.getLinesContent().join('\n'), 'hello world\nhello world\nhello world\nhello world\n\nhello world');
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
					assert.strictEqual(model.getLineContent(1), 'hello my dear');
					assert.deepStrictEqual(editor.getSelection(), new Selection(1, 14, 1, 14));

					executeAction(joinLinesAction, editor);
					assert.strictEqual(model.getLineContent(1), 'hello my dear world');
					assert.deepStrictEqual(editor.getSelection(), new Selection(1, 14, 1, 14));

					CoreEditingCommands.Undo.runEditorCommand(null, editor, null);
					assert.strictEqual(model.getLineContent(1), 'hello my dear');
					assert.deepStrictEqual(editor.getSelection(), new Selection(1, 14, 1, 14));
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
				assert.strictEqual(model.getLineContent(1), 'hello world');
				assertSelection(editor, new Selection(1, 2, 1, 2));

				editor.setSelection(new Selection(1, 6, 1, 6));
				executeAction(transposeAction, editor);
				assert.strictEqual(model.getLineContent(1), 'hell oworld');
				assertSelection(editor, new Selection(1, 7, 1, 7));

				editor.setSelection(new Selection(1, 12, 1, 12));
				executeAction(transposeAction, editor);
				assert.strictEqual(model.getLineContent(1), 'hell oworl');
				assertSelection(editor, new Selection(2, 2, 2, 2));

				editor.setSelection(new Selection(3, 1, 3, 1));
				executeAction(transposeAction, editor);
				assert.strictEqual(model.getLineContent(3), '');
				assertSelection(editor, new Selection(4, 1, 4, 1));

				editor.setSelection(new Selection(4, 2, 4, 2));
				executeAction(transposeAction, editor);
				assert.strictEqual(model.getLineContent(4), '   ');
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
				assert.strictEqual(model.getLineContent(2), '');
				assertSelection(editor, new Selection(2, 1, 2, 1));

				editor.setSelection(new Selection(3, 6, 3, 6));
				executeAction(transposeAction, editor);
				assert.strictEqual(model.getLineContent(4), 'oworld');
				assertSelection(editor, new Selection(4, 2, 4, 2));

				editor.setSelection(new Selection(6, 12, 6, 12));
				executeAction(transposeAction, editor);
				assert.strictEqual(model.getLineContent(7), 'd');
				assertSelection(editor, new Selection(7, 2, 7, 2));

				editor.setSelection(new Selection(8, 12, 8, 12));
				executeAction(transposeAction, editor);
				assert.strictEqual(model.getLineContent(8), 'hello world');
				assertSelection(editor, new Selection(8, 12, 8, 12));
			}
		);
	});

	test('toggle case', function () {
		withTestCodeEditor(
			[
				'hello world',
				'öçşğü',
				'parseHTMLString',
				'getElementById',
				'insertHTML',
				'PascalCase',
				'CSSSelectorsList',
				'iD',
				'tEST',
				'öçşÖÇŞğüĞÜ',
				'audioConverter.convertM4AToMP3();',
				'snake_case',
				'Capital_Snake_Case',
				`function helloWorld() {
				return someGlobalObject.printHelloWorld("en", "utf-8");
				}
				helloWorld();`.replace(/^\s+/gm, ''),
				`'JavaScript'`,
				'parseHTML4String',
				'_accessor: ServicesAccessor'
			], {}, (editor) => {
				let model = editor.getModel()!;
				let uppercaseAction = new UpperCaseAction();
				let lowercaseAction = new LowerCaseAction();
				let titlecaseAction = new TitleCaseAction();
				let snakecaseAction = new SnakeCaseAction();

				editor.setSelection(new Selection(1, 1, 1, 12));
				executeAction(uppercaseAction, editor);
				assert.strictEqual(model.getLineContent(1), 'HELLO WORLD');
				assertSelection(editor, new Selection(1, 1, 1, 12));

				editor.setSelection(new Selection(1, 1, 1, 12));
				executeAction(lowercaseAction, editor);
				assert.strictEqual(model.getLineContent(1), 'hello world');
				assertSelection(editor, new Selection(1, 1, 1, 12));

				editor.setSelection(new Selection(1, 3, 1, 3));
				executeAction(uppercaseAction, editor);
				assert.strictEqual(model.getLineContent(1), 'HELLO world');
				assertSelection(editor, new Selection(1, 3, 1, 3));

				editor.setSelection(new Selection(1, 4, 1, 4));
				executeAction(lowercaseAction, editor);
				assert.strictEqual(model.getLineContent(1), 'hello world');
				assertSelection(editor, new Selection(1, 4, 1, 4));

				editor.setSelection(new Selection(1, 1, 1, 12));
				executeAction(titlecaseAction, editor);
				assert.strictEqual(model.getLineContent(1), 'Hello World');
				assertSelection(editor, new Selection(1, 1, 1, 12));

				editor.setSelection(new Selection(2, 1, 2, 6));
				executeAction(uppercaseAction, editor);
				assert.strictEqual(model.getLineContent(2), 'ÖÇŞĞÜ');
				assertSelection(editor, new Selection(2, 1, 2, 6));

				editor.setSelection(new Selection(2, 1, 2, 6));
				executeAction(lowercaseAction, editor);
				assert.strictEqual(model.getLineContent(2), 'öçşğü');
				assertSelection(editor, new Selection(2, 1, 2, 6));

				editor.setSelection(new Selection(2, 1, 2, 6));
				executeAction(titlecaseAction, editor);
				assert.strictEqual(model.getLineContent(2), 'Öçşğü');
				assertSelection(editor, new Selection(2, 1, 2, 6));

				editor.setSelection(new Selection(3, 1, 3, 16));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(3), 'parse_html_string');
				assertSelection(editor, new Selection(3, 1, 3, 18));

				editor.setSelection(new Selection(4, 1, 4, 15));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(4), 'get_element_by_id');
				assertSelection(editor, new Selection(4, 1, 4, 18));

				editor.setSelection(new Selection(5, 1, 5, 11));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(5), 'insert_html');
				assertSelection(editor, new Selection(5, 1, 5, 12));

				editor.setSelection(new Selection(6, 1, 6, 11));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(6), 'pascal_case');
				assertSelection(editor, new Selection(6, 1, 6, 12));

				editor.setSelection(new Selection(7, 1, 7, 17));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(7), 'css_selectors_list');
				assertSelection(editor, new Selection(7, 1, 7, 19));

				editor.setSelection(new Selection(8, 1, 8, 3));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(8), 'i_d');
				assertSelection(editor, new Selection(8, 1, 8, 4));

				editor.setSelection(new Selection(9, 1, 9, 5));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(9), 't_est');
				assertSelection(editor, new Selection(9, 1, 9, 6));

				editor.setSelection(new Selection(10, 1, 10, 11));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(10), 'öçş_öç_şğü_ğü');
				assertSelection(editor, new Selection(10, 1, 10, 14));

				editor.setSelection(new Selection(11, 1, 11, 34));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(11), 'audio_converter.convert_m4a_to_mp3();');
				assertSelection(editor, new Selection(11, 1, 11, 38));

				editor.setSelection(new Selection(12, 1, 12, 11));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(12), 'snake_case');
				assertSelection(editor, new Selection(12, 1, 12, 11));

				editor.setSelection(new Selection(13, 1, 13, 19));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(13), 'capital_snake_case');
				assertSelection(editor, new Selection(13, 1, 13, 19));

				editor.setSelection(new Selection(14, 1, 17, 14));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getValueInRange(new Selection(14, 1, 17, 15)), `function hello_world() {
					return some_global_object.print_hello_world("en", "utf-8");
				}
				hello_world();`.replace(/^\s+/gm, ''));
				assertSelection(editor, new Selection(14, 1, 17, 15));

				editor.setSelection(new Selection(18, 1, 18, 13));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(18), `'java_script'`);
				assertSelection(editor, new Selection(18, 1, 18, 14));

				editor.setSelection(new Selection(19, 1, 19, 17));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(19), 'parse_html4_string');
				assertSelection(editor, new Selection(19, 1, 19, 19));

				editor.setSelection(new Selection(20, 1, 20, 28));
				executeAction(snakecaseAction, editor);
				assert.strictEqual(model.getLineContent(20), '_accessor: services_accessor');
				assertSelection(editor, new Selection(20, 1, 20, 29));
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
				assert.strictEqual(model.getLineContent(1), 'Foo Bar Baz');

				editor.setSelection(new Selection(2, 1, 2, 12));
				executeAction(titlecaseAction, editor);
				assert.strictEqual(model.getLineContent(2), 'Foo\'Bar\'Baz');

				editor.setSelection(new Selection(3, 1, 3, 12));
				executeAction(titlecaseAction, editor);
				assert.strictEqual(model.getLineContent(3), 'Foo[Bar]Baz');

				editor.setSelection(new Selection(4, 1, 4, 12));
				executeAction(titlecaseAction, editor);
				assert.strictEqual(model.getLineContent(4), 'Foo`Bar~Baz');

				editor.setSelection(new Selection(5, 1, 5, 12));
				executeAction(titlecaseAction, editor);
				assert.strictEqual(model.getLineContent(5), 'Foo^Bar%Baz');

				editor.setSelection(new Selection(6, 1, 6, 12));
				executeAction(titlecaseAction, editor);
				assert.strictEqual(model.getLineContent(6), 'Foo$Bar!Baz');
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
				assert.strictEqual(model.getLineContent(1), '');
				assertSelection(editor, new Selection(1, 1, 1, 1));

				editor.setSelection(new Selection(1, 1, 1, 1));
				executeAction(lowercaseAction, editor);
				assert.strictEqual(model.getLineContent(1), '');
				assertSelection(editor, new Selection(1, 1, 1, 1));

				editor.setSelection(new Selection(2, 2, 2, 2));
				executeAction(uppercaseAction, editor);
				assert.strictEqual(model.getLineContent(2), '   ');
				assertSelection(editor, new Selection(2, 2, 2, 2));

				editor.setSelection(new Selection(2, 2, 2, 2));
				executeAction(lowercaseAction, editor);
				assert.strictEqual(model.getLineContent(2), '   ');
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
				assert.deepStrictEqual(model.getLinesContent(), ['']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);

				editor.setSelection(new Selection(1, 1, 1, 1));
				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);

				editor.setSelections([new Selection(1, 1, 1, 1), new Selection(1, 1, 1, 1), new Selection(1, 1, 1, 1)]);
				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);
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
				assert.deepStrictEqual(model.getLinesContent(), ['ho', 'world']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(1, 2, 1, 2)]);

				editor.setSelection(new Selection(1, 1, 2, 4));
				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['ld']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);

				editor.setSelection(new Selection(1, 1, 1, 3));
				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(1, 1, 1, 1)]);
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
				assert.deepStrictEqual(model.getLinesContent(), ['he', 'world']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(1, 3, 1, 3)]);

				editor.setSelection(new Selection(2, 1, 2, 1));
				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['he', '']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(2, 1, 2, 1)]);
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
				assert.deepStrictEqual(model.getLinesContent(), ['helloworld']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(1, 6, 1, 6)]);

				editor.setSelection(new Selection(1, 6, 1, 6));
				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['hello']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(1, 6, 1, 6)]);

				editor.setSelection(new Selection(1, 6, 1, 6));
				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['hello']);
				assert.deepStrictEqual(editor.getSelections(), [new Selection(1, 6, 1, 6)]);
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
				assert.deepStrictEqual(model.getLinesContent(), ['hethere', 'wor']);
				assert.deepStrictEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);

				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['he', 'wor']);
				assert.deepStrictEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);

				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['hewor']);
				assert.deepStrictEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(1, 6, 1, 6)
				]);

				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['he']);
				assert.deepStrictEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3)
				]);

				executeAction(action, editor);
				assert.deepStrictEqual(model.getLinesContent(), ['he']);
				assert.deepStrictEqual(editor.getSelections(), [
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
				assert.deepStrictEqual(model.getLinesContent(), ['hethere', 'wor']);
				assert.deepStrictEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(2, 4, 2, 4)
				]);

				CoreEditingCommands.Undo.runEditorCommand(null, editor, null);
				assert.deepStrictEqual(editor.getSelections(), [
					new Selection(1, 3, 1, 3),
					new Selection(1, 6, 1, 6),
					new Selection(3, 4, 3, 4)
				]);
				CoreEditingCommands.Redo.runEditorCommand(null, editor, null);
				assert.deepStrictEqual(editor.getSelections(), [
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
			assert.deepStrictEqual(viewModel.getSelection(), new Selection(1, 1, 1, 1));
			assert.strictEqual(model.getLineContent(1), '');
			assert.strictEqual(model.getLineContent(2), 'First line');
			assert.strictEqual(model.getLineContent(3), 'Second line');
			assert.strictEqual(model.getLineContent(4), 'Third line');
		});

		testInsertLineBefore(2, 3, (model, viewModel) => {
			assert.deepStrictEqual(viewModel.getSelection(), new Selection(2, 1, 2, 1));
			assert.strictEqual(model.getLineContent(1), 'First line');
			assert.strictEqual(model.getLineContent(2), '');
			assert.strictEqual(model.getLineContent(3), 'Second line');
			assert.strictEqual(model.getLineContent(4), 'Third line');
		});

		testInsertLineBefore(3, 3, (model, viewModel) => {
			assert.deepStrictEqual(viewModel.getSelection(), new Selection(3, 1, 3, 1));
			assert.strictEqual(model.getLineContent(1), 'First line');
			assert.strictEqual(model.getLineContent(2), 'Second line');
			assert.strictEqual(model.getLineContent(3), '');
			assert.strictEqual(model.getLineContent(4), 'Third line');
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
			assert.deepStrictEqual(viewModel.getSelection(), new Selection(2, 1, 2, 1));
			assert.strictEqual(model.getLineContent(1), 'First line');
			assert.strictEqual(model.getLineContent(2), '');
			assert.strictEqual(model.getLineContent(3), 'Second line');
			assert.strictEqual(model.getLineContent(4), 'Third line');
		});

		testInsertLineAfter(2, 3, (model, viewModel) => {
			assert.deepStrictEqual(viewModel.getSelection(), new Selection(3, 1, 3, 1));
			assert.strictEqual(model.getLineContent(1), 'First line');
			assert.strictEqual(model.getLineContent(2), 'Second line');
			assert.strictEqual(model.getLineContent(3), '');
			assert.strictEqual(model.getLineContent(4), 'Third line');
		});

		testInsertLineAfter(3, 3, (model, viewModel) => {
			assert.deepStrictEqual(viewModel.getSelection(), new Selection(4, 1, 4, 1));
			assert.strictEqual(model.getLineContent(1), 'First line');
			assert.strictEqual(model.getLineContent(2), 'Second line');
			assert.strictEqual(model.getLineContent(3), 'Third line');
			assert.strictEqual(model.getLineContent(4), '');
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
			assert.strictEqual(model.getLineContent(1), '\tfunction baz() {');
			assert.deepStrictEqual(editor.getSelection(), new Selection(1, 3, 1, 3));

			CoreEditingCommands.Tab.runEditorCommand(null, editor, null);
			assert.strictEqual(model.getLineContent(1), '\tf\tunction baz() {');
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
			assert.strictEqual(model.getLineContent(1), '\tSome text');
			assert.deepStrictEqual(editor.getSelection(), new Selection(1, 2, 1, 2));
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
			assert.strictEqual(model.getLineContent(1), '    ');
			assert.deepStrictEqual(editor.getSelection(), new Selection(1, 5, 1, 5));
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

			assert.strictEqual(editor.getValue(), 'a\nc');
		});
	});

	function testDeleteLinesCommand(initialText: string[], _initialSelections: Selection | Selection[], resultingText: string[], _resultingSelections: Selection | Selection[]): void {
		const initialSelections = Array.isArray(_initialSelections) ? _initialSelections : [_initialSelections];
		const resultingSelections = Array.isArray(_resultingSelections) ? _resultingSelections : [_resultingSelections];
		withTestCodeEditor(initialText, {}, (editor) => {
			editor.setSelections(initialSelections);
			const deleteLinesAction = new DeleteLinesAction();
			executeAction(deleteLinesAction, editor);

			assert.strictEqual(editor.getValue(), resultingText.join('\n'));
			assert.deepStrictEqual(editor.getSelections(), resultingSelections);
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
