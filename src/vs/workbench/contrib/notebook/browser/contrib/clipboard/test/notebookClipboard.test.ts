/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { mock } from 'vs/base/test/common/mock';
import { NotebookClipboardContribution, runCopyCells, runCutCells } from 'vs/workbench/contrib/notebook/browser/contrib/clipboard/notebookClipboard';
import { CellKind, SelectionStateType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { withTestNotebook } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IActiveNotebookEditor, INotebookEditor, NOTEBOOK_EDITOR_ID } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { IVisibleEditorPane } from 'vs/workbench/common/editor';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { FoldingModel, updateFoldingStateAtIndex } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';

suite('Notebook Clipboard', () => {
	const createEditorService = (editor: IActiveNotebookEditor) => {
		const visibleEditorPane = new class extends mock<IVisibleEditorPane>() {
			override getId(): string {
				return NOTEBOOK_EDITOR_ID;
			}
			override getControl(): INotebookEditor {
				return editor;
			}
		};

		const editorService: IEditorService = new class extends mock<IEditorService>() {
			override get activeEditorPane(): IVisibleEditorPane | undefined {
				return visibleEditorPane;
			}
		};

		return editorService;
	};

	test('Cut multiple selected cells', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				accessor.stub(INotebookService, new class extends mock<INotebookService>() { override setToCopy() { } });

				const clipboardContrib = new NotebookClipboardContribution(createEditorService(editor));

				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 0, end: 2 }, selections: [{ start: 0, end: 2 }] }, 'model');
				assert.ok(clipboardContrib.runCutAction(accessor));
				assert.deepStrictEqual(viewModel.getFocus(), { start: 0, end: 1 });
				assert.strictEqual(viewModel.length, 1);
				assert.strictEqual(viewModel.cellAt(0)?.getText(), 'paragraph 2');
			});
	});

	test('Cut should take folding info into account', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3', 'javascript', CellKind.Markdown, [], {}],
				['# header d', 'markdown', CellKind.Markdown, [], {}],
				['var e = 4;', 'javascript', CellKind.Code, [], {}],
			],
			async (editor, accessor) => {
				const viewModel = editor.viewModel;
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);

				updateFoldingStateAtIndex(foldingModel, 0, true);
				updateFoldingStateAtIndex(foldingModel, 2, true);
				viewModel.updateFoldingRanges(foldingModel.regions);
				editor.setHiddenAreas(viewModel.getHiddenRanges());
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 0, end: 1 }, selections: [{ start: 0, end: 1 }] }, 'model');

				accessor.stub(INotebookService, new class extends mock<INotebookService>() { override setToCopy() { } });

				const clipboardContrib = new NotebookClipboardContribution(createEditorService(editor));
				clipboardContrib.runCutAction(accessor);
				assert.strictEqual(viewModel.length, 5);
				await viewModel.undo();
				assert.strictEqual(viewModel.length, 7);
			});
	});

	test('Copy should take folding info into account', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3', 'javascript', CellKind.Markdown, [], {}],
				['# header d', 'markdown', CellKind.Markdown, [], {}],
				['var e = 4;', 'javascript', CellKind.Code, [], {}],
			],
			async (editor, accessor) => {
				const viewModel = editor.viewModel;
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);

				updateFoldingStateAtIndex(foldingModel, 0, true);
				updateFoldingStateAtIndex(foldingModel, 2, true);
				viewModel.updateFoldingRanges(foldingModel.regions);
				editor.setHiddenAreas(viewModel.getHiddenRanges());
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 0, end: 1 }, selections: [{ start: 0, end: 1 }] }, 'model');

				let _cells: NotebookCellTextModel[] = [];
				accessor.stub(INotebookService, new class extends mock<INotebookService>() {
					override setToCopy(cells: NotebookCellTextModel[]) { _cells = cells; }
					override getToCopy() { return { items: _cells, isCopy: true }; }
				});

				const clipboardContrib = new NotebookClipboardContribution(createEditorService(editor));
				clipboardContrib.runCopyAction(accessor);
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 6, end: 7 }, selections: [{ start: 6, end: 7 }] }, 'model');
				clipboardContrib.runPasteAction(accessor);

				assert.strictEqual(viewModel.length, 9);
				assert.strictEqual(viewModel.cellAt(8)?.getText(), 'var b = 1;');
			});
	});

	test('#119773, cut last item should not focus on the top first cell', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				accessor.stub(INotebookService, new class extends mock<INotebookService>() { override setToCopy() { } });
				const clipboardContrib = new NotebookClipboardContribution(createEditorService(editor));

				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 2, end: 3 }, selections: [{ start: 2, end: 3 }] }, 'model');
				assert.ok(clipboardContrib.runCutAction(accessor));
				// it should be the last cell, other than the first one.
				assert.deepStrictEqual(viewModel.getFocus(), { start: 1, end: 2 });
			});
	});

	test('#119771, undo paste should restore selections', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				accessor.stub(INotebookService, new class extends mock<INotebookService>() {
					override setToCopy() { }
					override getToCopy() {
						return {
							items: [
								editor.viewModel.cellAt(0)!.model
							],
							isCopy: true
						};
					}
				});

				const clipboardContrib = new NotebookClipboardContribution(createEditorService(editor));

				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 2, end: 3 }, selections: [{ start: 2, end: 3 }] }, 'model');
				assert.ok(clipboardContrib.runPasteAction(accessor));

				assert.strictEqual(viewModel.length, 4);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 3, end: 4 });
				assert.strictEqual(viewModel.cellAt(3)?.getText(), '# header 1');
				await viewModel.undo();
				assert.strictEqual(viewModel.length, 3);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 2, end: 3 });
			});
	});

	test('copy cell from ui still works if the target cell is not part of a selection', async () => {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				let _toCopy: NotebookCellTextModel[] = [];
				accessor.stub(INotebookService, new class extends mock<INotebookService>() {
					override setToCopy(toCopy: NotebookCellTextModel[]) { _toCopy = toCopy; }
					override getToCopy() {
						return {
							items: _toCopy,
							isCopy: true
						};
					}
				});

				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 0, end: 1 }, selections: [{ start: 0, end: 2 }] }, 'model');
				assert.ok(runCopyCells(accessor, editor, viewModel.cellAt(0)));
				assert.deepStrictEqual(_toCopy, [editor.viewModel.cellAt(0)!.model, editor.viewModel.cellAt(1)!.model]);

				assert.ok(runCopyCells(accessor, editor, viewModel.cellAt(2)));
				assert.deepStrictEqual(_toCopy.length, 1);
				assert.deepStrictEqual(_toCopy, [editor.viewModel.cellAt(2)!.model]);
			});
	});

	test('cut cell from ui still works if the target cell is not part of a selection', async () => {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 3', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				accessor.stub(INotebookService, new class extends mock<INotebookService>() {
					override setToCopy() { }
					override getToCopy() {
						return { items: [], isCopy: true };
					}
				});

				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 0, end: 1 }, selections: [{ start: 0, end: 2 }] }, 'model');
				assert.ok(runCutCells(accessor, editor, viewModel.cellAt(0)));
				assert.strictEqual(viewModel.length, 2);
				await viewModel.undo();
				assert.strictEqual(viewModel.length, 4);

				assert.deepStrictEqual(viewModel.getFocus(), { start: 0, end: 1 });
				assert.deepStrictEqual(viewModel.getSelections(), [{ start: 0, end: 2 }]);
				assert.ok(runCutCells(accessor, editor, viewModel.cellAt(2)));
				assert.strictEqual(viewModel.length, 3);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 0, end: 1 });
				assert.strictEqual(viewModel.cellAt(0)?.getText(), '# header 1');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), 'paragraph 1');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), 'paragraph 3');

				await viewModel.undo();
				assert.strictEqual(viewModel.length, 4);
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 2, end: 3 }, selections: [{ start: 2, end: 4 }] }, 'model');
				assert.deepStrictEqual(viewModel.getFocus(), { start: 2, end: 3 });
				assert.ok(runCutCells(accessor, editor, viewModel.cellAt(0)));
				assert.deepStrictEqual(viewModel.getFocus(), { start: 1, end: 2 });
				assert.deepStrictEqual(viewModel.getSelections(), [{ start: 1, end: 3 }]);
			});
	});

	test('cut focus cell still works if the focus is not part of any selection', async () => {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 3', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				accessor.stub(INotebookService, new class extends mock<INotebookService>() {
					override setToCopy() { }
					override getToCopy() {
						return { items: [], isCopy: true };
					}
				});

				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 0, end: 1 }, selections: [{ start: 2, end: 4 }] }, 'model');
				assert.ok(runCutCells(accessor, editor, undefined));
				assert.strictEqual(viewModel.length, 3);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 0, end: 1 });
				assert.deepStrictEqual(viewModel.getSelections(), [{ start: 1, end: 3 }]);
			});
	});

	test('cut focus cell still works if the focus is not part of any selection 2', async () => {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 3', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				accessor.stub(INotebookService, new class extends mock<INotebookService>() {
					override setToCopy() { }
					override getToCopy() {
						return { items: [], isCopy: true };
					}
				});

				const viewModel = editor.viewModel;
				viewModel.updateSelectionsState({ kind: SelectionStateType.Index, focus: { start: 3, end: 4 }, selections: [{ start: 0, end: 2 }] }, 'model');
				assert.ok(runCutCells(accessor, editor, undefined));
				assert.strictEqual(viewModel.length, 3);
				assert.deepStrictEqual(viewModel.getFocus(), { start: 2, end: 3 });
				assert.deepStrictEqual(viewModel.getSelections(), [{ start: 0, end: 2 }]);
			});
	});
});
