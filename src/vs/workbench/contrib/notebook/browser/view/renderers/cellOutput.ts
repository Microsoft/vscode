/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import * as nls from 'vs/nls';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IQuickPickItem, IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { CodeCellRenderTemplate, INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { getResizesObserver } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellWidgets';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { ITransformedDisplayOutputDto, IRenderOutput, IProcessedOutput, RENDERER_NOT_AVAILABLE, BUILTIN_RENDERER_ID, RenderOutputType, outputHasDynamicHeight, CellUri, CellOutputKind, NotebookCellOutputsSplice, IInsetRenderOutput } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IMarkdownString } from 'vs/base/common/htmlContent';
import { renderMarkdown } from 'vs/base/browser/markdownRenderer';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { format } from 'vs/base/common/jsonFormatter';
import { applyEdits } from 'vs/base/common/jsonEdit';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { mimetypeIcon } from 'vs/workbench/contrib/notebook/browser/notebookIcons';

const OUTPUT_COUNT_LIMIT = 500;

interface IMimeTypeRenderer extends IQuickPickItem {
	index: number;
}

export class OutputElement extends Disposable {

	// this isn't super proper but I couldn't find a view-model equivalent for output
	// and it seems as of today we use the domain model - and pragamtically enrich it
	// with UX properties
	private pickedMimeTypes = new WeakMap<ITransformedDisplayOutputDto, number>();

	readonly resizeListener = new DisposableStore();
	domNode!: HTMLElement;
	renderResult?: IRenderOutput;

	constructor(
		private notebookEditor: INotebookEditor,
		private notebookService: INotebookService,
		private quickInputService: IQuickInputService,
		private viewCell: CodeCellViewModel,
		private outputContainer: HTMLElement,
		readonly output: IProcessedOutput
	) {
		super();
	}

	render(index: number, beforeElement?: HTMLElement) {
		if (this.viewCell.metadata.outputCollapsed) {
			return;
		}

		const outputItemDiv = document.createElement('div');
		let result: IRenderOutput | undefined = undefined;

		if (this.output.outputKind === CellOutputKind.Rich) {
			const transformedDisplayOutput = this.output as ITransformedDisplayOutputDto;

			const mimeTypes = this.notebookService.getMimeTypeInfo(this.notebookEditor.textModel!, this.output);

			// there is at least one mimetype which is safe and can be rendered by the core
			const pick = this.pickedMimeTypes.get(this.output) ?? Math.max(mimeTypes.findIndex(mimeType => mimeType.rendererId !== RENDERER_NOT_AVAILABLE && mimeType.isTrusted), 0);

			if (mimeTypes.length > 1) {
				outputItemDiv.style.position = 'relative';
				const mimeTypePicker = DOM.$('.multi-mimetype-output');
				mimeTypePicker.classList.add(...ThemeIcon.asClassNameArray(mimetypeIcon));
				mimeTypePicker.tabIndex = 0;
				mimeTypePicker.title = nls.localize('mimeTypePicker', "Choose a different output mimetype, available mimetypes: {0}", mimeTypes.map(mimeType => mimeType.mimeType).join(', '));
				outputItemDiv.appendChild(mimeTypePicker);
				this.resizeListener.add(DOM.addStandardDisposableListener(mimeTypePicker, 'mousedown', async e => {
					if (e.leftButton) {
						e.preventDefault();
						e.stopPropagation();
						await this.pickActiveMimeTypeRenderer(transformedDisplayOutput);
					}
				}));

				this.resizeListener.add((DOM.addDisposableListener(mimeTypePicker, DOM.EventType.KEY_DOWN, async e => {
					const event = new StandardKeyboardEvent(e);
					if ((event.equals(KeyCode.Enter) || event.equals(KeyCode.Space))) {
						e.preventDefault();
						e.stopPropagation();
						await this.pickActiveMimeTypeRenderer(transformedDisplayOutput);
					}
				})));

			}
			const pickedMimeTypeRenderer = mimeTypes[pick];

			const innerContainer = DOM.$('.output-inner-container');
			DOM.append(outputItemDiv, innerContainer);


			if (pickedMimeTypeRenderer.rendererId !== BUILTIN_RENDERER_ID) {
				const renderer = this.notebookService.getRendererInfo(pickedMimeTypeRenderer.rendererId);
				result = renderer
					? { type: RenderOutputType.Extension, renderer, source: this.output, mimeType: pickedMimeTypeRenderer.mimeType }
					: this.notebookEditor.getOutputRenderer().render(this.output, innerContainer, pickedMimeTypeRenderer.mimeType, this.getNotebookUri(),);
			} else {
				result = this.notebookEditor.getOutputRenderer().render(this.output, innerContainer, pickedMimeTypeRenderer.mimeType, this.getNotebookUri(),);
			}

			this.pickedMimeTypes.set(this.output, pick);
		} else {
			// for text and error, there is no mimetype
			const innerContainer = DOM.$('.output-inner-container');
			DOM.append(outputItemDiv, innerContainer);

			result = this.notebookEditor.getOutputRenderer().render(this.output, innerContainer, undefined, this.getNotebookUri(),);
		}

		this.domNode = outputItemDiv;
		this.renderResult = result;

		if (!result) {
			this.viewCell.updateOutputHeight(index, 0);
			return;
		}

		if (beforeElement) {
			this.outputContainer.insertBefore(outputItemDiv, beforeElement);
		} else {
			this.outputContainer.appendChild(outputItemDiv);
		}

		if (result.type !== RenderOutputType.None) {
			this.viewCell.selfSizeMonitoring = true;
			this.notebookEditor.createInset(this.viewCell, result as any, this.viewCell.getOutputOffset(index));
		} else {
			outputItemDiv.classList.add('foreground', 'output-element');
			outputItemDiv.style.position = 'absolute';
		}

		if (outputHasDynamicHeight(result)) {
			this.viewCell.selfSizeMonitoring = true;

			const clientHeight = outputItemDiv.clientHeight;
			const dimension = {
				width: this.viewCell.layoutInfo.editorWidth,
				height: clientHeight
			};
			const elementSizeObserver = getResizesObserver(outputItemDiv, dimension, () => {
				if (this.outputContainer && document.body.contains(this.outputContainer!)) {
					const height = Math.ceil(elementSizeObserver.getHeight());

					if (clientHeight === height) {
						return;
					}

					const currIndex = this.viewCell.outputs.indexOf(this.output);
					if (currIndex < 0) {
						return;
					}

					this.viewCell.updateOutputHeight(currIndex, height);
					this.relayoutCell();
				}
			});
			elementSizeObserver.startObserving();
			this.resizeListener.add(elementSizeObserver);
			this.viewCell.updateOutputHeight(index, clientHeight);
		} else if (result.type === RenderOutputType.None) { // no-op if it's a webview
			const clientHeight = Math.ceil(outputItemDiv.clientHeight);
			this.viewCell.updateOutputHeight(index, clientHeight);

			const top = this.viewCell.getOutputOffsetInContainer(index);
			outputItemDiv.style.top = `${top}px`;
		}
	}

	async pickActiveMimeTypeRenderer(output: ITransformedDisplayOutputDto) {

		const mimeTypes = this.notebookService.getMimeTypeInfo(this.notebookEditor.textModel!, output);
		const currIndex = this.pickedMimeTypes.get(output);

		// const currIndex = output.pickedMimeTypeIndex;
		const items = mimeTypes.filter(mimeType => mimeType.isTrusted).map((mimeType, index): IMimeTypeRenderer => ({
			label: mimeType.mimeType,
			id: mimeType.mimeType,
			index: index,
			picked: index === currIndex,
			detail: this.generateRendererInfo(mimeType.rendererId),
			description: index === currIndex ? nls.localize('curruentActiveMimeType', "Currently Active") : undefined
		}));

		const picker = this.quickInputService.createQuickPick();
		picker.items = items;
		picker.activeItems = items.filter(item => !!item.picked);
		picker.placeholder = items.length !== mimeTypes.length
			? nls.localize('promptChooseMimeTypeInSecure.placeHolder', "Select mimetype to render for current output. Rich mimetypes are available only when the notebook is trusted")
			: nls.localize('promptChooseMimeType.placeHolder', "Select mimetype to render for current output");

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
			const index = this.viewCell.outputs.indexOf(output);
			const nextElement = this.domNode.nextElementSibling;
			this.resizeListener.clear();
			const element = this.domNode;
			if (element) {
				element.parentElement?.removeChild(element);
				this.notebookEditor.removeInset(output);
			}

			this.pickedMimeTypes.set(output, pick);
			this.render(index, nextElement as HTMLElement);
			this.relayoutCell();
		}
	}

	private getNotebookUri(): URI | undefined {
		return CellUri.parse(this.viewCell.uri)?.notebook;
	}

	generateRendererInfo(renderId: string | undefined): string {
		if (renderId === undefined || renderId === BUILTIN_RENDERER_ID) {
			return nls.localize('builtinRenderInfo', "built-in");
		}

		const renderInfo = this.notebookService.getRendererInfo(renderId);

		if (renderInfo) {
			const displayName = renderInfo.displayName !== '' ? renderInfo.displayName : renderInfo.id;
			return `${displayName} (${renderInfo.extensionId.value})`;
		}

		return nls.localize('builtinRenderInfo', "built-in");
	}

	relayoutCell() {
		this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
	}
}

export class OutputContainer extends Disposable {
	private outputEntries = new Map<IProcessedOutput, OutputElement>();

	constructor(
		private notebookEditor: INotebookEditor,
		private viewCell: CodeCellViewModel,
		private templateData: CodeCellRenderTemplate,
		@INotebookService private notebookService: INotebookService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IOpenerService readonly openerService: IOpenerService,
		@ITextFileService readonly textFileService: ITextFileService,
	) {
		super();

		this._register(viewCell.onDidChangeOutputs(splices => {
			this._updateOutputs(splices);
		}));

		this._register(viewCell.onDidChangeLayout(() => {
			this.outputEntries.forEach((value, key) => {
				const index = viewCell.outputs.indexOf(key);
				if (index >= 0) {
					const top = this.viewCell.getOutputOffsetInContainer(index);
					value.domNode.style.top = `${top}px`;
				}
			});
		}));
	}

	render(editorHeight: number) {
		if (this.viewCell.outputs.length > 0) {
			let layoutCache = false;
			if (this.viewCell.layoutInfo.totalHeight !== 0 && this.viewCell.layoutInfo.editorHeight > editorHeight) {
				layoutCache = true;
				this._relayoutCell();
			}

			this.templateData.outputContainer.style.display = 'block';
			// there are outputs, we need to calcualte their sizes and trigger relayout
			// @TODO@rebornix, if there is no resizable output, we should not check their height individually, which hurts the performance
			const outputsToRender = this._calcuateOutputsToRender();
			for (let index = 0; index < outputsToRender.length; index++) {
				const currOutput = this.viewCell.outputs[index];

				// always add to the end
				this._renderOutput(currOutput, index, undefined);
			}

			this.viewCell.editorHeight = editorHeight;
			if (this.viewCell.outputs.length > OUTPUT_COUNT_LIMIT) {
				this.templateData.outputShowMoreContainer.style.display = 'block';
				this.viewCell.updateOutputShowMoreContainerHeight(46);
			}

			if (layoutCache) {
				this._relayoutCellDebounced();
			} else {
				this._relayoutCell();
			}
		} else {
			// noop
			this.viewCell.editorHeight = editorHeight;
			this._relayoutCell();
			this.templateData.outputContainer.style.display = 'none';
		}

		this.templateData.outputShowMoreContainer.innerText = '';
		this.templateData.outputShowMoreContainer.appendChild(this._generateShowMoreElement());
		// this.templateData.outputShowMoreContainer.style.top = `${this.viewCell.layoutInfo.outputShowMoreContainerOffset}px`;

		if (this.viewCell.outputs.length < OUTPUT_COUNT_LIMIT) {
			this.templateData.outputShowMoreContainer.style.display = 'none';
			this.viewCell.updateOutputShowMoreContainerHeight(0);
		}
	}

	viewUpdateShowOutputs(): void {
		for (let index = 0; index < this.viewCell.outputs.length; index++) {
			const currOutput = this.viewCell.outputs[index];

			const renderedOutput = this.outputEntries.get(currOutput);
			if (renderedOutput && renderedOutput.renderResult) {
				if (renderedOutput.renderResult.type !== RenderOutputType.None) {
					this.notebookEditor.createInset(this.viewCell, renderedOutput.renderResult as IInsetRenderOutput, this.viewCell.getOutputOffset(index));
				} else {
					// Anything else, just update the height
					this.viewCell.updateOutputHeight(index, renderedOutput.domNode.clientHeight);
				}
			} else {
				// Wasn't previously rendered, render it now
				this._renderOutput(currOutput, index);
			}
		}

		this._relayoutCell();
	}

	viewUpdateHideOuputs(): void {
		for (const e of this.outputEntries.keys()) {
			this.notebookEditor.hideInset(e);
		}
	}

	onCellWidthChange(): void {
		this.viewCell.outputs.forEach((o, i) => {
			const renderedOutput = this.outputEntries.get(o);
			if (renderedOutput && renderedOutput.renderResult && renderedOutput.renderResult.type === RenderOutputType.None && !renderedOutput.renderResult.hasDynamicHeight) {
				this.viewCell.updateOutputHeight(i, renderedOutput.domNode.clientHeight);
			}
		});
	}

	private _calcuateOutputsToRender() {
		const outputs = this.viewCell.outputs.slice(0, Math.min(OUTPUT_COUNT_LIMIT, this.viewCell.outputs.length));
		if (!this.notebookEditor.viewModel!.metadata.trusted) {
			// not trusted
			const secureOutput = outputs.filter(output => {
				switch (output.outputKind) {
					case CellOutputKind.Text:
						return true;
					case CellOutputKind.Error:
						return true;
					case CellOutputKind.Rich:
						{
							const mimeTypes = [];
							for (const property in output.data) {
								mimeTypes.push(property);
							}

							if (mimeTypes.indexOf('text/plain') >= 0
								|| mimeTypes.indexOf('text/markdown') >= 0
								|| mimeTypes.indexOf('application/json') >= 0
								|| mimeTypes.includes('image/png')) {
								return true;
							}

							return false;
						}
					default:
						return false;
				}
			});

			return secureOutput;
		}

		return outputs;
	}

	private _updateOutputs(splices: NotebookCellOutputsSplice[]) {
		if (!splices.length) {
			return;
		}

		const previousOutputHeight = this.viewCell.layoutInfo.outputTotalHeight;

		if (this.viewCell.outputs.length) {
			this.templateData.outputContainer.style.display = 'block';
		} else {
			this.templateData.outputContainer.style.display = 'none';
		}

		const reversedSplices = splices.reverse();

		reversedSplices.forEach(splice => {
			this.viewCell.spliceOutputHeights(splice[0], splice[1], splice[2].map(_ => 0));
		});

		const removedKeys: IProcessedOutput[] = [];

		this.outputEntries.forEach((value, key) => {
			if (this.viewCell.outputs.indexOf(key) < 0) {
				// already removed
				removedKeys.push(key);
				// remove element from DOM
				this.templateData?.outputContainer?.removeChild(value.domNode);
				this.notebookEditor.removeInset(key);
			}
		});

		removedKeys.forEach(key => {
			this.outputEntries.get(key)?.dispose();
			this.outputEntries.delete(key);
		});

		let prevElement: HTMLElement | undefined = undefined;
		const outputsToRender = this._calcuateOutputsToRender();

		outputsToRender.reverse().forEach(output => {
			if (this.outputEntries.has(output)) {
				// already exist
				prevElement = this.outputEntries.get(output)!.domNode;
				return;
			}

			// newly added element
			const currIndex = this.viewCell.outputs.indexOf(output);
			this._renderOutput(output, currIndex, prevElement);
			prevElement = this.outputEntries.get(output)?.domNode;
		});

		if (this.viewCell.outputs.length > OUTPUT_COUNT_LIMIT) {
			this.templateData.outputShowMoreContainer.style.display = 'block';
			this.viewCell.updateOutputShowMoreContainerHeight(46);
		} else {
			this.templateData.outputShowMoreContainer.style.display = 'none';
		}

		const editorHeight = this.templateData.editor.getContentHeight();
		this.viewCell.editorHeight = editorHeight;

		if (previousOutputHeight === 0 || this.viewCell.outputs.length === 0) {
			// first execution or removing all outputs
			this._relayoutCell();
		} else {
			this._relayoutCellDebounced();
		}
	}

	private _renderOutput(currOutput: IProcessedOutput, index: number, beforeElement?: HTMLElement) {
		if (!this.outputEntries.has(currOutput)) {
			this.outputEntries.set(currOutput, new OutputElement(this.notebookEditor, this.notebookService, this.quickInputService, this.viewCell, this.templateData.outputContainer, currOutput));
		}

		this.outputEntries.get(currOutput)!.render(index, beforeElement);
	}

	private _generateShowMoreElement(): any {
		const md: IMarkdownString = {
			value: `There are more than ${OUTPUT_COUNT_LIMIT} outputs, [show more (open the raw output data in a text editor) ...](command:workbench.action.openLargeOutput)`,
			isTrusted: true,
			supportThemeIcons: true
		};

		const element = renderMarkdown(md, {
			actionHandler: {
				callback: (content) => {
					if (content === 'command:workbench.action.openLargeOutput') {
						const content = JSON.stringify(this.viewCell.outputs.map(output => {
							switch (output.outputKind) {
								case CellOutputKind.Text:
									return {
										outputKind: 'text',
										text: output.text
									};
								case CellOutputKind.Error:
									return {
										outputKind: 'error',
										ename: output.ename,
										evalue: output.evalue,
										traceback: output.traceback
									};
								case CellOutputKind.Rich:
									return {
										data: output.data,
										metadata: output.metadata
									};
							}
						}));
						const edits = format(content, undefined, {});
						const metadataSource = applyEdits(content, edits);

						return this.textFileService.untitled.resolve({
							associatedResource: undefined,
							mode: 'json',
							initialValue: metadataSource
						}).then(model => {
							const resource = model.resource;
							this.openerService.open(resource);
						});
					}

					return;
				},
				disposeables: new DisposableStore()
			}
		});

		element.classList.add('output-show-more');
		return element;
	}

	private _relayoutCell() {
		if (this._timer !== null) {
			clearTimeout(this._timer);
		}

		this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
	}

	private _timer: number | null = null;

	private _relayoutCellDebounced() {
		if (this._timer !== null) {
			clearTimeout(this._timer);
		}

		this._timer = setTimeout(() => {
			this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
			this._timer = null;
		}, 200) as unknown as number | null;
	}

	dispose() {
		this.outputEntries.forEach((value) => {
			value.dispose();
		});

		super.dispose();
	}
}
