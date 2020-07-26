/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getZoomLevel } from 'vs/base/browser/browser';
import * as DOM from 'vs/base/browser/dom';
import { domEvent } from 'vs/base/browser/event';
import { IListRenderer, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { IAction } from 'vs/base/common/actions';
import { Delayer } from 'vs/base/common/async';
import { renderCodicons } from 'vs/base/common/codicons';
import { Color } from 'vs/base/common/color';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { deepClone } from 'vs/base/common/objects';
import * as platform from 'vs/base/common/platform';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { EditorOption, EDITOR_FONT_DEFAULTS, IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { Range } from 'vs/editor/common/core/range';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { ITextModel } from 'vs/editor/common/model';
import * as modes from 'vs/editor/common/modes';
import { tokenizeLineToHTML } from 'vs/editor/common/modes/textToHtmlTokenizer';
import { IModeService } from 'vs/editor/common/services/modeService';
import { MenuEntryActionViewItem, SubmenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenu, MenuItemAction, SubmenuItemAction } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { BOTTOM_CELL_TOOLBAR_HEIGHT, CELL_BOTTOM_MARGIN, CELL_TOP_MARGIN, EDITOR_BOTTOM_PADDING, EDITOR_TOOLBAR_HEIGHT, EDITOR_TOP_PADDING } from 'vs/workbench/contrib/notebook/browser/constants';
import { CancelCellAction, ChangeCellLanguageAction, ExecuteCellAction, INotebookCellActionContext } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { BaseCellRenderTemplate, CellCollapseState, CellEditState, CodeCellRenderTemplate, ICellViewModel, INotebookCellList, INotebookEditor, isCodeCellRenderTemplate, MarkdownCellRenderTemplate } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellContextKeyManager } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellContextKeys';
import { CellMenus } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellMenus';
import { CodeCell } from 'vs/workbench/contrib/notebook/browser/view/renderers/codeCell';
import { StatefulMarkdownCell } from 'vs/workbench/contrib/notebook/browser/view/renderers/markdownCell';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { CellKind, NotebookCellMetadata, NotebookCellRunState } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { createAndFillInActionBarActionsWithVerticalSeparators, VerticalSeparator, VerticalSeparatorViewItem } from './cellActionView';

const $ = DOM.$;

export class NotebookCellListDelegate implements IListVirtualDelegate<CellViewModel> {
	private readonly lineHeight: number;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this.lineHeight = BareFontInfo.createFromRawSettings(editorOptions, getZoomLevel()).lineHeight;
	}

	getHeight(element: CellViewModel): number {
		return element.getHeight(this.lineHeight);
	}

	hasDynamicHeight(element: CellViewModel): boolean {
		return element.hasDynamicHeight();
	}

	getTemplateId(element: CellViewModel): string {
		if (element.cellKind === CellKind.Markdown) {
			return MarkdownCellRenderer.TEMPLATE_ID;
		} else {
			return CodeCellRenderer.TEMPLATE_ID;
		}
	}
}

export class CodiconActionViewItem extends MenuEntryActionViewItem {
	constructor(
		readonly _action: MenuItemAction,
		keybindingService: IKeybindingService,
		notificationService: INotificationService,
		contextMenuService: IContextMenuService
	) {
		super(_action, keybindingService, notificationService, contextMenuService);
	}
	updateLabel(): void {
		if (this.options.label && this.label) {
			this.label.innerHTML = renderCodicons(this._commandAction.label ?? '');
		}
	}
}

export class CellEditorOptions {

	private static fixedEditorOptions: IEditorOptions = {
		padding: {
			top: EDITOR_TOP_PADDING,
			bottom: EDITOR_BOTTOM_PADDING
		},
		scrollBeyondLastLine: false,
		scrollbar: {
			verticalScrollbarSize: 14,
			horizontal: 'auto',
			useShadows: true,
			verticalHasArrows: false,
			horizontalHasArrows: false,
			alwaysConsumeMouseWheel: false
		},
		renderLineHighlightOnlyWhenFocus: true,
		overviewRulerLanes: 0,
		selectOnLineNumbers: false,
		lineNumbers: 'off',
		lineDecorationsWidth: 0,
		glyphMargin: false,
		fixedOverflowWidgets: true,
		minimap: { enabled: false },
		renderValidationDecorations: 'on'
	};

	private _value: IEditorOptions;
	private disposable: IDisposable;

	private readonly _onDidChange = new Emitter<IEditorOptions>();
	readonly onDidChange: Event<IEditorOptions> = this._onDidChange.event;

	constructor(configurationService: IConfigurationService, language: string) {

		this.disposable = configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('editor')) {
				this._value = computeEditorOptions();
				this._onDidChange.fire(this.value);
			}
		});

		const computeEditorOptions = () => {
			const editorOptions = deepClone(configurationService.getValue<IEditorOptions>('editor', { overrideIdentifier: language }));
			const computed = {
				...editorOptions,
				...CellEditorOptions.fixedEditorOptions
			};

			if (!computed.folding) {
				computed.lineDecorationsWidth = 16;
			}

			return computed;
		};

		this._value = computeEditorOptions();
	}

	dispose(): void {
		this._onDidChange.dispose();
		this.disposable.dispose();
	}

	get value(): IEditorOptions {
		return this._value;
	}

	setGlyphMargin(gm: boolean): void {
		if (gm !== this._value.glyphMargin) {
			this._value.glyphMargin = gm;
			this._onDidChange.fire(this.value);
		}
	}
}

abstract class AbstractCellRenderer {
	protected readonly editorOptions: CellEditorOptions;
	protected readonly cellMenus: CellMenus;

	constructor(
		protected readonly instantiationService: IInstantiationService,
		protected readonly notebookEditor: INotebookEditor,
		protected readonly contextMenuService: IContextMenuService,
		configurationService: IConfigurationService,
		private readonly keybindingService: IKeybindingService,
		private readonly notificationService: INotificationService,
		protected readonly contextKeyServiceProvider: (container?: HTMLElement) => IContextKeyService,
		language: string,
		protected readonly dndController: CellDragAndDropController
	) {
		this.editorOptions = new CellEditorOptions(configurationService, language);
		this.cellMenus = this.instantiationService.createInstance(CellMenus);
	}

	dispose() {
		this.editorOptions.dispose();
	}

	protected createBetweenCellToolbar(container: HTMLElement, disposables: DisposableStore, contextKeyService: IContextKeyService): ToolBar {
		const toolbar = new ToolBar(container, this.contextMenuService, {
			actionViewItemProvider: action => {
				if (action instanceof MenuItemAction) {
					const item = new CodiconActionViewItem(action, this.keybindingService, this.notificationService, this.contextMenuService);
					return item;
				}

				return undefined;
			}
		});

		const cellMenu = this.instantiationService.createInstance(CellMenus);
		const menu = disposables.add(cellMenu.getCellInsertionMenu(contextKeyService));

		const actions = this.getCellToolbarActions(menu);
		toolbar.setActions(actions.primary, actions.secondary);

		return toolbar;
	}

	protected setBetweenCellToolbarContext(templateData: BaseCellRenderTemplate, element: CodeCellViewModel | MarkdownCellViewModel, context: INotebookCellActionContext): void {
		templateData.betweenCellToolbar.context = context;

		const container = templateData.bottomCellContainer;
		const bottomToolbarOffset = element.layoutInfo.bottomToolbarOffset;
		container.style.top = `${bottomToolbarOffset}px`;

		templateData.elementDisposables.add(element.onDidChangeLayout(() => {
			const bottomToolbarOffset = element.layoutInfo.bottomToolbarOffset;
			container.style.top = `${bottomToolbarOffset}px`;
		}));
	}

	protected createToolbar(container: HTMLElement): ToolBar {
		const toolbar = new ToolBar(container, this.contextMenuService, {
			getKeyBinding: action => this.keybindingService.lookupKeybinding(action.id),
			actionViewItemProvider: action => {
				if (action instanceof MenuItemAction) {
					return this.instantiationService.createInstance(MenuEntryActionViewItem, action);
				} else if (action instanceof SubmenuItemAction) {
					return this.instantiationService.createInstance(SubmenuEntryActionViewItem, action);
				}

				if (action.id === VerticalSeparator.ID) {
					return new VerticalSeparatorViewItem(undefined, action);
				}

				return undefined;
			}
		});

		return toolbar;
	}

	private getCellToolbarActions(menu: IMenu): { primary: IAction[], secondary: IAction[] } {
		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const result = { primary, secondary };

		createAndFillInActionBarActionsWithVerticalSeparators(menu, { shouldForwardArgs: true }, result, g => /^inline/.test(g));

		return result;
	}

	protected setupCellToolbarActions(templateData: BaseCellRenderTemplate, disposables: DisposableStore): void {
		const updateActions = () => {
			const actions = this.getCellToolbarActions(templateData.titleMenu);

			const hadFocus = DOM.isAncestor(document.activeElement, templateData.toolbar.getContainer());
			templateData.toolbar.setActions(actions.primary, actions.secondary);
			if (hadFocus) {
				this.notebookEditor.focus();
			}

			if (actions.primary.length || actions.secondary.length) {
				templateData.container.classList.add('cell-has-toolbar-actions');
				if (isCodeCellRenderTemplate(templateData)) {
					templateData.focusIndicatorLeft.style.top = `${EDITOR_TOOLBAR_HEIGHT + CELL_TOP_MARGIN}px`;
					templateData.focusIndicatorRight.style.top = `${EDITOR_TOOLBAR_HEIGHT + CELL_TOP_MARGIN}px`;
				}
			} else {
				templateData.container.classList.remove('cell-has-toolbar-actions');
				if (isCodeCellRenderTemplate(templateData)) {
					templateData.focusIndicatorLeft.style.top = `${CELL_TOP_MARGIN}px`;
					templateData.focusIndicatorRight.style.top = `${CELL_TOP_MARGIN}px`;
				}
			}
		};

		updateActions();
		disposables.add(templateData.titleMenu.onDidChange(() => {
			if (this.notebookEditor.isDisposed) {
				return;
			}

			updateActions();
		}));
	}

	protected commonRenderTemplate(templateData: BaseCellRenderTemplate): void {
		templateData.disposables.add(DOM.addDisposableListener(templateData.container, DOM.EventType.FOCUS, () => {
			if (templateData.currentRenderedCell) {
				this.notebookEditor.selectElement(templateData.currentRenderedCell);
			}
		}, true));

		this.addExpandListener(templateData);
	}

	protected commonRenderElement(element: ICellViewModel, index: number, templateData: BaseCellRenderTemplate): void {
		if (element.dragging) {
			templateData.container.classList.add(DRAGGING_CLASS);
		} else {
			templateData.container.classList.remove(DRAGGING_CLASS);
		}
	}

	protected addExpandListener(templateData: BaseCellRenderTemplate): void {
		templateData.disposables.add(domEvent(templateData.expandButton, DOM.EventType.CLICK)(() => {
			if (!templateData.currentRenderedCell) {
				return;
			}

			if (templateData.currentRenderedCell.collapseState === CellCollapseState.Collapsed) {
				templateData.currentRenderedCell.collapseState = CellCollapseState.Normal;
			} else if (templateData.currentRenderedCell.outputCollapseState === CellCollapseState.Collapsed) {
				templateData.currentRenderedCell.outputCollapseState = CellCollapseState.Normal;
			}
		}));
	}

	protected setupCollapsedPart(container: HTMLElement): { collapsedPart: HTMLElement, expandButton: HTMLElement } {
		const collapsedPart = DOM.append(container, $('.cell.cell-collapsed-part'));
		collapsedPart.innerHTML = renderCodicons('$(unfold)');
		const expandButton = collapsedPart.querySelector('.codicon') as HTMLElement;
		DOM.hide(collapsedPart);

		return { collapsedPart, expandButton };
	}
}

export class MarkdownCellRenderer extends AbstractCellRenderer implements IListRenderer<MarkdownCellViewModel, MarkdownCellRenderTemplate> {
	static readonly TEMPLATE_ID = 'markdown_cell';

	constructor(
		notebookEditor: INotebookEditor,
		dndController: CellDragAndDropController,
		private renderedEditors: Map<ICellViewModel, ICodeEditor | undefined>,
		contextKeyServiceProvider: (container?: HTMLElement) => IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
	) {
		super(instantiationService, notebookEditor, contextMenuService, configurationService, keybindingService, notificationService, contextKeyServiceProvider, 'markdown', dndController);
	}

	get templateId() {
		return MarkdownCellRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): MarkdownCellRenderTemplate {
		container.classList.add('markdown-cell-row');
		const disposables = new DisposableStore();
		const contextKeyService = disposables.add(this.contextKeyServiceProvider(container));
		const toolbar = disposables.add(this.createToolbar(container));
		const focusIndicator = DOM.append(container, DOM.$('.cell-focus-indicator.cell-focus-indicator-side.cell-focus-indicator-left'));
		focusIndicator.setAttribute('draggable', 'true');

		const codeInnerContent = DOM.append(container, $('.cell.code'));
		const editorPart = DOM.append(codeInnerContent, $('.cell-editor-part'));
		const editorContainer = DOM.append(editorPart, $('.cell-editor-container'));
		editorPart.style.display = 'none';

		const innerContent = DOM.append(container, $('.cell.markdown'));
		const foldingIndicator = DOM.append(container, DOM.$('.notebook-folding-indicator'));

		const { collapsedPart, expandButton } = this.setupCollapsedPart(container);

		const bottomCellContainer = DOM.append(container, $('.cell-bottom-toolbar-container'));
		const betweenCellToolbar = disposables.add(this.createBetweenCellToolbar(bottomCellContainer, disposables, contextKeyService));

		const statusBar = this.instantiationService.createInstance(CellEditorStatusBar, editorPart);
		const titleMenu = disposables.add(this.cellMenus.getCellTitleMenu(contextKeyService));

		const templateData: MarkdownCellRenderTemplate = {
			collapsedPart,
			expandButton,
			contextKeyService,
			container,
			cellContainer: innerContent,
			editorPart,
			editorContainer,
			focusIndicatorLeft: focusIndicator,
			foldingIndicator,
			disposables,
			elementDisposables: new DisposableStore(),
			toolbar,
			betweenCellToolbar,
			bottomCellContainer,
			statusBarContainer: statusBar.statusBarContainer,
			languageStatusBarItem: statusBar.languageStatusBarItem,
			titleMenu,
			toJSON: () => { return {}; }
		};
		this.dndController.registerDragHandle(templateData, () => this.getDragImage(templateData));
		this.commonRenderTemplate(templateData);

		return templateData;
	}

	private getDragImage(templateData: MarkdownCellRenderTemplate): HTMLElement {
		if (templateData.currentRenderedCell!.editState === CellEditState.Editing) {
			return this.getEditDragImage(templateData);
		} else {
			return this.getMarkdownDragImage(templateData);
		}
	}

	private getMarkdownDragImage(templateData: MarkdownCellRenderTemplate): HTMLElement {
		const dragImageContainer = DOM.$('.cell-drag-image.monaco-list-row.focused.markdown-cell-row');
		dragImageContainer.innerHTML = templateData.container.innerHTML;

		// Remove all rendered content nodes after the
		const markdownContent = dragImageContainer.querySelector('.cell.markdown')!;
		const contentNodes = markdownContent.children[0].children;
		for (let i = contentNodes.length - 1; i >= 1; i--) {
			contentNodes.item(i)!.remove();
		}

		return dragImageContainer;
	}

	private getEditDragImage(templateData: MarkdownCellRenderTemplate): HTMLElement {
		return new CodeCellDragImageRenderer().getDragImage(templateData, templateData.currentEditor!, 'markdown');
	}

	renderElement(element: MarkdownCellViewModel, index: number, templateData: MarkdownCellRenderTemplate, height: number | undefined): void {
		this.commonRenderElement(element, index, templateData);

		templateData.currentRenderedCell = element;
		templateData.currentEditor = undefined;
		templateData.editorPart!.style.display = 'none';
		templateData.cellContainer.innerHTML = '';
		let renderedHTML = element.getHTML();
		if (renderedHTML) {
			templateData.cellContainer.appendChild(renderedHTML);
		}

		if (height === undefined) {
			return;
		}

		const elementDisposables = templateData.elementDisposables;

		elementDisposables.add(new CellContextKeyManager(templateData.contextKeyService, this.notebookEditor.viewModel?.notebookDocument!, element));

		// render toolbar first
		this.setupCellToolbarActions(templateData, elementDisposables);

		const toolbarContext = <INotebookCellActionContext>{
			cell: element,
			notebookEditor: this.notebookEditor,
			$mid: 12
		};
		templateData.toolbar.context = toolbarContext;

		this.setBetweenCellToolbarContext(templateData, element, toolbarContext);

		const scopedInstaService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, templateData.contextKeyService]));
		const markdownCell = scopedInstaService.createInstance(StatefulMarkdownCell, this.notebookEditor, element, templateData, this.editorOptions.value, this.renderedEditors);
		elementDisposables.add(this.editorOptions.onDidChange(newValue => markdownCell.updateEditorOptions(newValue)));
		elementDisposables.add(markdownCell);

		templateData.languageStatusBarItem.update(element, this.notebookEditor);
	}

	disposeTemplate(templateData: MarkdownCellRenderTemplate): void {
		templateData.disposables.clear();
	}

	disposeElement(element: ICellViewModel, _index: number, templateData: MarkdownCellRenderTemplate): void {
		templateData.elementDisposables.clear();
		element.getCellDecorations().forEach(e => {
			if (e.className) {
				templateData.container.classList.remove(e.className);
			}
		});
	}
}

const DRAGGING_CLASS = 'cell-dragging';
const GLOBAL_DRAG_CLASS = 'global-drag-active';

type DragImageProvider = () => HTMLElement;

interface CellDragEvent {
	browserEvent: DragEvent;
	draggedOverCell: ICellViewModel;
	cellTop: number;
	cellHeight: number;
	dragPosRatio: number;
}

export class CellDragAndDropController extends Disposable {
	// TODO@roblourens - should probably use dataTransfer here, but any dataTransfer set makes the editor think I am dropping a file, need
	// to figure out how to prevent that
	private currentDraggedCell: ICellViewModel | undefined;

	private listInsertionIndicator: HTMLElement;

	private list!: INotebookCellList;

	private isScrolling = false;
	private scrollingDelayer: Delayer<void>;

	constructor(
		private readonly notebookEditor: INotebookEditor,
		insertionIndicatorContainer: HTMLElement
	) {
		super();

		this.listInsertionIndicator = DOM.append(insertionIndicatorContainer, $('.cell-list-insertion-indicator'));

		this._register(domEvent(document.body, DOM.EventType.DRAG_START, true)(this.onGlobalDragStart.bind(this)));
		this._register(domEvent(document.body, DOM.EventType.DRAG_END, true)(this.onGlobalDragEnd.bind(this)));

		const addCellDragListener = (eventType: string, handler: (e: CellDragEvent) => void) => {
			this._register(DOM.addDisposableListener(
				notebookEditor.getDomNode(),
				eventType,
				e => {
					const cellDragEvent = this.toCellDragEvent(e);
					if (cellDragEvent) {
						handler(cellDragEvent);
					}
				}));
		};

		addCellDragListener(DOM.EventType.DRAG_OVER, event => {
			event.browserEvent.preventDefault();
			this.onCellDragover(event);
		});
		addCellDragListener(DOM.EventType.DROP, event => {
			event.browserEvent.preventDefault();
			this.onCellDrop(event);
		});
		addCellDragListener(DOM.EventType.DRAG_LEAVE, event => {
			event.browserEvent.preventDefault();
			this.onCellDragLeave(event);
		});

		this.scrollingDelayer = new Delayer(200);
	}

	setList(value: INotebookCellList) {
		this.list = value;

		this.list.onWillScroll(e => {
			if (!e.scrollTopChanged) {
				return;
			}

			this.setInsertIndicatorVisibility(false);
			this.isScrolling = true;
			this.scrollingDelayer.trigger(() => {
				this.isScrolling = false;
			});
		});
	}

	private setInsertIndicatorVisibility(visible: boolean) {
		this.listInsertionIndicator.style.opacity = visible ? '1' : '0';
	}

	private toCellDragEvent(event: DragEvent): CellDragEvent | undefined {
		const targetTop = this.notebookEditor.getDomNode().getBoundingClientRect().top;
		const dragOffset = this.list.scrollTop + event.clientY - targetTop;
		const draggedOverCell = this.list.elementAt(dragOffset);
		if (!draggedOverCell) {
			return undefined;
		}

		const cellTop = this.list.getAbsoluteTopOfElement(draggedOverCell);
		const cellHeight = this.list.elementHeight(draggedOverCell);

		const dragPosInElement = dragOffset - cellTop;
		const dragPosRatio = dragPosInElement / cellHeight;

		return <CellDragEvent>{
			browserEvent: event,
			draggedOverCell,
			cellTop,
			cellHeight,
			dragPosRatio
		};
	}

	clearGlobalDragState() {
		this.notebookEditor.getDomNode().classList.remove(GLOBAL_DRAG_CLASS);
	}

	private onGlobalDragStart() {
		this.notebookEditor.getDomNode().classList.add(GLOBAL_DRAG_CLASS);
	}

	private onGlobalDragEnd() {
		this.notebookEditor.getDomNode().classList.remove(GLOBAL_DRAG_CLASS);
	}

	private onCellDragover(event: CellDragEvent): void {
		if (!event.browserEvent.dataTransfer) {
			return;
		}

		if (!this.currentDraggedCell) {
			event.browserEvent.dataTransfer.dropEffect = 'none';
			return;
		}

		if (this.isScrolling || this.currentDraggedCell === event.draggedOverCell) {
			this.setInsertIndicatorVisibility(false);
			return;
		}

		const dropDirection = this.getDropInsertDirection(event);
		const insertionIndicatorAbsolutePos = dropDirection === 'above' ? event.cellTop : event.cellTop + event.cellHeight;
		const insertionIndicatorTop = insertionIndicatorAbsolutePos - this.list.scrollTop;
		if (insertionIndicatorTop >= 0) {
			this.listInsertionIndicator.style.top = `${insertionIndicatorAbsolutePos - this.list.scrollTop}px`;
			this.setInsertIndicatorVisibility(true);
		} else {
			this.setInsertIndicatorVisibility(false);
		}
	}

	private getDropInsertDirection(event: CellDragEvent): 'above' | 'below' {
		return event.dragPosRatio < 0.5 ? 'above' : 'below';
	}

	private onCellDrop(event: CellDragEvent): void {
		const draggedCell = this.currentDraggedCell!;
		let draggedCells: ICellViewModel[] = [draggedCell];

		if (draggedCell.cellKind === CellKind.Markdown) {
			const currCellIndex = this.notebookEditor.viewModel!.getCellIndex(draggedCell);
			const nextVisibleCellIndex = this.notebookEditor.viewModel!.getNextVisibleCellIndex(currCellIndex);

			if (nextVisibleCellIndex > currCellIndex + 1) {
				// folding ;)
				draggedCells = this.notebookEditor.viewModel!.viewCells.slice(currCellIndex, nextVisibleCellIndex);
			}
		}

		this.dragCleanup();

		const isCopy = (event.browserEvent.ctrlKey && !platform.isMacintosh) || (event.browserEvent.altKey && platform.isMacintosh);

		const dropDirection = this.getDropInsertDirection(event);
		const insertionIndicatorAbsolutePos = dropDirection === 'above' ? event.cellTop : event.cellTop + event.cellHeight;
		const insertionIndicatorTop = insertionIndicatorAbsolutePos - this.list.scrollTop;
		const editorHeight = this.notebookEditor.getDomNode().getBoundingClientRect().height;
		if (insertionIndicatorTop < 0 || insertionIndicatorTop > editorHeight) {
			// Ignore drop, insertion point is off-screen
			return;
		}

		if (isCopy) {
			this.copyCells(draggedCells, event.draggedOverCell, dropDirection);
		} else {
			this.moveCells(draggedCells, event.draggedOverCell, dropDirection);
		}
	}

	private onCellDragLeave(event: CellDragEvent): void {
		if (!event.browserEvent.relatedTarget || !DOM.isAncestor(event.browserEvent.relatedTarget as HTMLElement, this.notebookEditor.getDomNode())) {
			this.setInsertIndicatorVisibility(false);
		}
	}

	private dragCleanup(): void {
		if (this.currentDraggedCell) {
			this.currentDraggedCell.dragging = false;
			this.currentDraggedCell = undefined;
		}

		this.setInsertIndicatorVisibility(false);
	}

	registerDragHandle(templateData: BaseCellRenderTemplate, dragImageProvider: DragImageProvider): void {
		const container = templateData.container;
		const dragHandle = templateData.focusIndicatorLeft;

		templateData.disposables.add(domEvent(dragHandle, DOM.EventType.DRAG_END)(() => {
			// Note, templateData may have a different element rendered into it by now
			container.classList.remove(DRAGGING_CLASS);
			this.dragCleanup();
		}));

		templateData.disposables.add(domEvent(dragHandle, DOM.EventType.DRAG_START)(event => {
			if (!event.dataTransfer) {
				return;
			}

			this.currentDraggedCell = templateData.currentRenderedCell!;
			this.currentDraggedCell.dragging = true;

			const dragImage = dragImageProvider();
			container.parentElement!.appendChild(dragImage);
			event.dataTransfer.setDragImage(dragImage, 0, 0);
			setTimeout(() => container.parentElement!.removeChild(dragImage!), 0); // Comment this out to debug drag image layout

			container.classList.add(DRAGGING_CLASS);
		}));
	}

	private async moveCells(draggedCells: ICellViewModel[], ontoCell: ICellViewModel, direction: 'above' | 'below') {
		const relativeToIndex = this.notebookEditor!.viewModel!.getCellIndex(ontoCell);
		const newIdx = direction === 'above' ? relativeToIndex : relativeToIndex + 1;

		this.notebookEditor.textModel!.pushStackElement('Move Cells');
		for (let i = draggedCells.length - 1; i >= 0; i--) {
			await this.notebookEditor.moveCellToIdx(draggedCells[i], newIdx);
		}

		this.notebookEditor.textModel!.pushStackElement('Move Cells');
	}

	private copyCells(draggedCells: ICellViewModel[], ontoCell: ICellViewModel, direction: 'above' | 'below') {
		this.notebookEditor.textModel!.pushStackElement('Copy Cells');
		let firstNewCell: ICellViewModel | undefined = undefined;
		let firstNewCellState: CellEditState = CellEditState.Preview;
		for (let i = 0; i < draggedCells.length; i++) {
			const draggedCell = draggedCells[i];
			const newCell = this.notebookEditor.insertNotebookCell(ontoCell, draggedCell.cellKind, direction, draggedCell.getText());

			if (newCell && !firstNewCell) {
				firstNewCell = newCell;
				firstNewCellState = draggedCell.editState;
			}
		}

		if (firstNewCell) {
			this.notebookEditor.focusNotebookCell(firstNewCell, firstNewCellState === CellEditState.Editing ? 'editor' : 'container');
		}

		this.notebookEditor.textModel!.pushStackElement('Copy Cells');
	}
}

export class CellLanguageStatusBarItem extends Disposable {
	private readonly labelElement: HTMLElement;

	private cell: ICellViewModel | undefined;
	private editor: INotebookEditor | undefined;

	private cellDisposables: DisposableStore;

	constructor(
		readonly container: HTMLElement,
		@IModeService private readonly modeService: IModeService,
		@IInstantiationService private readonly instantiationService: IInstantiationService
	) {
		super();
		this.labelElement = DOM.append(container, $('.cell-language-picker'));
		this.labelElement.tabIndex = 0;

		this._register(DOM.addDisposableListener(this.labelElement, DOM.EventType.CLICK, () => {
			this.instantiationService.invokeFunction(accessor => {
				new ChangeCellLanguageAction().run(accessor, { notebookEditor: this.editor!, cell: this.cell! });
			});
		}));
		this._register(this.cellDisposables = new DisposableStore());
	}

	update(cell: ICellViewModel, editor: INotebookEditor): void {
		this.cellDisposables.clear();
		this.cell = cell;
		this.editor = editor;

		this.render();
		this.cellDisposables.add(this.cell.model.onDidChangeLanguage(() => this.render()));
	}

	private render(): void {
		const modeId = this.modeService.getModeIdForLanguageName(this.cell!.language) || this.cell!.language;
		this.labelElement.textContent = this.modeService.getLanguageName(modeId) || this.modeService.getLanguageName('plaintext');
	}
}

class EditorTextRenderer {

	getRichText(editor: ICodeEditor, modelRange: Range): string | null {
		const model = editor.getModel();
		if (!model) {
			return null;
		}

		const colorMap = this.getDefaultColorMap();
		const fontInfo = editor.getOptions().get(EditorOption.fontInfo);
		const fontFamily = fontInfo.fontFamily === EDITOR_FONT_DEFAULTS.fontFamily ? fontInfo.fontFamily : `'${fontInfo.fontFamily}', ${EDITOR_FONT_DEFAULTS.fontFamily}`;

		return `<div style="`
			+ `color: ${colorMap[modes.ColorId.DefaultForeground]};`
			+ `background-color: ${colorMap[modes.ColorId.DefaultBackground]};`
			+ `font-family: ${fontFamily};`
			+ `font-weight: ${fontInfo.fontWeight};`
			+ `font-size: ${fontInfo.fontSize}px;`
			+ `line-height: ${fontInfo.lineHeight}px;`
			+ `white-space: pre;`
			+ `">`
			+ this.getRichTextLines(model, modelRange, colorMap)
			+ '</div>';
	}

	private getRichTextLines(model: ITextModel, modelRange: Range, colorMap: string[]): string {
		const startLineNumber = modelRange.startLineNumber;
		const startColumn = modelRange.startColumn;
		const endLineNumber = modelRange.endLineNumber;
		const endColumn = modelRange.endColumn;

		const tabSize = model.getOptions().tabSize;

		let result = '';

		for (let lineNumber = startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
			const lineTokens = model.getLineTokens(lineNumber);
			const lineContent = lineTokens.getLineContent();
			const startOffset = (lineNumber === startLineNumber ? startColumn - 1 : 0);
			const endOffset = (lineNumber === endLineNumber ? endColumn - 1 : lineContent.length);

			if (lineContent === '') {
				result += '<br>';
			} else {
				result += tokenizeLineToHTML(lineContent, lineTokens.inflate(), colorMap, startOffset, endOffset, tabSize, platform.isWindows);
			}
		}

		return result;
	}

	private getDefaultColorMap(): string[] {
		let colorMap = modes.TokenizationRegistry.getColorMap();
		let result: string[] = ['#000000'];
		if (colorMap) {
			for (let i = 1, len = colorMap.length; i < len; i++) {
				result[i] = Color.Format.CSS.formatHex(colorMap[i]);
			}
		}
		return result;
	}
}

class CodeCellDragImageRenderer {
	getDragImage(templateData: BaseCellRenderTemplate, editor: ICodeEditor, type: 'code' | 'markdown'): HTMLElement {
		let dragImage = this.getDragImageImpl(templateData, editor, type);
		if (!dragImage) {
			// TODO@roblourens I don't think this can happen
			dragImage = document.createElement('div');
			dragImage.textContent = '1 cell';
		}

		return dragImage;
	}

	private getDragImageImpl(templateData: BaseCellRenderTemplate, editor: ICodeEditor, type: 'code' | 'markdown'): HTMLElement | null {
		const dragImageContainer = DOM.$(`.cell-drag-image.monaco-list-row.focused.${type}-cell-row`);
		dragImageContainer.innerHTML = templateData.container.innerHTML;

		const editorContainer = dragImageContainer.querySelector('.cell-editor-container');
		if (!editorContainer) {
			return null;
		}

		const richEditorText = new EditorTextRenderer().getRichText(editor, new Range(1, 1, 1, 1000));
		if (!richEditorText) {
			return null;
		}

		editorContainer.innerHTML = richEditorText;

		return dragImageContainer;
	}
}

class CellEditorStatusBar {
	readonly cellStatusMessageContainer: HTMLElement;
	readonly cellRunStatusContainer: HTMLElement;
	readonly statusBarContainer: HTMLElement;
	readonly languageStatusBarItem: CellLanguageStatusBarItem;
	readonly durationContainer: HTMLElement;

	constructor(
		container: HTMLElement,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		this.statusBarContainer = DOM.append(container, $('.cell-statusbar-container'));
		const leftStatusBarItems = DOM.append(this.statusBarContainer, $('.cell-status-left'));
		const rightStatusBarItems = DOM.append(this.statusBarContainer, $('.cell-status-right'));
		this.cellRunStatusContainer = DOM.append(leftStatusBarItems, $('.cell-run-status'));
		this.durationContainer = DOM.append(leftStatusBarItems, $('.cell-run-duration'));
		this.cellStatusMessageContainer = DOM.append(leftStatusBarItems, $('.cell-status-message'));
		this.languageStatusBarItem = instantiationService.createInstance(CellLanguageStatusBarItem, rightStatusBarItems);
	}
}

export class CodeCellRenderer extends AbstractCellRenderer implements IListRenderer<CodeCellViewModel, CodeCellRenderTemplate> {
	static readonly TEMPLATE_ID = 'code_cell';

	constructor(
		protected notebookEditor: INotebookEditor,
		private renderedEditors: Map<ICellViewModel, ICodeEditor | undefined>,
		dndController: CellDragAndDropController,
		contextKeyServiceProvider: (container?: HTMLElement) => IContextKeyService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
	) {
		super(instantiationService, notebookEditor, contextMenuService, configurationService, keybindingService, notificationService, contextKeyServiceProvider, 'python', dndController);
	}

	get templateId() {
		return CodeCellRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): CodeCellRenderTemplate {
		container.classList.add('code-cell-row');
		const disposables = new DisposableStore();
		const contextKeyService = disposables.add(this.contextKeyServiceProvider(container));

		DOM.append(container, $('.cell-focus-indicator.cell-focus-indicator-top'));
		const toolbar = disposables.add(this.createToolbar(container));
		const focusIndicator = DOM.append(container, DOM.$('.cell-focus-indicator.cell-focus-indicator-side.cell-focus-indicator-left'));
		focusIndicator.setAttribute('draggable', 'true');

		const cellContainer = DOM.append(container, $('.cell.code'));
		const runButtonContainer = DOM.append(cellContainer, $('.run-button-container'));
		const runToolbar = this.createToolbar(runButtonContainer);
		disposables.add(runToolbar);

		const executionOrderLabel = DOM.append(runButtonContainer, $('div.execution-count-label'));

		// create a special context key service that set the inCompositeEditor-contextkey
		const editorContextKeyService = disposables.add(this.contextKeyServiceProvider(container));
		const editorInstaService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, editorContextKeyService]));
		EditorContextKeys.inCompositeEditor.bindTo(editorContextKeyService).set(true);

		const editorPart = DOM.append(cellContainer, $('.cell-editor-part'));
		const editorContainer = DOM.append(editorPart, $('.cell-editor-container'));
		const editor = editorInstaService.createInstance(CodeEditorWidget, editorContainer, {
			...this.editorOptions.value,
			dimension: {
				width: 0,
				height: 0
			}
		}, {});

		disposables.add(this.editorOptions.onDidChange(newValue => editor.updateOptions(newValue)));

		const { collapsedPart, expandButton } = this.setupCollapsedPart(container);

		const progressBar = new ProgressBar(editorPart);
		progressBar.hide();
		disposables.add(progressBar);

		const statusBar = this.instantiationService.createInstance(CellEditorStatusBar, editorPart);
		const timer = new TimerRenderer(statusBar.durationContainer);

		const outputContainer = DOM.append(container, $('.output'));

		const focusIndicatorRight = DOM.append(container, DOM.$('.cell-focus-indicator.cell-focus-indicator-side.cell-focus-indicator-right'));
		focusIndicatorRight.setAttribute('draggable', 'true');

		const focusSinkElement = DOM.append(container, $('.cell-editor-focus-sink'));
		focusSinkElement.setAttribute('tabindex', '0');
		const bottomCellContainer = DOM.append(container, $('.cell-bottom-toolbar-container'));
		const focusIndicatorBottom = DOM.append(container, $('.cell-focus-indicator.cell-focus-indicator-bottom'));
		const betweenCellToolbar = this.createBetweenCellToolbar(bottomCellContainer, disposables, contextKeyService);

		const titleMenu = disposables.add(this.cellMenus.getCellTitleMenu(contextKeyService));

		const templateData: CodeCellRenderTemplate = {
			editorPart,
			collapsedPart,
			expandButton,
			contextKeyService,
			container,
			cellContainer,
			statusBarContainer: statusBar.statusBarContainer,
			cellRunStatusContainer: statusBar.cellRunStatusContainer,
			cellStatusMessageContainer: statusBar.cellStatusMessageContainer,
			languageStatusBarItem: statusBar.languageStatusBarItem,
			progressBar,
			focusIndicatorLeft: focusIndicator,
			focusIndicatorRight,
			focusIndicatorBottom,
			toolbar,
			betweenCellToolbar,
			focusSinkElement,
			runToolbar,
			runButtonContainer,
			executionOrderLabel,
			outputContainer,
			editor,
			disposables,
			elementDisposables: new DisposableStore(),
			bottomCellContainer,
			timer,
			titleMenu,
			toJSON: () => { return {}; }
		};

		this.dndController.registerDragHandle(templateData, () => new CodeCellDragImageRenderer().getDragImage(templateData, templateData.editor, 'code'));

		disposables.add(DOM.addDisposableListener(focusSinkElement, DOM.EventType.FOCUS, () => {
			if (templateData.currentRenderedCell && (templateData.currentRenderedCell as CodeCellViewModel).outputs.length) {
				this.notebookEditor.focusNotebookCell(templateData.currentRenderedCell, 'output');
			}
		}));

		this.commonRenderTemplate(templateData);

		return templateData;
	}

	private updateForRunState(runState: NotebookCellRunState | undefined, templateData: CodeCellRenderTemplate): void {
		if (typeof runState === 'undefined') {
			runState = NotebookCellRunState.Idle;
		}

		if (runState === NotebookCellRunState.Running) {
			templateData.progressBar.infinite().show(500);

			templateData.runToolbar.setActions([
				this.instantiationService.createInstance(CancelCellAction)
			]);
		} else {
			templateData.progressBar.hide();

			templateData.runToolbar.setActions([
				this.instantiationService.createInstance(ExecuteCellAction)
			]);
		}
	}

	private updateForOutputs(element: CodeCellViewModel, templateData: CodeCellRenderTemplate): void {
		if (element.outputs.length) {
			DOM.show(templateData.focusSinkElement);
		} else {
			DOM.hide(templateData.focusSinkElement);
		}
	}

	private updateForMetadata(element: CodeCellViewModel, templateData: CodeCellRenderTemplate): void {
		const metadata = element.getEvaluatedMetadata(this.notebookEditor.viewModel!.notebookDocument.metadata);
		DOM.toggleClass(templateData.cellContainer, 'runnable', !!metadata.runnable);
		this.updateExecutionOrder(metadata, templateData);
		templateData.cellStatusMessageContainer.textContent = metadata?.statusMessage || '';

		if (metadata.runState === NotebookCellRunState.Success) {
			templateData.cellRunStatusContainer.innerHTML = renderCodicons('$(check)');
		} else if (metadata.runState === NotebookCellRunState.Error) {
			templateData.cellRunStatusContainer.innerHTML = renderCodicons('$(error)');
		} else if (metadata.runState === NotebookCellRunState.Running) {
			templateData.cellRunStatusContainer.innerHTML = renderCodicons('$(sync~spin)');
		} else {
			templateData.cellRunStatusContainer.innerHTML = '';
		}

		if (metadata.runState === NotebookCellRunState.Running) {
			if (metadata.runStartTime) {
				templateData.elementDisposables.add(templateData.timer.start(metadata.runStartTime));
			} else {
				templateData.timer.clear();
			}
		} else if (typeof metadata.lastRunDuration === 'number') {
			templateData.timer.show(metadata.lastRunDuration);
		} else {
			templateData.timer.clear();
		}

		if (typeof metadata.breakpointMargin === 'boolean') {
			this.editorOptions.setGlyphMargin(metadata.breakpointMargin);
		}

		this.updateForRunState(metadata.runState, templateData);
	}

	private updateExecutionOrder(metadata: NotebookCellMetadata, templateData: CodeCellRenderTemplate): void {
		if (metadata.hasExecutionOrder) {
			const executionOrderLabel = typeof metadata.executionOrder === 'number' ?
				`[${metadata.executionOrder}]` :
				'[ ]';
			templateData.executionOrderLabel.innerText = executionOrderLabel;
		} else {
			templateData.executionOrderLabel.innerText = '';
		}
	}

	private updateForHover(element: CodeCellViewModel, templateData: CodeCellRenderTemplate): void {
		DOM.toggleClass(templateData.container, 'cell-output-hover', element.outputIsHovered);
	}

	private updateForLayout(element: CodeCellViewModel, templateData: CodeCellRenderTemplate): void {
		templateData.focusIndicatorLeft.style.height = `${element.layoutInfo.indicatorHeight}px`;
		templateData.focusIndicatorRight.style.height = `${element.layoutInfo.indicatorHeight}px`;
		templateData.focusIndicatorBottom.style.top = `${element.layoutInfo.totalHeight - BOTTOM_CELL_TOOLBAR_HEIGHT - CELL_BOTTOM_MARGIN}px`;
		templateData.outputContainer.style.top = `${element.layoutInfo.outputContainerOffset}px`;
	}

	renderElement(element: CodeCellViewModel, index: number, templateData: CodeCellRenderTemplate, height: number | undefined): void {
		const removedClassNames: string[] = [];
		templateData.container.classList.forEach(className => {
			if (/^nb\-.*$/.test(className)) {
				removedClassNames.push(className);
			}
		});

		removedClassNames.forEach(className => {
			templateData.container.classList.remove(className);
		});

		this.commonRenderElement(element, index, templateData);

		templateData.currentRenderedCell = element;

		if (height === undefined) {
			return;
		}

		templateData.outputContainer.innerHTML = '';

		const elementDisposables = templateData.elementDisposables;

		elementDisposables.add(this.instantiationService.createInstance(CodeCell, this.notebookEditor, element, templateData));
		this.renderedEditors.set(element, templateData.editor);

		elementDisposables.add(new CellContextKeyManager(templateData.contextKeyService, this.notebookEditor.viewModel?.notebookDocument!, element));

		this.updateForLayout(element, templateData);
		elementDisposables.add(element.onDidChangeLayout(() => {
			this.updateForLayout(element, templateData);
		}));

		this.updateForMetadata(element, templateData);
		this.updateForHover(element, templateData);
		elementDisposables.add(element.onDidChangeState((e) => {
			if (e.metadataChanged) {
				this.updateForMetadata(element, templateData);
			}

			if (e.outputIsHoveredChanged) {
				this.updateForHover(element, templateData);
			}
		}));

		this.updateForOutputs(element, templateData);
		elementDisposables.add(element.onDidChangeOutputs(_e => this.updateForOutputs(element, templateData)));

		this.setupCellToolbarActions(templateData, elementDisposables);

		const toolbarContext = <INotebookCellActionContext>{
			cell: element,
			cellTemplate: templateData,
			notebookEditor: this.notebookEditor,
			$mid: 12
		};
		templateData.toolbar.context = toolbarContext;
		templateData.runToolbar.context = toolbarContext;

		this.setBetweenCellToolbarContext(templateData, element, toolbarContext);

		templateData.languageStatusBarItem.update(element, this.notebookEditor);
	}

	disposeTemplate(templateData: CodeCellRenderTemplate): void {
		templateData.disposables.clear();
	}

	disposeElement(element: ICellViewModel, index: number, templateData: CodeCellRenderTemplate, height: number | undefined): void {
		templateData.elementDisposables.clear();
		this.renderedEditors.delete(element);
	}
}

export class TimerRenderer {
	constructor(private readonly container: HTMLElement) {
		DOM.hide(container);
	}

	private intervalTimer: number | undefined;

	start(startTime: number): IDisposable {
		this.stop();

		DOM.show(this.container);
		const intervalTimer = setInterval(() => {
			const duration = Date.now() - startTime;
			this.container.textContent = this.formatDuration(duration);
		}, 100);
		this.intervalTimer = intervalTimer as unknown as number | undefined;

		return toDisposable(() => {
			clearInterval(intervalTimer);
		});
	}

	stop() {
		if (this.intervalTimer) {
			clearInterval(this.intervalTimer);
		}
	}

	show(duration: number) {
		this.stop();

		DOM.show(this.container);
		this.container.textContent = this.formatDuration(duration);
	}

	clear() {
		DOM.hide(this.container);
		this.stop();
		this.container.textContent = '';
	}

	private formatDuration(duration: number) {
		const seconds = Math.floor(duration / 1000);
		const tenths = String(duration - seconds * 1000).charAt(0);

		return `${seconds}.${tenths}s`;
	}
}
