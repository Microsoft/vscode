/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hide, IDimension, show, toggleClass, addClass, removeClass } from 'vs/base/browser/dom';
import { raceCancellation } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { renderCodicons } from 'vs/base/common/codicons';
import { Disposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EDITOR_BOTTOM_PADDING, EDITOR_TOP_PADDING } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellEditState, CellFocusMode, INotebookEditor, MarkdownCellRenderTemplate, ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellFoldingState } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { getResizesObserver } from 'vs/workbench/contrib/notebook/browser/view/renderers/sizeObserver';

export class StatefullMarkdownCell extends Disposable {

	private editor: CodeEditorWidget | null = null;
	private markdownContainer: HTMLElement;
	private editorPart: HTMLElement;

	private localDisposables = new DisposableStore();
	private foldingState: CellFoldingState;

	constructor(
		private readonly notebookEditor: INotebookEditor,
		private readonly viewCell: MarkdownCellViewModel,
		private readonly templateData: MarkdownCellRenderTemplate,
		private editorOptions: IEditorOptions,
		private readonly renderedEditors: Map<ICellViewModel, ICodeEditor | undefined>,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
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

		this._register(getResizesObserver(this.markdownContainer, undefined, () => {
			if (viewCell.editState === CellEditState.Preview) {
				this.viewCell.renderedMarkdownHeight = templateData.container.clientHeight;
			}
		})).startObserving();

		const updateForFocusMode = () => {
			if (viewCell.focusMode === CellFocusMode.Editor) {
				this.focusEditorIfNeeded();
			}

			toggleClass(templateData.container, 'cell-editor-focus', viewCell.focusMode === CellFocusMode.Editor);
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
			if (e.outerWidth && layoutInfo && layoutInfo.width !== viewCell.layoutInfo.editorWidth) {
				this.onCellEditorWidthChange();
			} else if (e.totalHeight || e.outerWidth) {
				this.relayoutCell();
			}
		}));

		this._register(viewCell.onCellDecorationsChanged((e) => {
			e.added.forEach(options => {
				if (options.className) {
					addClass(templateData.container, options.className);
				}
			});

			e.removed.forEach(options => {
				if (options.className) {
					removeClass(templateData.container, options.className);
				}
			});
		}));

		// apply decorations

		viewCell.getCellDecorations().forEach(options => {
			if (options.className) {
				addClass(templateData.container, options.className);
			}
		});

		this.viewUpdate();
	}

	private viewUpdate(): void {
		if (this.viewCell.editState === CellEditState.Editing) {
			this.viewUpdateEditing();
		} else {
			this.viewUpdatePreview();
		}
	}

	private viewUpdateEditing(): void {
		// switch to editing mode
		let editorHeight: number;

		show(this.editorPart);
		hide(this.markdownContainer);
		if (this.editor) {
			editorHeight = this.editor!.getContentHeight();

			// not first time, we don't need to create editor or bind listeners
			this.viewCell.attachTextEditor(this.editor);
			this.focusEditorIfNeeded();

			this.bindEditorListeners();

			this.editor.layout({
				width: this.viewCell.layoutInfo.editorWidth,
				height: editorHeight
			});
		} else {
			const width = this.viewCell.layoutInfo.editorWidth;
			const lineNum = this.viewCell.lineCount;
			const lineHeight = this.viewCell.layoutInfo.fontInfo?.lineHeight || 17;
			editorHeight = Math.max(lineNum, 1) * lineHeight + EDITOR_TOP_PADDING + EDITOR_BOTTOM_PADDING;

			this.templateData.editorContainer.innerHTML = '';

			// create a special context key service that set the inCompositeEditor-contextkey
			const editorContextKeyService = this.contextKeyService.createScoped();
			const editorInstaService = this.instantiationService.createChild(new ServiceCollection([IContextKeyService, editorContextKeyService]));
			EditorContextKeys.inCompositeEditor.bindTo(editorContextKeyService).set(true);

			this.editor = editorInstaService.createInstance(CodeEditorWidget, this.templateData.editorContainer, {
				...this.editorOptions,
				dimension: {
					width: width,
					height: editorHeight
				}
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

				this.bindEditorListeners();

				this.viewCell.editorHeight = editorHeight;
			});
		}

		this.viewCell.editorHeight = editorHeight;
		this.focusEditorIfNeeded();
		this.renderedEditors.set(this.viewCell, this.editor!);
	}

	private viewUpdatePreview(): void {
		this.viewCell.detachTextEditor();
		hide(this.editorPart);
		show(this.markdownContainer);
		this.renderedEditors.delete(this.viewCell);

		this.markdownContainer.innerHTML = '';
		this.viewCell.clearHTML();
		let markdownRenderer = this.viewCell.getMarkdownRenderer();
		let renderedHTML = this.viewCell.getHTML();
		if (renderedHTML) {
			this.markdownContainer.appendChild(renderedHTML);
		}

		if (this.editor) {
			// switch from editing mode
			this.viewCell.renderedMarkdownHeight = this.templateData.container.clientHeight;
			this.relayoutCell();
		} else {
			// first time, readonly mode
			this.localDisposables.add(markdownRenderer.onDidUpdateRender(() => {
				this.viewCell.renderedMarkdownHeight = this.templateData.container.clientHeight;
				this.relayoutCell();
			}));

			this.localDisposables.add(this.viewCell.textBuffer.onDidChangeContent(() => {
				this.markdownContainer.innerHTML = '';
				this.viewCell.clearHTML();
				let renderedHTML = this.viewCell.getHTML();
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

	private layoutEditor(dimension: IDimension): void {
		this.editor?.layout(dimension);
		this.templateData.statusBarContainer.style.width = `${dimension.width}px`;
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
				this.templateData.foldingIndicator.innerHTML = '';
				break;
			case CellFoldingState.Collapsed:
				this.templateData.foldingIndicator.innerHTML = renderCodicons('$(chevron-right)');
				break;
			case CellFoldingState.Expanded:
				this.templateData.foldingIndicator.innerHTML = renderCodicons('$(chevron-down)');
				break;

			default:
				break;
		}
	}

	private bindEditorListeners() {
		this.localDisposables.add(this.editor!.onDidContentSizeChange(e => {
			let viewLayout = this.editor!.getLayoutInfo();

			if (e.contentHeightChanged) {
				this.viewCell.editorHeight = e.contentHeight;
				this.editor!.layout(
					{
						width: viewLayout.width,
						height: e.contentHeight
					}
				);
			}
		}));

		this.localDisposables.add(this.editor!.onDidChangeCursorSelection((e) => {
			if (e.source === 'restoreState') {
				// do not reveal the cell into view if this selection change was caused by restoring editors...
				return;
			}

			const primarySelection = this.editor!.getSelection();

			if (primarySelection) {
				this.notebookEditor.revealLineInViewAsync(this.viewCell, primarySelection!.positionLineNumber);
			}
		}));

		const updateFocusMode = () => this.viewCell.focusMode = this.editor!.hasWidgetFocus() ? CellFocusMode.Editor : CellFocusMode.Container;
		this.localDisposables.add(this.editor!.onDidFocusEditorWidget(() => {
			updateFocusMode();
		}));

		this.localDisposables.add(this.editor!.onDidBlurEditorWidget(() => {
			updateFocusMode();
		}));

		updateFocusMode();
	}

	dispose() {
		this.viewCell.detachTextEditor();
		super.dispose();
	}
}
