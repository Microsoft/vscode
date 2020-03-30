/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { NotebookCellTextModel } from 'vs/workbench/services/notebook/common/model/notebookCellTextModel';
import { INotebookTextModel, NotebookCellOutputsSplice, NotebookCellsSplice, NotebookDocumentMetadata, NotebookCellMetadata, ICellEditOperation, CellEditType, CellUri, ICellInsertEdit, NotebookCellsChangedEvent, CellKind, IOutput } from 'vs/workbench/services/notebook/common/notebookCommon';

export class NotebookTextModel extends Disposable implements INotebookTextModel {
	private static _cellhandlePool: number = 0;

	private readonly _onWillDispose: Emitter<void> = this._register(new Emitter<void>());
	readonly onWillDispose: Event<void> = this._onWillDispose.event;
	private readonly _onDidChangeCells = new Emitter<NotebookCellsSplice[]>();
	get onDidChangeCells(): Event<NotebookCellsSplice[]> { return this._onDidChangeCells.event; }
	private _onDidModelChange = new Emitter<NotebookCellsChangedEvent>();
	get onDidModelChange(): Event<NotebookCellsChangedEvent> { return this._onDidModelChange.event; }
	private _onDidChangeContent = new Emitter<void>();
	onDidChangeContent: Event<void> = this._onDidChangeContent.event;
	private _onDidChangeMetadata = new Emitter<NotebookDocumentMetadata>();
	onDidChangeMetadata: Event<NotebookDocumentMetadata> = this._onDidChangeMetadata.event;
	private _mapping: Map<number, NotebookCellTextModel> = new Map();
	private _cellListeners: Map<number, IDisposable> = new Map();
	cells: NotebookCellTextModel[];
	languages: string[] = [];
	metadata: NotebookDocumentMetadata | undefined = { editable: true };
	renderers = new Set<number>();
	private _isUntitled: boolean | undefined = undefined;
	private _versionId = 0;

	constructor(
		public handle: number,
		public viewType: string,
		public uri: URI
	) {
		super();
		this.cells = [];
	}

	createCellTextModel(
		source: string[],
		language: string,
		cellKind: CellKind,
		outputs: IOutput[],
		metadata: NotebookCellMetadata | undefined
	) {
		const cellHandle = NotebookTextModel._cellhandlePool++;
		const cellUri = CellUri.generate(this.uri, this.viewType, cellHandle);
		return new NotebookCellTextModel(URI.revive(cellUri), cellHandle, source, language, cellKind, outputs || [], metadata);
	}

	applyEdit(modelVersionId: number, edits: ICellEditOperation[]): boolean {
		if (modelVersionId !== this._versionId) {
			return false;
		}

		for (let i = 0; i < edits.length; i++) {
			switch (edits[i].editType) {
				case CellEditType.Insert:
					const insertEdit = edits[i] as ICellInsertEdit;
					const mainCells = insertEdit.cells.map(cell => {
						const cellHandle = NotebookTextModel._cellhandlePool++;
						const cellUri = CellUri.generate(this.uri, this.viewType, cellHandle);
						return new NotebookCellTextModel(URI.revive(cellUri), cellHandle, cell.source, cell.language, cell.cellKind, cell.outputs || [], cell.metadata);
					});
					this.insertNewCell(insertEdit.index, mainCells);
					break;
				case CellEditType.Delete:
					this.removeCell(edits[i].index);
					break;
			}
		}

		return true;
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

		let dirtyStateListener = cell.onDidChangeContent(() => {
			this._isUntitled = false;
			this._onDidChangeContent.fire();
		});

		this._cellListeners.set(cell.handle, dirtyStateListener);
		this._onDidChangeContent.fire();

		this._onDidModelChange.fire({
			versionId: this._versionId, changes: [
				[
					0,
					0,
					[{
						handle: cell.handle,
						uri: cell.uri,
						source: cell.source,
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
			let dirtyStateListener = cells[i].onDidChangeContent(() => {
				this._onDidChangeContent.fire();
			});

			this._cellListeners.set(cells[i].handle, dirtyStateListener);
		}

		this.cells.splice(index, 0, ...cells);
		this._onDidChangeContent.fire();
		this._increaseVersionId();
		this._onDidModelChange.fire({
			versionId: this._versionId, changes: [
				[
					index,
					0,
					cells.map(cell => ({
						handle: cell.handle,
						uri: cell.uri,
						source: cell.source,
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

	removeCell(index: number) {
		this._isUntitled = false;

		let cell = this.cells[index];
		this._cellListeners.get(cell.handle)?.dispose();
		this._cellListeners.delete(cell.handle);
		this.cells.splice(index, 1);
		this._onDidChangeContent.fire();

		this._increaseVersionId();
		this._onDidModelChange.fire({ versionId: this._versionId, changes: [[index, 1, []]] });
	}

	// TODO@rebornix should this trigger content change event?
	$spliceNotebookCellOutputs(cellHandle: number, splices: NotebookCellOutputsSplice[]): void {
		let cell = this._mapping.get(cellHandle);
		cell?.spliceNotebookCellOutputs(splices);
	}

	dispose() {
		this._onWillDispose.fire();
		this._cellListeners.forEach(val => val.dispose());
		super.dispose();
	}
}
