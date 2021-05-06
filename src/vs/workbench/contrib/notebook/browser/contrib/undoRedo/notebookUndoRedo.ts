/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { CellEditState, getNotebookEditorFromEditorPane, NotebookEditorOptions } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { RedoCommand, UndoCommand } from 'vs/editor/browser/editorExtensions';

class NotebookUndoRedoContribution extends Disposable {

	constructor(@IEditorService private readonly _editorService: IEditorService) {
		super();

		const PRIORITY = 105;
		this._register(UndoCommand.addImplementation(PRIORITY, 'notebook-undo-redo', () => {
			const editor = getNotebookEditorFromEditorPane(this._editorService.activeEditorPane);
			if (editor?.viewModel) {
				return editor.viewModel.undo().then(cellResources => {
					if (cellResources?.length) {
						editor?.viewModel?.viewCells.forEach(cell => {
							if (cell.cellKind === CellKind.Markdown && cellResources.find(resource => resource.fragment === cell.model.uri.fragment)) {
								cell.updateEditState(CellEditState.Editing, 'undo');
							}
						});

						editor?.setOptions(new NotebookEditorOptions({ cellOptions: { resource: cellResources[0] }, preserveFocus: true }));
					}
				});
			}

			return false;
		}));

		this._register(RedoCommand.addImplementation(PRIORITY, 'notebook-undo-redo', () => {
			const editor = getNotebookEditorFromEditorPane(this._editorService.activeEditorPane);
			if (editor?.viewModel) {
				return editor.viewModel.redo().then(cellResources => {
					if (cellResources?.length) {
						editor?.viewModel?.viewCells.forEach(cell => {
							if (cell.cellKind === CellKind.Markdown && cellResources.find(resource => resource.fragment === cell.model.uri.fragment)) {
								cell.updateEditState(CellEditState.Editing, 'redo');
							}
						});

						editor?.setOptions(new NotebookEditorOptions({ cellOptions: { resource: cellResources[0] }, preserveFocus: true }));
					}
				});
			}

			return false;
		}));
	}
}

const workbenchContributionsRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchContributionsRegistry.registerWorkbenchContribution(NotebookUndoRedoContribution, LifecyclePhase.Ready);
