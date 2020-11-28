/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { CellKind, NotebookCellMetadata, diff, ICellRange, notebookDocumentMetadataDefaults } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { withTestNotebook, NotebookEditorTestModel, setupInstantiationService } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { TrackedRangeStickiness } from 'vs/editor/common/model';
import { reduceCellRanges } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IModeService } from 'vs/editor/common/services/modeService';

suite('NotebookViewModel', () => {
	const instantiationService = setupInstantiationService();
	const textModelService = instantiationService.get(ITextModelService);
	const blukEditService = instantiationService.get(IBulkEditService);
	const undoRedoService = instantiationService.get(IUndoRedoService);
	const modeService = instantiationService.get(IModeService);

	test('ctor', function () {
		const notebook = new NotebookTextModel('notebook', false, URI.parse('test'), [], [], notebookDocumentMetadataDefaults, { transientMetadata: {}, transientOutputs: false }, undoRedoService, textModelService, modeService);
		const model = new NotebookEditorTestModel(notebook);
		const eventDispatcher = new NotebookEventDispatcher();
		const viewModel = new NotebookViewModel('notebook', model.notebook, eventDispatcher, null, instantiationService, blukEditService, undoRedoService);
		assert.equal(viewModel.viewType, 'notebook');
	});

	test('insert/delete', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], { editable: true }],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel) => {
				assert.equal(viewModel.viewCells[0].metadata?.editable, true);
				assert.equal(viewModel.viewCells[1].metadata?.editable, false);

				const cell = viewModel.createCell(1, 'var c = 3', 'javascript', CellKind.Code, {}, [], true, true, []);
				assert.equal(viewModel.viewCells.length, 3);
				assert.equal(viewModel.notebookDocument.cells.length, 3);
				assert.equal(viewModel.getCellIndex(cell), 1);

				viewModel.deleteCell(1, true);
				assert.equal(viewModel.viewCells.length, 2);
				assert.equal(viewModel.notebookDocument.cells.length, 2);
				assert.equal(viewModel.getCellIndex(cell), -1);
			}
		);
	});

	test('move cells down', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['//a', 'javascript', CellKind.Code, [], { editable: true }],
				['//b', 'javascript', CellKind.Code, [], { editable: true }],
				['//c', 'javascript', CellKind.Code, [], { editable: true }],
			],
			(editor, viewModel) => {
				viewModel.moveCellToIdx(0, 1, 0, true);
				// no-op
				assert.equal(viewModel.viewCells[0].getText(), '//a');
				assert.equal(viewModel.viewCells[1].getText(), '//b');

				viewModel.moveCellToIdx(0, 1, 1, true);
				// b, a, c
				assert.equal(viewModel.viewCells[0].getText(), '//b');
				assert.equal(viewModel.viewCells[1].getText(), '//a');
				assert.equal(viewModel.viewCells[2].getText(), '//c');

				viewModel.moveCellToIdx(0, 1, 2, true);
				// a, c, b
				assert.equal(viewModel.viewCells[0].getText(), '//a');
				assert.equal(viewModel.viewCells[1].getText(), '//c');
				assert.equal(viewModel.viewCells[2].getText(), '//b');
			}
		);
	});

	test('move cells up', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['//a', 'javascript', CellKind.Code, [], { editable: true }],
				['//b', 'javascript', CellKind.Code, [], { editable: true }],
				['//c', 'javascript', CellKind.Code, [], { editable: true }],
			],
			(editor, viewModel) => {
				viewModel.moveCellToIdx(1, 1, 0, true);
				// b, a, c
				assert.equal(viewModel.viewCells[0].getText(), '//b');
				assert.equal(viewModel.viewCells[1].getText(), '//a');

				viewModel.moveCellToIdx(2, 1, 0, true);
				// c, b, a
				assert.equal(viewModel.viewCells[0].getText(), '//c');
				assert.equal(viewModel.viewCells[1].getText(), '//b');
				assert.equal(viewModel.viewCells[2].getText(), '//a');
			}
		);
	});

	test('index', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], { editable: true }],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: true }]
			],
			(editor, viewModel) => {
				const firstViewCell = viewModel.viewCells[0];
				const lastViewCell = viewModel.viewCells[viewModel.viewCells.length - 1];

				const insertIndex = viewModel.getCellIndex(firstViewCell) + 1;
				const cell = viewModel.createCell(insertIndex, 'var c = 3;', 'javascript', CellKind.Code, {}, [], true);

				const addedCellIndex = viewModel.getCellIndex(cell);
				viewModel.deleteCell(addedCellIndex, true);

				const secondInsertIndex = viewModel.getCellIndex(lastViewCell) + 1;
				const cell2 = viewModel.createCell(secondInsertIndex, 'var d = 4;', 'javascript', CellKind.Code, {}, [], true);

				assert.equal(viewModel.viewCells.length, 3);
				assert.equal(viewModel.notebookDocument.cells.length, 3);
				assert.equal(viewModel.getCellIndex(cell2), 2);
			}
		);
	});

	test('metadata', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: true, runnable: true }],
				['var c = 3;', 'javascript', CellKind.Code, [], { editable: true, runnable: false }],
				['var d = 4;', 'javascript', CellKind.Code, [], { editable: false, runnable: true }],
				['var e = 5;', 'javascript', CellKind.Code, [], { editable: false, runnable: false }],
			],
			(editor, viewModel) => {
				viewModel.notebookDocument.metadata = { editable: true, runnable: true, cellRunnable: true, cellEditable: true, cellHasExecutionOrder: true, trusted: true };

				const defaults = { hasExecutionOrder: true };

				assert.deepEqual(viewModel.viewCells[0].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: true,
					runnable: true,
					...defaults
				});

				assert.deepEqual(viewModel.viewCells[1].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: true,
					runnable: true,
					...defaults
				});

				assert.deepEqual(viewModel.viewCells[2].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: true,
					runnable: false,
					...defaults
				});

				assert.deepEqual(viewModel.viewCells[3].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: false,
					runnable: true,
					...defaults
				});

				assert.deepEqual(viewModel.viewCells[4].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: false,
					runnable: false,
					...defaults
				});

				viewModel.notebookDocument.metadata = { editable: true, runnable: true, cellRunnable: false, cellEditable: true, cellHasExecutionOrder: true, trusted: true };

				assert.deepEqual(viewModel.viewCells[0].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: true,
					runnable: false,
					...defaults
				});

				assert.deepEqual(viewModel.viewCells[1].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: true,
					runnable: true,
					...defaults
				});

				assert.deepEqual(viewModel.viewCells[2].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: true,
					runnable: false,
					...defaults
				});

				assert.deepEqual(viewModel.viewCells[3].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: false,
					runnable: true,
					...defaults
				});

				assert.deepEqual(viewModel.viewCells[4].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: false,
					runnable: false,
					...defaults
				});

				viewModel.notebookDocument.metadata = { editable: true, runnable: true, cellRunnable: false, cellEditable: false, cellHasExecutionOrder: true, trusted: true };

				assert.deepEqual(viewModel.viewCells[0].getEvaluatedMetadata(viewModel.metadata), <NotebookCellMetadata>{
					editable: false,
					runnable: false,
					...defaults
				});
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
	const instantiationService = setupInstantiationService();
	const blukEditService = instantiationService.get(IBulkEditService);
	const undoRedoService = instantiationService.get(IUndoRedoService);

	test('tracking range', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: true, runnable: true }],
				['var c = 3;', 'javascript', CellKind.Code, [], { editable: true, runnable: false }],
				['var d = 4;', 'javascript', CellKind.Code, [], { editable: false, runnable: true }],
				['var e = 5;', 'javascript', CellKind.Code, [], { editable: false, runnable: false }],
			],
			(editor, viewModel) => {
				const trackedId = viewModel.setTrackedRange('test', { start: 1, end: 2 }, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter);
				assert.deepEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 2,
				});

				viewModel.createCell(0, 'var d = 6;', 'javascript', CellKind.Code, {}, [], true);
				assert.deepEqual(viewModel.getTrackedRange(trackedId!), {
					start: 2,

					end: 3
				});

				viewModel.deleteCell(0, true);
				assert.deepEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 2
				});

				viewModel.createCell(3, 'var d = 7;', 'javascript', CellKind.Code, {}, [], true);
				assert.deepEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 3
				});

				viewModel.deleteCell(3, true);
				assert.deepEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 2
				});

				viewModel.deleteCell(1, true);
				assert.deepEqual(viewModel.getTrackedRange(trackedId!), {
					start: 0,

					end: 1
				});
			}
		);
	});

	test('tracking range 2', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: true, runnable: true }],
				['var c = 3;', 'javascript', CellKind.Code, [], { editable: true, runnable: false }],
				['var d = 4;', 'javascript', CellKind.Code, [], { editable: false, runnable: true }],
				['var e = 5;', 'javascript', CellKind.Code, [], { editable: false, runnable: false }],
				['var e = 6;', 'javascript', CellKind.Code, [], { editable: false, runnable: false }],
				['var e = 7;', 'javascript', CellKind.Code, [], { editable: false, runnable: false }],
			],
			(editor, viewModel) => {
				const trackedId = viewModel.setTrackedRange('test', { start: 1, end: 3 }, TrackedRangeStickiness.GrowsOnlyWhenTypingAfter);
				assert.deepEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 3
				});

				viewModel.createCell(5, 'var d = 9;', 'javascript', CellKind.Code, {}, [], true);
				assert.deepEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 3
				});

				viewModel.createCell(4, 'var d = 10;', 'javascript', CellKind.Code, {}, [], true);
				assert.deepEqual(viewModel.getTrackedRange(trackedId!), {
					start: 1,

					end: 4
				});
			}
		);
	});

	test('reduce range', function () {
		assert.deepEqual(reduceCellRanges([
			{ start: 0, end: 1 },
			{ start: 1, end: 2 },
			{ start: 4, end: 6 }
		]), [
			{ start: 0, end: 2 },
			{ start: 4, end: 6 }
		]);

		assert.deepEqual(reduceCellRanges([
			{ start: 0, end: 1 },
			{ start: 1, end: 2 },
			{ start: 3, end: 4 }
		]), [
			{ start: 0, end: 4 }
		]);
	});

	test('diff hidden ranges', function () {
		assert.deepEqual(getVisibleCells<number>([1, 2, 3, 4, 5], []), [1, 2, 3, 4, 5]);

		assert.deepEqual(
			getVisibleCells<number>(
				[1, 2, 3, 4, 5],
				[{ start: 1, end: 2 }]
			),
			[1, 4, 5]
		);

		assert.deepEqual(
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

		assert.deepEqual(diff<number>(original, modified, (a) => {
			return original.indexOf(a) >= 0;
		}), [{ start: 1, deleteCount: 1, toInsert: [2, 6] }]);
	});

	test('hidden ranges', function () {

	});
});
