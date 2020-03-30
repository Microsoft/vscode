/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getZoomLevel } from 'vs/base/browser/browser';
import * as DOM from 'vs/base/browser/dom';
import { IListRenderer, IListVirtualDelegate } from 'vs/base/browser/ui/list/list';
import { ProgressBar } from 'vs/base/browser/ui/progressbar/progressbar';
import { ToolBar } from 'vs/base/browser/ui/toolbar/toolbar';
import { IAction } from 'vs/base/common/actions';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { deepClone } from 'vs/base/common/objects';
import 'vs/css!vs/workbench/contrib/notebook/browser/notebook';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { ContextAwareMenuEntryActionViewItem } from 'vs/platform/actions/browser/menuEntryActionViewItem';
import { IMenu, MenuItemAction } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { IContextMenuService } from 'vs/platform/contextview/browser/contextView';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { EDITOR_BOTTOM_PADDING, EDITOR_TOOLBAR_HEIGHT, EDITOR_TOP_PADDING, NOTEBOOK_CELL_EDITABLE_CONTEXT_KEY, NOTEBOOK_CELL_MARKDOWN_EDIT_MODE_CONTEXT_KEY, NOTEBOOK_CELL_TYPE_CONTEXT_KEY, EDITOR_TOP_MARGIN } from 'vs/workbench/contrib/notebook/browser/constants';
import { ExecuteCellAction, INotebookCellActionContext } from 'vs/workbench/contrib/notebook/browser/contrib/notebookActions';
import { CellEditState, CellRenderTemplate, CellRunState, ICellViewModel, INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellMenus } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellMenus';
import { CodeCell } from 'vs/workbench/contrib/notebook/browser/view/renderers/codeCell';
import { StatefullMarkdownCell } from 'vs/workbench/contrib/notebook/browser/view/renderers/markdownCell';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { CellKind } from 'vs/workbench/services/notebook/common/notebookCommon';

const $ = DOM.$;

export class NotebookCellListDelegate implements IListVirtualDelegate<CellViewModel> {
	private _lineHeight: number;
	private _toolbarHeight = EDITOR_TOOLBAR_HEIGHT;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
		this._lineHeight = BareFontInfo.createFromRawSettings(editorOptions, getZoomLevel()).lineHeight;
	}

	getHeight(element: CellViewModel): number {
		return element.getHeight(this._lineHeight) + this._toolbarHeight;
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

abstract class AbstractCellRenderer {
	protected editorOptions: IEditorOptions;

	constructor(
		protected readonly instantiationService: IInstantiationService,
		protected readonly notebookEditor: INotebookEditor,
		protected readonly contextMenuService: IContextMenuService,
		private readonly configurationService: IConfigurationService,
		private readonly keybindingService: IKeybindingService,
		private readonly notificationService: INotificationService,
		protected readonly contextKeyService: IContextKeyService,
		language: string,
	) {
		const editorOptions = deepClone(this.configurationService.getValue<IEditorOptions>('editor', { overrideIdentifier: language }));
		this.editorOptions = {
			...editorOptions,
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
			fixedOverflowWidgets: false,
			minimap: { enabled: false },
		};
	}

	protected createToolbar(container: HTMLElement): ToolBar {
		const toolbar = new ToolBar(container, this.contextMenuService, {
			actionViewItemProvider: action => {
				if (action instanceof MenuItemAction) {
					const item = new ContextAwareMenuEntryActionViewItem(action, this.keybindingService, this.notificationService, this.contextMenuService);
					return item;
				}

				return undefined;
			}
		});

		toolbar.getContainer().style.height = `${EDITOR_TOOLBAR_HEIGHT}px`;

		return toolbar;
	}

	private getCellToolbarActions(menu: IMenu): IAction[] {
		const actions: IAction[] = [];
		for (let [, menuActions] of menu.getActions({ shouldForwardArgs: true })) {
			actions.push(...menuActions);
		}

		return actions;
	}

	protected setupCellToolbarActions(scopedContextKeyService: IContextKeyService, templateData: CellRenderTemplate, disposables: DisposableStore): void {
		const cellMenu = this.instantiationService.createInstance(CellMenus);
		const menu = disposables.add(cellMenu.getCellTitleMenu(scopedContextKeyService));

		const updateActions = () => {
			const actions = this.getCellToolbarActions(menu);

			templateData.toolbar.setActions(actions)();

			if (templateData.focusIndicator) {
				if (actions.length) {
					templateData.focusIndicator.style.top = `${EDITOR_TOOLBAR_HEIGHT + EDITOR_TOP_MARGIN}px`;
				} else {
					templateData.focusIndicator.style.top = `${EDITOR_TOP_MARGIN}px`;
				}
			}
		};

		updateActions();
		disposables.add(menu.onDidChange(() => {
			updateActions();
		}));
	}
}

export class MarkdownCellRenderer extends AbstractCellRenderer implements IListRenderer<MarkdownCellViewModel, CellRenderTemplate> {
	static readonly TEMPLATE_ID = 'markdown_cell';
	private disposables: Map<ICellViewModel, DisposableStore> = new Map();

	constructor(
		contextKeyService: IContextKeyService,
		notehookEditor: INotebookEditor,
		@IInstantiationService instantiationService: IInstantiationService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
	) {
		super(instantiationService, notehookEditor, contextMenuService, configurationService, keybindingService, notificationService, contextKeyService, 'markdown');
	}

	get templateId() {
		return MarkdownCellRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): CellRenderTemplate {
		const codeInnerContent = document.createElement('div');
		DOM.addClasses(codeInnerContent, 'cell', 'code');
		const editorContainer = DOM.append(codeInnerContent, $('.markdown-editor-container'));
		editorContainer.style.display = 'none';

		const disposables = new DisposableStore();
		const toolbar = this.createToolbar(container);
		disposables.add(toolbar);

		container.appendChild(codeInnerContent);

		const innerContent = document.createElement('div');
		DOM.addClasses(innerContent, 'cell', 'markdown');
		container.appendChild(innerContent);

		const focusIndicator = DOM.append(container, DOM.$('.notebook-cell-focus-indicator'));

		return {
			container: container,
			cellContainer: innerContent,
			editingContainer: editorContainer,
			focusIndicator,
			disposables,
			toolbar,
			toJSON: () => { return {}; }
		};
	}

	renderElement(element: MarkdownCellViewModel, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		templateData.editingContainer!.style.display = 'none';
		templateData.cellContainer.innerHTML = '';
		let renderedHTML = element.getHTML();
		if (renderedHTML) {
			templateData.cellContainer.appendChild(renderedHTML);
		}

		if (height) {
			this.disposables.get(element)?.clear();
			if (!this.disposables.has(element)) {
				this.disposables.set(element, new DisposableStore());
			}
			const elementDisposable = this.disposables.get(element)!;

			elementDisposable.add(new StatefullMarkdownCell(this.notebookEditor, element, templateData, this.editorOptions, this.instantiationService));

			const contextKeyService = this.contextKeyService.createScoped(templateData.container);
			contextKeyService.createKey(NOTEBOOK_CELL_TYPE_CONTEXT_KEY, 'markdown');
			const cellEditableKey = contextKeyService.createKey(NOTEBOOK_CELL_EDITABLE_CONTEXT_KEY, !!(element.metadata?.editable));
			elementDisposable.add(element.onDidChangeMetadata(() => {
				cellEditableKey.set(!!element.metadata?.editable);
			}));

			const editModeKey = contextKeyService.createKey(NOTEBOOK_CELL_MARKDOWN_EDIT_MODE_CONTEXT_KEY, element.editState === CellEditState.Editing);
			elementDisposable.add(element.onDidChangeCellEditState(() => {
				editModeKey.set(element.editState === CellEditState.Editing);
			}));

			this.setupCellToolbarActions(contextKeyService, templateData, elementDisposable);
		}

		templateData.toolbar!.context = <INotebookCellActionContext>{
			cell: element,
			notebookEditor: this.notebookEditor,
			$mid: 12
		};
	}

	disposeTemplate(templateData: CellRenderTemplate): void {
		// throw nerendererw Error('Method not implemented.');

	}

	disposeElement(element: ICellViewModel, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		if (height) {
			this.disposables.get(element)?.clear();
		}
	}
}

export class CodeCellRenderer extends AbstractCellRenderer implements IListRenderer<CodeCellViewModel, CellRenderTemplate> {
	static readonly TEMPLATE_ID = 'code_cell';
	private disposables: Map<ICellViewModel, DisposableStore> = new Map();

	constructor(
		protected notebookEditor: INotebookEditor,
		protected contextKeyService: IContextKeyService,
		private renderedEditors: Map<ICellViewModel, ICodeEditor | undefined>,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IKeybindingService keybindingService: IKeybindingService,
		@INotificationService notificationService: INotificationService,
	) {
		super(instantiationService, notebookEditor, contextMenuService, configurationService, keybindingService, notificationService, contextKeyService, 'python');
	}

	get templateId() {
		return CodeCellRenderer.TEMPLATE_ID;
	}

	renderTemplate(container: HTMLElement): CellRenderTemplate {
		const disposables = new DisposableStore();
		const toolbar = this.createToolbar(container);
		disposables.add(toolbar);

		const cellContainer = DOM.append(container, $('.cell.code'));
		const runButtonContainer = DOM.append(cellContainer, $('.run-button-container'));
		const runToolbar = this.createToolbar(runButtonContainer);
		runToolbar.setActions([
			this.instantiationService.createInstance(ExecuteCellAction)
		])();
		disposables.add(runToolbar);

		const executionOrderLabel = DOM.append(runButtonContainer, $('div.execution-count-label'));

		const editorContainer = DOM.append(cellContainer, $('.cell-editor-container'));
		const editor = this.instantiationService.createInstance(CodeEditorWidget, editorContainer, {
			...this.editorOptions,
			dimension: {
				width: 0,
				height: 0
			}
		}, {});

		const focusIndicator = DOM.append(container, DOM.$('.notebook-cell-focus-indicator'));

		const outputContainer = document.createElement('div');
		DOM.addClasses(outputContainer, 'output');
		container.appendChild(outputContainer);

		const progressBar = new ProgressBar(editorContainer);
		progressBar.hide();
		disposables.add(progressBar);

		return {
			container,
			cellContainer,
			editorContainer,
			progressBar,
			focusIndicator,
			toolbar,
			runToolbar,
			runButtonContainer,
			executionOrderLabel,
			outputContainer,
			editor,
			disposables,
			toJSON: () => { return {}; }
		};
	}

	renderElement(element: CodeCellViewModel, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		if (height === undefined) {
			return;
		}

		if (templateData.outputContainer) {
			templateData.outputContainer!.innerHTML = '';
		}

		this.disposables.get(element)?.clear();
		if (!this.disposables.has(element)) {
			this.disposables.set(element, new DisposableStore());
		}

		const elementDisposable = this.disposables.get(element)!;

		elementDisposable.add(this.instantiationService.createInstance(CodeCell, this.notebookEditor, element, templateData));
		this.renderedEditors.set(element, templateData.editor);

		elementDisposable.add(element.onDidChangeLayout(() => {
			templateData.focusIndicator!.style.height = `${element.layoutInfo.indicatorHeight}px`;
		}));

		elementDisposable.add(element.onDidChangeCellRunState(() => {
			if (element.runState === CellRunState.Running) {
				templateData.progressBar?.infinite().show(500);
			} else {
				templateData.progressBar?.hide();
			}
		}));

		function renderExecutionOrder() {
			const executionOrdeerLabel = typeof element.metadata?.executionOrder === 'number' ? `[ ${element.metadata.executionOrder} ]` :
				'[   ]';
			templateData.executionOrderLabel!.innerText = executionOrdeerLabel;
		}

		const contextKeyService = this.contextKeyService.createScoped(templateData.container);
		contextKeyService.createKey(NOTEBOOK_CELL_TYPE_CONTEXT_KEY, 'code');
		const cellEditableKey = contextKeyService.createKey(NOTEBOOK_CELL_EDITABLE_CONTEXT_KEY, !!(element.metadata?.editable));

		const updateForMetadata = () => {
			const metadata = element.getEvaluatedMetadata(this.notebookEditor.viewModel!.notebookDocument.metadata);
			DOM.toggleClass(templateData.cellContainer, 'runnable', !!metadata.runnable);
			renderExecutionOrder();
			cellEditableKey.set(!!metadata.editable);
		};

		updateForMetadata();
		elementDisposable.add(element.onDidChangeMetadata(() => {
			updateForMetadata();
		}));

		this.setupCellToolbarActions(contextKeyService, templateData, elementDisposable);

		const toolbarContext = <INotebookCellActionContext>{
			cell: element,
			cellTemplate: templateData,
			notebookEditor: this.notebookEditor,
			$mid: 12
		};
		templateData.toolbar.context = toolbarContext;
		templateData.runToolbar!.context = toolbarContext;
	}

	disposeTemplate(templateData: CellRenderTemplate): void {
		templateData.disposables.clear();
	}

	disposeElement(element: ICellViewModel, index: number, templateData: CellRenderTemplate, height: number | undefined): void {
		this.disposables.get(element)?.clear();
		this.renderedEditors.delete(element);
		templateData.focusIndicator!.style.height = 'initial';
	}
}
