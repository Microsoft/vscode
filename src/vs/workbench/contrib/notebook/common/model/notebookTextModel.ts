/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { INotebookTextModel, NotebookCellOutputsSplice, NotebookCellTextModelSplice, NotebookDocumentMetadata, NotebookCellMetadata, ICellEditOperation, CellEditType, CellUri, ICellInsertEdit, NotebookCellsChangedEvent, CellKind, IOutput, notebookDocumentMetadataDefaults, diff, ICellDeleteEdit, NotebookCellsChangeType, ICellDto2 } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { ITextSnapshot } from 'vs/editor/common/model';

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
				language: cell.language
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

export class NotebookTextModel extends Disposable implements INotebookTextModel {
	private static _cellhandlePool: number = 0;

	private readonly _onWillDispose: Emitter<void> = this._register(new Emitter<void>());
	readonly onWillDispose: Event<void> = this._onWillDispose.event;
	private readonly _onDidChangeCells = new Emitter<NotebookCellTextModelSplice[]>();
	get onDidChangeCells(): Event<NotebookCellTextModelSplice[]> { return this._onDidChangeCells.event; }
	private _onDidModelChangeProxy = new Emitter<NotebookCellsChangedEvent>();
	get onDidModelChange(): Event<NotebookCellsChangedEvent> { return this._onDidModelChangeProxy.event; }
	private _onDidSelectionChangeProxy = new Emitter<number[] | null>();
	get onDidSelectionChange(): Event<number[] | null> { return this._onDidSelectionChangeProxy.event; }
	private _onDidChangeContent = new Emitter<void>();
	onDidChangeContent: Event<void> = this._onDidChangeContent.event;
	private _onDidChangeMetadata = new Emitter<NotebookDocumentMetadata>();
	onDidChangeMetadata: Event<NotebookDocumentMetadata> = this._onDidChangeMetadata.event;
	private _mapping: Map<number, NotebookCellTextModel> = new Map();
	private _cellListeners: Map<number, IDisposable> = new Map();
	cells: NotebookCellTextModel[];
	languages: string[] = [];
	metadata: NotebookDocumentMetadata = notebookDocumentMetadataDefaults;
	renderers = new Set<number>();
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

	constructor(
		public handle: number,
		public viewType: string,
		public uri: URI
	) {
		super();
		this.cells = [];
	}

	createCellTextModel(
		source: string | string[],
		language: string,
		cellKind: CellKind,
		outputs: IOutput[],
		metadata: NotebookCellMetadata | undefined
	) {
		const cellHandle = NotebookTextModel._cellhandlePool++;
		const cellUri = CellUri.generate(this.uri, cellHandle);
		return new NotebookCellTextModel(cellUri, cellHandle, source, language, cellKind, outputs || [], metadata);
	}

	initialize(cells: ICellDto2[]) {
		this.cells = [];
		this._versionId = 0;

		const mainCells = cells.map(cell => {
			const cellHandle = NotebookTextModel._cellhandlePool++;
			const cellUri = CellUri.generate(this.uri, cellHandle);
			return new NotebookCellTextModel(cellUri, cellHandle, cell.source, cell.language, cell.cellKind, cell.outputs || [], cell.metadata);
		});
		this.insertNewCell(0, mainCells);
	}

	applyEdit(modelVersionId: number, rawEdits: ICellEditOperation[]): boolean {
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
						const cellHandle = NotebookTextModel._cellhandlePool++;
						const cellUri = CellUri.generate(this.uri, cellHandle);
						return new NotebookCellTextModel(cellUri, cellHandle, cell.source, cell.language, cell.cellKind, cell.outputs || [], cell.metadata);
					});
					this.insertNewCell(insertEdit.index, mainCells);
					break;
				case CellEditType.Delete:
					this.removeCell(operations[i].index, operations[i].end - operations[i].start);
					break;
			}
		}

		const diffs = diff(oldViewCells, this.cells, cell => {
			return oldMap.has(cell.handle);
		}).map(diff => {
			return [diff.start, diff.deleteCount, diff.toInsert] as [number, number, NotebookCellTextModel[]];
		});

		this._onDidChangeCells.fire(diffs);
		return true;
	}

	createSnapshot(preserveBOM?: boolean): ITextSnapshot {
		return new NotebookTextModelSnapshot(this);
	}

	private _increaseVersionId(): void {
		this._versionId = this._versionId + 1;
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

	updateRenderers(renderers: number[]) {
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

		let dirtyStateListener = Event.any(cell.onDidChangeContent, cell.onDidChangeOutputs)(() => {
			this._isUntitled = false;
			this._onDidChangeContent.fire();
		});

		this._cellListeners.set(cell.handle, dirtyStateListener);
		this._onDidChangeContent.fire();

		this._onDidModelChangeProxy.fire({
			kind: NotebookCellsChangeType.ModelChange,
			versionId: this._versionId, changes: [
				[
					0,
					0,
					[{
						handle: cell.handle,
						uri: cell.uri,
						source: cell.textBuffer.getLinesContent(),
						language: cell.language,
						cellKind: cell.cellKind,
						outputs: cell.outputs,
						metadata: cell.metadata
					}]
				]
			]
		});

		return;
	}

	insertNewCell(index: number, cells: NotebookCellTextModel[]): void {
		this._isUntitled = false;

		for (let i = 0; i < cells.length; i++) {
			this._mapping.set(cells[i].handle, cells[i]);
			let dirtyStateListener = Event.any(cells[i].onDidChangeContent, cells[i].onDidChangeOutputs)(() => {
				this._onDidChangeContent.fire();
			});

			this._cellListeners.set(cells[i].handle, dirtyStateListener);
		}

		this.cells.splice(index, 0, ...cells);
		this._onDidChangeContent.fire();
		this._increaseVersionId();
		this._onDidModelChangeProxy.fire({
			kind: NotebookCellsChangeType.ModelChange,
			versionId: this._versionId, changes: [
				[
					index,
					0,
					cells.map(cell => ({
						handle: cell.handle,
						uri: cell.uri,
						source: cell.textBuffer.getLinesContent(),
						language: cell.language,
						cellKind: cell.cellKind,
						outputs: cell.outputs,
						metadata: cell.metadata
					}))
				]
			]
		});

		return;
	}

	removeCell(index: number, count: number) {
		this._isUntitled = false;

		for (let i = index; i < index + count; i++) {
			let cell = this.cells[i];
			this._cellListeners.get(cell.handle)?.dispose();
			this._cellListeners.delete(cell.handle);
		}
		this.cells.splice(index, count);
		this._onDidChangeContent.fire();

		this._increaseVersionId();
		this._onDidModelChangeProxy.fire({ kind: NotebookCellsChangeType.ModelChange, versionId: this._versionId, changes: [[index, count, []]] });
	}

	moveCellToIdx(index: number, newIdx: number) {
		this.assertIndex(index);
		this.assertIndex(newIdx);

		const cells = this.cells.splice(index, 1);
		this.cells.splice(newIdx, 0, ...cells);

		this._increaseVersionId();
		this._onDidModelChangeProxy.fire({ kind: NotebookCellsChangeType.Move, versionId: this._versionId, index, newIdx });
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
		if (cell) {
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

	dispose() {
		this._onWillDispose.fire();
		this._cellListeners.forEach(val => val.dispose());
		super.dispose();
	}
}
