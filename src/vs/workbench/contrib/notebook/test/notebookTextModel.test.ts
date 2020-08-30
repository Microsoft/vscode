/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CellKind, CellEditType, CellOutputKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { withTestNotebook, TestCell, setupInstantiationService } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { ITextModelService } from 'vs/editor/common/services/resolverService';

suite('NotebookTextModel', () => {
	const instantiationService = setupInstantiationService();
	const textModelService = instantiationService.get(ITextModelService);
	const blukEditService = instantiationService.get(IBulkEditService);
	const undoRedoService = instantiationService.stub(IUndoRedoService, () => { });
	instantiationService.spy(IUndoRedoService, 'pushElement');

	test('insert', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], { editable: true }],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: false }],
				['var c = 3;', 'javascript', CellKind.Code, [], { editable: false }],
				['var d = 4;', 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.applyEdit(textModel.versionId, [
					{ editType: CellEditType.Replace, index: 1, count: 0, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], textModelService)] },
					{ editType: CellEditType.Replace, index: 3, count: 0, cells: [new TestCell(viewModel.viewType, 6, 'var f = 6;', 'javascript', CellKind.Code, [], textModelService)] },
				], true);

				assert.equal(textModel.cells.length, 6);

				assert.equal(textModel.cells[1].getValue(), 'var e = 5;');
				assert.equal(textModel.cells[4].getValue(), 'var f = 6;');
			}
		);
	});

	test('multiple inserts at same position', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], { editable: true }],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: false }],
				['var c = 3;', 'javascript', CellKind.Code, [], { editable: false }],
				['var d = 4;', 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.applyEdit(textModel.versionId, [
					{ editType: CellEditType.Replace, index: 1, count: 0, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], textModelService)] },
					{ editType: CellEditType.Replace, index: 1, count: 0, cells: [new TestCell(viewModel.viewType, 6, 'var f = 6;', 'javascript', CellKind.Code, [], textModelService)] },
				], true);

				assert.equal(textModel.cells.length, 6);

				assert.equal(textModel.cells[1].getValue(), 'var e = 5;');
				assert.equal(textModel.cells[2].getValue(), 'var f = 6;');
			}
		);
	});

	test('delete', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], { editable: true }],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: false }],
				['var c = 3;', 'javascript', CellKind.Code, [], { editable: false }],
				['var d = 4;', 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.applyEdit(textModel.versionId, [
					{ editType: CellEditType.Replace, index: 1, count: 1, cells: [] },
					{ editType: CellEditType.Replace, index: 3, count: 1, cells: [] },
				], true);

				assert.equal(textModel.cells[0].getValue(), 'var a = 1;');
				assert.equal(textModel.cells[1].getValue(), 'var c = 3;');
			}
		);
	});

	test('delete + insert', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], { editable: true }],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: false }],
				['var c = 3;', 'javascript', CellKind.Code, [], { editable: false }],
				['var d = 4;', 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.applyEdit(textModel.versionId, [
					{ editType: CellEditType.Replace, index: 1, count: 1, cells: [] },
					{ editType: CellEditType.Replace, index: 3, count: 0, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], textModelService)] },
				], true);

				assert.equal(textModel.cells.length, 4);

				assert.equal(textModel.cells[0].getValue(), 'var a = 1;');
				assert.equal(textModel.cells[2].getValue(), 'var e = 5;');
			}
		);
	});

	test('delete + insert at same position', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], { editable: true }],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: false }],
				['var c = 3;', 'javascript', CellKind.Code, [], { editable: false }],
				['var d = 4;', 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.applyEdit(textModel.versionId, [
					{ editType: CellEditType.Replace, index: 1, count: 1, cells: [] },
					{ editType: CellEditType.Replace, index: 1, count: 0, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], textModelService)] },
				], true);

				assert.equal(textModel.cells.length, 4);
				assert.equal(textModel.cells[0].getValue(), 'var a = 1;');
				assert.equal(textModel.cells[1].getValue(), 'var e = 5;');
				assert.equal(textModel.cells[2].getValue(), 'var c = 3;');
			}
		);
	});

	test('(replace) delete + insert at same position', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], { editable: true }],
				['var b = 2;', 'javascript', CellKind.Code, [], { editable: false }],
				['var c = 3;', 'javascript', CellKind.Code, [], { editable: false }],
				['var d = 4;', 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.applyEdit(textModel.versionId, [
					{ editType: CellEditType.Replace, index: 1, count: 1, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], textModelService)] },
				], true);

				assert.equal(textModel.cells.length, 4);
				assert.equal(textModel.cells[0].getValue(), 'var a = 1;');
				assert.equal(textModel.cells[1].getValue(), 'var e = 5;');
				assert.equal(textModel.cells[2].getValue(), 'var c = 3;');
			}
		);
	});

	test('output', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], { editable: true }],
			],
			(editor, viewModel, textModel) => {

				// invalid index 1
				assert.throws(() => {
					textModel.applyEdit(textModel.versionId, [{
						index: Number.MAX_VALUE,
						editType: CellEditType.Output,
						outputs: []
					}], true);
				});

				// invalid index 2
				assert.throws(() => {
					textModel.applyEdit(textModel.versionId, [{
						index: -1,
						editType: CellEditType.Output,
						outputs: []
					}], true);
				});

				textModel.applyEdit(textModel.versionId, [{
					index: 0,
					editType: CellEditType.Output,
					outputs: [{
						outputKind: CellOutputKind.Rich,
						outputId: 'someId',
						data: { 'text/markdown': '_Hello_' }
					}]
				}], true);

				assert.equal(textModel.cells.length, 1);
				assert.equal(textModel.cells[0].outputs.length, 1);
				assert.equal(textModel.cells[0].outputs[0].outputKind, CellOutputKind.Rich);
			}
		);
	});

	test('metadata', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				['var a = 1;', 'javascript', CellKind.Code, [], { editable: true }],
			],
			(editor, viewModel, textModel) => {

				// invalid index 1
				assert.throws(() => {
					textModel.applyEdit(textModel.versionId, [{
						index: Number.MAX_VALUE,
						editType: CellEditType.Metadata,
						metadata: { editable: false }
					}], true);
				});

				// invalid index 2
				assert.throws(() => {
					textModel.applyEdit(textModel.versionId, [{
						index: -1,
						editType: CellEditType.Metadata,
						metadata: { editable: false }
					}], true);
				});

				textModel.applyEdit(textModel.versionId, [{
					index: 0,
					editType: CellEditType.Metadata,
					metadata: { editable: false },
				}], true);

				assert.equal(textModel.cells.length, 1);
				assert.equal(textModel.cells[0].metadata?.editable, false);
			}
		);
	});
});
