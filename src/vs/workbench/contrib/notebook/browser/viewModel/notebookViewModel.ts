/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import * as strings from 'vs/base/common/strings';
import { URI } from 'vs/base/common/uri';
import { IBulkEditService } from 'vs/editor/browser/services/bulkEditService';
import { Range } from 'vs/editor/common/core/range';
import * as editorCommon from 'vs/editor/common/editorCommon';
import { IModelDecorationOptions, IModelDeltaDecoration, TrackedRangeStickiness } from 'vs/editor/common/model';
import { IntervalNode, IntervalTree } from 'vs/editor/common/model/intervalTree';
import { ModelDecorationOptions } from 'vs/editor/common/model/textModel';
import { WorkspaceTextEdit } from 'vs/editor/common/modes';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IUndoRedoService } from 'vs/platform/undoRedo/common/undoRedo';
import { CellEditState, CellFindMatch, ICellRange, ICellViewModel, NotebookLayoutInfo } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { DeleteCellEdit, InsertCellEdit, MoveCellEdit, SpliceCellsEdit } from 'vs/workbench/contrib/notebook/browser/viewModel/cellEdit';
import { CodeCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/codeCellViewModel';
import { NotebookEventDispatcher, NotebookMetadataChangedEvent } from 'vs/workbench/contrib/notebook/browser/viewModel/eventDispatcher';
import { CellFoldingState, EditorFoldingStateDelegate } from 'vs/workbench/contrib/notebook/browser/contrib/fold/foldingModel';
import { MarkdownCellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/markdownCellViewModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { CellKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { FoldingRegions } from 'vs/editor/contrib/folding/foldingRanges';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';

export interface INotebookEditorViewState {
	editingCells: { [key: number]: boolean };
	editorViewStates: { [key: number]: editorCommon.ICodeEditorViewState | null };
	hiddenFoldingRanges?: ICellRange[];
	cellTotalHeights?: { [key: number]: number };
	scrollPosition?: { left: number; top: number; };
	focus?: number;
	editorFocused?: boolean;
	contributionsState?: { [id: string]: any };
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

function selectionsEqual(a: number[], b: number[]) {
	if (a.length !== b.length) {
		return false;
	}

	for (let i = 0; i < a.length; i++) {
		if (a[i] !== b[i]) {
			return false;
		}
	}

	return true;
}

let MODEL_ID = 0;


export class NotebookViewModel extends Disposable implements EditorFoldingStateDelegate {
	private _localStore: DisposableStore = this._register(new DisposableStore());
	private _viewCells: CellViewModel[] = [];
	private _handleToViewCellMapping = new Map<number, CellViewModel>();

	private _currentTokenSource: CancellationTokenSource | undefined;

	get currentTokenSource(): CancellationTokenSource | undefined {
		return this._currentTokenSource;
	}

	set currentTokenSource(v: CancellationTokenSource | undefined) {
		this._currentTokenSource = v;
	}

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

	get renderers() {
		return this._notebook!.renderers;
	}

	get handle() {
		return this._notebook.handle;
	}

	get languages() {
		return this._notebook.languages;
	}

	get uri() {
		return this._notebook.uri;
	}

	get metadata() {
		return this._notebook.metadata;
	}

	private readonly _onDidChangeViewCells = new Emitter<INotebookViewCellsUpdateEvent>();
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

	private readonly _onDidChangeSelection = new Emitter<void>();
	get onDidChangeSelection(): Event<void> { return this._onDidChangeSelection.event; }

	private _selections: number[] = [];

	get selectionHandles() {
		return this._selections;
	}

	set selectionHandles(selections: number[]) {
		selections = selections.sort();
		if (selectionsEqual(selections, this.selectionHandles)) {
			return;
		}

		this._selections = selections;
		this._notebook.selections = selections;
		this._onDidChangeSelection.fire();
	}

	private _decorationsTree = new DecorationsTree();
	private _decorations: { [decorationId: string]: IntervalNode; } = Object.create(null);
	private _lastDecorationId: number = 0;
	private readonly _instanceId: string;
	public readonly id: string;
	private _foldingRanges: FoldingRegions | null = null;
	private _hiddenRanges: ICellRange[] = [];

	constructor(
		public viewType: string,
		private _notebook: NotebookTextModel,
		readonly eventDispatcher: NotebookEventDispatcher,
		private _layoutInfo: NotebookLayoutInfo | null,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IBulkEditService private readonly bulkEditService: IBulkEditService,
		@IUndoRedoService private readonly undoService: IUndoRedoService
	) {
		super();

		MODEL_ID++;
		this.id = '$notebookViewModel' + MODEL_ID;
		this._instanceId = strings.singleLetterHash(MODEL_ID);

		this._register(this._notebook.onDidChangeCells(e => {
			const diffs = e.map(splice => {
				return [splice[0], splice[1], splice[2].map(cell => {
					return createCellViewModel(this.instantiationService, this, cell as NotebookCellTextModel);
				})] as [number, number, CellViewModel[]];
			});

			const undoDiff = diffs.map(diff => {
				const deletedCells = this.viewCells.slice(diff[0], diff[0] + diff[1]);

				return [diff[0], deletedCells, diff[2]] as [number, CellViewModel[], CellViewModel[]];
			});

			diffs.reverse().forEach(diff => {
				const deletedCells = this._viewCells.splice(diff[0], diff[1], ...diff[2]);

				deletedCells.forEach(cell => {
					this._handleToViewCellMapping.delete(cell.handle);
				});

				diff[2].forEach(cell => {
					this._handleToViewCellMapping.set(cell.handle, cell);
					this._localStore.add(cell);
				});
			});

			this._onDidChangeViewCells.fire({
				synchronous: true,
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

					if (diff[0] + diff[1] > primaryHandle) {
						endSelectionHandles = [this._viewCells[diff[0] + delta].handle];
						break;
					}
				}
			}

			this.undoService.pushElement(new SpliceCellsEdit(this.uri, undoDiff, {
				insertCell: this._insertCellDelegate.bind(this),
				deleteCell: this._deleteCellDelegate.bind(this),
				setSelections: this._setSelectionsDelegate.bind(this)
			}, this.selectionHandles, endSelectionHandles));

			this.selectionHandles = endSelectionHandles;
		}));

		this._register(this._notebook.onDidChangeMetadata(e => {
			this.eventDispatcher.emit([new NotebookMetadataChangedEvent(e)]);
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

		this._viewCells = this._notebook!.cells.map(cell => {
			return createCellViewModel(this.instantiationService, this, cell);
		});

		this._viewCells.forEach(cell => {
			this._handleToViewCellMapping.set(cell.handle, cell);
		});
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
		let newHiddenAreas: ICellRange[] = [];

		let i = 0; // index into hidden
		let k = 0;

		let lastCollapsedStart = Number.MAX_VALUE;
		let lastCollapsedEnd = -1;

		for (; i < ranges.length; i++) {
			if (!ranges.isCollapsed(i)) {
				continue;
			}

			let startLineNumber = ranges.getStartLineNumber(i) + 1; // the first line is not hidden
			let endLineNumber = ranges.getEndLineNumber(i);
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

	hide() {
		this._viewCells.forEach(cell => {
			if (cell.getText() !== '') {
				cell.editState = CellEditState.Preview;
			}
		});
	}

	getCellByHandle(handle: number) {
		return this._handleToViewCellMapping.get(handle);
	}

	getCellIndex(cell: ICellViewModel) {
		return this._viewCells.indexOf(cell as CellViewModel);
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

		let result = new Array<string>(newDecorationsLen);
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

	private _insertCellDelegate(insertIndex: number, insertCell: CellViewModel) {
		this._viewCells!.splice(insertIndex, 0, insertCell);
		this._handleToViewCellMapping.set(insertCell.handle, insertCell);
		this._notebook.insertNewCell(insertIndex, [insertCell.model as NotebookCellTextModel]);
		this._localStore.add(insertCell);
		this._onDidChangeViewCells.fire({ synchronous: true, splices: [[insertIndex, 0, [insertCell]]] });
	}

	private _deleteCellDelegate(deleteIndex: number) {
		const deleteCell = this._viewCells[deleteIndex];
		this._viewCells.splice(deleteIndex, 1);
		this._handleToViewCellMapping.delete(deleteCell.handle);

		this._notebook.removeCell(deleteIndex, 1);
		this._onDidChangeViewCells.fire({ synchronous: true, splices: [[deleteIndex, 1, []]] });
	}

	private _setSelectionsDelegate(selections: number[]) {
		this.selectionHandles = selections;
	}

	createCell(index: number, source: string | string[], language: string, type: CellKind, synchronous: boolean) {
		const cell = this._notebook.createCellTextModel(source, language, type, [], undefined);
		let newCell: CellViewModel = createCellViewModel(this.instantiationService, this, cell);
		this._viewCells!.splice(index, 0, newCell);
		this._handleToViewCellMapping.set(newCell.handle, newCell);
		this._notebook.insertNewCell(index, [cell]);
		this._localStore.add(newCell);

		this.undoService.pushElement(new InsertCellEdit(this.uri, index, newCell, {
			insertCell: this._insertCellDelegate.bind(this),
			deleteCell: this._deleteCellDelegate.bind(this),
			setSelections: this._setSelectionsDelegate.bind(this)
		}, this.selectionHandles, this.selectionHandles));

		this._decorationsTree.acceptReplace(index, 0, 1, true);
		this._onDidChangeViewCells.fire({ synchronous: synchronous, splices: [[index, 0, [newCell]]] });
		return newCell;
	}

	insertCell(index: number, cell: NotebookCellTextModel, synchronous: boolean): CellViewModel {
		let newCell: CellViewModel = createCellViewModel(this.instantiationService, this, cell);
		this._viewCells!.splice(index, 0, newCell);
		this._handleToViewCellMapping.set(newCell.handle, newCell);

		this._notebook.insertNewCell(index, [newCell.model]);
		this._localStore.add(newCell);
		this.undoService.pushElement(new InsertCellEdit(this.uri, index, newCell, {
			insertCell: this._insertCellDelegate.bind(this),
			deleteCell: this._deleteCellDelegate.bind(this),
			setSelections: this._setSelectionsDelegate.bind(this)
		}, this.selectionHandles, this.selectionHandles));

		this._decorationsTree.acceptReplace(index, 0, 1, true);
		this._onDidChangeViewCells.fire({ synchronous: synchronous, splices: [[index, 0, [newCell]]] });
		return newCell;
	}

	deleteCell(index: number, synchronous: boolean) {
		const primarySelectionIndex = this.selectionHandles.length ? this._viewCells.indexOf(this.getCellByHandle(this.selectionHandles[0])!) : null;

		let viewCell = this._viewCells[index];
		this._viewCells.splice(index, 1);
		this._handleToViewCellMapping.delete(viewCell.handle);

		this._notebook.removeCell(index, 1);

		let endSelections: number[] = [];
		if (this.selectionHandles.length) {
			const primarySelectionHandle = this.selectionHandles[0];

			if (index === primarySelectionIndex) {
				if (primarySelectionIndex < this.length - 1) {
					endSelections = [this._viewCells[primarySelectionIndex + 1].handle];
				} else if (primarySelectionIndex === this.length - 1 && this.length > 1) {
					endSelections = [this._viewCells[primarySelectionIndex - 1].handle];
				} else {
					endSelections = [];
				}
			} else {
				endSelections = [primarySelectionHandle];
			}
		}

		this.undoService.pushElement(new DeleteCellEdit(this.uri, index, viewCell, {
			insertCell: this._insertCellDelegate.bind(this),
			deleteCell: this._deleteCellDelegate.bind(this),
			createCellViewModel: (cell: NotebookCellTextModel) => {
				return createCellViewModel(this.instantiationService, this, cell);
			},
			setSelections: this._setSelectionsDelegate.bind(this)
		}, this.selectionHandles, endSelections));

		this.selectionHandles = endSelections;

		this._decorationsTree.acceptReplace(index, 1, 0, true);

		this._onDidChangeViewCells.fire({ synchronous: synchronous, splices: [[index, 1, []]] });
		viewCell.dispose();
	}

	moveCellToIdx(index: number, newIdx: number, synchronous: boolean, pushedToUndoStack: boolean = true): boolean {
		const viewCell = this.viewCells[index] as CellViewModel;
		if (!viewCell) {
			return false;
		}

		this.viewCells.splice(index, 1);
		this.viewCells!.splice(newIdx, 0, viewCell);
		this._notebook.moveCellToIdx(index, newIdx);

		if (pushedToUndoStack) {
			this.undoService.pushElement(new MoveCellEdit(this.uri, index, newIdx, {
				moveCell: (fromIndex: number, toIndex: number) => {
					this.moveCellToIdx(fromIndex, toIndex, true, false);
				},
				setSelections: this._setSelectionsDelegate.bind(this)
			}, this.selectionHandles, this.selectionHandles));
		}

		this.selectionHandles = this.selectionHandles;

		this._onDidChangeViewCells.fire({ synchronous: synchronous, splices: [[index, 1, []]] });
		this._onDidChangeViewCells.fire({ synchronous: synchronous, splices: [[newIdx, 0, [viewCell]]] });

		return true;
	}

	geteEditorViewState(): INotebookEditorViewState {
		const editingCells: { [key: number]: boolean } = {};
		this._viewCells.filter(cell => cell.editState === CellEditState.Editing).forEach(cell => editingCells[cell.model.handle] = true);
		const editorViewStates: { [key: number]: editorCommon.ICodeEditorViewState } = {};
		this._viewCells.map(cell => ({ handle: cell.model.handle, state: cell.saveEditorViewState() })).forEach(viewState => {
			if (viewState.state) {
				editorViewStates[viewState.handle] = viewState.state;
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
			const isEditing = viewState.editingCells && viewState.editingCells[cell.handle];
			const editorViewState = viewState.editorViewStates && viewState.editorViewStates[cell.handle];

			cell.editState = isEditing ? CellEditState.Editing : CellEditState.Preview;
			const cellHeight = viewState.cellTotalHeights ? viewState.cellTotalHeights[index] : undefined;
			cell.restoreEditorViewState(editorViewState, cellHeight);
		});
	}

	/**
	 * Editor decorations across cells. For example, find decorations for multiple code cells
	 * The reason that we can't completely delegate this to CodeEditorWidget is most of the time, the editors for cells are not created yet but we already have decorations for them.
	 */
	changeDecorations<T>(callback: (changeAccessor: IModelDecorationsChangeAccessor) => T): T | null {
		const changeAccessor: IModelDecorationsChangeAccessor = {
			deltaDecorations: (oldDecorations: ICellModelDecorations[], newDecorations: ICellModelDeltaDecorations[]): ICellModelDecorations[] => {
				return this.deltaDecorationsImpl(oldDecorations, newDecorations);
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

	deltaDecorationsImpl(oldDecorations: ICellModelDecorations[], newDecorations: ICellModelDeltaDecorations[]): ICellModelDecorations[] {

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
			const cellRet = value.cell.deltaDecorations(value.oldDecorations, value.newDecorations);
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
	find(value: string): CellFindMatch[] {
		const matches: CellFindMatch[] = [];
		this._viewCells.forEach(cell => {
			const cellMatches = cell.startFind(value);
			if (cellMatches) {
				matches.push(cellMatches);
			}
		});

		return matches;
	}

	replaceOne(cell: ICellViewModel, range: Range, text: string): Promise<void> {
		const viewCell = cell as CellViewModel;
		this._lastNotebookEditResource.push(viewCell.uri);
		return viewCell.resolveTextModel().then(() => {
			this.bulkEditService.apply({ edits: [{ edit: { range: range, text: text }, resource: cell.uri }] }, { quotableLabel: 'Notebook Replace' });
		});
	}

	async replaceAll(matches: CellFindMatch[], text: string): Promise<void> {
		if (!matches.length) {
			return;
		}

		let textEdits: WorkspaceTextEdit[] = [];
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
			this.bulkEditService.apply({ edits: textEdits }, { quotableLabel: 'Notebook Replace All' });
			return;
		});
	}

	canUndo(): boolean {
		return this.undoService.canUndo(this.uri);
	}

	undo() {
		this.undoService.undo(this.uri);
	}

	redo() {
		this.undoService.redo(this.uri);
	}

	equal(notebook: NotebookTextModel) {
		return this._notebook === notebook;
	}

	dispose() {
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
		return instantiationService.createInstance(CodeCellViewModel, notebookViewModel.viewType, notebookViewModel.handle, cell, notebookViewModel.layoutInfo, notebookViewModel.eventDispatcher);
	} else {
		return instantiationService.createInstance(MarkdownCellViewModel, notebookViewModel.viewType, notebookViewModel.handle, cell, notebookViewModel.layoutInfo, notebookViewModel, notebookViewModel.eventDispatcher);
	}
}
