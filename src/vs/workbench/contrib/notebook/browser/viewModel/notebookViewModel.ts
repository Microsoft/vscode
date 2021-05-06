/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { clamp } from 'vs/base/common/numbers';
import * as strings from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { IBulkEditService, ResourceEdit, ResourceTextEdit } from 'vs/editor/browser/services/bulkEditService';
import { Range } from 'vs/editor/common/core/range';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { IModelDecorationOptions, IModelDeltaDecoration, TrackedRangeStickiness, IReadonlyTextBuffer, EndOfLinePreference } from 'vs/editor/common/model';
import { IntervalNode, IntervalTree } from 'vs/editor/common/model/intervalTree';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { WorkspaceTextEdit } from 'vs/editor/common/modes';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { CellEditState, CellFindMatch, ICellViewModel, NotebookLayoutInfo, INotebookDeltaDecoration, INotebookDeltaCellStatusBarItems, CellFocusMode, CellFindMatchWithIndex } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { NotebookEventDispatcher, NotebookMetadataChangedEvent } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { CellFoldingState, EditorFoldingStateDelegate } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind, NotebookCellMetadata, INotebookSearchOptions, NotebookCellsChangeType, ICell, NotebookCellTextModelSplice, CellEditType, IOutputDto, SelectionStateType, ISelectionState } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ICellRange, cellIndexesToRanges, cellRangesToIndexes, reduceRanges } from 'vs/workbench/contrib/notebook/common/notebookRange';
import { FoldingRegions } from 'vs/editor/contrib/folding/foldingRanges';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { MarkdownRenderer } from 'vs/editor/browser/core/markdownRenderer';
import { dirname } from 'vs/base/common/resources';
import { IPosition, Position } from 'vs/editor/common/core/position';
import { MultiModelEditStackElement, SingleModelEditStackElement } from 'vs/editor/common/model/editStack';
import { ResourceNotebookCellEdit } from 'vs/workbench/contrib/bulkEdit/browser/bulkCellEdits';
import { NotebookCellSelectionCollection } from 'vs/workbench/contrib/notebook/browser/viewModel/cellSelectionCollection';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { groupByNumber } from 'vs/base/common/collections';

export interface INotebookEditorViewState {
	editingCells: { [key: number]: boolean };
	editorViewStates: { [key: number]: editorCommon.ICodeEditorViewState | null };
	hiddenFoldingRanges?: ICellRange[];
	cellTotalHeights?: { [key: number]: number };
	scrollPosition?: { left: number; top: number; };
	focus?: number;
	editorFocused?: boolean;
	contributionsState?: { [id: string]: unknown };
}

export interface ICellModelDecorations {
	ownerId: number;
	decorations: string[];
}

export interface ICellModelDeltaDecorations {
	ownerId: number;
	decorations: IModelDeltaDecoration[];
}

export interface IModelDecorationsChangeAccessor {
	deltaDecorations(oldDecorations: ICellModelDecorations[], newDecorations: ICellModelDeltaDecorations[]): ICellModelDecorations[];
}

const invalidFunc = () => { throw new Error(`Invalid change accessor`); };


export type NotebookViewCellsSplice = [
	number /* start */,
	number /* delete count */,
	CellViewModel[]
];

export interface INotebookViewCellsUpdateEvent {
	synchronous: boolean;
	splices: NotebookViewCellsSplice[];
}


class DecorationsTree {
	private readonly _decorationsTree: IntervalTree;

	constructor() {
		this._decorationsTree = new IntervalTree();
	}

	public intervalSearch(start: number, end: number, filterOwnerId: number, filterOutValidation: boolean, cachedVersionId: number): IntervalNode[] {
		const r1 = this._decorationsTree.intervalSearch(start, end, filterOwnerId, filterOutValidation, cachedVersionId);
		return r1;
	}

	public search(filterOwnerId: number, filterOutValidation: boolean, overviewRulerOnly: boolean, cachedVersionId: number): IntervalNode[] {
		return this._decorationsTree.search(filterOwnerId, filterOutValidation, cachedVersionId);

	}

	public collectNodesFromOwner(ownerId: number): IntervalNode[] {
		const r1 = this._decorationsTree.collectNodesFromOwner(ownerId);
		return r1;
	}

	public collectNodesPostOrder(): IntervalNode[] {
		const r1 = this._decorationsTree.collectNodesPostOrder();
		return r1;
	}

	public insert(node: IntervalNode): void {
		this._decorationsTree.insert(node);
	}

	public delete(node: IntervalNode): void {
		this._decorationsTree.delete(node);
	}

	public resolveNode(node: IntervalNode, cachedVersionId: number): void {
		this._decorationsTree.resolveNode(node, cachedVersionId);
	}

	public acceptReplace(offset: number, length: number, textLength: number, forceMoveMarkers: boolean): void {
		this._decorationsTree.acceptReplace(offset, length, textLength, forceMoveMarkers);
	}
}

const TRACKED_RANGE_OPTIONS = [
	ModelDecorationOptions.register({ stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges }),
	ModelDecorationOptions.register({ stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges }),
	ModelDecorationOptions.register({ stickiness: TrackedRangeStickiness.GrowsOnlyWhenTypingBefore }),
	ModelDecorationOptions.register({ stickiness: TrackedRangeStickiness.GrowsOnlyWhenTypingAfter }),
];

function _normalizeOptions(options: IModelDecorationOptions): ModelDecorationOptions {
	if (options instanceof ModelDecorationOptions) {
		return options;
	}
	return ModelDecorationOptions.createDynamic(options);
}

let MODEL_ID = 0;

export interface NotebookViewModelOptions {
	isReadOnly: boolean;
}

export class NotebookViewModel extends Disposable implements EditorFoldingStateDelegate {
	private _localStore: DisposableStore = this._register(new DisposableStore());
	private _handleToViewCellMapping = new Map<number, CellViewModel>();
	private _options: NotebookViewModelOptions;
	get options(): NotebookViewModelOptions { return this._options; }
	private _viewCells: CellViewModel[] = [];

	get viewCells(): ICellViewModel[] {
		return this._viewCells;
	}

	set viewCells(_: ICellViewModel[]) {
		throw new Error('NotebookViewModel.viewCells is readonly');
	}

	get length(): number {
		return this._viewCells.length;
	}

	get notebookDocument() {
		return this._notebook;
	}

	get uri() {
		return this._notebook.uri;
	}

	get metadata() {
		return this._notebook.metadata;
	}

	get trusted() {
		return !!this._notebook.metadata?.trusted;
	}

	private readonly _onDidChangeViewCells = this._register(new Emitter<INotebookViewCellsUpdateEvent>());
	get onDidChangeViewCells(): Event<INotebookViewCellsUpdateEvent> { return this._onDidChangeViewCells.event; }

	private _lastNotebookEditResource: URI[] = [];

	get lastNotebookEditResource(): URI | null {
		if (this._lastNotebookEditResource.length) {
			return this._lastNotebookEditResource[this._lastNotebookEditResource.length - 1];
		}
		return null;
	}

	get layoutInfo(): NotebookLayoutInfo | null {
		return this._layoutInfo;
	}

	private readonly _onDidChangeSelection = this._register(new Emitter<string>());
	get onDidChangeSelection(): Event<string> { return this._onDidChangeSelection.event; }

	private _selectionCollection = new NotebookCellSelectionCollection();

	private get selectionHandles() {
		const handlesSet = new Set<number>();
		const handles: number[] = [];
		cellRangesToIndexes(this._selectionCollection.selections).map(index => this.cellAt(index)).forEach(cell => {
			if (cell && !handlesSet.has(cell.handle)) {
				handles.push(cell.handle);
			}
		});

		return handles;
	}

	private set selectionHandles(selectionHandles: number[]) {
		const indexes = selectionHandles.map(handle => this._viewCells.findIndex(cell => cell.handle === handle));
		this._selectionCollection.setSelections(cellIndexesToRanges(indexes), true, 'model');
	}

	private _decorationsTree = new DecorationsTree();
	private _decorations: { [decorationId: string]: IntervalNode; } = Object.create(null);
	private _lastDecorationId: number = 0;
	private readonly _instanceId: string;
	public readonly id: string;
	private _foldingRanges: FoldingRegions | null = null;
	private _hiddenRanges: ICellRange[] = [];
	private _focused: boolean = true;

	get focused() {
		return this._focused;
	}

	private _decorationIdToCellMap = new Map<string, number>();
	private _statusBarItemIdToCellMap = new Map<string, number>();

	constructor(
		public viewType: string,
		private _notebook: NotebookTextModel,
		readonly eventDispatcher: NotebookEventDispatcher,
		private _layoutInfo: NotebookLayoutInfo | null,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IBulkEditService private readonly _bulkEditService: IBulkEditService,
		@IUndoRedoService private readonly _undoService: IUndoRedoService,
		@ITextModelService private readonly _textModelService: ITextModelService,
	) {
		super();

		MODEL_ID++;
		this.id = '$notebookViewModel' + MODEL_ID;
		this._instanceId = strings.singleLetterHash(MODEL_ID);
		this._options = { isReadOnly: false };

		const compute = (changes: NotebookCellTextModelSplice<ICell>[], synchronous: boolean) => {
			const diffs = changes.map(splice => {
				return [splice[0], splice[1], splice[2].map(cell => {
					return createCellViewModel(this._instantiationService, this, cell as NotebookCellTextModel);
				})] as [number, number, CellViewModel[]];
			});

			diffs.reverse().forEach(diff => {
				const deletedCells = this._viewCells.splice(diff[0], diff[1], ...diff[2]);

				this._decorationsTree.acceptReplace(diff[0], diff[1], diff[2].length, true);
				deletedCells.forEach(cell => {
					this._handleToViewCellMapping.delete(cell.handle);
					// dispose the cell to release ref to the cell text document
					cell.dispose();
				});

				diff[2].forEach(cell => {
					this._handleToViewCellMapping.set(cell.handle, cell);
					this._localStore.add(cell);
				});
			});

			this._onDidChangeViewCells.fire({
				synchronous: synchronous,
				splices: diffs
			});

			let endSelectionHandles: number[] = [];
			if (this.selectionHandles.length) {
				const primaryHandle = this.selectionHandles[0];
				const primarySelectionIndex = this._viewCells.indexOf(this.getCellByHandle(primaryHandle)!);
				endSelectionHandles = [primaryHandle];
				let delta = 0;

				for (let i = 0; i < diffs.length; i++) {
					const diff = diffs[0];
					if (diff[0] + diff[1] <= primarySelectionIndex) {
						delta += diff[2].length - diff[1];
						continue;
					}

					if (diff[0] > primarySelectionIndex) {
						endSelectionHandles = [primaryHandle];
						break;
					}

					if (diff[0] + diff[1] > primarySelectionIndex) {
						endSelectionHandles = [this._viewCells[diff[0] + delta].handle];
						break;
					}
				}
			}

			// TODO@rebornix
			this.selectionHandles = endSelectionHandles;
		};

		this._register(this._notebook.onDidChangeContent(e => {
			for (let i = 0; i < e.rawEvents.length; i++) {
				const change = e.rawEvents[i];
				let changes: NotebookCellTextModelSplice<ICell>[] = [];

				if (change.kind === NotebookCellsChangeType.ModelChange || change.kind === NotebookCellsChangeType.Initialize) {
					changes = change.changes;
					compute(changes, e.synchronous);
					continue;
				} else if (change.kind === NotebookCellsChangeType.Move) {
					compute([[change.index, change.length, []]], e.synchronous);
					compute([[change.newIdx, 0, change.cells]], e.synchronous);
				} else {
					continue;
				}
			}
		}));

		this._register(this._notebook.onDidChangeContent(contentChanges => {
			contentChanges.rawEvents.forEach(e => {
				if (e.kind === NotebookCellsChangeType.ChangeDocumentMetadata) {
					this.eventDispatcher.emit([new NotebookMetadataChangedEvent(this._notebook.metadata)]);
				}
			});

			if (contentChanges.endSelectionState) {
				this.updateSelectionsState(contentChanges.endSelectionState);
			}
		}));

		this._register(this.eventDispatcher.onDidChangeLayout((e) => {
			this._layoutInfo = e.value;

			this._viewCells.forEach(cell => {
				if (cell.cellKind === CellKind.Markdown) {
					if (e.source.width || e.source.fontInfo) {
						cell.layoutChange({ outerWidth: e.value.width, font: e.value.fontInfo });
					}
				} else {
					if (e.source.width !== undefined) {
						cell.layoutChange({ outerWidth: e.value.width, font: e.value.fontInfo });
					}
				}
			});
		}));

		this._register(this._selectionCollection.onDidChangeSelection(e => {
			this._onDidChangeSelection.fire(e);
		}));

		this._viewCells = this._notebook.cells.map(cell => {
			return createCellViewModel(this._instantiationService, this, cell);
		});

		this._viewCells.forEach(cell => {
			this._handleToViewCellMapping.set(cell.handle, cell);
		});
	}

	updateOptions(newOptions: Partial<NotebookViewModelOptions>) {
		this._options = { ...this._options, ...newOptions };
	}

	getFocus() {
		return this._selectionCollection.focus;
	}

	getSelections() {
		return this._selectionCollection.selections;
	}

	setFocus(focused: boolean) {
		this._focused = focused;
	}

	/**
	 * Empty selection will be turned to `null`
	 */
	validateRange(cellRange: ICellRange | null | undefined): ICellRange | null {
		if (!cellRange) {
			return null;
		}

		const start = clamp(cellRange.start, 0, this.length);
		const end = clamp(cellRange.end, 0, this.length);

		if (start === end) {
			return null;
		}

		if (start < end) {
			return { start, end };
		} else {
			return { start: end, end: start };
		}
	}

	setSelections(focus: ICellRange, selections: ICellRange[]) {
		this.updateSelectionsState({ kind: SelectionStateType.Index, focus, selections }, 'model');
	}

	// selection change from list view's `setFocus` and `setSelection` should always use `source: view` to prevent events breaking the list view focus/selection change transaction
	updateSelectionsState(state: ISelectionState, source: 'view' | 'model' = 'model') {
		if (this._focused) {
			if (state.kind === SelectionStateType.Handle) {
				const primaryIndex = state.primary !== null ? this.getCellIndexByHandle(state.primary) : null;
				const primarySelection = primaryIndex !== null ? this.validateRange({ start: primaryIndex, end: primaryIndex + 1 }) : null;
				const selections = cellIndexesToRanges(state.selections.map(sel => this.getCellIndexByHandle(sel)))
					.map(range => this.validateRange(range))
					.filter(range => range !== null) as ICellRange[];
				this._selectionCollection.setState(primarySelection, reduceRanges(selections), true, source);
			} else {
				const primarySelection = this.validateRange(state.focus);
				const selections = state.selections
					.map(range => this.validateRange(range))
					.filter(range => range !== null) as ICellRange[];
				this._selectionCollection.setState(primarySelection, reduceRanges(selections), true, source);
			}
		}
	}

	getFoldingStartIndex(index: number): number {
		if (!this._foldingRanges) {
			return -1;
		}

		const range = this._foldingRanges.findRange(index + 1);
		const startIndex = this._foldingRanges.getStartLineNumber(range) - 1;
		return startIndex;
	}

	getFoldingState(index: number): CellFoldingState {
		if (!this._foldingRanges) {
			return CellFoldingState.None;
		}

		const range = this._foldingRanges.findRange(index + 1);
		const startIndex = this._foldingRanges.getStartLineNumber(range) - 1;

		if (startIndex !== index) {
			return CellFoldingState.None;
		}

		return this._foldingRanges.isCollapsed(range) ? CellFoldingState.Collapsed : CellFoldingState.Expanded;
	}

	updateFoldingRanges(ranges: FoldingRegions) {
		this._foldingRanges = ranges;
		let updateHiddenAreas = false;
		const newHiddenAreas: ICellRange[] = [];

		let i = 0; // index into hidden
		let k = 0;

		let lastCollapsedStart = Number.MAX_VALUE;
		let lastCollapsedEnd = -1;

		for (; i < ranges.length; i++) {
			if (!ranges.isCollapsed(i)) {
				continue;
			}

			const startLineNumber = ranges.getStartLineNumber(i) + 1; // the first line is not hidden
			const endLineNumber = ranges.getEndLineNumber(i);
			if (lastCollapsedStart <= startLineNumber && endLineNumber <= lastCollapsedEnd) {
				// ignore ranges contained in collapsed regions
				continue;
			}

			if (!updateHiddenAreas && k < this._hiddenRanges.length && this._hiddenRanges[k].start + 1 === startLineNumber && (this._hiddenRanges[k].end + 1) === endLineNumber) {
				// reuse the old ranges
				newHiddenAreas.push(this._hiddenRanges[k]);
				k++;
			} else {
				updateHiddenAreas = true;
				newHiddenAreas.push({ start: startLineNumber - 1, end: endLineNumber - 1 });
			}
			lastCollapsedStart = startLineNumber;
			lastCollapsedEnd = endLineNumber;
		}

		if (updateHiddenAreas || k < this._hiddenRanges.length) {
			this._hiddenRanges = newHiddenAreas;
		}

		this._viewCells.forEach(cell => {
			if (cell.cellKind === CellKind.Markdown) {
				cell.triggerfoldingStateChange();
			}
		});
	}

	getHiddenRanges() {
		return this._hiddenRanges;
	}

	getCellByHandle(handle: number) {
		return this._handleToViewCellMapping.get(handle);
	}

	getCellIndexByHandle(handle: number): number {
		return this._viewCells.findIndex(cell => cell.handle === handle);
	}

	getCellIndex(cell: ICellViewModel) {
		return this._viewCells.indexOf(cell as CellViewModel);
	}

	cellAt(index: number): CellViewModel | undefined {
		// if (index < 0 || index >= this.length) {
		// 	throw new Error(`Invalid index ${index}`);
		// }

		return this._viewCells[index];
	}

	getCells(range?: ICellRange): ReadonlyArray<ICellViewModel> {
		if (!range) {
			return this._viewCells.slice(0);
		}

		const validatedRange = this.validateRange(range);

		if (validatedRange) {
			const result: ICellViewModel[] = [];

			for (let i = validatedRange.start; i < validatedRange.end; i++) {
				result.push(this._viewCells[i]);
			}

			return result;
		}

		return [];
	}

	/**
	 * If this._viewCells[index] is visible then return index
	 */
	getNearestVisibleCellIndexUpwards(index: number) {
		for (let i = this._hiddenRanges.length - 1; i >= 0; i--) {
			const cellRange = this._hiddenRanges[i];
			const foldStart = cellRange.start - 1;
			const foldEnd = cellRange.end;

			if (foldStart > index) {
				continue;
			}

			if (foldStart <= index && foldEnd >= index) {
				return index;
			}

			// foldStart <= index, foldEnd < index
			break;
		}

		return index;
	}

	getNextVisibleCellIndex(index: number) {
		for (let i = 0; i < this._hiddenRanges.length; i++) {
			const cellRange = this._hiddenRanges[i];
			const foldStart = cellRange.start - 1;
			const foldEnd = cellRange.end;

			if (foldEnd < index) {
				continue;
			}

			// foldEnd >= index
			if (foldStart <= index) {
				return foldEnd + 1;
			}

			break;
		}

		return index + 1;
	}

	hasCell(handle: number) {
		return this._handleToViewCellMapping.has(handle);
	}

	getVersionId() {
		return this._notebook.versionId;
	}

	getAlternativeId() {
		return this._notebook.alternativeVersionId;
	}

	getTrackedRange(id: string): ICellRange | null {
		return this._getDecorationRange(id);
	}

	private _getDecorationRange(decorationId: string): ICellRange | null {
		const node = this._decorations[decorationId];
		if (!node) {
			return null;
		}
		const versionId = this.getVersionId();
		if (node.cachedVersionId !== versionId) {
			this._decorationsTree.resolveNode(node, versionId);
		}
		if (node.range === null) {
			return { start: node.cachedAbsoluteStart - 1, end: node.cachedAbsoluteEnd - 1 };
		}

		return { start: node.range.startLineNumber - 1, end: node.range.endLineNumber - 1 };
	}

	setTrackedRange(id: string | null, newRange: ICellRange | null, newStickiness: TrackedRangeStickiness): string | null {
		const node = (id ? this._decorations[id] : null);

		if (!node) {
			if (!newRange) {
				return null;
			}

			return this._deltaCellDecorationsImpl(0, [], [{ range: new Range(newRange.start + 1, 1, newRange.end + 1, 1), options: TRACKED_RANGE_OPTIONS[newStickiness] }])[0];
		}

		if (!newRange) {
			// node exists, the request is to delete => delete node
			this._decorationsTree.delete(node);
			delete this._decorations[node.id];
			return null;
		}

		this._decorationsTree.delete(node);
		node.reset(this.getVersionId(), newRange.start, newRange.end + 1, new Range(newRange.start + 1, 1, newRange.end + 1, 1));
		node.setOptions(TRACKED_RANGE_OPTIONS[newStickiness]);
		this._decorationsTree.insert(node);
		return node.id;
	}

	private _deltaCellDecorationsImpl(ownerId: number, oldDecorationsIds: string[], newDecorations: IModelDeltaDecoration[]): string[] {
		const versionId = this.getVersionId();

		const oldDecorationsLen = oldDecorationsIds.length;
		let oldDecorationIndex = 0;

		const newDecorationsLen = newDecorations.length;
		let newDecorationIndex = 0;

		const result = new Array<string>(newDecorationsLen);
		while (oldDecorationIndex < oldDecorationsLen || newDecorationIndex < newDecorationsLen) {

			let node: IntervalNode | null = null;

			if (oldDecorationIndex < oldDecorationsLen) {
				// (1) get ourselves an old node
				do {
					node = this._decorations[oldDecorationsIds[oldDecorationIndex++]];
				} while (!node && oldDecorationIndex < oldDecorationsLen);

				// (2) remove the node from the tree (if it exists)
				if (node) {
					this._decorationsTree.delete(node);
					// this._onDidChangeDecorations.checkAffectedAndFire(node.options);
				}
			}

			if (newDecorationIndex < newDecorationsLen) {
				// (3) create a new node if necessary
				if (!node) {
					const internalDecorationId = (++this._lastDecorationId);
					const decorationId = `${this._instanceId};${internalDecorationId}`;
					node = new IntervalNode(decorationId, 0, 0);
					this._decorations[decorationId] = node;
				}

				// (4) initialize node
				const newDecoration = newDecorations[newDecorationIndex];
				// const range = this._validateRangeRelaxedNoAllocations(newDecoration.range);
				const range = newDecoration.range;
				const options = _normalizeOptions(newDecoration.options);
				// const startOffset = this._buffer.getOffsetAt(range.startLineNumber, range.startColumn);
				// const endOffset = this._buffer.getOffsetAt(range.endLineNumber, range.endColumn);

				node.ownerId = ownerId;
				node.reset(versionId, range.startLineNumber, range.endLineNumber, Range.lift(range));
				node.setOptions(options);
				// this._onDidChangeDecorations.checkAffectedAndFire(options);

				this._decorationsTree.insert(node);

				result[newDecorationIndex] = node.id;

				newDecorationIndex++;
			} else {
				if (node) {
					delete this._decorations[node.id];
				}
			}
		}

		return result;
	}

	deltaCellDecorations(oldDecorations: string[], newDecorations: INotebookDeltaDecoration[]): string[] {
		oldDecorations.forEach(id => {
			const handle = this._decorationIdToCellMap.get(id);

			if (handle !== undefined) {
				const cell = this.getCellByHandle(handle);
				cell?.deltaCellDecorations([id], []);
			}
		});

		const result: string[] = [];

		newDecorations.forEach(decoration => {
			const cell = this.getCellByHandle(decoration.handle);
			const ret = cell?.deltaCellDecorations([], [decoration.options]) || [];
			ret.forEach(id => {
				this._decorationIdToCellMap.set(id, decoration.handle);
			});

			result.push(...ret);
		});

		return result;
	}

	deltaCellStatusBarItems(oldItems: string[], newItems: INotebookDeltaCellStatusBarItems[]): string[] {
		const deletesByHandle = groupByNumber(oldItems, id => this._statusBarItemIdToCellMap.get(id) ?? -1);

		const result: string[] = [];
		newItems.forEach(itemDelta => {
			const cell = this.getCellByHandle(itemDelta.handle);
			const deleted = deletesByHandle.get(itemDelta.handle) ?? [];
			deletesByHandle.delete(itemDelta.handle);
			const ret = cell?.deltaCellStatusBarItems(deleted, itemDelta.items) || [];
			ret.forEach(id => {
				this._statusBarItemIdToCellMap.set(id, itemDelta.handle);
			});

			result.push(...ret);
		});

		deletesByHandle.forEach((ids, handle) => {
			const cell = this.getCellByHandle(handle);
			cell?.deltaCellStatusBarItems(ids, []);
		});

		return result;
	}

	nearestCodeCellIndex(index: number /* exclusive */) {
		const nearest = this.viewCells.slice(0, index).reverse().findIndex(cell => cell.cellKind === CellKind.Code);
		if (nearest > -1) {
			return index - nearest - 1;
		} else {
			const nearestCellTheOtherDirection = this.viewCells.slice(index + 1).findIndex(cell => cell.cellKind === CellKind.Code);
			if (nearestCellTheOtherDirection > -1) {
				return index + 1 + nearestCellTheOtherDirection;
			}
			return -1;
		}
	}

	createCell(index: number, source: string, language: string, type: CellKind, metadata: NotebookCellMetadata | undefined, outputs: IOutputDto[], synchronous: boolean, pushUndoStop: boolean = true, previouslyPrimary: number | null = null, previouslyFocused: ICellViewModel[] = []): CellViewModel {
		const beforeSelections = previouslyFocused.map(e => e.handle);
		const endSelections: ISelectionState = { kind: SelectionStateType.Index, focus: { start: index, end: index + 1 }, selections: [{ start: index, end: index + 1 }] };
		this._notebook.applyEdits([
			{
				editType: CellEditType.Replace,
				index,
				count: 0,
				cells: [
					{
						cellKind: type,
						language: language,
						outputs: outputs,
						metadata: metadata,
						source: source
					}
				]
			}
		], synchronous, { kind: SelectionStateType.Handle, primary: previouslyPrimary, selections: beforeSelections }, () => endSelections, undefined);
		return this._viewCells[index];
	}

	deleteCell(index: number, synchronous: boolean, pushUndoStop: boolean = true) {
		const focusSelectionIndex = this.getFocus()?.start ?? null;
		let endPrimarySelection: number | null = null;

		if (index === focusSelectionIndex) {
			if (focusSelectionIndex < this.length - 1) {
				endPrimarySelection = this._viewCells[focusSelectionIndex + 1].handle;
			} else if (focusSelectionIndex === this.length - 1 && this.length > 1) {
				endPrimarySelection = this._viewCells[focusSelectionIndex - 1].handle;
			}
		}

		let endSelections: number[] = this.selectionHandles.filter(handle => handle !== endPrimarySelection && handle !== this._viewCells[index]?.handle);

		this._notebook.applyEdits([
			{
				editType: CellEditType.Replace,
				index: index,
				count: 1,
				cells: []
			}],
			synchronous,
			{ kind: SelectionStateType.Index, focus: this.getFocus(), selections: this.getSelections() },
			() => ({ kind: SelectionStateType.Handle, primary: endPrimarySelection, selections: endSelections }),
			undefined,
			pushUndoStop
		);
	}

	/**
	 *
	 * @param index
	 * @param length
	 * @param newIdx in an index scheme for the state of the tree after the current cell has been "removed"
	 * @param synchronous
	 * @param pushedToUndoStack
	 */
	moveCellToIdx(index: number, length: number, newIdx: number, synchronous: boolean, pushedToUndoStack: boolean = true): boolean {
		const viewCell = this.viewCells[index] as CellViewModel;
		if (!viewCell) {
			return false;
		}

		this._notebook.applyEdits([
			{
				editType: CellEditType.Move,
				index,
				length,
				newIdx
			}
		], synchronous, { kind: SelectionStateType.Index, focus: this.getFocus(), selections: this.getSelections() }, () => ({ kind: SelectionStateType.Index, focus: { start: newIdx, end: newIdx + 1 }, selections: [{ start: newIdx, end: newIdx + 1 }] }), undefined);
		return true;
	}

	private _pushIfAbsent(positions: IPosition[], p: IPosition) {
		const last = positions.length > 0 ? positions[positions.length - 1] : undefined;
		if (!last || last.lineNumber !== p.lineNumber || last.column !== p.column) {
			positions.push(p);
		}
	}

	/**
	 * Add split point at the beginning and the end;
	 * Move end of line split points to the beginning of the next line;
	 * Avoid duplicate split points
	 */
	private _splitPointsToBoundaries(splitPoints: IPosition[], textBuffer: IReadonlyTextBuffer): IPosition[] | null {
		const boundaries: IPosition[] = [];
		const lineCnt = textBuffer.getLineCount();
		const getLineLen = (lineNumber: number) => {
			return textBuffer.getLineLength(lineNumber);
		};

		// split points need to be sorted
		splitPoints = splitPoints.sort((l, r) => {
			const lineDiff = l.lineNumber - r.lineNumber;
			const columnDiff = l.column - r.column;
			return lineDiff !== 0 ? lineDiff : columnDiff;
		});

		for (let sp of splitPoints) {
			if (getLineLen(sp.lineNumber) + 1 === sp.column && sp.column !== 1 /** empty line */ && sp.lineNumber < lineCnt) {
				sp = new Position(sp.lineNumber + 1, 1);
			}
			this._pushIfAbsent(boundaries, sp);
		}

		if (boundaries.length === 0) {
			return null;
		}

		// boundaries already sorted and not empty
		const modelStart = new Position(1, 1);
		const modelEnd = new Position(lineCnt, getLineLen(lineCnt) + 1);
		return [modelStart, ...boundaries, modelEnd];
	}

	computeCellLinesContents(cell: ICellViewModel, splitPoints: IPosition[]): string[] | null {
		const rangeBoundaries = this._splitPointsToBoundaries(splitPoints, cell.textBuffer);
		if (!rangeBoundaries) {
			return null;
		}
		const newLineModels: string[] = [];
		for (let i = 1; i < rangeBoundaries.length; i++) {
			const start = rangeBoundaries[i - 1];
			const end = rangeBoundaries[i];

			newLineModels.push(cell.textBuffer.getValueInRange(new Range(start.lineNumber, start.column, end.lineNumber, end.column), EndOfLinePreference.TextDefined));
		}

		return newLineModels;
	}

	async splitNotebookCell(index: number): Promise<CellViewModel[] | null> {
		const cell = this.viewCells[index] as CellViewModel;

		if (this._options.isReadOnly) {
			return null;
		}

		const splitPoints = cell.focusMode === CellFocusMode.Container ? [{ lineNumber: 1, column: 1 }] : cell.getSelectionsStartPosition();

		if (splitPoints && splitPoints.length > 0) {
			await cell.resolveTextModel();

			if (!cell.hasModel()) {
				return null;
			}

			const newLinesContents = this.computeCellLinesContents(cell, splitPoints);
			if (newLinesContents) {
				const language = cell.language;
				const kind = cell.cellKind;

				const textModel = await cell.resolveTextModel();
				await this._bulkEditService.apply(
					[
						new ResourceTextEdit(cell.uri, { range: textModel.getFullModelRange(), text: newLinesContents[0] }),
						new ResourceNotebookCellEdit(this._notebook.uri,
							{
								editType: CellEditType.Replace,
								index: index + 1,
								count: 0,
								cells: newLinesContents.slice(1).map(line => ({
									cellKind: kind,
									language,
									source: line,
									outputs: [],
									metadata: {}
								}))
							}
						)
					],
					{ quotableLabel: 'Split Notebook Cell' }
				);
			}
		}

		return null;
	}

	getEditorViewState(): INotebookEditorViewState {
		const editingCells: { [key: number]: boolean } = {};
		this._viewCells.forEach((cell, i) => {
			if (cell.getEditState() === CellEditState.Editing) {
				editingCells[i] = true;
			}
		});
		const editorViewStates: { [key: number]: editorCommon.ICodeEditorViewState } = {};
		this._viewCells.map(cell => ({ handle: cell.model.handle, state: cell.saveEditorViewState() })).forEach((viewState, i) => {
			if (viewState.state) {
				editorViewStates[i] = viewState.state;
			}
		});

		return {
			editingCells,
			editorViewStates,
		};
	}

	restoreEditorViewState(viewState: INotebookEditorViewState | undefined): void {
		if (!viewState) {
			return;
		}

		this._viewCells.forEach((cell, index) => {
			const isEditing = viewState.editingCells && viewState.editingCells[index];
			const editorViewState = viewState.editorViewStates && viewState.editorViewStates[index];

			cell.updateEditState(isEditing ? CellEditState.Editing : CellEditState.Preview, 'viewState');
			const cellHeight = viewState.cellTotalHeights ? viewState.cellTotalHeights[index] : undefined;
			cell.restoreEditorViewState(editorViewState, cellHeight);
		});
	}

	/**
	 * Editor decorations across cells. For example, find decorations for multiple code cells
	 * The reason that we can't completely delegate this to CodeEditorWidget is most of the time, the editors for cells are not created yet but we already have decorations for them.
	 */
	changeModelDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): T | null {
		const changeAccessor: IModelDecorationsChangeAccessor = {
			deltaDecorations: (oldDecorations: ICellModelDecorations[], newDecorations: ICellModelDeltaDecorations[]): ICellModelDecorations[] => {
				return this._deltaModelDecorationsImpl(oldDecorations, newDecorations);
			}
		};

		let result: T | null = null;
		try {
			result = callback(changeAccessor);
		} catch (e) {
			onUnexpectedError(e);
		}

		changeAccessor.deltaDecorations = invalidFunc;

		return result;
	}

	private _deltaModelDecorationsImpl(oldDecorations: ICellModelDecorations[], newDecorations: ICellModelDeltaDecorations[]): ICellModelDecorations[] {

		const mapping = new Map<number, { cell: CellViewModel; oldDecorations: string[]; newDecorations: IModelDeltaDecoration[] }>();
		oldDecorations.forEach(oldDecoration => {
			const ownerId = oldDecoration.ownerId;

			if (!mapping.has(ownerId)) {
				const cell = this._viewCells.find(cell => cell.handle === ownerId);
				if (cell) {
					mapping.set(ownerId, { cell: cell, oldDecorations: [], newDecorations: [] });
				}
			}

			const data = mapping.get(ownerId)!;
			if (data) {
				data.oldDecorations = oldDecoration.decorations;
			}
		});

		newDecorations.forEach(newDecoration => {
			const ownerId = newDecoration.ownerId;

			if (!mapping.has(ownerId)) {
				const cell = this._viewCells.find(cell => cell.handle === ownerId);

				if (cell) {
					mapping.set(ownerId, { cell: cell, oldDecorations: [], newDecorations: [] });
				}
			}

			const data = mapping.get(ownerId)!;
			if (data) {
				data.newDecorations = newDecoration.decorations;
			}
		});

		const ret: ICellModelDecorations[] = [];
		mapping.forEach((value, ownerId) => {
			const cellRet = value.cell.deltaModelDecorations(value.oldDecorations, value.newDecorations);
			ret.push({
				ownerId: ownerId,
				decorations: cellRet
			});
		});

		return ret;
	}


	/**
	 * Search in notebook text model
	 * @param value
	 */
	find(value: string, options: INotebookSearchOptions): CellFindMatchWithIndex[] {
		const matches: CellFindMatchWithIndex[] = [];
		this._viewCells.forEach((cell, index) => {
			const cellMatches = cell.startFind(value, options);
			if (cellMatches) {
				matches.push({
					cell: cellMatches.cell,
					index: index,
					matches: cellMatches.matches
				});
			}
		});

		return matches;
	}

	replaceOne(cell: ICellViewModel, range: Range, text: string): Promise<void> {
		const viewCell = cell as CellViewModel;
		this._lastNotebookEditResource.push(viewCell.uri);
		return viewCell.resolveTextModel().then(() => {
			this._bulkEditService.apply(
				[new ResourceTextEdit(cell.uri, { range, text })],
				{ quotableLabel: 'Notebook Replace' }
			);
		});
	}

	async replaceAll(matches: CellFindMatch[], text: string): Promise<void> {
		if (!matches.length) {
			return;
		}

		const textEdits: WorkspaceTextEdit[] = [];
		this._lastNotebookEditResource.push(matches[0].cell.uri);

		matches.forEach(match => {
			match.matches.forEach(singleMatch => {
				textEdits.push({
					edit: { range: singleMatch.range, text: text },
					resource: match.cell.uri
				});
			});
		});

		return Promise.all(matches.map(match => {
			return match.cell.resolveTextModel();
		})).then(async () => {
			this._bulkEditService.apply(ResourceEdit.convert({ edits: textEdits }), { quotableLabel: 'Notebook Replace All' });
			return;
		});
	}

	async withElement(element: SingleModelEditStackElement | MultiModelEditStackElement, callback: () => Promise<void>) {
		const viewCells = this._viewCells.filter(cell => element.matchesResource(cell.uri));
		const refs = await Promise.all(viewCells.map(cell => this._textModelService.createModelReference(cell.uri)));
		await callback();
		refs.forEach(ref => ref.dispose());
	}

	async undo() {
		if (this._options.isReadOnly) {
			return null;
		}

		const editStack = this._undoService.getElements(this.uri);
		const element = editStack.past.length ? editStack.past[editStack.past.length - 1] : undefined;

		if (element && element instanceof SingleModelEditStackElement || element instanceof MultiModelEditStackElement) {
			await this.withElement(element, async () => {
				await this._undoService.undo(this.uri);
			});

			return (element instanceof SingleModelEditStackElement) ? [element.resource] : element.resources;
		}

		await this._undoService.undo(this.uri);
		return [];
	}

	async redo() {
		if (this._options.isReadOnly) {
			return null;
		}

		const editStack = this._undoService.getElements(this.uri);
		const element = editStack.future[0];

		if (element && element instanceof SingleModelEditStackElement || element instanceof MultiModelEditStackElement) {
			await this.withElement(element, async () => {
				await this._undoService.redo(this.uri);
			});

			return (element instanceof SingleModelEditStackElement) ? [element.resource] : element.resources;
		}

		await this._undoService.redo(this.uri);

		return [];
	}

	equal(notebook: NotebookTextModel) {
		return this._notebook === notebook;
	}

	override dispose() {
		this._localStore.clear();
		this._viewCells.forEach(cell => {
			cell.dispose();
		});

		super.dispose();
	}
}

export type CellViewModel = CodeCellViewModel | MarkdownCellViewModel;

export function createCellViewModel(instantiationService: IInstantiationService, notebookViewModel: NotebookViewModel, cell: NotebookCellTextModel) {
	if (cell.cellKind === CellKind.Code) {
		return instantiationService.createInstance(CodeCellViewModel, notebookViewModel.viewType, cell, notebookViewModel.layoutInfo, notebookViewModel.eventDispatcher);
	} else {
		const mdRenderer = instantiationService.createInstance(MarkdownRenderer, { baseUrl: dirname(notebookViewModel.uri) });
		return instantiationService.createInstance(MarkdownCellViewModel, notebookViewModel.viewType, cell, notebookViewModel.layoutInfo, notebookViewModel, notebookViewModel.eventDispatcher, mdRenderer);
	}
}
