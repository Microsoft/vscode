/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { INotebookTextModel, NotebookCellOutputsSplice, NotebookCellTextModelSplice, NotebookDocumentMetadata, NotebookCellMetadata, ICellEditOperation, CellEditType, CellUri, ICellInsertEdit, NotebookCellsChangedEvent, CellKind, IProcessedOutput, notebookDocumentMetadataDefaults, diff, ICellDeleteEdit, NotebookCellsChangeType, ICellDto2, IMainCellDto } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ITextSnapshot } from 'vs/editor/common/model';
import { IUndoRedoService, UndoRedoElementType, IUndoRedoElement, IResourceUndoRedoElement } from 'vs/platform/undoRedo/common/undoRedo';
import { InsertCellEdit, DeleteCellEdit, MoveCellEdit, SpliceCellsEdit } from 'vs/workbench/contrib/notebook/common/model/cellEdit';
import { ITextModelService } from 'vs/editor/common/services/resolverService';

function compareRangesUsingEnds(a: [number, number], b: [number, number]): number {
	if (a[1] === b[1]) {
		return a[1] - b[1];

	}
	return a[1] - b[1];
}

export class NotebookTextModelSnapshot implements ITextSnapshot {
	// private readonly _pieces: Ce[] = [];
	private _index: number = -1;

	constructor(private _model: NotebookTextModel) {
		// for (let i = 0; i < this._model.cells.length; i++) {
		// 	const cell = this._model.cells[i];
		// 	this._pieces.push(this._model.cells[i].textBuffer.createSnapshot(true));
		// }
	}

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

class StackOperation implements IResourceUndoRedoElement {
	type: UndoRedoElementType.Resource;

	private _operations: IUndoRedoElement[] = [];

	constructor(readonly resource: URI, readonly label: string) {
		this.type = UndoRedoElementType.Resource;
	}

	pushEditOperation(element: IUndoRedoElement) {
		this._operations.push(element);
	}

	undo(): void {
		this._operations.reverse().forEach(o => o.undo());
	}
	redo(): void | Promise<void> {
		this._operations.forEach(o => o.redo());
	}
}

export class NotebookOperationManager {
	private _pendingStackOperation: StackOperation | null = null;
	constructor(private _undoService: IUndoRedoService, private _resource: URI) {

	}

	pushStackElement(label: string) {
		if (this._pendingStackOperation) {
			this._undoService.pushElement(this._pendingStackOperation);
			this._pendingStackOperation = null;
			return;
		}

		this._pendingStackOperation = new StackOperation(this._resource, label);
	}

	pushEditOperation(element: IUndoRedoElement) {
		if (this._pendingStackOperation) {
			this._pendingStackOperation.pushEditOperation(element);
			return;
		}

		this._undoService.pushElement(element);
	}
}

export class NotebookTextModel extends Disposable implements INotebookTextModel {

	private _cellhandlePool: number = 0;

	private readonly _onWillDispose: Emitter<void> = this._register(new Emitter<void>());
	readonly onWillDispose: Event<void> = this._onWillDispose.event;
	private readonly _onDidChangeCells = this._register(new Emitter<{ synchronous: boolean, splices: NotebookCellTextModelSplice[] }>());
	get onDidChangeCells() { return this._onDidChangeCells.event; }
	private readonly _emitSelections = this._register(new Emitter<number[]>());
	get emitSelections() { return this._emitSelections.event; }
	private _onDidModelChangeProxy = this._register(new Emitter<NotebookCellsChangedEvent>());
	get onDidModelChangeProxy(): Event<NotebookCellsChangedEvent> { return this._onDidModelChangeProxy.event; }
	private _onDidSelectionChangeProxy = this._register(new Emitter<number[] | null>());
	get onDidSelectionChange(): Event<number[] | null> { return this._onDidSelectionChangeProxy.event; }
	private _onDidChangeContent = this._register(new Emitter<void>());
	onDidChangeContent: Event<void> = this._onDidChangeContent.event;
	private _onDidChangeMetadata = this._register(new Emitter<NotebookDocumentMetadata>());
	onDidChangeMetadata: Event<NotebookDocumentMetadata> = this._onDidChangeMetadata.event;
	private _mapping: Map<number, NotebookCellTextModel> = new Map();
	private _cellListeners: Map<number, IDisposable> = new Map();
	cells: NotebookCellTextModel[];
	languages: string[] = [];
	metadata: NotebookDocumentMetadata = notebookDocumentMetadataDefaults;
	renderers = new Set<string>();
	private _isUntitled: boolean | undefined = undefined;
	private _versionId = 0;

	get versionId() {
		return this._versionId;
	}

	private _selections: number[] = [];

	get selections() {
		return this._selections;
	}

	set selections(selections: number[]) {
		this._selections = selections;
		this._onDidSelectionChangeProxy.fire(this._selections);
	}

	private _dirty = false;
	protected readonly _onDidChangeDirty = this._register(new Emitter<void>());
	readonly onDidChangeDirty = this._onDidChangeDirty.event;

	private _operationManager: NotebookOperationManager;

	constructor(
		public handle: number,
		public viewType: string,
		public supportBackup: boolean,
		public uri: URI,
		@IUndoRedoService private _undoService: IUndoRedoService,
		@ITextModelService private _modelService: ITextModelService
	) {
		super();
		this.cells = [];

		this._operationManager = new NotebookOperationManager(this._undoService, uri);
	}

	get isDirty() {
		return this._dirty;
	}

	setDirty(newState: boolean) {
		if (this._dirty !== newState) {
			this._dirty = newState;
			this._onDidChangeDirty.fire();
		}
	}

	createCellTextModel(
		source: string | string[],
		language: string,
		cellKind: CellKind,
		outputs: IProcessedOutput[],
		metadata: NotebookCellMetadata | undefined
	) {
		const cellHandle = this._cellhandlePool++;
		const cellUri = CellUri.generate(this.uri, cellHandle);
		return new NotebookCellTextModel(cellUri, cellHandle, source, language, cellKind, outputs || [], metadata, this._modelService);
	}

	initialize(cells: ICellDto2[]) {
		this.cells = [];
		this._versionId = 0;

		const mainCells = cells.map(cell => {
			const cellHandle = this._cellhandlePool++;
			const cellUri = CellUri.generate(this.uri, cellHandle);
			return new NotebookCellTextModel(cellUri, cellHandle, cell.source, cell.language, cell.cellKind, cell.outputs || [], cell.metadata, this._modelService);
		});

		this._isUntitled = false;

		for (let i = 0; i < mainCells.length; i++) {
			this._mapping.set(mainCells[i].handle, mainCells[i]);
			let dirtyStateListener = mainCells[i].onDidChangeContent(() => {
				this.setDirty(true);
				this._onDidChangeContent.fire();
			});

			this._cellListeners.set(mainCells[i].handle, dirtyStateListener);
		}

		this.cells.splice(0, 0, ...mainCells);
		this._increaseVersionId();
	}

	pushStackElement(label: string) {
		this._operationManager.pushStackElement(label);
	}

	$applyEdit(modelVersionId: number, rawEdits: ICellEditOperation[], synchronous: boolean): boolean {
		if (modelVersionId !== this._versionId) {
			return false;
		}

		const oldViewCells = this.cells.slice(0);
		const oldMap = new Map(this._mapping);

		let operations: ({ sortIndex: number; start: number; end: number; } & ICellEditOperation)[] = [];
		for (let i = 0; i < rawEdits.length; i++) {
			if (rawEdits[i].editType === CellEditType.Insert) {
				const edit = rawEdits[i] as ICellInsertEdit;
				operations.push({
					sortIndex: i,
					start: edit.index,
					end: edit.index,
					...edit
				});
			} else {
				const edit = rawEdits[i] as ICellDeleteEdit;
				operations.push({
					sortIndex: i,
					start: edit.index,
					end: edit.index + edit.count,
					...edit
				});
			}
		}

		// const edits
		operations = operations.sort((a, b) => {
			let r = compareRangesUsingEnds([a.start, a.end], [b.start, b.end]);
			if (r === 0) {
				return b.sortIndex - a.sortIndex;
			}
			return -r;
		});

		for (let i = 0; i < operations.length; i++) {
			switch (operations[i].editType) {
				case CellEditType.Insert:
					const insertEdit = operations[i] as ICellInsertEdit;
					const mainCells = insertEdit.cells.map(cell => {
						const cellHandle = this._cellhandlePool++;
						const cellUri = CellUri.generate(this.uri, cellHandle);
						return new NotebookCellTextModel(cellUri, cellHandle, cell.source, cell.language, cell.cellKind, cell.outputs || [], cell.metadata, this._modelService);
					});
					this.insertNewCell(insertEdit.index, mainCells, false);
					break;
				case CellEditType.Delete:
					this.removeCell(operations[i].index, operations[i].end - operations[i].start, false);
					break;
			}
		}

		const diffs = diff(oldViewCells, this.cells, cell => {
			return oldMap.has(cell.handle);
		}).map(diff => {
			return [diff.start, diff.deleteCount, diff.toInsert] as [number, number, NotebookCellTextModel[]];
		});

		this._onDidModelChangeProxy.fire({
			kind: NotebookCellsChangeType.ModelChange,
			versionId: this._versionId,
			changes: diffs.map(diff => [diff[0], diff[1], diff[2].map(cell => ({
				handle: cell.handle,
				uri: cell.uri,
				source: cell.textBuffer.getLinesContent(),
				eol: cell.textBuffer.getEOL(),
				language: cell.language,
				cellKind: cell.cellKind,
				outputs: cell.outputs,
				metadata: cell.metadata
			}))] as [number, number, IMainCellDto[]])
		});

		const undoDiff = diffs.map(diff => {
			const deletedCells = this.cells.slice(diff[0], diff[0] + diff[1]);

			return [diff[0], deletedCells, diff[2]] as [number, NotebookCellTextModel[], NotebookCellTextModel[]];
		});

		this._operationManager.pushEditOperation(new SpliceCellsEdit(this.uri, undoDiff, {
			insertCell: this._insertCellDelegate.bind(this),
			deleteCell: this._deleteCellDelegate.bind(this),
			emitSelections: this._emitSelectionsDelegate.bind(this)
		}, undefined, undefined));

		this._onDidChangeCells.fire({ synchronous: synchronous, splices: diffs });
		return true;
	}

	$handleEdit(label: string | undefined, undo: () => void, redo: () => void): void {
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
		});
		this.setDirty(true);
	}

	createSnapshot(preserveBOM?: boolean): ITextSnapshot {
		return new NotebookTextModelSnapshot(this);
	}

	private _increaseVersionId(): void {
		this._versionId = this._versionId + 1;
	}

	handleUnknownChange() {
		this.setDirty(true);
	}

	updateLanguages(languages: string[]) {
		this.languages = languages;

		// TODO@rebornix metadata: default language for cell
		if (this._isUntitled && languages.length && this.cells.length) {
			this.cells[0].language = languages[0];
		}
	}

	updateNotebookMetadata(metadata: NotebookDocumentMetadata) {
		this.metadata = metadata;
		this._onDidChangeMetadata.fire(this.metadata);
	}

	updateNotebookCellMetadata(handle: number, metadata: NotebookCellMetadata) {
		const cell = this.cells.find(cell => cell.handle === handle);

		if (cell) {
			cell.metadata = metadata;
		}
	}

	updateRenderers(renderers: string[]) {
		renderers.forEach(render => {
			this.renderers.add(render);
		});
	}

	insertTemplateCell(cell: NotebookCellTextModel) {
		if (this.cells.length > 0 || this._isUntitled !== undefined) {
			return;
		}

		this._isUntitled = true;
		this.cells = [cell];
		this._mapping.set(cell.handle, cell);

		let dirtyStateListener = cell.onDidChangeContent(() => {
			this._isUntitled = false;
			this.setDirty(true);
			this._onDidChangeContent.fire();
		});

		this._cellListeners.set(cell.handle, dirtyStateListener);
		this.setDirty(false);
		this._onDidChangeContent.fire();

		this._onDidModelChangeProxy.fire({
			kind: NotebookCellsChangeType.ModelChange,
			versionId: this._versionId, changes:
				[[
					0,
					0,
					[{
						handle: cell.handle,
						uri: cell.uri,
						source: cell.textBuffer.getLinesContent(),
						eol: cell.textBuffer.getEOL(),
						language: cell.language,
						cellKind: cell.cellKind,
						outputs: cell.outputs,
						metadata: cell.metadata
					}]
				]]
		});

		return;
	}

	insertNewCell(index: number, cells: NotebookCellTextModel[], emitToExtHost: boolean = true): void {
		this._isUntitled = false;

		for (let i = 0; i < cells.length; i++) {
			this._mapping.set(cells[i].handle, cells[i]);
			let dirtyStateListener = cells[i].onDidChangeContent(() => {
				this.setDirty(true);
				this._onDidChangeContent.fire();
			});

			this._cellListeners.set(cells[i].handle, dirtyStateListener);
		}

		this.cells.splice(index, 0, ...cells);
		this.setDirty(true);
		this._onDidChangeContent.fire();

		this._increaseVersionId();

		if (emitToExtHost) {
			this._onDidModelChangeProxy.fire({
				kind: NotebookCellsChangeType.ModelChange,
				versionId: this._versionId, changes:
					[[
						index,
						0,
						cells.map(cell => ({
							handle: cell.handle,
							uri: cell.uri,
							source: cell.textBuffer.getLinesContent(),
							eol: cell.textBuffer.getEOL(),
							language: cell.language,
							cellKind: cell.cellKind,
							outputs: cell.outputs,
							metadata: cell.metadata
						}))
					]]
			});
		}

		return;
	}

	removeCell(index: number, count: number, emitToExtHost: boolean = true) {
		this._isUntitled = false;

		for (let i = index; i < index + count; i++) {
			let cell = this.cells[i];
			this._cellListeners.get(cell.handle)?.dispose();
			this._cellListeners.delete(cell.handle);
		}
		this.cells.splice(index, count);
		this.setDirty(true);
		this._onDidChangeContent.fire();

		this._increaseVersionId();
		if (emitToExtHost) {
			this._onDidModelChangeProxy.fire({ kind: NotebookCellsChangeType.ModelChange, versionId: this._versionId, changes: [[index, count, []]] });
		}
	}

	moveCellToIdx(index: number, newIdx: number, emitToExtHost: boolean = true) {
		this.assertIndex(index);
		this.assertIndex(newIdx);

		const cells = this.cells.splice(index, 1);
		this.cells.splice(newIdx, 0, ...cells);
		this.setDirty(true);
		this._onDidChangeContent.fire();

		this._increaseVersionId();

		if (emitToExtHost) {
			this._onDidModelChangeProxy.fire({ kind: NotebookCellsChangeType.Move, versionId: this._versionId, index, newIdx });
		}
	}

	assertIndex(index: number) {
		if (index < 0 || index >= this.cells.length) {
			throw new Error(`model index out of range ${index}`);
		}
	}

	// TODO@rebornix should this trigger content change event?
	$spliceNotebookCellOutputs(cellHandle: number, splices: NotebookCellOutputsSplice[]): void {
		let cell = this._mapping.get(cellHandle);
		cell?.spliceNotebookCellOutputs(splices);
	}

	clearCellOutput(handle: number) {
		let cell = this._mapping.get(handle);
		if (cell) {
			cell.spliceNotebookCellOutputs([
				[0, cell.outputs.length, []]
			]);

			this._increaseVersionId();
			this._onDidModelChangeProxy.fire({ kind: NotebookCellsChangeType.CellClearOutput, versionId: this._versionId, index: this.cells.indexOf(cell) });
		}
	}

	changeCellLanguage(handle: number, languageId: string) {
		let cell = this._mapping.get(handle);
		if (cell && cell.language !== languageId) {
			cell.language = languageId;

			this._increaseVersionId();
			this._onDidModelChangeProxy.fire({ kind: NotebookCellsChangeType.ChangeLanguage, versionId: this._versionId, index: this.cells.indexOf(cell), language: languageId });
		}
	}

	clearAllCellOutputs() {
		this.cells.forEach(cell => {
			cell.spliceNotebookCellOutputs([
				[0, cell.outputs.length, []]
			]);
		});
		this._increaseVersionId();
		this._onDidModelChangeProxy.fire({ kind: NotebookCellsChangeType.CellsClearOutput, versionId: this._versionId });
	}

	//#region Notebook Text Model Edit API

	private _insertCellDelegate(insertIndex: number, insertCell: NotebookCellTextModel) {
		this.insertNewCell(insertIndex, [insertCell]);
		this._onDidChangeCells.fire({ synchronous: true, splices: [[insertIndex, 0, [insertCell]]] });
	}

	private _deleteCellDelegate(deleteIndex: number) {
		this.removeCell(deleteIndex, 1);
		this._onDidChangeCells.fire({ synchronous: true, splices: [[deleteIndex, 1, []]] });
	}

	private _emitSelectionsDelegate(selections: number[]) {
		this._emitSelections.fire(selections);
	}

	createCell2(index: number, source: string | string[], language: string, type: CellKind, metadata: NotebookCellMetadata | undefined, synchronous: boolean, pushUndoStop: boolean, beforeSelections: number[] | undefined, endSelections: number[] | undefined) {
		const cell = this.createCellTextModel(source, language, type, [], metadata);

		if (pushUndoStop) {
			this._operationManager.pushEditOperation(new InsertCellEdit(this.uri, index, cell, {
				insertCell: this._insertCellDelegate.bind(this),
				deleteCell: this._deleteCellDelegate.bind(this),
				emitSelections: this._emitSelectionsDelegate.bind(this)
			}, beforeSelections, endSelections));
		}


		this.insertNewCell(index, [cell]);

		this._onDidChangeCells.fire({ synchronous, splices: [[index, 0, [cell]]] });

		if (endSelections) {
			this._emitSelections.fire(endSelections);
		}
		return cell;
	}

	insertCell2(index: number, cell: NotebookCellTextModel, synchronous: boolean, pushUndoStop: boolean): void {
		if (pushUndoStop) {
			this._operationManager.pushEditOperation(new InsertCellEdit(this.uri, index, cell, {
				insertCell: this._insertCellDelegate.bind(this),
				deleteCell: this._deleteCellDelegate.bind(this),
				emitSelections: this._emitSelectionsDelegate.bind(this)
			}, undefined, undefined));
		}

		this.insertNewCell(index, [cell]);
		this._onDidChangeCells.fire({ synchronous: synchronous, splices: [[index, 0, [cell]]] });
	}

	deleteCell2(index: number, synchronous: boolean, pushUndoStop: boolean, beforeSelections: number[] | undefined, endSelections: number[] | undefined) {
		const cell = this.cells[index];
		if (pushUndoStop) {
			this._operationManager.pushEditOperation(new DeleteCellEdit(this.uri, index, cell, {
				insertCell: this._insertCellDelegate.bind(this),
				deleteCell: this._deleteCellDelegate.bind(this),
				emitSelections: this._emitSelectionsDelegate.bind(this)
			}, beforeSelections, endSelections));
		}

		this.removeCell(index, 1);
		this._onDidChangeCells.fire({ synchronous: synchronous, splices: [[index, 1, []]] });
		if (endSelections) {
			this._emitSelections.fire(endSelections);
		}
	}

	moveCellToIdx2(index: number, newIdx: number, synchronous: boolean, pushedToUndoStack: boolean, beforeSelections: number[] | undefined, endSelections: number[] | undefined): boolean {
		const cell = this.cells[index];
		if (pushedToUndoStack) {
			this._operationManager.pushEditOperation(new MoveCellEdit(this.uri, index, newIdx, {
				moveCell: (fromIndex: number, toIndex: number, beforeSelections: number[] | undefined, endSelections: number[] | undefined) => {
					this.moveCellToIdx2(fromIndex, toIndex, true, false, beforeSelections, endSelections);
				},
				emitSelections: this._emitSelectionsDelegate.bind(this)
			}, beforeSelections, endSelections));
		}

		this.moveCellToIdx(index, newIdx);
		// todo, we can't emit this change as it will create a new view model and that will hold
		// a new reference to the document, thus
		this._onDidChangeCells.fire({ synchronous: synchronous, splices: [[index, 1, []]] });
		this._onDidChangeCells.fire({ synchronous: synchronous, splices: [[newIdx, 0, [cell]]] });
		if (endSelections) {
			this._emitSelections.fire(endSelections);
		}

		return true;
	}

	async splitNotebookCell(index: number, newLinesContents: string[], endSelections: number[]) {
		const cell = this.cells[index];

		const ref = await cell.resolveTextModelRef();
		const textModel = ref.object.textEditorModel;

		textModel.applyEdits([
			{ range: textModel.getFullModelRange(), text: newLinesContents[0] }
		], false);

		ref.dispose();

		// create new cells based on the new text models
		const language = cell.language;
		const kind = cell.cellKind;
		let insertIndex = index + 1;
		const newCells = [];
		for (let j = 1; j < newLinesContents.length; j++, insertIndex++) {
			newCells.push(this.createCell2(insertIndex, newLinesContents[j], language, kind, undefined, true, false, undefined, undefined));
		}

		if (endSelections) {
			this._emitSelections.fire(endSelections);
		}
	}
	//#endregion

	dispose() {
		this._onWillDispose.fire();
		this._cellListeners.forEach(val => val.dispose());
		this.cells.forEach(cell => cell.dispose());
		super.dispose();
	}
}
