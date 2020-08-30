/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { raceCancellation } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { KeyCode } from 'vs/base/common/keyCodes';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IDimension } from 'vs/editor/common/editorCommon';
import { IModeService } from 'vs/editor/common/services/modeService';
import * as nls from 'vs/nls';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { EDITOR_BOTTOM_PADDING, EDITOR_TOP_PADDING } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellFocusMode, CodeCellRenderTemplate, INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { getResizesObserver } from 'vs/workbench/contrib/notebook/browser/view/renderers/sizeObserver';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { BUILTIN_RENDERER_ID, CellOutputKind, CellUri, IInsetRenderOutput, IProcessedOutput, IRenderOutput, ITransformedDisplayOutputDto, outputHasDynamicHeight, RenderOutputType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';

interface IMimeTypeRenderer extends IQuickPickItem {
	index: number;
}

interface IRenderedOutput {
	element: HTMLElement;
	renderResult: IRenderOutput;
}

export class CodeCell extends Disposable {
	private outputResizeListeners = new Map<IProcessedOutput, DisposableStore>();
	private outputElements = new Map<IProcessedOutput, IRenderedOutput>();

	constructor(
		private notebookEditor: INotebookEditor,
		private viewCell: CodeCellViewModel,
		private templateData: CodeCellRenderTemplate,
		@INotebookService private notebookService: INotebookService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IModeService private readonly _modeService: IModeService
	) {
		super();

		const width = this.viewCell.layoutInfo.editorWidth;
		const lineNum = this.viewCell.lineCount;
		const lineHeight = this.viewCell.layoutInfo.fontInfo?.lineHeight || 17;
		const editorHeight = this.viewCell.layoutInfo.editorHeight === 0
			? lineNum * lineHeight + EDITOR_TOP_PADDING + EDITOR_BOTTOM_PADDING
			: this.viewCell.layoutInfo.editorHeight;

		this.layoutEditor(
			{
				width: width,
				height: editorHeight
			}
		);

		const cts = new CancellationTokenSource();
		this._register({ dispose() { cts.dispose(true); } });
		raceCancellation(viewCell.resolveTextModel(), cts.token).then(model => {
			if (model && templateData.editor) {
				templateData.editor.setModel(model);
				viewCell.attachTextEditor(templateData.editor);
				if (notebookEditor.getActiveCell() === viewCell && viewCell.focusMode === CellFocusMode.Editor && this.notebookEditor.hasFocus()) {
					templateData.editor?.focus();
				}

				const realContentHeight = templateData.editor?.getContentHeight();
				if (realContentHeight !== undefined && realContentHeight !== editorHeight) {
					this.onCellHeightChange(realContentHeight);
				}

				if (this.notebookEditor.getActiveCell() === this.viewCell && viewCell.focusMode === CellFocusMode.Editor && this.notebookEditor.hasFocus()) {
					templateData.editor?.focus();
				}
			}
		});

		const updateForFocusMode = () => {
			if (viewCell.focusMode === CellFocusMode.Editor) {
				templateData.editor?.focus();
			}

			DOM.toggleClass(templateData.container, 'cell-editor-focus', viewCell.focusMode === CellFocusMode.Editor);
		};
		const updateForCollapseState = () => {
			this.viewUpdate();
		};
		this._register(viewCell.onDidChangeState((e) => {
			if (e.focusModeChanged) {
				updateForFocusMode();
			}
		}));
		updateForFocusMode();

		templateData.editor?.updateOptions({ readOnly: !(viewCell.getEvaluatedMetadata(notebookEditor.viewModel!.metadata).editable) });
		this._register(viewCell.onDidChangeState((e) => {
			if (e.metadataChanged) {
				templateData.editor?.updateOptions({ readOnly: !(viewCell.getEvaluatedMetadata(notebookEditor.viewModel!.metadata).editable) });

				// TODO@rob this isn't nice
				this.viewCell.layoutChange({});
				updateForCollapseState();
				this.relayoutCell();
			}
		}));

		this._register(viewCell.onDidChangeState((e) => {
			if (e.languageChanged) {
				const mode = this._modeService.create(viewCell.language);
				templateData.editor?.getModel()?.setMode(mode.languageIdentifier);
			}
		}));

		this._register(viewCell.onDidChangeLayout((e) => {
			if (e.outerWidth !== undefined) {
				const layoutInfo = templateData.editor!.getLayoutInfo();
				if (layoutInfo.width !== viewCell.layoutInfo.editorWidth) {
					this.onCellWidthChange();
				}
			}
		}));

		this._register(templateData.editor!.onDidContentSizeChange((e) => {
			if (e.contentHeightChanged) {
				if (this.viewCell.layoutInfo.editorHeight !== e.contentHeight) {
					this.onCellHeightChange(e.contentHeight);
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
				this.notebookEditor.revealLineInViewAsync(viewCell, primarySelection!.positionLineNumber);
			}
		}));

		this._register(viewCell.onDidChangeOutputs((splices) => {
			if (!splices.length) {
				return;
			}

			const previousOutputHeight = this.viewCell.layoutInfo.outputTotalHeight;

			if (this.viewCell.outputs.length) {
				this.templateData.outputContainer!.style.display = 'block';
			} else {
				this.templateData.outputContainer!.style.display = 'none';
			}

			const reversedSplices = splices.reverse();

			reversedSplices.forEach(splice => {
				viewCell.spliceOutputHeights(splice[0], splice[1], splice[2].map(_ => 0));
			});

			const removedKeys: IProcessedOutput[] = [];

			this.outputElements.forEach((value, key) => {
				if (viewCell.outputs.indexOf(key) < 0) {
					// already removed
					removedKeys.push(key);
					// remove element from DOM
					this.templateData?.outputContainer?.removeChild(value.element);
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

			[...this.viewCell.outputs].reverse().forEach(output => {
				if (this.outputElements.has(output)) {
					// already exist
					prevElement = this.outputElements.get(output)!.element;
					return;
				}

				// newly added element
				const currIndex = this.viewCell.outputs.indexOf(output);
				this.renderOutput(output, currIndex, prevElement);
				prevElement = this.outputElements.get(output)?.element;
			});

			const editorHeight = templateData.editor!.getContentHeight();
			viewCell.editorHeight = editorHeight;

			if (previousOutputHeight === 0 || this.viewCell.outputs.length === 0) {
				// first execution or removing all outputs
				this.relayoutCell();
			} else {
				this.relayoutCellDebounced();
			}
		}));

		this._register(viewCell.onDidChangeLayout(() => {
			this.outputElements.forEach((value, key) => {
				const index = viewCell.outputs.indexOf(key);
				if (index >= 0) {
					const top = this.viewCell.getOutputOffsetInContainer(index);
					value.element.style.top = `${top}px`;
				}
			});

		}));

		this._register(viewCell.onCellDecorationsChanged((e) => {
			e.added.forEach(options => {
				if (options.className) {
					DOM.addClass(templateData.container, options.className);
				}

				if (options.outputClassName) {
					this.notebookEditor.deltaCellOutputContainerClassNames(this.viewCell.id, [options.outputClassName], []);
				}
			});

			e.removed.forEach(options => {
				if (options.className) {
					DOM.removeClass(templateData.container, options.className);
				}

				if (options.outputClassName) {
					this.notebookEditor.deltaCellOutputContainerClassNames(this.viewCell.id, [], [options.outputClassName]);
				}
			});
		}));
		// apply decorations

		viewCell.getCellDecorations().forEach(options => {
			if (options.className) {
				DOM.addClass(templateData.container, options.className);
			}

			if (options.outputClassName) {
				this.notebookEditor.deltaCellOutputContainerClassNames(this.viewCell.id, [options.outputClassName], []);
			}
		});

		this._register(templateData.editor!.onMouseDown(e => {
			// prevent default on right mouse click, otherwise it will trigger unexpected focus changes
			// the catch is, it means we don't allow customization of right button mouse down handlers other than the built in ones.
			if (e.event.rightButton) {
				e.event.preventDefault();
			}
		}));

		const updateFocusMode = () => viewCell.focusMode = templateData.editor!.hasWidgetFocus() ? CellFocusMode.Editor : CellFocusMode.Container;
		this._register(templateData.editor!.onDidFocusEditorWidget(() => {
			updateFocusMode();
		}));

		this._register(templateData.editor!.onDidBlurEditorWidget(() => {
			updateFocusMode();
		}));

		updateFocusMode();

		if (viewCell.outputs.length > 0) {
			let layoutCache = false;
			if (this.viewCell.layoutInfo.totalHeight !== 0 && this.viewCell.layoutInfo.editorHeight > editorHeight) {
				layoutCache = true;
				this.relayoutCell();
			}

			this.templateData.outputContainer!.style.display = 'block';
			// there are outputs, we need to calcualte their sizes and trigger relayout
			// @TODO@rebornix, if there is no resizable output, we should not check their height individually, which hurts the performance
			for (let index = 0; index < this.viewCell.outputs.length; index++) {
				const currOutput = this.viewCell.outputs[index];

				// always add to the end
				this.renderOutput(currOutput, index, undefined);
			}

			viewCell.editorHeight = editorHeight;
			if (layoutCache) {
				this.relayoutCellDebounced();
			} else {
				this.relayoutCell();
			}
		} else {
			// noop
			viewCell.editorHeight = editorHeight;
			this.relayoutCell();
			this.templateData.outputContainer!.style.display = 'none';
		}

		// Need to do this after the intial renderOutput
		updateForCollapseState();
	}

	private viewUpdate(): void {
		if (this.viewCell.metadata?.inputCollapsed && this.viewCell.metadata.outputCollapsed) {
			this.viewUpdateAllCollapsed();
		} else if (this.viewCell.metadata?.inputCollapsed) {
			this.viewUpdateInputCollapsed();
		} else if (this.viewCell.metadata?.outputCollapsed && this.viewCell.outputs.length) {
			this.viewUpdateOutputCollapsed();
		} else {
			this.viewUpdateExpanded();
		}
	}

	private viewUpdateShowOutputs(): void {
		for (let index = 0; index < this.viewCell.outputs.length; index++) {
			const currOutput = this.viewCell.outputs[index];

			const renderedOutput = this.outputElements.get(currOutput);
			if (renderedOutput) {
				if (renderedOutput.renderResult.type !== RenderOutputType.None) {
					this.notebookEditor.createInset(this.viewCell, renderedOutput.renderResult as IInsetRenderOutput, this.viewCell.getOutputOffset(index));
				} else {
					// Anything else, just update the height
					this.viewCell.updateOutputHeight(index, renderedOutput.element.clientHeight);
				}
			} else {
				// Wasn't previously rendered, render it now
				this.renderOutput(currOutput, index);
			}
		}

		this.relayoutCell();
	}

	private viewUpdateInputCollapsed(): void {
		DOM.hide(this.templateData.cellContainer);
		DOM.hide(this.templateData.runButtonContainer);
		DOM.show(this.templateData.collapsedPart);
		DOM.show(this.templateData.outputContainer);
		this.templateData.container.classList.toggle('collapsed', true);

		this.viewUpdateShowOutputs();

		this.relayoutCell();
	}

	private viewUpdateHideOuputs(): void {
		for (const e of this.outputElements.keys()) {
			this.notebookEditor.hideInset(e);
		}
	}

	private viewUpdateOutputCollapsed(): void {
		DOM.show(this.templateData.cellContainer);
		DOM.show(this.templateData.runButtonContainer);
		DOM.show(this.templateData.collapsedPart);
		DOM.hide(this.templateData.outputContainer);

		this.viewUpdateHideOuputs();

		this.templateData.container.classList.toggle('collapsed', false);
		this.templateData.container.classList.toggle('output-collapsed', true);

		this.relayoutCell();
	}

	private viewUpdateAllCollapsed(): void {
		DOM.hide(this.templateData.cellContainer);
		DOM.hide(this.templateData.runButtonContainer);
		DOM.show(this.templateData.collapsedPart);
		DOM.hide(this.templateData.outputContainer);
		this.templateData.container.classList.toggle('collapsed', true);
		this.templateData.container.classList.toggle('output-collapsed', true);

		for (const e of this.outputElements.keys()) {
			this.notebookEditor.hideInset(e);
		}

		this.relayoutCell();
	}

	private viewUpdateExpanded(): void {
		DOM.show(this.templateData.cellContainer);
		DOM.show(this.templateData.runButtonContainer);
		DOM.hide(this.templateData.collapsedPart);
		DOM.show(this.templateData.outputContainer);
		this.templateData.container.classList.toggle('collapsed', false);
		this.templateData.container.classList.toggle('output-collapsed', false);

		this.viewUpdateShowOutputs();

		this.relayoutCell();
	}

	private layoutEditor(dimension: IDimension): void {
		this.templateData.editor?.layout(dimension);
		this.templateData.statusBar.layout(dimension.width);
	}

	private onCellWidthChange(): void {
		const realContentHeight = this.templateData.editor!.getContentHeight();
		this.viewCell.editorHeight = realContentHeight;
		this.relayoutCell();

		this.layoutEditor(
			{
				width: this.viewCell.layoutInfo.editorWidth,
				height: realContentHeight
			}
		);

		// for contents for which we don't observe for dynamic height, update them manually
		this.viewCell.outputs.forEach((o, i) => {
			const renderedOutput = this.outputElements.get(o);
			if (renderedOutput && renderedOutput.renderResult.type === RenderOutputType.None && !renderedOutput.renderResult.hasDynamicHeight) {
				this.viewCell.updateOutputHeight(i, renderedOutput.element.clientHeight);
			}
		});
	}

	private onCellHeightChange(newHeight: number): void {
		const viewLayout = this.templateData.editor!.getLayoutInfo();
		this.viewCell.editorHeight = newHeight;
		this.relayoutCell();
		this.layoutEditor(
			{
				width: viewLayout.width,
				height: newHeight
			}
		);
	}

	private getNotebookUri(): URI | undefined {
		return CellUri.parse(this.viewCell.uri)?.notebook;
	}

	private renderOutput(currOutput: IProcessedOutput, index: number, beforeElement?: HTMLElement) {
		if (this.viewCell.metadata.outputCollapsed) {
			return;
		}

		if (!this.outputResizeListeners.has(currOutput)) {
			this.outputResizeListeners.set(currOutput, new DisposableStore());
		}

		const outputItemDiv = document.createElement('div');
		let result: IRenderOutput | undefined = undefined;

		if (currOutput.outputKind === CellOutputKind.Rich) {
			const transformedDisplayOutput = currOutput as ITransformedDisplayOutputDto;

			if (transformedDisplayOutput.orderedMimeTypes!.length > 1) {
				outputItemDiv.style.position = 'relative';
				const mimeTypePicker = DOM.$('.multi-mimetype-output');
				DOM.addClasses(mimeTypePicker, 'codicon', 'codicon-code');
				mimeTypePicker.tabIndex = 0;
				mimeTypePicker.title = nls.localize('mimeTypePicker', "Choose a different output mimetype, available mimetypes: {0}", transformedDisplayOutput.orderedMimeTypes!.map(mimeType => mimeType.mimeType).join(', '));
				outputItemDiv.appendChild(mimeTypePicker);
				this.outputResizeListeners.get(currOutput)!.add(DOM.addStandardDisposableListener(mimeTypePicker, 'mousedown', async e => {
					if (e.leftButton) {
						e.preventDefault();
						e.stopPropagation();
						await this.pickActiveMimeTypeRenderer(transformedDisplayOutput);
					}
				}));

				this.outputResizeListeners.get(currOutput)!.add((DOM.addDisposableListener(mimeTypePicker, DOM.EventType.KEY_DOWN, async e => {
					const event = new StandardKeyboardEvent(e);
					if ((event.equals(KeyCode.Enter) || event.equals(KeyCode.Space))) {
						e.preventDefault();
						e.stopPropagation();
						await this.pickActiveMimeTypeRenderer(transformedDisplayOutput);
					}
				})));

			}
			const pickedMimeTypeRenderer = currOutput.orderedMimeTypes![currOutput.pickedMimeTypeIndex!];

			const innerContainer = DOM.$('.output-inner-container');
			DOM.append(outputItemDiv, innerContainer);


			if (pickedMimeTypeRenderer.rendererId !== BUILTIN_RENDERER_ID) {
				const renderer = this.notebookService.getRendererInfo(pickedMimeTypeRenderer.rendererId);
				result = renderer
					? { type: RenderOutputType.Extension, renderer, source: currOutput, mimeType: pickedMimeTypeRenderer.mimeType }
					: this.notebookEditor.getOutputRenderer().render(currOutput, innerContainer, pickedMimeTypeRenderer.mimeType, this.getNotebookUri(),);
			} else {
				result = this.notebookEditor.getOutputRenderer().render(currOutput, innerContainer, pickedMimeTypeRenderer.mimeType, this.getNotebookUri(),);
			}
		} else {
			// for text and error, there is no mimetype
			const innerContainer = DOM.$('.output-inner-container');
			DOM.append(outputItemDiv, innerContainer);

			result = this.notebookEditor.getOutputRenderer().render(currOutput, innerContainer, undefined, this.getNotebookUri(),);
		}

		if (!result) {
			this.viewCell.updateOutputHeight(index, 0);
			return;
		}

		this.outputElements.set(currOutput, { element: outputItemDiv, renderResult: result });

		if (beforeElement) {
			this.templateData.outputContainer?.insertBefore(outputItemDiv, beforeElement);
		} else {
			this.templateData.outputContainer?.appendChild(outputItemDiv);
		}

		if (result.type !== RenderOutputType.None) {
			this.viewCell.selfSizeMonitoring = true;
			this.notebookEditor.createInset(this.viewCell, result as any, this.viewCell.getOutputOffset(index));
		} else {
			DOM.addClass(outputItemDiv, 'foreground');
			DOM.addClass(outputItemDiv, 'output-element');
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
				if (this.templateData.outputContainer && document.body.contains(this.templateData.outputContainer!)) {
					const height = Math.ceil(elementSizeObserver.getHeight());

					if (clientHeight === height) {
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
		} else if (result.type === RenderOutputType.None) { // no-op if it's a webview
			const clientHeight = Math.ceil(outputItemDiv.clientHeight);
			this.viewCell.updateOutputHeight(index, clientHeight);

			const top = this.viewCell.getOutputOffsetInContainer(index);
			outputItemDiv.style.top = `${top}px`;
		}
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

	async pickActiveMimeTypeRenderer(output: ITransformedDisplayOutputDto) {
		const currIndex = output.pickedMimeTypeIndex;
		const items = output.orderedMimeTypes!.map((mimeType, index): IMimeTypeRenderer => ({
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
			const index = this.viewCell.outputs.indexOf(output);
			const nextElement = index + 1 < this.viewCell.outputs.length ? this.outputElements.get(this.viewCell.outputs[index + 1])?.element : undefined;
			this.outputResizeListeners.get(output)?.clear();
			const element = this.outputElements.get(output)?.element;
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
		if (this._timer !== null) {
			clearTimeout(this._timer);
		}

		this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
	}

	private _timer: number | null = null;

	relayoutCellDebounced() {
		if (this._timer !== null) {
			clearTimeout(this._timer);
		}

		this._timer = setTimeout(() => {
			this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
			this._timer = null;
		}, 200) as unknown as number | null;
	}

	dispose() {
		this.viewCell.detachTextEditor();
		this.outputResizeListeners.forEach((value) => {
			value.dispose();
		});

		this.templateData.focusIndicatorLeft!.style.height = 'initial';

		super.dispose();
	}
}

