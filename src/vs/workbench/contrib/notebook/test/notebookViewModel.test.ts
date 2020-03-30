/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { NotebookEditorModel } from 'vs/workbench/services/notebook/browser/notebookEditorInput';
import { NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { CellKind } from 'vs/workbench/services/notebook/common/notebookCommon';
import { withTestNotebook, TestCell } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { NotebookTextModel } from 'vs/workbench/services/notebook/common/model/notebookTextModel';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';

suite('NotebookViewModel', () => {
	const instantiationService = new TestInstantiationService();
	const blukEditService = instantiationService.get(IBulkEditService);
	const undoRedoService = instantiationService.stub(IUndoRedoService, () => { });
	instantiationService.spy(IUndoRedoService, 'pushElement');

	test('ctor', function () {
		const notebook = new NotebookTextModel(0, 'notebook', URI.parse('test'));
		const model = new NotebookEditorModel(notebook);
		const eventDispatcher = new NotebookEventDispatcher();
		const viewModel = new NotebookViewModel('notebook', model, eventDispatcher, null, instantiationService, blukEditService, undoRedoService);
		assert.equal(viewModel.viewType, 'notebook');
	});

	test('insert/delete', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['var a = 1;'], 'javascript', CellKind.Code, [], { editable: true }],
				[['var b = 2;'], 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel) => {
				assert.equal(viewModel.viewCells[0].metadata?.editable, true);
				assert.equal(viewModel.viewCells[1].metadata?.editable, false);

				const cell = viewModel.insertCell(1, new TestCell(viewModel.viewType, 0, ['var c = 3;'], 'javascript', CellKind.Code, []), true);
				assert.equal(viewModel.viewCells.length, 3);
				assert.equal(viewModel.notebookDocument.cells.length, 3);
				assert.equal(viewModel.getViewCellIndex(cell), 1);

				viewModel.deleteCell(1, true);
				assert.equal(viewModel.viewCells.length, 2);
				assert.equal(viewModel.notebookDocument.cells.length, 2);
				assert.equal(viewModel.getViewCellIndex(cell), -1);
			}
		);
	});

	test('index', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['var a = 1;'], 'javascript', CellKind.Code, [], { editable: true }],
				[['var b = 2;'], 'javascript', CellKind.Code, [], { editable: true }]
			],
			(editor, viewModel) => {
				const firstViewCell = viewModel.viewCells[0];
				const lastViewCell = viewModel.viewCells[viewModel.viewCells.length - 1];

				const insertIndex = viewModel.getViewCellIndex(firstViewCell) + 1;
				const cell = viewModel.insertCell(insertIndex, new TestCell(viewModel.viewType, 3, ['var c = 3;'], 'javascript', CellKind.Code, []), true);

				const addedCellIndex = viewModel.getViewCellIndex(cell);
				viewModel.deleteCell(addedCellIndex, true);

				const secondInsertIndex = viewModel.getViewCellIndex(lastViewCell) + 1;
				const cell2 = viewModel.insertCell(secondInsertIndex, new TestCell(viewModel.viewType, 4, ['var d = 4;'], 'javascript', CellKind.Code, []), true);

				assert.equal(viewModel.viewCells.length, 3);
				assert.equal(viewModel.notebookDocument.cells.length, 3);
				assert.equal(viewModel.getViewCellIndex(cell2), 2);
			}
		);
	});

	test('metadata', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['var a = 1;'], 'javascript', CellKind.Code, [], {}],
				[['var b = 2;'], 'javascript', CellKind.Code, [], { editable: true, runnable: true }],
				[['var c = 3;'], 'javascript', CellKind.Code, [], { editable: true, runnable: false }],
				[['var d = 4;'], 'javascript', CellKind.Code, [], { editable: false, runnable: true }],
				[['var e = 5;'], 'javascript', CellKind.Code, [], { editable: false, runnable: false }],
			],
			(editor, viewModel) => {
				viewModel.notebookDocument.metadata = { editable: true, cellRunnable: true, cellEditable: true };

				assert.deepEqual(viewModel.viewCells[0].getEvaluatedMetadata(viewModel.metadata), {
					editable: true,
					runnable: true
				});

				assert.deepEqual(viewModel.viewCells[1].getEvaluatedMetadata(viewModel.metadata), {
					editable: true,
					runnable: true
				});

				assert.deepEqual(viewModel.viewCells[2].getEvaluatedMetadata(viewModel.metadata), {
					editable: true,
					runnable: false
				});

				assert.deepEqual(viewModel.viewCells[3].getEvaluatedMetadata(viewModel.metadata), {
					editable: false,
					runnable: true
				});

				assert.deepEqual(viewModel.viewCells[4].getEvaluatedMetadata(viewModel.metadata), {
					editable: false,
					runnable: false
				});

				viewModel.notebookDocument.metadata = { editable: true, cellRunnable: false, cellEditable: true };

				assert.deepEqual(viewModel.viewCells[0].getEvaluatedMetadata(viewModel.metadata), {
					editable: true,
					runnable: false
				});

				assert.deepEqual(viewModel.viewCells[1].getEvaluatedMetadata(viewModel.metadata), {
					editable: true,
					runnable: true
				});

				assert.deepEqual(viewModel.viewCells[2].getEvaluatedMetadata(viewModel.metadata), {
					editable: true,
					runnable: false
				});

				assert.deepEqual(viewModel.viewCells[3].getEvaluatedMetadata(viewModel.metadata), {
					editable: false,
					runnable: true
				});

				assert.deepEqual(viewModel.viewCells[4].getEvaluatedMetadata(viewModel.metadata), {
					editable: false,
					runnable: false
				});

				viewModel.notebookDocument.metadata = { editable: true, cellRunnable: false, cellEditable: false };

				assert.deepEqual(viewModel.viewCells[0].getEvaluatedMetadata(viewModel.metadata), {
					editable: false,
					runnable: false
				});
			}
		);
	});
});
