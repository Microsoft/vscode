/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { LcsDiff } from 'vs/base/common/diff/diff';
import { NotebookDiffEditorEventDispatcher } from 'vs/workbench/contrib/notebook/browser/diff/eventDispatcher';
import { NotebookTextDiffEditor } from 'vs/workbench/contrib/notebook/browser/diff/notebookTextDiffEditor';
import { CellKind, CellSequence } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { withTestNotebookDiffModel } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';

suite('NotebookCommon', () => {

	test('diff insert', async () => {
		await withTestNotebookDiffModel([
			['var a = 1;', 'javascript', CellKind.Code, [], {}],
			['var b = 2;', 'javascript', CellKind.Code, [], {}]
		], [
			['var h = 8;', 'javascript', CellKind.Code, [], {}],
			['var a = 1;', 'javascript', CellKind.Code, [], {}],
			['var b = 2;', 'javascript', CellKind.Code, [], {}]
		], (model, accessor) => {
			const eventDispatcher = new NotebookDiffEditorEventDispatcher();
			const diffResult = NotebookTextDiffEditor.computeDiff(accessor, model, eventDispatcher, {
				cellsDiff: {
					changes: [{
						originalStart: 0,
						originalLength: 0,
						modifiedStart: 0,
						modifiedLength: 1
					}],
					quitEarly: false
				}
			});

			assert.strictEqual(diffResult.firstChangeIndex, 0);
			assert.strictEqual(diffResult.viewModels[0].type, 'insert');
			assert.strictEqual(diffResult.viewModels[1].type, 'unchanged');
			assert.strictEqual(diffResult.viewModels[2].type, 'unchanged');
		});
	});

	test('diff insert 2', async () => {

		await withTestNotebookDiffModel([
			['var a = 1;', 'javascript', CellKind.Code, [], {}],
			['var b = 2;', 'javascript', CellKind.Code, [], {}],
			['var c = 3;', 'javascript', CellKind.Code, [], {}],
			['var d = 4;', 'javascript', CellKind.Code, [], {}],
			['var e = 5;', 'javascript', CellKind.Code, [], {}],
			['var f = 6;', 'javascript', CellKind.Code, [], {}],
			['var g = 7;', 'javascript', CellKind.Code, [], {}],
		], [
			['var h = 8;', 'javascript', CellKind.Code, [], {}],
			['var a = 1;', 'javascript', CellKind.Code, [], {}],
			['var b = 2;', 'javascript', CellKind.Code, [], {}],
			['var c = 3;', 'javascript', CellKind.Code, [], {}],
			['var d = 4;', 'javascript', CellKind.Code, [], {}],
			['var e = 5;', 'javascript', CellKind.Code, [], {}],
			['var f = 6;', 'javascript', CellKind.Code, [], {}],
			['var g = 7;', 'javascript', CellKind.Code, [], {}],
		], async (model, accessor) => {
			const eventDispatcher = new NotebookDiffEditorEventDispatcher();
			const diffResult = NotebookTextDiffEditor.computeDiff(accessor, model, eventDispatcher, {
				cellsDiff: {
					changes: [{
						originalStart: 0,
						originalLength: 0,
						modifiedStart: 0,
						modifiedLength: 1
					}, {
						originalStart: 0,
						originalLength: 6,
						modifiedStart: 1,
						modifiedLength: 6
					}],
					quitEarly: false
				}
			});

			assert.strictEqual(diffResult.firstChangeIndex, 0);
			assert.strictEqual(diffResult.viewModels[0].type, 'insert');
			assert.strictEqual(diffResult.viewModels[1].type, 'unchanged');
			assert.strictEqual(diffResult.viewModels[2].type, 'unchanged');
			assert.strictEqual(diffResult.viewModels[3].type, 'unchanged');
			assert.strictEqual(diffResult.viewModels[4].type, 'unchanged');
			assert.strictEqual(diffResult.viewModels[5].type, 'unchanged');
			assert.strictEqual(diffResult.viewModels[6].type, 'unchanged');
			assert.strictEqual(diffResult.viewModels[7].type, 'unchanged');
		});
	});

	test('LCS', async () => {
		await withTestNotebookDiffModel([
			['# Description', 'markdown', CellKind.Markdown, [], { custom: { metadata: {} } }],
			['x = 3', 'javascript', CellKind.Code, [], { custom: { metadata: { collapsed: true } }, executionOrder: 1 }],
			['x', 'javascript', CellKind.Code, [{ outputId: 'someId', outputs: [{ mime: 'text/plain', value: '3' }] }], { custom: { metadata: { collapsed: false } }, executionOrder: 1 }],
			['x', 'javascript', CellKind.Code, [], { custom: { metadata: { collapsed: false } } }]
		], [
			['# Description', 'markdown', CellKind.Markdown, [], { custom: { metadata: {} } }],
			['x = 3', 'javascript', CellKind.Code, [], { custom: { metadata: { collapsed: true } }, executionOrder: 1 }],
			['x', 'javascript', CellKind.Code, [], { custom: { metadata: { collapsed: false } } }],
			['x', 'javascript', CellKind.Code, [{ outputId: 'someId', outputs: [{ mime: 'text/plain', value: '3' }] }], { custom: { metadata: { collapsed: false } }, executionOrder: 1 }]
		], async (model) => {
			const diff = new LcsDiff(new CellSequence(model.original.notebook), new CellSequence(model.modified.notebook));
			const diffResult = diff.ComputeDiff(false);
			assert.deepStrictEqual(diffResult.changes.map(change => ({
				originalStart: change.originalStart,
				originalLength: change.originalLength,
				modifiedStart: change.modifiedStart,
				modifiedLength: change.modifiedLength
			})), [{
				originalStart: 2,
				originalLength: 0,
				modifiedStart: 2,
				modifiedLength: 1
			}, {
				originalStart: 3,
				originalLength: 1,
				modifiedStart: 4,
				modifiedLength: 0
			}]);
		});
	});

	test('LCS 2', async () => {
		await withTestNotebookDiffModel([
			['# Description', 'markdown', CellKind.Markdown, [], { custom: { metadata: {} } }],
			['x = 3', 'javascript', CellKind.Code, [], { custom: { metadata: { collapsed: true } }, executionOrder: 1 }],
			['x', 'javascript', CellKind.Code, [{ outputId: 'someId', outputs: [{ mime: 'text/plain', value: '3' }] }], { custom: { metadata: { collapsed: false } }, executionOrder: 1 }],
			['x', 'javascript', CellKind.Code, [], { custom: { metadata: { collapsed: false } } }],
			['x = 5', 'javascript', CellKind.Code, [], {}],
			['x', 'javascript', CellKind.Code, [], {}],
			['x', 'javascript', CellKind.Code, [{ outputId: 'someId', outputs: [{ mime: 'text/plain', value: '5' }] }], {}],
		], [
			['# Description', 'markdown', CellKind.Markdown, [], { custom: { metadata: {} } }],
			['x = 3', 'javascript', CellKind.Code, [], { custom: { metadata: { collapsed: true } }, executionOrder: 1 }],
			['x', 'javascript', CellKind.Code, [], { custom: { metadata: { collapsed: false } } }],
			['x', 'javascript', CellKind.Code, [{ outputId: 'someId', outputs: [{ mime: 'text/plain', value: '3' }] }], { custom: { metadata: { collapsed: false } }, executionOrder: 1 }],
			['x = 5', 'javascript', CellKind.Code, [], {}],
			['x', 'javascript', CellKind.Code, [{ outputId: 'someId', outputs: [{ mime: 'text/plain', value: '5' }] }], {}],
			['x', 'javascript', CellKind.Code, [], {}],
		], async (model) => {
			const diff = new LcsDiff(new CellSequence(model.original.notebook), new CellSequence(model.modified.notebook));
			const diffResult = diff.ComputeDiff(false);
			NotebookTextDiffEditor.prettyChanges(model, diffResult);

			assert.deepStrictEqual(diffResult.changes.map(change => ({
				originalStart: change.originalStart,
				originalLength: change.originalLength,
				modifiedStart: change.modifiedStart,
				modifiedLength: change.modifiedLength
			})), [{
				originalStart: 2,
				originalLength: 0,
				modifiedStart: 2,
				modifiedLength: 1
			}, {
				originalStart: 3,
				originalLength: 1,
				modifiedStart: 4,
				modifiedLength: 0
			}, {
				originalStart: 5,
				originalLength: 0,
				modifiedStart: 5,
				modifiedLength: 1
			}, {
				originalStart: 6,
				originalLength: 1,
				modifiedStart: 7,
				modifiedLength: 0
			}]);
		});
	});
});
