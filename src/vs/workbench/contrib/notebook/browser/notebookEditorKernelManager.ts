/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Disposable } from 'vs/base/common/lifecycle';
import { ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellKind, INotebookKernel, INotebookTextModel } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { INotebookKernelService } from 'vs/workbench/contrib/notebook/common/notebookKernelService';
import { IWorkspaceTrustRequestService } from 'vs/platform/workspace/common/workspaceTrust';

export class NotebookEditorKernelManager extends Disposable {

	constructor(
		@ICommandService private readonly _commandService: ICommandService,
		@INotebookKernelService private readonly _notebookKernelService: INotebookKernelService,
		@IWorkspaceTrustRequestService private readonly _workspaceTrustRequestService: IWorkspaceTrustRequestService,
	) {
		super();
	}

	getSelectedOrSuggestedKernel(notebook: INotebookTextModel): INotebookKernel | undefined {
		// returns SELECTED or the ONLY available kernel
		const info = this._notebookKernelService.getMatchingKernel(notebook);
		if (info.selected) {
			return info.selected;
		}
		if (info.all.length === 1) {
			return info.all[0];
		}
		return undefined;
	}

	confirmSuggestedKernel(notebook: INotebookTextModel): void {
		const kernel = this.getSelectedOrSuggestedKernel(notebook);
		if (kernel) {
			this._notebookKernelService.selectKernelForNotebook(kernel, notebook);
		}
	}

	async executeNotebookCells(notebook: INotebookTextModel, cells: Iterable<ICellViewModel>): Promise<void> {
		const message = nls.localize('notebookRunTrust', "Executing a notebook cell will run code from this workspace.");
		const trust = await this._workspaceTrustRequestService.requestWorkspaceTrust({ message });
		if (!trust) {
			return;
		}

		let kernel = this.getSelectedOrSuggestedKernel(notebook);
		if (!kernel) {
			await this._commandService.executeCommand('notebook.selectKernel');
			kernel = this.getSelectedOrSuggestedKernel(notebook);
		}

		if (!kernel) {
			return;
		}

		const cellHandles: number[] = [];
		for (const cell of cells) {
			if (cell.cellKind !== CellKind.Code) {
				continue;
			}
			if (!kernel.supportedLanguages.includes(cell.language)) {
				continue;
			}
			cellHandles.push(cell.handle);
		}

		if (cellHandles.length > 0) {
			this._notebookKernelService.selectKernelForNotebook(kernel, notebook);
			await kernel.executeNotebookCellsRequest(notebook.uri, cellHandles);
		}
	}

	async cancelNotebookCells(notebook: INotebookTextModel, cells: Iterable<ICellViewModel>): Promise<void> {
		let kernel = this.getSelectedOrSuggestedKernel(notebook);
		if (kernel) {
			await kernel.cancelNotebookCellExecution(notebook.uri, Array.from(cells, cell => cell.handle));
		}
	}
}
