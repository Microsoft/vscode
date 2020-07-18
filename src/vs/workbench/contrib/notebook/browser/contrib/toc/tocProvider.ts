/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TableOfContentsProviderRegistry, ITableOfContentsProvider, ITableOfContentsEntry } from 'vs/workbench/contrib/codeEditor/browser/quickaccess/gotoSymbolQuickAccess';
import { NotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookEditor';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Codicon } from 'vs/base/common/codicons';
import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';

TableOfContentsProviderRegistry.register(NotebookEditor.ID, new class implements ITableOfContentsProvider {
	async provideTableOfContents(editor: NotebookEditor, context: { disposables: DisposableStore }) {
		if (!editor.viewModel) {
			return undefined;
		}
		// return an entry per markdown header
		const notebookWidget = editor.getControl();
		if (!notebookWidget) {
			return undefined;
		}

		// restore initial view state when no item was picked
		let didPickOne = false;
		const viewState = notebookWidget.getEditorViewState();
		context.disposables.add(toDisposable(() => {
			if (!didPickOne) {
				notebookWidget.restoreListViewState(viewState);
			}
		}));

		let lastDecorationId: string[] = [];
		const result: ITableOfContentsEntry[] = [];
		for (const cell of editor.viewModel.viewCells) {
			const content = cell.getText();
			const regexp = cell.cellKind === CellKind.Markdown
				? /^[ \t]*(\#+)(.+)$/gm // md: header
				: /^.*\w+.*\w*$/m;		// code: none empty line

			const matches = content.match(regexp);
			if (matches && matches.length) {
				for (let j = 0; j < matches.length; j++) {
					result.push({
						icon: cell.cellKind === CellKind.Markdown ? Codicon.markdown : Codicon.code,
						label: matches[j].replace(/^[ \t]*(\#+)/, ''),
						pick() {
							didPickOne = true;
							notebookWidget.revealInCenterIfOutsideViewport(cell);
							notebookWidget.selectElement(cell);
							notebookWidget.focusNotebookCell(cell, cell.cellKind === CellKind.Markdown ? 'container' : 'editor');
							lastDecorationId = notebookWidget.deltaCellDecorations(lastDecorationId, []);
						},
						preview() {
							notebookWidget.revealInCenterIfOutsideViewport(cell);
							notebookWidget.selectElement(cell);
							lastDecorationId = notebookWidget.deltaCellDecorations(lastDecorationId, [{
								handle: cell.handle,
								options: { className: 'nb-symbolHighlight', outputClassName: 'nb-symbolHighlight' }
							}]);
						}
					});
				}
			}
		}

		context.disposables.add(toDisposable(() => {
			notebookWidget.deltaCellDecorations(lastDecorationId, []);
		}));

		return result;
	}
});
