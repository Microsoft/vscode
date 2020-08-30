/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { readonly } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { hash } from 'vs/base/common/hash';
import { Disposable, DisposableStore, dispose, IDisposable } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { joinPath } from 'vs/base/common/resources';
import { ISplice } from 'vs/base/common/sequence';
import { URI, UriComponents } from 'vs/base/common/uri';
import * as UUID from 'vs/base/common/uuid';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { CellKind, ExtHostNotebookShape, ICommandDto, IMainContext, IModelAddedData, INotebookDocumentPropertiesChangeData, INotebookDocumentsAndEditorsDelta, INotebookEditorPropertiesChangeData, MainContext, MainThreadNotebookShape, NotebookCellOutputsSplice } from 'vs/workbench/api/common/extHost.protocol';
import { ILogService } from 'vs/platform/log/common/log';
import { CommandsConverter, ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { ExtHostDocumentsAndEditors, IExtHostModelAddedData } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { IExtensionStoragePaths } from 'vs/workbench/api/common/extHostStoragePaths';
import * as typeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import { asWebviewUri, WebviewInitData } from 'vs/workbench/api/common/shared/webview';
import { addIdToOutput, CellEditType, CellOutputKind, CellStatusbarAlignment, CellUri, diff, ICellEditOperation, ICellReplaceEdit, IMainCellDto, INotebookCellStatusBarEntry, INotebookDisplayOrder, INotebookEditData, INotebookKernelInfoDto2, IProcessedOutput, NotebookCellMetadata, NotebookCellsChangedEvent, NotebookCellsChangeType, NotebookCellsSplice2, NotebookDataDto, notebookDocumentMetadataDefaults } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import * as vscode from 'vscode';
import { Cache } from './cache';
import { ResourceMap } from 'vs/base/common/map';

interface IObservable<T> {
	proxy: T;
	onDidChange: Event<void>;
}

function getObservable<T extends Object>(obj: T): IObservable<T> {
	const onDidChange = new Emitter<void>();
	const proxy = new Proxy(obj, {
		set(target: T, p: PropertyKey, value: any, _receiver: any): boolean {
			target[p as keyof T] = value;
			onDidChange.fire();
			return true;
		}
	});

	return {
		proxy,
		onDidChange: onDidChange.event
	};
}

interface INotebookEventEmitter {
	emitModelChange(events: vscode.NotebookCellsChangeEvent): void;
	emitCellOutputsChange(event: vscode.NotebookCellOutputsChangeEvent): void;
	emitCellLanguageChange(event: vscode.NotebookCellLanguageChangeEvent): void;
	emitCellMetadataChange(event: vscode.NotebookCellMetadataChangeEvent): void;
}

export class ExtHostCell extends Disposable {

	public static asModelAddData(notebook: vscode.NotebookDocument, cell: IMainCellDto): IExtHostModelAddedData {
		return {
			EOL: cell.eol,
			lines: cell.source,
			modeId: cell.language,
			uri: cell.uri,
			isDirty: false,
			versionId: 1,
			notebook
		};
	}

	private _onDidDispose = new Emitter<void>();
	readonly onDidDispose: Event<void> = this._onDidDispose.event;

	private _onDidChangeOutputs = new Emitter<ISplice<IProcessedOutput>[]>();
	readonly onDidChangeOutputs: Event<ISplice<IProcessedOutput>[]> = this._onDidChangeOutputs.event;

	private _outputs: any[];
	private _outputMapping = new WeakMap<vscode.CellOutput, string | undefined /* output ID */>();

	private _metadata: vscode.NotebookCellMetadata;
	private _metadataChangeListener: IDisposable;

	readonly handle: number;
	readonly uri: URI;
	readonly cellKind: CellKind;

	private _cell: vscode.NotebookCell | undefined;

	constructor(
		private readonly _proxy: MainThreadNotebookShape,
		private readonly _notebook: ExtHostNotebookDocument,
		private readonly _extHostDocument: ExtHostDocumentsAndEditors,
		private readonly _cellData: IMainCellDto,
	) {
		super();

		this.handle = _cellData.handle;
		this.uri = URI.revive(_cellData.uri);
		this.cellKind = _cellData.cellKind;

		this._outputs = _cellData.outputs;
		for (const output of this._outputs) {
			this._outputMapping.set(output, output.outputId);
			delete output.outputId;
		}

		const observableMetadata = getObservable(_cellData.metadata ?? {});
		this._metadata = observableMetadata.proxy;
		this._metadataChangeListener = this._register(observableMetadata.onDidChange(() => {
			this._updateMetadata();
		}));
	}

	get cell(): vscode.NotebookCell {
		if (!this._cell) {
			const that = this;
			const document = this._extHostDocument.getDocument(this.uri)!.document;
			this._cell = Object.freeze({
				notebook: that._notebook.notebookDocument,
				uri: that.uri,
				cellKind: this._cellData.cellKind,
				document,
				language: document.languageId,
				get outputs() { return that._outputs; },
				set outputs(value) { that._updateOutputs(value); },
				get metadata() { return that._metadata; },
				set metadata(value) {
					that.setMetadata(value);
					that._updateMetadata();
				},
			});
		}
		return this._cell;
	}

	dispose() {
		super.dispose();
		this._onDidDispose.fire();
	}

	setOutputs(newOutputs: vscode.CellOutput[]): void {
		this._outputs = newOutputs;
	}

	private _updateOutputs(newOutputs: vscode.CellOutput[]) {
		const rawDiffs = diff<vscode.CellOutput>(this._outputs || [], newOutputs || [], (a) => {
			return this._outputMapping.has(a);
		});

		const transformedDiffs: ISplice<IProcessedOutput>[] = rawDiffs.map(diff => {
			for (let i = diff.start; i < diff.start + diff.deleteCount; i++) {
				this._outputMapping.delete(this._outputs[i]);
			}

			return {
				deleteCount: diff.deleteCount,
				start: diff.start,
				toInsert: diff.toInsert.map((output): IProcessedOutput => {
					if (output.outputKind === CellOutputKind.Rich) {
						const uuid = UUID.generateUuid();
						this._outputMapping.set(output, uuid);
						return { ...output, outputId: uuid };
					}

					this._outputMapping.set(output, undefined);
					return output;
				})
			};
		});

		this._outputs = newOutputs;
		this._onDidChangeOutputs.fire(transformedDiffs);
	}

	setMetadata(newMetadata: vscode.NotebookCellMetadata): void {
		// Don't apply metadata defaults here, 'undefined' means 'inherit from document metadata'
		this._metadataChangeListener.dispose();
		const observableMetadata = getObservable(newMetadata);
		this._metadata = observableMetadata.proxy;
		this._metadataChangeListener = this._register(observableMetadata.onDidChange(() => {
			this._updateMetadata();
		}));
	}

	private _updateMetadata(): Promise<void> {
		return this._proxy.$updateNotebookCellMetadata(this._notebook.notebookDocument.viewType, this._notebook.uri, this.handle, this._metadata);
	}
}

class RawContentChangeEvent {

	constructor(readonly start: number, readonly deletedCount: number, readonly deletedItems: ExtHostCell[], readonly items: ExtHostCell[]) { }

	static asApiEvent(event: RawContentChangeEvent): vscode.NotebookCellsChangeData {
		return Object.freeze({
			start: event.start,
			deletedCount: event.deletedCount,
			deletedItems: event.deletedItems.map(data => data.cell),
			items: event.items.map(data => data.cell)
		});
	}
}

export class ExtHostNotebookDocument extends Disposable {

	private static _handlePool: number = 0;
	readonly handle = ExtHostNotebookDocument._handlePool++;

	private _cells: ExtHostCell[] = [];

	private _cellDisposableMapping = new Map<number, DisposableStore>();

	private _notebook: vscode.NotebookDocument | undefined;

	private _metadata: Required<vscode.NotebookDocumentMetadata> = notebookDocumentMetadataDefaults;
	private _metadataChangeListener: IDisposable;
	private _displayOrder: string[] = [];
	private _versionId = 0;
	private _isDirty: boolean = false;
	private _backupCounter = 1;
	private _backup?: vscode.NotebookDocumentBackup;
	private _disposed = false;
	private _languages: string[] = [];

	private readonly _edits = new Cache<vscode.NotebookDocumentEditEvent>('notebook documents');

	constructor(
		private readonly _proxy: MainThreadNotebookShape,
		private readonly _documentsAndEditors: ExtHostDocumentsAndEditors,
		private readonly _emitter: INotebookEventEmitter,
		private readonly _viewType: string,
		public readonly uri: URI,
		public readonly renderingHandler: ExtHostNotebookOutputRenderingHandler,
		private readonly _storagePath: URI | undefined
	) {
		super();

		const observableMetadata = getObservable(notebookDocumentMetadataDefaults);
		this._metadata = observableMetadata.proxy;
		this._metadataChangeListener = this._register(observableMetadata.onDidChange(() => {
			this._tryUpdateMetadata();
		}));
	}

	dispose() {
		this._disposed = true;
		super.dispose();
		dispose(this._cellDisposableMapping.values());
	}

	private _updateMetadata(newMetadata: Required<vscode.NotebookDocumentMetadata>) {
		this._metadataChangeListener.dispose();
		newMetadata = {
			...notebookDocumentMetadataDefaults,
			...newMetadata
		};
		if (this._metadataChangeListener) {
			this._metadataChangeListener.dispose();
		}

		const observableMetadata = getObservable(newMetadata);
		this._metadata = observableMetadata.proxy;
		this._metadataChangeListener = this._register(observableMetadata.onDidChange(() => {
			this._tryUpdateMetadata();
		}));

		this._tryUpdateMetadata();
	}

	private _tryUpdateMetadata() {
		this._proxy.$updateNotebookMetadata(this._viewType, this.uri, this._metadata);
	}
	get notebookDocument(): vscode.NotebookDocument {
		if (!this._notebook) {
			const that = this;
			this._notebook = Object.freeze({
				get uri() { return that.uri; },
				get version() { return that._versionId; },
				get fileName() { return that.uri.fsPath; },
				get viewType() { return that._viewType; },
				get isDirty() { return that._isDirty; },
				get isUntitled() { return that.uri.scheme === Schemas.untitled; },
				get cells(): ReadonlyArray<vscode.NotebookCell> { return that._cells.map(cell => cell.cell); },
				get languages() { return that._languages; },
				set languages(value: string[]) { that._trySetLanguages(value); },
				get displayOrder() { return that._displayOrder; },
				set displayOrder(value: string[]) { that._displayOrder = value; },
				get metadata() { return that._metadata; },
				set metadata(value: Required<vscode.NotebookDocumentMetadata>) { that._updateMetadata(value); },
			});
		}
		return this._notebook;
	}

	private _trySetLanguages(newLanguages: string[]) {
		this._languages = newLanguages;
		this._proxy.$updateNotebookLanguages(this._viewType, this.uri, this._languages);
	}

	getNewBackupUri(): URI {
		if (!this._storagePath) {
			throw new Error('Backup requires a valid storage path');
		}
		const fileName = hashPath(this.uri) + (this._backupCounter++);
		return joinPath(this._storagePath, fileName);
	}

	updateBackup(backup: vscode.NotebookDocumentBackup): void {
		this._backup?.delete();
		this._backup = backup;
	}

	disposeBackup(): void {
		this._backup?.delete();
		this._backup = undefined;
	}

	acceptModelChanged(event: NotebookCellsChangedEvent, isDirty: boolean): void {
		this._versionId = event.versionId;
		this._isDirty = isDirty;
		if (event.kind === NotebookCellsChangeType.Initialize) {
			this._spliceNotebookCells(event.changes, true);
		} if (event.kind === NotebookCellsChangeType.ModelChange) {
			this._spliceNotebookCells(event.changes, false);
		} else if (event.kind === NotebookCellsChangeType.Move) {
			this._moveCell(event.index, event.newIdx);
		} else if (event.kind === NotebookCellsChangeType.Output) {
			this._setCellOutputs(event.index, event.outputs);
		} else if (event.kind === NotebookCellsChangeType.CellClearOutput) {
			this._clearCellOutputs(event.index);
		} else if (event.kind === NotebookCellsChangeType.CellsClearOutput) {
			this._clearAllCellOutputs();
		} else if (event.kind === NotebookCellsChangeType.ChangeLanguage) {
			this._changeCellLanguage(event.index, event.language);
		} else if (event.kind === NotebookCellsChangeType.ChangeMetadata) {
			this._changeCellMetadata(event.index, event.metadata);
		}
	}

	private _spliceNotebookCells(splices: NotebookCellsSplice2[], initialization: boolean): void {
		if (this._disposed) {
			return;
		}

		const contentChangeEvents: RawContentChangeEvent[] = [];
		const addedCellDocuments: IExtHostModelAddedData[] = [];
		const removedCellDocuments: URI[] = [];

		splices.reverse().forEach(splice => {
			const cellDtos = splice[2];
			const newCells = cellDtos.map(cell => {

				const extCell = new ExtHostCell(this._proxy, this, this._documentsAndEditors, cell);

				if (!initialization) {
					addedCellDocuments.push(ExtHostCell.asModelAddData(this.notebookDocument, cell));
				}

				if (!this._cellDisposableMapping.has(extCell.handle)) {
					const store = new DisposableStore();
					store.add(extCell);
					this._cellDisposableMapping.set(extCell.handle, store);
				}

				const store = this._cellDisposableMapping.get(extCell.handle)!;

				store.add(extCell.onDidChangeOutputs((diffs) => {
					this.eventuallyUpdateCellOutputs(extCell, diffs);
				}));

				return extCell;
			});

			for (let j = splice[0]; j < splice[0] + splice[1]; j++) {
				this._cellDisposableMapping.get(this._cells[j].handle)?.dispose();
				this._cellDisposableMapping.delete(this._cells[j].handle);
			}

			const deletedItems = this._cells.splice(splice[0], splice[1], ...newCells);
			for (let cell of deletedItems) {
				removedCellDocuments.push(cell.uri);
			}

			contentChangeEvents.push(new RawContentChangeEvent(splice[0], splice[1], deletedItems, newCells));
		});

		this._documentsAndEditors.acceptDocumentsAndEditorsDelta({
			addedDocuments: addedCellDocuments,
			removedDocuments: removedCellDocuments
		});

		if (!initialization) {
			this._emitter.emitModelChange({
				document: this.notebookDocument,
				changes: contentChangeEvents.map(RawContentChangeEvent.asApiEvent)
			});
		}
	}

	private _moveCell(index: number, newIdx: number): void {
		const cells = this._cells.splice(index, 1);
		this._cells.splice(newIdx, 0, ...cells);
		const changes: vscode.NotebookCellsChangeData[] = [{
			start: index,
			deletedCount: 1,
			deletedItems: cells.map(data => data.cell),
			items: []
		}, {
			start: newIdx,
			deletedCount: 0,
			deletedItems: [],
			items: cells.map(data => data.cell)
		}];
		this._emitter.emitModelChange({
			document: this.notebookDocument,
			changes
		});
	}

	private _setCellOutputs(index: number, outputs: IProcessedOutput[]): void {
		const cell = this._cells[index];
		cell.setOutputs(outputs);
		this._emitter.emitCellOutputsChange({ document: this.notebookDocument, cells: [cell.cell] });
	}

	private _clearCellOutputs(index: number): void {
		const cell = this._cells[index].cell;
		cell.outputs = [];
		const event: vscode.NotebookCellOutputsChangeEvent = { document: this.notebookDocument, cells: [cell] };
		this._emitter.emitCellOutputsChange(event);
	}

	private _clearAllCellOutputs(): void {
		const modifedCells: vscode.NotebookCell[] = [];
		this._cells.forEach(({ cell }) => {
			if (cell.outputs.length !== 0) {
				cell.outputs = [];
				modifedCells.push(cell);
			}
		});
		const event: vscode.NotebookCellOutputsChangeEvent = { document: this.notebookDocument, cells: modifedCells };
		this._emitter.emitCellOutputsChange(event);
	}

	private _changeCellLanguage(index: number, language: string): void {
		const cell = this._cells[index];
		const event: vscode.NotebookCellLanguageChangeEvent = { document: this.notebookDocument, cell: cell.cell, language };
		this._emitter.emitCellLanguageChange(event);
	}

	private _changeCellMetadata(index: number, newMetadata: NotebookCellMetadata | undefined): void {
		const cell = this._cells[index];
		cell.setMetadata(newMetadata || {});
		const event: vscode.NotebookCellMetadataChangeEvent = { document: this.notebookDocument, cell: cell.cell };
		this._emitter.emitCellMetadataChange(event);
	}

	async eventuallyUpdateCellOutputs(cell: ExtHostCell, diffs: ISplice<IProcessedOutput>[]) {
		const outputDtos: NotebookCellOutputsSplice[] = diffs.map(diff => {
			const outputs = diff.toInsert;
			return [diff.start, diff.deleteCount, outputs];
		});

		if (!outputDtos.length) {
			return;
		}

		await this._proxy.$spliceNotebookCellOutputs(this._viewType, this.uri, cell.handle, outputDtos);
		this._emitter.emitCellOutputsChange({
			document: this.notebookDocument,
			cells: [cell.cell]
		});
	}

	getCell(cellHandle: number): ExtHostCell | undefined {
		return this._cells.find(cell => cell.handle === cellHandle);
	}


	addEdit(item: vscode.NotebookDocumentEditEvent): number {
		return this._edits.add([item]);
	}

	async undo(editId: number, isDirty: boolean): Promise<void> {
		await this.getEdit(editId).undo();
		// if (!isDirty) {
		// 	this.disposeBackup();
		// }
	}

	async redo(editId: number, isDirty: boolean): Promise<void> {
		await this.getEdit(editId).redo();
		// if (!isDirty) {
		// 	this.disposeBackup();
		// }
	}

	private getEdit(editId: number): vscode.NotebookDocumentEditEvent {
		const edit = this._edits.get(editId, 0);
		if (!edit) {
			throw new Error('No edit found');
		}

		return edit;
	}

	disposeEdits(editIds: number[]): void {
		for (const id of editIds) {
			this._edits.delete(id);
		}
	}
}

export class NotebookEditorCellEditBuilder implements vscode.NotebookEditorCellEdit {

	private readonly _documentVersionId: number;
	private readonly _collectedEdits: ICellEditOperation[] = [];
	private _finalized: boolean = false;

	constructor(documentVersionId: number) {
		this._documentVersionId = documentVersionId;
	}

	finalize(): INotebookEditData {
		this._finalized = true;
		return {
			documentVersionId: this._documentVersionId,
			edits: this._collectedEdits,
		};
	}

	private _throwIfFinalized() {
		if (this._finalized) {
			throw new Error('Edit is only valid while callback runs');
		}
	}

	replaceMetadata(index: number, metadata: vscode.NotebookCellMetadata): void {
		this._throwIfFinalized();
		this._collectedEdits.push({
			editType: CellEditType.Metadata,
			index,
			metadata
		});
	}

	replaceOutput(index: number, outputs: vscode.CellOutput[]): void {
		this._throwIfFinalized();
		this._collectedEdits.push({
			editType: CellEditType.Output,
			index,
			outputs: outputs.map(output => addIdToOutput(output))
		});
	}

	replaceCells(from: number, to: number, cells: vscode.NotebookCellData[]): void {
		this._throwIfFinalized();

		this._collectedEdits.push({
			editType: CellEditType.Replace,
			index: from,
			count: to - from,
			cells: cells.map(data => {
				return {
					...data,
					outputs: data.outputs.map(output => addIdToOutput(output)),
				};
			})
		});
	}

	insert(index: number, content: string | string[], language: string, type: CellKind, outputs: vscode.CellOutput[], metadata: vscode.NotebookCellMetadata | undefined): void {
		this._throwIfFinalized();
		this.replaceCells(index, index, [{
			language,
			outputs,
			metadata,
			cellKind: type,
			source: Array.isArray(content) ? content.join('\n') : content,
		}]);
	}

	delete(index: number): void {
		this._throwIfFinalized();
		this.replaceCells(index, 1, []);
	}
}

class ExtHostWebviewCommWrapper extends Disposable {
	private readonly _onDidReceiveDocumentMessage = new Emitter<any>();
	private readonly _rendererIdToEmitters = new Map<string, Emitter<any>>();

	constructor(
		private _editorId: string,
		public uri: URI,
		private _proxy: MainThreadNotebookShape,
		private _webviewInitData: WebviewInitData,
		public document: ExtHostNotebookDocument,
	) {
		super();
	}

	public onDidReceiveMessage(forRendererId: string | undefined, message: any) {
		this._onDidReceiveDocumentMessage.fire(message);
		if (forRendererId !== undefined) {
			this._rendererIdToEmitters.get(forRendererId)?.fire(message);
		}
	}

	public readonly contentProviderComm: vscode.NotebookCommunication = {
		editorId: this._editorId,
		onDidReceiveMessage: this._onDidReceiveDocumentMessage.event,
		postMessage: (message: any) => this._proxy.$postMessage(this._editorId, undefined, message),
		asWebviewUri: (uri: vscode.Uri) => this._asWebviewUri(uri),
	};

	public getRendererComm(rendererId: string): vscode.NotebookCommunication {
		const emitter = new Emitter<any>();
		this._rendererIdToEmitters.set(rendererId, emitter);
		return {
			editorId: this._editorId,
			onDidReceiveMessage: emitter.event,
			postMessage: (message: any) => this._proxy.$postMessage(this._editorId, rendererId, message),
			asWebviewUri: (uri: vscode.Uri) => this._asWebviewUri(uri),
		};
	}


	private _asWebviewUri(localResource: vscode.Uri): vscode.Uri {
		return asWebviewUri(this._webviewInitData, this._editorId, localResource);
	}
}

export class ExtHostNotebookEditor extends Disposable implements vscode.NotebookEditor {
	private _viewColumn: vscode.ViewColumn | undefined;

	selection?: vscode.NotebookCell;

	private _visibleRanges: vscode.NotebookCellRange[] = [];

	get visibleRanges() {
		return this._visibleRanges;
	}

	set visibleRanges(_range: vscode.NotebookCellRange[]) {
		throw readonly('visibleRanges');
	}

	_acceptVisibleRanges(value: vscode.NotebookCellRange[]): void {
		this._visibleRanges = value;
	}

	private _active: boolean = false;
	get active(): boolean {
		return this._active;
	}

	set active(_state: boolean) {
		throw readonly('active');
	}

	private _visible: boolean = false;
	get visible(): boolean {
		return this._visible;
	}

	set visible(_state: boolean) {
		throw readonly('visible');
	}

	_acceptVisibility(value: boolean) {
		this._visible = value;
	}

	_acceptActive(value: boolean) {
		this._active = value;
	}

	private _kernel?: vscode.NotebookKernel;

	get kernel() {
		return this._kernel;
	}

	set kernel(_kernel: vscode.NotebookKernel | undefined) {
		throw readonly('kernel');
	}

	private _onDidDispose = new Emitter<void>();
	readonly onDidDispose: Event<void> = this._onDidDispose.event;
	private _onDidReceiveMessage = new Emitter<any>();
	onDidReceiveMessage: vscode.Event<any> = this._onDidReceiveMessage.event;

	constructor(
		private readonly viewType: string,
		readonly id: string,
		public uri: URI,
		private _proxy: MainThreadNotebookShape,
		private _webComm: vscode.NotebookCommunication,
		public readonly notebookData: ExtHostNotebookDocument,
	) {
		super();
		this._register(this._webComm.onDidReceiveMessage(e => {
			this._onDidReceiveMessage.fire(e);
		}));
	}

	get document(): vscode.NotebookDocument {
		return this.notebookData.notebookDocument;
	}

	edit(callback: (editBuilder: NotebookEditorCellEditBuilder) => void): Thenable<boolean> {
		const edit = new NotebookEditorCellEditBuilder(this.document.version);
		callback(edit);
		return this._applyEdit(edit.finalize());
	}

	private _applyEdit(editData: INotebookEditData): Promise<boolean> {

		// return when there is nothing to do
		if (editData.edits.length === 0) {
			return Promise.resolve(true);
		}

		const compressedEdits: ICellEditOperation[] = [];
		let compressedEditsIndex = -1;

		for (let i = 0; i < editData.edits.length; i++) {
			if (compressedEditsIndex < 0) {
				compressedEdits.push(editData.edits[i]);
				compressedEditsIndex++;
				continue;
			}

			const prevIndex = compressedEditsIndex;
			const prev = compressedEdits[prevIndex];

			if (prev.editType === CellEditType.Replace && editData.edits[i].editType === CellEditType.Replace) {
				if (prev.index === editData.edits[i].index) {
					prev.cells.push(...(editData.edits[i] as ICellReplaceEdit).cells);
					prev.count += (editData.edits[i] as ICellReplaceEdit).count;
					continue;
				}
			}

			compressedEdits.push(editData.edits[i]);
			compressedEditsIndex++;
		}

		return this._proxy.$tryApplyEdits(this.viewType, this.uri, editData.documentVersionId, compressedEdits);
	}

	revealRange(range: vscode.NotebookCellRange, revealType?: extHostTypes.NotebookEditorRevealType) {
		this._proxy.$tryRevealRange(this.id, range, revealType || extHostTypes.NotebookEditorRevealType.Default);
	}

	get viewColumn(): vscode.ViewColumn | undefined {
		return this._viewColumn;
	}

	set viewColumn(value) {
		throw readonly('viewColumn');
	}

	updateActiveKernel(kernel?: vscode.NotebookKernel) {
		this._kernel = kernel;
	}
	async postMessage(message: any): Promise<boolean> {
		return this._webComm.postMessage(message);
	}

	asWebviewUri(localResource: vscode.Uri): vscode.Uri {
		return this._webComm.asWebviewUri(localResource);
	}
	dispose() {
		this._onDidDispose.fire();
		super.dispose();
	}
}

export interface ExtHostNotebookOutputRenderingHandler {
	outputDisplayOrder: INotebookDisplayOrder | undefined;
}

export class ExtHostNotebookKernelProviderAdapter extends Disposable {
	private _kernelToId = new Map<vscode.NotebookKernel, string>();
	private _idToKernel = new Map<string, vscode.NotebookKernel>();
	constructor(
		private readonly _proxy: MainThreadNotebookShape,
		private readonly _handle: number,
		private readonly _extension: IExtensionDescription,
		private readonly _provider: vscode.NotebookKernelProvider
	) {
		super();

		if (this._provider.onDidChangeKernels) {
			this._register(this._provider.onDidChangeKernels(() => {
				this._proxy.$onNotebookKernelChange(this._handle);
			}));
		}
	}

	async provideKernels(document: ExtHostNotebookDocument, token: vscode.CancellationToken): Promise<INotebookKernelInfoDto2[]> {
		const data = await this._provider.provideKernels(document.notebookDocument, token) || [];

		const newMap = new Map<vscode.NotebookKernel, string>();
		let kernel_unique_pool = 0;
		const kernelIdCache = new Set<string>();

		const transformedData: INotebookKernelInfoDto2[] = data.map(kernel => {
			let id = this._kernelToId.get(kernel);
			if (id === undefined) {
				if (kernel.id && kernelIdCache.has(kernel.id)) {
					id = `${this._extension.identifier.value}_${kernel.id}_${kernel_unique_pool++}`;
				} else {
					id = `${this._extension.identifier.value}_${kernel.id || UUID.generateUuid()}`;
				}

				this._kernelToId.set(kernel, id);
			}

			newMap.set(kernel, id);

			return {
				id,
				label: kernel.label,
				extension: this._extension.identifier,
				extensionLocation: this._extension.extensionLocation,
				description: kernel.description,
				isPreferred: kernel.isPreferred,
				preloads: kernel.preloads
			};
		});

		this._kernelToId = newMap;

		this._idToKernel.clear();
		this._kernelToId.forEach((value, key) => {
			this._idToKernel.set(value, key);
		});

		return transformedData;
	}

	getKernel(kernelId: string) {
		return this._idToKernel.get(kernelId);
	}

	async resolveNotebook(kernelId: string, document: ExtHostNotebookDocument, webview: vscode.NotebookCommunication, token: CancellationToken) {
		const kernel = this._idToKernel.get(kernelId);

		if (kernel && this._provider.resolveKernel) {
			return this._provider.resolveKernel(kernel, document.notebookDocument, webview, token);
		}
	}

	async executeNotebook(kernelId: string, document: ExtHostNotebookDocument, cell: ExtHostCell | undefined) {
		const kernel = this._idToKernel.get(kernelId);

		if (!kernel) {
			return;
		}

		if (cell) {
			return withToken(token => (kernel.executeCell as any)(document.notebookDocument, cell.cell, token));
		} else {
			return withToken(token => (kernel.executeAllCells as any)(document.notebookDocument, token));
		}
	}

	async cancelNotebook(kernelId: string, document: ExtHostNotebookDocument, cell: ExtHostCell | undefined) {
		const kernel = this._idToKernel.get(kernelId);

		if (!kernel) {
			return;
		}

		if (cell) {
			return kernel.cancelCellExecution(document.notebookDocument, cell.cell);
		} else {
			return kernel.cancelAllCellsExecution(document.notebookDocument);
		}
	}
}

// TODO@roblou remove 'token' passed to all execute APIs once extensions are updated
async function withToken(cb: (token: CancellationToken) => any) {
	const source = new CancellationTokenSource();
	try {
		await cb(source.token);
	} finally {
		source.dispose();
	}
}

export class ExtHostNotebookController implements ExtHostNotebookShape, ExtHostNotebookOutputRenderingHandler {
	private static _notebookKernelProviderHandlePool: number = 0;

	private readonly _proxy: MainThreadNotebookShape;
	private readonly _notebookContentProviders = new Map<string, { readonly provider: vscode.NotebookContentProvider, readonly extension: IExtensionDescription; }>();
	private readonly _notebookKernels = new Map<string, { readonly kernel: vscode.NotebookKernel, readonly extension: IExtensionDescription; }>();
	private readonly _notebookKernelProviders = new Map<number, ExtHostNotebookKernelProviderAdapter>();
	private readonly _documents = new ResourceMap<ExtHostNotebookDocument>();
	private readonly _unInitializedDocuments = new ResourceMap<ExtHostNotebookDocument>();
	private readonly _editors = new Map<string, { editor: ExtHostNotebookEditor; }>();
	private readonly _webviewComm = new Map<string, ExtHostWebviewCommWrapper>();
	private readonly _commandsConverter: CommandsConverter;
	private readonly _onDidChangeNotebookEditorSelection = new Emitter<vscode.NotebookEditorSelectionChangeEvent>();
	readonly onDidChangeNotebookEditorSelection = this._onDidChangeNotebookEditorSelection.event;
	private readonly _onDidChangeNotebookEditorVisibleRanges = new Emitter<vscode.NotebookEditorVisibleRangesChangeEvent>();
	readonly onDidChangeNotebookEditorVisibleRanges = this._onDidChangeNotebookEditorVisibleRanges.event;
	private readonly _onDidChangeNotebookCells = new Emitter<vscode.NotebookCellsChangeEvent>();
	readonly onDidChangeNotebookCells = this._onDidChangeNotebookCells.event;
	private readonly _onDidChangeCellOutputs = new Emitter<vscode.NotebookCellOutputsChangeEvent>();
	readonly onDidChangeCellOutputs = this._onDidChangeCellOutputs.event;
	private readonly _onDidChangeCellLanguage = new Emitter<vscode.NotebookCellLanguageChangeEvent>();
	readonly onDidChangeCellLanguage = this._onDidChangeCellLanguage.event;
	private readonly _onDidChangeCellMetadata = new Emitter<vscode.NotebookCellMetadataChangeEvent>();
	readonly onDidChangeCellMetadata = this._onDidChangeCellMetadata.event;
	private readonly _onDidChangeActiveNotebookEditor = new Emitter<vscode.NotebookEditor | undefined>();
	readonly onDidChangeActiveNotebookEditor = this._onDidChangeActiveNotebookEditor.event;

	private _outputDisplayOrder: INotebookDisplayOrder | undefined;

	get outputDisplayOrder(): INotebookDisplayOrder | undefined {
		return this._outputDisplayOrder;
	}

	private _activeNotebookEditor: ExtHostNotebookEditor | undefined;

	get activeNotebookEditor() {
		return this._activeNotebookEditor;
	}

	private _onDidOpenNotebookDocument = new Emitter<vscode.NotebookDocument>();
	onDidOpenNotebookDocument: Event<vscode.NotebookDocument> = this._onDidOpenNotebookDocument.event;
	private _onDidCloseNotebookDocument = new Emitter<vscode.NotebookDocument>();
	onDidCloseNotebookDocument: Event<vscode.NotebookDocument> = this._onDidCloseNotebookDocument.event;
	private _onDidSaveNotebookDocument = new Emitter<vscode.NotebookDocument>();
	onDidSaveNotebookDocument: Event<vscode.NotebookDocument> = this._onDidCloseNotebookDocument.event;
	visibleNotebookEditors: ExtHostNotebookEditor[] = [];
	private _onDidChangeActiveNotebookKernel = new Emitter<{ document: vscode.NotebookDocument, kernel: vscode.NotebookKernel | undefined; }>();
	onDidChangeActiveNotebookKernel = this._onDidChangeActiveNotebookKernel.event;
	private _onDidChangeVisibleNotebookEditors = new Emitter<vscode.NotebookEditor[]>();
	onDidChangeVisibleNotebookEditors = this._onDidChangeVisibleNotebookEditors.event;

	constructor(
		mainContext: IMainContext,
		commands: ExtHostCommands,
		private _documentsAndEditors: ExtHostDocumentsAndEditors,
		private readonly _webviewInitData: WebviewInitData,
		private readonly logService: ILogService,
		private readonly _extensionStoragePaths: IExtensionStoragePaths,
	) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadNotebook);
		this._commandsConverter = commands.converter;

		commands.registerArgumentProcessor({
			// Serialized INotebookCellActionContext
			processArgument: (arg) => {
				if (arg && arg.$mid === 12) {
					const documentHandle = arg.notebookEditor?.notebookHandle;
					const cellHandle = arg.cell.handle;

					for (const value of this._editors) {
						if (value[1].editor.notebookData.handle === documentHandle) {
							const cell = value[1].editor.notebookData.getCell(cellHandle);
							if (cell) {
								return cell.cell;
							}
						}
					}
				}
				return arg;
			}
		});
	}

	get notebookDocuments() {
		return [...this._documents.values()];
	}

	lookupNotebookDocument(uri: URI): ExtHostNotebookDocument | undefined {
		return this._documents.get(uri);
	}

	registerNotebookContentProvider(
		extension: IExtensionDescription,
		viewType: string,
		provider: vscode.NotebookContentProvider,
		options?: {
			transientOutputs: boolean;
			transientMetadata: { [K in keyof NotebookCellMetadata]?: boolean };
		}
	): vscode.Disposable {

		if (this._notebookContentProviders.has(viewType)) {
			throw new Error(`Notebook provider for '${viewType}' already registered`);
		}

		this._notebookContentProviders.set(viewType, { extension, provider });

		const listener = provider.onDidChangeNotebook
			? provider.onDidChangeNotebook(e => {
				const document = this._documents.get(URI.revive(e.document.uri));

				if (!document) {
					throw new Error(`Notebook document ${e.document.uri.toString()} not found`);
				}

				if (isEditEvent(e)) {
					const editId = document.addEdit(e);
					this._proxy.$onDidEdit(e.document.uri, viewType, editId, e.label);
				} else {
					this._proxy.$onContentChange(e.document.uri, viewType);
				}
			})
			: Disposable.None;

		const supportBackup = !!provider.backupNotebook;

		this._proxy.$registerNotebookProvider({ id: extension.identifier, location: extension.extensionLocation, description: extension.description }, viewType, supportBackup, { transientOutputs: options?.transientOutputs || false, transientMetadata: options?.transientMetadata || {} });

		return new extHostTypes.Disposable(() => {
			listener.dispose();
			this._notebookContentProviders.delete(viewType);
			this._proxy.$unregisterNotebookProvider(viewType);
		});
	}

	registerNotebookKernelProvider(extension: IExtensionDescription, selector: vscode.NotebookDocumentFilter, provider: vscode.NotebookKernelProvider) {
		const handle = ExtHostNotebookController._notebookKernelProviderHandlePool++;
		const adapter = new ExtHostNotebookKernelProviderAdapter(this._proxy, handle, extension, provider);
		this._notebookKernelProviders.set(handle, adapter);
		this._proxy.$registerNotebookKernelProvider({ id: extension.identifier, location: extension.extensionLocation, description: extension.description }, handle, {
			viewType: selector.viewType,
			filenamePattern: selector.filenamePattern ? typeConverters.GlobPattern.from(selector.filenamePattern) : undefined,
			excludeFileNamePattern: selector.excludeFileNamePattern ? typeConverters.GlobPattern.from(selector.excludeFileNamePattern) : undefined,
		});

		return new extHostTypes.Disposable(() => {
			adapter.dispose();
			this._notebookKernelProviders.delete(handle);
			this._proxy.$unregisterNotebookKernelProvider(handle);
		});
	}

	private _withAdapter<T>(handle: number, uri: UriComponents, callback: (adapter: ExtHostNotebookKernelProviderAdapter, document: ExtHostNotebookDocument) => Promise<T>) {
		const document = this._documents.get(URI.revive(uri));

		if (!document) {
			return [];
		}

		const provider = this._notebookKernelProviders.get(handle);

		if (!provider) {
			return [];
		}

		return callback(provider, document);
	}

	async $provideNotebookKernels(handle: number, uri: UriComponents, token: CancellationToken): Promise<INotebookKernelInfoDto2[]> {
		return this._withAdapter<INotebookKernelInfoDto2[]>(handle, uri, (adapter, document) => {
			return adapter.provideKernels(document, token);
		});
	}

	async $resolveNotebookKernel(handle: number, editorId: string, uri: UriComponents, kernelId: string, token: CancellationToken): Promise<void> {
		await this._withAdapter<void>(handle, uri, async (adapter, document) => {
			const webComm = this._webviewComm.get(editorId);

			if (webComm) {
				await adapter.resolveNotebook(kernelId, document, webComm.contentProviderComm, token);
			}
		});
	}

	registerNotebookKernel(extension: IExtensionDescription, id: string, selectors: vscode.GlobPattern[], kernel: vscode.NotebookKernel): vscode.Disposable {
		if (this._notebookKernels.has(id)) {
			throw new Error(`Notebook kernel for '${id}' already registered`);
		}

		this._notebookKernels.set(id, { kernel, extension });
		const transformedSelectors = selectors.map(selector => typeConverters.GlobPattern.from(selector));

		this._proxy.$registerNotebookKernel({ id: extension.identifier, location: extension.extensionLocation, description: extension.description }, id, kernel.label, transformedSelectors, kernel.preloads || []);
		return new extHostTypes.Disposable(() => {
			this._notebookKernels.delete(id);
			this._proxy.$unregisterNotebookKernel(id);
		});
	}

	async $resolveNotebookData(viewType: string, uri: UriComponents, backupId?: string): Promise<NotebookDataDto | undefined> {
		const provider = this._notebookContentProviders.get(viewType);
		const revivedUri = URI.revive(uri);
		if (!provider) {
			return;
		}

		const storageRoot = this._extensionStoragePaths.workspaceValue(provider.extension) ?? this._extensionStoragePaths.globalValue(provider.extension);
		let document = this._documents.get(revivedUri);

		if (!document) {
			const that = this;
			document = this._unInitializedDocuments.get(revivedUri) ?? new ExtHostNotebookDocument(this._proxy, this._documentsAndEditors, {
				emitModelChange(event: vscode.NotebookCellsChangeEvent): void {
					that._onDidChangeNotebookCells.fire(event);
				},
				emitCellOutputsChange(event: vscode.NotebookCellOutputsChangeEvent): void {
					that._onDidChangeCellOutputs.fire(event);
				},
				emitCellLanguageChange(event: vscode.NotebookCellLanguageChangeEvent): void {
					that._onDidChangeCellLanguage.fire(event);
				},
				emitCellMetadataChange(event: vscode.NotebookCellMetadataChangeEvent): void {
					that._onDidChangeCellMetadata.fire(event);
				},
			}, viewType, revivedUri, this, storageRoot);
			this._unInitializedDocuments.set(revivedUri, document);
		}

		const rawCells = await provider.provider.openNotebook(URI.revive(uri), { backupId });
		const dto = {
			metadata: {
				...notebookDocumentMetadataDefaults,
				...rawCells.metadata
			},
			languages: rawCells.languages,
			cells: rawCells.cells.map(cell => ({
				...cell,
				outputs: cell.outputs.map(o => addIdToOutput(o))
			})),
		};

		return dto;
	}

	async $resolveNotebookEditor(viewType: string, uri: UriComponents, editorId: string): Promise<void> {
		const provider = this._notebookContentProviders.get(viewType);
		const revivedUri = URI.revive(uri);
		const document = this._documents.get(revivedUri);
		if (!document || !provider) {
			return;
		}

		let webComm = this._webviewComm.get(editorId);
		if (!webComm) {
			webComm = new ExtHostWebviewCommWrapper(editorId, revivedUri, this._proxy, this._webviewInitData, document);
			this._webviewComm.set(editorId, webComm);
		}

		if (!provider.provider.resolveNotebook) {
			return;
		}

		await provider.provider.resolveNotebook(document.notebookDocument, webComm.contentProviderComm);
	}

	async $executeNotebookKernelFromProvider(handle: number, uri: UriComponents, kernelId: string, cellHandle: number | undefined): Promise<void> {
		await this._withAdapter(handle, uri, async (adapter, document) => {
			const cell = cellHandle !== undefined ? document.getCell(cellHandle) : undefined;

			return adapter.executeNotebook(kernelId, document, cell);
		});
	}

	async $cancelNotebookKernelFromProvider(handle: number, uri: UriComponents, kernelId: string, cellHandle: number | undefined): Promise<void> {
		await this._withAdapter(handle, uri, async (adapter, document) => {
			const cell = cellHandle !== undefined ? document.getCell(cellHandle) : undefined;

			return adapter.cancelNotebook(kernelId, document, cell);
		});
	}

	async $executeNotebook2(kernelId: string, viewType: string, uri: UriComponents, cellHandle: number | undefined): Promise<void> {
		const document = this._documents.get(URI.revive(uri));

		if (!document || document.notebookDocument.viewType !== viewType) {
			return;
		}

		const kernelInfo = this._notebookKernels.get(kernelId);

		if (!kernelInfo) {
			return;
		}

		const cell = cellHandle !== undefined ? document.getCell(cellHandle) : undefined;

		if (cell) {
			return withToken(token => (kernelInfo!.kernel.executeCell as any)(document.notebookDocument, cell.cell, token));
		} else {
			return withToken(token => (kernelInfo!.kernel.executeAllCells as any)(document.notebookDocument, token));
		}
	}

	async $saveNotebook(viewType: string, uri: UriComponents, token: CancellationToken): Promise<boolean> {
		const document = this._documents.get(URI.revive(uri));
		if (!document) {
			return false;
		}

		if (this._notebookContentProviders.has(viewType)) {
			await this._notebookContentProviders.get(viewType)!.provider.saveNotebook(document.notebookDocument, token);
			return true;
		}

		return false;
	}

	async $saveNotebookAs(viewType: string, uri: UriComponents, target: UriComponents, token: CancellationToken): Promise<boolean> {
		const document = this._documents.get(URI.revive(uri));
		if (!document) {
			return false;
		}

		if (this._notebookContentProviders.has(viewType)) {
			await this._notebookContentProviders.get(viewType)!.provider.saveNotebookAs(URI.revive(target), document.notebookDocument, token);
			return true;
		}

		return false;
	}

	async $undoNotebook(viewType: string, uri: UriComponents, editId: number, isDirty: boolean): Promise<void> {
		const document = this._documents.get(URI.revive(uri));
		if (!document) {
			return;
		}

		document.undo(editId, isDirty);

	}

	async $redoNotebook(viewType: string, uri: UriComponents, editId: number, isDirty: boolean): Promise<void> {
		const document = this._documents.get(URI.revive(uri));
		if (!document) {
			return;
		}

		document.redo(editId, isDirty);
	}


	async $backup(viewType: string, uri: UriComponents, cancellation: CancellationToken): Promise<string | undefined> {
		const document = this._documents.get(URI.revive(uri));
		const provider = this._notebookContentProviders.get(viewType);

		if (document && provider && provider.provider.backupNotebook) {
			const backup = await provider.provider.backupNotebook(document.notebookDocument, { destination: document.getNewBackupUri() }, cancellation);
			document.updateBackup(backup);
			return backup.id;
		}

		return;
	}

	$acceptDisplayOrder(displayOrder: INotebookDisplayOrder): void {
		this._outputDisplayOrder = displayOrder;
	}

	$acceptNotebookActiveKernelChange(event: { uri: UriComponents, providerHandle: number | undefined, kernelId: string | undefined; }) {
		if (event.providerHandle !== undefined) {
			this._withAdapter(event.providerHandle, event.uri, async (adapter, document) => {
				const kernel = event.kernelId ? adapter.getKernel(event.kernelId) : undefined;
				this._editors.forEach(editor => {
					if (editor.editor.notebookData === document) {
						editor.editor.updateActiveKernel(kernel);
					}
				});
				this._onDidChangeActiveNotebookKernel.fire({ document: document.notebookDocument, kernel });
			});
		}
	}

	// TODO: remove document - editor one on one mapping
	private _getEditorFromURI(uriComponents: UriComponents) {
		const uriStr = URI.revive(uriComponents).toString();
		let editor: { editor: ExtHostNotebookEditor; } | undefined;
		this._editors.forEach(e => {
			if (e.editor.uri.toString() === uriStr) {
				editor = e;
			}
		});

		return editor;
	}

	$onDidReceiveMessage(editorId: string, forRendererType: string | undefined, message: any): void {
		this._webviewComm.get(editorId)?.onDidReceiveMessage(forRendererType, message);
	}

	$acceptModelChanged(uriComponents: UriComponents, event: NotebookCellsChangedEvent, isDirty: boolean): void {
		const document = this._documents.get(URI.revive(uriComponents));
		if (document) {
			document.acceptModelChanged(event, isDirty);
		}
	}

	public $acceptModelSaved(uriComponents: UriComponents): void {
		const document = this._documents.get(URI.revive(uriComponents));
		if (document) {
			// this.$acceptDirtyStateChanged(uriComponents, false);
			this._onDidSaveNotebookDocument.fire(document.notebookDocument);
		}
	}

	$acceptEditorPropertiesChanged(id: string, data: INotebookEditorPropertiesChangeData): void {
		this.logService.debug('ExtHostNotebook#$acceptEditorPropertiesChanged', id, data);

		let editor: { editor: ExtHostNotebookEditor; } | undefined;
		this._editors.forEach(e => {
			if (e.editor.id === id) {
				editor = e;
			}
		});

		if (!editor) {
			return;
		}

		if (data.visibleRanges) {
			editor.editor._acceptVisibleRanges(data.visibleRanges.ranges);
			this._onDidChangeNotebookEditorVisibleRanges.fire({
				notebookEditor: editor.editor,
				visibleRanges: editor.editor.visibleRanges
			});
		}
	}

	$acceptDocumentPropertiesChanged(uriComponents: UriComponents, data: INotebookDocumentPropertiesChangeData): void {
		this.logService.debug('ExtHostNotebook#$acceptDocumentPropertiesChanged', uriComponents.path, data);
		const editor = this._getEditorFromURI(uriComponents);

		if (!editor) {
			return;
		}

		if (data.selections) {
			if (data.selections.selections.length) {
				const firstCell = data.selections.selections[0];
				editor.editor.selection = editor.editor.notebookData.getCell(firstCell)?.cell;
			} else {
				editor.editor.selection = undefined;
			}

			this._onDidChangeNotebookEditorSelection.fire({
				notebookEditor: editor.editor,
				selection: editor.editor.selection
			});
		}


		if (data.metadata) {
			editor.editor.notebookData.notebookDocument.metadata = {
				...notebookDocumentMetadataDefaults,
				...data.metadata
			};
		}
	}

	private _createExtHostEditor(document: ExtHostNotebookDocument, editorId: string, selections: number[], visibleRanges: vscode.NotebookCellRange[]) {
		const revivedUri = document.uri;
		let webComm = this._webviewComm.get(editorId);

		if (!webComm) {
			webComm = new ExtHostWebviewCommWrapper(editorId, revivedUri, this._proxy, this._webviewInitData, document);
			this._webviewComm.set(editorId, webComm);
		}

		const editor = new ExtHostNotebookEditor(
			document.notebookDocument.viewType,
			editorId,
			revivedUri,
			this._proxy,
			webComm.contentProviderComm,
			document
		);

		if (selections.length) {
			const firstCell = selections[0];
			editor.selection = editor.notebookData.getCell(firstCell)?.cell;
		} else {
			editor.selection = undefined;
		}

		editor._acceptVisibleRanges(visibleRanges);

		this._editors.get(editorId)?.editor.dispose();
		this._editors.set(editorId, { editor });
	}

	$acceptDocumentAndEditorsDelta(delta: INotebookDocumentsAndEditorsDelta): void {
		let editorChanged = false;

		if (delta.removedDocuments) {
			for (const uri of delta.removedDocuments) {
				const revivedUri = URI.revive(uri);
				const document = this._documents.get(revivedUri);

				if (document) {
					document.dispose();
					this._documents.delete(revivedUri);
					this._documentsAndEditors.$acceptDocumentsAndEditorsDelta({ removedDocuments: document.notebookDocument.cells.map(cell => cell.uri) });
					this._onDidCloseNotebookDocument.fire(document.notebookDocument);
				}

				for (const e of this._editors.values()) {
					if (e.editor.uri.toString() === revivedUri.toString()) {
						e.editor.dispose();
						this._editors.delete(e.editor.id);
						editorChanged = true;
					}
				}
			}
		}

		if (delta.addedDocuments) {

			const addedCellDocuments: IModelAddedData[] = [];

			for (const modelData of delta.addedDocuments) {
				const revivedUri = URI.revive(modelData.uri);
				const viewType = modelData.viewType;
				const entry = this._notebookContentProviders.get(viewType);
				const storageRoot = entry && (this._extensionStoragePaths.workspaceValue(entry.extension) ?? this._extensionStoragePaths.globalValue(entry.extension));


				if (!this._documents.has(revivedUri)) {
					const that = this;

					const document = this._unInitializedDocuments.get(revivedUri) ?? new ExtHostNotebookDocument(this._proxy, this._documentsAndEditors, {
						emitModelChange(event: vscode.NotebookCellsChangeEvent): void {
							that._onDidChangeNotebookCells.fire(event);
						},
						emitCellOutputsChange(event: vscode.NotebookCellOutputsChangeEvent): void {
							that._onDidChangeCellOutputs.fire(event);
						},
						emitCellLanguageChange(event: vscode.NotebookCellLanguageChangeEvent): void {
							that._onDidChangeCellLanguage.fire(event);
						},
						emitCellMetadataChange(event: vscode.NotebookCellMetadataChangeEvent): void {
							that._onDidChangeCellMetadata.fire(event);
						}
					}, viewType, revivedUri, this, storageRoot);

					this._unInitializedDocuments.delete(revivedUri);
					if (modelData.metadata) {
						document.notebookDocument.metadata = {
							...notebookDocumentMetadataDefaults,
							...modelData.metadata
						};
					}

					document.acceptModelChanged({
						kind: NotebookCellsChangeType.Initialize,
						versionId: modelData.versionId,
						changes: [[
							0,
							0,
							modelData.cells
						]]
					}, false);

					// add cell document as vscode.TextDocument
					addedCellDocuments.push(...modelData.cells.map(cell => ExtHostCell.asModelAddData(document.notebookDocument, cell)));

					this._documents.get(revivedUri)?.dispose();
					this._documents.set(revivedUri, document);

					// create editor if populated
					if (modelData.attachedEditor) {
						this._createExtHostEditor(document, modelData.attachedEditor.id, modelData.attachedEditor.selections, modelData.attachedEditor.visibleRanges);
						editorChanged = true;
					}
				}

				this._documentsAndEditors.$acceptDocumentsAndEditorsDelta({ addedDocuments: addedCellDocuments });

				const document = this._documents.get(revivedUri)!;
				this._onDidOpenNotebookDocument.fire(document.notebookDocument);
			}
		}

		if (delta.addedEditors) {
			for (const editorModelData of delta.addedEditors) {
				if (this._editors.has(editorModelData.id)) {
					return;
				}

				const revivedUri = URI.revive(editorModelData.documentUri);
				const document = this._documents.get(revivedUri);

				if (document) {
					this._createExtHostEditor(document, editorModelData.id, editorModelData.selections, editorModelData.visibleRanges);
					editorChanged = true;
				}
			}
		}

		const removedEditors: { editor: ExtHostNotebookEditor; }[] = [];

		if (delta.removedEditors) {
			for (const editorid of delta.removedEditors) {
				const editor = this._editors.get(editorid);

				if (editor) {
					editorChanged = true;
					this._editors.delete(editorid);

					if (this.activeNotebookEditor?.id === editor.editor.id) {
						this._activeNotebookEditor = undefined;
					}

					removedEditors.push(editor);
				}
			}
		}

		if (editorChanged) {
			removedEditors.forEach(e => {
				e.editor.dispose();
			});
		}

		if (delta.visibleEditors) {
			this.visibleNotebookEditors = delta.visibleEditors.map(id => this._editors.get(id)!.editor).filter(editor => !!editor) as ExtHostNotebookEditor[];
			const visibleEditorsSet = new Set<string>();
			this.visibleNotebookEditors.forEach(editor => visibleEditorsSet.add(editor.id));

			for (const e of this._editors.values()) {
				const newValue = visibleEditorsSet.has(e.editor.id);
				e.editor._acceptVisibility(newValue);
			}

			this.visibleNotebookEditors = [...this._editors.values()].map(e => e.editor).filter(e => e.visible);
			this._onDidChangeVisibleNotebookEditors.fire(this.visibleNotebookEditors);
		}

		if (delta.newActiveEditor !== undefined) {
			if (delta.newActiveEditor) {
				this._activeNotebookEditor = this._editors.get(delta.newActiveEditor)?.editor;
				this._activeNotebookEditor?._acceptActive(true);
				for (const e of this._editors.values()) {
					if (e.editor !== this.activeNotebookEditor) {
						e.editor._acceptActive(false);
					}
				}
			} else {
				// clear active notebook as current active editor is non-notebook editor
				this._activeNotebookEditor = undefined;
				for (const e of this._editors.values()) {
					e.editor._acceptActive(false);
				}
			}

			this._onDidChangeActiveNotebookEditor.fire(this._activeNotebookEditor);
		}
	}

	createNotebookCellStatusBarItemInternal(cell: vscode.NotebookCell, alignment: extHostTypes.NotebookCellStatusBarAlignment | undefined, priority: number | undefined) {
		const statusBarItem = new NotebookCellStatusBarItemInternal(this._proxy, this._commandsConverter, cell, alignment, priority);

		// Look up the ExtHostCell for this NotebookCell URI, bind to its disposable lifecycle
		const parsedUri = CellUri.parse(cell.uri);
		if (parsedUri) {
			const document = this._documents.get(parsedUri.notebook);
			if (document) {
				const cell = document.getCell(parsedUri.handle);
				if (cell) {
					Event.once(cell.onDidDispose)(() => statusBarItem.dispose());
				}
			}
		}

		return statusBarItem;
	}
}

function hashPath(resource: URI): string {
	const str = resource.scheme === Schemas.file || resource.scheme === Schemas.untitled ? resource.fsPath : resource.toString();
	return hash(str) + '';
}

function isEditEvent(e: vscode.NotebookDocumentEditEvent | vscode.NotebookDocumentContentChangeEvent): e is vscode.NotebookDocumentEditEvent {
	return typeof (e as vscode.NotebookDocumentEditEvent).undo === 'function'
		&& typeof (e as vscode.NotebookDocumentEditEvent).redo === 'function';
}

export class NotebookCellStatusBarItemInternal extends Disposable {
	private static NEXT_ID = 0;

	private readonly _id = NotebookCellStatusBarItemInternal.NEXT_ID++;
	private readonly _internalCommandRegistration: DisposableStore;

	private _isDisposed = false;
	private _alignment: extHostTypes.NotebookCellStatusBarAlignment;

	constructor(
		private readonly _proxy: MainThreadNotebookShape,
		private readonly _commands: CommandsConverter,
		private readonly _cell: vscode.NotebookCell,
		alignment: extHostTypes.NotebookCellStatusBarAlignment | undefined,
		private _priority: number | undefined) {
		super();
		this._internalCommandRegistration = this._register(new DisposableStore());
		this._alignment = alignment ?? extHostTypes.NotebookCellStatusBarAlignment.Left;
	}

	private _apiItem: vscode.NotebookCellStatusBarItem | undefined;
	get apiItem(): vscode.NotebookCellStatusBarItem {
		if (!this._apiItem) {
			this._apiItem = createNotebookCellStatusBarApiItem(this);
		}

		return this._apiItem;
	}

	get cell(): vscode.NotebookCell {
		return this._cell;
	}

	get alignment(): extHostTypes.NotebookCellStatusBarAlignment {
		return this._alignment;
	}

	set alignment(v: extHostTypes.NotebookCellStatusBarAlignment) {
		this._alignment = v;
		this.update();
	}

	get priority(): number | undefined {
		return this._priority;
	}

	set priority(v: number | undefined) {
		this._priority = v;
		this.update();
	}

	private _text: string = '';
	get text(): string {
		return this._text;
	}

	set text(v: string) {
		this._text = v;
		this.update();
	}

	private _tooltip: string | undefined;
	get tooltip(): string | undefined {
		return this._tooltip;
	}

	set tooltip(v: string | undefined) {
		this._tooltip = v;
		this.update();
	}

	private _command?: {
		readonly fromApi: string | vscode.Command,
		readonly internal: ICommandDto,
	};
	get command(): string | vscode.Command | undefined {
		return this._command?.fromApi;
	}

	set command(command: string | vscode.Command | undefined) {
		if (this._command?.fromApi === command) {
			return;
		}

		this._internalCommandRegistration.clear();
		if (typeof command === 'string') {
			this._command = {
				fromApi: command,
				internal: this._commands.toInternal({ title: '', command }, this._internalCommandRegistration),
			};
		} else if (command) {
			this._command = {
				fromApi: command,
				internal: this._commands.toInternal(command, this._internalCommandRegistration),
			};
		} else {
			this._command = undefined;
		}
		this.update();
	}

	private _accessibilityInformation: vscode.AccessibilityInformation | undefined;
	get accessibilityInformation(): vscode.AccessibilityInformation | undefined {
		return this._accessibilityInformation;
	}

	set accessibilityInformation(v: vscode.AccessibilityInformation | undefined) {
		this._accessibilityInformation = v;
		this.update();
	}

	private _visible: boolean = false;
	show(): void {
		this._visible = true;
		this.update();
	}

	hide(): void {
		this._visible = false;
		this.update();
	}

	dispose(): void {
		this.hide();
		this._isDisposed = true;
		this._internalCommandRegistration.dispose();
	}

	private update(): void {
		if (this._isDisposed) {
			return;
		}

		const entry: INotebookCellStatusBarEntry = {
			alignment: this.alignment === extHostTypes.NotebookCellStatusBarAlignment.Left ? CellStatusbarAlignment.LEFT : CellStatusbarAlignment.RIGHT,
			cellResource: this.cell.uri,
			command: this._command?.internal,
			text: this.text,
			tooltip: this.tooltip,
			accessibilityInformation: this.accessibilityInformation,
			priority: this.priority,
			visible: this._visible
		};

		this._proxy.$setStatusBarEntry(this._id, entry);
	}
}

function createNotebookCellStatusBarApiItem(internalItem: NotebookCellStatusBarItemInternal): vscode.NotebookCellStatusBarItem {
	return Object.freeze({
		cell: internalItem.cell,
		get alignment() { return internalItem.alignment; },
		set alignment(v: NotebookCellStatusBarItemInternal['alignment']) { internalItem.alignment = v; },

		get priority() { return internalItem.priority; },
		set priority(v: NotebookCellStatusBarItemInternal['priority']) { internalItem.priority = v; },

		get text() { return internalItem.text; },
		set text(v: NotebookCellStatusBarItemInternal['text']) { internalItem.text = v; },

		get tooltip() { return internalItem.tooltip; },
		set tooltip(v: NotebookCellStatusBarItemInternal['tooltip']) { internalItem.tooltip = v; },

		get command() { return internalItem.command; },
		set command(v: NotebookCellStatusBarItemInternal['command']) { internalItem.command = v; },

		get accessibilityInformation() { return internalItem.accessibilityInformation; },
		set accessibilityInformation(v: NotebookCellStatusBarItemInternal['accessibilityInformation']) { internalItem.accessibilityInformation = v; },

		show() { internalItem.show(); },
		hide() { internalItem.hide(); },
		dispose() { internalItem.dispose(); }
	});
}
