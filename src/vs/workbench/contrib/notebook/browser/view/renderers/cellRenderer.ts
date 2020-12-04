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
import { renderCodicons } from 'vs/base/browser/codicons';
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
import { localize } from 'vs/nls';
import { MenuEntryActionViewItem, SubmenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenu, MenuItemAction, SubmenuItemAction } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { BOTTOM_CELL_TOOLBAR_GAP, CELL_BOTTOM_MARGIN, CELL_TOP_MARGIN, EDITOR_BOTTOM_PADDING, EDITOR_BOTTOM_PADDING_WITHOUT_STATUSBAR, EDITOR_TOOLBAR_HEIGHT } from 'vs/workbench/contrib/notebook/browser/constants';
import { CancelCellAction, DeleteCellAction, ExecuteCellAction, INotebookCellActionContext } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { BaseCellRenderTemplate, CellEditState, CodeCellRenderTemplate, EditorTopPaddingChangeEvent, EXPAND_CELL_CONTENT_COMMAND_ID, getEditorTopPadding, ICellViewModel, INotebookEditor, isCodeCellRenderTemplate, MarkdownCellRenderTemplate } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellContextKeyManager } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellContextKeys';
import { CellMenus } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellMenus';
import { CellEditorStatusBar } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellWidgets';
import { CodeCell } from 'vs/workbench/contrib/notebook/browser/view/renderers/codeCell';
import { CellDragAndDropController, DRAGGING_CLASS } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellDnd';
import { StatefulMarkdownCell } from 'vs/workbench/contrib/notebook/browser/view/renderers/markdownCell';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { CellEditType, CellKind, NotebookCellMetadata, NotebookCellRunState, NotebookCellsChangeType, ShowCellStatusBarKey } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { CodiconActionViewItem, createAndFillInActionBarActionsWithVerticalSeparators, VerticalSeparator, VerticalSeparatorViewItem } from './cellActionView';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { errorStateIcon, successStateIcon, unfoldIcon } from 'vs/workbench/contrib/notebook/browser/notebookIcons';

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

export class CellEditorOptions {

	private static fixedEditorOptions: IEditorOptions = {
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
			if (e.affectsConfiguration('editor') || e.affectsConfiguration(ShowCellStatusBarKey)) {
				this._value = computeEditorOptions();
				this._onDidChange.fire(this.value);
			}
		});

		EditorTopPaddingChangeEvent(() => {
			this._value = computeEditorOptions();
			this._onDidChange.fire(this.value);

		});

		const computeEditorOptions = () => {
			const showCellStatusBar = configurationService.getValue<boolean>(ShowCellStatusBarKey);
			const editorPadding = {
				top: getEditorTopPadding(),
				bottom: showCellStatusBar ? EDITOR_BOTTOM_PADDING : EDITOR_BOTTOM_PADDING_WITHOUT_STATUSBAR
			};

			const editorOptions = deepClone(configurationService.getValue<IEditorOptions>('editor', { overrideIdentifier: language }));
			const computed = {
				...editorOptions,
				...CellEditorOptions.fixedEditorOptions,
				...{ padding: editorPadding }
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
					const item = new CodiconActionViewItem(action, this.keybindingService, this.notificationService);
					return item;
				}

				return undefined;
			}
		});

		const cellMenu = this.instantiationService.createInstance(CellMenus);
		const menu = disposables.add(cellMenu.getCellInsertionMenu(contextKeyService));

		const actions = this.getCellToolbarActions(menu, false);
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

	protected createToolbar(container: HTMLElement, elementClass?: string): ToolBar {
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
			},
			renderDropdownAsChildElement: true
		});

		if (elementClass) {
			toolbar.getElement().classList.add(elementClass);
		}

		return toolbar;
	}

	private getCellToolbarActions(menu: IMenu, alwaysFillSecondaryActions: boolean): { primary: IAction[], secondary: IAction[] } {
		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const result = { primary, secondary };

		createAndFillInActionBarActionsWithVerticalSeparators(menu, { shouldForwardArgs: true }, result, alwaysFillSecondaryActions, g => /^inline/.test(g));

		return result;
	}

	protected setupCellToolbarActions(templateData: BaseCellRenderTemplate, disposables: DisposableStore): void {
		const updateActions = () => {
			const actions = this.getCellToolbarActions(templateData.titleMenu, true);

			const hadFocus = DOM.isAncestor(document.activeElement, templateData.toolbar.getElement());
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

		// #103926
		let dropdownIsVisible = false;
		let deferredUpdate: (() => void) | undefined;

		updateActions();
		disposables.add(templateData.titleMenu.onDidChange(() => {
			if (this.notebookEditor.isDisposed) {
				return;
			}

			if (dropdownIsVisible) {
				deferredUpdate = () => updateActions();
				return;
			}

			updateActions();
		}));
		disposables.add(templateData.toolbar.onDidChangeDropdownVisibility(visible => {
			dropdownIsVisible = visible;

			if (deferredUpdate && !visible) {
				setTimeout(() => {
					if (deferredUpdate) {
						deferredUpdate();
					}
				}, 0);
				deferredUpdate = undefined;
			}
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

	protected commonRenderElement(element: ICellViewModel, templateData: BaseCellRenderTemplate): void {
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

			const textModel = this.notebookEditor.viewModel!.notebookDocument;
			const index = textModel.cells.indexOf(templateData.currentRenderedCell.model);

			if (index < 0) {
				return;
			}

			if (templateData.currentRenderedCell.metadata?.inputCollapsed) {
				textModel.applyEdits(textModel.versionId, [
					{ editType: CellEditType.Metadata, index, metadata: { ...templateData.currentRenderedCell.metadata, inputCollapsed: false } }
				], true, undefined, () => undefined, undefined);
			} else if (templateData.currentRenderedCell.metadata?.outputCollapsed) {
				textModel.applyEdits(textModel.versionId, [
					{ editType: CellEditType.Metadata, index, metadata: { ...templateData.currentRenderedCell.metadata, outputCollapsed: false } }
				], true, undefined, () => undefined, undefined);
			}
		}));
	}

	protected setupCollapsedPart(container: HTMLElement): { collapsedPart: HTMLElement, expandButton: HTMLElement } {
		const collapsedPart = DOM.append(container, $('.cell.cell-collapsed-part', undefined, $('span.expandButton' + ThemeIcon.asCSSSelector(unfoldIcon))));
		const expandButton = collapsedPart.querySelector('.expandButton') as HTMLElement;
		const keybinding = this.keybindingService.lookupKeybinding(EXPAND_CELL_CONTENT_COMMAND_ID);
		let title = localize('cellExpandButtonLabel', "Expand");
		if (keybinding) {
			title += ` (${keybinding.getLabel()})`;
		}

		collapsedPart.title = title;
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

	renderTemplate(rootContainer: HTMLElement): MarkdownCellRenderTemplate {
		rootContainer.classList.add('markdown-cell-row');
		const container = DOM.append(rootContainer, DOM.$('.cell-inner-container'));
		const disposables = new DisposableStore();
		const contextKeyService = disposables.add(this.contextKeyServiceProvider(container));
		const decorationContainer = DOM.append(rootContainer, $('.cell-decoration'));
		const titleToolbarContainer = DOM.append(container, $('.cell-title-toolbar'));
		const toolbar = disposables.add(this.createToolbar(titleToolbarContainer));
		const deleteToolbar = disposables.add(this.createToolbar(titleToolbarContainer, 'cell-delete-toolbar'));
		deleteToolbar.setActions([this.instantiationService.createInstance(DeleteCellAction)]);

		const focusIndicatorLeft = DOM.append(container, DOM.$('.cell-focus-indicator.cell-focus-indicator-side.cell-focus-indicator-left'));

		const codeInnerContent = DOM.append(container, $('.cell.code'));
		const editorPart = DOM.append(codeInnerContent, $('.cell-editor-part'));
		const editorContainer = DOM.append(editorPart, $('.cell-editor-container'));
		editorPart.style.display = 'none';

		const innerContent = DOM.append(container, $('.cell.markdown'));
		const foldingIndicator = DOM.append(focusIndicatorLeft, DOM.$('.notebook-folding-indicator'));

		const { collapsedPart, expandButton } = this.setupCollapsedPart(container);

		const bottomCellContainer = DOM.append(container, $('.cell-bottom-toolbar-container'));
		const betweenCellToolbar = disposables.add(this.createBetweenCellToolbar(bottomCellContainer, disposables, contextKeyService));

		const statusBar = disposables.add(this.instantiationService.createInstance(CellEditorStatusBar, editorPart));
		DOM.hide(statusBar.durationContainer);
		DOM.hide(statusBar.cellRunStatusContainer);

		const titleMenu = disposables.add(this.cellMenus.getCellTitleMenu(contextKeyService));

		const templateData: MarkdownCellRenderTemplate = {
			rootContainer,
			collapsedPart,
			expandButton,
			contextKeyService,
			container,
			decorationContainer,
			cellContainer: innerContent,
			editorPart,
			editorContainer,
			focusIndicatorLeft,
			foldingIndicator,
			disposables,
			elementDisposables: new DisposableStore(),
			toolbar,
			deleteToolbar,
			betweenCellToolbar,
			bottomCellContainer,
			titleMenu,
			statusBar,
			toJSON: () => { return {}; }
		};
		this.dndController.registerDragHandle(templateData, rootContainer, container, () => this.getDragImage(templateData));
		this.commonRenderTemplate(templateData);

		return templateData;
	}

	private getDragImage(templateData: MarkdownCellRenderTemplate): HTMLElement {
		if (templateData.currentRenderedCell?.editState === CellEditState.Editing) {
			return this.getEditDragImage(templateData);
		} else {
			return this.getMarkdownDragImage(templateData);
		}
	}

	private getMarkdownDragImage(templateData: MarkdownCellRenderTemplate): HTMLElement {
		const dragImageContainer = DOM.$('.cell-drag-image.monaco-list-row.focused.markdown-cell-row');
		DOM.reset(dragImageContainer, templateData.container.cloneNode(true));

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
		if (!this.notebookEditor.hasModel()) {
			throw new Error('The notebook editor is not attached with view model yet.');
		}

		const removedClassNames: string[] = [];
		templateData.rootContainer.classList.forEach(className => {
			if (/^nb\-.*$/.test(className)) {
				removedClassNames.push(className);
			}
		});

		removedClassNames.forEach(className => {
			templateData.rootContainer.classList.remove(className);
		});

		templateData.decorationContainer.innerText = '';

		this.commonRenderElement(element, templateData);

		templateData.currentRenderedCell = element;
		templateData.currentEditor = undefined;
		templateData.editorPart.style.display = 'none';
		templateData.cellContainer.innerText = '';

		if (height === undefined) {
			return;
		}

		const elementDisposables = templateData.elementDisposables;

		const generateCellTopDecorations = () => {
			templateData.decorationContainer.innerText = '';

			element.getCellDecorations().filter(options => options.topClassName !== undefined).forEach(options => {
				templateData.decorationContainer.append(DOM.$(`.${options.topClassName!}`));
			});
		};

		elementDisposables.add(element.onCellDecorationsChanged((e) => {
			const modified = e.added.find(e => e.topClassName) || e.removed.find(e => e.topClassName);

			if (modified) {
				generateCellTopDecorations();
			}
		}));

		elementDisposables.add(new CellContextKeyManager(templateData.contextKeyService, this.notebookEditor, this.notebookEditor.viewModel.notebookDocument!, element));

		// render toolbar first
		this.setupCellToolbarActions(templateData, elementDisposables);

		const toolbarContext = <INotebookCellActionContext>{
			cell: element,
			notebookEditor: this.notebookEditor,
			$mid: 12
		};
		templateData.toolbar.context = toolbarContext;
		templateData.deleteToolbar.context = toolbarContext;

		this.setBetweenCellToolbarContext(templateData, element, toolbarContext);

		const scopedInstaService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, templateData.contextKeyService]));
		const markdownCell = scopedInstaService.createInstance(StatefulMarkdownCell, this.notebookEditor, element, templateData, this.editorOptions.value, this.renderedEditors);
		elementDisposables.add(this.editorOptions.onDidChange(newValue => markdownCell.updateEditorOptions(newValue)));
		elementDisposables.add(markdownCell);

		templateData.statusBar.update(toolbarContext);
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

class EditorTextRenderer {

	private _ttPolicy = window.trustedTypes?.createPolicy('cellRendererEditorText', {
		createHTML(input) { return input; }
	});

	getRichText(editor: ICodeEditor, modelRange: Range): HTMLElement | null {
		const model = editor.getModel();
		if (!model) {
			return null;
		}

		const colorMap = this.getDefaultColorMap();
		const fontInfo = editor.getOptions().get(EditorOption.fontInfo);
		const fontFamily = fontInfo.fontFamily === EDITOR_FONT_DEFAULTS.fontFamily ? fontInfo.fontFamily : `'${fontInfo.fontFamily}', ${EDITOR_FONT_DEFAULTS.fontFamily}`;


		const style = ``
			+ `color: ${colorMap[modes.ColorId.DefaultForeground]};`
			+ `background-color: ${colorMap[modes.ColorId.DefaultBackground]};`
			+ `font-family: ${fontFamily};`
			+ `font-weight: ${fontInfo.fontWeight};`
			+ `font-size: ${fontInfo.fontSize}px;`
			+ `line-height: ${fontInfo.lineHeight}px;`
			+ `white-space: pre;`;

		const element = DOM.$('div', { style });

		const linesHtml = this.getRichTextLinesAsHtml(model, modelRange, colorMap);
		element.innerHTML = linesHtml as unknown as string;
		return element;
	}

	private getRichTextLinesAsHtml(model: ITextModel, modelRange: Range, colorMap: string[]): string | TrustedHTML {
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

		return this._ttPolicy
			? this._ttPolicy.createHTML(result)
			: result;
	}

	private getDefaultColorMap(): string[] {
		const colorMap = modes.TokenizationRegistry.getColorMap();
		const result: string[] = ['#000000'];
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
		const dragImageContainer = templateData.container.cloneNode(true) as HTMLElement;
		dragImageContainer.classList.forEach(c => dragImageContainer.classList.remove(c));
		dragImageContainer.classList.add('cell-drag-image', 'monaco-list-row', 'focused', `${type}-cell-row`);

		const editorContainer: HTMLElement | null = dragImageContainer.querySelector('.cell-editor-container');
		if (!editorContainer) {
			return null;
		}

		const richEditorText = new EditorTextRenderer().getRichText(editor, new Range(1, 1, 1, 1000));
		if (!richEditorText) {
			return null;
		}
		DOM.reset(editorContainer, richEditorText);

		return dragImageContainer;
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

	renderTemplate(rootContainer: HTMLElement): CodeCellRenderTemplate {
		rootContainer.classList.add('code-cell-row');
		const container = DOM.append(rootContainer, DOM.$('.cell-inner-container'));
		const disposables = new DisposableStore();
		const contextKeyService = disposables.add(this.contextKeyServiceProvider(container));
		const decorationContainer = DOM.append(rootContainer, $('.cell-decoration'));
		DOM.append(container, $('.cell-focus-indicator.cell-focus-indicator-top'));
		const titleToolbarContainer = DOM.append(container, $('.cell-title-toolbar'));
		const toolbar = disposables.add(this.createToolbar(titleToolbarContainer));
		const deleteToolbar = disposables.add(this.createToolbar(titleToolbarContainer, 'cell-delete-toolbar'));
		deleteToolbar.setActions([this.instantiationService.createInstance(DeleteCellAction)]);

		const focusIndicator = DOM.append(container, DOM.$('.cell-focus-indicator.cell-focus-indicator-side.cell-focus-indicator-left'));
		const dragHandle = DOM.append(container, DOM.$('.cell-drag-handle'));

		const cellContainer = DOM.append(container, $('.cell.code'));
		const runButtonContainer = DOM.append(cellContainer, $('.run-button-container'));
		const runToolbar = disposables.add(this.createToolbar(runButtonContainer));

		const executionOrderLabel = DOM.append(cellContainer, $('div.execution-count-label'));

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
			},
			// overflowWidgetsDomNode: this.notebookEditor.getOverflowContainerDomNode()
		}, {});

		disposables.add(this.editorOptions.onDidChange(newValue => editor.updateOptions(newValue)));
		const { collapsedPart, expandButton } = this.setupCollapsedPart(container);

		const progressBar = new ProgressBar(editorPart);
		progressBar.hide();
		disposables.add(progressBar);

		const statusBar = disposables.add(this.instantiationService.createInstance(CellEditorStatusBar, editorPart));
		const timer = new TimerRenderer(statusBar.durationContainer);
		const cellRunState = new RunStateRenderer(statusBar.cellRunStatusContainer, runToolbar, this.instantiationService);

		const outputContainer = DOM.append(container, $('.output'));
		const outputShowMoreContainer = DOM.append(container, $('.output-show-more-container'));

		const focusIndicatorRight = DOM.append(container, DOM.$('.cell-focus-indicator.cell-focus-indicator-side.cell-focus-indicator-right'));

		const focusSinkElement = DOM.append(container, $('.cell-editor-focus-sink'));
		focusSinkElement.setAttribute('tabindex', '0');
		const bottomCellContainer = DOM.append(container, $('.cell-bottom-toolbar-container'));
		const focusIndicatorBottom = DOM.append(container, $('.cell-focus-indicator.cell-focus-indicator-bottom'));
		const betweenCellToolbar = this.createBetweenCellToolbar(bottomCellContainer, disposables, contextKeyService);

		const titleMenu = disposables.add(this.cellMenus.getCellTitleMenu(contextKeyService));

		const templateData: CodeCellRenderTemplate = {
			rootContainer,
			editorPart,
			collapsedPart,
			expandButton,
			contextKeyService,
			container,
			decorationContainer,
			cellContainer,
			cellRunState,
			progressBar,
			statusBar,
			focusIndicatorLeft: focusIndicator,
			focusIndicatorRight,
			focusIndicatorBottom,
			toolbar,
			deleteToolbar,
			betweenCellToolbar,
			focusSinkElement,
			runToolbar,
			runButtonContainer,
			executionOrderLabel,
			outputContainer,
			outputShowMoreContainer,
			editor,
			disposables,
			elementDisposables: new DisposableStore(),
			bottomCellContainer,
			timer,
			titleMenu,
			dragHandle,
			toJSON: () => { return {}; }
		};

		this.dndController.registerDragHandle(templateData, rootContainer, dragHandle, () => new CodeCellDragImageRenderer().getDragImage(templateData, templateData.editor, 'code'));

		disposables.add(DOM.addDisposableListener(focusSinkElement, DOM.EventType.FOCUS, () => {
			if (templateData.currentRenderedCell && (templateData.currentRenderedCell as CodeCellViewModel).outputs.length) {
				this.notebookEditor.focusNotebookCell(templateData.currentRenderedCell, 'output');
			}
		}));

		this.commonRenderTemplate(templateData);

		return templateData;
	}

	private updateForOutputs(element: CodeCellViewModel, templateData: CodeCellRenderTemplate): void {
		if (element.outputs.length) {
			DOM.show(templateData.focusSinkElement);
		} else {
			DOM.hide(templateData.focusSinkElement);
		}
	}

	private updateForMetadata(element: CodeCellViewModel, templateData: CodeCellRenderTemplate): void {
		if (!this.notebookEditor.hasModel()) {
			return;
		}

		const metadata = element.getEvaluatedMetadata(this.notebookEditor.viewModel.notebookDocument.metadata);
		templateData.container.classList.toggle('runnable', !!metadata.runnable);
		this.updateExecutionOrder(metadata, templateData);
		templateData.statusBar.cellStatusMessageContainer.textContent = metadata?.statusMessage || '';

		templateData.cellRunState.renderState(element.metadata?.runState);

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

		if (metadata.runState === NotebookCellRunState.Running) {
			templateData.progressBar.infinite().show(500);
		} else {
			templateData.progressBar.hide();
		}
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
		templateData.container.classList.toggle('cell-output-hover', element.outputIsHovered);
	}

	private updateForLayout(element: CodeCellViewModel, templateData: CodeCellRenderTemplate): void {
		templateData.focusIndicatorLeft.style.height = `${element.layoutInfo.indicatorHeight}px`;
		templateData.focusIndicatorRight.style.height = `${element.layoutInfo.indicatorHeight}px`;
		templateData.focusIndicatorBottom.style.top = `${element.layoutInfo.totalHeight - BOTTOM_CELL_TOOLBAR_GAP - CELL_BOTTOM_MARGIN}px`;
		templateData.outputContainer.style.top = `${element.layoutInfo.outputContainerOffset}px`;
		templateData.outputShowMoreContainer.style.top = `${element.layoutInfo.outputShowMoreContainerOffset}px`;
		templateData.dragHandle.style.height = `${element.layoutInfo.totalHeight - BOTTOM_CELL_TOOLBAR_GAP}px`;
	}

	renderElement(element: CodeCellViewModel, index: number, templateData: CodeCellRenderTemplate, height: number | undefined): void {
		if (!this.notebookEditor.hasModel()) {
			throw new Error('The notebook editor is not attached with view model yet.');
		}

		const removedClassNames: string[] = [];
		templateData.rootContainer.classList.forEach(className => {
			if (/^nb\-.*$/.test(className)) {
				removedClassNames.push(className);
			}
		});

		removedClassNames.forEach(className => {
			templateData.rootContainer.classList.remove(className);
		});

		templateData.decorationContainer.innerText = '';

		this.commonRenderElement(element, templateData);

		templateData.currentRenderedCell = element;

		if (height === undefined) {
			return;
		}

		templateData.outputContainer.innerText = '';

		const elementDisposables = templateData.elementDisposables;

		const generateCellTopDecorations = () => {
			templateData.decorationContainer.innerText = '';

			element.getCellDecorations().filter(options => options.topClassName !== undefined).forEach(options => {
				templateData.decorationContainer.append(DOM.$(`.${options.topClassName!}`));
			});
		};

		elementDisposables.add(element.onCellDecorationsChanged((e) => {
			const modified = e.added.find(e => e.topClassName) || e.removed.find(e => e.topClassName);

			if (modified) {
				generateCellTopDecorations();
			}
		}));

		generateCellTopDecorations();

		elementDisposables.add(this.instantiationService.createInstance(CodeCell, this.notebookEditor, element, templateData));
		this.renderedEditors.set(element, templateData.editor);

		elementDisposables.add(new CellContextKeyManager(templateData.contextKeyService, this.notebookEditor, this.notebookEditor.viewModel.notebookDocument!, element));

		this.updateForLayout(element, templateData);
		elementDisposables.add(element.onDidChangeLayout(() => {
			this.updateForLayout(element, templateData);
		}));

		templateData.cellRunState.clear();
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
		elementDisposables.add(this.notebookEditor.viewModel.notebookDocument.onDidChangeContent(e => {
			if (e.rawEvents.find(event => event.kind === NotebookCellsChangeType.ChangeDocumentMetadata)) {
				this.updateForMetadata(element, templateData);
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
		templateData.deleteToolbar.context = toolbarContext;

		this.setBetweenCellToolbarContext(templateData, element, toolbarContext);

		templateData.statusBar.update(toolbarContext);
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

export class RunStateRenderer {
	private static readonly MIN_SPINNER_TIME = 200;

	private spinnerTimer: any | undefined;
	private pendingNewState: NotebookCellRunState | undefined;

	constructor(private readonly element: HTMLElement, private readonly runToolbar: ToolBar, private readonly instantiationService: IInstantiationService) {
		DOM.hide(element);
	}

	clear() {
		if (this.spinnerTimer) {
			clearTimeout(this.spinnerTimer);
			this.spinnerTimer = undefined;
		}
	}

	renderState(runState: NotebookCellRunState = NotebookCellRunState.Idle) {
		if (this.spinnerTimer) {
			this.pendingNewState = runState;
			return;
		}

		if (runState === NotebookCellRunState.Running) {
			this.runToolbar.setActions([this.instantiationService.createInstance(CancelCellAction)]);
		} else {
			this.runToolbar.setActions([this.instantiationService.createInstance(ExecuteCellAction)]);
		}

		if (runState === NotebookCellRunState.Success) {
			DOM.reset(this.element, ...renderCodicons(ThemeIcon.asCodiconLabel(successStateIcon)));
		} else if (runState === NotebookCellRunState.Error) {
			DOM.reset(this.element, ...renderCodicons(ThemeIcon.asCodiconLabel(errorStateIcon)));
		} else if (runState === NotebookCellRunState.Running) {
			DOM.reset(this.element, ...renderCodicons('$(sync~spin)'));

			this.spinnerTimer = setTimeout(() => {
				this.spinnerTimer = undefined;
				if (this.pendingNewState) {
					this.renderState(this.pendingNewState);
					this.pendingNewState = undefined;
				}
			}, RunStateRenderer.MIN_SPINNER_TIME);
		} else {
			this.element.innerText = '';
		}

		if (runState === NotebookCellRunState.Idle) {
			DOM.hide(this.element);
		} else {
			this.element.style.display = 'flex';
		}
	}
}

export class ListTopCellToolbar extends Disposable {
	private topCellToolbar: HTMLElement;
	private _modelDisposables = new DisposableStore();
	constructor(
		protected readonly notebookEditor: INotebookEditor,

		insertionIndicatorContainer: HTMLElement,
		@IInstantiationService protected readonly instantiationService: IInstantiationService,
		@IContextMenuService protected readonly contextMenuService: IContextMenuService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@INotificationService private readonly notificationService: INotificationService,
		@IContextKeyService readonly contextKeyService: IContextKeyService,
	) {
		super();

		this.topCellToolbar = DOM.append(insertionIndicatorContainer, $('.cell-list-top-cell-toolbar-container'));

		const toolbar = new ToolBar(this.topCellToolbar, this.contextMenuService, {
			actionViewItemProvider: action => {
				if (action instanceof MenuItemAction) {
					const item = new CodiconActionViewItem(action, this.keybindingService, this.notificationService);
					return item;
				}

				return undefined;
			}
		});

		const cellMenu = this.instantiationService.createInstance(CellMenus);
		const menu = this._register(cellMenu.getCellTopInsertionMenu(contextKeyService));

		const actions = this.getCellToolbarActions(menu, false);
		toolbar.setActions(actions.primary, actions.secondary);

		this._register(toolbar);

		this._register(this.notebookEditor.onDidChangeModel(() => {
			this._modelDisposables.clear();

			if (this.notebookEditor.viewModel) {
				this._modelDisposables.add(this.notebookEditor.viewModel.onDidChangeViewCells(() => {
					this.updateClass();
				}));

				this.updateClass();
			}
		}));

		this.updateClass();
	}

	private updateClass() {
		if (this.notebookEditor.viewModel?.length === 0) {
			this.topCellToolbar.classList.add('emptyNotebook');
		} else {
			this.topCellToolbar.classList.remove('emptyNotebook');
		}
	}

	private getCellToolbarActions(menu: IMenu, alwaysFillSecondaryActions: boolean): { primary: IAction[], secondary: IAction[] } {
		const primary: IAction[] = [];
		const secondary: IAction[] = [];
		const result = { primary, secondary };

		createAndFillInActionBarActionsWithVerticalSeparators(menu, { shouldForwardArgs: true }, result, alwaysFillSecondaryActions, g => /^inline/.test(g));

		return result;
	}
}
