/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as DOM from 'vs/base/browser/dom';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IThemeService, registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { EditorOptions, IEditorOpenContext } from 'vs/workbench/common/editor';
import { notebookCellBorder, NotebookEditorWidget } from 'vs/workbench/contrib/notebook/browser/notebookEditorWidget';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { NotebookDiffEditorInput } from '../notebookDiffEditorInput';
import { CancellationToken } from 'vs/base/common/cancellation';
import { DiffElementViewModelBase, SideBySideDiffElementViewModel, SingleSideDiffElementViewModel } from 'vs/workbench/contrib/notebook/browser/diff/diffElementViewModel';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { CellDiffSideBySideRenderer, CellDiffSingleSideRenderer, NotebookCellTextDiffListDelegate, NotebookTextDiffList } from 'vs/workbench/contrib/notebook/browser/diff/notebookTextDiffList';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { diffDiagonalFill, diffInserted, diffRemoved, editorBackground, focusBorder, foreground } from 'vs/platform/theme/common/colorRegistry';
import { INotebookEditorWorkerService } from 'vs/workbench/contrib/notebook/common/services/notebookWorkerService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo, FontInfo } from 'vs/editor/common/config/fontInfo';
import { getPixelRatio, getZoomLevel } from 'vs/base/browser/browser';
import { CellEditState, ICellOutputViewModel, IDisplayOutputLayoutUpdateRequest, IGenericCellViewModel, IInsetRenderOutput, NotebookLayoutInfo, NOTEBOOK_DIFF_EDITOR_ID } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { DiffSide, DIFF_CELL_MARGIN, IDiffCellInfo, INotebookTextDiffEditor } from 'vs/workbench/contrib/notebook/browser/diff/notebookDiffEditorBrowser';
import { Emitter, Event } from 'vs/base/common/event';
import { DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { EditorPane } from 'vs/workbench/browser/parts/editor/editorPane';
import { CellUri, INotebookDiffEditorModel, INotebookDiffResult } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { URI } from 'vs/base/common/uri';
import { IDiffChange, IDiffResult } from 'vs/base/common/diff/diff';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { SequencerByKey } from 'vs/base/common/async';
import { generateUuid } from 'vs/base/common/uuid';
import { IMouseWheelEvent, StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { DiffNestedCellViewModel } from 'vs/workbench/contrib/notebook/browser/diff/diffNestedCellViewModel';
import { BackLayerWebView } from 'vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView';
import { CELL_OUTPUT_PADDING, MARKDOWN_PREVIEW_PADDING } from 'vs/workbench/contrib/notebook/browser/constants';
import { NotebookDiffEditorEventDispatcher, NotebookDiffLayoutChangedEvent } from 'vs/workbench/contrib/notebook/browser/diff/eventDispatcher';
import { readFontInfo } from 'vs/editor/browser/config/configuration';

const $ = DOM.$;

export class NotebookTextDiffEditor extends EditorPane implements INotebookTextDiffEditor {
	static readonly ID: string = NOTEBOOK_DIFF_EDITOR_ID;

	private _rootElement!: HTMLElement;
	private _overflowContainer!: HTMLElement;
	private _dimension: DOM.Dimension | null = null;
	private _diffElementViewModels: DiffElementViewModelBase[] = [];
	private _list!: NotebookTextDiffList;
	private _modifiedWebview: BackLayerWebView<IDiffCellInfo> | null = null;
	private _originalWebview: BackLayerWebView<IDiffCellInfo> | null = null;
	private _webviewTransparentCover: HTMLElement | null = null;
	private _fontInfo: FontInfo | undefined;

	private readonly _onMouseUp = this._register(new Emitter<{ readonly event: MouseEvent; readonly target: DiffElementViewModelBase; }>());
	public readonly onMouseUp = this._onMouseUp.event;
	private _eventDispatcher: NotebookDiffEditorEventDispatcher | undefined;
	protected _scopeContextKeyService!: IContextKeyService;
	private _model: INotebookDiffEditorModel | null = null;
	private readonly _modifiedResourceDisposableStore = this._register(new DisposableStore());
	private _outputRenderer: OutputRenderer;

	get textModel() {
		return this._model?.modified.notebook;
	}

	private _revealFirst: boolean;
	private readonly _insetModifyQueueByOutputId = new SequencerByKey<string>();

	protected _onDidDynamicOutputRendered = new Emitter<{ cell: IGenericCellViewModel, output: ICellOutputViewModel }>();
	onDidDynamicOutputRendered = this._onDidDynamicOutputRendered.event;

	private readonly _localStore = this._register(new DisposableStore());

	private _isDisposed: boolean = false;

	get isDisposed() {
		return this._isDisposed;
	}

	constructor(
		@IInstantiationService readonly instantiationService: IInstantiationService,
		@IThemeService themeService: IThemeService,
		@IContextKeyService readonly contextKeyService: IContextKeyService,
		@INotebookEditorWorkerService readonly notebookEditorWorkerService: INotebookEditorWorkerService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IStorageService storageService: IStorageService,
	) {
		super(NotebookTextDiffEditor.ID, telemetryService, themeService, storageService);
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this._fontInfo = readFontInfo(BareFontInfo.createFromRawSettings(editorOptions, getZoomLevel(), getPixelRatio()));
		this._revealFirst = true;

		this._outputRenderer = new OutputRenderer(this, this.instantiationService);
	}

	toggleNotebookCellSelection(cell: IGenericCellViewModel) {
		// throw new Error('Method not implemented.');
	}

	focusNotebookCell(cell: IGenericCellViewModel, focus: 'output' | 'editor' | 'container'): void {
		// throw new Error('Method not implemented.');
	}

	focusNextNotebookCell(cell: IGenericCellViewModel, focus: 'output' | 'editor' | 'container'): void {
		// throw new Error('Method not implemented.');
	}

	updateOutputHeight(cellInfo: IDiffCellInfo, output: ICellOutputViewModel, outputHeight: number, isInit: boolean): void {
		const diffElement = cellInfo.diffElement;
		const cell = this.getCellByInfo(cellInfo);
		const outputIndex = cell.outputsViewModels.indexOf(output);

		if (diffElement instanceof SideBySideDiffElementViewModel) {
			const info = CellUri.parse(cellInfo.cellUri);
			if (!info) {
				return;
			}

			diffElement.updateOutputHeight(info.notebook.toString() === this._model?.original.resource.toString() ? DiffSide.Original : DiffSide.Modified, outputIndex, outputHeight);
		} else {
			diffElement.updateOutputHeight(diffElement.type === 'insert' ? DiffSide.Modified : DiffSide.Original, outputIndex, outputHeight);
		}

		if (isInit) {
			this._onDidDynamicOutputRendered.fire({ cell, output });
		}
	}

	setMarkdownCellEditState(cellId: string, editState: CellEditState): void {
		// throw new Error('Method not implemented.');
	}
	markdownCellDragStart(cellId: string, position: { clientY: number }): void {
		// throw new Error('Method not implemented.');
	}
	markdownCellDrag(cellId: string, position: { clientY: number }): void {
		// throw new Error('Method not implemented.');
	}
	markdownCellDragEnd(cellId: string): void {
		// throw new Error('Method not implemented.');
	}
	markdownCellDrop(cellId: string) {
		// throw new Error('Method not implemented.');
	}

	protected createEditor(parent: HTMLElement): void {
		this._rootElement = DOM.append(parent, DOM.$('.notebook-text-diff-editor'));
		this._overflowContainer = document.createElement('div');
		this._overflowContainer.classList.add('notebook-overflow-widget-container', 'monaco-editor');
		DOM.append(parent, this._overflowContainer);

		const renderers = [
			this.instantiationService.createInstance(CellDiffSingleSideRenderer, this),
			this.instantiationService.createInstance(CellDiffSideBySideRenderer, this),
		];

		this._list = this.instantiationService.createInstance(
			NotebookTextDiffList,
			'NotebookTextDiff',
			this._rootElement,
			this.instantiationService.createInstance(NotebookCellTextDiffListDelegate),
			renderers,
			this.contextKeyService,
			{
				setRowLineHeight: false,
				setRowHeight: false,
				supportDynamicHeights: true,
				horizontalScrolling: false,
				keyboardSupport: false,
				mouseSupport: true,
				multipleSelectionSupport: false,
				enableKeyboardNavigation: true,
				additionalScrollHeight: 0,
				// transformOptimization: (isMacintosh && isNative) || getTitleBarStyle(this.configurationService, this.environmentService) === 'native',
				styleController: (_suffix: string) => { return this._list!; },
				overrideStyles: {
					listBackground: editorBackground,
					listActiveSelectionBackground: editorBackground,
					listActiveSelectionForeground: foreground,
					listFocusAndSelectionBackground: editorBackground,
					listFocusAndSelectionForeground: foreground,
					listFocusBackground: editorBackground,
					listFocusForeground: foreground,
					listHoverForeground: foreground,
					listHoverBackground: editorBackground,
					listHoverOutline: focusBorder,
					listFocusOutline: focusBorder,
					listInactiveSelectionBackground: editorBackground,
					listInactiveSelectionForeground: foreground,
					listInactiveFocusBackground: editorBackground,
					listInactiveFocusOutline: editorBackground,
				},
				accessibilityProvider: {
					getAriaLabel() { return null; },
					getWidgetAriaLabel() {
						return nls.localize('notebookTreeAriaLabel', "Notebook Text Diff");
					}
				},
				// focusNextPreviousDelegate: {
				// 	onFocusNext: (applyFocusNext: () => void) => this._updateForCursorNavigationMode(applyFocusNext),
				// 	onFocusPrevious: (applyFocusPrevious: () => void) => this._updateForCursorNavigationMode(applyFocusPrevious),
				// }
			}
		);

		this._register(this._list);

		this._register(this._list.onMouseUp(e => {
			if (e.element) {
				this._onMouseUp.fire({ event: e.browserEvent, target: e.element });
			}
		}));

		// transparent cover
		this._webviewTransparentCover = DOM.append(this._list.rowsContainer, $('.webview-cover'));
		this._webviewTransparentCover.style.display = 'none';

		this._register(DOM.addStandardDisposableGenericMouseDownListner(this._overflowContainer, (e: StandardMouseEvent) => {
			if (e.target.classList.contains('slider') && this._webviewTransparentCover) {
				this._webviewTransparentCover.style.display = 'block';
			}
		}));

		this._register(DOM.addStandardDisposableGenericMouseUpListner(this._overflowContainer, () => {
			if (this._webviewTransparentCover) {
				// no matter when
				this._webviewTransparentCover.style.display = 'none';
			}
		}));

		this._register(this._list.onDidScroll(e => {
			this._webviewTransparentCover!.style.top = `${e.scrollTop}px`;
		}));


	}

	private _updateOutputsOffsetsInWebview(scrollTop: number, scrollHeight: number, activeWebview: BackLayerWebView<IDiffCellInfo>, getActiveNestedCell: (diffElement: DiffElementViewModelBase) => DiffNestedCellViewModel | undefined, diffSide: DiffSide) {
		activeWebview.element.style.height = `${scrollHeight}px`;

		if (activeWebview.insetMapping) {
			const updateItems: IDisplayOutputLayoutUpdateRequest[] = [];
			const removedItems: ICellOutputViewModel[] = [];
			activeWebview.insetMapping.forEach((value, key) => {
				const cell = getActiveNestedCell(value.cellInfo.diffElement);
				if (!cell) {
					return;
				}

				const viewIndex = this._list.indexOf(value.cellInfo.diffElement);

				if (viewIndex === undefined) {
					return;
				}

				if (cell.outputsViewModels.indexOf(key) < 0) {
					// output is already gone
					removedItems.push(key);
				} else {
					const cellTop = this._list.getAbsoluteTopOfElement(value.cellInfo.diffElement);
					const outputIndex = cell.outputsViewModels.indexOf(key);
					const outputOffset = value.cellInfo.diffElement.getOutputOffsetInCell(diffSide, outputIndex);
					updateItems.push({
						cell,
						output: key,
						cellTop: cellTop,
						outputOffset: outputOffset,
						forceDisplay: false
					});
				}

			});

			activeWebview.removeInsets(removedItems);

			if (updateItems.length) {
				activeWebview.updateScrollTops(updateItems, []);
			}
		}
	}

	override async setInput(input: NotebookDiffEditorInput, options: EditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		await super.setInput(input, options, context, token);

		const model = await input.resolve();
		if (this._model !== model) {
			this._detachModel();
			this._model = model;
			this._attachModel();
		}

		this._model = model;
		if (this._model === null) {
			return;
		}

		this._revealFirst = true;

		this._modifiedResourceDisposableStore.clear();

		this._modifiedResourceDisposableStore.add(Event.any(this._model.original.notebook.onDidChangeContent, this._model.modified.notebook.onDidChangeContent)(e => {
			if (this._model !== null) {
				this.updateLayout();
			}
		}));

		await this._createOriginalWebview(generateUuid(), this._model.original.resource);
		if (this._originalWebview) {
			this._modifiedResourceDisposableStore.add(this._originalWebview);
		}
		await this._createModifiedWebview(generateUuid(), this._model.modified.resource);
		if (this._modifiedWebview) {
			this._modifiedResourceDisposableStore.add(this._modifiedWebview);
		}

		await this.updateLayout();
	}

	private _detachModel() {
		this._localStore.clear();
		this._originalWebview?.dispose();
		this._originalWebview?.element.remove();
		this._originalWebview = null;
		this._modifiedWebview?.dispose();
		this._modifiedWebview?.element.remove();
		this._modifiedWebview = null;

		this._modifiedResourceDisposableStore.clear();
		this._list.clear();

	}
	private _attachModel() {
		this._eventDispatcher = new NotebookDiffEditorEventDispatcher();
		const updateInsets = () => {
			DOM.scheduleAtNextAnimationFrame(() => {
				if (this._isDisposed) {
					return;
				}

				if (this._modifiedWebview) {
					this._updateOutputsOffsetsInWebview(this._list.scrollTop, this._list.scrollHeight, this._modifiedWebview, (diffElement: DiffElementViewModelBase) => {
						return diffElement.modified;
					}, DiffSide.Modified);
				}

				if (this._originalWebview) {
					this._updateOutputsOffsetsInWebview(this._list.scrollTop, this._list.scrollHeight, this._originalWebview, (diffElement: DiffElementViewModelBase) => {
						return diffElement.original;
					}, DiffSide.Original);
				}
			});
		};

		this._localStore.add(this._list.onDidChangeContentHeight(() => {
			updateInsets();
		}));

		this._localStore.add(this._eventDispatcher.onDidChangeCellLayout(() => {
			updateInsets();
		}));
	}

	private readonly webviewOptions = {
		outputNodePadding: CELL_OUTPUT_PADDING,
		outputNodeLeftPadding: 32,
		previewNodePadding: MARKDOWN_PREVIEW_PADDING,
		leftMargin: 0,
		rightMargin: 0,
		runGutter: 0
	};

	private async _createModifiedWebview(id: string, resource: URI): Promise<void> {
		if (this._modifiedWebview) {
			this._modifiedWebview.dispose();
		}

		this._modifiedWebview = this.instantiationService.createInstance(BackLayerWebView, this, id, resource, this.webviewOptions) as BackLayerWebView<IDiffCellInfo>;
		// attach the webview container to the DOM tree first
		this._list.rowsContainer.insertAdjacentElement('afterbegin', this._modifiedWebview.element);
		await this._modifiedWebview.createWebview();
		this._modifiedWebview.element.style.width = `calc(50% - 16px)`;
		this._modifiedWebview.element.style.left = `calc(50%)`;
	}

	private async _createOriginalWebview(id: string, resource: URI): Promise<void> {
		if (this._originalWebview) {
			this._originalWebview.dispose();
		}

		this._originalWebview = this.instantiationService.createInstance(BackLayerWebView, this, id, resource, this.webviewOptions) as BackLayerWebView<IDiffCellInfo>;
		// attach the webview container to the DOM tree first
		this._list.rowsContainer.insertAdjacentElement('afterbegin', this._originalWebview.element);
		await this._originalWebview.createWebview();
		this._originalWebview.element.style.width = `calc(50% - 16px)`;
		this._originalWebview.element.style.left = `16px`;
	}

	async updateLayout() {
		if (!this._model) {
			return;
		}

		const diffResult = await this.notebookEditorWorkerService.computeDiff(this._model.original.resource, this._model.modified.resource);
		NotebookTextDiffEditor.prettyChanges(this._model, diffResult.cellsDiff);
		const { viewModels, firstChangeIndex } = NotebookTextDiffEditor.computeDiff(this.instantiationService, this._model, this._eventDispatcher!, diffResult);

		this._originalWebview?.removeInsets([...this._originalWebview?.insetMapping.keys()]);
		this._modifiedWebview?.removeInsets([...this._modifiedWebview?.insetMapping.keys()]);

		this._diffElementViewModels = viewModels;
		this._list.splice(0, this._list.length, this._diffElementViewModels);

		if (this._revealFirst && firstChangeIndex !== -1) {
			this._revealFirst = false;
			this._list.setFocus([firstChangeIndex]);
			this._list.reveal(firstChangeIndex, 0.3);
		}
	}

	/**
	 * making sure that swapping cells are always translated to `insert+delete`.
	 */
	static prettyChanges(model: INotebookDiffEditorModel, diffResult: IDiffResult) {
		const changes = diffResult.changes;
		for (let i = 0; i < diffResult.changes.length - 1; i++) {
			// then we know there is another change after current one
			const curr = changes[i];
			const next = changes[i + 1];
			const x = curr.originalStart;
			const y = curr.modifiedStart;

			if (
				curr.originalLength === 1
				&& curr.modifiedLength === 0
				&& next.originalStart === x + 2
				&& next.originalLength === 0
				&& next.modifiedStart === y + 1
				&& next.modifiedLength === 1
				&& model.original.notebook.cells[x].getHashValue() === model.modified.notebook.cells[y + 1].getHashValue()
				&& model.original.notebook.cells[x + 1].getHashValue() === model.modified.notebook.cells[y].getHashValue()
			) {
				// this is a swap
				curr.originalStart = x;
				curr.originalLength = 0;
				curr.modifiedStart = y;
				curr.modifiedLength = 1;

				next.originalStart = x + 1;
				next.originalLength = 1;
				next.modifiedStart = y + 2;
				next.modifiedLength = 0;

				i++;
			}
		}
	}

	static computeDiff(instantiationService: IInstantiationService, model: INotebookDiffEditorModel, eventDispatcher: NotebookDiffEditorEventDispatcher, diffResult: INotebookDiffResult) {
		const cellChanges = diffResult.cellsDiff.changes;
		const diffElementViewModels: DiffElementViewModelBase[] = [];
		const originalModel = model.original.notebook;
		const modifiedModel = model.modified.notebook;
		let originalCellIndex = 0;
		let modifiedCellIndex = 0;

		let firstChangeIndex = -1;

		for (let i = 0; i < cellChanges.length; i++) {
			const change = cellChanges[i];
			// common cells

			for (let j = 0; j < change.originalStart - originalCellIndex; j++) {
				const originalCell = originalModel.cells[originalCellIndex + j];
				const modifiedCell = modifiedModel.cells[modifiedCellIndex + j];
				if (originalCell.getHashValue() === modifiedCell.getHashValue()) {
					diffElementViewModels.push(new SideBySideDiffElementViewModel(
						model.modified.notebook,
						model.original.notebook,
						instantiationService.createInstance(DiffNestedCellViewModel, originalCell),
						instantiationService.createInstance(DiffNestedCellViewModel, modifiedCell),
						'unchanged',
						eventDispatcher
					));
				} else {
					if (firstChangeIndex === -1) {
						firstChangeIndex = diffElementViewModels.length;
					}

					diffElementViewModels.push(new SideBySideDiffElementViewModel(
						model.modified.notebook,
						model.original.notebook,
						instantiationService.createInstance(DiffNestedCellViewModel, originalCell),
						instantiationService.createInstance(DiffNestedCellViewModel, modifiedCell),
						'modified',
						eventDispatcher!
					));
				}
			}

			const modifiedLCS = NotebookTextDiffEditor.computeModifiedLCS(instantiationService, change, originalModel, modifiedModel, eventDispatcher);
			if (modifiedLCS.length && firstChangeIndex === -1) {
				firstChangeIndex = diffElementViewModels.length;
			}

			diffElementViewModels.push(...modifiedLCS);
			originalCellIndex = change.originalStart + change.originalLength;
			modifiedCellIndex = change.modifiedStart + change.modifiedLength;
		}

		for (let i = originalCellIndex; i < originalModel.cells.length; i++) {
			diffElementViewModels.push(new SideBySideDiffElementViewModel(
				model.modified.notebook,
				model.original.notebook,
				instantiationService.createInstance(DiffNestedCellViewModel, originalModel.cells[i]),
				instantiationService.createInstance(DiffNestedCellViewModel, modifiedModel.cells[i - originalCellIndex + modifiedCellIndex]),
				'unchanged',
				eventDispatcher
			));
		}

		return {
			viewModels: diffElementViewModels,
			firstChangeIndex
		};
	}

	static computeModifiedLCS(instantiationService: IInstantiationService, change: IDiffChange, originalModel: NotebookTextModel, modifiedModel: NotebookTextModel, eventDispatcher: NotebookDiffEditorEventDispatcher) {
		const result: DiffElementViewModelBase[] = [];
		// modified cells
		const modifiedLen = Math.min(change.originalLength, change.modifiedLength);

		for (let j = 0; j < modifiedLen; j++) {
			const isTheSame = originalModel.cells[change.originalStart + j].getHashValue() === modifiedModel.cells[change.modifiedStart + j].getHashValue();
			result.push(new SideBySideDiffElementViewModel(
				modifiedModel,
				originalModel,
				instantiationService.createInstance(DiffNestedCellViewModel, originalModel.cells[change.originalStart + j]),
				instantiationService.createInstance(DiffNestedCellViewModel, modifiedModel.cells[change.modifiedStart + j]),
				isTheSame ? 'unchanged' : 'modified',
				eventDispatcher
			));
		}

		for (let j = modifiedLen; j < change.originalLength; j++) {
			// deletion
			result.push(new SingleSideDiffElementViewModel(
				originalModel,
				modifiedModel,
				instantiationService.createInstance(DiffNestedCellViewModel, originalModel.cells[change.originalStart + j]),
				undefined,
				'delete',
				eventDispatcher
			));
		}

		for (let j = modifiedLen; j < change.modifiedLength; j++) {
			// insertion
			result.push(new SingleSideDiffElementViewModel(
				modifiedModel,
				originalModel,
				undefined,
				instantiationService.createInstance(DiffNestedCellViewModel, modifiedModel.cells[change.modifiedStart + j]),
				'insert',
				eventDispatcher
			));
		}

		return result;
	}

	scheduleOutputHeightAck(cellInfo: IDiffCellInfo, outputId: string, height: number) {
		const diffElement = cellInfo.diffElement;
		// const activeWebview = diffSide === DiffSide.Modified ? this._modifiedWebview : this._originalWebview;
		let diffSide = DiffSide.Original;

		if (diffElement instanceof SideBySideDiffElementViewModel) {
			const info = CellUri.parse(cellInfo.cellUri);
			if (!info) {
				return;
			}

			diffSide = info.notebook.toString() === this._model?.original.resource.toString() ? DiffSide.Original : DiffSide.Modified;
		} else {
			diffSide = diffElement.type === 'insert' ? DiffSide.Modified : DiffSide.Original;
		}

		const webview = diffSide === DiffSide.Modified ? this._modifiedWebview : this._originalWebview;

		DOM.scheduleAtNextAnimationFrame(() => {
			webview?.ackHeight(cellInfo.cellId, outputId, height);
		}, 10);
	}

	private pendingLayouts = new WeakMap<DiffElementViewModelBase, IDisposable>();


	layoutNotebookCell(cell: DiffElementViewModelBase, height: number) {
		const relayout = (cell: DiffElementViewModelBase, height: number) => {
			this._list.updateElementHeight2(cell, height);
		};

		if (this.pendingLayouts.has(cell)) {
			this.pendingLayouts.get(cell)!.dispose();
		}

		let r: () => void;
		const layoutDisposable = DOM.scheduleAtNextAnimationFrame(() => {
			this.pendingLayouts.delete(cell);

			relayout(cell, height);
			r();
		});

		this.pendingLayouts.set(cell, toDisposable(() => {
			layoutDisposable.dispose();
			r();
		}));

		return new Promise<void>(resolve => { r = resolve; });
	}

	triggerScroll(event: IMouseWheelEvent) {
		this._list.triggerScrollFromMouseWheelEvent(event);
	}

	createOutput(cellDiffViewModel: DiffElementViewModelBase, cellViewModel: DiffNestedCellViewModel, output: IInsetRenderOutput, getOffset: () => number, diffSide: DiffSide): void {
		this._insetModifyQueueByOutputId.queue(output.source.model.outputId + (diffSide === DiffSide.Modified ? '-right' : 'left'), async () => {
			const activeWebview = diffSide === DiffSide.Modified ? this._modifiedWebview : this._originalWebview;
			if (!activeWebview) {
				return;
			}

			if (!activeWebview.insetMapping.has(output.source)) {
				const cellTop = this._list.getAbsoluteTopOfElement(cellDiffViewModel);
				await activeWebview.createOutput({ diffElement: cellDiffViewModel, cellHandle: cellViewModel.handle, cellId: cellViewModel.id, cellUri: cellViewModel.uri }, output, cellTop, getOffset());
			} else {
				const cellTop = this._list.getAbsoluteTopOfElement(cellDiffViewModel);
				const outputIndex = cellViewModel.outputsViewModels.indexOf(output.source);
				const outputOffset = cellDiffViewModel.getOutputOffsetInCell(diffSide, outputIndex);
				activeWebview.updateScrollTops([{
					cell: cellViewModel,
					output: output.source,
					cellTop,
					outputOffset,
					forceDisplay: true
				}], []);
			}
		});
	}

	updateMarkdownCellHeight() {
		// TODO
	}

	getCellByInfo(cellInfo: IDiffCellInfo): IGenericCellViewModel {
		return cellInfo.diffElement.getCellByUri(cellInfo.cellUri);
	}

	getCellById(cellId: string): IGenericCellViewModel | undefined {
		throw new Error('Not implemented');
	}

	removeInset(cellDiffViewModel: DiffElementViewModelBase, cellViewModel: DiffNestedCellViewModel, displayOutput: ICellOutputViewModel, diffSide: DiffSide) {
		this._insetModifyQueueByOutputId.queue(displayOutput.model.outputId + (diffSide === DiffSide.Modified ? '-right' : 'left'), async () => {
			const activeWebview = diffSide === DiffSide.Modified ? this._modifiedWebview : this._originalWebview;
			if (!activeWebview) {
				return;
			}

			if (!activeWebview.insetMapping.has(displayOutput)) {
				return;
			}

			activeWebview.removeInsets([displayOutput]);
		});
	}

	showInset(cellDiffViewModel: DiffElementViewModelBase, cellViewModel: DiffNestedCellViewModel, displayOutput: ICellOutputViewModel, diffSide: DiffSide) {
		this._insetModifyQueueByOutputId.queue(displayOutput.model.outputId + (diffSide === DiffSide.Modified ? '-right' : 'left'), async () => {
			const activeWebview = diffSide === DiffSide.Modified ? this._modifiedWebview : this._originalWebview;
			if (!activeWebview) {
				return;
			}

			if (!activeWebview.insetMapping.has(displayOutput)) {
				return;
			}

			const cellTop = this._list.getAbsoluteTopOfElement(cellDiffViewModel);
			const outputIndex = cellViewModel.outputsViewModels.indexOf(displayOutput);
			const outputOffset = cellDiffViewModel.getOutputOffsetInCell(diffSide, outputIndex);
			activeWebview.updateScrollTops([{
				cell: cellViewModel,
				output: displayOutput,
				cellTop,
				outputOffset,
				forceDisplay: true,
			}], []);
		});
	}

	hideInset(cellDiffViewModel: DiffElementViewModelBase, cellViewModel: DiffNestedCellViewModel, output: ICellOutputViewModel) {
		this._modifiedWebview?.hideInset(output);
		this._originalWebview?.hideInset(output);
	}

	// private async _resolveWebview(rightEditor: boolean): Promise<BackLayerWebView | null> {
	// 	if (rightEditor) {

	// 	}
	// }

	getDomNode() {
		return this._rootElement;
	}

	getOverflowContainerDomNode(): HTMLElement {
		return this._overflowContainer;
	}

	override getControl(): NotebookEditorWidget | undefined {
		return undefined;
	}

	override setEditorVisible(visible: boolean, group: IEditorGroup | undefined): void {
		super.setEditorVisible(visible, group);
	}

	override focus() {
		super.focus();
	}

	override clearInput(): void {
		super.clearInput();

		this._modifiedResourceDisposableStore.clear();
		this._list?.splice(0, this._list?.length || 0);
	}

	getOutputRenderer(): OutputRenderer {
		return this._outputRenderer;
	}

	deltaCellOutputContainerClassNames(diffSide: DiffSide, cellId: string, added: string[], removed: string[]) {
		if (diffSide === DiffSide.Original) {
			this._originalWebview?.deltaCellOutputContainerClassNames(cellId, added, removed);
		} else {
			this._modifiedWebview?.deltaCellOutputContainerClassNames(cellId, added, removed);
		}
	}

	getLayoutInfo(): NotebookLayoutInfo {
		if (!this._list) {
			throw new Error('Editor is not initalized successfully');
		}

		return {
			width: this._dimension!.width,
			height: this._dimension!.height,
			fontInfo: this._fontInfo!
		};
	}

	getCellOutputLayoutInfo(nestedCell: DiffNestedCellViewModel) {
		if (!this._model) {
			throw new Error('Editor is not attached to model yet');
		}
		const documentModel = CellUri.parse(nestedCell.uri);
		if (!documentModel) {
			throw new Error('Nested cell in the diff editor has wrong Uri');
		}

		const belongToOriginalDocument = this._model.original.notebook.uri.toString() === documentModel.notebook.toString();
		const viewModel = this._diffElementViewModels.find(element => {
			const textModel = belongToOriginalDocument ? element.original : element.modified;
			if (!textModel) {
				return false;
			}

			if (textModel.uri.toString() === nestedCell.uri.toString()) {
				return true;
			}

			return false;
		});

		if (!viewModel) {
			throw new Error('Nested cell in the diff editor does not match any diff element');
		}

		if (viewModel.type === 'unchanged') {
			return this.getLayoutInfo();
		}

		if (viewModel.type === 'insert' || viewModel.type === 'delete') {
			return {
				width: this._dimension!.width / 2,
				height: this._dimension!.height / 2,
				fontInfo: this._fontInfo!
			};
		}

		if (viewModel.checkIfOutputsModified()) {
			return {
				width: this._dimension!.width / 2,
				height: this._dimension!.height / 2,
				fontInfo: this._fontInfo!
			};
		} else {
			return this.getLayoutInfo();
		}
	}

	layout(dimension: DOM.Dimension): void {
		this._rootElement.classList.toggle('mid-width', dimension.width < 1000 && dimension.width >= 600);
		this._rootElement.classList.toggle('narrow-width', dimension.width < 600);
		this._dimension = dimension;
		this._rootElement.style.height = `${dimension.height}px`;

		this._list?.layout(this._dimension.height, this._dimension.width);


		if (this._modifiedWebview) {
			this._modifiedWebview.element.style.width = `calc(50% - 16px)`;
			this._modifiedWebview.element.style.left = `calc(50%)`;
		}

		if (this._originalWebview) {
			this._originalWebview.element.style.width = `calc(50% - 16px)`;
			this._originalWebview.element.style.left = `16px`;
		}

		if (this._webviewTransparentCover) {
			this._webviewTransparentCover.style.height = `${dimension.height}px`;
			this._webviewTransparentCover.style.width = `${dimension.width}px`;
		}

		this._eventDispatcher?.emit([new NotebookDiffLayoutChangedEvent({ width: true, fontInfo: true }, this.getLayoutInfo())]);
	}

	override dispose() {
		this._isDisposed = true;
		super.dispose();
	}
}

registerThemingParticipant((theme, collector) => {
	const cellBorderColor = theme.getColor(notebookCellBorder);
	if (cellBorderColor) {
		collector.addRule(`.notebook-text-diff-editor .cell-body .border-container .top-border { border-top: 1px solid ${cellBorderColor};}`);
		collector.addRule(`.notebook-text-diff-editor .cell-body .border-container .bottom-border { border-top: 1px solid ${cellBorderColor};}`);
		collector.addRule(`.notebook-text-diff-editor .cell-body .border-container .left-border { border-left: 1px solid ${cellBorderColor};}`);
		collector.addRule(`.notebook-text-diff-editor .cell-body .border-container .right-border { border-right: 1px solid ${cellBorderColor};}`);
		collector.addRule(`.notebook-text-diff-editor .cell-diff-editor-container .output-header-container,
		.notebook-text-diff-editor .cell-diff-editor-container .metadata-header-container {
			border-top: 1px solid ${cellBorderColor};
		}`);
	}

	const diffDiagonalFillColor = theme.getColor(diffDiagonalFill);
	collector.addRule(`
	.notebook-text-diff-editor .diagonal-fill {
		background-image: linear-gradient(
			-45deg,
			${diffDiagonalFillColor} 12.5%,
			#0000 12.5%, #0000 50%,
			${diffDiagonalFillColor} 50%, ${diffDiagonalFillColor} 62.5%,
			#0000 62.5%, #0000 100%
		);
		background-size: 8px 8px;
	}
	`);

	const added = theme.getColor(diffInserted);
	if (added) {
		collector.addRule(
			`
			.monaco-workbench .notebook-text-diff-editor .cell-body.full .output-info-container.modified .output-view-container .output-view-container-right div.foreground { background-color: ${added}; }
			.monaco-workbench .notebook-text-diff-editor .cell-body.right .output-info-container .output-view-container div.foreground { background-color: ${added}; }
			.monaco-workbench .notebook-text-diff-editor .cell-body.right .output-info-container .output-view-container div.output-empty-view { background-color: ${added}; }
			`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .source-container { background-color: ${added}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .source-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .source-container .monaco-editor .monaco-editor-background {
					background-color: ${added};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .metadata-editor-container { background-color: ${added}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .metadata-editor-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .metadata-editor-container .monaco-editor .monaco-editor-background {
					background-color: ${added};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .output-editor-container { background-color: ${added}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .output-editor-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .output-editor-container .monaco-editor .monaco-editor-background {
					background-color: ${added};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .metadata-header-container { background-color: ${added}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.inserted .output-header-container { background-color: ${added}; }
		`
		);
	}
	const removed = theme.getColor(diffRemoved);
	if (removed) {
		collector.addRule(
			`
			.monaco-workbench .notebook-text-diff-editor .cell-body.full .output-info-container.modified .output-view-container .output-view-container-left div.foreground { background-color: ${removed}; }
			.monaco-workbench .notebook-text-diff-editor .cell-body.left .output-info-container .output-view-container div.foreground { background-color: ${removed}; }
			.monaco-workbench .notebook-text-diff-editor .cell-body.left .output-info-container .output-view-container div.output-empty-view { background-color: ${removed}; }

			`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .source-container { background-color: ${removed}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .source-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .source-container .monaco-editor .monaco-editor-background {
					background-color: ${removed};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .metadata-editor-container { background-color: ${removed}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .metadata-editor-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .metadata-editor-container .monaco-editor .monaco-editor-background {
					background-color: ${removed};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .output-editor-container { background-color: ${removed}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .output-editor-container .monaco-editor .margin,
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .output-editor-container .monaco-editor .monaco-editor-background {
					background-color: ${removed};
			}
		`
		);
		collector.addRule(`
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .metadata-header-container { background-color: ${removed}; }
			.notebook-text-diff-editor .cell-body .cell-diff-editor-container.removed .output-header-container { background-color: ${removed}; }
		`
		);
	}

	// const changed = theme.getColor(editorGutterModifiedBackground);

	// if (changed) {
	// 	collector.addRule(`
	// 		.notebook-text-diff-editor .cell-diff-editor-container .metadata-header-container.modified {
	// 			background-color: ${changed};
	// 		}
	// 	`);
	// }

	collector.addRule(`.notebook-text-diff-editor .cell-body { margin: ${DIFF_CELL_MARGIN}px; }`);
});
