/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import * as UUID from 'vs/base/common/uuid';
import * as editorCommon from 'vs/editor/common/editorCommon';
import * as model from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { BOTTOM_CELL_TOOLBAR_HEIGHT, CELL_MARGIN, CELL_RUN_GUTTER } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellEditState, CellFindMatch, ICellViewModel, MarkdownCellLayoutChangeEvent, MarkdownCellLayoutInfo, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { MarkdownRenderer } from 'vs/workbench/contrib/notebook/browser/view/renderers/mdRenderer';
import { BaseCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/baseCellViewModel';
import { EditorFoldingStateDelegate } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookEventDispatcher, NotebookCellStateChangedEvent } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';

export class MarkdownCellViewModel extends BaseCellViewModel implements ICellViewModel {
	cellKind: CellKind.Markdown = CellKind.Markdown;
	private _mdRenderer: MarkdownRenderer | null = null;
	private _html: HTMLElement | null = null;
	private _layoutInfo: MarkdownCellLayoutInfo;

	get layoutInfo() {
		return this._layoutInfo;
	}

	set totalHeight(newHeight: number) {
		this.layoutChange({ totalHeight: newHeight });
	}

	get totalHeight() {
		throw new Error('MarkdownCellViewModel.totalHeight is write only');
	}

	protected readonly _onDidChangeLayout = new Emitter<MarkdownCellLayoutChangeEvent>();
	readonly onDidChangeLayout = this._onDidChangeLayout.event;

	get foldingState() {
		return this.foldingDelegate.getFoldingState(this.foldingDelegate.getCellIndex(this));
	}

	constructor(
		readonly viewType: string,
		readonly notebookHandle: number,
		readonly model: NotebookCellTextModel,
		initialNotebookLayoutInfo: NotebookLayoutInfo | null,
		readonly foldingDelegate: EditorFoldingStateDelegate,
		readonly eventDispatcher: NotebookEventDispatcher,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ITextModelService private readonly _modelService: ITextModelService) {
		super(viewType, notebookHandle, model, UUID.generateUuid());

		this._layoutInfo = {
			fontInfo: initialNotebookLayoutInfo?.fontInfo || null,
			editorWidth: initialNotebookLayoutInfo?.width ? this.computeEditorWidth(initialNotebookLayoutInfo.width) : 0,
			bottomToolbarOffset: BOTTOM_CELL_TOOLBAR_HEIGHT,
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
		return outerWidth - (CELL_MARGIN * 2) - CELL_RUN_GUTTER;
	}

	layoutChange(state: MarkdownCellLayoutChangeEvent) {
		// recompute
		const editorWidth = state.outerWidth !== undefined ? this.computeEditorWidth(state.outerWidth) : this._layoutInfo.editorWidth;

		this._layoutInfo = {
			fontInfo: state.font || this._layoutInfo.fontInfo,
			editorWidth,
			bottomToolbarOffset: BOTTOM_CELL_TOOLBAR_HEIGHT,
			totalHeight: state.totalHeight === undefined ? this._layoutInfo.totalHeight : state.totalHeight
		};

		this._onDidChangeLayout.fire(state);
	}

	restoreEditorViewState(editorViewStates: editorCommon.ICodeEditorViewState | null, totalHeight?: number) {
		super.restoreEditorViewState(editorViewStates);
		if (totalHeight !== undefined) {
			this._layoutInfo = {
				fontInfo: this._layoutInfo.fontInfo,
				editorWidth: this._layoutInfo.editorWidth,
				bottomToolbarOffset: this._layoutInfo.bottomToolbarOffset,
				totalHeight: totalHeight
			};
		}
	}

	hasDynamicHeight() {
		return true;
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
			let renderer = this.getMarkdownRenderer();
			this._html = renderer.render({ value: this.getText(), isTrusted: true }).element;
			return this._html;
		}
		return null;
	}

	async resolveTextModel(): Promise<model.ITextModel> {
		if (!this._textModel) {
			const ref = await this._modelService.createModelReference(this.model.uri);
			this._textModel = ref.object.textEditorModel;
			this._register(ref);
			this._register(this._textModel.onDidChangeContent(() => {
				this._html = null;
				this._onDidChangeState.fire({ contentChanged: true });
			}));
		}
		return this._textModel;
	}

	onDeselect() {
		this.editState = CellEditState.Preview;
	}

	getMarkdownRenderer() {
		if (!this._mdRenderer) {
			this._mdRenderer = this._instaService.createInstance(MarkdownRenderer);
		}
		return this._mdRenderer;
	}

	private readonly _hasFindResult = this._register(new Emitter<boolean>());
	public readonly hasFindResult: Event<boolean> = this._hasFindResult.event;

	startFind(value: string): CellFindMatch | null {
		const matches = super.cellStartFind(value);

		if (matches === null) {
			return null;
		}

		return {
			cell: this,
			matches
		};
	}
}
