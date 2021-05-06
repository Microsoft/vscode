/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { TrackedRangeStickiness } from 'vs/editor/common/model';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { TestThemeService } from 'vs/platform/theme/test/common/testThemeService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { reduceCellRanges } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellKind, diff, notebookDocumentMetadataDefaults } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ICellRange } from 'vs/workbench/contrib/notebook/common/notebookRange';
import { NotebookEditorTestModel, setupInstantiationService, withTestNotebook } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';

suite('NotebookViewModel', () => {
	const instantiationService = setupInstantiationService();
	const textModelService = instantiationService.get(ITextModelService);
	const bulkEditService = instantiationService.get(IBulkEditService);
	const undoRedoService = instantiationService.get(IUndoRedoService);
	const modelService = instantiationService.get(IModelService);
	const modeService = instantiationService.get(IModeService);

	instantiationService.stub(IConfigurationService, new TestConfigurationService());
	instantiationService.stub(IThemeService, new TestThemeService());

	test('ctor', function () {
		const notebook = new NotebookTextModel('notebook', URI.parse('test'), [], notebookDocumentMetadataDefaults, { transientCellMetadata: {}, transientDocumentMetadata: {}, transientOutputs: false }, undoRedoService, modelService, modeService);
		const model = new NotebookEditorTestModel(notebook);
		const eventDispatcher = new NotebookEventDispatcher();
		const viewModel = new NotebookViewModel('notebook', model.notebook, eventDispatcher, null, instantiationService, bulkEditService, undoRedoService, textModelService);
		assert.strictEqual(viewModel.viewType, 'notebook');
	});

	test('insert/delete', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;

				const cell = viewModel.createCell(1, 'var c = 3', 'javascript', CellKind.Code, {}, [], true, true, null, []);
				assert.strictEqual(viewModel.length, 3);
				assert.strictEqual(viewModel.notebookDocument.cells.length, 3);
				assert.strictEqual(viewModel.getCellIndex(cell), 1);

				viewModel.deleteCell(1, true);
				assert.strictEqual(viewModel.length, 2);
				assert.strictEqual(viewModel.notebookDocument.cells.length, 2);
				assert.strictEqual(viewModel.getCellIndex(cell), -1);
			}
		);
	});

	test('move cells down', async function () {
		await withTestNotebook(
			[
				['//a', 'javascript', CellKind.Code, [], {}],
				['//b', 'javascript', CellKind.Code, [], {}],
				['//c', 'javascript', CellKind.Code, [], {}],
			],
			(editor) => {
				const viewModel = editor.viewModel;
				viewModel.moveCellToIdx(0, 1, 0, true);
				// no-op
				assert.strictEqual(viewModel.cellAt(0)?.getText(), '//a');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), '//b');

				viewModel.moveCellToIdx(0, 1, 1, true);
				// b, a, c
				assert.strictEqual(viewModel.cellAt(0)?.getText(), '//b');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), '//a');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), '//c');

				viewModel.moveCellToIdx(0, 1, 2, true);
				// a, c, b
				assert.strictEqual(viewModel.cellAt(0)?.getText(), '//a');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), '//c');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), '//b');
			}
		);
	});

	test('move cells up', async function () {
		await withTestNotebook(
			[
				['//a', 'javascript', CellKind.Code, [], {}],
				['//b', 'javascript', CellKind.Code, [], {}],
				['//c', 'javascript', CellKind.Code, [], {}],
			],
			(editor) => {
				const viewModel = editor.viewModel;
				viewModel.moveCellToIdx(1, 1, 0, true);
				// b, a, c
				assert.strictEqual(viewModel.cellAt(0)?.getText(), '//b');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), '//a');

				viewModel.moveCellToIdx(2, 1, 0, true);
				// c, b, a
				assert.strictEqual(viewModel.cellAt(0)?.getText(), '//c');
				assert.strictEqual(viewModel.cellAt(1)?.getText(), '//b');
				assert.strictEqual(viewModel.cellAt(2)?.getText(), '//a');
			}
		);
	});

	test('index', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				const firstViewCell = viewModel.cellAt(0)!;
				const lastViewCell = viewModel.cellAt(viewModel.length - 1)!;

				const insertIndex = viewModel.getCellIndex(firstViewCell) + 1;
				const cell = viewModel.createCell(insertIndex, 'var c = 3;', 'javascript', CellKind.Code, {}, [], true);

				const addedCellIndex = viewModel.getCellIndex(cell);
				viewModel.deleteCell(addedCellIndex, true);

				const secondInsertIndex = viewModel.getCellIndex(lastViewCell) + 1;
				const cell2 = viewModel.createCell(secondInsertIndex, 'var d = 4;', 'javascript', CellKind.Code, {}, [], true);

				assert.strictEqual(viewModel.length, 3);
				assert.strictEqual(viewModel.notebookDocument.cells.length, 3);
				assert.strictEqual(viewModel.getCellIndex(cell2), 2);
			}
		);
	});
});

function getVisibleCells<T>(cells: T[], hiddenRanges: ICellRange[]) {
	if (!hiddenRanges.length) {
		return cells;
	}

	let start = 0;
	let hiddenRangeIndex = 0;
	const result: T[] = [];

	while (start < cells.length && hiddenRangeIndex < hiddenRanges.length) {
		if (start < hiddenRanges[hiddenRangeIndex].start) {
			result.push(...cells.slice(start, hiddenRanges[hiddenRangeIndex].start));
		}

		start = hiddenRanges[hiddenRangeIndex].end + 1;
		hiddenRangeIndex++;
	}

	if (start < cells.length) {
		result.push(...cells.slice(start));
	}

	return result;
}

suite('NotebookViewModel Decorations', () => {
	test('tracking range', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}],
				['var e = 5;', 'javascript', CellKind.Code, [], {}],
			],
			(editor) => {
				const viewModel = editor.viewModel;
				const trackedId = viewModel.setTrackedRange('test', { start: 1, end: 2 }, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter);
				assert.deepStrictEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 2,
				});

				viewModel.createCell(0, 'var d = 6;', 'javascript', CellKind.Code, {}, [], true);
				assert.deepStrictEqual(viewModel.getTrackedRange(trackedId!), {
					start: 2,

					end: 3
				});

				viewModel.deleteCell(0, true);
				assert.deepStrictEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 2
				});

				viewModel.createCell(3, 'var d = 7;', 'javascript', CellKind.Code, {}, [], true);
				assert.deepStrictEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 3
				});

				viewModel.deleteCell(3, true);
				assert.deepStrictEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 2
				});

				viewModel.deleteCell(1, true);
				assert.deepStrictEqual(viewModel.getTrackedRange(trackedId!), {
					start: 0,

					end: 1
				});
			}
		);
	});

	test('tracking range 2', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}],
				['var e = 5;', 'javascript', CellKind.Code, [], {}],
				['var e = 6;', 'javascript', CellKind.Code, [], {}],
				['var e = 7;', 'javascript', CellKind.Code, [], {}],
			],
			(editor) => {
				const viewModel = editor.viewModel;
				const trackedId = viewModel.setTrackedRange('test', { start: 1, end: 3 }, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter);
				assert.deepStrictEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 3
				});

				viewModel.createCell(5, 'var d = 9;', 'javascript', CellKind.Code, {}, [], true);
				assert.deepStrictEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 3
				});

				viewModel.createCell(4, 'var d = 10;', 'javascript', CellKind.Code, {}, [], true);
				assert.deepStrictEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 4
				});
			}
		);
	});

	test('reduce range', async function () {
		assert.deepStrictEqual(reduceCellRanges([
			{ start: 0, end: 1 },
			{ start: 1, end: 2 },
			{ start: 4, end: 6 }
		]), [
			{ start: 0, end: 2 },
			{ start: 4, end: 6 }
		]);

		assert.deepStrictEqual(reduceCellRanges([
			{ start: 0, end: 1 },
			{ start: 1, end: 2 },
			{ start: 3, end: 4 }
		]), [
			{ start: 0, end: 4 }
		]);
	});

	test('diff hidden ranges', async function () {
		assert.deepStrictEqual(getVisibleCells<number>([1, 2, 3, 4, 5], []), [1, 2, 3, 4, 5]);

		assert.deepStrictEqual(
			getVisibleCells<number>(
				[1, 2, 3, 4, 5],
				[{ start: 1, end: 2 }]
			),
			[1, 4, 5]
		);

		assert.deepStrictEqual(
			getVisibleCells<number>(
				[1, 2, 3, 4, 5, 6, 7, 8, 9],
				[
					{ start: 1, end: 2 },
					{ start: 4, end: 5 }
				]
			),
			[1, 4, 7, 8, 9]
		);

		const original = getVisibleCells<number>(
			[1, 2, 3, 4, 5, 6, 7, 8, 9],
			[
				{ start: 1, end: 2 },
				{ start: 4, end: 5 }
			]
		);

		const modified = getVisibleCells<number>(
			[1, 2, 3, 4, 5, 6, 7, 8, 9],
			[
				{ start: 2, end: 4 }
			]
		);

		assert.deepStrictEqual(diff<number>(original, modified, (a) => {
			return original.indexOf(a) >= 0;
		}), [{ start: 1, deleteCount: 1, toInsert: [2, 6] }]);
	});

	test('hidden ranges', async function () {

	});
});

suite('NotebookViewModel API', () => {
	test('#115432, get nearest code cell', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}],
				['b = 2;', 'python', CellKind.Code, [], {}],
				['var c = 3', 'javascript', CellKind.Code, [], {}],
				['# header d', 'markdown', CellKind.Markdown, [], {}],
				['var e = 4;', 'TypeScript', CellKind.Code, [], {}],
				['# header f', 'markdown', CellKind.Markdown, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				assert.strictEqual(viewModel.nearestCodeCellIndex(0), 1);
				// find the nearest code cell from above
				assert.strictEqual(viewModel.nearestCodeCellIndex(2), 1);
				assert.strictEqual(viewModel.nearestCodeCellIndex(4), 3);
				assert.strictEqual(viewModel.nearestCodeCellIndex(5), 4);
				assert.strictEqual(viewModel.nearestCodeCellIndex(6), 4);
			}
		);
	});

	test('#108464, get nearest code cell', async function () {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				assert.strictEqual(viewModel.nearestCodeCellIndex(2), 1);
			}
		);
	});

	test('getCells', async () => {
		await withTestNotebook(
			[
				['# header a', 'markdown', CellKind.Markdown, [], {}],
				['var b = 1;', 'javascript', CellKind.Code, [], {}],
				['# header b', 'markdown', CellKind.Markdown, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				assert.strictEqual(viewModel.getCells().length, 3);
				assert.deepStrictEqual(viewModel.getCells({ start: 0, end: 1 }).map(cell => cell.getText()), ['# header a']);
				assert.deepStrictEqual(viewModel.getCells({ start: 0, end: 2 }).map(cell => cell.getText()), ['# header a', 'var b = 1;']);
				assert.deepStrictEqual(viewModel.getCells({ start: 0, end: 3 }).map(cell => cell.getText()), ['# header a', 'var b = 1;', '# header b']);
				assert.deepStrictEqual(viewModel.getCells({ start: 0, end: 4 }).map(cell => cell.getText()), ['# header a', 'var b = 1;', '# header b']);
				assert.deepStrictEqual(viewModel.getCells({ start: 1, end: 4 }).map(cell => cell.getText()), ['var b = 1;', '# header b']);
				assert.deepStrictEqual(viewModel.getCells({ start: 2, end: 4 }).map(cell => cell.getText()), ['# header b']);
				assert.deepStrictEqual(viewModel.getCells({ start: 3, end: 4 }).map(cell => cell.getText()), []);

				// no one should use an invalid range but `getCells` should be able to handle that.
				assert.deepStrictEqual(viewModel.getCells({ start: -1, end: 1 }).map(cell => cell.getText()), ['# header a']);
				assert.deepStrictEqual(viewModel.getCells({ start: 3, end: 0 }).map(cell => cell.getText()), ['# header a', 'var b = 1;', '# header b']);
			}
		);
	});

	test('split cell', async function () {
		await withTestNotebook(
			[
				['var b = 1;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				assert.deepStrictEqual(viewModel.computeCellLinesContents(viewModel.cellAt(0)!, [{ lineNumber: 1, column: 4 }]), [
					'var',
					' b = 1;'
				]);

				assert.deepStrictEqual(viewModel.computeCellLinesContents(viewModel.cellAt(0)!, [{ lineNumber: 1, column: 4 }, { lineNumber: 1, column: 6 }]), [
					'var',
					' b',
					' = 1;'
				]);

				assert.deepStrictEqual(viewModel.computeCellLinesContents(viewModel.cellAt(0)!, [{ lineNumber: 1, column: 1 }]), [
					'',
					'var b = 1;'
				]);

				assert.deepStrictEqual(viewModel.computeCellLinesContents(viewModel.cellAt(0)!, [{ lineNumber: 1, column: 11 }]), [
					'var b = 1;',
					'',
				]);
			}
		);
	});
});
