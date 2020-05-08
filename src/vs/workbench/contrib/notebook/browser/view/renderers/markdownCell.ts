/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hide, IDimension, show, toggleClass } from 'vs/base/browser/dom';
import { raceCancellation } from 'vs/base/common/async';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { renderCodicons } from 'vs/base/common/codicons';
import { Disposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { CodeEditorWidget } from 'vs/editor/browser/widget/codeEditorWidget';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { ITextModel } from 'vs/editor/common/model';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { EDITOR_BOTTOM_PADDING, EDITOR_TOP_PADDING, CELL_STATUSBAR_HEIGHT } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellEditState, CellFocusMode, INotebookEditor, MarkdownCellRenderTemplate, ICellViewModel } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { getResizesObserver } from 'vs/workbench/contrib/notebook/browser/view/renderers/sizeObserver';
import { CellFoldingState } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { ICodeEditor } from 'vs/editor/browser/editorBrowser';
import { IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';

export class StatefullMarkdownCell extends Disposable {

	private editor: CodeEditorWidget | null = null;
	private editorOptions: IEditorOptions;
	private markdownContainer: HTMLElement;
	private editorPart: HTMLElement;

	private localDisposables: DisposableStore;
	private foldingState: CellFoldingState;

	constructor(
		private notebookEditor: INotebookEditor,
		private viewCell: MarkdownCellViewModel,
		private templateData: MarkdownCellRenderTemplate,
		editorOptions: IEditorOptions,
		renderedEditors: Map<ICellViewModel, ICodeEditor | undefined>,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this.markdownContainer = templateData.cellContainer;
		this.editorPart = templateData.editorPart;
		this.editorOptions = editorOptions;
		this.localDisposables = new DisposableStore();
		this._register(this.localDisposables);
		this._register(toDisposable(() => renderedEditors.delete(this.viewCell)));

		const viewUpdate = () => {
			if (viewCell.editState === CellEditState.Editing) {
				// switch to editing mode
				let editorHeight: number;

				show(this.editorPart);
				hide(this.markdownContainer);
				if (this.editor) {
					editorHeight = this.editor!.getContentHeight();

					// not first time, we don't need to create editor or bind listeners
					viewCell.attachTextEditor(this.editor);
					if (notebookEditor.getActiveCell() === viewCell) {
						this.editor.focus();
					}

					this.bindEditorListeners(this.editor.getModel()!);
				} else {
					const width = viewCell.layoutInfo.editorWidth;
					const lineNum = viewCell.lineCount;
					const lineHeight = viewCell.layoutInfo.fontInfo?.lineHeight || 17;
					editorHeight = Math.max(lineNum, 1) * lineHeight + EDITOR_TOP_PADDING + EDITOR_BOTTOM_PADDING;

					this.templateData.editorContainer.innerHTML = '';

					// create a special context key service that set the inCompositeEditor-contextkey
					const editorContextKeyService = contextKeyService.createScoped();
					const editorInstaService = instantiationService.createChild(new ServiceCollection([IContextKeyService, editorContextKeyService]));
					EditorContextKeys.inCompositeEditor.bindTo(editorContextKeyService).set(true);

					this.editor = editorInstaService.createInstance(CodeEditorWidget, this.templateData.editorContainer, {
						...this.editorOptions,
						dimension: {
							width: width,
							height: editorHeight
						}
					}, {});
					templateData.currentEditor = this.editor;

					const cts = new CancellationTokenSource();
					this._register({ dispose() { cts.dispose(true); } });
					raceCancellation(viewCell.resolveTextModel(), cts.token).then(model => {
						if (!model) {
							return;
						}

						this.editor!.setModel(model);
						if (notebookEditor.getActiveCell() === viewCell) {
							this.editor!.focus();
						}

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

						viewCell.attachTextEditor(this.editor!);

						if (viewCell.editState === CellEditState.Editing) {
							this.editor!.focus();
						}

						this.bindEditorListeners(model, {
							width: width,
							height: editorHeight
						});


						const clientHeight = this.markdownContainer.clientHeight;
						const totalHeight = editorHeight + 32 + clientHeight + CELL_STATUSBAR_HEIGHT;
						this.viewCell.totalHeight = totalHeight;
						notebookEditor.layoutNotebookCell(viewCell, totalHeight);
					});
				}

				const clientHeight = this.markdownContainer.clientHeight;
				const totalHeight = editorHeight + 32 + clientHeight + CELL_STATUSBAR_HEIGHT;
				this.viewCell.totalHeight = totalHeight;
				notebookEditor.layoutNotebookCell(viewCell, totalHeight);
				this.editor.focus();
				renderedEditors.set(this.viewCell, this.editor!);
			} else {
				this.viewCell.detachTextEditor();
				hide(this.editorPart);
				show(this.markdownContainer);
				renderedEditors.delete(this.viewCell);
				if (this.editor) {
					// switch from editing mode
					const clientHeight = templateData.container.clientHeight;
					this.viewCell.totalHeight = clientHeight;
					notebookEditor.layoutNotebookCell(viewCell, clientHeight);
				} else {
					// first time, readonly mode
					this.markdownContainer.innerHTML = '';
					let markdownRenderer = viewCell.getMarkdownRenderer();
					let renderedHTML = viewCell.getHTML();
					if (renderedHTML) {
						this.markdownContainer.appendChild(renderedHTML);
					}

					this.localDisposables.add(markdownRenderer.onDidUpdateRender(() => {
						const clientHeight = templateData.container.clientHeight;
						this.viewCell.totalHeight = clientHeight;
						notebookEditor.layoutNotebookCell(viewCell, clientHeight);
					}));

					this.localDisposables.add(viewCell.onDidChangeState((e) => {
						if (!e.contentChanged) {
							return;
						}

						this.markdownContainer.innerHTML = '';
						let renderedHTML = viewCell.getHTML();
						if (renderedHTML) {
							this.markdownContainer.appendChild(renderedHTML);
						}
					}));

					const clientHeight = templateData.container.clientHeight;
					this.viewCell.totalHeight = clientHeight;
					notebookEditor.layoutNotebookCell(viewCell, clientHeight);
				}
			}
		};

		this._register(viewCell.onDidChangeState((e) => {
			if (e.editStateChanged) {
				this.localDisposables.clear();
				viewUpdate();
			}
		}));

		const updateForFocusMode = () => {
			if (viewCell.focusMode === CellFocusMode.Editor) {
				this.editor?.focus();
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

		viewUpdate();
	}

	updateEditorOptions(newValue: IEditorOptions): any {
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

	bindEditorListeners(model: ITextModel, dimension?: IDimension) {
		this.localDisposables.add(model.onDidChangeContent(() => {
			// we don't need to update view cell text anymore as the textbuffer is shared
			this.viewCell.clearHTML();
			let clientHeight = this.markdownContainer.clientHeight;
			this.markdownContainer.innerHTML = '';
			let renderedHTML = this.viewCell.getHTML();
			if (renderedHTML) {
				this.markdownContainer.appendChild(renderedHTML);
				clientHeight = this.markdownContainer.clientHeight;
			}

			this.viewCell.totalHeight = this.editor!.getContentHeight() + 32 + clientHeight + CELL_STATUSBAR_HEIGHT;
			this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
		}));

		this.localDisposables.add(this.editor!.onDidContentSizeChange(e => {
			let viewLayout = this.editor!.getLayoutInfo();

			if (e.contentHeightChanged) {
				this.editor!.layout(
					{
						width: viewLayout.width,
						height: e.contentHeight
					}
				);
				const clientHeight = this.markdownContainer.clientHeight;
				this.viewCell.totalHeight = e.contentHeight + 32 + clientHeight;
				this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
			}
		}));

		this.localDisposables.add(this.editor!.onDidChangeCursorSelection((e) => {
			if (e.source === 'restoreState') {
				// do not reveal the cell into view if this selection change was caused by restoring editors...
				return;
			}

			const primarySelection = this.editor!.getSelection();

			if (primarySelection) {
				this.notebookEditor.revealLineInView(this.viewCell, primarySelection!.positionLineNumber);
			}
		}));

		let cellWidthResizeObserver = getResizesObserver(this.templateData.editorContainer, dimension, () => {
			let newWidth = cellWidthResizeObserver.getWidth();
			let realContentHeight = this.editor!.getContentHeight();
			let layoutInfo = this.editor!.getLayoutInfo();

			// the dimension generated by the resize observer are float numbers, let's round it a bit to avoid relayout.
			if (newWidth < layoutInfo.width - 0.3 || layoutInfo.width + 0.3 < newWidth) {
				this.editor!.layout(
					{
						width: newWidth,
						height: realContentHeight
					}
				);
			}
		});

		cellWidthResizeObserver.startObserving();
		this.localDisposables.add(cellWidthResizeObserver);

		let markdownRenderer = this.viewCell.getMarkdownRenderer();
		this.markdownContainer.innerHTML = '';
		let renderedHTML = this.viewCell.getHTML();
		if (renderedHTML) {
			this.markdownContainer.appendChild(renderedHTML);
			this.localDisposables.add(markdownRenderer.onDidUpdateRender(() => {
				const clientHeight = this.markdownContainer.clientHeight;
				this.viewCell.totalHeight = clientHeight;
				this.notebookEditor.layoutNotebookCell(this.viewCell, this.viewCell.layoutInfo.totalHeight);
			}));
		}

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
