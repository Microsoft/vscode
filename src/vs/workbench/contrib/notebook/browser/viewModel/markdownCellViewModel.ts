/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import * as UUID from 'vs/base/common/uuid';
import * as model from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ICellViewModel, CellFindMatch, MarkdownCellLayoutInfo, MarkdownCellLayoutChangeEvent, CellEditState, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { MarkdownRenderer } from 'vs/workbench/contrib/notebook/browser/view/renderers/mdRenderer';
import { BaseCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/baseCellViewModel';
import { CellKind, ICell } from 'vs/workbench/services/notebook/common/notebookCommon';
import { CELL_MARGIN, CELL_RUN_GUTTER } from 'vs/workbench/contrib/notebook/browser/constants';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';

export class MarkdownCellViewModel extends BaseCellViewModel implements ICellViewModel {
	cellKind: CellKind.Markdown = CellKind.Markdown;
	private _mdRenderer: MarkdownRenderer | null = null;
	private _html: HTMLElement | null = null;
	private readonly _onDidChangeContent: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;

	private _layoutInfo: MarkdownCellLayoutInfo;

	get layoutInfo() {
		return this._layoutInfo;
	}

	protected readonly _onDidChangeLayout = new Emitter<MarkdownCellLayoutChangeEvent>();
	readonly onDidChangeLayout = this._onDidChangeLayout.event;

	constructor(
		readonly viewType: string,
		readonly notebookHandle: number,
		readonly cell: ICell,
		readonly eventDispatcher: NotebookEventDispatcher,
		initialNotebookLayoutInfo: NotebookLayoutInfo | null,
		@IInstantiationService private readonly _instaService: IInstantiationService,
		@ITextModelService private readonly _modelService: ITextModelService) {
		super(viewType, notebookHandle, cell, UUID.generateUuid());

		this._layoutInfo = {
			fontInfo: initialNotebookLayoutInfo?.fontInfo || null,
			editorWidth: initialNotebookLayoutInfo?.width || 0
		};

		this._register(eventDispatcher.onDidChangeLayout((e) => {
			if (e.source.width || e.source.fontInfo) {
				this.layoutChange({ outerWidth: e.value.width, font: e.value.fontInfo });
			}
		}));
	}

	layoutChange(state: MarkdownCellLayoutChangeEvent) {
		// recompute
		const editorWidth = state.outerWidth !== undefined ? state.outerWidth - CELL_MARGIN * 2 - CELL_RUN_GUTTER : 0;

		this._layoutInfo = {
			fontInfo: state.font || null,
			editorWidth
		};

		this._onDidChangeLayout.fire(state);
	}

	hasDynamicHeight() {
		return true;
	}

	getHeight(lineHeight: number) {
		return 100;
	}

	setText(strs: string[]) {
		this.cell.source = strs;
		this._html = null;
	}

	save() {
		if (this._textModel && !this._textModel.isDisposed() && this.editState === CellEditState.Editing) {
			let cnt = this._textModel.getLineCount();
			this.cell.source = this._textModel.getLinesContent().map((str, index) => str + (index !== cnt - 1 ? '\n' : ''));
		}
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
			const ref = await this._modelService.createModelReference(this.cell.uri);
			this._textModel = ref.object.textEditorModel;
			this._buffer = this._textModel.getTextBuffer();
			this._register(ref);
			this._register(this._textModel.onDidChangeContent(() => {
				this.cell.contentChange();
				this._html = null;
				this._onDidChangeContent.fire();
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
