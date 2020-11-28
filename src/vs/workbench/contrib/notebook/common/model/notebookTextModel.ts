/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { INotebookTextModel, NotebookCellOutputsSplice, NotebookDocumentMetadata, NotebookCellMetadata, ICellEditOperation, CellEditType, CellUri, notebookDocumentMetadataDefaults, diff, NotebookCellsChangeType, ICellDto2, TransientOptions, NotebookTextModelChangedEvent, NotebookRawContentEvent, IProcessedOutput, CellOutputKind } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ITextSnapshot } from 'vs/editor/common/model';
import { IUndoRedoService, UndoRedoElementType, IUndoRedoElement, IResourceUndoRedoElement, UndoRedoGroup, IWorkspaceUndoRedoElement } from 'vs/platform/undoRedo/common/undoRedo';
import { MoveCellEdit, SpliceCellsEdit, CellMetadataEdit } from 'vs/workbench/contrib/notebook/common/model/cellEdit';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { ISequence, LcsDiff } from 'vs/base/common/diff/diff';
import { hash } from 'vs/base/common/hash';

export class NotebookTextModelSnapshot implements ITextSnapshot {

	private _index: number = -1;

	constructor(private _model: NotebookTextModel) { }

	read(): string | null {

		if (this._index === -1) {
			this._index++;
			return `{ "metadata": ${JSON.stringify(this._model.metadata)}, "languages": ${JSON.stringify(this._model.languages)}, "cells": [`;
		}

		if (this._index < this._model.cells.length) {
			const cell = this._model.cells[this._index];

			const data = {
				source: cell.getValue(),
				metadata: cell.metadata,
				cellKind: cell.cellKind,
				language: cell.language,
				outputs: cell.outputs
			};

			const rawStr = JSON.stringify(data);
			const isLastCell = this._index === this._model.cells.length - 1;

			this._index++;
			return isLastCell ? rawStr : (rawStr + ',');
		} else if (this._index === this._model.cells.length) {
			this._index++;
			return `]}`;
		} else {
			return null;
		}
	}

}

class StackOperation implements IWorkspaceUndoRedoElement {
	type: UndoRedoElementType.Workspace;

	private _operations: IUndoRedoElement[] = [];
	private _beginSelectionState: number[] | undefined = undefined;
	private _resultSelectionState: number[] | undefined = undefined;

	constructor(readonly resource: URI, readonly label: string, readonly undoRedoGroup: UndoRedoGroup | undefined, private _delayedEmitter: DelayedEmitter, selectionState: number[] | undefined) {
		this.type = UndoRedoElementType.Workspace;
		this._beginSelectionState = selectionState;
	}
	get resources(): readonly URI[] {
		return [this.resource];
	}

	get isEmpty(): boolean {
		return this._operations.length === 0;
	}

	pushEndSelectionState(selectionState: number[] | undefined) {
		this._resultSelectionState = selectionState;
	}

	pushEditOperation(element: IUndoRedoElement, beginSelectionState: number[] | undefined, resultSelectionState: number[] | undefined) {
		if (this._operations.length === 0) {
			this._beginSelectionState = this._beginSelectionState || beginSelectionState;
		}
		this._operations.push(element);
		this._resultSelectionState = resultSelectionState;
	}

	async undo(): Promise<void> {
		this._delayedEmitter.beginDeferredEmit();
		for (let i = this._operations.length - 1; i >= 0; i--) {
			await this._operations[i].undo();
		}
		this._delayedEmitter.endDeferredEmit(this._beginSelectionState);
	}

	async redo(): Promise<void> {
		this._delayedEmitter.beginDeferredEmit();
		for (let i = 0; i < this._operations.length; i++) {
			await this._operations[i].redo();
		}
		this._delayedEmitter.endDeferredEmit(this._resultSelectionState);
	}
}

export class NotebookOperationManager {
	private _pendingStackOperation: StackOperation | null = null;
	constructor(private _undoService: IUndoRedoService, private _resource: URI, private _delayedEmitter: DelayedEmitter) {

	}

	pushStackElement(label: string, selectionState: number[] | undefined, undoRedoGroup: UndoRedoGroup | undefined) {
		if (this._pendingStackOperation) {
			this._pendingStackOperation.pushEndSelectionState(selectionState);
			if (!this._pendingStackOperation.isEmpty) {
				this._undoService.pushElement(this._pendingStackOperation, this._pendingStackOperation.undoRedoGroup);
			}
			this._pendingStackOperation = null;
			return;
		}

		this._pendingStackOperation = new StackOperation(this._resource, label, undoRedoGroup, this._delayedEmitter, selectionState);
	}

	pushEditOperation(element: IUndoRedoElement, beginSelectionState: number[] | undefined, resultSelectionState: number[] | undefined) {
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
		private readonly _computeEndState: () => void,
		private readonly _textModel: NotebookTextModel

	) {

	}

	beginDeferredEmit(): void {
		this._deferredCnt++;
	}

	endDeferredEmit(endSelections: number[] | undefined): void {
		this._deferredCnt--;
		if (this._deferredCnt === 0) {
			this._computeEndState();

			if (this._notebookTextModelChangedEvent) {
				this._onDidChangeContent.fire(
					{
						rawEvents: this._notebookTextModelChangedEvent.rawEvents,
						versionId: this._textModel.versionId,
						endSelections: endSelections || this._notebookTextModelChangedEvent.endSelections,
						synchronous: this._notebookTextModelChangedEvent.synchronous
					}
				);
			}

			this._notebookTextModelChangedEvent = null;
		}
	}


	emit(data: NotebookRawContentEvent, synchronous: boolean, endSelections?: number[]) {

		if (this._deferredCnt === 0) {
			this._computeEndState();
			this._onDidChangeContent.fire(
				{
					rawEvents: [data],
					versionId: this._textModel.versionId,
					synchronous,
					endSelections
				}
			);
		} else {
			if (!this._notebookTextModelChangedEvent) {
				this._notebookTextModelChangedEvent = {
					rawEvents: [data],
					versionId: this._textModel.versionId,
					endSelections: endSelections,
					synchronous: synchronous
				};
			} else {
				// merge
				this._notebookTextModelChangedEvent = {
					rawEvents: [...this._notebookTextModelChangedEvent.rawEvents, data],
					versionId: this._textModel.versionId,
					endSelections: endSelections ? endSelections : this._notebookTextModelChangedEvent.endSelections,
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
	private _mapping: Map<number, NotebookCellTextModel> = new Map();
	private _cellListeners: Map<number, IDisposable> = new Map();
	private _cells: NotebookCellTextModel[] = [];
	private _languages: string[] = [];
	private _allLanguages: boolean = false;

	get languages() {
		return this._languages;
	}

	get resolvedLanguages() {
		if (this._allLanguages) {
			return this._modeService.getRegisteredModes();
		}

		return this._languages;
	}

	metadata: NotebookDocumentMetadata = notebookDocumentMetadataDefaults;
	transientOptions: TransientOptions = { transientMetadata: {}, transientOutputs: false };
	private _versionId = 0;
	private _operationManager: NotebookOperationManager;
	private _eventEmitter: DelayedEmitter;

	get cells(): readonly NotebookCellTextModel[] {
		return this._cells;
	}

	get versionId() {
		return this._versionId;
	}

	constructor(
		readonly viewType: string,
		readonly supportBackup: boolean,
		readonly uri: URI,
		cells: ICellDto2[],
		languages: string[],
		metadata: NotebookDocumentMetadata,
		options: TransientOptions,
		@IUndoRedoService private _undoService: IUndoRedoService,
		@ITextModelService private _modelService: ITextModelService,
		@IModeService private readonly _modeService: IModeService,
	) {
		super();
		this.transientOptions = options;
		this.metadata = metadata;
		this.updateLanguages(languages);
		this._initialize(cells);

		this._eventEmitter = new DelayedEmitter(
			this._onDidChangeContent,
			() => { this._increaseVersionId(); },
			this
		);

		this._operationManager = new NotebookOperationManager(this._undoService, uri, this._eventEmitter);
	}

	private _initialize(cells: ICellDto2[]) {
		this._cells = [];
		this._versionId = 0;

		const mainCells = cells.map(cell => {
			const cellHandle = this._cellhandlePool++;
			const cellUri = CellUri.generate(this.uri, cellHandle);
			return new NotebookCellTextModel(cellUri, cellHandle, cell.source, cell.language, cell.cellKind, cell.outputs || [], cell.metadata, this.transientOptions, this._modelService);
		});

		for (let i = 0; i < mainCells.length; i++) {
			this._mapping.set(mainCells[i].handle, mainCells[i]);
			const dirtyStateListener = mainCells[i].onDidChangeContent(() => {
				this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeCellContent, transient: false }, true);
			});

			this._cellListeners.set(mainCells[i].handle, dirtyStateListener);
		}

		this._cells.splice(0, 0, ...mainCells);
	}

	dispose() {
		this._onWillDispose.fire();
		dispose(this._cellListeners.values());
		dispose(this._cells);
		super.dispose();
	}

	pushStackElement(label: string, selectionState: number[] | undefined, undoRedoGroup: UndoRedoGroup | undefined) {
		this._operationManager.pushStackElement(label, selectionState, undoRedoGroup);
	}

	applyEdits(modelVersionId: number, rawEdits: ICellEditOperation[], synchronous: boolean, beginSelectionState: number[] | undefined, endSelectionsComputer: () => number[] | undefined, undoRedoGroup: UndoRedoGroup | undefined, computeUndoRedo: boolean = true): boolean {
		if (modelVersionId !== this._versionId) {
			return false;
		}

		this._eventEmitter.beginDeferredEmit();
		this.pushStackElement('edit', beginSelectionState, undoRedoGroup);

		const edits = rawEdits.map((edit, index) => {
			return {
				edit,
				end:
					(edit.editType === CellEditType.DocumentMetadata || edit.editType === CellEditType.Unknown)
						? undefined
						: (edit.editType === CellEditType.Replace ? edit.index + edit.count : edit.index),
				originalIndex: index,
			};
		}).sort((a, b) => {
			if (a.end === undefined) {
				return -1;
			}

			if (b.end === undefined) {
				return -1;
			}

			return b.end - a.end || b.originalIndex - a.originalIndex;
		});

		for (const { edit } of edits) {
			switch (edit.editType) {
				case CellEditType.Replace:
					this._replaceCells(edit.index, edit.count, edit.cells, synchronous, computeUndoRedo);
					break;
				case CellEditType.Output:
					//TODO@jrieken,@rebornix no event, no undo stop (?)
					this._assertIndex(edit.index);
					const cell = this._cells[edit.index];
					this._spliceNotebookCellOutputs2(cell.handle, edit.outputs, computeUndoRedo);
					break;
				case CellEditType.OutputsSplice:
					{
						//TODO@jrieken,@rebornix no event, no undo stop (?)
						this._assertIndex(edit.index);
						const cell = this._cells[edit.index];
						this._spliceNotebookCellOutputs(cell.handle, edit.splices, computeUndoRedo);
						break;
					}
				case CellEditType.Metadata:
					this._assertIndex(edit.index);
					this._changeCellMetadata(this._cells[edit.index].handle, edit.metadata, computeUndoRedo);
					break;
				case CellEditType.CellLanguage:
					this._assertIndex(edit.index);
					this._changeCellLanguage(this._cells[edit.index].handle, edit.language, computeUndoRedo);
					break;
				case CellEditType.DocumentMetadata:
					this._updateNotebookMetadata(edit.metadata, computeUndoRedo);
					break;
				case CellEditType.Move:
					this._moveCellToIdx(edit.index, edit.length, edit.newIdx, synchronous, computeUndoRedo, undefined, undefined);
					break;
				case CellEditType.Unknown:
					this._handleUnknownChange();
					break;
			}
		}

		const endSelections = endSelectionsComputer();
		this.pushStackElement('edit', endSelections, undefined);
		this._eventEmitter.endDeferredEmit(endSelections);
		return true;
	}

	createSnapshot(preserveBOM?: boolean): ITextSnapshot {
		return new NotebookTextModelSnapshot(this);
	}

	handleUnknownUndoableEdit(label: string | undefined, undo: () => void, redo: () => void): void {
		this._operationManager.pushEditOperation({
			type: UndoRedoElementType.Resource,
			resource: this.uri,
			label: label ?? nls.localize('defaultEditLabel', "Edit"),
			undo: async () => {
				undo();
			},
			redo: async () => {
				redo();
			},
		}, undefined, undefined);

		this._eventEmitter.emit({
			kind: NotebookCellsChangeType.Unknown,
			transient: false
		}, true);
	}

	private _handleUnknownChange() {
		this._eventEmitter.emit({
			kind: NotebookCellsChangeType.Unknown,
			transient: false
		}, true);
	}

	private _replaceCells(index: number, count: number, cellDtos: ICellDto2[], synchronous: boolean, computeUndoRedo: boolean): void {

		if (count === 0 && cellDtos.length === 0) {
			return;
		}

		const oldViewCells = this._cells.slice(0);
		const oldMap = new Map(this._mapping);

		// prepare remove
		for (let i = index; i < index + count; i++) {
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
				this._modelService
			);
			const dirtyStateListener = cell.onDidChangeContent(() => {
				this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeCellContent, transient: false }, true);
			});
			this._cellListeners.set(cell.handle, dirtyStateListener);
			this._mapping.set(cell.handle, cell);
			return cell;
		});

		// make change
		this._cells.splice(index, count, ...cells);
		const diffs = diff(oldViewCells, this._cells, cell => {
			return oldMap.has(cell.handle);
		}).map(diff => {
			return [diff.start, diff.deleteCount, diff.toInsert] as [number, number, NotebookCellTextModel[]];
		});

		const undoDiff = diffs.map(diff => {
			const deletedCells = oldViewCells.slice(diff[0], diff[0] + diff[1]);

			return [diff[0], deletedCells, diff[2]] as [number, NotebookCellTextModel[], NotebookCellTextModel[]];
		});

		if (computeUndoRedo) {
			this._operationManager.pushEditOperation(new SpliceCellsEdit(this.uri, undoDiff, {
				insertCell: (index, cell, endSelections?: number[]) => { this._insertNewCell(index, [cell], true, endSelections); },
				deleteCell: (index, endSelections?: number[]) => { this._removeCell(index, 1, true, endSelections); },
			}, undefined, undefined), undefined, undefined);
		}

		// should be deferred
		this._eventEmitter.emit({
			kind: NotebookCellsChangeType.ModelChange,
			changes: diffs,
			transient: false
		}, synchronous);
	}

	private _increaseVersionId(): void {
		this._versionId = this._versionId + 1;
	}

	updateLanguages(languages: string[]) {
		const allLanguages = languages.find(lan => lan === '*');
		this._allLanguages = allLanguages !== undefined;
		this._languages = languages;

		const resolvedLanguages = this.resolvedLanguages;
		if (resolvedLanguages.length && this._cells.length) {
			this._cells[0].language = resolvedLanguages[0];
		}
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
		this.metadata = metadata;

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

		this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeDocumentMetadata, metadata: this.metadata, transient: this._isDocumentMetadataChangeTransient(oldMetadata, metadata) }, true);
	}

	private _insertNewCell(index: number, cells: NotebookCellTextModel[], synchronous: boolean, endSelections?: number[]): void {
		for (let i = 0; i < cells.length; i++) {
			this._mapping.set(cells[i].handle, cells[i]);
			const dirtyStateListener = cells[i].onDidChangeContent(() => {
				this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeCellContent, transient: false }, true);
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

	private _removeCell(index: number, count: number, synchronous: boolean, endSelections?: number[]) {
		for (let i = index; i < index + count; i++) {
			const cell = this._cells[i];
			this._cellListeners.get(cell.handle)?.dispose();
			this._cellListeners.delete(cell.handle);
		}
		this._cells.splice(index, count);
		this._eventEmitter.emit({ kind: NotebookCellsChangeType.ModelChange, changes: [[index, count, []]], transient: false }, synchronous, endSelections);
	}

	private _isCellMetadataChanged(a: NotebookCellMetadata, b: NotebookCellMetadata) {
		const keys = new Set([...Object.keys(a || {}), ...Object.keys(b || {})]);
		for (let key of keys) {
			if (key === 'custom') {
				if (!this._customMetadataEqual(a[key], b[key])
					&&
					!(this.transientOptions.transientMetadata[key as keyof NotebookCellMetadata])
				) {
					return true;
				}
			} else if (
				(a[key as keyof NotebookCellMetadata] !== b[key as keyof NotebookCellMetadata])
				&&
				!(this.transientOptions.transientMetadata[key as keyof NotebookCellMetadata])
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

	private _changeCellMetadata(handle: number, metadata: NotebookCellMetadata, computeUndoRedo: boolean) {
		const cell = this._cells.find(cell => cell.handle === handle);

		if (!cell) {
			return;
		}

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
						this._changeCellMetadata(cell.handle, newMetadata, false);
					}
				}), undefined, undefined);
			}
			// should be deferred
			cell.metadata = metadata;
		} else {
			cell.metadata = metadata;
		}

		this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeCellMetadata, index: this._cells.indexOf(cell), metadata: cell.metadata, transient: !triggerDirtyChange }, true);
	}

	private _changeCellLanguage(handle: number, languageId: string, computeUndoRedo: boolean) {
		const cell = this._mapping.get(handle);
		if (!cell || cell.language === languageId) {
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
					that._changeCellLanguage(cell.handle, oldLanguage, false);
				}
				redo() {
					that._changeCellLanguage(cell.handle, languageId, false);
				}
			}(), undefined, undefined);
		}

		this._eventEmitter.emit({ kind: NotebookCellsChangeType.ChangeLanguage, index: this._cells.indexOf(cell), language: languageId, transient: false }, true);
	}

	private _spliceNotebookCellOutputs2(cellHandle: number, outputs: IProcessedOutput[], computeUndoRedo: boolean): void {
		const cell = this._mapping.get(cellHandle);
		if (!cell) {
			return;
		}

		const diff = new LcsDiff(new OutputSequence(cell.outputs), new OutputSequence(outputs));
		const diffResult = diff.ComputeDiff(false);
		const splices: NotebookCellOutputsSplice[] = diffResult.changes.map(change => [change.originalStart, change.originalLength, outputs.slice(change.modifiedStart, change.modifiedStart + change.modifiedLength)]);
		this._spliceNotebookCellOutputs(cellHandle, splices, computeUndoRedo);
	}

	private _spliceNotebookCellOutputs(cellHandle: number, splices: NotebookCellOutputsSplice[], computeUndoRedo: boolean): void {
		const cell = this._mapping.get(cellHandle);
		if (cell) {
			cell.spliceNotebookCellOutputs(splices);

			this._eventEmitter.emit({
				kind: NotebookCellsChangeType.Output,
				index: this._cells.indexOf(cell),
				outputs: cell.outputs ?? [],
				transient: this.transientOptions.transientOutputs,
			}, true);
		}
	}

	private _moveCellToIdx(index: number, length: number, newIdx: number, synchronous: boolean, pushedToUndoStack: boolean, beforeSelections: number[] | undefined, endSelections: number[] | undefined): boolean {
		if (pushedToUndoStack) {
			this._operationManager.pushEditOperation(new MoveCellEdit(this.uri, index, length, newIdx, {
				moveCell: (fromIndex: number, length: number, toIndex: number, beforeSelections: number[] | undefined, endSelections: number[] | undefined) => {
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
	constructor(readonly outputs: IProcessedOutput[]) {
	}

	getElements(): Int32Array | number[] | string[] {
		return this.outputs.map(output => {
			switch (output.outputKind) {
				case CellOutputKind.Rich:
					return hash([output.outputKind, output.metadata, output.data]);
				case CellOutputKind.Error:
					return hash([output.outputKind, output.ename, output.evalue, output.traceback]);
				case CellOutputKind.Text:
					return hash([output.outputKind, output.text]);
			}
		});
	}

}
