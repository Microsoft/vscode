/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { CellKind, CellEditType, NotebookTextModelChangedEvent, SelectionStateType, ICellEditOperation } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { withTestNotebook, TestCell, setupInstantiationService } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { IModeService } from 'vs/editor/common/services/modeService';

suite('NotebookTextModel', () => {
	const instantiationService = setupInstantiationService();
	const modeService = instantiationService.get(IModeService);
	instantiationService.spy(IUndoRedoService, 'pushElement');

	test('insert', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				const textModel = editor.viewModel.notebookDocument;
				textModel.applyEdits([
					{ editType: CellEditType.Replace, index: 1, count: 0, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], modeService)] },
					{ editType: CellEditType.Replace, index: 3, count: 0, cells: [new TestCell(viewModel.viewType, 6, 'var f = 6;', 'javascript', CellKind.Code, [], modeService)] },
				], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells.length, 6);

				assert.strictEqual(textModel.cells[1].getValue(), 'var e = 5;');
				assert.strictEqual(textModel.cells[4].getValue(), 'var f = 6;');
			}
		);
	});

	test('multiple inserts at same position', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				const textModel = editor.viewModel.notebookDocument;
				textModel.applyEdits([
					{ editType: CellEditType.Replace, index: 1, count: 0, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], modeService)] },
					{ editType: CellEditType.Replace, index: 1, count: 0, cells: [new TestCell(viewModel.viewType, 6, 'var f = 6;', 'javascript', CellKind.Code, [], modeService)] },
				], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells.length, 6);

				assert.strictEqual(textModel.cells[1].getValue(), 'var e = 5;');
				assert.strictEqual(textModel.cells[2].getValue(), 'var f = 6;');
			}
		);
	});

	test('delete', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const textModel = editor.viewModel.notebookDocument;
				textModel.applyEdits([
					{ editType: CellEditType.Replace, index: 1, count: 1, cells: [] },
					{ editType: CellEditType.Replace, index: 3, count: 1, cells: [] },
				], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells[0].getValue(), 'var a = 1;');
				assert.strictEqual(textModel.cells[1].getValue(), 'var c = 3;');
			}
		);
	});

	test('delete + insert', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				const textModel = editor.viewModel.notebookDocument;
				textModel.applyEdits([
					{ editType: CellEditType.Replace, index: 1, count: 1, cells: [] },
					{ editType: CellEditType.Replace, index: 3, count: 0, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], modeService)] },
				], true, undefined, () => undefined, undefined);
				assert.strictEqual(textModel.cells.length, 4);

				assert.strictEqual(textModel.cells[0].getValue(), 'var a = 1;');
				assert.strictEqual(textModel.cells[2].getValue(), 'var e = 5;');
			}
		);
	});

	test('delete + insert at same position', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				const textModel = editor.viewModel.notebookDocument;
				textModel.applyEdits([
					{ editType: CellEditType.Replace, index: 1, count: 1, cells: [] },
					{ editType: CellEditType.Replace, index: 1, count: 0, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], modeService)] },
				], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells.length, 4);
				assert.strictEqual(textModel.cells[0].getValue(), 'var a = 1;');
				assert.strictEqual(textModel.cells[1].getValue(), 'var e = 5;');
				assert.strictEqual(textModel.cells[2].getValue(), 'var c = 3;');
			}
		);
	});

	test('(replace) delete + insert at same position', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				const textModel = editor.viewModel.notebookDocument;
				textModel.applyEdits([
					{ editType: CellEditType.Replace, index: 1, count: 1, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], modeService)] },
				], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells.length, 4);
				assert.strictEqual(textModel.cells[0].getValue(), 'var a = 1;');
				assert.strictEqual(textModel.cells[1].getValue(), 'var e = 5;');
				assert.strictEqual(textModel.cells[2].getValue(), 'var c = 3;');
			}
		);
	});

	test('output', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
			],
			(editor) => {
				const textModel = editor.viewModel.notebookDocument;

				// invalid index 1
				assert.throws(() => {
					textModel.applyEdits([{
						index: Number.MAX_VALUE,
						editType: CellEditType.Output,
						outputs: []
					}], true, undefined, () => undefined, undefined);
				});

				// invalid index 2
				assert.throws(() => {
					textModel.applyEdits([{
						index: -1,
						editType: CellEditType.Output,
						outputs: []
					}], true, undefined, () => undefined, undefined);
				});

				textModel.applyEdits([{
					index: 0,
					editType: CellEditType.Output,
					outputs: [{
						outputId: 'someId',
						outputs: [{ mime: 'text/markdown', value: '_Hello_' }]
					}]
				}], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells.length, 1);
				assert.strictEqual(textModel.cells[0].outputs.length, 1);

				// append
				textModel.applyEdits([{
					index: 0,
					editType: CellEditType.Output,
					append: true,
					outputs: [{
						outputId: 'someId2',
						outputs: [{ mime: 'text/markdown', value: '_Hello2_' }]
					}]
				}], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells.length, 1);
				assert.strictEqual(textModel.cells[0].outputs.length, 2);
				let [first, second] = textModel.cells[0].outputs;
				assert.strictEqual(first.outputId, 'someId');
				assert.strictEqual(second.outputId, 'someId2');

				// replace all
				textModel.applyEdits([{
					index: 0,
					editType: CellEditType.Output,
					outputs: [{
						outputId: 'someId3',
						outputs: [{ mime: 'text/plain', value: 'Last, replaced output' }]
					}]
				}], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells.length, 1);
				assert.strictEqual(textModel.cells[0].outputs.length, 1);
				[first] = textModel.cells[0].outputs;
				assert.strictEqual(first.outputId, 'someId3');
			}
		);
	});

	test('multiple append output in one position', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
			],
			(editor) => {
				const textModel = editor.viewModel.notebookDocument;

				// append
				textModel.applyEdits([
					{
						index: 0,
						editType: CellEditType.Output,
						append: true,
						outputs: [{
							outputId: 'append1',
							outputs: [{ mime: 'text/markdown', value: 'append 1' }]
						}]
					},
					{
						index: 0,
						editType: CellEditType.Output,
						append: true,
						outputs: [{
							outputId: 'append2',
							outputs: [{ mime: 'text/markdown', value: 'append 2' }]
						}]
					}
				], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells.length, 1);
				assert.strictEqual(textModel.cells[0].outputs.length, 2);
				const [first, second] = textModel.cells[0].outputs;
				assert.strictEqual(first.outputId, 'append1');
				assert.strictEqual(second.outputId, 'append2');
			}
		);
	});

	test('metadata', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
			],
			(editor) => {
				const textModel = editor.viewModel.notebookDocument;

				// invalid index 1
				assert.throws(() => {
					textModel.applyEdits([{
						index: Number.MAX_VALUE,
						editType: CellEditType.Metadata,
						metadata: {}
					}], true, undefined, () => undefined, undefined);
				});

				// invalid index 2
				assert.throws(() => {
					textModel.applyEdits([{
						index: -1,
						editType: CellEditType.Metadata,
						metadata: {}
					}], true, undefined, () => undefined, undefined);
				});

				textModel.applyEdits([{
					index: 0,
					editType: CellEditType.Metadata,
					metadata: { executionOrder: 15 },
				}], true, undefined, () => undefined, undefined);

				textModel.applyEdits([{
					index: 0,
					editType: CellEditType.Metadata,
					metadata: {},
				}], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells.length, 1);
				assert.strictEqual(textModel.cells[0].metadata?.executionOrder, undefined);
			}
		);
	});

	test('partial metadata', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
			],
			(editor) => {
				const textModel = editor.viewModel.notebookDocument;

				textModel.applyEdits([{
					index: 0,
					editType: CellEditType.PartialMetadata,
					metadata: { executionOrder: 15 },
				}], true, undefined, () => undefined, undefined);

				textModel.applyEdits([{
					index: 0,
					editType: CellEditType.PartialMetadata,
					metadata: {},
				}], true, undefined, () => undefined, undefined);

				assert.strictEqual(textModel.cells.length, 1);
				assert.strictEqual(textModel.cells[0].metadata?.executionOrder, 15);
			}
		);
	});

	test('multiple inserts in one edit', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const viewModel = editor.viewModel;
				const textModel = editor.viewModel.notebookDocument;
				let changeEvent: NotebookTextModelChangedEvent | undefined = undefined;
				const eventListener = textModel.onDidChangeContent(e => {
					changeEvent = e;
				});
				const version = textModel.versionId;

				textModel.applyEdits([
					{ editType: CellEditType.Replace, index: 1, count: 1, cells: [] },
					{ editType: CellEditType.Replace, index: 1, count: 0, cells: [new TestCell(viewModel.viewType, 5, 'var e = 5;', 'javascript', CellKind.Code, [], modeService)] },
				], true, undefined, () => ({ kind: SelectionStateType.Index, focus: { start: 0, end: 1 }, selections: [{ start: 0, end: 1 }] }), undefined);

				assert.strictEqual(textModel.cells.length, 4);
				assert.strictEqual(textModel.cells[0].getValue(), 'var a = 1;');
				assert.strictEqual(textModel.cells[1].getValue(), 'var e = 5;');
				assert.strictEqual(textModel.cells[2].getValue(), 'var c = 3;');

				assert.notStrictEqual(changeEvent, undefined);
				assert.strictEqual(changeEvent!.rawEvents.length, 2);
				assert.deepStrictEqual(changeEvent!.endSelectionState?.selections, [{ start: 0, end: 1 }]);
				assert.strictEqual(textModel.versionId, version + 1);
				eventListener.dispose();
			}
		);
	});

	test('insert and metadata change in one edit', async function () {
		await withTestNotebook(
			[
				['var a = 1;', 'javascript', CellKind.Code, [], {}],
				['var b = 2;', 'javascript', CellKind.Code, [], {}],
				['var c = 3;', 'javascript', CellKind.Code, [], {}],
				['var d = 4;', 'javascript', CellKind.Code, [], {}]
			],
			(editor) => {
				const textModel = editor.viewModel.notebookDocument;
				let changeEvent: NotebookTextModelChangedEvent | undefined = undefined;
				const eventListener = textModel.onDidChangeContent(e => {
					changeEvent = e;
				});
				const version = textModel.versionId;

				textModel.applyEdits([
					{ editType: CellEditType.Replace, index: 1, count: 1, cells: [] },
					{
						index: 0,
						editType: CellEditType.Metadata,
						metadata: {},
					}
				], true, undefined, () => ({ kind: SelectionStateType.Index, focus: { start: 0, end: 1 }, selections: [{ start: 0, end: 1 }] }), undefined);

				assert.notStrictEqual(changeEvent, undefined);
				assert.strictEqual(changeEvent!.rawEvents.length, 2);
				assert.deepStrictEqual(changeEvent!.endSelectionState?.selections, [{ start: 0, end: 1 }]);
				assert.strictEqual(textModel.versionId, version + 1);
				eventListener.dispose();
			}
		);
	});


	test('Updating appending/updating output in Notebooks does not work as expected #117273', async function () {
		await withTestNotebook([
			['var a = 1;', 'javascript', CellKind.Code, [], {}]
		], (editor) => {
			const model = editor.viewModel.notebookDocument;

			assert.strictEqual(model.cells.length, 1);
			assert.strictEqual(model.cells[0].outputs.length, 0);

			const success1 = model.applyEdits(
				[{
					editType: CellEditType.Output, index: 0, outputs: [
						{ outputId: 'out1', outputs: [{ mime: 'application/x.notebook.stream', value: 1 }] }
					],
					append: false
				}], true, undefined, () => undefined, undefined, false
			);

			assert.ok(success1);
			assert.strictEqual(model.cells[0].outputs.length, 1);

			const success2 = model.applyEdits(
				[{
					editType: CellEditType.Output, index: 0, outputs: [
						{ outputId: 'out2', outputs: [{ mime: 'application/x.notebook.stream', value: 1 }] }
					],
					append: true
				}], true, undefined, () => undefined, undefined, false
			);

			assert.ok(success2);
			assert.strictEqual(model.cells[0].outputs.length, 2);
		});
	});

	test('Clearing output of an empty notebook makes it dirty #119608', async function () {
		await withTestNotebook([
			['var a = 1;', 'javascript', CellKind.Code, [], {}],
			['var b = 2;', 'javascript', CellKind.Code, [], {}]
		], (editor) => {
			const model = editor.viewModel.notebookDocument;

			let event: NotebookTextModelChangedEvent | undefined;

			model.onDidChangeContent(e => { event = e; });

			{
				// 1: add ouput -> event
				const success = model.applyEdits(
					[{
						editType: CellEditType.Output, index: 0, outputs: [
							{ outputId: 'out1', outputs: [{ mime: 'application/x.notebook.stream', value: 1 }] }
						],
						append: false
					}], true, undefined, () => undefined, undefined, false
				);

				assert.ok(success);
				assert.strictEqual(model.cells[0].outputs.length, 1);
				assert.ok(event);
			}

			{
				// 2: clear all output w/ output -> event
				event = undefined;
				const success = model.applyEdits(
					[{
						editType: CellEditType.Output,
						index: 0,
						outputs: [],
						append: false
					}, {
						editType: CellEditType.Output,
						index: 1,
						outputs: [],
						append: false
					}], true, undefined, () => undefined, undefined, false
				);
				assert.ok(success);
				assert.ok(event);
			}

			{
				// 2: clear all output wo/ output -> NO event
				event = undefined;
				const success = model.applyEdits(
					[{
						editType: CellEditType.Output,
						index: 0,
						outputs: [],
						append: false
					}, {
						editType: CellEditType.Output,
						index: 1,
						outputs: [],
						append: false
					}], true, undefined, () => undefined, undefined, false
				);

				assert.ok(success);
				assert.ok(event === undefined);
			}
		});
	});

	test('Cell metadata/output change should update version id and alternative id #121807', async function () {
		await withTestNotebook([
			['var a = 1;', 'javascript', CellKind.Code, [], {}],
			['var b = 2;', 'javascript', CellKind.Code, [], {}]
		], async (editor) => {
			assert.strictEqual(editor.viewModel.getVersionId(), 0);
			const firstAltVersion = '0_0,1;1,1';
			assert.strictEqual(editor.viewModel.getAlternativeId(), firstAltVersion);
			editor.viewModel.notebookDocument.applyEdits([
				{
					index: 0,
					editType: CellEditType.Metadata,
					metadata: {
						inputCollapsed: true
					}
				}
			], true, undefined, () => undefined, undefined, true);
			assert.strictEqual(editor.viewModel.getVersionId(), 1);
			assert.notStrictEqual(editor.viewModel.getAlternativeId(), firstAltVersion);
			const secondAltVersion = '1_0,1;1,1';
			assert.strictEqual(editor.viewModel.getAlternativeId(), secondAltVersion);

			await editor.viewModel.undo();
			assert.strictEqual(editor.viewModel.getVersionId(), 2);
			assert.strictEqual(editor.viewModel.getAlternativeId(), firstAltVersion);

			await editor.viewModel.redo();
			assert.strictEqual(editor.viewModel.getVersionId(), 3);
			assert.notStrictEqual(editor.viewModel.getAlternativeId(), firstAltVersion);
			assert.strictEqual(editor.viewModel.getAlternativeId(), secondAltVersion);

			editor.viewModel.notebookDocument.applyEdits([
				{
					index: 1,
					editType: CellEditType.Metadata,
					metadata: {
						inputCollapsed: true
					}
				}
			], true, undefined, () => undefined, undefined, true);
			assert.strictEqual(editor.viewModel.getVersionId(), 4);
			assert.strictEqual(editor.viewModel.getAlternativeId(), '4_0,1;1,1');

			await editor.viewModel.undo();
			assert.strictEqual(editor.viewModel.getVersionId(), 5);
			assert.strictEqual(editor.viewModel.getAlternativeId(), secondAltVersion);

		});
	});

	test('Destructive sorting in _doApplyEdits #121994', async function () {
		await withTestNotebook([
			['var a = 1;', 'javascript', CellKind.Code, [{ outputId: 'i42', outputs: [{ mime: 'm/ime', value: 'test' }] }], {}]
		], async (editor) => {

			const notebook = editor.viewModel.notebookDocument;

			assert.strictEqual(notebook.cells[0].outputs.length, 1);
			assert.strictEqual(notebook.cells[0].outputs[0].outputs.length, 1);
			assert.strictEqual(notebook.cells[0].outputs[0].outputs[0].value, 'test');

			const edits: ICellEditOperation[] = [
				{
					editType: CellEditType.Output, handle: 0, outputs: []
				},
				{
					editType: CellEditType.Output, handle: 0, append: true, outputs: [{
						outputId: 'newOutput',
						outputs: [{ mime: 'text/plain', value: 'cba' }, { mime: 'application/foo', value: 'cba' }]
					}]
				}
			];

			editor.viewModel.notebookDocument.applyEdits(edits, true, undefined, () => undefined, undefined);

			assert.strictEqual(notebook.cells[0].outputs.length, 1);
			assert.strictEqual(notebook.cells[0].outputs[0].outputs.length, 2);
		});
	});

	test('Destructive sorting in _doApplyEdits #121994. cell splice between output changes', async function () {
		await withTestNotebook([
			['var a = 1;', 'javascript', CellKind.Code, [{ outputId: 'i42', outputs: [{ mime: 'm/ime', value: 'test' }] }], {}],
			['var b = 2;', 'javascript', CellKind.Code, [{ outputId: 'i43', outputs: [{ mime: 'm/ime', value: 'test' }] }], {}],
			['var c = 3;', 'javascript', CellKind.Code, [{ outputId: 'i44', outputs: [{ mime: 'm/ime', value: 'test' }] }], {}]
		], async (editor) => {
			const notebook = editor.viewModel.notebookDocument;

			const edits: ICellEditOperation[] = [
				{
					editType: CellEditType.Output, index: 0, outputs: []
				},
				{
					editType: CellEditType.Replace, index: 1, count: 1, cells: []
				},
				{
					editType: CellEditType.Output, index: 2, append: true, outputs: [{
						outputId: 'newOutput',
						outputs: [{ mime: 'text/plain', value: 'cba' }, { mime: 'application/foo', value: 'cba' }]
					}]
				}
			];

			editor.viewModel.notebookDocument.applyEdits(edits, true, undefined, () => undefined, undefined);

			assert.strictEqual(notebook.cells.length, 2);
			assert.strictEqual(notebook.cells[0].outputs.length, 0);
			assert.strictEqual(notebook.cells[1].outputs.length, 2);
			assert.strictEqual(notebook.cells[1].outputs[0].outputId, 'i44');
			assert.strictEqual(notebook.cells[1].outputs[1].outputId, 'newOutput');
		});
	});

	test('Destructive sorting in _doApplyEdits #121994. cell splice between output changes 2', async function () {
		await withTestNotebook([
			['var a = 1;', 'javascript', CellKind.Code, [{ outputId: 'i42', outputs: [{ mime: 'm/ime', value: 'test' }] }], {}],
			['var b = 2;', 'javascript', CellKind.Code, [{ outputId: 'i43', outputs: [{ mime: 'm/ime', value: 'test' }] }], {}],
			['var c = 3;', 'javascript', CellKind.Code, [{ outputId: 'i44', outputs: [{ mime: 'm/ime', value: 'test' }] }], {}]
		], async (editor) => {
			const notebook = editor.viewModel.notebookDocument;

			const edits: ICellEditOperation[] = [
				{
					editType: CellEditType.Output, index: 1, append: true, outputs: [{
						outputId: 'newOutput',
						outputs: [{ mime: 'text/plain', value: 'cba' }, { mime: 'application/foo', value: 'cba' }]
					}]
				},
				{
					editType: CellEditType.Replace, index: 1, count: 1, cells: []
				},
				{
					editType: CellEditType.Output, index: 1, append: true, outputs: [{
						outputId: 'newOutput2',
						outputs: [{ mime: 'text/plain', value: 'cba' }, { mime: 'application/foo', value: 'cba' }]
					}]
				}
			];

			editor.viewModel.notebookDocument.applyEdits(edits, true, undefined, () => undefined, undefined);

			assert.strictEqual(notebook.cells.length, 2);
			assert.strictEqual(notebook.cells[0].outputs.length, 1);
			assert.strictEqual(notebook.cells[1].outputs.length, 1);
			assert.strictEqual(notebook.cells[1].outputs[0].outputId, 'i44');
		});
	});
});
