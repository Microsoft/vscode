/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { TableOfContentsProviderRegistry, ITableOfContentsProvider, ITableOfContentsEntry } from 'vs/workbench/contrib/codeEditor/browser/quickaccess/gotoSymbolQuickAccess';
import { NotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookEditor';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';


TableOfContentsProviderRegistry.register(NotebookEditor.ID, new class implements ITableOfContentsProvider {
	async provideTableOfContents(editor: NotebookEditor) {
		if (!editor.viewModel) {
			return undefined;
		}
		// return an entry per markdown header
		const result: ITableOfContentsEntry[] = [];
		for (let cell of editor.viewModel.viewCells) {
			if (cell.cellKind === CellKind.Code) {
				continue;
			}
			const content = cell.getText();
			const matches = content.match(/^[ \t]*(\#+)(.+)$/gm);
			if (matches && matches.length) {
				for (let j = 0; j < matches.length; j++) {
					result.push({
						label: matches[j].replace(/^[ \t]*(\#+)/, ''),
						reveal: () => editor.revealInCenterIfOutsideViewport(cell)
					});
				}
			}
		}
		return result;
	}
});
