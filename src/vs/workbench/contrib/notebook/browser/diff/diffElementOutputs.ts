/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import * as nls from 'vs/nls';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { DiffElementViewModelBase, SideBySideDiffElementViewModel } from 'vs/workbench/contrib/notebook/browser/diff/diffElementViewModel';
import { DiffSide, INotebookTextDiffEditor } from 'vs/workbench/contrib/notebook/browser/diff/notebookDiffEditorBrowser';
import { ICellOutputViewModel, IRenderOutput, RenderOutputType } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { getResizesObserver } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellWidgets';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { BUILTIN_RENDERER_ID, NotebookCellOutputsSplice } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { DiffNestedCellViewModel } from 'vs/workbench/contrib/notebook/browser/diff/diffNestedCellViewModel';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { mimetypeIcon } from 'vs/workbench/contrib/notebook/browser/notebookIcons';
import { StandardKeyboardEvent } from 'vs/base/browser/keyboardEvent';
import { KeyCode } from 'vs/base/common/keyCodes';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';

interface IMimeTypeRenderer extends IQuickPickItem {
	index: number;
}

export class OutputElement extends Disposable {
	readonly resizeListener = new DisposableStore();
	domNode!: HTMLElement;
	renderResult?: IRenderOutput;

	constructor(
		private _notebookEditor: INotebookTextDiffEditor,
		private _notebookTextModel: NotebookTextModel,
		private _notebookService: INotebookService,
		private _quickInputService: IQuickInputService,
		private _diffElementViewModel: DiffElementViewModelBase,
		private _diffSide: DiffSide,
		private _nestedCell: DiffNestedCellViewModel,
		private _outputContainer: HTMLElement,
		readonly output: ICellOutputViewModel
	) {
		super();
	}

	render(index: number, beforeElement?: HTMLElement) {
		const outputItemDiv = document.createElement('div');
		let result: IRenderOutput | undefined = undefined;

		const [mimeTypes, pick] = this.output.resolveMimeTypes(this._notebookTextModel, undefined);
		const pickedMimeTypeRenderer = mimeTypes[pick];
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
					await this.pickActiveMimeTypeRenderer(this._notebookTextModel, this.output);
				}
			}));

			this.resizeListener.add((DOM.addDisposableListener(mimeTypePicker, DOM.EventType.KEY_DOWN, async e => {
				const event = new StandardKeyboardEvent(e);
				if ((event.equals(KeyCode.Enter) || event.equals(KeyCode.Space))) {
					e.preventDefault();
					e.stopPropagation();
					await this.pickActiveMimeTypeRenderer(this._notebookTextModel, this.output);
				}
			})));
		}

		const innerContainer = DOM.$('.output-inner-container');
		DOM.append(outputItemDiv, innerContainer);


		if (mimeTypes.length !== 0) {
			if (pickedMimeTypeRenderer.rendererId !== BUILTIN_RENDERER_ID) {
				const renderer = this._notebookService.getRendererInfo(pickedMimeTypeRenderer.rendererId);
				result = renderer
					? { type: RenderOutputType.Extension, renderer, source: this.output, mimeType: pickedMimeTypeRenderer.mimeType }
					: this._notebookEditor.getOutputRenderer().render(this.output, innerContainer, pickedMimeTypeRenderer.mimeType, this._notebookTextModel.uri,);
			} else {
				result = this._notebookEditor.getOutputRenderer().render(this.output, innerContainer, pickedMimeTypeRenderer.mimeType, this._notebookTextModel.uri);
			}

			this.output.pickedMimeType = pick;
		}

		this.domNode = outputItemDiv;
		this.renderResult = result;

		if (!result) {
			// this.viewCell.updateOutputHeight(index, 0);
			return;
		}

		if (beforeElement) {
			this._outputContainer.insertBefore(outputItemDiv, beforeElement);
		} else {
			this._outputContainer.appendChild(outputItemDiv);
		}

		if (result.type !== RenderOutputType.Mainframe) {
			// this.viewCell.selfSizeMonitoring = true;
			this._notebookEditor.createOutput(
				this._diffElementViewModel,
				this._nestedCell,
				result,
				() => this.getOutputOffsetInCell(index),
				this._diffElementViewModel instanceof SideBySideDiffElementViewModel
					? this._diffSide
					: this._diffElementViewModel.type === 'insert' ? DiffSide.Modified : DiffSide.Original
			);
		} else {
			outputItemDiv.classList.add('foreground', 'output-element');
			outputItemDiv.style.position = 'absolute';
		}
		if (result.type === RenderOutputType.Html || result.type === RenderOutputType.Extension) {
			return;
		}



		let clientHeight = Math.ceil(outputItemDiv.clientHeight);
		const elementSizeObserver = getResizesObserver(outputItemDiv, undefined, () => {
			if (this._outputContainer && document.body.contains(this._outputContainer)) {
				const height = Math.ceil(elementSizeObserver.getHeight());

				if (clientHeight === height) {
					return;
				}

				clientHeight = height;

				const currIndex = this.getCellOutputCurrentIndex();
				if (currIndex < 0) {
					return;
				}

				this.updateHeight(currIndex, height);
			}
		});
		elementSizeObserver.startObserving();
		this.resizeListener.add(elementSizeObserver);
		this.updateHeight(index, clientHeight);

		const top = this.getOutputOffsetInContainer(index);
		outputItemDiv.style.top = `${top}px`;
	}

	private async pickActiveMimeTypeRenderer(notebookTextModel: NotebookTextModel, viewModel: ICellOutputViewModel) {
		const [mimeTypes, currIndex] = viewModel.resolveMimeTypes(notebookTextModel, undefined);

		const items = mimeTypes.filter(mimeType => mimeType.isTrusted).map((mimeType, index): IMimeTypeRenderer => ({
			label: mimeType.mimeType,
			id: mimeType.mimeType,
			index: index,
			picked: index === currIndex,
			detail: this.generateRendererInfo(mimeType.rendererId),
			description: index === currIndex ? nls.localize('curruentActiveMimeType', "Currently Active") : undefined
		}));

		const picker = this._quickInputService.createQuickPick();
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
			const index = this._nestedCell.outputsViewModels.indexOf(viewModel);
			const nextElement = this.domNode.nextElementSibling;
			this.resizeListener.clear();
			const element = this.domNode;
			if (element) {
				element.parentElement?.removeChild(element);
				this._notebookEditor.removeInset(
					this._diffElementViewModel,
					this._nestedCell,
					viewModel,
					this._diffSide
				);
			}

			viewModel.pickedMimeType = pick;
			this.render(index, nextElement as HTMLElement);
		}
	}

	private generateRendererInfo(renderId: string | undefined): string {
		if (renderId === undefined || renderId === BUILTIN_RENDERER_ID) {
			return nls.localize('builtinRenderInfo', "built-in");
		}

		const renderInfo = this._notebookService.getRendererInfo(renderId);

		if (renderInfo) {
			const displayName = renderInfo.displayName !== '' ? renderInfo.displayName : renderInfo.id;
			return `${displayName} (${renderInfo.extensionId.value})`;
		}

		return nls.localize('builtinRenderInfo', "built-in");
	}

	getCellOutputCurrentIndex() {
		return this._diffElementViewModel.getNestedCellViewModel(this._diffSide).outputs.indexOf(this.output.model);
	}

	updateHeight(index: number, height: number) {
		this._diffElementViewModel.updateOutputHeight(this._diffSide, index, height);
	}

	getOutputOffsetInContainer(index: number) {
		return this._diffElementViewModel.getOutputOffsetInContainer(this._diffSide, index);
	}

	getOutputOffsetInCell(index: number) {
		return this._diffElementViewModel.getOutputOffsetInCell(this._diffSide, index);
	}
}

export class OutputContainer extends Disposable {
	private _outputEntries = new Map<ICellOutputViewModel, OutputElement>();
	constructor(
		private _editor: INotebookTextDiffEditor,
		private _notebookTextModel: NotebookTextModel,
		private _diffElementViewModel: DiffElementViewModelBase,
		private _nestedCellViewModel: DiffNestedCellViewModel,
		private _diffSide: DiffSide,
		private _outputContainer: HTMLElement,
		@INotebookService private _notebookService: INotebookService,
		@IQuickInputService private readonly _quickInputService: IQuickInputService,
		@IOpenerService readonly _openerService: IOpenerService,
		@ITextFileService readonly _textFileService: ITextFileService,

	) {
		super();
		this._register(this._diffElementViewModel.onDidLayoutChange(() => {
			this._outputEntries.forEach((value, key) => {
				const index = _nestedCellViewModel.outputs.indexOf(key.model);
				if (index >= 0) {
					const top = this._diffElementViewModel.getOutputOffsetInContainer(this._diffSide, index);
					value.domNode.style.top = `${top}px`;
				}
			});
		}));

		this._register(this._nestedCellViewModel.textModel.onDidChangeOutputs(splices => {
			this._updateOutputs(splices);
		}));
	}

	private _updateOutputs(splices: NotebookCellOutputsSplice[]) {
		if (!splices.length) {
			return;
		}

		const removedKeys: ICellOutputViewModel[] = [];

		this._outputEntries.forEach((value, key) => {
			if (this._nestedCellViewModel.outputsViewModels.indexOf(key) < 0) {
				// already removed
				removedKeys.push(key);
				// remove element from DOM
				this._outputContainer.removeChild(value.domNode);
				this._editor.removeInset(this._diffElementViewModel, this._nestedCellViewModel, key, this._diffSide);
			}
		});

		removedKeys.forEach(key => {
			this._outputEntries.get(key)?.dispose();
			this._outputEntries.delete(key);
		});

		let prevElement: HTMLElement | undefined = undefined;
		const outputsToRender = this._nestedCellViewModel.outputsViewModels;

		outputsToRender.reverse().forEach(output => {
			if (this._outputEntries.has(output)) {
				// already exist
				prevElement = this._outputEntries.get(output)!.domNode;
				return;
			}

			// newly added element
			const currIndex = this._nestedCellViewModel.outputsViewModels.indexOf(output);
			this._renderOutput(output, currIndex, prevElement);
			prevElement = this._outputEntries.get(output)?.domNode;
		});
	}
	render() {
		// TODO, outputs to render (should have a limit)
		for (let index = 0; index < this._nestedCellViewModel.outputsViewModels.length; index++) {
			const currOutput = this._nestedCellViewModel.outputsViewModels[index];

			// always add to the end
			this._renderOutput(currOutput, index, undefined);
		}
	}

	showOutputs() {
		for (let index = 0; index < this._nestedCellViewModel.outputsViewModels.length; index++) {
			const currOutput = this._nestedCellViewModel.outputsViewModels[index];
			// always add to the end
			this._editor.showInset(this._diffElementViewModel, currOutput.cellViewModel, currOutput, this._diffSide);
		}
	}

	hideOutputs() {
		this._outputEntries.forEach((outputElement, cellOutputViewModel) => {
			this._editor.hideInset(this._diffElementViewModel, this._nestedCellViewModel, cellOutputViewModel);
		});
	}

	private _renderOutput(currOutput: ICellOutputViewModel, index: number, beforeElement?: HTMLElement) {
		if (!this._outputEntries.has(currOutput)) {
			this._outputEntries.set(currOutput, new OutputElement(this._editor, this._notebookTextModel, this._notebookService, this._quickInputService, this._diffElementViewModel, this._diffSide, this._nestedCellViewModel, this._outputContainer, currOutput));
		}

		const renderElement = this._outputEntries.get(currOutput)!;
		renderElement.render(index, beforeElement);
	}
}
