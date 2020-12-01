/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { raceCancellation } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EDITOR_BOTTOM_PADDING } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellEditState, CellFocusMode, MarkdownCellRenderTemplate, ICellViewModel, getEditorTopPadding, IActiveNotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellFoldingState } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { getExecuteCellPlaceholder, getResizesObserver } from 'vs/workbench/contrib/notebook/browser/view/renderers/cellWidgets';
import { INotebookCellStatusBarService } from 'vs/workbench/contrib/notebook/common/notebookCellStatusBarService';
import { NotebookCellsChangeType } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { collapsedIcon, expandedIcon } from 'vs/workbench/contrib/notebook/browser/notebookIcons';
import { renderCodicons } from 'vs/base/browser/codicons';

export class StatefulMarkdownCell extends Disposable {

	private editor: CodeEditorWidget | null = null;
	private markdownContainer: HTMLElement;
	private editorPart: HTMLElement;

	private localDisposables = new DisposableStore();
	private foldingState: CellFoldingState;
	private _activeCellRunPlaceholder: IDisposable | null = null;

	constructor(
		private readonly notebookEditor: IActiveNotebookEditor,
		private readonly viewCell: MarkdownCellViewModel,
		private readonly templateData: MarkdownCellRenderTemplate,
		private editorOptions: IEditorOptions,
		private readonly renderedEditors: Map<ICellViewModel, ICodeEditor | undefined>,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@INotebookCellStatusBarService readonly notebookCellStatusBarService: INotebookCellStatusBarService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this.markdownContainer = templateData.cellContainer;
		this.editorPart = templateData.editorPart;
		this._register(this.localDisposables);
		this._register(toDisposable(() => renderedEditors.delete(this.viewCell)));

		this._register(viewCell.onDidChangeState((e) => {
			if (e.editStateChanged) {
				this.localDisposables.clear();
				this.viewUpdate();
			} else if (e.contentChanged) {
				this.viewUpdate();
			}
		}));

		this._register(viewCell.model.onDidChangeMetadata(() => {
			this.viewUpdate();
		}));

		this._register(getResizesObserver(this.markdownContainer, undefined, () => {
			if (viewCell.editState === CellEditState.Preview) {
				this.viewCell.renderedMarkdownHeight = templateData.container.clientHeight;
			}
		})).startObserving();

		const updateForFocusMode = () => {
			if (viewCell.focusMode === CellFocusMode.Editor) {
				this.focusEditorIfNeeded();
			}

			templateData.container.classList.toggle('cell-editor-focus', viewCell.focusMode === CellFocusMode.Editor);
		};
		this._register(viewCell.onDidChangeState((e) => {
			if (!e.focusModeChanged) {
				return;
			}

			updateForFocusMode();
		}));
		updateForFocusMode();

		this.foldingState = viewCell.foldingState;
		this.setFoldingIndicator();

		this._register(viewCell.onDidChangeState((e) => {
			if (!e.foldingStateChanged) {
				return;
			}

			const foldingState = viewCell.foldingState;

			if (foldingState !== this.foldingState) {
				this.foldingState = foldingState;
				this.setFoldingIndicator();
			}
		}));

		this._register(viewCell.onDidChangeLayout((e) => {
			const layoutInfo = this.editor?.getLayoutInfo();
			if (e.outerWidth && this.viewCell.editState === CellEditState.Editing && layoutInfo && layoutInfo.width !== viewCell.layoutInfo.editorWidth) {
				this.onCellEditorWidthChange();
			} else if (e.totalHeight || e.outerWidth) {
				this.relayoutCell();
			}
		}));

		this._register(viewCell.onCellDecorationsChanged((e) => {
			e.added.forEach(options => {
				if (options.className) {
					templateData.rootContainer.classList.add(options.className);
				}
			});

			e.removed.forEach(options => {
				if (options.className) {
					templateData.rootContainer.classList.remove(options.className);
				}
			});
		}));

		// apply decorations

		viewCell.getCellDecorations().forEach(options => {
			if (options.className) {
				templateData.rootContainer.classList.add(options.className);
			}
		});

		this.viewUpdate();

		const updatePlaceholder = () => {
			if (
				this.notebookEditor.getActiveCell() === this.viewCell
				&& !!this.notebookEditor.viewModel.metadata.trusted
			) {
				// active cell and no run status
				if (this._activeCellRunPlaceholder === null) {
					// const keybinding = this._keybindingService.lookupKeybinding(EXECUTE_CELL_COMMAND_ID);
					this._activeCellRunPlaceholder = this.notebookCellStatusBarService.addEntry(getExecuteCellPlaceholder(this.viewCell));
				}

				return;
			}

			this._activeCellRunPlaceholder?.dispose();
			this._activeCellRunPlaceholder = null;
		};

		this._register(this.notebookEditor.onDidChangeActiveCell(() => {
			updatePlaceholder();
		}));

		this._register(this.viewCell.model.onDidChangeMetadata(() => {
			updatePlaceholder();
		}));

		this._register(this.notebookEditor.viewModel.notebookDocument.onDidChangeContent(e => {
			if (e.rawEvents.find(event => event.kind === NotebookCellsChangeType.ChangeDocumentMetadata)) {
				updatePlaceholder();
			}
		}));

		updatePlaceholder();
	}

	private viewUpdate(): void {
		if (this.viewCell.metadata?.inputCollapsed) {
			this.viewUpdateCollapsed();
		} else if (this.viewCell.editState === CellEditState.Editing) {
			this.viewUpdateEditing();
		} else {
			this.viewUpdatePreview();
		}
	}

	private viewUpdateCollapsed(): void {
		DOM.show(this.templateData.collapsedPart);
		DOM.hide(this.editorPart);
		DOM.hide(this.markdownContainer);
		this.templateData.container.classList.toggle('collapsed', true);
		this.viewCell.renderedMarkdownHeight = 0;
	}

	private viewUpdateEditing(): void {
		// switch to editing mode
		let editorHeight: number;

		DOM.show(this.editorPart);
		DOM.hide(this.markdownContainer);
		DOM.hide(this.templateData.collapsedPart);
		this.templateData.container.classList.toggle('collapsed', false);

		if (this.editor) {
			editorHeight = this.editor.getContentHeight();

			// not first time, we don't need to create editor or bind listeners
			this.viewCell.attachTextEditor(this.editor);
			this.focusEditorIfNeeded();

			this.bindEditorListeners(this.editor);

			this.editor.layout({
				width: this.viewCell.layoutInfo.editorWidth,
				height: editorHeight
			});
		} else {
			const width = this.viewCell.layoutInfo.editorWidth;
			const lineNum = this.viewCell.lineCount;
			const lineHeight = this.viewCell.layoutInfo.fontInfo?.lineHeight || 17;
			editorHeight = Math.max(lineNum, 1) * lineHeight + getEditorTopPadding() + EDITOR_BOTTOM_PADDING;

			this.templateData.editorContainer.innerText = '';

			// create a special context key service that set the inCompositeEditor-contextkey
			const editorContextKeyService = this.contextKeyService.createScoped();
			const editorInstaService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, editorContextKeyService]));
			EditorContextKeys.inCompositeEditor.bindTo(editorContextKeyService).set(true);

			this.editor = editorInstaService.createInstance(CodeEditorWidget, this.templateData.editorContainer, {
				...this.editorOptions,
				dimension: {
					width: width,
					height: editorHeight
				},
				// overflowWidgetsDomNode: this.notebookEditor.getOverflowContainerDomNode()
			}, {});
			this.templateData.currentEditor = this.editor;

			const cts = new CancellationTokenSource();
			this._register({ dispose() { cts.dispose(true); } });
			raceCancellation(this.viewCell.resolveTextModel(), cts.token).then(model => {
				if (!model) {
					return;
				}

				this.editor!.setModel(model);
				this.focusEditorIfNeeded();

				const realContentHeight = this.editor!.getContentHeight();
				if (realContentHeight !== editorHeight) {
					this.editor!.layout(
						{
							width: width,
							height: realContentHeight
						}
					);
					editorHeight = realContentHeight;
				}

				this.viewCell.attachTextEditor(this.editor!);

				if (this.viewCell.editState === CellEditState.Editing) {
					this.focusEditorIfNeeded();
				}

				this.bindEditorListeners(this.editor!);

				this.viewCell.editorHeight = editorHeight;
			});
		}

		this.viewCell.editorHeight = editorHeight;
		this.focusEditorIfNeeded();
		this.renderedEditors.set(this.viewCell, this.editor!);
	}

	private viewUpdatePreview(): void {
		this.viewCell.detachTextEditor();
		DOM.hide(this.editorPart);
		DOM.hide(this.templateData.collapsedPart);
		DOM.show(this.markdownContainer);
		this.templateData.container.classList.toggle('collapsed', false);

		this.renderedEditors.delete(this.viewCell);

		this.markdownContainer.innerText = '';
		this.viewCell.clearHTML();
		const markdownRenderer = this.viewCell.getMarkdownRenderer();
		const renderedHTML = this.viewCell.getHTML();
		if (renderedHTML) {
			this.markdownContainer.appendChild(renderedHTML);
		}

		if (this.editor) {
			// switch from editing mode
			this.viewCell.renderedMarkdownHeight = this.templateData.container.clientHeight;
			this.relayoutCell();
		} else {
			// first time, readonly mode
			this.localDisposables.add(markdownRenderer.onDidRenderAsync(() => {
				this.viewCell.renderedMarkdownHeight = this.templateData.container.clientHeight;
				this.relayoutCell();
			}));

			this.localDisposables.add(this.viewCell.textBuffer.onDidChangeContent(() => {
				this.markdownContainer.innerText = '';
				this.viewCell.clearHTML();
				const renderedHTML = this.viewCell.getHTML();
				if (renderedHTML) {
					this.markdownContainer.appendChild(renderedHTML);
				}
			}));

			this.viewCell.renderedMarkdownHeight = this.templateData.container.clientHeight;
			this.relayoutCell();
		}
	}

	private focusEditorIfNeeded() {
		if (this.viewCell.focusMode === CellFocusMode.Editor && this.notebookEditor.hasFocus()) {
			this.editor?.focus();
		}
	}

	private layoutEditor(dimension: DOM.IDimension): void {
		this.editor?.layout(dimension);
		this.templateData.statusBar.layout(dimension.width);
	}

	private onCellEditorWidthChange(): void {
		const realContentHeight = this.editor!.getContentHeight();
		this.layoutEditor(
			{
				width: this.viewCell.layoutInfo.editorWidth,
				height: realContentHeight
			}
		);

		this.viewCell.editorHeight = realContentHeight;
		this.relayoutCell();
	}

	private relayoutCell(): void {
		this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
	}

	updateEditorOptions(newValue: IEditorOptions): void {
		this.editorOptions = newValue;
		if (this.editor) {
			this.editor.updateOptions(this.editorOptions);
		}
	}

	setFoldingIndicator() {
		switch (this.foldingState) {
			case CellFoldingState.None:
				this.templateData.foldingIndicator.innerText = '';
				break;
			case CellFoldingState.Collapsed:
				DOM.reset(this.templateData.foldingIndicator, ...renderCodicons(ThemeIcon.asCodiconLabel(collapsedIcon)));
				break;
			case CellFoldingState.Expanded:
				DOM.reset(this.templateData.foldingIndicator, ...renderCodicons(ThemeIcon.asCodiconLabel(expandedIcon)));
				break;

			default:
				break;
		}
	}

	private bindEditorListeners(editor: CodeEditorWidget) {
		this.localDisposables.add(editor.onDidContentSizeChange(e => {
			const viewLayout = editor.getLayoutInfo();

			if (e.contentHeightChanged) {
				this.viewCell.editorHeight = e.contentHeight;
				editor.layout(
					{
						width: viewLayout.width,
						height: e.contentHeight
					}
				);
			}
		}));

		this.localDisposables.add(editor.onDidChangeCursorSelection((e) => {
			if (e.source === 'restoreState') {
				// do not reveal the cell into view if this selection change was caused by restoring editors...
				return;
			}

			const primarySelection = editor.getSelection();

			if (primarySelection) {
				this.notebookEditor.revealLineInViewAsync(this.viewCell, primarySelection.positionLineNumber);
			}
		}));

		const updateFocusMode = () => this.viewCell.focusMode = editor.hasWidgetFocus() ? CellFocusMode.Editor : CellFocusMode.Container;
		this.localDisposables.add(editor.onDidFocusEditorWidget(() => {
			updateFocusMode();
		}));

		this.localDisposables.add(editor.onDidBlurEditorWidget(() => {
			// this is for a special case:
			// users click the status bar empty space, which we will then focus the editor
			// so we don't want to update the focus state too eagerly
			if (document.activeElement?.contains(this.templateData.container)) {
				setTimeout(() => {
					updateFocusMode();
				}, 300);
			} else {
				updateFocusMode();
			}
		}));

		updateFocusMode();
	}

	dispose() {
		this.viewCell.detachTextEditor();
		super.dispose();
	}
}
