/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import * as UUID from 'vs/base/common/uuid';
import * as model from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { PrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';
import { EDITOR_BOTTOM_PADDING, EDITOR_TOOLBAR_HEIGHT, EDITOR_TOP_PADDING, CELL_MARGIN, CELL_RUN_GUTTER, EDITOR_TOP_MARGIN } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellEditState, ICellViewModel, CellFindMatch, CodeCellLayoutChangeEvent, CodeCellLayoutInfo, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CellKind, ICell, NotebookCellOutputsSplice } from 'vs/workbench/services/notebook/common/notebookCommon';
import { BaseCellViewModel } from './baseCellViewModel';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { debounce } from 'vs/base/common/decorators';

export class CodeCellViewModel extends BaseCellViewModel implements ICellViewModel {
	cellKind: CellKind.Code = CellKind.Code;
	protected readonly _onDidChangeOutputs = new Emitter<NotebookCellOutputsSplice[]>();
	readonly onDidChangeOutputs = this._onDidChangeOutputs.event;
	private _outputCollection: number[] = [];
	private _selfSizeMonitoring: boolean = false;
	set selfSizeMonitoring(newVal: boolean) {
		this._selfSizeMonitoring = newVal;
	}

	get selfSizeMonitoring() {
		return this._selfSizeMonitoring;
	}

	private _outputsTop: PrefixSumComputer | null = null;
	get outputs() {
		return this.cell.outputs;
	}

	private readonly _onDidChangeContent: Emitter<void> = this._register(new Emitter<void>());
	public readonly onDidChangeContent: Event<void> = this._onDidChangeContent.event;

	protected readonly _onDidChangeLayout = new Emitter<void>();
	readonly onDidChangeLayout = this._onDidChangeLayout.event;

	private _editorHeight = 0;
	set editorHeight(height: number) {
		this._editorHeight = height;

		this.layoutChange({ editorHeight: true });
	}

	get editorHeight() {
		return this._editorHeight;
	}

	private _layoutInfo: CodeCellLayoutInfo;

	get layoutInfo() {
		return this._layoutInfo;
	}

	constructor(
		readonly viewType: string,
		readonly notebookHandle: number,
		readonly cell: ICell,
		readonly eventDispatcher: NotebookEventDispatcher,
		initialNotebookLayoutInfo: NotebookLayoutInfo | null,
		@ITextModelService private readonly _modelService: ITextModelService,
	) {
		super(viewType, notebookHandle, cell, UUID.generateUuid());
		if (this.cell.onDidChangeOutputs) {
			this._register(this.cell.onDidChangeOutputs((splices) => {
				this._outputCollection = new Array(this.cell.outputs.length);
				this._outputsTop = null;
				this._onDidChangeOutputs.fire(splices);
			}));
		}

		this._register(this.cell.onDidChangeMetadata(() => {
			this._onDidChangeMetadata.fire();
		}));

		this._outputCollection = new Array(this.cell.outputs.length);
		this._buffer = null;

		this._layoutInfo = {
			fontInfo: initialNotebookLayoutInfo?.fontInfo || null,
			editorHeight: 0,
			editorWidth: 0,
			outputContainerOffset: 0,
			outputTotalHeight: 0,
			totalHeight: 0,
			indicatorHeight: 0
		};

		this._register(eventDispatcher.onDidChangeLayout((e) => {
			if (e.source.width !== undefined) {
				this.layoutChange({ outerWidth: e.value.width, font: e.value.fontInfo });
			}
		}));

		this._register(this.onDidChangeLanguage((e) => {
			if (this._textModel && !this._textModel.isDisposed()) {

			}
		}));
	}

	layoutChange(state: CodeCellLayoutChangeEvent) {
		// recompute
		this._ensureOutputsTop();
		const outputTotalHeight = this._outputsTop!.getTotalValue();
		const totalHeight = EDITOR_TOOLBAR_HEIGHT + this.editorHeight + EDITOR_TOP_MARGIN + 16 + outputTotalHeight;
		const indicatorHeight = this.editorHeight + outputTotalHeight;
		const outputContainerOffset = EDITOR_TOOLBAR_HEIGHT + this.editorHeight;
		const editorWidth = state.outerWidth !== undefined ? state.outerWidth - CELL_MARGIN * 2 - CELL_RUN_GUTTER : 0;
		this._layoutInfo = {
			fontInfo: state.font || null,
			editorHeight: this._editorHeight,
			editorWidth,
			outputContainerOffset,
			outputTotalHeight,
			totalHeight,
			indicatorHeight
		};

		if (state.editorHeight || state.outputHeight) {
			state.totalHeight = true;
		}

		this._fireOnDidChangeLayout();
	}

	@debounce(100)
	private _fireOnDidChangeLayout() {
		this._onDidChangeLayout.fire();
	}

	hasDynamicHeight() {
		if (this.selfSizeMonitoring) {
			// if there is an output rendered in the webview, it should always be false
			return false;
		}

		if (this.outputs && this.outputs.length > 0) {
			// if it contains output, it will be marked as dynamic height
			// thus when it's being rendered, the list view will `probeHeight`
			// inside which, we will check domNode's height directly instead of doing another `renderElement` with height undefined.
			return true;
		}
		else {
			return false;
		}
	}

	getHeight(lineHeight: number) {
		return this.lineCount * lineHeight + 16 + EDITOR_TOP_PADDING + EDITOR_BOTTOM_PADDING;
	}

	save() {
		if (this._textModel && !this._textModel.isDisposed() && this.editState === CellEditState.Editing) {
			let cnt = this._textModel.getLineCount();
			this.cell.source = this._textModel.getLinesContent().map((str, index) => str + (index !== cnt - 1 ? '\n' : ''));
		}
	}

	async resolveTextModel(): Promise<model.ITextModel> {
		if (!this._textModel) {
			const ref = await this._modelService.createModelReference(this.cell.uri);
			this._textModel = ref.object.textEditorModel;
			this._buffer = this._textModel.getTextBuffer();
			this._register(ref);
			this._register(this._textModel.onDidChangeContent(() => {
				this.cell.contentChange();
				this._onDidChangeContent.fire();
			}));
		}

		return this._textModel;
	}

	onDeselect() {
		this.editState = CellEditState.Preview;
	}

	updateOutputHeight(index: number, height: number) {
		if (index >= this._outputCollection.length) {
			throw new Error('Output index out of range!');
		}

		this._outputCollection[index] = height;
		this._ensureOutputsTop();
		this._outputsTop!.changeValue(index, height);
		this.layoutChange({ outputHeight: true });
	}

	getOutputOffset(index: number): number {
		this._ensureOutputsTop();

		if (index >= this._outputCollection.length) {
			throw new Error('Output index out of range!');
		}

		const offset = this._outputsTop!.getAccumulatedValue(index - 1);
		return this.layoutInfo.outputContainerOffset + offset;
	}

	spliceOutputHeights(start: number, deleteCnt: number, heights: number[]) {
		this._ensureOutputsTop();

		this._outputsTop!.removeValues(start, deleteCnt);
		if (heights.length) {
			const values = new Uint32Array(heights.length);
			for (let i = 0; i < heights.length; i++) {
				values[i] = heights[i];
			}

			this._outputsTop!.insertValues(start, values);
		}

		this.layoutChange({ outputHeight: true });
	}

	private _ensureOutputsTop(): void {
		if (!this._outputsTop) {
			const values = new Uint32Array(this._outputCollection.length);
			for (let i = 0; i < this._outputCollection.length; i++) {
				values[i] = this._outputCollection[i];
			}

			this._outputsTop = new PrefixSumComputer(values);
		}
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
