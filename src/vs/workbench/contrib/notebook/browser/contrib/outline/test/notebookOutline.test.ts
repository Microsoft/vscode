/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { setupInstantiationService, withTestNotebook } from 'vs/workbench/contrib/notebook/test/testNotebookEditor';
import { OutlineTarget } from 'vs/workbench/services/outline/browser/outline';
import { NotebookCellOutline } from 'vs/workbench/contrib/notebook/browser/contrib/outline/notebookOutline';
import { IFileIconTheme, IThemeService } from 'vs/platform/theme/common/themeService';
import { mock } from 'vs/base/test/common/mock';
import { Event } from 'vs/base/common/event';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IMarkerService } from 'vs/platform/markers/common/markers';
import { MarkerService } from 'vs/platform/markers/common/markerService';
import { CellKind, IOutputDto, NotebookCellMetadata } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IActiveNotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';


suite('Notebook Outline', function () {

	const instantiationService = setupInstantiationService();
	instantiationService.set(IEditorService, new class extends mock<IEditorService>() { });
	instantiationService.set(IMarkerService, new MarkerService());
	instantiationService.set(IThemeService, new class extends mock<IThemeService>() {
		override onDidFileIconThemeChange = Event.None;
		override getFileIconTheme(): IFileIconTheme {
			return { hasFileIcons: true, hasFolderIcons: true, hidesExplorerArrows: false };
		}
	});

	function withNotebookOutline<R = any>(cells: [source: string, lang: string, kind: CellKind, output?: IOutputDto[], metadata?: NotebookCellMetadata][], callback: (outline: NotebookCellOutline, editor: IActiveNotebookEditor) => R): Promise<R> {
		return withTestNotebook(cells, (editor) => {
			if (!editor.hasModel()) {
				assert.ok(false, 'MUST have active text editor');
			}
			const outline = instantiationService.createInstance(NotebookCellOutline, editor, OutlineTarget.OutlinePane);
			return callback(outline, editor);
		});

	}

	test('basic', async function () {
		await withNotebookOutline([], outline => {
			assert.ok(outline instanceof NotebookCellOutline);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements(), []);
		});
	});

	test('special characters in heading', async function () {
		await withNotebookOutline([
			['# Hellö & Hällo', 'md', CellKind.Markdown]
		], outline => {
			assert.ok(outline instanceof NotebookCellOutline);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements().length, 1);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements()[0].label, 'Hellö & Hällo');
		});

		await withNotebookOutline([
			['# bo<i>ld</i>', 'md', CellKind.Markdown]
		], outline => {
			assert.ok(outline instanceof NotebookCellOutline);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements().length, 1);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements()[0].label, 'bold');
		});
	});

	test('Heading text defines entry label', async function () {
		return await withNotebookOutline([
			['foo\n # h1', 'md', CellKind.Markdown]
		], outline => {
			assert.ok(outline instanceof NotebookCellOutline);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements().length, 1);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements()[0].label, 'h1');
		});
	});

	test('Notebook outline ignores markdown headings #115200', async function () {
		await withNotebookOutline([
			['## h2 \n# h1', 'md', CellKind.Markdown]
		], outline => {
			assert.ok(outline instanceof NotebookCellOutline);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements().length, 2);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements()[0].label, 'h2');
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements()[1].label, 'h1');
		});

		await withNotebookOutline([
			['## h2', 'md', CellKind.Markdown],
			['# h1', 'md', CellKind.Markdown]
		], outline => {
			assert.ok(outline instanceof NotebookCellOutline);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements().length, 2);
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements()[0].label, 'h2');
			assert.deepStrictEqual(outline.config.quickPickDataSource.getQuickPickElements()[1].label, 'h1');
		});
	});
});
