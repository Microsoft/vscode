/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import * as UUID from 'vs/base/common/uuid';
import * as editorCommon from 'vs/editor/common/editorCommon';
import * as nls from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { BOTTOM_CELL_TOOLBAR_GAP, BOTTOM_CELL_TOOLBAR_HEIGHT, CODE_CELL_LEFT_MARGIN, COLLAPSED_INDICATOR_HEIGHT, MARKDOWN_CELL_BOTTOM_MARGIN, MARKDOWN_CELL_TOP_MARGIN, CELL_RIGHT_MARGIN } from 'vs/workbench/contrib/notebook/browser/constants';
import { EditorFoldingStateDelegate } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { CellEditState, CellFindMatch, ICellOutputViewModel, ICellViewModel, MarkdownCellLayoutChangeEvent, MarkdownCellLayoutInfo, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { MarkdownRenderer } from 'vs/editor/browser/core/markdownRenderer';
import { BaseCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/baseCellViewModel';
import { NotebookCellStateChangedEvent, NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, INotebookSearchOptions } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ITextModelService } from 'vs/editor/common/services/resolverService';

export class MarkdownCellViewModel extends BaseCellViewModel implements ICellViewModel {
	readonly cellKind = CellKind.Markdown;
	private _html: HTMLElement | null = null;
	private _layoutInfo: MarkdownCellLayoutInfo;

	get layoutInfo() {
		return this._layoutInfo;
	}

	set renderedMarkdownHeight(newHeight: number) {
		if (this.getEditState() === CellEditState.Preview) {
			const newTotalHeight = newHeight + BOTTOM_CELL_TOOLBAR_GAP;
			this.totalHeight = newTotalHeight;
		}
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

		this.totalHeight = this._editorHeight + MARKDOWN_CELL_TOP_MARGIN + MARKDOWN_CELL_BOTTOM_MARGIN + BOTTOM_CELL_TOOLBAR_GAP + this.getEditorStatusbarHeight();
	}

	get editorHeight() {
		throw new Error('MarkdownCellViewModel.editorHeight is write only');
	}

	protected readonly _onDidChangeLayout = new Emitter<MarkdownCellLayoutChangeEvent>();
	readonly onDidChangeLayout = this._onDidChangeLayout.event;

	get foldingState() {
		return this.foldingDelegate.getFoldingState(this.foldingDelegate.getCellIndex(this));
	}

	private _hoveringOutput: boolean = false;
	public get outputIsHovered(): boolean {
		return this._hoveringOutput;
	}

	public set outputIsHovered(v: boolean) {
		this._hoveringOutput = v;
	}

	private _focusOnOutput: boolean = false;
	public get outputIsFocused(): boolean {
		return this._focusOnOutput;
	}

	public set outputIsFocused(v: boolean) {
		this._focusOnOutput = v;
	}

	private _hoveringCell = false;
	public get cellIsHovered(): boolean {
		return this._hoveringCell;
	}

	public set cellIsHovered(v: boolean) {
		this._hoveringCell = v;
		this._onDidChangeState.fire({ cellIsHoveredChanged: true });
	}

	public get contentHash(): number {
		return this.model.getHashValue();
	}

	private readonly _onDidHideInput = new Emitter<void>();
	readonly onDidHideInput = this._onDidHideInput.event;

	constructor(
		viewType: string,
		model: NotebookCellTextModel,
		initialNotebookLayoutInfo: NotebookLayoutInfo | null,
		readonly foldingDelegate: EditorFoldingStateDelegate,
		readonly eventDispatcher: NotebookEventDispatcher,
		private readonly _mdRenderer: MarkdownRenderer,
		@IConfigurationService configurationService: IConfigurationService,
		@ITextModelService textModelService: ITextModelService,
	) {
		super(viewType, model, UUID.generateUuid(), configurationService, textModelService);

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

		this._register(model.onDidChangeMetadata(e => {
			if (this.metadata?.inputCollapsed) {
				this._onDidHideInput.fire();
			}
		}));
	}

	/**
	 * we put outputs stuff here to make compiler happy
	 */
	outputsViewModels: ICellOutputViewModel[] = [];
	getOutputOffset(index: number): number {
		// throw new Error('Method not implemented.');
		return -1;
	}
	updateOutputHeight(index: number, height: number): void {
		// throw new Error('Method not implemented.');
	}

	triggerfoldingStateChange() {
		this._onDidChangeState.fire({ foldingStateChanged: true });
	}

	private computeEditorWidth(outerWidth: number) {
		return outerWidth - CODE_CELL_LEFT_MARGIN - CELL_RIGHT_MARGIN;
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
			const totalHeight = MARKDOWN_CELL_TOP_MARGIN + COLLAPSED_INDICATOR_HEIGHT + BOTTOM_CELL_TOOLBAR_GAP + MARKDOWN_CELL_BOTTOM_MARGIN;
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

	override restoreEditorViewState(editorViewStates: editorCommon.ICodeEditorViewState | null, totalHeight?: number) {
		super.restoreEditorViewState(editorViewStates);
		// we might already warmup the viewport so the cell has a total height computed
		if (totalHeight !== undefined && this._layoutInfo.totalHeight === 0) {
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
				this._html = renderer.render({ value: this.getText(), isTrusted: true }, undefined, { gfm: true }).element;
			}

			return this._html;
		}
		return null;
	}

	protected onDidChangeTextModelContent(): void {
		this._html = null;
		this._onDidChangeState.fire({ contentChanged: true });
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
