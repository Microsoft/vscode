/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import * as UUID from 'vs/base/common/uuid';
import * as editorCommon from 'vs/editor/common/editorCommon';
import * as model from 'vs/editor/common/model';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { PrefixSumComputer } from 'vs/editor/common/viewModel/prefixSumComputer';
import { BOTTOM_CELL_TOOLBAR_HEIGHT, CELL_MARGIN, CELL_RUN_GUTTER, CELL_STATUSBAR_HEIGHT, EDITOR_BOTTOM_PADDING, EDITOR_TOOLBAR_HEIGHT, EDITOR_TOP_MARGIN, EDITOR_TOP_PADDING } from 'vs/workbench/contrib/notebook/browser/constants';
import { CellEditState, CellFindMatch, CodeCellLayoutChangeEvent, CodeCellLayoutInfo, ICellViewModel, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, NotebookCellOutputsSplice } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { BaseCellViewModel } from './baseCellViewModel';
import { NotebookEventDispatcher } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';

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
		return this.model.outputs;
	}

	protected readonly _onDidChangeLayout = new Emitter<CodeCellLayoutChangeEvent>();
	readonly onDidChangeLayout = this._onDidChangeLayout.event;

	private _editorHeight = 0;
	set editorHeight(height: number) {
		this._editorHeight = height;

		this.layoutChange({ editorHeight: true });
	}

	get editorHeight() {
		return this._editorHeight;
	}

	private _hoveringOutput: boolean = false;
	public get outputIsHovered(): boolean {
		return this._hoveringOutput;
	}

	public set outputIsHovered(v: boolean) {
		this._hoveringOutput = v;
		this._onDidChangeState.fire({ outputIsHoveredChanged: true });
	}

	private _layoutInfo: CodeCellLayoutInfo;

	get layoutInfo() {
		return this._layoutInfo;
	}

	constructor(
		readonly viewType: string,
		readonly notebookHandle: number,
		readonly model: NotebookCellTextModel,
		initialNotebookLayoutInfo: NotebookLayoutInfo | null,
		readonly eventDispatcher: NotebookEventDispatcher,
		@ITextModelService private readonly _modelService: ITextModelService,
	) {
		super(viewType, notebookHandle, model, UUID.generateUuid());
		this._register(this.model.onDidChangeOutputs((splices) => {
			this._outputCollection = new Array(this.model.outputs.length);
			this._outputsTop = null;
			this._onDidChangeOutputs.fire(splices);
		}));

		this._outputCollection = new Array(this.model.outputs.length);

		this._layoutInfo = {
			fontInfo: initialNotebookLayoutInfo?.fontInfo || null,
			editorHeight: 0,
			editorWidth: initialNotebookLayoutInfo ? this.computeEditorWidth(initialNotebookLayoutInfo!.width) : 0,
			outputContainerOffset: 0,
			outputTotalHeight: 0,
			totalHeight: 0,
			indicatorHeight: 0,
			bottomToolbarOffset: 0
		};
	}

	private computeEditorWidth(outerWidth: number): number {
		return outerWidth - (CELL_MARGIN * 2 + CELL_RUN_GUTTER);
	}

	layoutChange(state: CodeCellLayoutChangeEvent) {
		// recompute
		this._ensureOutputsTop();
		const outputTotalHeight = this._outputsTop!.getTotalValue();
		const totalHeight = EDITOR_TOOLBAR_HEIGHT + this.editorHeight + EDITOR_TOP_MARGIN + outputTotalHeight + BOTTOM_CELL_TOOLBAR_HEIGHT + CELL_STATUSBAR_HEIGHT;
		const indicatorHeight = this.editorHeight + CELL_STATUSBAR_HEIGHT + outputTotalHeight;
		const outputContainerOffset = EDITOR_TOOLBAR_HEIGHT + EDITOR_TOP_MARGIN + this.editorHeight + CELL_STATUSBAR_HEIGHT;
		const bottomToolbarOffset = totalHeight - BOTTOM_CELL_TOOLBAR_HEIGHT;
		const editorWidth = state.outerWidth !== undefined ? this.computeEditorWidth(state.outerWidth) : this._layoutInfo?.editorWidth;
		this._layoutInfo = {
			fontInfo: state.font || null,
			editorHeight: this._editorHeight,
			editorWidth,
			outputContainerOffset,
			outputTotalHeight,
			totalHeight,
			indicatorHeight,
			bottomToolbarOffset: bottomToolbarOffset
		};

		if (state.editorHeight || state.outputHeight) {
			state.totalHeight = true;
		}

		this._fireOnDidChangeLayout(state);
	}

	private _fireOnDidChangeLayout(state: CodeCellLayoutChangeEvent) {
		this._onDidChangeLayout.fire(state);
	}

	restoreEditorViewState(editorViewStates: editorCommon.ICodeEditorViewState | null, totalHeight?: number) {
		super.restoreEditorViewState(editorViewStates);
		if (totalHeight !== undefined) {
			this._layoutInfo = {
				fontInfo: this._layoutInfo.fontInfo,
				editorHeight: this._layoutInfo.editorHeight,
				editorWidth: this._layoutInfo.editorWidth,
				outputContainerOffset: this._layoutInfo.outputContainerOffset,
				outputTotalHeight: this._layoutInfo.outputTotalHeight,
				totalHeight: totalHeight,
				indicatorHeight: this._layoutInfo.indicatorHeight,
				bottomToolbarOffset: this._layoutInfo.bottomToolbarOffset
			};
		}
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
		if (this._layoutInfo.totalHeight === 0) {
			return EDITOR_TOOLBAR_HEIGHT + EDITOR_TOP_MARGIN + this.lineCount * lineHeight + EDITOR_TOP_PADDING + EDITOR_BOTTOM_PADDING + BOTTOM_CELL_TOOLBAR_HEIGHT;
		} else {
			return this._layoutInfo.totalHeight;
		}
	}

	/**
	 * Text model is used for editing.
	 */
	async resolveTextModel(): Promise<model.ITextModel> {
		if (!this._textModel) {
			const ref = await this._modelService.createModelReference(this.model.uri);
			this._textModel = ref.object.textEditorModel;
			this._register(ref);
			this._register(this._textModel.onDidChangeContent(() => {
				this.editState = CellEditState.Editing;
				this._onDidChangeState.fire({ contentChanged: true });
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
