/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { TestInstantiationService } from 'vs/platform/instantiation/test/common/instantiationServiceMock';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { withTestNotebook } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { FoldingModel } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';

function updateFoldingStateAtIndex(foldingModel: FoldingModel, index: number, collapsed: boolean) {
	const range = foldingModel.regions.findRange(index + 1);
	foldingModel.setCollapsed(range, collapsed);
}

suite('Notebook Folding', () => {
	const instantiationService = new TestInstantiationService();
	const blukEditService = instantiationService.get(IBulkEditService);
	const undoRedoService = instantiationService.stub(IUndoRedoService, () => { });
	instantiationService.spy(IUndoRedoService, 'pushElement');

	test('Folding based on markdown cells', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.1'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingController = new FoldingModel();
				foldingController.attachViewModel(viewModel);

				assert.equal(foldingController.regions.findRange(1), 0);
				assert.equal(foldingController.regions.findRange(2), 0);
				assert.equal(foldingController.regions.findRange(3), 1);
				assert.equal(foldingController.regions.findRange(4), 1);
				assert.equal(foldingController.regions.findRange(5), 1);
				assert.equal(foldingController.regions.findRange(6), 2);
				assert.equal(foldingController.regions.findRange(7), 2);
			}
		);
	});

	test('Top level header in a cell wins', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.1\n# header3'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingController = new FoldingModel();
				foldingController.attachViewModel(viewModel);

				assert.equal(foldingController.regions.findRange(1), 0);
				assert.equal(foldingController.regions.findRange(2), 0);
				assert.equal(foldingController.regions.getEndLineNumber(0), 2);

				assert.equal(foldingController.regions.findRange(3), 1);
				assert.equal(foldingController.regions.findRange(4), 1);
				assert.equal(foldingController.regions.findRange(5), 1);
				assert.equal(foldingController.regions.getEndLineNumber(1), 7);

				assert.equal(foldingController.regions.findRange(6), 2);
				assert.equal(foldingController.regions.findRange(7), 2);
				assert.equal(foldingController.regions.getEndLineNumber(2), 7);
			}
		);
	});

	test('Folding', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.1'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				updateFoldingStateAtIndex(foldingModel, 0, true);
				viewModel.updateFoldingRanges(foldingModel.regions);
				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 1, end: 6 }
				]);
			}
		);

		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				updateFoldingStateAtIndex(foldingModel, 2, true);
				viewModel.updateFoldingRanges(foldingModel.regions);

				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 3, end: 4 }
				]);
			}
		);

		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				updateFoldingStateAtIndex(foldingModel, 2, true);
				viewModel.updateFoldingRanges(foldingModel.regions);

				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 3, end: 6 }
				]);
			}
		);
	});

	test('Nested Folding', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				updateFoldingStateAtIndex(foldingModel, 0, true);
				viewModel.updateFoldingRanges(foldingModel.regions);

				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 1, end: 1 }
				]);

				updateFoldingStateAtIndex(foldingModel, 5, true);
				updateFoldingStateAtIndex(foldingModel, 2, true);
				viewModel.updateFoldingRanges(foldingModel.regions);

				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 1, end: 1 },
					{ start: 3, end: 6 }
				]);

				updateFoldingStateAtIndex(foldingModel, 2, false);
				viewModel.updateFoldingRanges(foldingModel.regions);
				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 1, end: 1 },
					{ start: 6, end: 6 }
				]);

				// viewModel.insertCell(7, new TestCell(viewModel.viewType, 7, ['var c = 8;'], 'markdown', CellKind.Code, []), true);

				// assert.deepEqual(viewModel.getHiddenRanges(), [
				// 	{ start: 1, end: 1 },
				// 	{ start: 6, end: 7 }
				// ]);

				// viewModel.insertCell(1, new TestCell(viewModel.viewType, 8, ['var c = 9;'], 'markdown', CellKind.Code, []), true);
				// assert.deepEqual(viewModel.getHiddenRanges(), [
				// 	// the first collapsed range is now expanded as we insert content into it.
				// 	// { start: 1,},
				// 	{ start: 7, end: 8 }
				// ]);
			}
		);
	});

	test('Folding Memento', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				foldingModel.applyMemento([{ start: 2, end: 6 }]);
				viewModel.updateFoldingRanges(foldingModel.regions);

				// Note that hidden ranges !== folding ranges
				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 3, end: 6 }
				]);
			}
		);

		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				foldingModel.applyMemento([
					{ start: 5, end: 6 },
					{ start: 10, end: 11 },
				]);
				viewModel.updateFoldingRanges(foldingModel.regions);

				// Note that hidden ranges !== folding ranges
				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 6, end: 6 },
					{ start: 11, end: 11 }
				]);
			}
		);

		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				foldingModel.applyMemento([
					{ start: 5, end: 6 },
					{ start: 7, end: 11 },
				]);
				viewModel.updateFoldingRanges(foldingModel.regions);

				// Note that hidden ranges !== folding ranges
				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 6, end: 6 },
					{ start: 8, end: 11 }
				]);
			}
		);
	});

	test('View Index', function () {
		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				foldingModel.applyMemento([{ start: 2, end: 6 }]);
				viewModel.updateFoldingRanges(foldingModel.regions);

				// Note that hidden ranges !== folding ranges
				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 3, end: 6 }
				]);

				assert.equal(viewModel.getNextVisibleCellIndex(1), 2);
				assert.equal(viewModel.getNextVisibleCellIndex(2), 7);
				assert.equal(viewModel.getNextVisibleCellIndex(3), 7);
				assert.equal(viewModel.getNextVisibleCellIndex(4), 7);
				assert.equal(viewModel.getNextVisibleCellIndex(5), 7);
				assert.equal(viewModel.getNextVisibleCellIndex(6), 7);
				assert.equal(viewModel.getNextVisibleCellIndex(7), 8);
			}
		);

		withTestNotebook(
			instantiationService,
			blukEditService,
			undoRedoService,
			[
				[['# header 1'], 'markdown', CellKind.Markdown, [], {}],
				[['body'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
				[['# header 2.1\n'], 'markdown', CellKind.Markdown, [], {}],
				[['body 2'], 'markdown', CellKind.Markdown, [], {}],
				[['body 3'], 'markdown', CellKind.Markdown, [], {}],
				[['## header 2.2'], 'markdown', CellKind.Markdown, [], {}],
				[['var e = 7;'], 'markdown', CellKind.Markdown, [], {}],
			],
			(editor, viewModel) => {
				const foldingModel = new FoldingModel();
				foldingModel.attachViewModel(viewModel);
				foldingModel.applyMemento([
					{ start: 5, end: 6 },
					{ start: 10, end: 11 },
				]);

				viewModel.updateFoldingRanges(foldingModel.regions);

				// Note that hidden ranges !== folding ranges
				assert.deepEqual(viewModel.getHiddenRanges(), [
					{ start: 6, end: 6 },
					{ start: 11, end: 11 }
				]);

				// folding ranges
				// [5, 6]
				// [10, 11]
				assert.equal(viewModel.getNextVisibleCellIndex(4), 5);
				assert.equal(viewModel.getNextVisibleCellIndex(5), 7);
				assert.equal(viewModel.getNextVisibleCellIndex(6), 7);

				assert.equal(viewModel.getNextVisibleCellIndex(9), 10);
				assert.equal(viewModel.getNextVisibleCellIndex(10), 12);
				assert.equal(viewModel.getNextVisibleCellIndex(11), 12);
			}
		);
	});
});
