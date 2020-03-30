/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { getResizesObserver } from 'vs/workbench/contrib/notebook/browser/view/renderers/sizeObserver';
import { IOutput, ITransformedDisplayOutputDto, IRenderOutput, CellOutputKind } from 'vs/workbench/services/notebook/common/notebookCommon';
import { CellRenderTemplate, INotebookEditor, CellFocusMode } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { raceCancellation } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { INotebookService } from 'vs/workbench/services/notebook/browser/notebookService';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { EDITOR_TOP_PADDING, EDITOR_BOTTOM_PADDING } from 'vs/workbench/contrib/notebook/browser/constants';
import { IModeService } from 'vs/editor/common/services/modeService';
import { debounce } from 'vs/base/common/decorators';

interface IMimeTypeRenderer extends IQuickPickItem {
	index: number;
}

export class CodeCell extends Disposable {
	private outputResizeListeners = new Map<IOutput, DisposableStore>();
	private outputElements = new Map<IOutput, HTMLElement>();
	constructor(
		private notebookEditor: INotebookEditor,
		private viewCell: CodeCellViewModel,
		private templateData: CellRenderTemplate,
		@INotebookService private notebookService: INotebookService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IModeService private readonly _modeService: IModeService
	) {
		super();

		const width = this.viewCell.layoutInfo.editorWidth;
		const lineNum = this.viewCell.lineCount;
		const lineHeight = this.viewCell.layoutInfo.fontInfo?.lineHeight || 17;
		const totalHeight = lineNum * lineHeight + EDITOR_TOP_PADDING + EDITOR_BOTTOM_PADDING;
		templateData.editor?.layout(
			{
				width: width,
				height: totalHeight
			}
		);
		viewCell.editorHeight = totalHeight;

		const cts = new CancellationTokenSource();
		this._register({ dispose() { cts.dispose(true); } });
		raceCancellation(viewCell.resolveTextModel(), cts.token).then(model => {
			if (model && templateData.editor) {
				templateData.editor.setModel(model);
				viewCell.attachTextEditor(templateData.editor);
				if (notebookEditor.getActiveCell() === viewCell && viewCell.focusMode === CellFocusMode.Editor) {
					templateData.editor?.focus();
				}

				const realContentHeight = templateData.editor?.getContentHeight();
				const width = this.viewCell.layoutInfo.editorWidth;

				if (realContentHeight !== undefined && realContentHeight !== totalHeight) {
					templateData.editor?.layout(
						{
							width: width,
							height: realContentHeight
						}
					);

					viewCell.editorHeight = realContentHeight;
				}

				if (this.notebookEditor.getActiveCell() === this.viewCell && viewCell.focusMode === CellFocusMode.Editor) {
					templateData.editor?.focus();
				}
			}
		});

		this._register(viewCell.onDidChangeFocusMode(() => {
			if (viewCell.focusMode === CellFocusMode.Editor) {
				templateData.editor?.focus();
			}
		}));

		templateData.editor?.updateOptions({ readOnly: !(viewCell.getEvaluatedMetadata(notebookEditor.viewModel?.metadata).editable) });
		this._register(viewCell.onDidChangeMetadata(() => {
			templateData.editor?.updateOptions({ readOnly: !(viewCell.getEvaluatedMetadata(notebookEditor.viewModel?.metadata).editable) });
		}));

		this._register(viewCell.onDidChangeLanguage((e) => {
			const mode = this._modeService.create(e);
			templateData.editor?.getModel()?.setMode(mode.languageIdentifier);
		}));

		let cellWidthResizeObserver = getResizesObserver(templateData.editorContainer!, {
			width: width,
			height: totalHeight
		}, () => {
			let newWidth = cellWidthResizeObserver.getWidth();
			let realContentHeight = templateData.editor!.getContentHeight();
			templateData.editor?.layout(
				{
					width: newWidth,
					height: realContentHeight
				}
			);

			viewCell.editorHeight = realContentHeight;
		});

		cellWidthResizeObserver.startObserving();
		this._register(cellWidthResizeObserver);

		this._register(templateData.editor!.onDidContentSizeChange((e) => {
			if (e.contentHeightChanged) {
				if (this.viewCell.layoutInfo.editorHeight !== e.contentHeight) {
					let viewLayout = templateData.editor!.getLayoutInfo();

					templateData.editor?.layout(
						{
							width: viewLayout.width,
							height: e.contentHeight
						}
					);

					this.viewCell.editorHeight = e.contentHeight;
					this.relayoutCell();
				}

			}
		}));

		this._register(templateData.editor!.onDidChangeCursorSelection((e) => {
			if (e.source === 'restoreState') {
				// do not reveal the cell into view if this selection change was caused by restoring editors...
				return;
			}

			const primarySelection = templateData.editor!.getSelection();

			if (primarySelection) {
				this.notebookEditor.revealLineInView(viewCell, primarySelection!.positionLineNumber);
			}
		}));

		this._register(viewCell.onDidChangeOutputs((splices) => {
			if (!splices.length) {
				return;
			}

			if (this.viewCell.outputs.length) {
				this.templateData.outputContainer!.style.display = 'block';
			} else {
				this.templateData.outputContainer!.style.display = 'none';
			}

			let reversedSplices = splices.reverse();

			reversedSplices.forEach(splice => {
				viewCell.spliceOutputHeights(splice[0], splice[1], splice[2].map(_ => 0));
			});

			let removedKeys: IOutput[] = [];

			this.outputElements.forEach((value, key) => {
				if (viewCell.outputs.indexOf(key) < 0) {
					// already removed
					removedKeys.push(key);
					// remove element from DOM
					this.templateData?.outputContainer?.removeChild(value);
					this.notebookEditor.removeInset(key);
				}
			});

			removedKeys.forEach(key => {
				// remove element cache
				this.outputElements.delete(key);
				// remove elment resize listener if there is one
				this.outputResizeListeners.delete(key);
			});

			let prevElement: HTMLElement | undefined = undefined;

			this.viewCell.outputs.reverse().forEach(output => {
				if (this.outputElements.has(output)) {
					// already exist
					prevElement = this.outputElements.get(output);
					return;
				}

				// newly added element
				let currIndex = this.viewCell.outputs.indexOf(output);
				this.renderOutput(output, currIndex, prevElement);
				prevElement = this.outputElements.get(output);
			});

			let editorHeight = templateData.editor!.getContentHeight();
			viewCell.editorHeight = editorHeight;
			this.relayoutCellDebounced();
		}));

		if (viewCell.outputs.length > 0) {
			this.templateData.outputContainer!.style.display = 'block';
			// there are outputs, we need to calcualte their sizes and trigger relayout
			// @todo, if there is no resizable output, we should not check their height individually, which hurts the performance
			for (let index = 0; index < this.viewCell.outputs.length; index++) {
				const currOutput = this.viewCell.outputs[index];

				// always add to the end
				this.renderOutput(currOutput, index, undefined);
			}

			viewCell.editorHeight = totalHeight;
			this.relayoutCell();
		} else {
			// noop
			this.templateData.outputContainer!.style.display = 'none';
		}
	}

	renderOutput(currOutput: IOutput, index: number, beforeElement?: HTMLElement) {
		if (!this.outputResizeListeners.has(currOutput)) {
			this.outputResizeListeners.set(currOutput, new DisposableStore());
		}

		let outputItemDiv = document.createElement('div');
		let result: IRenderOutput | undefined = undefined;

		if (currOutput.outputKind === CellOutputKind.Rich) {
			let transformedDisplayOutput = currOutput as ITransformedDisplayOutputDto;

			if (transformedDisplayOutput.orderedMimeTypes.length > 1) {
				outputItemDiv.style.position = 'relative';
				const mimeTypePicker = DOM.$('.multi-mimetype-output');
				DOM.addClasses(mimeTypePicker, 'codicon', 'codicon-code');
				outputItemDiv.appendChild(mimeTypePicker);
				this.outputResizeListeners.get(currOutput)!.add(DOM.addStandardDisposableListener(mimeTypePicker, 'mousedown', async e => {
					e.preventDefault();
					e.stopPropagation();
					await this.pickActiveMimeTypeRenderer(transformedDisplayOutput);
				}));
			}
			let pickedMimeTypeRenderer = currOutput.orderedMimeTypes[currOutput.pickedMimeTypeIndex];

			if (pickedMimeTypeRenderer.isResolved) {
				// html
				result = this.notebookEditor.getOutputRenderer().render({ outputKind: CellOutputKind.Rich, data: { 'text/html': pickedMimeTypeRenderer.output! } } as any, outputItemDiv, 'text/html');
			} else {
				result = this.notebookEditor.getOutputRenderer().render(currOutput, outputItemDiv, pickedMimeTypeRenderer.mimeType);
			}
		} else {
			// for text and error, there is no mimetype
			result = this.notebookEditor.getOutputRenderer().render(currOutput, outputItemDiv, undefined);
		}

		if (!result) {
			this.viewCell.updateOutputHeight(index, 0);
			return;
		}

		this.outputElements.set(currOutput, outputItemDiv);

		if (beforeElement) {
			this.templateData.outputContainer?.insertBefore(outputItemDiv, beforeElement);
		} else {
			this.templateData.outputContainer?.appendChild(outputItemDiv);
		}

		if (result.shadowContent) {
			this.viewCell.selfSizeMonitoring = true;
			this.notebookEditor.createInset(this.viewCell, currOutput, result.shadowContent, this.viewCell.getOutputOffset(index));
		} else {
			DOM.addClass(outputItemDiv, 'foreground');
		}

		let hasDynamicHeight = result.hasDynamicHeight;

		if (hasDynamicHeight) {
			let clientHeight = outputItemDiv.clientHeight;
			let dimension = {
				width: this.viewCell.layoutInfo.editorWidth,
				height: clientHeight
			};
			const elementSizeObserver = getResizesObserver(outputItemDiv, dimension, () => {
				if (this.templateData.outputContainer && document.body.contains(this.templateData.outputContainer!)) {
					let height = elementSizeObserver.getHeight() + 8 * 2; // include padding

					if (clientHeight === height) {
						// console.log(this.viewCell.outputs);
						return;
					}

					const currIndex = this.viewCell.outputs.indexOf(currOutput);
					if (currIndex < 0) {
						return;
					}

					this.viewCell.updateOutputHeight(currIndex, height);
					this.relayoutCell();
				}
			});
			elementSizeObserver.startObserving();
			this.outputResizeListeners.get(currOutput)!.add(elementSizeObserver);
			this.viewCell.updateOutputHeight(index, clientHeight);
		} else {
			if (result.shadowContent) {
				// webview
				// noop
				// let cachedHeight = this.viewCell.getOutputHeight(currOutput);
			} else {
				// static output

				// @TODO, if we stop checking output height, we need to evaluate it later when checking the height of output container
				let clientHeight = outputItemDiv.clientHeight;
				this.viewCell.updateOutputHeight(index, clientHeight);
			}
		}
	}

	generateRendererInfo(renderId: number | undefined): string {
		if (renderId === undefined || renderId === -1) {
			return 'builtin';
		}

		let renderInfo = this.notebookService.getRendererInfo(renderId);

		if (renderInfo) {
			return renderInfo.id.value;
		}

		return 'builtin';
	}

	async pickActiveMimeTypeRenderer(output: ITransformedDisplayOutputDto) {
		let currIndex = output.pickedMimeTypeIndex;
		const items = output.orderedMimeTypes.map((mimeType, index): IMimeTypeRenderer => ({
			label: mimeType.mimeType,
			id: mimeType.mimeType,
			index: index,
			picked: index === currIndex,
			description: this.generateRendererInfo(mimeType.rendererId) + (index === currIndex
				? nls.localize('curruentActiveMimeType', " (Currently Active)")
				: ''),
		}));

		const picker = this.quickInputService.createQuickPick();
		picker.items = items;
		picker.activeItems = items.filter(item => !!item.picked);
		picker.placeholder = nls.localize('promptChooseMimeType.placeHolder', "Select output mimetype to render for current output");

		const pick = await new Promise<number | undefined>(resolve => {
			picker.onDidAccept(() => {
				resolve(picker.selectedItems.length === 1 ? (picker.selectedItems[0] as IMimeTypeRenderer).index : undefined);
				picker.dispose();
			});
			picker.show();
		});

		if (pick === undefined) {
			return;
		}

		if (pick !== currIndex) {
			// user chooses another mimetype
			let index = this.viewCell.outputs.indexOf(output);
			let nextElement = index + 1 < this.viewCell.outputs.length ? this.outputElements.get(this.viewCell.outputs[index + 1]) : undefined;
			this.outputResizeListeners.get(output)?.clear();
			let element = this.outputElements.get(output);
			if (element) {
				this.templateData?.outputContainer?.removeChild(element);
				this.notebookEditor.removeInset(output);
			}

			output.pickedMimeTypeIndex = pick;

			this.renderOutput(output, index, nextElement);
			this.relayoutCell();
		}
	}

	relayoutCell() {
		this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
	}

	@debounce(500)
	relayoutCellDebounced() {
		this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
	}

	dispose() {
		this.viewCell.detachTextEditor();
		this.outputResizeListeners.forEach((value) => {
			value.dispose();
		});

		this.templateData.focusIndicator!.style.height = 'initial';

		super.dispose();
	}
}

