/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Range } from 'vs/editor/common/core/range';
import { ITextBuffer, ValidAnnotatedEditOperation } from 'vs/editor/common/model';
import { USUAL_WORD_SEPARATORS } from 'vs/editor/common/model/wordHelper';
import { IModeService } from 'vs/editor/common/services/modeService';
import { FindReplaceState } from 'vs/editor/contrib/find/findState';
import { IConfigurationService, IConfigurationValue } from 'vs/platform/configuration/common/configuration';
import { TestConfigurationService } from 'vs/platform/configuration/test/common/testConfigurationService';
import { FindModel } from 'vs/workbench/contrib/notebook/browser/contrib/find/findModel';
import { IActiveNotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { ICellModelDecorations, ICellModelDeltaDecorations } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { CellEditType, CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { TestCell, withTestNotebook } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';

suite('Notebook Find', () => {
	const configurationValue: IConfigurationValue<any> = {
		value: USUAL_WORD_SEPARATORS
	};
	const configurationService = new class extends TestConfigurationService {
		override inspect() {
			return configurationValue;
		}
	}();

	const setupEditorForTest = (editor: IActiveNotebookEditor) => {
		editor.changeModelDecorations = (callback) => {
			return callback({
				deltaDecorations: (oldDecorations: ICellModelDecorations[], newDecorations: ICellModelDeltaDecorations[]) => {
					const ret: ICellModelDecorations[] = [];
					newDecorations.forEach(dec => {
						const cell = editor.viewModel.viewCells.find(cell => cell.handle === dec.ownerId);
						const decorations = cell?.deltaModelDecorations([], dec.decorations) ?? [];

						if (decorations.length > 0) {
							ret.push({ ownerId: dec.ownerId, decorations: decorations });
						}
					});

					return ret;
				}
			});
		};
	};

	test('Update find matches basics', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				accessor.stub(IConfigurationService, configurationService);
				const state = new FindReplaceState();
				const model = new FindModel(editor, state, accessor.get(IConfigurationService));
				state.change({ isRevealed: true }, true);
				state.change({ searchString: '1' }, true);
				assert.strictEqual(model.findMatches.length, 2);
				assert.strictEqual(model.currentMatch, -1);
				model.find(false);
				assert.strictEqual(model.currentMatch, 0);
				model.find(false);
				assert.strictEqual(model.currentMatch, 1);
				model.find(false);
				assert.strictEqual(model.currentMatch, 0);

				assert.strictEqual(editor.textModel.length, 3);

				editor.textModel.applyEdits([{
					editType: CellEditType.Replace, index: 3, count: 0, cells: [
						new TestCell(editor.viewModel.viewType, 3, '# next paragraph 1', 'markdown', CellKind.Code, [], accessor.get(IModeService)),
					]
				}], true, undefined, () => undefined, undefined, true);
				assert.strictEqual(editor.textModel.length, 4);
				assert.strictEqual(model.findMatches.length, 3);
				assert.strictEqual(model.currentMatch, 0);
			});
	});

	test('Update find matches basics 2', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1.1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1.2', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1.3', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				setupEditorForTest(editor);
				accessor.stub(IConfigurationService, configurationService);
				const state = new FindReplaceState();
				const model = new FindModel(editor, state, accessor.get(IConfigurationService));
				state.change({ isRevealed: true }, true);
				state.change({ searchString: '1' }, true);
				// find matches is not necessarily find results
				assert.strictEqual(model.findMatches.length, 4);
				assert.strictEqual(model.currentMatch, -1);
				model.find(false);
				assert.strictEqual(model.currentMatch, 0);
				model.find(false);
				assert.strictEqual(model.currentMatch, 1);
				model.find(false);
				assert.strictEqual(model.currentMatch, 2);

				editor.textModel.applyEdits([{
					editType: CellEditType.Replace, index: 2, count: 1, cells: []
				}], true, undefined, () => undefined, undefined, true);
				assert.strictEqual(model.findMatches.length, 3);

				assert.strictEqual(model.currentMatch, 2);
				model.find(true);
				assert.strictEqual(model.currentMatch, 1);
				model.find(false);
				assert.strictEqual(model.currentMatch, 2);
				model.find(false);
				assert.strictEqual(model.currentMatch, 3);
				model.find(false);
				assert.strictEqual(model.currentMatch, 0);
			});
	});

	test('Update find matches basics 3', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1.1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1.2', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1.3', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				setupEditorForTest(editor);
				accessor.stub(IConfigurationService, configurationService);
				const state = new FindReplaceState();
				const model = new FindModel(editor, state, accessor.get(IConfigurationService));
				state.change({ isRevealed: true }, true);
				state.change({ searchString: '1' }, true);
				// find matches is not necessarily find results
				assert.strictEqual(model.findMatches.length, 4);
				assert.strictEqual(model.currentMatch, -1);
				model.find(true);
				assert.strictEqual(model.currentMatch, 4);

				editor.textModel.applyEdits([{
					editType: CellEditType.Replace, index: 2, count: 1, cells: []
				}], true, undefined, () => undefined, undefined, true);
				assert.strictEqual(model.findMatches.length, 3);
				assert.strictEqual(model.currentMatch, 3);
				model.find(false);
				assert.strictEqual(model.currentMatch, 0);
				model.find(true);
				assert.strictEqual(model.currentMatch, 3);
				model.find(true);
				assert.strictEqual(model.currentMatch, 2);
			});
	});

	test('Update find matches, #112748', async function () {
		await withTestNotebook(
			[
				['# header 1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1.1', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1.2', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 1.3', 'markdown', CellKind.Markdown, [], {}],
				['paragraph 2', 'markdown', CellKind.Markdown, [], {}],
			],
			async (editor, accessor) => {
				setupEditorForTest(editor);
				accessor.stub(IConfigurationService, configurationService);
				const state = new FindReplaceState();
				const model = new FindModel(editor, state, accessor.get(IConfigurationService));
				state.change({ isRevealed: true }, true);
				state.change({ searchString: '1' }, true);
				// find matches is not necessarily find results
				assert.strictEqual(model.findMatches.length, 4);
				assert.strictEqual(model.currentMatch, -1);
				model.find(false);
				model.find(false);
				model.find(false);
				assert.strictEqual(model.currentMatch, 2);
				(editor.viewModel.viewCells[1].textBuffer as ITextBuffer).applyEdits([
					new ValidAnnotatedEditOperation(null, new Range(1, 1, 1, 14), '', false, false, false)
				], false, true);
				// cell content updates, recompute
				model.research();
				assert.strictEqual(model.currentMatch, 1);
			});
	});
});
