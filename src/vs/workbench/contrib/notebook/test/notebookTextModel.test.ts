/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CellKind, CellEditType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
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
				[['var a = 1;'], 'javascript', CellKind.Code, [], { editable: true }],
				[['var b = 2;'], 'javascript', CellKind.Code, [], { editable: false }],
				[['var c = 3;'], 'javascript', CellKind.Code, [], { editable: false }],
				[['var d = 4;'], 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.$applyEdit(textModel.versionId, [
					{ editType: CellEditType.Insert, index: 1, cells: [new TestCell(viewModel.viewType, 5, ['var e = 5;'], 'javascript', CellKind.Code, [], textModelService)] },
					{ editType: CellEditType.Insert, index: 3, cells: [new TestCell(viewModel.viewType, 6, ['var f = 6;'], 'javascript', CellKind.Code, [], textModelService)] },
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
				[['var a = 1;'], 'javascript', CellKind.Code, [], { editable: true }],
				[['var b = 2;'], 'javascript', CellKind.Code, [], { editable: false }],
				[['var c = 3;'], 'javascript', CellKind.Code, [], { editable: false }],
				[['var d = 4;'], 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.$applyEdit(textModel.versionId, [
					{ editType: CellEditType.Insert, index: 1, cells: [new TestCell(viewModel.viewType, 5, ['var e = 5;'], 'javascript', CellKind.Code, [], textModelService)] },
					{ editType: CellEditType.Insert, index: 1, cells: [new TestCell(viewModel.viewType, 6, ['var f = 6;'], 'javascript', CellKind.Code, [], textModelService)] },
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
				[['var a = 1;'], 'javascript', CellKind.Code, [], { editable: true }],
				[['var b = 2;'], 'javascript', CellKind.Code, [], { editable: false }],
				[['var c = 3;'], 'javascript', CellKind.Code, [], { editable: false }],
				[['var d = 4;'], 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.$applyEdit(textModel.versionId, [
					{ editType: CellEditType.Delete, index: 1, count: 1 },
					{ editType: CellEditType.Delete, index: 3, count: 1 },
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
				[['var a = 1;'], 'javascript', CellKind.Code, [], { editable: true }],
				[['var b = 2;'], 'javascript', CellKind.Code, [], { editable: false }],
				[['var c = 3;'], 'javascript', CellKind.Code, [], { editable: false }],
				[['var d = 4;'], 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.$applyEdit(textModel.versionId, [
					{ editType: CellEditType.Delete, index: 1, count: 1 },
					{ editType: CellEditType.Insert, index: 3, cells: [new TestCell(viewModel.viewType, 5, ['var e = 5;'], 'javascript', CellKind.Code, [], textModelService)] },
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
				[['var a = 1;'], 'javascript', CellKind.Code, [], { editable: true }],
				[['var b = 2;'], 'javascript', CellKind.Code, [], { editable: false }],
				[['var c = 3;'], 'javascript', CellKind.Code, [], { editable: false }],
				[['var d = 4;'], 'javascript', CellKind.Code, [], { editable: false }]
			],
			(editor, viewModel, textModel) => {
				textModel.$applyEdit(textModel.versionId, [
					{ editType: CellEditType.Delete, index: 1, count: 1 },
					{ editType: CellEditType.Insert, index: 1, cells: [new TestCell(viewModel.viewType, 5, ['var e = 5;'], 'javascript', CellKind.Code, [], textModelService)] },
				], true);

				assert.equal(textModel.cells.length, 4);
				assert.equal(textModel.cells[0].getValue(), 'var a = 1;');
				assert.equal(textModel.cells[1].getValue(), 'var e = 5;');
				assert.equal(textModel.cells[2].getValue(), 'var c = 3;');
			}
		);
	});
});

