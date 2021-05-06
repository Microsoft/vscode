/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { RunOnceScheduler } from 'vs/base/common/async';
import { Disposable } from 'vs/base/common/lifecycle';
import { CellEditState, IInsetRenderOutput, INotebookEditor, INotebookEditorContribution, RenderOutputType } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { registerNotebookContribution } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { BUILTIN_RENDERER_ID, CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { cellRangesToIndexes } from 'vs/workbench/contrib/notebook/common/notebookRange';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';

class NotebookClipboardContribution extends Disposable implements INotebookEditorContribution {
	static id: string = 'workbench.notebook.viewportCustomMarkdown';
	private readonly _warmupViewport: RunOnceScheduler;

	constructor(private readonly _notebookEditor: INotebookEditor,
		@INotebookService private readonly _notebookService: INotebookService) {
		super();

		this._warmupViewport = new RunOnceScheduler(() => this._warmupViewportNow(), 200);

		this._register(this._notebookEditor.onDidScroll(() => {
			this._warmupViewport.schedule();
		}));
	}

	private _warmupViewportNow() {
		const visibleRanges = this._notebookEditor.getVisibleRangesPlusViewportAboveBelow();
		cellRangesToIndexes(visibleRanges).forEach(index => {
			const cell = this._notebookEditor.viewModel?.viewCells[index];

			if (cell?.cellKind === CellKind.Markdown && cell?.getEditState() === CellEditState.Preview && !cell.metadata?.inputCollapsed) {
				this._notebookEditor.createMarkdownPreview(cell);
			} else if (cell?.cellKind === CellKind.Code) {
				const viewCell = (cell as CodeCellViewModel);
				const outputs = viewCell.outputsViewModels;
				for (let output of outputs) {
					const [mimeTypes, pick] = output.resolveMimeTypes(this._notebookEditor.textModel!, undefined);
					if (!mimeTypes.find(mimeType => mimeType.isTrusted) || mimeTypes.length === 0) {
						continue;
					}

					const pickedMimeTypeRenderer = mimeTypes[pick];

					if (!pickedMimeTypeRenderer) {
						return;
					}

					if (pickedMimeTypeRenderer.rendererId === BUILTIN_RENDERER_ID) {
						const renderer = this._notebookEditor.getOutputRenderer().getContribution(pickedMimeTypeRenderer.mimeType);
						if (renderer?.getType() === RenderOutputType.Html) {
							const renderResult = renderer!.render(output, output.model.outputs.filter(op => op.mime === pickedMimeTypeRenderer.mimeType), DOM.$(''), undefined) as IInsetRenderOutput;
							this._notebookEditor.createOutput(viewCell, renderResult, 0);
						}
						return;
					}
					const renderer = this._notebookService.getRendererInfo(pickedMimeTypeRenderer.rendererId);

					if (!renderer) {
						return;
					}

					const result: IInsetRenderOutput = { type: RenderOutputType.Extension, renderer, source: output, mimeType: pickedMimeTypeRenderer.mimeType };
					this._notebookEditor.createOutput(viewCell, result, 0);
				}
			}
		});
	}
}

registerNotebookContribution(NotebookClipboardContribution.id, NotebookClipboardContribution);
