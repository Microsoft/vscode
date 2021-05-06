/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ResourceTextEdit } from 'vs/editor/browser/services/bulkEditService';
import { Range } from 'vs/editor/common/core/range';
import { ResourceNotebookCellEdit } from 'vs/workbench/contrib/bulkEdit/browser/bulkCellEdits';
import { copyCellRange, joinNotebookCells, moveCellRange } from 'vs/workbench/contrib/notebook/browser/contrib/cellOperations/cellOperations';
import { runDeleteAction } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { FoldingModel, updateFoldingStateAtIndex } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { CellEditType, CellKind, SelectionStateType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { withTestNotebook } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';

suite('CellOperations', () => {
	test('Move cells - single cell', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 1, end: 2 }, selections: [{ start: 1, end: 2 }] });
				await moveCellRange({ notebookEditor: editor, cell: viewModel.cellAt(1)! }, 'down');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), 'var b = 1;');
			});
	});

	test('Move cells - multiple cells in a selection', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 1, end: 2 }, selections: [{ start: 0, end: 2 }] });
				await moveCellRange({ notebookEditor: editor, cell: viewModel.cellAt(1)! }, 'down');
				assert.strictEqual(viewModel.cellAt(0)?.getText(), '# header b');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), '# header a');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), 'var b = 1;');
			});
	});

	test('Move cells - move with folding ranges', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				updateFoldingStateAtIndex(foldingModel, 0, true);
				updateFoldingStateAtIndex(foldingModel, 1, true);
				viewModel.updateFoldingRanges(foldingModel.regions);
				editor.setHiddenAreas([{ start: 1, end: 2 }]);
				editor.setHiddenAreas(viewModel.getHiddenRanges());

				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 0, end: 1 }, selections: [{ start: 0, end: 1 }] });
				await moveCellRange({ notebookEditor: editor, cell: viewModel.cellAt(1)! }, 'down');
				assert.strictEqual(viewModel.cellAt(0)?.getText(), '# header b');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), '# header a');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), 'var b = 1;');
			});
	});

	test('Copy/duplicate cells - single cell', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 1, end: 2 }, selections: [{ start: 1, end: 2 }] });
				await copyCellRange({ notebookEditor: editor, cell: viewModel.cellAt(1)! }, 'down');
				assert.strictEqual(viewModel.length, 6);
				assert.strictEqual(viewModel.cellAt(1)?.getText(), 'var b = 1;');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), 'var b = 1;');
			});
	});

	test('Copy/duplicate cells - target and selection are different, #119769', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 0, end: 1 }, selections: [{ start: 0, end: 1 }] });
				await copyCellRange({ notebookEditor: editor, cell: viewModel.cellAt(1)!, ui: true }, 'down');
				assert.strictEqual(viewModel.length, 6);
				assert.strictEqual(viewModel.cellAt(1)?.getText(), 'var b = 1;');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), 'var b = 1;');
			});
	});

	test('Copy/duplicate cells - multiple cells in a selection', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 1, end: 2 }, selections: [{ start: 0, end: 2 }] });
				await copyCellRange({ notebookEditor: editor, cell: viewModel.cellAt(1)! }, 'down');
				assert.strictEqual(viewModel.length, 7);
				assert.strictEqual(viewModel.cellAt(0)?.getText(), '# header a');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), 'var b = 1;');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), '# header a');
				assert.strictEqual(viewModel.cellAt(3)?.getText(), 'var b = 1;');
			});
	});

	test('Copy/duplicate cells - move with folding ranges', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				updateFoldingStateAtIndex(foldingModel, 0, true);
				updateFoldingStateAtIndex(foldingModel, 1, true);
				viewModel.updateFoldingRanges(foldingModel.regions);
				editor.setHiddenAreas([{ start: 1, end: 2 }]);
				editor.setHiddenAreas(viewModel.getHiddenRanges());

				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 0, end: 1 }, selections: [{ start: 0, end: 1 }] });
				await copyCellRange({ notebookEditor: editor, cell: viewModel.cellAt(1)! }, 'down');
				assert.strictEqual(viewModel.length, 7);
				assert.strictEqual(viewModel.cellAt(0)?.getText(), '# header a');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), 'var b = 1;');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), '# header a');
				assert.strictEqual(viewModel.cellAt(3)?.getText(), 'var b = 1;');
			});
	});

	test('Join cell with below - single cell', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor, accessor) => {
				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 3, end: 4 }, selections: [{ start: 3, end: 4 }] });
				const ret = await joinNotebookCells(editor.viewModel, { start: 3, end: 4 }, 'below');
				assert.strictEqual(ret?.edits.length, 2);
				assert.deepStrictEqual(ret?.edits[0], new ResourceTextEdit(viewModel.cellAt(3)!.uri, {
					range: new Range(1, 11, 1, 11), text: viewModel.cellAt(4)!.textBuffer.getEOL() + 'var c = 3;'
				}));
				assert.deepStrictEqual(ret?.edits[1], new ResourceNotebookCellEdit(viewModel.notebookDocument.uri,
					{
						editType: CellEditType.Replace,
						index: 4,
						count: 1,
						cells: []
					}
				));
			});
	});

	test('Join cell with above - single cell', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor, accessor) => {
				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 3, end: 4 }, selections: [{ start: 3, end: 4 }] });
				const ret = await joinNotebookCells(editor.viewModel, { start: 4, end: 5 }, 'above');
				assert.strictEqual(ret?.edits.length, 2);
				assert.deepStrictEqual(ret?.edits[0], new ResourceTextEdit(viewModel.cellAt(3)!.uri, {
					range: new Range(1, 11, 1, 11), text: viewModel.cellAt(4)!.textBuffer.getEOL() + 'var c = 3;'
				}));
				assert.deepStrictEqual(ret?.edits[1], new ResourceNotebookCellEdit(viewModel.notebookDocument.uri,
					{
						editType: CellEditType.Replace,
						index: 4,
						count: 1,
						cells: []
					}
				));
			});
	});

	test('Join cell with below - multiple cells', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor, accessor) => {
				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 1, end: 2 }, selections: [{ start: 0, end: 2 }] });
				const ret = await joinNotebookCells(editor.viewModel, { start: 0, end: 2 }, 'below');
				assert.strictEqual(ret?.edits.length, 2);
				assert.deepStrictEqual(ret?.edits[0], new ResourceTextEdit(viewModel.cellAt(0)!.uri, {
					range: new Range(1, 11, 1, 11), text: viewModel.cellAt(1)!.textBuffer.getEOL() + 'var b = 2;' + viewModel.cellAt(2)!.textBuffer.getEOL() + 'var c = 3;'
				}));
				assert.deepStrictEqual(ret?.edits[1], new ResourceNotebookCellEdit(viewModel.notebookDocument.uri,
					{
						editType: CellEditType.Replace,
						index: 1,
						count: 2,
						cells: []
					}
				));
			});
	});

	test('Join cell with above - multiple cells', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor, accessor) => {
				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 2, end: 3 }, selections: [{ start: 1, end: 3 }] });
				const ret = await joinNotebookCells(editor.viewModel, { start: 1, end: 3 }, 'above');
				assert.strictEqual(ret?.edits.length, 2);
				assert.deepStrictEqual(ret?.edits[0], new ResourceTextEdit(viewModel.cellAt(0)!.uri, {
					range: new Range(1, 11, 1, 11), text: viewModel.cellAt(1)!.textBuffer.getEOL() + 'var b = 2;' + viewModel.cellAt(2)!.textBuffer.getEOL() + 'var c = 3;'
				}));
				assert.deepStrictEqual(ret?.edits[1], new ResourceNotebookCellEdit(viewModel.notebookDocument.uri,
					{
						editType: CellEditType.Replace,
						index: 1,
						count: 2,
						cells: []
					}
				));
			});
	});

	test('Delete focus cell', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.setSelections({ start: 0, end: 1 }, [{ start: 0, end: 1 }]);
				runDeleteAction(viewModel, viewModel.cellAt(0)!);
				assert.strictEqual(viewModel.length, 2);
			});
	});

	test('Delete selected cells', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.setSelections({ start: 0, end: 1 }, [{ start: 0, end: 2 }]);
				runDeleteAction(viewModel, viewModel.cellAt(0)!);
				assert.strictEqual(viewModel.length, 1);
			});
	});

	test('Delete focus cell out of a selection', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}],
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.setSelections({ start: 0, end: 1 }, [{ start: 2, end: 4 }]);
				runDeleteAction(viewModel, viewModel.cellAt(0)!);
				assert.strictEqual(viewModel.length, 3);
			});
	});

	test('Delete UI target', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.setSelections({ start: 0, end: 1 }, [{ start: 0, end: 1 }]);
				runDeleteAction(viewModel, viewModel.cellAt(2)!);
				assert.strictEqual(viewModel.length, 2);
				assert.strictEqual(viewModel.cellAt(0)?.getText(), 'var a = 1;');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), 'var b = 2;');
			});
	});

	test('Delete UI target 2', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}],
				['var e = 5;', 'javascript', CellKind.Code, [], {}],
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.setSelections({ start: 0, end: 1 }, [{ start: 0, end: 1 }, { start: 3, end: 5 }]);
				runDeleteAction(viewModel, viewModel.cellAt(1)!);
				assert.strictEqual(viewModel.length, 4);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 0, end: 1 });
				assert.deepStrictEqual(viewModel.getSelections(), [{ start: 0, end: 1 }, { start: 2, end: 4 }]);
			});
	});

	test('Delete UI target 3', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}],
				['var e = 5;', 'javascript', CellKind.Code, [], {}],
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.setSelections({ start: 0, end: 1 }, [{ start: 2, end: 3 }]);
				runDeleteAction(viewModel, viewModel.cellAt(0)!);
				assert.strictEqual(viewModel.length, 4);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 0, end: 1 });
				assert.deepStrictEqual(viewModel.getSelections(), [{ start: 1, end: 2 }]);
			});
	});

	test('Delete UI target 4', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}],
				['var e = 5;', 'javascript', CellKind.Code, [], {}],
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.setSelections({ start: 2, end: 3 }, [{ start: 3, end: 5 }]);
				runDeleteAction(viewModel, viewModel.cellAt(0)!);
				assert.strictEqual(viewModel.length, 4);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 1, end: 2 });
				assert.deepStrictEqual(viewModel.getSelections(), [{ start: 2, end: 4 }]);
			});
	});


	test('Delete last cell sets selection correctly', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.setSelections({ start: 2, end: 3 }, [{ start: 2, end: 3 }]);
				runDeleteAction(viewModel, viewModel.cellAt(2)!);
				assert.strictEqual(viewModel.length, 2);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 1, end: 2 });
			});
	});

	test('#120187. Delete should work on multiple distinct selection', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}]
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.setSelections({ start: 0, end: 1 }, [{ start: 0, end: 1 }, { start: 3, end: 4 }]);
				runDeleteAction(viewModel, viewModel.cellAt(0)!);
				assert.strictEqual(viewModel.length, 2);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 0, end: 1 });
			});
	});

	test('#120187. Delete should work on multiple distinct selection 2', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}],
				['var e = 5;', 'javascript', CellKind.Code, [], {}],
			],
			async (editor) => {
				const viewModel = editor.viewModel;
				viewModel.setSelections({ start: 1, end: 2 }, [{ start: 1, end: 2 }, { start: 3, end: 5 }]);
				runDeleteAction(viewModel, viewModel.cellAt(1)!);
				assert.strictEqual(viewModel.length, 2);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 1, end: 2 });
			});
	});
});

