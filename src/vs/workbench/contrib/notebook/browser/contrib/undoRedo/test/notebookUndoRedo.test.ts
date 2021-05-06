/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { IModeService } from 'vs/editor/common/services/modeService';
import { CellEditType, CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { TestCell, withTestNotebook } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';

suite('Notebook Undo/Redo', () => {
	test('Basics', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['body', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				const modeService = accessor.get(IModeService);
				const viewModel = editor.viewModel;
				assert.strictEqual(viewModel.length, 2);
				assert.strictEqual(viewModel.getVersionId(), 0);
				assert.strictEqual(viewModel.getAlternativeId(), '0_0,1;1,1');

				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 0, count: 2, cells: []
				}], true, undefined, () => undefined, undefined, true);
				assert.strictEqual(viewModel.length, 0);
				assert.strictEqual(viewModel.getVersionId(), 1);
				assert.strictEqual(viewModel.getAlternativeId(), '1_');

				await viewModel.undo();
				assert.strictEqual(viewModel.length, 2);
				assert.strictEqual(viewModel.getVersionId(), 2);
				assert.strictEqual(viewModel.getAlternativeId(), '0_0,1;1,1');

				await viewModel.redo();
				assert.strictEqual(viewModel.length, 0);
				assert.strictEqual(viewModel.getVersionId(), 3);
				assert.strictEqual(viewModel.getAlternativeId(), '1_');

				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 0, count: 0, cells: [
						new TestCell(viewModel.viewType, 3, '# header 2', 'markdown', CellKind.Code, [], modeService),
					]
				}], true, undefined, () => undefined, undefined, true);
				assert.strictEqual(viewModel.getVersionId(), 4);
				assert.strictEqual(viewModel.getAlternativeId(), '4_2,1');

				await viewModel.undo();
				assert.strictEqual(viewModel.getVersionId(), 5);
				assert.strictEqual(viewModel.getAlternativeId(), '1_');
			}
		);
	});

	test('Invalid replace count should not throw', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['body', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				const modeService = accessor.get(IModeService);
				const viewModel = editor.viewModel;
				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 0, count: 2, cells: []
				}], true, undefined, () => undefined, undefined, true);

				assert.doesNotThrow(() => {
					viewModel.notebookDocument.applyEdits([{
						editType: CellEditType.Replace, index: 0, count: 2, cells: [
							new TestCell(viewModel.viewType, 3, '# header 2', 'markdown', CellKind.Code, [], modeService),
						]
					}], true, undefined, () => undefined, undefined, true);
				});
			}
		);
	});

	test('Replace beyond length', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['body', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 1, count: 2, cells: []
				}], true, undefined, () => undefined, undefined, true);

				assert.deepStrictEqual(viewModel.length, 1);
				await viewModel.undo();
				assert.deepStrictEqual(viewModel.length, 2);
			}
		);
	});

	test('Invalid replace count should not affect undo/redo', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['body', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				const modeService = accessor.get(IModeService);
				const viewModel = editor.viewModel;
				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 0, count: 2, cells: []
				}], true, undefined, () => undefined, undefined, true);

				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 0, count: 2, cells: [
						new TestCell(viewModel.viewType, 3, '# header 2', 'markdown', CellKind.Code, [], modeService),
					]
				}], true, undefined, () => undefined, undefined, true);

				assert.deepStrictEqual(viewModel.length, 1);

				await viewModel.undo();
				await viewModel.undo();

				assert.deepStrictEqual(viewModel.length, 2);
				viewModel.notebookDocument.applyEdits([{
					editType: CellEditType.Replace, index: 1, count: 2, cells: []
				}], true, undefined, () => undefined, undefined, true);
				assert.deepStrictEqual(viewModel.length, 1);
			}
		);
	});
});
