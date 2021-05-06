/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { flatten } from 'vs/base/common/arrays';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { INotebookTextModel, NotebookCellOutputsSplice, NotebookDocumentMetadata, NotebookCellMetadata, ICellEditOperation, CellEditType, CellUri, notebookDocumentMetadataDefaults, diff, NotebookCellsChangeType, ICellDto2, TransientOptions, NotebookTextModelChangedEvent, NotebookRawContentEvent, IOutputDto, ICellOutput, IOutputItemDto, ISelectionState, NullablePartialNotebookCellMetadata } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IUndoRedoService, UndoRedoElementType, IUndoRedoElement, IResourceUndoRedoElement, UndoRedoGroup, IWorkspaceUndoRedoElement } from 'vs/platform/undoRedo/common/undoRedo';
import { MoveCellEdit, SpliceCellsEdit, CellMetadataEdit } from 'vs/workbench/contrib/notebook/common/model/cellEdit';
import { ISequence, LcsDiff } from 'vs/base/common/diff/diff';
import { hash } from 'vs/base/common/hash';
import { NotebookCellOutputTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellOutputTextModel';
import { IModelService } from 'vs/editor/common/services/modelService';
import { Schemas } from 'vs/base/common/network';
import { isEqual } from 'vs/base/common/resources';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ITextBuffer, ITextModel } from 'vs/editor/common/model';
import { TextModel } from 'vs/editor/common/model/textModel';


class StackOperation implements IWorkspaceUndoRedoElement {
	type: UndoRedoElementType.Workspace;

	private _operations: IUndoRedoElement[] = [];
	private _beginSelectionState: ISelectionState | undefined = undefined;
	private _resultSelectionState: ISelectionState | undefined = undefined;
	private _beginAlternativeVersionId: string;
	private _resultAlternativeVersionId: string;

	constructor(
		readonly resource: URI,
		readonly label: string,
		readonly undoRedoGroup: UndoRedoGroup | undefined,
		private _delayedEmitter: DelayedEmitter,
		private _postUndoRedo: (alternativeVersionId: string) => void,
		selectionState: ISelectionState | undefined,
		beginAlternativeVersionId: string
	) {
		this.type = UndoRedoElementType.Workspace;
		this._beginSelectionState = selectionState;
		this._beginAlternativeVersionId = beginAlternativeVersionId;
		this._resultAlternativeVersionId = beginAlternativeVersionId;
	}
	get resources(): readonly URI[] {
		return [this.resource];
	}

	get isEmpty(): boolean {
		return this._operations.length === 0;
	}

	pushEndState(alternativeVersionId: string, selectionState: ISelectionState | undefined) {
		this._resultAlternativeVersionId = alternativeVersionId;
		this._resultSelectionState = selectionState;
	}

	pushEditOperation(element: IUndoRedoElement, beginSelectionState: ISelectionState | undefined, resultSelectionState: ISelectionState | undefined) {
		if (this._operations.length === 0) {
			this._beginSelectionState = this._beginSelectionState ?? beginSelectionState;
		}
		this._operations.push(element);
		this._resultSelectionState = resultSelectionState;
	}

	async undo(): Promise<void> {
		this._delayedEmitter.beginDeferredEmit();
		for (let i = this._operations.length - 1; i >= 0; i--) {
			await this._operations[i].undo();
		}
		this._postUndoRedo(this._beginAlternativeVersionId);
		this._delayedEmitter.endDeferredEmit(this._beginSelectionState);
	}

	async redo(): Promise<void> {
		this._delayedEmitter.beginDeferredEmit();
		for (let i = 0; i < this._operations.length; i++) {
			await this._operations[i].redo();
		}
		this._postUndoRedo(this._resultAlternativeVersionId);
		this._delayedEmitter.endDeferredEmit(this._resultSelectionState);
	}
}

export class NotebookOperationManager {
	private _pendingStackOperation: StackOperation | null = null;
	constructor(
		private _undoService: IUndoRedoService,
		private _resource: URI,
		private _delayedEmitter: DelayedEmitter,
		private _postUndoRedo: (alternativeVersionId: string) => void
	) {
	}

	isUndoStackEmpty(): boolean {
		return this._pendingStackOperation === null || this._pendingStackOperation.isEmpty;
	}

	pushStackElement(label: string, selectionState: ISelectionState | undefined, undoRedoGroup: UndoRedoGroup | undefined, alternativeVersionId: string) {
		if (this._pendingStackOperation) {
			this._pendingStackOperation.pushEndState(alternativeVersionId, selectionState);
			if (!this._pendingStackOperation.isEmpty) {
				this._undoService.pushElement(this._pendingStackOperation, this._pendingStackOperation.undoRedoGroup);
			}
			this._pendingStackOperation = null;
			return;
		}

		this._pendingStackOperation = new StackOperation(this._resource, label, undoRedoGroup, this._delayedEmitter, this._postUndoRedo, selectionState, alternativeVersionId);
	}

	pushEditOperation(element: IUndoRedoElement, beginSelectionState: ISelectionState | undefined, resultSelectionState: ISelectionState | undefined) {
		if (this._pendingStackOperation) {
			this._pendingStackOperation.pushEditOperation(element, beginSelectionState, resultSelectionState);
			return;
		}

		this._undoService.pushElement(element);
	}
}

class DelayedEmitter {
	private _deferredCnt: number = 0;
	private _notebookTextModelChangedEvent: NotebookTextModelChangedEvent | null = null;
	constructor(
		private readonly _onDidChangeContent: Emitter<NotebookTextModelChangedEvent>,
		private readonly _textModel: NotebookTextModel

	) {

	}

	beginDeferredEmit(): void {
		this._deferredCnt++;
	}

	endDeferredEmit(endSelections: ISelectionState | undefined): void {
		this._deferredCnt--;
		if (this._deferredCnt === 0) {
			if (this._notebookTextModelChangedEvent) {
				this._onDidChangeContent.fire(
					{
						rawEvents: this._notebookTextModelChangedEvent.rawEvents,
						versionId: this._textModel.versionId,
						endSelectionState: endSelections,
						synchronous: this._notebookTextModelChangedEvent.synchronous
					}
				);
			}

			this._notebookTextModelChangedEvent = null;
		}
	}


	emit(data: NotebookRawContentEvent, synchronous: boolean, endSelections?: ISelectionState) {
		if (this._deferredCnt === 0) {
			this._onDidChangeContent.fire(
				{
					rawEvents: [data],
					versionId: this._textModel.versionId,
					synchronous,
					endSelectionState: endSelections
				}
			);
		} else {
			if (!this._notebookTextModelChangedEvent) {
				this._notebookTextModelChangedEvent = {
					rawEvents: [data],
					versionId: this._textModel.versionId,
					endSelectionState: endSelections,
					synchronous: synchronous
				};
			} else {
				// merge
				this._notebookTextModelChangedEvent = {
					rawEvents: [...this._notebookTextModelChangedEvent.rawEvents, data],
					versionId: this._textModel.versionId,
					endSelectionState: endSelections !== undefined ? endSelections : this._notebookTextModelChangedEvent.endSelectionState,
					synchronous: synchronous
				};
			}
		}
	}
}

export class NotebookTextModel extends Disposable implements INotebookTextModel {

	private readonly _onWillDispose: Emitter<void> = this._register(new Emitter<void>());
	private readonly _onDidChangeContent = this._register(new Emitter<NotebookTextModelChangedEvent>());
	readonly onWillDispose: Event<void> = this._onWillDispose.event;
	readonly onDidChangeContent = this._onDidChangeContent.event;
	private _cellhandlePool: number = 0;
	private _cellListeners: Map<number, IDisposable> = new Map();
	private _cells: NotebookCellTextModel[] = [];

	metadata: NotebookDocumentMetadata = notebookDocumentMetadataDefaults;
	transientOptions: TransientOptions = { transientCellMetadata: {}, transientDocumentMetadata: {}, transientOutputs: false };
	private _versionId = 0;

	/**
	 * This alternative id is only for non-cell-content changes.
	 */
	private _notebookSpecificAlternativeId = 0;

	/**
	 * Unlike, versionId, this can go down (via undo) or go to previous values (via redo)
	 */
	private _alternativeVersionId: string = '1';
	private _operationManager: NotebookOperationManager;
	private _eventEmitter: DelayedEmitter;

	get length() {
		return this._cells.length;
	}

	get cells(): readonly NotebookCellTextModel[] {
		return this._cells;
	}

	get versionId() {
		return this._versionId;
	}

	get alternativeVersionId(): string {
		return this._alternativeVersionId;
	}

	constructor(
		readonly viewType: string,
		readonly uri: URI,
		cells: ICellDto2[],
		metadata: NotebookDocumentMetadata,
		options: TransientOptions,
		@IUndoRedoService private readonly _undoService: IUndoRedoService,
		@IModelService private readonly _modelService: IModelService,
		@IModeService private readonly _modeService: IModeService,
	) {
		super();
		this.transientOptions = options;
		this.metadata = metadata;
		this._initialize(cells);

		const maybeUpdateCellTextModel = (textModel: ITextModel) => {
			if (textModel.uri.scheme === Schemas.vscodeNotebookCell && textModel instanceof TextModel) {
				const cellUri = CellUri.parse(textModel.uri);
				if (cellUri && isEqual(cellUri.notebook, this.uri)) {
					const cellIdx = this._getCellIndexByHandle(cellUri.handle);
					if (cellIdx >= 0) {
						const cell = this.cells[cellIdx];
						if (cell) {
							cell.textModel = textModel;
						}
					}
				}
			}
		};
		this._register(_modelService.onModelAdded(e => maybeUpdateCellTextModel(e)));

		this._eventEmitter = new DelayedEmitter(
			this._onDidChangeContent,
			this
		);

		this._operationManager = new NotebookOperationManager(
			this._undoService,
			uri,
			this._eventEmitter,
			(alternativeVersionId: string) => {
				this._increaseVersionId(true);
				this._overwriteAlternativeVersionId(alternativeVersionId);
			}
		);
	}

	private _initialize(cells: ICellDto2[]) {
		this._cells = [];
		this._versionId = 0;
		this._notebookSpecificAlternativeId = 0;

		const mainCells = cells.map(cell => {
			const cellHandle = this._cellhandlePool++;
			const cellUri = CellUri.generate(this.uri, cellHandle);
			return new NotebookCellTextModel(cellUri, cellHandle, cell.source, cell.language, cell.cellKind, cell.outputs || [], cell.metadata, this.transientOptions, this._modeService);
		});

		for (let i = 0; i < mainCells.length; i++) {
			const dirtyStateListener = mainCells[i].onDidChangeContent((e) => {
				this._bindCellContentHandler(mainCells[i], e);
			});

			this._cellListeners.set(mainCells[i].handle, dirtyStateListener);
		}

		this._cells.splice(0, 0, ...mainCells);
		this._alternativeVersionId = this._generateAlternativeId();
	}

	private _bindCellContentHandler(cell: NotebookCellTextModel, e: 'content' | 'language') {
		this._increaseVersionId(e === 'content');
		if (e === 'content') {
			this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeCellContent, transient: false }, true);
		} else {
			this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeLanguage, index: this._getCellIndexByHandle(cell.handle), language: cell.language, transient: false }, true);
		}
	}

	private _generateAlternativeId() {
		return `${this._notebookSpecificAlternativeId}_` + this.cells.map(cell => cell.handle + ',' + cell.alternativeId).join(';');
	}

	override dispose() {
		this._onWillDispose.fire();
		dispose(this._cellListeners.values());
		dispose(this._cells);
		super.dispose();
	}

	pushStackElement(label: string, selectionState: ISelectionState | undefined, undoRedoGroup: UndoRedoGroup | undefined) {
		this._operationManager.pushStackElement(label, selectionState, undoRedoGroup, this.alternativeVersionId);
	}

	private _getCellIndexByHandle(handle: number) {
		return this.cells.findIndex(c => c.handle === handle);
	}

	private _getCellIndexWithOutputIdHandle(outputId: string) {
		return this.cells.findIndex(c => !!c.outputs.find(o => o.outputId === outputId));
	}

	reset(cells: ICellDto2[], metadata: NotebookDocumentMetadata, transientOptions: TransientOptions): void {
		this.transientOptions = transientOptions;
		this._cellhandlePool = 0;
		this.applyEdits(
			[
				{ editType: CellEditType.Replace, index: 0, count: this.cells.length, cells },
				{ editType: CellEditType.DocumentMetadata, metadata }
			],
			true,
			undefined, () => undefined,
			undefined
		);
	}

	applyEdits(rawEdits: ICellEditOperation[], synchronous: boolean, beginSelectionState: ISelectionState | undefined, endSelectionsComputer: () => ISelectionState | undefined, undoRedoGroup: UndoRedoGroup | undefined, computeUndoRedo: boolean = true): boolean {

		this._eventEmitter.beginDeferredEmit();
		this.pushStackElement('edit', beginSelectionState, undoRedoGroup);

		try {
			this._doApplyEdits(rawEdits, synchronous, computeUndoRedo);
			return true;
		} finally {
			// Update selection and versionId after applying edits.
			const endSelections = endSelectionsComputer();
			this._increaseVersionId(this._operationManager.isUndoStackEmpty());

			// Finalize undo element
			this.pushStackElement('edit', endSelections, undefined);

			// Broadcast changes
			this._eventEmitter.endDeferredEmit(endSelections);
		}
	}

	private _doApplyEdits(rawEdits: ICellEditOperation[], synchronous: boolean, computeUndoRedo: boolean = true): void {
		type TransformedEdit = {
			edit: ICellEditOperation;
			cellIndex: number;
			end: number | undefined;
			originalIndex: number;
		};

		// compress all edits which have no side effects on cell index
		const edits = rawEdits.map((edit, index) => {
			let cellIndex: number = -1;
			if ('index' in edit) {
				cellIndex = edit.index;
			} else if ('handle' in edit) {
				cellIndex = this._getCellIndexByHandle(edit.handle);
				this._assertIndex(cellIndex);
			} else if ('outputId' in edit) {
				cellIndex = this._getCellIndexWithOutputIdHandle(edit.outputId);
				this._assertIndex(cellIndex);
			} else if (edit.editType !== CellEditType.DocumentMetadata) {
				throw new Error('Invalid cell edit');
			}

			return {
				edit,
				cellIndex,
				end:
					(edit.editType === CellEditType.DocumentMetadata)
						? undefined
						: (edit.editType === CellEditType.Replace ? edit.index + edit.count : cellIndex),
				originalIndex: index
			};
		}).sort((a, b) => {
			if (a.end === undefined) {
				return -1;
			}

			if (b.end === undefined) {
				return -1;
			}

			return b.end - a.end || b.originalIndex - a.originalIndex;
		}).reduce((prev, curr) => {
			if (!prev.length) {
				// empty
				prev.push([curr]);
			} else {
				const last = prev[prev.length - 1];
				const index = last[0].cellIndex;

				if (curr.cellIndex === index) {
					last.push(curr);
				} else {
					prev.push([curr]);
				}
			}

			return prev;
		}, [] as TransformedEdit[][]).map(editsOnSameIndex => {
			const replaceEdits: TransformedEdit[] = [];
			const otherEdits: TransformedEdit[] = [];

			editsOnSameIndex.forEach(edit => {
				if (edit.edit.editType === CellEditType.Replace) {
					replaceEdits.push(edit);
				} else {
					otherEdits.push(edit);
				}
			});

			return [...otherEdits.reverse(), ...replaceEdits];
		});

		const flattenEdits = flatten(edits);

		for (const { edit, cellIndex } of flattenEdits) {
			switch (edit.editType) {
				case CellEditType.Replace:
					this._replaceCells(edit.index, edit.count, edit.cells, synchronous, computeUndoRedo);
					break;
				case CellEditType.Output:
					this._assertIndex(cellIndex);
					const cell = this._cells[cellIndex];
					if (edit.append) {
						this._spliceNotebookCellOutputs(cell, [[cell.outputs.length, 0, edit.outputs.map(op => new NotebookCellOutputTextModel(op))]], computeUndoRedo);
					} else {
						this._spliceNotebookCellOutputs2(cell, edit.outputs.map(op => new NotebookCellOutputTextModel(op)), computeUndoRedo);
					}
					break;
				case CellEditType.OutputItems:
					{
						this._assertIndex(cellIndex);
						const cell = this._cells[cellIndex];
						if (edit.append) {
							this._appendNotebookCellOutputItems(cell, edit.outputId, edit.items);
						} else {
							this._replaceNotebookCellOutputItems(cell, edit.outputId, edit.items);
						}
					}
					break;

				case CellEditType.Metadata:
					this._assertIndex(edit.index);
					this._changeCellMetadata(this._cells[edit.index], edit.metadata, computeUndoRedo);
					break;
				case CellEditType.PartialMetadata:
					this._assertIndex(cellIndex);
					this._changeCellMetadataPartial(this._cells[cellIndex], edit.metadata, computeUndoRedo);
					break;
				case CellEditType.CellLanguage:
					this._assertIndex(edit.index);
					this._changeCellLanguage(this._cells[edit.index], edit.language, computeUndoRedo);
					break;
				case CellEditType.DocumentMetadata:
					this._updateNotebookMetadata(edit.metadata, computeUndoRedo);
					break;
				case CellEditType.Move:
					this._moveCellToIdx(edit.index, edit.length, edit.newIdx, synchronous, computeUndoRedo, undefined, undefined);
					break;
			}
		}
	}

	private _replaceCells(index: number, count: number, cellDtos: ICellDto2[], synchronous: boolean, computeUndoRedo: boolean): void {

		if (count === 0 && cellDtos.length === 0) {
			return;
		}

		const oldViewCells = this._cells.slice(0);
		const oldSet = new Set();
		oldViewCells.forEach(cell => {
			oldSet.add(cell.handle);
		});

		// prepare remove
		for (let i = index; i < Math.min(index + count, this._cells.length); i++) {
			const cell = this._cells[i];
			this._cellListeners.get(cell.handle)?.dispose();
			this._cellListeners.delete(cell.handle);
		}

		// prepare add
		const cells = cellDtos.map(cellDto => {
			const cellHandle = this._cellhandlePool++;
			const cellUri = CellUri.generate(this.uri, cellHandle);
			const cell = new NotebookCellTextModel(
				cellUri, cellHandle,
				cellDto.source, cellDto.language, cellDto.cellKind, cellDto.outputs || [], cellDto.metadata, this.transientOptions,
				this._modeService
			);
			const textModel = this._modelService.getModel(cellUri);
			if (textModel && textModel instanceof TextModel) {
				cell.textModel = textModel;
				cell.language = cellDto.language;
				if (!cell.textModel.equalsTextBuffer(cell.textBuffer as ITextBuffer)) {
					cell.textModel.setValue(cellDto.source);
				}
			}
			const dirtyStateListener = cell.onDidChangeContent((e) => {
				this._bindCellContentHandler(cell, e);
			});
			this._cellListeners.set(cell.handle, dirtyStateListener);
			return cell;
		});

		// make change
		this._cells.splice(index, count, ...cells);
		const diffs = diff(oldViewCells, this._cells, cell => {
			return oldSet.has(cell.handle);
		}).map(diff => {
			return [diff.start, diff.deleteCount, diff.toInsert] as [number, number, NotebookCellTextModel[]];
		});

		const undoDiff = diffs.map(diff => {
			const deletedCells = oldViewCells.slice(diff[0], diff[0] + diff[1]);

			return [diff[0], deletedCells, diff[2]] as [number, NotebookCellTextModel[], NotebookCellTextModel[]];
		});

		if (computeUndoRedo) {
			this._operationManager.pushEditOperation(new SpliceCellsEdit(this.uri, undoDiff, {
				insertCell: (index, cell, endSelections) => { this._insertNewCell(index, [cell], true, endSelections); },
				deleteCell: (index, endSelections) => { this._removeCell(index, 1, true, endSelections); },
				replaceCell: (index, count, cells, endSelections) => { this._replaceNewCells(index, count, cells, true, endSelections); },
			}, undefined, undefined), undefined, undefined);
		}

		// should be deferred
		this._eventEmitter.emit({
			kind: NotebookCellsChangeType.ModelChange,
			changes: diffs,
			transient: false
		}, synchronous);
	}

	private _increaseVersionId(undoStackEmpty: boolean): void {
		this._versionId = this._versionId + 1;
		if (!undoStackEmpty) {
			this._notebookSpecificAlternativeId = this._versionId;
		}
		this._alternativeVersionId = this._generateAlternativeId();
	}

	private _overwriteAlternativeVersionId(newAlternativeVersionId: string): void {
		this._alternativeVersionId = newAlternativeVersionId;
		this._notebookSpecificAlternativeId = Number(newAlternativeVersionId.substr(0, newAlternativeVersionId.indexOf('_')));
	}

	private _isDocumentMetadataChangeTransient(a: NotebookDocumentMetadata, b: NotebookDocumentMetadata) {
		const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
		for (let key of keys) {
			if (key !== 'trusted') {
				return true;
			}
		}

		return false;
	}

	private _updateNotebookMetadata(metadata: NotebookDocumentMetadata, computeUndoRedo: boolean) {
		const oldMetadata = this.metadata;
		const triggerDirtyChange = this._isDocumentMetadataChanged(this.metadata, metadata);

		if (triggerDirtyChange) {
			if (computeUndoRedo) {
				const that = this;
				this._operationManager.pushEditOperation(new class implements IResourceUndoRedoElement {
					readonly type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
					get resource() {
						return that.uri;
					}
					readonly label = 'Update Notebook Metadata';
					undo() {
						that._updateNotebookMetadata(oldMetadata, false);
					}
					redo() {
						that._updateNotebookMetadata(metadata, false);
					}
				}(), undefined, undefined);
			}
		}

		this.metadata = metadata;
		this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeDocumentMetadata, metadata: this.metadata, transient: this._isDocumentMetadataChangeTransient(oldMetadata, metadata) }, true);
	}

	private _insertNewCell(index: number, cells: NotebookCellTextModel[], synchronous: boolean, endSelections: ISelectionState | undefined): void {
		for (let i = 0; i < cells.length; i++) {
			const dirtyStateListener = cells[i].onDidChangeContent((e) => {
				this._bindCellContentHandler(cells[i], e);
			});

			this._cellListeners.set(cells[i].handle, dirtyStateListener);
		}

		this._cells.splice(index, 0, ...cells);
		this._eventEmitter.emit({
			kind: NotebookCellsChangeType.ModelChange,
			changes:
				[[
					index,
					0,
					cells
				]],
			transient: false
		}, synchronous, endSelections);

		return;
	}

	private _removeCell(index: number, count: number, synchronous: boolean, endSelections: ISelectionState | undefined) {
		for (let i = index; i < index + count; i++) {
			const cell = this._cells[i];
			this._cellListeners.get(cell.handle)?.dispose();
			this._cellListeners.delete(cell.handle);
		}
		this._cells.splice(index, count);
		this._eventEmitter.emit({ kind: NotebookCellsChangeType.ModelChange, changes: [[index, count, []]], transient: false }, synchronous, endSelections);
	}

	private _replaceNewCells(index: number, count: number, cells: NotebookCellTextModel[], synchronous: boolean, endSelections: ISelectionState | undefined) {
		for (let i = index; i < index + count; i++) {
			const cell = this._cells[i];
			this._cellListeners.get(cell.handle)?.dispose();
			this._cellListeners.delete(cell.handle);
		}

		for (let i = 0; i < cells.length; i++) {
			const dirtyStateListener = cells[i].onDidChangeContent((e) => {
				this._bindCellContentHandler(cells[i], e);
			});

			this._cellListeners.set(cells[i].handle, dirtyStateListener);
		}

		this._cells.splice(index, count, ...cells);
		this._eventEmitter.emit({ kind: NotebookCellsChangeType.ModelChange, changes: [[index, count, cells]], transient: false }, synchronous, endSelections);

	}

	private _isDocumentMetadataChanged(a: NotebookDocumentMetadata, b: NotebookDocumentMetadata) {
		const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
		for (let key of keys) {
			if (key === 'custom') {
				if (!this._customMetadataEqual(a[key], b[key])
					&&
					!(this.transientOptions.transientDocumentMetadata[key as keyof NotebookDocumentMetadata])
				) {
					return true;
				}
			} else if (
				(a[key as keyof NotebookDocumentMetadata] !== b[key as keyof NotebookDocumentMetadata])
				&&
				!(this.transientOptions.transientDocumentMetadata[key as keyof NotebookDocumentMetadata])
			) {
				return true;
			}
		}

		return false;
	}

	private _isCellMetadataChanged(a: NotebookCellMetadata, b: NotebookCellMetadata) {
		const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
		for (let key of keys) {
			if (key === 'custom') {
				if (!this._customMetadataEqual(a[key], b[key])
					&&
					!(this.transientOptions.transientCellMetadata[key as keyof NotebookCellMetadata])
				) {
					return true;
				}
			} else if (
				(a[key as keyof NotebookCellMetadata] !== b[key as keyof NotebookCellMetadata])
				&&
				!(this.transientOptions.transientCellMetadata[key as keyof NotebookCellMetadata])
			) {
				return true;
			}
		}

		return false;
	}

	private _customMetadataEqual(a: any, b: any) {
		if (!a && !b) {
			// both of them are nullish or undefined
			return true;
		}

		if (!a || !b) {
			return false;
		}

		const aProps = Object.getOwnPropertyNames(a);
		const bProps = Object.getOwnPropertyNames(b);

		if (aProps.length !== bProps.length) {
			return false;
		}

		for (let i = 0; i < aProps.length; i++) {
			const propName = aProps[i];
			if (a[propName] !== b[propName]) {
				return false;
			}
		}

		return true;
	}

	private _changeCellMetadataPartial(cell: NotebookCellTextModel, metadata: NullablePartialNotebookCellMetadata, computeUndoRedo: boolean) {
		const newMetadata: NotebookCellMetadata = {
			...cell.metadata
		};
		let k: keyof NullablePartialNotebookCellMetadata;
		for (k in metadata) {
			const value = metadata[k] ?? undefined;
			newMetadata[k] = value as any; // TS...
		}

		return this._changeCellMetadata(cell, newMetadata, computeUndoRedo);
	}

	private _changeCellMetadata(cell: NotebookCellTextModel, metadata: NotebookCellMetadata, computeUndoRedo: boolean) {
		const triggerDirtyChange = this._isCellMetadataChanged(cell.metadata, metadata);

		if (triggerDirtyChange) {
			if (computeUndoRedo) {
				const index = this._cells.indexOf(cell);
				this._operationManager.pushEditOperation(new CellMetadataEdit(this.uri, index, Object.freeze(cell.metadata), Object.freeze(metadata), {
					updateCellMetadata: (index, newMetadata) => {
						const cell = this._cells[index];
						if (!cell) {
							return;
						}
						this._changeCellMetadata(cell, {
							...newMetadata,
							runState: cell.metadata.runState
						}, false);
					}
				}), undefined, undefined);
			}
		}

		// should be deferred
		cell.metadata = metadata;

		this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeCellMetadata, index: this._cells.indexOf(cell), metadata: cell.metadata, transient: !triggerDirtyChange }, true);
	}

	private _changeCellLanguage(cell: NotebookCellTextModel, languageId: string, computeUndoRedo: boolean) {
		if (cell.language === languageId) {
			return;
		}

		const oldLanguage = cell.language;
		cell.language = languageId;

		if (computeUndoRedo) {
			const that = this;
			this._operationManager.pushEditOperation(new class implements IResourceUndoRedoElement {
				readonly type: UndoRedoElementType.Resource = UndoRedoElementType.Resource;
				get resource() {
					return that.uri;
				}
				readonly label = 'Update Cell Language';
				undo() {
					that._changeCellLanguage(cell, oldLanguage, false);
				}
				redo() {
					that._changeCellLanguage(cell, languageId, false);
				}
			}(), undefined, undefined);
		}

		this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeLanguage, index: this._cells.indexOf(cell), language: languageId, transient: false }, true, undefined);
	}

	private _spliceNotebookCellOutputs2(cell: NotebookCellTextModel, outputs: ICellOutput[], computeUndoRedo: boolean): void {
		const diff = new LcsDiff(new OutputSequence(cell.outputs), new OutputSequence(outputs));
		const diffResult = diff.ComputeDiff(false);
		const splices: NotebookCellOutputsSplice[] = diffResult.changes.map(change => [change.originalStart, change.originalLength, outputs.slice(change.modifiedStart, change.modifiedStart + change.modifiedLength)]);
		this._spliceNotebookCellOutputs(cell, splices, computeUndoRedo);
	}

	private _spliceNotebookCellOutputs(cell: NotebookCellTextModel, splices: NotebookCellOutputsSplice[], computeUndoRedo: boolean): void {
		if (splices.length === 0) {
			return;
		}

		cell.spliceNotebookCellOutputs(splices);

		this._eventEmitter.emit({
			kind: NotebookCellsChangeType.Output,
			index: this._cells.indexOf(cell),
			outputs: cell.outputs ?? [],
			transient: this.transientOptions.transientOutputs,
		}, true);
	}

	private _appendNotebookCellOutputItems(cell: NotebookCellTextModel, outputId: string, items: IOutputItemDto[]) {
		const outputIndex = cell.outputs.findIndex(output => output.outputId === outputId);

		if (outputIndex < 0) {
			return;
		}

		const output = cell.outputs[outputIndex];
		output.appendData(items);
		this._eventEmitter.emit({
			kind: NotebookCellsChangeType.OutputItem,
			index: this._cells.indexOf(cell),
			outputId: output.outputId,
			outputItems: items,
			append: true,
			transient: this.transientOptions.transientOutputs
		}, true);
	}

	private _replaceNotebookCellOutputItems(cell: NotebookCellTextModel, outputId: string, items: IOutputItemDto[]) {
		const outputIndex = cell.outputs.findIndex(output => output.outputId === outputId);

		if (outputIndex < 0) {
			return;
		}

		const output = cell.outputs[outputIndex];
		output.replaceData(items);
		this._eventEmitter.emit({
			kind: NotebookCellsChangeType.OutputItem,
			index: this._cells.indexOf(cell),
			outputId: output.outputId,
			outputItems: items,
			append: false,
			transient: this.transientOptions.transientOutputs
		}, true, undefined);
	}

	private _moveCellToIdx(index: number, length: number, newIdx: number, synchronous: boolean, pushedToUndoStack: boolean, beforeSelections: ISelectionState | undefined, endSelections: ISelectionState | undefined): boolean {
		if (pushedToUndoStack) {
			this._operationManager.pushEditOperation(new MoveCellEdit(this.uri, index, length, newIdx, {
				moveCell: (fromIndex: number, length: number, toIndex: number, beforeSelections: ISelectionState | undefined, endSelections: ISelectionState | undefined) => {
					this._moveCellToIdx(fromIndex, length, toIndex, true, false, beforeSelections, endSelections);
				},
			}, beforeSelections, endSelections), beforeSelections, endSelections);
		}

		this._assertIndex(index);
		this._assertIndex(newIdx);

		const cells = this._cells.splice(index, length);
		this._cells.splice(newIdx, 0, ...cells);
		this._eventEmitter.emit({ kind: NotebookCellsChangeType.Move, index, length, newIdx, cells, transient: false }, synchronous, endSelections);

		return true;
	}

	private _assertIndex(index: number) {
		if (index < 0 || index >= this._cells.length) {
			throw new Error(`model index out of range ${index}`);
		}
	}
}

class OutputSequence implements ISequence {
	constructor(readonly outputs: IOutputDto[]) {
	}

	getElements(): Int32Array | number[] | string[] {
		return this.outputs.map(output => {
			return hash(output.outputs);
		});
	}

}
