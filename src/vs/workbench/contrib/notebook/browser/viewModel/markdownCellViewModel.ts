/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import * as UUID from 'vs/base/common/uuid';
import * as editorCommon from 'vs/editor/common/editorCommon';
import * as model from 'vs/editor/common/model';
import * as nls from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { BOTTOM_CELL_TOOLBAR_GAP, BOTTOM_CELL_TOOLBAR_HEIGHT, CELL_BOTTOM_MARGIN, CELL_MARGIN, CELL_TOP_MARGIN, CODE_CELL_LEFT_MARGIN, COLLAPSED_INDICATOR_HEIGHT } from 'vs/workbench/contrib/notebook/browser/constants';
import { EditorFoldingStateDelegate } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { CellFindMatch, ICellViewModel, MarkdownCellLayoutChangeEvent, MarkdownCellLayoutInfo, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { MarkdownRenderer } from 'vs/workbench/contrib/notebook/browser/view/renderers/mdRenderer';
import { BaseCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/baseCellViewModel';
import { NotebookCellStateChangedEvent, NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, INotebookSearchOptions } from 'vs/workbench/contrib/notebook/common/notebookCommon';

export class MarkdownCellViewModel extends BaseCellViewModel implements ICellViewModel {
	readonly cellKind = CellKind.Markdown;
	private _html: HTMLElement | null = null;
	private _layoutInfo: MarkdownCellLayoutInfo;

	get layoutInfo() {
		return this._layoutInfo;
	}

	set renderedMarkdownHeight(newHeight: number) {
		const newTotalHeight = newHeight + BOTTOM_CELL_TOOLBAR_GAP;
		this.totalHeight = newTotalHeight;
	}

	private set totalHeight(newHeight: number) {
		if (newHeight !== this.layoutInfo.totalHeight) {
			this.layoutChange({ totalHeight: newHeight });
		}
	}

	private get totalHeight() {
		throw new Error('MarkdownCellViewModel.totalHeight is write only');
	}

	private _editorHeight = 0;
	set editorHeight(newHeight: number) {
		this._editorHeight = newHeight;

		this.totalHeight = this._editorHeight + CELL_TOP_MARGIN + CELL_BOTTOM_MARGIN + BOTTOM_CELL_TOOLBAR_GAP + this.getEditorStatusbarHeight();
	}

	get editorHeight() {
		throw new Error('MarkdownCellViewModel.editorHeight is write only');
	}

	protected readonly _onDidChangeLayout = new Emitter<MarkdownCellLayoutChangeEvent>();
	readonly onDidChangeLayout = this._onDidChangeLayout.event;

	get foldingState() {
		return this.foldingDelegate.getFoldingState(this.foldingDelegate.getCellIndex(this));
	}

	constructor(
		readonly viewType: string,
		readonly model: NotebookCellTextModel,
		initialNotebookLayoutInfo: NotebookLayoutInfo | null,
		readonly foldingDelegate: EditorFoldingStateDelegate,
		readonly eventDispatcher: NotebookEventDispatcher,
		private readonly _mdRenderer: MarkdownRenderer,
		@IConfigurationService configurationService: IConfigurationService
	) {
		super(viewType, model, UUID.generateUuid(), configurationService);

		this._layoutInfo = {
			editorHeight: 0,
			fontInfo: initialNotebookLayoutInfo?.fontInfo || null,
			editorWidth: initialNotebookLayoutInfo?.width ? this.computeEditorWidth(initialNotebookLayoutInfo.width) : 0,
			bottomToolbarOffset: BOTTOM_CELL_TOOLBAR_GAP,
			totalHeight: 0
		};

		this._register(this.onDidChangeState(e => {
			eventDispatcher.emit([new NotebookCellStateChangedEvent(e, this)]);
		}));
	}

	triggerfoldingStateChange() {
		this._onDidChangeState.fire({ foldingStateChanged: true });
	}

	private computeEditorWidth(outerWidth: number) {
		return outerWidth - (CELL_MARGIN * 2) - CODE_CELL_LEFT_MARGIN;
	}

	layoutChange(state: MarkdownCellLayoutChangeEvent) {
		// recompute

		if (!this.metadata?.inputCollapsed) {
			const editorWidth = state.outerWidth !== undefined ? this.computeEditorWidth(state.outerWidth) : this._layoutInfo.editorWidth;
			const totalHeight = state.totalHeight === undefined ? this._layoutInfo.totalHeight : state.totalHeight;

			this._layoutInfo = {
				fontInfo: state.font || this._layoutInfo.fontInfo,
				editorWidth,
				editorHeight: this._editorHeight,
				bottomToolbarOffset: totalHeight - BOTTOM_CELL_TOOLBAR_GAP - BOTTOM_CELL_TOOLBAR_HEIGHT / 2,
				totalHeight
			};
		} else {
			const editorWidth = state.outerWidth !== undefined ? this.computeEditorWidth(state.outerWidth) : this._layoutInfo.editorWidth;
			const totalHeight = CELL_TOP_MARGIN + COLLAPSED_INDICATOR_HEIGHT + BOTTOM_CELL_TOOLBAR_GAP + CELL_BOTTOM_MARGIN;
			state.totalHeight = totalHeight;

			this._layoutInfo = {
				fontInfo: state.font || this._layoutInfo.fontInfo,
				editorWidth,
				editorHeight: this._editorHeight,
				bottomToolbarOffset: totalHeight - BOTTOM_CELL_TOOLBAR_GAP - BOTTOM_CELL_TOOLBAR_HEIGHT / 2,
				totalHeight
			};
		}

		this._onDidChangeLayout.fire(state);
	}

	restoreEditorViewState(editorViewStates: editorCommon.ICodeEditorViewState | null, totalHeight?: number) {
		super.restoreEditorViewState(editorViewStates);
		if (totalHeight !== undefined) {
			this._layoutInfo = {
				fontInfo: this._layoutInfo.fontInfo,
				editorWidth: this._layoutInfo.editorWidth,
				bottomToolbarOffset: this._layoutInfo.bottomToolbarOffset,
				totalHeight: totalHeight,
				editorHeight: this._editorHeight
			};
			this.layoutChange({});
		}
	}

	hasDynamicHeight() {
		return false;
	}

	getHeight(lineHeight: number) {
		if (this._layoutInfo.totalHeight === 0) {
			return 100;
		} else {
			return this._layoutInfo.totalHeight;
		}
	}

	clearHTML() {
		this._html = null;
	}

	getHTML(): HTMLElement | null {
		if (this.cellKind === CellKind.Markdown) {
			if (this._html) {
				return this._html;
			}
			const renderer = this.getMarkdownRenderer();
			const text = this.getText();

			if (text.length === 0) {
				const el = document.createElement('p');
				el.className = 'emptyMarkdownPlaceholder';
				el.innerText = nls.localize('notebook.emptyMarkdownPlaceholder', "Empty markdown cell, double click or press enter to edit.");
				this._html = el;
			} else {
				this._html = renderer.render({ value: this.getText(), isTrusted: true }).element;
			}

			return this._html;
		}
		return null;
	}

	async resolveTextModel(): Promise<model.ITextModel> {
		if (!this.textModel) {
			const ref = await this.model.resolveTextModelRef();
			this.textModel = ref.object.textEditorModel;
			this._register(ref);
			this._register(this.textModel.onDidChangeContent(() => {
				this._html = null;
				this._onDidChangeState.fire({ contentChanged: true });
			}));
		}
		return this.textModel;
	}

	onDeselect() {
	}

	getMarkdownRenderer() {
		return this._mdRenderer;
	}

	private readonly _hasFindResult = this._register(new Emitter<boolean>());
	public readonly hasFindResult: Event<boolean> = this._hasFindResult.event;

	startFind(value: string, options: INotebookSearchOptions): CellFindMatch | null {
		const matches = super.cellStartFind(value, options);

		if (matches === null) {
			return null;
		}

		return {
			cell: this,
			matches
		};
	}
}
