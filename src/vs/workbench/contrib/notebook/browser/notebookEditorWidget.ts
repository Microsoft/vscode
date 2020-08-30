/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getZoomLevel } from 'vs/base/browser/browser';
import * as DOM from 'vs/base/browser/dom';
import { IMouseWheelEvent, StandardMouseEvent } from 'vs/base/browser/mouseEvent';
import { IListContextMenuEvent } from 'vs/base/browser/ui/list/list';
import { IAction, Separator } from 'vs/base/common/actions';
import { SequencerByKey } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { Color, RGBA } from 'vs/base/common/color';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { combinedDisposable, Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ScrollEvent } from 'vs/base/common/scrollable';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import 'vs/css!./media/notebook';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { Range } from 'vs/editor/common/core/range';
import { IEditor } from 'vs/editor/common/editorCommon';
import * as nls from 'vs/nls';
import { IMenuService, MenuId } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILayoutService } from 'vs/platform/layout/browser/layoutService';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { contrastBorder, diffInserted, diffRemoved, editorBackground, errorForeground, focusBorder, foreground, listFocusBackground, listInactiveSelectionBackground, registerColor, scrollbarSliderActiveBackground, scrollbarSliderBackground, scrollbarSliderHoverBackground, textBlockQuoteBackground, textBlockQuoteBorder, textLinkActiveForeground, textLinkForeground, textPreformatForeground, transparent } from 'vs/platform/theme/common/colorRegistry';
import { registerThemingParticipant } from 'vs/platform/theme/common/themeService';
import { EditorMemento } from 'vs/workbench/browser/parts/editor/editorPane';
import { IEditorMemento } from 'vs/workbench/common/editor';
import { Memento, MementoObject } from 'vs/workbench/common/memento';
import { PANEL_BORDER } from 'vs/workbench/common/theme';
import { debugIconStartForeground } from 'vs/workbench/contrib/debug/browser/debugToolBar';
import { BOTTOM_CELL_TOOLBAR_GAP, BOTTOM_CELL_TOOLBAR_HEIGHT, CELL_BOTTOM_MARGIN, CELL_MARGIN, CELL_RUN_GUTTER, CELL_TOP_MARGIN, CODE_CELL_LEFT_MARGIN, COLLAPSED_INDICATOR_HEIGHT, SCROLLABLE_ELEMENT_PADDING_TOP } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellEditState, CellFocusMode, ICellViewModel, INotebookCellList, INotebookDeltaDecoration, INotebookEditor, INotebookEditorContribution, INotebookEditorContributionDescription, INotebookEditorCreationOptions, INotebookEditorMouseEvent, NotebookEditorOptions, NotebookLayoutInfo, NOTEBOOK_EDITOR_EDITABLE, NOTEBOOK_EDITOR_EXECUTING_NOTEBOOK, NOTEBOOK_EDITOR_FOCUSED, NOTEBOOK_EDITOR_RUNNABLE, NOTEBOOK_HAS_MULTIPLE_KERNELS, NOTEBOOK_OUTPUT_FOCUSED } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookEditorExtensionsRegistry } from 'vs/workbench/contrib/notebook/browser/notebookEditorExtensions';
import { NotebookKernelProviderAssociations, notebookKernelProviderAssociationsSettingId } from 'vs/workbench/contrib/notebook/browser/notebookKernelAssociation';
import { NotebookCellList } from 'vs/workbench/contrib/notebook/browser/view/notebookCellList';
import { OutputRenderer } from 'vs/workbench/contrib/notebook/browser/view/output/outputRenderer';
import { BackLayerWebView } from 'vs/workbench/contrib/notebook/browser/view/renderers/backLayerWebView';
import { CellContextKeyManager } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellContextKeys';
import { CodeCellRenderer, ListTopCellToolbar, MarkdownCellRenderer, NotebookCellListDelegate } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellRenderer';
import { CellDragAndDropController } from 'vs/workbench/contrib/notebook/browser/view/renderers/dnd';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { NotebookEventDispatcher, NotebookLayoutChangedEvent } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { CellViewModel, IModelDecorationsChangeAccessor, INotebookEditorViewState, NotebookViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CellKind, CellToolbarLocKey, ICellRange, IInsetRenderOutput, INotebookKernelInfo, INotebookKernelInfo2, INotebookKernelInfoDto, IProcessedOutput, isTransformedDisplayOutput, NotebookCellRunState, NotebookRunState, ShowCellStatusbarKey } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookProviderInfo } from 'vs/workbench/contrib/notebook/common/notebookProvider';
import { INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { editorGutterModifiedBackground } from 'vs/workbench/contrib/scm/browser/dirtydiffDecorator';
import { Webview } from 'vs/workbench/contrib/webview/browser/webview';
import { IEditorGroupsService } from 'vs/workbench/services/editor/common/editorGroupsService';

const $ = DOM.$;

const NotebookEditorActiveKernelCache = 'workbench.editor.notebook.activeKernel';

export class NotebookEditorWidget extends Disposable implements INotebookEditor {
	static readonly ID: string = 'workbench.editor.notebook';
	private static readonly EDITOR_MEMENTOS = new Map<string, EditorMemento<unknown>>();
	private _overlayContainer!: HTMLElement;
	private _body!: HTMLElement;
	private _overflowContainer!: HTMLElement;
	private _webview: BackLayerWebView | null = null;
	private _webviewResolved: boolean = false;
	private _webviewResolvePromise: Promise<BackLayerWebView | null> | null = null;
	private _webviewTransparentCover: HTMLElement | null = null;
	private _list: INotebookCellList | undefined;
	private _dndController: CellDragAndDropController | null = null;
	private _listTopCellToolbar: ListTopCellToolbar | null = null;
	private _renderedEditors: Map<ICellViewModel, ICodeEditor | undefined> = new Map();
	private _eventDispatcher: NotebookEventDispatcher | undefined;
	private _notebookViewModel: NotebookViewModel | undefined;
	private _localStore: DisposableStore = this._register(new DisposableStore());
	private _fontInfo: BareFontInfo | undefined;
	private _dimension: DOM.Dimension | null = null;
	private _shadowElementViewInfo: { height: number, width: number, top: number; left: number; } | null = null;

	private _editorFocus: IContextKey<boolean> | null = null;
	private _outputFocus: IContextKey<boolean> | null = null;
	private _editorEditable: IContextKey<boolean> | null = null;
	private _editorRunnable: IContextKey<boolean> | null = null;
	private _notebookExecuting: IContextKey<boolean> | null = null;
	private _notebookHasMultipleKernels: IContextKey<boolean> | null = null;
	private _outputRenderer: OutputRenderer;
	protected readonly _contributions: { [key: string]: INotebookEditorContribution; };
	private _scrollBeyondLastLine: boolean;
	private readonly _memento: Memento;
	private readonly _activeKernelMemento: Memento;
	private readonly _onDidFocusEmitter = this._register(new Emitter<void>());
	public readonly onDidFocus = this._onDidFocusEmitter.event;
	private readonly _onWillScroll = this._register(new Emitter<ScrollEvent>());
	public readonly onWillScroll: Event<ScrollEvent> = this._onWillScroll.event;
	private readonly _onWillDispose = this._register(new Emitter<void>());
	public readonly onWillDispose: Event<void> = this._onWillDispose.event;

	private readonly _insetModifyQueueByOutputId = new SequencerByKey<string>();

	set scrollTop(top: number) {
		if (this._list) {
			this._list.scrollTop = top;
		}
	}

	private _cellContextKeyManager: CellContextKeyManager | null = null;
	private _isVisible = false;
	private readonly _uuid = generateUuid();
	private _webiewFocused: boolean = false;

	private _isDisposed: boolean = false;

	get isDisposed() {
		return this._isDisposed;
	}

	private readonly _onDidChangeModel = this._register(new Emitter<NotebookTextModel | undefined>());
	readonly onDidChangeModel: Event<NotebookTextModel | undefined> = this._onDidChangeModel.event;

	private readonly _onDidFocusEditorWidget = this._register(new Emitter<void>());
	readonly onDidFocusEditorWidget = this._onDidFocusEditorWidget.event;

	set viewModel(newModel: NotebookViewModel | undefined) {
		this._notebookViewModel = newModel;
		this._onDidChangeModel.fire(newModel?.notebookDocument);
	}

	get viewModel() {
		return this._notebookViewModel;
	}

	get uri() {
		return this._notebookViewModel?.uri;
	}

	get textModel() {
		return this._notebookViewModel?.notebookDocument;
	}

	private _activeKernel: INotebookKernelInfo | INotebookKernelInfo2 | undefined = undefined;
	private readonly _onDidChangeKernel = this._register(new Emitter<void>());
	readonly onDidChangeKernel: Event<void> = this._onDidChangeKernel.event;
	private readonly _onDidChangeAvailableKernels = this._register(new Emitter<void>());
	readonly onDidChangeAvailableKernels: Event<void> = this._onDidChangeAvailableKernels.event;

	get activeKernel() {
		return this._activeKernel;
	}

	set activeKernel(kernel: INotebookKernelInfo | INotebookKernelInfo2 | undefined) {
		if (this._isDisposed) {
			return;
		}

		if (this._activeKernel === kernel) {
			return;
		}

		this._activeKernel = kernel;
		this._activeKernelResolvePromise = undefined;

		const memento = this._activeKernelMemento.getMemento(StorageScope.GLOBAL);
		memento[this.viewModel!.viewType] = this._activeKernel?.id;
		this._activeKernelMemento.saveMemento();
		this._onDidChangeKernel.fire();
	}

	private _activeKernelResolvePromise: Promise<void> | undefined = undefined;

	private _currentKernelTokenSource: CancellationTokenSource | undefined = undefined;
	private _multipleKernelsAvailable: boolean = false;

	get multipleKernelsAvailable() {
		return this._multipleKernelsAvailable;
	}

	set multipleKernelsAvailable(state: boolean) {
		this._multipleKernelsAvailable = state;
		this._onDidChangeAvailableKernels.fire();
	}

	private readonly _onDidChangeActiveEditor = this._register(new Emitter<this>());
	readonly onDidChangeActiveEditor: Event<this> = this._onDidChangeActiveEditor.event;

	get activeCodeEditor(): IEditor | undefined {
		if (this._isDisposed) {
			return;
		}

		const [focused] = this._list!.getFocusedElements();
		return this._renderedEditors.get(focused);
	}

	private readonly _onDidChangeActiveCell = this._register(new Emitter<void>());
	readonly onDidChangeActiveCell: Event<void> = this._onDidChangeActiveCell.event;

	private readonly _onDidScroll = this._register(new Emitter<ScrollEvent>());

	readonly onDidScroll: Event<ScrollEvent> = this._onDidScroll.event;

	private _cursorNavigationMode: boolean = false;
	get cursorNavigationMode(): boolean {
		return this._cursorNavigationMode;
	}

	set cursorNavigationMode(v: boolean) {
		this._cursorNavigationMode = v;
	}

	private readonly _onDidChangeVisibleRanges = this._register(new Emitter<void>());
	onDidChangeVisibleRanges: Event<void> = this._onDidChangeVisibleRanges.event;

	get visibleRanges() {
		return this._list?.visibleRanges || [];
	}

	readonly isEmbedded: boolean;

	constructor(
		readonly creationOptions: INotebookEditorCreationOptions,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IStorageService storageService: IStorageService,
		@INotebookService private notebookService: INotebookService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService readonly contextKeyService: IContextKeyService,
		@ILayoutService private readonly layoutService: ILayoutService,
		@IContextMenuService private readonly contextMenuService: IContextMenuService,
		@IMenuService private readonly menuService: IMenuService,
	) {
		super();
		this.isEmbedded = creationOptions.isEmbedded || false;
		this._memento = new Memento(NotebookEditorWidget.ID, storageService);
		this._activeKernelMemento = new Memento(NotebookEditorActiveKernelCache, storageService);

		this._outputRenderer = new OutputRenderer(this, this.instantiationService);
		this._contributions = {};
		this._scrollBeyondLastLine = this.configurationService.getValue<boolean>('editor.scrollBeyondLastLine');

		this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor.scrollBeyondLastLine')) {
				this._scrollBeyondLastLine = this.configurationService.getValue<boolean>('editor.scrollBeyondLastLine');
				if (this._dimension && this._isVisible) {
					this.layout(this._dimension);
				}
			}

			if (e.affectsConfiguration(CellToolbarLocKey) || e.affectsConfiguration(ShowCellStatusbarKey)) {
				this._updateForNotebookConfiguration();
			}
		});

		this.notebookService.addNotebookEditor(this);
	}

	/**
	 * EditorId
	 */
	public getId(): string {
		return this._uuid;
	}

	hasModel() {
		return !!this._notebookViewModel;
	}

	//#region Editor Core

	protected getEditorMemento<T>(editorGroupService: IEditorGroupsService, key: string, limit: number = 10): IEditorMemento<T> {
		const mementoKey = `${NotebookEditorWidget.ID}${key}`;

		let editorMemento = NotebookEditorWidget.EDITOR_MEMENTOS.get(mementoKey);
		if (!editorMemento) {
			editorMemento = new EditorMemento(NotebookEditorWidget.ID, key, this.getMemento(StorageScope.WORKSPACE), limit, editorGroupService);
			NotebookEditorWidget.EDITOR_MEMENTOS.set(mementoKey, editorMemento);
		}

		return editorMemento as IEditorMemento<T>;
	}

	protected getMemento(scope: StorageScope): MementoObject {
		return this._memento.getMemento(scope);
	}

	public get isNotebookEditor() {
		return true;
	}

	private _updateForNotebookConfiguration() {
		if (!this._overlayContainer) {
			return;
		}

		const cellToolbarLocation = this.configurationService.getValue<string>(CellToolbarLocKey);
		this._overlayContainer.classList.remove('cell-title-toolbar-left');
		this._overlayContainer.classList.remove('cell-title-toolbar-right');
		this._overlayContainer.classList.remove('cell-title-toolbar-hidden');

		if (cellToolbarLocation === 'left' || cellToolbarLocation === 'right' || cellToolbarLocation === 'hidden') {
			this._overlayContainer.classList.add(`cell-title-toolbar-${cellToolbarLocation}`);
		}

		const showCellStatusBar = this.configurationService.getValue<boolean>(ShowCellStatusbarKey);
		this._overlayContainer.classList.toggle('cell-statusbar-hidden', !showCellStatusBar);
	}

	updateEditorFocus() {
		// Note - focus going to the webview will fire 'blur', but the webview element will be
		// a descendent of the notebook editor root.
		const focused = DOM.isAncestor(document.activeElement, this._overlayContainer);
		this._editorFocus?.set(focused);
		this._notebookViewModel?.setFocus(focused);
	}

	hasFocus() {
		return this._editorFocus?.get() || false;
	}

	hasWebviewFocus() {
		return this._webiewFocused;
	}

	hasOutputTextSelection() {
		if (!this.hasFocus()) {
			return false;
		}

		const windowSelection = window.getSelection();
		if (windowSelection?.rangeCount !== 1) {
			return false;
		}

		const activeSelection = windowSelection.getRangeAt(0);
		if (activeSelection.endOffset - activeSelection.startOffset === 0) {
			return false;
		}

		let container: any = activeSelection.commonAncestorContainer;

		if (!this._body.contains(container)) {
			return false;
		}

		while (container
			&&
			container !== this._body) {

			if (DOM.hasClass(container as HTMLElement, 'output')) {
				return true;
			}

			container = container.parentNode;
		}

		return false;
	}

	createEditor(): void {
		this._overlayContainer = document.createElement('div');
		const id = generateUuid();
		this._overlayContainer.id = `notebook-${id}`;
		this._overlayContainer.className = 'notebookOverlay';
		DOM.addClass(this._overlayContainer, 'notebook-editor');
		this._overlayContainer.style.visibility = 'hidden';

		this.layoutService.container.appendChild(this._overlayContainer);
		this._createBody(this._overlayContainer);
		this._generateFontInfo();
		this._editorFocus = NOTEBOOK_EDITOR_FOCUSED.bindTo(this.contextKeyService);
		this._isVisible = true;
		this._outputFocus = NOTEBOOK_OUTPUT_FOCUSED.bindTo(this.contextKeyService);
		this._editorEditable = NOTEBOOK_EDITOR_EDITABLE.bindTo(this.contextKeyService);
		this._editorEditable.set(true);
		this._editorRunnable = NOTEBOOK_EDITOR_RUNNABLE.bindTo(this.contextKeyService);
		this._editorRunnable.set(true);
		this._notebookExecuting = NOTEBOOK_EDITOR_EXECUTING_NOTEBOOK.bindTo(this.contextKeyService);
		this._notebookHasMultipleKernels = NOTEBOOK_HAS_MULTIPLE_KERNELS.bindTo(this.contextKeyService);
		this._notebookHasMultipleKernels.set(false);

		let contributions: INotebookEditorContributionDescription[];
		if (Array.isArray(this.creationOptions.contributions)) {
			contributions = this.creationOptions.contributions;
		} else {
			contributions = NotebookEditorExtensionsRegistry.getEditorContributions();
		}

		for (const desc of contributions) {
			try {
				const contribution = this.instantiationService.createInstance(desc.ctor, this);
				this._contributions[desc.id] = contribution;
			} catch (err) {
				onUnexpectedError(err);
			}
		}

		this._updateForNotebookConfiguration();
	}

	private _generateFontInfo(): void {
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this._fontInfo = BareFontInfo.createFromRawSettings(editorOptions, getZoomLevel());
	}

	private _createBody(parent: HTMLElement): void {
		this._body = document.createElement('div');
		DOM.addClass(this._body, 'cell-list-container');
		this._createCellList();
		DOM.append(parent, this._body);

		this._overflowContainer = document.createElement('div');
		DOM.addClass(this._overflowContainer, 'notebook-overflow-widget-container');
		DOM.addClass(this._overflowContainer, 'monaco-editor');
		DOM.append(parent, this._overflowContainer);
	}

	private _createCellList(): void {
		DOM.addClass(this._body, 'cell-list-container');

		this._dndController = this._register(new CellDragAndDropController(this, this._body));
		const getScopedContextKeyService = (container?: HTMLElement) => this._list!.contextKeyService.createScoped(container);
		const renderers = [
			this.instantiationService.createInstance(CodeCellRenderer, this, this._renderedEditors, this._dndController, getScopedContextKeyService),
			this.instantiationService.createInstance(MarkdownCellRenderer, this, this._dndController, this._renderedEditors, getScopedContextKeyService),
		];

		this._list = this.instantiationService.createInstance(
			NotebookCellList,
			'NotebookCellList',
			this._overlayContainer,
			this._body,
			this.instantiationService.createInstance(NotebookCellListDelegate),
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
				transformOptimization: false, //(isMacintosh && isNative) || getTitleBarStyle(this.configurationService, this.environmentService) === 'native',
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
						return nls.localize('notebookTreeAriaLabel', "Notebook");
					}
				},
				focusNextPreviousDelegate: {
					onFocusNext: (applyFocusNext: () => void) => this._updateForCursorNavigationMode(applyFocusNext),
					onFocusPrevious: (applyFocusPrevious: () => void) => this._updateForCursorNavigationMode(applyFocusPrevious),
				}
			},
		);
		this._dndController.setList(this._list);

		// create Webview

		this._register(this._list);
		this._register(combinedDisposable(...renderers));

		// top cell toolbar
		this._listTopCellToolbar = this._register(this.instantiationService.createInstance(ListTopCellToolbar, this, this._list.rowsContainer));

		// transparent cover
		this._webviewTransparentCover = DOM.append(this._list.rowsContainer, $('.webview-cover'));
		this._webviewTransparentCover.style.display = 'none';

		this._register(DOM.addStandardDisposableGenericMouseDownListner(this._overlayContainer, (e: StandardMouseEvent) => {
			if (DOM.hasClass(e.target, 'slider') && this._webviewTransparentCover) {
				this._webviewTransparentCover.style.display = 'block';
			}
		}));

		this._register(DOM.addStandardDisposableGenericMouseUpListner(this._overlayContainer, () => {
			if (this._webviewTransparentCover) {
				// no matter when
				this._webviewTransparentCover.style.display = 'none';
			}
		}));

		this._register(this._list.onMouseDown(e => {
			if (e.element) {
				this._onMouseDown.fire({ event: e.browserEvent, target: e.element });
			}
		}));

		this._register(this._list.onMouseUp(e => {
			if (e.element) {
				this._onMouseUp.fire({ event: e.browserEvent, target: e.element });
			}
		}));

		this._register(this._list.onDidChangeFocus(_e => {
			this._onDidChangeActiveEditor.fire(this);
			this._onDidChangeActiveCell.fire();
			this._cursorNavigationMode = false;
		}));

		this._register(this._list.onContextMenu(e => {
			this.showListContextMenu(e);
		}));

		this._register(this._list.onDidScroll((e) => {
			this._onDidScroll.fire(e);
		}));

		this._register(this._list.onDidChangeVisibleRanges(() => {
			this._onDidChangeVisibleRanges.fire();
		}));

		const widgetFocusTracker = DOM.trackFocus(this.getDomNode());
		this._register(widgetFocusTracker);
		this._register(widgetFocusTracker.onDidFocus(() => this._onDidFocusEmitter.fire()));
	}

	private showListContextMenu(e: IListContextMenuEvent<CellViewModel>) {
		this.contextMenuService.showContextMenu({
			getActions: () => {
				const result: IAction[] = [];
				const menu = this.menuService.createMenu(MenuId.NotebookCellTitle, this.contextKeyService);
				const groups = menu.getActions();
				menu.dispose();

				for (let group of groups) {
					const [, actions] = group;
					result.push(...actions);
					result.push(new Separator());
				}

				result.pop(); // remove last separator
				return result;
			},
			getAnchor: () => e.anchor
		});
	}

	private _updateForCursorNavigationMode(applyFocusChange: () => void): void {
		if (this._cursorNavigationMode) {
			// Will fire onDidChangeFocus, resetting the state to Container
			applyFocusChange();

			const newFocusedCell = this._list!.getFocusedElements()[0];
			if (newFocusedCell.cellKind === CellKind.Code || newFocusedCell.editState === CellEditState.Editing) {
				this.focusNotebookCell(newFocusedCell, 'editor');
			} else {
				// Reset to "Editor", the state has not been consumed
				this._cursorNavigationMode = true;
			}
		} else {
			applyFocusChange();
		}
	}

	getDomNode() {
		return this._overlayContainer;
	}

	getOverflowContainerDomNode() {
		return this._overflowContainer;
	}

	onWillHide() {
		this._isVisible = false;
		this._editorFocus?.set(false);
		this._overlayContainer.style.visibility = 'hidden';
		this._overlayContainer.style.left = '-50000px';
	}

	getInnerWebview(): Webview | undefined {
		return this._webview?.webview;
	}

	focus() {
		this._isVisible = true;
		this._editorFocus?.set(true);

		if (this._webiewFocused) {
			this._webview?.focusWebview();
		} else {
			const focus = this._list?.getFocus()[0];
			if (typeof focus === 'number') {
				const element = this._notebookViewModel!.viewCells[focus];

				if (element.focusMode === CellFocusMode.Editor) {
					element.editState = CellEditState.Editing;
					element.focusMode = CellFocusMode.Editor;
					this._onDidFocusEditorWidget.fire();
					return;
				}

			}
			this._list?.domFocus();
		}

		this._onDidFocusEditorWidget.fire();
	}

	async setModel(textModel: NotebookTextModel, viewState: INotebookEditorViewState | undefined): Promise<void> {
		if (this._notebookViewModel === undefined || !this._notebookViewModel.equal(textModel)) {
			this._detachModel();
			await this._attachModel(textModel, viewState);
		} else {
			this.restoreListViewState(viewState);
		}

		// clear state
		this._dndController?.clearGlobalDragState();

		this._currentKernelTokenSource = new CancellationTokenSource();
		this._localStore.add(this._currentKernelTokenSource);
		// we don't await for it, otherwise it will slow down the file opening
		this._setKernels(textModel, this._currentKernelTokenSource);

		this._localStore.add(this.notebookService.onDidChangeKernels(async () => {
			this._currentKernelTokenSource?.cancel();
			this._currentKernelTokenSource = new CancellationTokenSource();
			await this._setKernels(textModel, this._currentKernelTokenSource);
		}));

		this._localStore.add(this._list!.onDidChangeFocus(() => {
			const focused = this._list!.getFocusedElements()[0];
			if (focused) {
				if (!this._cellContextKeyManager) {
					this._cellContextKeyManager = this._localStore.add(new CellContextKeyManager(this.contextKeyService, this, textModel, focused as CellViewModel));
				}

				this._cellContextKeyManager.updateForElement(focused as CellViewModel);
			}
		}));
	}

	async setOptions(options: NotebookEditorOptions | undefined) {
		// reveal cell if editor options tell to do so
		if (options?.cellOptions) {
			const cellOptions = options.cellOptions;
			const cell = this._notebookViewModel!.viewCells.find(cell => cell.uri.toString() === cellOptions.resource.toString());
			if (cell) {
				this.selectElement(cell);
				this.revealInCenterIfOutsideViewport(cell);
				const editor = this._renderedEditors.get(cell)!;
				if (editor) {
					if (cellOptions.options?.selection) {
						const { selection } = cellOptions.options;
						editor.setSelection({
							...selection,
							endLineNumber: selection.endLineNumber || selection.startLineNumber,
							endColumn: selection.endColumn || selection.startColumn
						});
						editor.revealPositionInCenterIfOutsideViewport({
							lineNumber: selection.startLineNumber,
							column: selection.startColumn
						});
					}
					if (!cellOptions.options?.preserveFocus) {
						editor.focus();
					}
				}
			}
		}
	}

	private _detachModel() {
		this._localStore.clear();
		this._list?.detachViewModel();
		this.viewModel?.dispose();
		// avoid event
		this._notebookViewModel = undefined;
		// this.webview?.clearInsets();
		// this.webview?.clearPreloadsCache();
		this._webview?.dispose();
		this._webview?.element.remove();
		this._webview = null;
		this._list?.clear();
	}

	private async _setKernels(textModel: NotebookTextModel, tokenSource: CancellationTokenSource) {
		const provider = this.notebookService.getContributedNotebookProviders(this.viewModel!.uri)[0];
		const availableKernels2 = await this.notebookService.getContributedNotebookKernels2(textModel.viewType, textModel.uri, tokenSource.token);

		if (tokenSource.token.isCancellationRequested) {
			return;
		}

		const availableKernels = this.notebookService.getContributedNotebookKernels(textModel.viewType, textModel.uri);

		if (tokenSource.token.isCancellationRequested) {
			return;
		}

		if ((availableKernels.length + availableKernels2.length) > 1) {
			this._notebookHasMultipleKernels!.set(true);
			this.multipleKernelsAvailable = true;
		} else {
			this._notebookHasMultipleKernels!.set(false);
			this.multipleKernelsAvailable = false;
		}

		const activeKernelStillExist = [...availableKernels2, ...availableKernels].find(kernel => kernel.id === this.activeKernel?.id && this.activeKernel?.id !== undefined);

		if (activeKernelStillExist) {
			// the kernel still exist, we don't want to modify the selection otherwise user's temporary preference is lost
			return;
		}

		if (availableKernels2.length) {
			return this._setKernelsFromProviders(provider, availableKernels2, tokenSource);
		}

		// the provider doesn't have a builtin kernel, choose a kernel
		this.activeKernel = availableKernels[0];
		if (this.activeKernel) {
			await this._loadKernelPreloads(this.activeKernel.extensionLocation, this.activeKernel);
		}

		tokenSource.dispose();
	}

	private async _setKernelsFromProviders(provider: NotebookProviderInfo, kernels: INotebookKernelInfo2[], tokenSource: CancellationTokenSource) {
		const rawAssociations = this.configurationService.getValue<NotebookKernelProviderAssociations>(notebookKernelProviderAssociationsSettingId) || [];
		const userSetKernelProvider = rawAssociations.filter(e => e.viewType === this.viewModel?.viewType)[0]?.kernelProvider;
		const memento = this._activeKernelMemento.getMemento(StorageScope.GLOBAL);

		if (userSetKernelProvider) {
			const filteredKernels = kernels.filter(kernel => kernel.extension.value === userSetKernelProvider);

			if (filteredKernels.length) {
				const cachedKernelId = memento[provider.id];
				this.activeKernel =
					filteredKernels.find(kernel => kernel.isPreferred)
					|| filteredKernels.find(kernel => kernel.id === cachedKernelId)
					|| filteredKernels[0];
			} else {
				this.activeKernel = undefined;
			}

			if (this.activeKernel) {
				await this._loadKernelPreloads(this.activeKernel.extensionLocation, this.activeKernel);

				if (tokenSource.token.isCancellationRequested) {
					return;
				}

				this._activeKernelResolvePromise = this.activeKernel.resolve(this.viewModel!.uri, this.getId(), tokenSource.token);
				await this._activeKernelResolvePromise;

				if (tokenSource.token.isCancellationRequested) {
					return;
				}
			}

			memento[provider.id] = this._activeKernel?.id;
			this._activeKernelMemento.saveMemento();

			tokenSource.dispose();
			return;
		}

		// choose a preferred kernel
		const kernelsFromSameExtension = kernels.filter(kernel => kernel.extension.value === provider.providerExtensionId);
		if (kernelsFromSameExtension.length) {
			const cachedKernelId = memento[provider.id];

			const preferedKernel = kernelsFromSameExtension.find(kernel => kernel.isPreferred)
				|| kernelsFromSameExtension.find(kernel => kernel.id === cachedKernelId)
				|| kernelsFromSameExtension[0];
			this.activeKernel = preferedKernel;
			await this._loadKernelPreloads(this.activeKernel.extensionLocation, this.activeKernel);

			if (tokenSource.token.isCancellationRequested) {
				return;
			}

			await preferedKernel.resolve(this.viewModel!.uri, this.getId(), tokenSource.token);

			if (tokenSource.token.isCancellationRequested) {
				return;
			}

			memento[provider.id] = this._activeKernel?.id;
			this._activeKernelMemento.saveMemento();
			tokenSource.dispose();
			return;
		}

		// the provider doesn't have a builtin kernel, choose a kernel
		this.activeKernel = kernels[0];
		if (this.activeKernel) {
			await this._loadKernelPreloads(this.activeKernel.extensionLocation, this.activeKernel);
			if (tokenSource.token.isCancellationRequested) {
				return;
			}

			await this.activeKernel.resolve(this.viewModel!.uri, this.getId(), tokenSource.token);
			if (tokenSource.token.isCancellationRequested) {
				return;
			}
		}

		tokenSource.dispose();
	}

	private async _loadKernelPreloads(extensionLocation: URI, kernel: INotebookKernelInfoDto) {
		if (kernel.preloads && kernel.preloads.length) {
			await this._resolveWebview();
			this._webview?.updateKernelPreloads([extensionLocation], kernel.preloads.map(preload => URI.revive(preload)));
		}
	}

	private _updateForMetadata(): void {
		const notebookMetadata = this.viewModel!.metadata;
		this._editorEditable?.set(!!notebookMetadata?.editable);
		this._editorRunnable?.set(!!notebookMetadata?.runnable);
		DOM.toggleClass(this._overlayContainer, 'notebook-editor-editable', !!notebookMetadata?.editable);
		DOM.toggleClass(this.getDomNode(), 'notebook-editor-editable', !!notebookMetadata?.editable);

		this._notebookExecuting?.set(notebookMetadata.runState === NotebookRunState.Running);
	}

	private async _resolveWebview(): Promise<BackLayerWebView | null> {
		if (!this.textModel) {
			return null;
		}

		if (this._webviewResolvePromise) {
			return this._webviewResolvePromise;
		}

		if (!this._webview) {
			this._webview = this.instantiationService.createInstance(BackLayerWebView, this, this.getId(), this.textModel!.uri);
			// attach the webview container to the DOM tree first
			this._list?.rowsContainer.insertAdjacentElement('afterbegin', this._webview.element);
		}

		this._webviewResolvePromise = new Promise(async resolve => {
			await this._webview!.createWebview();
			this._webview!.webview!.onDidBlur(() => {
				this._outputFocus?.set(false);
				this.updateEditorFocus();

				if (this._overlayContainer.contains(document.activeElement)) {
					this._webiewFocused = false;
				}
			});
			this._webview!.webview!.onDidFocus(() => {
				this._outputFocus?.set(true);
				this.updateEditorFocus();
				this._onDidFocusEmitter.fire();

				if (this._overlayContainer.contains(document.activeElement)) {
					this._webiewFocused = true;
				}
			});

			this._localStore.add(this._webview!.onMessage(({ message, forRenderer }) => {
				if (this.viewModel) {
					this.notebookService.onDidReceiveMessage(this.viewModel.viewType, this.getId(), forRenderer, message);
				}
			}));

			this._webviewResolved = true;

			resolve(this._webview!);
		});

		return this._webviewResolvePromise;
	}

	private async _createWebview(id: string, resource: URI): Promise<void> {
		this._webview = this.instantiationService.createInstance(BackLayerWebView, this, id, resource);
		// attach the webview container to the DOM tree first
		this._list?.rowsContainer.insertAdjacentElement('afterbegin', this._webview.element);
	}

	private async _attachModel(textModel: NotebookTextModel, viewState: INotebookEditorViewState | undefined) {
		await this._createWebview(this.getId(), textModel.uri);

		this._eventDispatcher = new NotebookEventDispatcher();
		this.viewModel = this.instantiationService.createInstance(NotebookViewModel, textModel.viewType, textModel, this._eventDispatcher, this.getLayoutInfo());
		this._eventDispatcher.emit([new NotebookLayoutChangedEvent({ width: true, fontInfo: true }, this.getLayoutInfo())]);

		this._updateForMetadata();
		this._localStore.add(this._eventDispatcher.onDidChangeMetadata(() => {
			this._updateForMetadata();
		}));

		// restore view states, including contributions

		{
			// restore view state
			this.viewModel.restoreEditorViewState(viewState);

			// contribution state restore

			const contributionsState = viewState?.contributionsState || {};
			const keys = Object.keys(this._contributions);
			for (let i = 0, len = keys.length; i < len; i++) {
				const id = keys[i];
				const contribution = this._contributions[id];
				if (typeof contribution.restoreViewState === 'function') {
					contribution.restoreViewState(contributionsState[id]);
				}
			}
		}

		this._localStore.add(this._list!.onWillScroll(e => {
			this._onWillScroll.fire(e);
			if (!this._webviewResolved) {
				return;
			}

			this._webview?.updateViewScrollTop(-e.scrollTop, true, []);
			this._webviewTransparentCover!.style.top = `${e.scrollTop}px`;
		}));

		this._localStore.add(this._list!.onDidChangeContentHeight(() => {
			DOM.scheduleAtNextAnimationFrame(() => {
				if (this._isDisposed) {
					return;
				}

				const scrollTop = this._list?.scrollTop || 0;
				const scrollHeight = this._list?.scrollHeight || 0;

				if (!this._webviewResolved) {
					return;
				}

				this._webview!.element.style.height = `${scrollHeight}px`;

				if (this._webview?.insetMapping) {
					const updateItems: { cell: CodeCellViewModel, output: IProcessedOutput, cellTop: number }[] = [];
					const removedItems: IProcessedOutput[] = [];
					this._webview?.insetMapping.forEach((value, key) => {
						const cell = value.cell;
						const viewIndex = this._list?.getViewIndex(cell);

						if (viewIndex === undefined) {
							return;
						}

						if (cell.outputs.indexOf(key) < 0) {
							// output is already gone
							removedItems.push(key);
						}

						const cellTop = this._list?.getAbsoluteTopOfElement(cell) || 0;
						if (this._webview!.shouldUpdateInset(cell, key, cellTop)) {
							updateItems.push({
								cell: cell,
								output: key,
								cellTop: cellTop
							});
						}
					});

					removedItems.forEach(output => this._webview?.removeInset(output));

					if (updateItems.length) {
						this._webview?.updateViewScrollTop(-scrollTop, false, updateItems);
					}
				}
			});
		}));

		this._list!.attachViewModel(this.viewModel);
		this._localStore.add(this._list!.onDidRemoveOutput(output => {
			this.removeInset(output);
		}));
		this._localStore.add(this._list!.onDidHideOutput(output => {
			this.hideInset(output);
		}));

		if (this._dimension) {
			this._list?.layout(this._dimension.height - SCROLLABLE_ELEMENT_PADDING_TOP, this._dimension.width);
		} else {
			this._list!.layout();
		}

		this._dndController?.clearGlobalDragState();

		// restore list state at last, it must be after list layout
		this.restoreListViewState(viewState);
	}

	restoreListViewState(viewState: INotebookEditorViewState | undefined): void {
		if (viewState?.scrollPosition !== undefined) {
			this._list!.scrollTop = viewState!.scrollPosition.top;
			this._list!.scrollLeft = viewState!.scrollPosition.left;
		} else {
			this._list!.scrollTop = 0;
			this._list!.scrollLeft = 0;
		}

		const focusIdx = typeof viewState?.focus === 'number' ? viewState.focus : 0;
		if (focusIdx < this._list!.length) {
			this._list!.setFocus([focusIdx]);
			this._list!.setSelection([focusIdx]);
		} else if (this._list!.length > 0) {
			this._list!.setFocus([0]);
		}

		if (viewState?.editorFocused) {
			const cell = this._notebookViewModel?.viewCells[focusIdx];
			if (cell) {
				cell.focusMode = CellFocusMode.Editor;
			}
		}
	}

	getEditorViewState(): INotebookEditorViewState {
		const state = this._notebookViewModel?.getEditorViewState();
		if (!state) {
			return {
				editingCells: {},
				editorViewStates: {}
			};
		}

		if (this._list) {
			state.scrollPosition = { left: this._list.scrollLeft, top: this._list.scrollTop };
			const cellHeights: { [key: number]: number } = {};
			for (let i = 0; i < this.viewModel!.length; i++) {
				const elm = this.viewModel!.viewCells[i] as CellViewModel;
				if (elm.cellKind === CellKind.Code) {
					cellHeights[i] = elm.layoutInfo.totalHeight;
				} else {
					cellHeights[i] = elm.layoutInfo.totalHeight;
				}
			}

			state.cellTotalHeights = cellHeights;

			const focus = this._list.getFocus()[0];
			if (typeof focus === 'number') {
				const element = this._notebookViewModel!.viewCells[focus];
				if (element) {
					const itemDOM = this._list?.domElementOfElement(element);
					const editorFocused = !!(document.activeElement && itemDOM && itemDOM.contains(document.activeElement));

					state.editorFocused = editorFocused;
					state.focus = focus;
				}
			}
		}

		// Save contribution view states
		const contributionsState: { [key: string]: unknown } = {};

		const keys = Object.keys(this._contributions);
		for (const id of keys) {
			const contribution = this._contributions[id];
			if (typeof contribution.saveViewState === 'function') {
				contributionsState[id] = contribution.saveViewState();
			}
		}

		state.contributionsState = contributionsState;
		return state;
	}

	// private saveEditorViewState(input: NotebookEditorInput): void {
	// 	if (this.group && this.notebookViewModel) {
	// 	}
	// }

	// private loadTextEditorViewState(): INotebookEditorViewState | undefined {
	// 	return this.editorMemento.loadEditorState(this.group, input.resource);
	// }

	layout(dimension: DOM.Dimension, shadowElement?: HTMLElement): void {
		if (!shadowElement && this._shadowElementViewInfo === null) {
			this._dimension = dimension;
			return;
		}

		if (shadowElement) {
			const containerRect = shadowElement.getBoundingClientRect();

			this._shadowElementViewInfo = {
				height: containerRect.height,
				width: containerRect.width,
				top: containerRect.top,
				left: containerRect.left
			};
		}

		this._dimension = new DOM.Dimension(dimension.width, dimension.height);
		DOM.size(this._body, dimension.width, dimension.height);
		this._list?.updateOptions({ additionalScrollHeight: this._scrollBeyondLastLine ? dimension.height - SCROLLABLE_ELEMENT_PADDING_TOP : 0 });
		this._list?.layout(dimension.height - SCROLLABLE_ELEMENT_PADDING_TOP, dimension.width);

		this._overlayContainer.style.visibility = 'visible';
		this._overlayContainer.style.display = 'block';
		this._overlayContainer.style.position = 'absolute';
		this._overlayContainer.style.top = `${this._shadowElementViewInfo!.top}px`;
		this._overlayContainer.style.left = `${this._shadowElementViewInfo!.left}px`;
		this._overlayContainer.style.width = `${dimension ? dimension.width : this._shadowElementViewInfo!.width}px`;
		this._overlayContainer.style.height = `${dimension ? dimension.height : this._shadowElementViewInfo!.height}px`;

		if (this._webviewTransparentCover) {
			this._webviewTransparentCover.style.height = `${dimension.height}px`;
			this._webviewTransparentCover.style.width = `${dimension.width}px`;
		}

		this._eventDispatcher?.emit([new NotebookLayoutChangedEvent({ width: true, fontInfo: true }, this.getLayoutInfo())]);
	}

	// protected saveState(): void {
	// 	if (this.input instanceof NotebookEditorInput) {
	// 		this.saveEditorViewState(this.input);
	// 	}

	// 	super.saveState();
	// }

	//#endregion

	//#region Editor Features

	selectElement(cell: ICellViewModel) {
		this._list?.selectElement(cell);
		// this.viewModel!.selectionHandles = [cell.handle];
	}

	revealInView(cell: ICellViewModel) {
		this._list?.revealElementInView(cell);
	}

	revealInCenterIfOutsideViewport(cell: ICellViewModel) {
		this._list?.revealElementInCenterIfOutsideViewport(cell);
	}

	revealInCenter(cell: ICellViewModel) {
		this._list?.revealElementInCenter(cell);
	}

	async revealLineInViewAsync(cell: ICellViewModel, line: number): Promise<void> {
		return this._list?.revealElementLineInViewAsync(cell, line);
	}

	async revealLineInCenterAsync(cell: ICellViewModel, line: number): Promise<void> {
		return this._list?.revealElementLineInCenterAsync(cell, line);
	}

	async revealLineInCenterIfOutsideViewportAsync(cell: ICellViewModel, line: number): Promise<void> {
		return this._list?.revealElementLineInCenterIfOutsideViewportAsync(cell, line);
	}

	async revealRangeInViewAsync(cell: ICellViewModel, range: Range): Promise<void> {
		return this._list?.revealElementRangeInViewAsync(cell, range);
	}

	async revealRangeInCenterAsync(cell: ICellViewModel, range: Range): Promise<void> {
		return this._list?.revealElementRangeInCenterAsync(cell, range);
	}

	async revealRangeInCenterIfOutsideViewportAsync(cell: ICellViewModel, range: Range): Promise<void> {
		return this._list?.revealElementRangeInCenterIfOutsideViewportAsync(cell, range);
	}

	setCellSelection(cell: ICellViewModel, range: Range): void {
		this._list?.setCellSelection(cell, range);
	}

	changeModelDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): T | null {
		return this._notebookViewModel?.changeModelDecorations<T>(callback) || null;
	}

	setHiddenAreas(_ranges: ICellRange[]): boolean {
		return this._list!.setHiddenAreas(_ranges, true);
	}

	//#endregion

	//#region Mouse Events
	private readonly _onMouseUp: Emitter<INotebookEditorMouseEvent> = this._register(new Emitter<INotebookEditorMouseEvent>());
	public readonly onMouseUp: Event<INotebookEditorMouseEvent> = this._onMouseUp.event;

	private readonly _onMouseDown: Emitter<INotebookEditorMouseEvent> = this._register(new Emitter<INotebookEditorMouseEvent>());
	public readonly onMouseDown: Event<INotebookEditorMouseEvent> = this._onMouseDown.event;

	private pendingLayouts = new WeakMap<ICellViewModel, IDisposable>();

	//#endregion

	//#region Cell operations
	async layoutNotebookCell(cell: ICellViewModel, height: number): Promise<void> {
		const viewIndex = this._list!.getViewIndex(cell);
		if (viewIndex === undefined) {
			// the cell is hidden
			return;
		}

		const relayout = (cell: ICellViewModel, height: number) => {
			if (this._isDisposed) {
				return;
			}

			this._list?.updateElementHeight2(cell, height);
		};

		if (this.pendingLayouts.has(cell)) {
			this.pendingLayouts.get(cell)!.dispose();
		}

		let r: () => void;
		const layoutDisposable = DOM.scheduleAtNextAnimationFrame(() => {
			if (this._isDisposed) {
				return;
			}

			this.pendingLayouts.delete(cell);

			relayout(cell, height);
			r();
		});

		this.pendingLayouts.set(cell, toDisposable(() => {
			layoutDisposable.dispose();
			r();
		}));

		return new Promise(resolve => { r = resolve; });
	}

	insertNotebookCell(cell: ICellViewModel | undefined, type: CellKind, direction: 'above' | 'below' = 'above', initialText: string = '', ui: boolean = false): CellViewModel | null {
		if (!this._notebookViewModel!.metadata.editable) {
			return null;
		}

		const index = cell ? this._notebookViewModel!.getCellIndex(cell) : 0;
		const nextIndex = ui ? this._notebookViewModel!.getNextVisibleCellIndex(index) : index + 1;
		const newLanguages = this._notebookViewModel!.languages;
		const language = (cell?.cellKind === CellKind.Code && type === CellKind.Code)
			? cell.language
			: ((type === CellKind.Code && newLanguages && newLanguages.length) ? newLanguages[0] : 'markdown');
		const insertIndex = cell ?
			(direction === 'above' ? index : nextIndex) :
			index;
		const focused = this._list?.getFocusedElements();
		const newCell = this._notebookViewModel!.createCell(insertIndex, initialText, language, type, undefined, true, undefined, focused);
		return newCell as CellViewModel;
	}

	async splitNotebookCell(cell: ICellViewModel): Promise<CellViewModel[] | null> {
		if (!this._notebookViewModel!.metadata.editable) {
			return null;
		}

		const index = this._notebookViewModel!.getCellIndex(cell);

		return this._notebookViewModel!.splitNotebookCell(index);
	}

	async joinNotebookCells(cell: ICellViewModel, direction: 'above' | 'below', constraint?: CellKind): Promise<ICellViewModel | null> {
		if (!this._notebookViewModel!.metadata.editable) {
			return null;
		}

		const index = this._notebookViewModel!.getCellIndex(cell);
		const ret = await this._notebookViewModel!.joinNotebookCells(index, direction, constraint);

		if (ret) {
			ret.deletedCells.forEach(cell => {
				if (this.pendingLayouts.has(cell)) {
					this.pendingLayouts.get(cell)!.dispose();
				}
			});

			return ret.cell;
		} else {
			return null;
		}
	}

	async deleteNotebookCell(cell: ICellViewModel): Promise<boolean> {
		if (!this._notebookViewModel!.metadata.editable) {
			return false;
		}

		if (this.pendingLayouts.has(cell)) {
			this.pendingLayouts.get(cell)!.dispose();
		}

		const index = this._notebookViewModel!.getCellIndex(cell);
		this._notebookViewModel!.deleteCell(index, true);
		return true;
	}

	async moveCellDown(cell: ICellViewModel): Promise<ICellViewModel | null> {
		if (!this._notebookViewModel!.metadata.editable) {
			return null;
		}

		const index = this._notebookViewModel!.getCellIndex(cell);
		if (index === this._notebookViewModel!.length - 1) {
			return null;
		}

		const newIdx = index + 2; // This is the adjustment for the index before the cell has been "removed" from its original index
		return this._moveCellToIndex(index, 1, newIdx);
	}

	async moveCellUp(cell: ICellViewModel): Promise<ICellViewModel | null> {
		if (!this._notebookViewModel!.metadata.editable) {
			return null;
		}

		const index = this._notebookViewModel!.getCellIndex(cell);
		if (index === 0) {
			return null;
		}

		const newIdx = index - 1;
		return this._moveCellToIndex(index, 1, newIdx);
	}

	async moveCell(cell: ICellViewModel, relativeToCell: ICellViewModel, direction: 'above' | 'below'): Promise<ICellViewModel | null> {
		if (!this._notebookViewModel!.metadata.editable) {
			return null;
		}

		if (cell === relativeToCell) {
			return null;
		}

		const originalIdx = this._notebookViewModel!.getCellIndex(cell);
		const relativeToIndex = this._notebookViewModel!.getCellIndex(relativeToCell);

		const newIdx = direction === 'above' ? relativeToIndex : relativeToIndex + 1;
		return this._moveCellToIndex(originalIdx, 1, newIdx);
	}

	async moveCellsToIdx(index: number, length: number, toIdx: number): Promise<ICellViewModel | null> {
		if (!this._notebookViewModel!.metadata.editable) {
			return null;
		}

		return this._moveCellToIndex(index, length, toIdx);
	}

	/**
	 * @param index The current index of the cell
	 * @param desiredIndex The desired index, in an index scheme for the state of the tree before the current cell has been "removed".
	 * @example to move the cell from index 0 down one spot, call with (0, 2)
	 */
	private async _moveCellToIndex(index: number, length: number, desiredIndex: number): Promise<ICellViewModel | null> {
		if (index < desiredIndex) {
			// The cell is moving "down", it will free up one index spot and consume a new one
			desiredIndex -= length;
		}

		if (index === desiredIndex) {
			return null;
		}

		if (!this._notebookViewModel!.moveCellToIdx(index, length, desiredIndex, true)) {
			throw new Error('Notebook Editor move cell, index out of range');
		}

		let r: (val: ICellViewModel | null) => void;
		DOM.scheduleAtNextAnimationFrame(() => {
			if (this._isDisposed) {
				r(null);
			}

			const viewCell = this._notebookViewModel!.viewCells[desiredIndex];
			this._list?.revealElementInView(viewCell);
			r(viewCell);
		});

		return new Promise(resolve => { r = resolve; });
	}

	editNotebookCell(cell: CellViewModel): void {
		if (!cell.getEvaluatedMetadata(this._notebookViewModel!.metadata).editable) {
			return;
		}

		cell.editState = CellEditState.Editing;

		this._renderedEditors.get(cell)?.focus();
	}

	getActiveCell() {
		const elements = this._list?.getFocusedElements();

		if (elements && elements.length) {
			return elements[0];
		}

		return undefined;
	}

	async cancelNotebookExecution(): Promise<void> {
		if (this._notebookViewModel?.metadata.runState !== NotebookRunState.Running) {
			return;
		}

		return this._cancelNotebookExecution();
	}

	private async _cancelNotebookExecution(): Promise<void> {
		const provider = this.notebookService.getContributedNotebookProviders(this.viewModel!.uri)[0];
		if (provider && this._activeKernel) {
			await (this._activeKernel as INotebookKernelInfo2).cancelNotebookCell!(this._notebookViewModel!.uri, undefined);
		}
	}

	async executeNotebook(): Promise<void> {
		if (!this._notebookViewModel!.metadata.runnable) {
			return;
		}

		return this._executeNotebook();
	}

	private async _executeNotebook(): Promise<void> {
		const provider = this.notebookService.getContributedNotebookProviders(this.viewModel!.uri)[0];
		if (provider && this._activeKernel) {
			// TODO@rebornix temp any cast, should be removed once we remove legacy kernel support
			if ((this._activeKernel as INotebookKernelInfo2).executeNotebookCell) {
				if (this._activeKernelResolvePromise) {
					await this._activeKernelResolvePromise;
				}

				await (this._activeKernel as INotebookKernelInfo2).executeNotebookCell!(this._notebookViewModel!.uri, undefined);
			} else {
				await this.notebookService.executeNotebook(this._notebookViewModel!.viewType, this._notebookViewModel!.uri, this._activeKernel.id);
			}
		}
	}

	async cancelNotebookCellExecution(cell: ICellViewModel): Promise<void> {
		if (cell.cellKind !== CellKind.Code) {
			return;
		}

		const metadata = cell.getEvaluatedMetadata(this._notebookViewModel!.metadata);
		if (!metadata.runnable) {
			return;
		}

		if (metadata.runState !== NotebookCellRunState.Running) {
			return;
		}

		await this._cancelNotebookCell(cell);
	}

	private async _cancelNotebookCell(cell: ICellViewModel): Promise<void> {
		const provider = this.notebookService.getContributedNotebookProviders(this.viewModel!.uri)[0];
		if (provider && this._activeKernel) {
			return await (this._activeKernel as INotebookKernelInfo2).cancelNotebookCell!(this._notebookViewModel!.uri, cell.handle);
		}
	}

	async executeNotebookCell(cell: ICellViewModel): Promise<void> {
		if (cell.cellKind === CellKind.Markdown) {
			this.focusNotebookCell(cell, 'container');
			return;
		}

		if (!cell.getEvaluatedMetadata(this._notebookViewModel!.metadata).runnable) {
			return;
		}

		await this._executeNotebookCell(cell);
	}

	private async _executeNotebookCell(cell: ICellViewModel): Promise<void> {
		const provider = this.notebookService.getContributedNotebookProviders(this.viewModel!.uri)[0];
		if (provider) {
			const viewType = provider.id;
			const notebookUri = this._notebookViewModel!.uri;

			if (this._activeKernel) {
				// TODO@rebornix temp any cast, should be removed once we remove legacy kernel support
				if ((this._activeKernel as INotebookKernelInfo2).executeNotebookCell) {
					await (this._activeKernel as INotebookKernelInfo2).executeNotebookCell!(this._notebookViewModel!.uri, cell.handle);
				} else {

					return await this.notebookService.executeNotebookCell(viewType, notebookUri, cell.handle, this._activeKernel.id);
				}
			}

		}
	}

	focusNotebookCell(cell: ICellViewModel, focusItem: 'editor' | 'container' | 'output') {
		if (this._isDisposed) {
			return;
		}

		if (focusItem === 'editor') {
			this.selectElement(cell);
			this._list?.focusView();

			cell.editState = CellEditState.Editing;
			cell.focusMode = CellFocusMode.Editor;
			this.revealInCenterIfOutsideViewport(cell);
		} else if (focusItem === 'output') {
			this.selectElement(cell);
			this._list?.focusView();

			if (!this._webview) {
				return;
			}
			this._webview.focusOutput(cell.id);

			cell.editState = CellEditState.Preview;
			cell.focusMode = CellFocusMode.Container;
			this.revealInCenterIfOutsideViewport(cell);
		} else {
			const itemDOM = this._list?.domElementOfElement(cell);
			if (document.activeElement && itemDOM && itemDOM.contains(document.activeElement)) {
				(document.activeElement as HTMLElement).blur();
			}

			cell.editState = CellEditState.Preview;
			cell.focusMode = CellFocusMode.Container;

			this.selectElement(cell);
			this.revealInCenterIfOutsideViewport(cell);
			this._list?.focusView();
		}
	}

	//#endregion

	//#region MISC

	deltaCellDecorations(oldDecorations: string[], newDecorations: INotebookDeltaDecoration[]): string[] {
		return this._notebookViewModel?.deltaCellDecorations(oldDecorations, newDecorations) || [];
	}

	deltaCellOutputContainerClassNames(cellId: string, added: string[], removed: string[]) {
		this._webview?.deltaCellOutputContainerClassNames(cellId, added, removed);
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

	triggerScroll(event: IMouseWheelEvent) {
		this._list?.triggerScrollFromMouseWheelEvent(event);
	}

	async createInset(cell: CodeCellViewModel, output: IInsetRenderOutput, offset: number): Promise<void> {
		this._insetModifyQueueByOutputId.queue(output.source.outputId, async () => {
			if (!this._webview) {
				return;
			}

			await this._resolveWebview();

			if (!this._webview!.insetMapping.has(output.source)) {
				const cellTop = this._list?.getAbsoluteTopOfElement(cell) || 0;
				await this._webview!.createInset(cell, output, cellTop, offset);
			} else {
				const cellTop = this._list?.getAbsoluteTopOfElement(cell) || 0;
				const scrollTop = this._list?.scrollTop || 0;

				this._webview!.updateViewScrollTop(-scrollTop, true, [{ cell, output: output.source, cellTop }]);
			}
		});
	}

	removeInset(output: IProcessedOutput) {
		if (!isTransformedDisplayOutput(output)) {
			return;
		}

		this._insetModifyQueueByOutputId.queue(output.outputId, async () => {
			if (!this._webview || !this._webviewResolved) {
				return;
			}
			this._webview!.removeInset(output);
		});
	}

	hideInset(output: IProcessedOutput) {
		if (!this._webview || !this._webviewResolved) {
			return;
		}

		if (!isTransformedDisplayOutput(output)) {
			return;
		}

		this._insetModifyQueueByOutputId.queue(output.outputId, async () => {
			this._webview!.hideInset(output);
		});
	}

	getOutputRenderer(): OutputRenderer {
		return this._outputRenderer;
	}

	postMessage(forRendererId: string | undefined, message: any) {
		if (!this._webview || !this._webviewResolved) {
			return;
		}

		if (forRendererId === undefined) {
			this._webview.webview?.postMessage(message);
		} else {
			this._webview.postRendererMessage(forRendererId, message);
		}
	}

	toggleClassName(className: string) {
		DOM.toggleClass(this._overlayContainer, className);
	}

	addClassName(className: string) {
		DOM.addClass(this._overlayContainer, className);
	}

	removeClassName(className: string) {
		DOM.removeClass(this._overlayContainer, className);
	}


	//#endregion

	//#region Editor Contributions
	public getContribution<T extends INotebookEditorContribution>(id: string): T {
		return <T>(this._contributions[id] || null);
	}

	//#endregion

	dispose() {
		this._isDisposed = true;
		this._onWillDispose.fire();
		// dispose webview first
		this._webview?.dispose();

		this.notebookService.removeNotebookEditor(this);
		const keys = Object.keys(this._contributions);
		for (let i = 0, len = keys.length; i < len; i++) {
			const contributionId = keys[i];
			this._contributions[contributionId].dispose();
		}

		this._localStore.clear();
		this._list?.dispose();
		this._listTopCellToolbar?.dispose();

		this._overlayContainer.remove();
		this.viewModel?.dispose();

		// this._layoutService.container.removeChild(this.overlayContainer);

		super.dispose();
	}

	toJSON(): object {
		return {
			notebookHandle: this.viewModel?.handle
		};
	}
}

export const notebookCellBorder = registerColor('notebook.cellBorderColor', {
	dark: transparent(PANEL_BORDER, .4),
	light: transparent(listInactiveSelectionBackground, 1),
	hc: PANEL_BORDER
}, nls.localize('notebook.cellBorderColor', "The border color for notebook cells."));

export const focusedEditorBorderColor = registerColor('notebook.focusedEditorBorder', {
	light: focusBorder,
	dark: focusBorder,
	hc: focusBorder
}, nls.localize('notebook.focusedEditorBorder', "The color of the notebook cell editor border."));

export const cellStatusIconSuccess = registerColor('notebookStatusSuccessIcon.foreground', {
	light: debugIconStartForeground,
	dark: debugIconStartForeground,
	hc: debugIconStartForeground
}, nls.localize('notebookStatusSuccessIcon.foreground', "The error icon color of notebook cells in the cell status bar."));

export const cellStatusIconError = registerColor('notebookStatusErrorIcon.foreground', {
	light: errorForeground,
	dark: errorForeground,
	hc: errorForeground
}, nls.localize('notebookStatusErrorIcon.foreground', "The error icon color of notebook cells in the cell status bar."));

export const cellStatusIconRunning = registerColor('notebookStatusRunningIcon.foreground', {
	light: foreground,
	dark: foreground,
	hc: foreground
}, nls.localize('notebookStatusRunningIcon.foreground', "The running icon color of notebook cells in the cell status bar."));

export const notebookOutputContainerColor = registerColor('notebook.outputContainerBackgroundColor', {
	dark: notebookCellBorder,
	light: transparent(listFocusBackground, .4),
	hc: null
}, nls.localize('notebook.outputContainerBackgroundColor', "The Color of the notebook output container background."));

// TODO currently also used for toolbar border, if we keep all of this, pick a generic name
export const CELL_TOOLBAR_SEPERATOR = registerColor('notebook.cellToolbarSeparator', {
	dark: Color.fromHex('#808080').transparent(0.35),
	light: Color.fromHex('#808080').transparent(0.35),
	hc: contrastBorder
}, nls.localize('notebook.cellToolbarSeparator', "The color of the seperator in the cell bottom toolbar"));

export const focusedCellBackground = registerColor('notebook.focusedCellBackground', {
	dark: transparent(PANEL_BORDER, .4),
	light: transparent(listFocusBackground, .4),
	hc: null
}, nls.localize('focusedCellBackground', "The background color of a cell when the cell is focused."));

export const cellHoverBackground = registerColor('notebook.cellHoverBackground', {
	dark: transparent(focusedCellBackground, .5),
	light: transparent(focusedCellBackground, .7),
	hc: null
}, nls.localize('notebook.cellHoverBackground', "The background color of a cell when the cell is hovered."));

export const focusedCellBorder = registerColor('notebook.focusedCellBorder', {
	dark: Color.white.transparent(0.12),
	light: Color.black.transparent(0.12),
	hc: focusBorder
}, nls.localize('notebook.focusedCellBorder', "The color of the cell's top and bottom border when the cell is focused."));

export const cellStatusBarItemHover = registerColor('notebook.cellStatusBarItemHoverBackground', {
	light: new Color(new RGBA(0, 0, 0, 0.08)),
	dark: new Color(new RGBA(255, 255, 255, 0.15)),
	hc: new Color(new RGBA(255, 255, 255, 0.15)),
}, nls.localize('notebook.cellStatusBarItemHoverBackground', "The background color of notebook cell status bar items."));

export const cellInsertionIndicator = registerColor('notebook.cellInsertionIndicator', {
	light: focusBorder,
	dark: focusBorder,
	hc: focusBorder
}, nls.localize('notebook.cellInsertionIndicator', "The color of the notebook cell insertion indicator."));


export const listScrollbarSliderBackground = registerColor('notebookScrollbarSlider.background', {
	dark: scrollbarSliderBackground,
	light: scrollbarSliderBackground,
	hc: scrollbarSliderBackground
}, nls.localize('notebookScrollbarSliderBackground', "Notebook scrollbar slider background color."));

export const listScrollbarSliderHoverBackground = registerColor('notebookScrollbarSlider.hoverBackground', {
	dark: scrollbarSliderHoverBackground,
	light: scrollbarSliderHoverBackground,
	hc: scrollbarSliderHoverBackground
}, nls.localize('notebookScrollbarSliderHoverBackground', "Notebook scrollbar slider background color when hovering."));

export const listScrollbarSliderActiveBackground = registerColor('notebookScrollbarSlider.activeBackground', {
	dark: scrollbarSliderActiveBackground,
	light: scrollbarSliderActiveBackground,
	hc: scrollbarSliderActiveBackground
}, nls.localize('notebookScrollbarSliderActiveBackground', "Notebook scrollbar slider background color when clicked on."));

export const cellSymbolHighlight = registerColor('notebook.symbolHighlightBackground', {
	dark: Color.fromHex('#ffffff0b'),
	light: Color.fromHex('#fdff0033'),
	hc: null
}, nls.localize('notebook.symbolHighlightBackground', "Background color of highlighted cell"));

registerThemingParticipant((theme, collector) => {
	collector.addRule(`.notebookOverlay > .cell-list-container > .monaco-list > .monaco-scrollable-element,
	.notebookOverlay > .cell-list-container > .notebook-gutter > .monaco-list > .monaco-scrollable-element {
		padding-top: ${SCROLLABLE_ELEMENT_PADDING_TOP}px;
		box-sizing: border-box;
	}`);

	const link = theme.getColor(textLinkForeground);
	if (link) {
		collector.addRule(`.notebookOverlay .output a,
			.notebookOverlay .cell.markdown a { color: ${link};} `);
	}
	const activeLink = theme.getColor(textLinkActiveForeground);
	if (activeLink) {
		collector.addRule(`.notebookOverlay .output a:hover,
			.notebookOverlay .cell .output a:active { color: ${activeLink}; }`);
	}
	const shortcut = theme.getColor(textPreformatForeground);
	if (shortcut) {
		collector.addRule(`.notebookOverlay code,
			.notebookOverlay .shortcut { color: ${shortcut}; }`);
	}
	const border = theme.getColor(contrastBorder);
	if (border) {
		collector.addRule(`.notebookOverlay .monaco-editor { border-color: ${border}; }`);
	}
	const quoteBackground = theme.getColor(textBlockQuoteBackground);
	if (quoteBackground) {
		collector.addRule(`.notebookOverlay blockquote { background: ${quoteBackground}; }`);
	}
	const quoteBorder = theme.getColor(textBlockQuoteBorder);
	if (quoteBorder) {
		collector.addRule(`.notebookOverlay blockquote { border-color: ${quoteBorder}; }`);
	}

	const containerBackground = theme.getColor(notebookOutputContainerColor);
	if (containerBackground) {
		collector.addRule(`.notebookOverlay .output { background-color: ${containerBackground}; }`);
		collector.addRule(`.notebookOverlay .output-element { background-color: ${containerBackground}; }`);
	}

	const editorBackgroundColor = theme.getColor(editorBackground);
	if (editorBackgroundColor) {
		collector.addRule(`.notebookOverlay .cell .monaco-editor-background,
			.notebookOverlay .cell .margin-view-overlays,
			.notebookOverlay .cell .cell-statusbar-container { background: ${editorBackgroundColor}; }`);
		collector.addRule(`.notebookOverlay .cell-drag-image .cell-editor-container > div { background: ${editorBackgroundColor} !important; }`);

		collector.addRule(`.notebookOverlay .monaco-list-row .cell-title-toolbar { background-color: ${editorBackgroundColor}; }`);
		collector.addRule(`.notebookOverlay .monaco-list-row.cell-drag-image { background-color: ${editorBackgroundColor}; }`);
		collector.addRule(`.notebookOverlay .cell-bottom-toolbar-container .action-item { background-color: ${editorBackgroundColor} }`);
		collector.addRule(`.notebookOverlay .cell-list-top-cell-toolbar-container .action-item { background-color: ${editorBackgroundColor} }`);
	}

	const cellToolbarSeperator = theme.getColor(CELL_TOOLBAR_SEPERATOR);
	if (cellToolbarSeperator) {
		collector.addRule(`.notebookOverlay .monaco-list-row .cell-title-toolbar { border: solid 1px ${cellToolbarSeperator}; }`);
		collector.addRule(`.notebookOverlay .cell-bottom-toolbar-container .action-item { border: solid 1px ${cellToolbarSeperator} }`);
		collector.addRule(`.notebookOverlay .cell-list-top-cell-toolbar-container .action-item { border: solid 1px ${cellToolbarSeperator} }`);
		collector.addRule(`.monaco-workbench .notebookOverlay > .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row .cell-collapsed-part { border-bottom: solid 1px ${cellToolbarSeperator} }`);
		collector.addRule(`.notebookOverlay .monaco-action-bar .action-item.verticalSeparator { background-color: ${cellToolbarSeperator} }`);
	}

	const focusedCellBackgroundColor = theme.getColor(focusedCellBackground);
	if (focusedCellBackgroundColor) {
		collector.addRule(`.notebookOverlay .code-cell-row.focused .cell-focus-indicator,
			.notebookOverlay .markdown-cell-row.focused { background-color: ${focusedCellBackgroundColor} !important; }`);
		collector.addRule(`.notebookOverlay .code-cell-row.focused .cell-collapsed-part { background-color: ${focusedCellBackgroundColor} !important; }`);
	}

	const cellHoverBackgroundColor = theme.getColor(cellHoverBackground);
	if (cellHoverBackgroundColor) {
		collector.addRule(`.notebookOverlay .code-cell-row:not(.focused):hover .cell-focus-indicator,
			.notebookOverlay .code-cell-row:not(.focused).cell-output-hover .cell-focus-indicator,
			.notebookOverlay .markdown-cell-row:not(.focused):hover { background-color: ${cellHoverBackgroundColor} !important; }`);
		collector.addRule(`.notebookOverlay .code-cell-row:not(.focused):hover .cell-collapsed-part,
			.notebookOverlay .code-cell-row:not(.focused).cell-output-hover .cell-collapsed-part { background-color: ${cellHoverBackgroundColor}; }`);
	}

	const focusedCellBorderColor = theme.getColor(focusedCellBorder);
	collector.addRule(`.monaco-workbench .notebookOverlay .monaco-list:focus-within .monaco-list-row.focused .cell-focus-indicator-top:before,
			.monaco-workbench .notebookOverlay .monaco-list:focus-within .monaco-list-row.focused .cell-focus-indicator-bottom:before,
			.monaco-workbench .notebookOverlay .monaco-list:focus-within .markdown-cell-row.focused:before,
			.monaco-workbench .notebookOverlay .monaco-list:focus-within .markdown-cell-row.focused:after {
				border-color: ${focusedCellBorderColor} !important;
			}`);

	const cellSymbolHighlightColor = theme.getColor(cellSymbolHighlight);
	if (cellSymbolHighlightColor) {
		collector.addRule(`.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.code-cell-row .nb-symbolHighlight .cell-focus-indicator,
		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.markdown-cell-row .nb-symbolHighlight {
			background-color: ${cellSymbolHighlightColor} !important;
		}`);
	}

	const focusedEditorBorderColorColor = theme.getColor(focusedEditorBorderColor);
	if (focusedEditorBorderColorColor) {
		collector.addRule(`.notebookOverlay .monaco-list-row .cell-editor-focus .cell-editor-part:before { outline: solid 1px ${focusedEditorBorderColorColor}; }`);
	}

	const cellBorderColor = theme.getColor(notebookCellBorder);
	if (cellBorderColor) {
		collector.addRule(`.notebookOverlay .cell.markdown h1 { border-color: ${cellBorderColor}; }`);
		collector.addRule(`.notebookOverlay .monaco-list-row .cell-editor-part:before { outline: solid 1px ${cellBorderColor}; }`);
	}

	const cellStatusSuccessIcon = theme.getColor(cellStatusIconSuccess);
	if (cellStatusSuccessIcon) {
		collector.addRule(`.monaco-workbench .notebookOverlay .cell-statusbar-container .cell-run-status .codicon-check { color: ${cellStatusSuccessIcon} }`);
	}

	const cellStatusErrorIcon = theme.getColor(cellStatusIconError);
	if (cellStatusErrorIcon) {
		collector.addRule(`.monaco-workbench .notebookOverlay .cell-statusbar-container .cell-run-status .codicon-error { color: ${cellStatusErrorIcon} }`);
	}

	const cellStatusRunningIcon = theme.getColor(cellStatusIconRunning);
	if (cellStatusRunningIcon) {
		collector.addRule(`.monaco-workbench .notebookOverlay .cell-statusbar-container .cell-run-status .codicon-sync { color: ${cellStatusRunningIcon} }`);
	}

	const cellStatusBarHoverBg = theme.getColor(cellStatusBarItemHover);
	if (cellStatusBarHoverBg) {
		collector.addRule(`.monaco-workbench .notebookOverlay .cell-statusbar-container .cell-language-picker:hover,
		.monaco-workbench .notebookOverlay .cell-statusbar-container .cell-status-item.cell-status-item-has-command:hover { background-color: ${cellStatusBarHoverBg}; }`);
	}

	const cellInsertionIndicatorColor = theme.getColor(cellInsertionIndicator);
	if (cellInsertionIndicatorColor) {
		collector.addRule(`.notebookOverlay > .cell-list-container > .cell-list-insertion-indicator { background-color: ${cellInsertionIndicatorColor}; }`);
	}

	const scrollbarSliderBackgroundColor = theme.getColor(listScrollbarSliderBackground);
	if (scrollbarSliderBackgroundColor) {
		collector.addRule(` .notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .scrollbar > .slider { background: ${editorBackgroundColor}; } `);
		collector.addRule(` .notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .scrollbar > .slider:before { content: ""; width: 100%; height: 100%; position: absolute; background: ${scrollbarSliderBackgroundColor}; } `); /* hack to not have cells see through scroller */
	}

	const scrollbarSliderHoverBackgroundColor = theme.getColor(listScrollbarSliderHoverBackground);
	if (scrollbarSliderHoverBackgroundColor) {
		collector.addRule(` .notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .scrollbar > .slider:hover { background: ${editorBackgroundColor}; } `);
		collector.addRule(` .notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .scrollbar > .slider:hover:before { content: ""; width: 100%; height: 100%; position: absolute; background: ${scrollbarSliderHoverBackgroundColor}; } `); /* hack to not have cells see through scroller */
	}

	const scrollbarSliderActiveBackgroundColor = theme.getColor(listScrollbarSliderActiveBackground);
	if (scrollbarSliderActiveBackgroundColor) {
		collector.addRule(` .notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .scrollbar > .slider.active { background: ${editorBackgroundColor}; } `);
		collector.addRule(` .notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .scrollbar > .slider.active:before { content: ""; width: 100%; height: 100%; position: absolute; background: ${scrollbarSliderActiveBackgroundColor}; } `); /* hack to not have cells see through scroller */
	}

	// case ChangeType.Modify: return theme.getColor(editorGutterModifiedBackground);
	// case ChangeType.Add: return theme.getColor(editorGutterAddedBackground);
	// case ChangeType.Delete: return theme.getColor(editorGutterDeletedBackground);
	// diff

	const modifiedBackground = theme.getColor(editorGutterModifiedBackground);
	if (modifiedBackground) {
		collector.addRule(`
		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.code-cell-row .nb-cell-modified .cell-focus-indicator {
			background-color: ${modifiedBackground} !important;
		}

		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.markdown-cell-row .nb-cell-modified {
			background-color: ${modifiedBackground} !important;
		}`);
	}

	const addedBackground = theme.getColor(diffInserted);
	if (addedBackground) {
		collector.addRule(`
		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.code-cell-row .nb-cell-added .cell-focus-indicator {
			background-color: ${addedBackground} !important;
		}

		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.markdown-cell-row .nb-cell-added {
			background-color: ${addedBackground} !important;
		}`);
	}
	const deletedBackground = theme.getColor(diffRemoved);
	if (deletedBackground) {
		collector.addRule(`
		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.code-cell-row .nb-cell-deleted .cell-focus-indicator {
			background-color: ${deletedBackground} !important;
		}

		.monaco-workbench .notebookOverlay .monaco-list .monaco-list-row.markdown-cell-row .nb-cell-deleted {
			background-color: ${deletedBackground} !important;
		}`);
	}

	// Cell Margin
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row div.cell { margin: 0px ${CELL_MARGIN * 2}px 0px ${CELL_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row div.cell.code { margin-left: ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px; }`);
	collector.addRule(`.notebookOverlay > .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row .run-button-container { width: ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px; }`);
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row > .cell-inner-container { padding-top: ${CELL_TOP_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .markdown-cell-row > .cell-inner-container { padding-bottom: ${CELL_BOTTOM_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .output { margin: 0px ${CELL_MARGIN}px 0px ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px; }`);
	collector.addRule(`.notebookOverlay .output { width: calc(100% - ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER + (CELL_MARGIN * 2)}px); }`);

	collector.addRule(`.notebookOverlay .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row div.cell.markdown { padding-left: ${CELL_RUN_GUTTER}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row .cell-focus-indicator-top { height: ${CELL_TOP_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row .cell-focus-indicator-side { bottom: ${BOTTOM_CELL_TOOLBAR_GAP}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row.code-cell-row .cell-focus-indicator-left,
	.notebookOverlay .monaco-list .monaco-list-row.code-cell-row .cell-drag-handle { width: ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row.markdown-cell-row .cell-focus-indicator-left { width: ${CODE_CELL_LEFT_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row .cell-focus-indicator.cell-focus-indicator-right { width: ${CELL_MARGIN * 2}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row .cell-focus-indicator-bottom { height: ${CELL_BOTTOM_MARGIN}px; }`);
	collector.addRule(`.notebookOverlay .monaco-list .monaco-list-row .cell-shadow-container-bottom { top: ${CELL_BOTTOM_MARGIN}px; }`);

	collector.addRule(`.monaco-workbench .notebookOverlay > .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row .cell-collapsed-part { margin-left: ${CODE_CELL_LEFT_MARGIN + CELL_RUN_GUTTER}px; height: ${COLLAPSED_INDICATOR_HEIGHT}px; }`);
	collector.addRule(`.notebookOverlay .cell-list-top-cell-toolbar-container { top: -${SCROLLABLE_ELEMENT_PADDING_TOP}px }`);

	collector.addRule(`.monaco-workbench .notebookOverlay > .cell-list-container > .monaco-list > .monaco-scrollable-element > .monaco-list-rows > .monaco-list-row .cell-bottom-toolbar-container { height: ${BOTTOM_CELL_TOOLBAR_HEIGHT}px }`);
});
