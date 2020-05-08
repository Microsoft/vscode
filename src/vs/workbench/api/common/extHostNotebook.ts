/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { readonly } from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore, IDisposable } from 'vs/base/common/lifecycle';
import { ISplice } from 'vs/base/common/sequence';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { CellKind, CellOutputKind, ExtHostNotebookShape, IMainContext, MainContext, MainThreadNotebookShape, NotebookCellOutputsSplice, MainThreadDocumentsShape, INotebookEditorPropertiesChangeData, INotebookDocumentsAndEditorsDelta } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { CellEditType, CellUri, diff, ICellEditOperation, ICellInsertEdit, IErrorOutput, INotebookDisplayOrder, INotebookEditData, IOrderedMimeType, IStreamOutput, ITransformedDisplayOutputDto, mimeTypeSupportedByCore, NotebookCellsChangedEvent, NotebookCellsSplice2, sortMimeTypes, ICellDeleteEdit, notebookDocumentMetadataDefaults, NotebookCellsChangeType, NotebookDataDto } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { Disposable as VSCodeDisposable } from './extHostTypes';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ExtHostDocumentData } from 'vs/workbench/api/common/extHostDocumentData';
import { NotImplementedProxy } from 'vs/base/common/types';

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

export class ExtHostCell extends Disposable implements vscode.NotebookCell {

	// private originalSource: string[];
	private _outputs: any[];
	private _onDidChangeOutputs = new Emitter<ISplice<vscode.CellOutput>[]>();
	onDidChangeOutputs: Event<ISplice<vscode.CellOutput>[]> = this._onDidChangeOutputs.event;
	// private _textDocument: vscode.TextDocument | undefined;
	// private _initalVersion: number = -1;
	private _outputMapping = new Set<vscode.CellOutput>();
	private _metadata: vscode.NotebookCellMetadata;

	private _metadataChangeListener: IDisposable;

	private _documentData: ExtHostDocumentData;

	get document(): vscode.TextDocument {
		return this._documentData.document;
	}

	get source() {
		// todo@jrieken remove this
		return this._documentData.getText();
	}

	constructor(
		private readonly viewType: string,
		private readonly documentUri: URI,
		readonly handle: number,
		readonly uri: URI,
		content: string,
		public readonly cellKind: CellKind,
		public language: string,
		outputs: any[],
		_metadata: vscode.NotebookCellMetadata | undefined,
		private _proxy: MainThreadNotebookShape,
	) {
		super();
		this._documentData = new ExtHostDocumentData(
			new class extends NotImplementedProxy<MainThreadDocumentsShape>('document') { },
			uri,
			content.split(/\r|\n|\r\n/g), '\n',
			language, 0, false
		);

		this._outputs = outputs;

		const observableMetadata = getObservable(_metadata || {});
		this._metadata = observableMetadata.proxy;
		this._metadataChangeListener = this._register(observableMetadata.onDidChange(() => {
			this.updateMetadata();
		}));
	}

	get outputs() {
		return this._outputs;
	}

	set outputs(newOutputs: vscode.CellOutput[]) {
		let diffs = diff<vscode.CellOutput>(this._outputs || [], newOutputs || [], (a) => {
			return this._outputMapping.has(a);
		});

		diffs.forEach(diff => {
			for (let i = diff.start; i < diff.start + diff.deleteCount; i++) {
				this._outputMapping.delete(this._outputs[i]);
			}

			diff.toInsert.forEach(output => {
				this._outputMapping.add(output);
			});
		});

		this._outputs = newOutputs;
		this._onDidChangeOutputs.fire(diffs);
	}

	get metadata() {
		return this._metadata;
	}

	set metadata(newMetadata: vscode.NotebookCellMetadata) {
		// Don't apply metadata defaults here, 'undefined' means 'inherit from document metadata'
		this._metadataChangeListener.dispose();
		const observableMetadata = getObservable(newMetadata);
		this._metadata = observableMetadata.proxy;
		this._metadataChangeListener = this._register(observableMetadata.onDidChange(() => {
			this.updateMetadata();
		}));

		this.updateMetadata();
	}

	private updateMetadata(): Promise<void> {
		return this._proxy.$updateNotebookCellMetadata(this.viewType, this.documentUri, this.handle, this._metadata);
	}

	attachTextDocument(document: ExtHostDocumentData) {
		this._documentData = document;
		// this._initalVersion = this._documentData.version;
	}

	detachTextDocument() {
		// no-op? keep stale document until new comes along?

		// if (this._textDocument && this._textDocument.version !== this._initalVersion) {
		// 	this.originalSource = this._textDocument.getText().split(/\r|\n|\r\n/g);
		// }
		// this._textDocument = undefined;
		// this._initalVersion = -1;
	}
}

export class ExtHostNotebookDocument extends Disposable implements vscode.NotebookDocument {
	private static _handlePool: number = 0;
	readonly handle = ExtHostNotebookDocument._handlePool++;

	private _cells: ExtHostCell[] = [];

	private _cellDisposableMapping = new Map<number, DisposableStore>();

	get cells() {
		return this._cells;
	}

	private _languages: string[] = [];

	get languages() {
		return this._languages = [];
	}

	set languages(newLanguages: string[]) {
		this._languages = newLanguages;
		this._proxy.$updateNotebookLanguages(this.viewType, this.uri, this._languages);
	}

	private _metadata: Required<vscode.NotebookDocumentMetadata> = notebookDocumentMetadataDefaults;
	private _metadataChangeListener: IDisposable;

	get metadata() {
		return this._metadata;
	}

	set metadata(newMetadata: Required<vscode.NotebookDocumentMetadata>) {
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
			this.updateMetadata();
		}));

		this.updateMetadata();
	}

	private _displayOrder: string[] = [];

	get displayOrder() {
		return this._displayOrder;
	}

	set displayOrder(newOrder: string[]) {
		this._displayOrder = newOrder;
	}

	private _versionId = 0;

	get versionId() {
		return this._versionId;
	}

	constructor(
		private readonly _proxy: MainThreadNotebookShape,
		private _documentsAndEditors: ExtHostDocumentsAndEditors,
		public viewType: string,
		public uri: URI,
		public renderingHandler: ExtHostNotebookOutputRenderingHandler
	) {
		super();

		const observableMetadata = getObservable(notebookDocumentMetadataDefaults);
		this._metadata = observableMetadata.proxy;
		this._metadataChangeListener = this._register(observableMetadata.onDidChange(() => {
			this.updateMetadata();
		}));
	}

	private updateMetadata() {
		this._proxy.$updateNotebookMetadata(this.viewType, this.uri, this._metadata);
	}

	dispose() {
		super.dispose();
		this._cellDisposableMapping.forEach(cell => cell.dispose());
	}

	get fileName() { return this.uri.fsPath; }

	get isDirty() { return false; }

	accpetModelChanged(event: NotebookCellsChangedEvent) {
		if (event.kind === NotebookCellsChangeType.ModelChange) {
			this.$spliceNotebookCells(event.changes);
		} else if (event.kind === NotebookCellsChangeType.Move) {
			this.$moveCell(event.index, event.newIdx);
		} else if (event.kind === NotebookCellsChangeType.CellClearOutput) {
			this.$clearCellOutputs(event.index);
		} else if (event.kind === NotebookCellsChangeType.CellsClearOutput) {
			this.$clearAllCellOutputs();
		} else if (event.kind === NotebookCellsChangeType.ChangeLanguage) {
			this.$changeCellLanguage(event.index, event.language);
		}

		this._versionId = event.versionId;
	}

	private $spliceNotebookCells(splices: NotebookCellsSplice2[]): void {
		if (!splices.length) {
			return;
		}

		splices.reverse().forEach(splice => {
			let cellDtos = splice[2];
			let newCells = cellDtos.map(cell => {
				const extCell = new ExtHostCell(this.viewType, this.uri, cell.handle, URI.revive(cell.uri), cell.source.join('\n'), cell.cellKind, cell.language, cell.outputs, cell.metadata, this._proxy);
				const documentData = this._documentsAndEditors.getDocument(URI.revive(cell.uri));

				if (documentData) {
					extCell.attachTextDocument(documentData);
				}

				if (!this._cellDisposableMapping.has(extCell.handle)) {
					this._cellDisposableMapping.set(extCell.handle, new DisposableStore());
				}

				let store = this._cellDisposableMapping.get(extCell.handle)!;

				store.add(extCell.onDidChangeOutputs((diffs) => {
					this.eventuallyUpdateCellOutputs(extCell, diffs);
				}));

				return extCell;
			});

			for (let j = splice[0]; j < splice[0] + splice[1]; j++) {
				this._cellDisposableMapping.get(this.cells[j].handle)?.dispose();
				this._cellDisposableMapping.delete(this.cells[j].handle);

			}

			this.cells.splice(splice[0], splice[1], ...newCells);
		});
	}

	private $moveCell(index: number, newIdx: number) {
		const cells = this.cells.splice(index, 1);
		this.cells.splice(newIdx, 0, ...cells);
	}

	private $clearCellOutputs(index: number) {
		const cell = this.cells[index];
		cell.outputs = [];
	}

	private $clearAllCellOutputs() {
		this.cells.forEach(cell => cell.outputs = []);
	}

	private $changeCellLanguage(index: number, language: string) {
		const cell = this.cells[index];
		cell.language = language;
	}

	eventuallyUpdateCellOutputs(cell: ExtHostCell, diffs: ISplice<vscode.CellOutput>[]) {
		let renderers = new Set<number>();
		let outputDtos: NotebookCellOutputsSplice[] = diffs.map(diff => {
			let outputs = diff.toInsert;

			let transformedOutputs = outputs.map(output => {
				if (output.outputKind === CellOutputKind.Rich) {
					const ret = this.transformMimeTypes(output);

					if (ret.orderedMimeTypes[ret.pickedMimeTypeIndex].isResolved) {
						renderers.add(ret.orderedMimeTypes[ret.pickedMimeTypeIndex].rendererId!);
					}
					return ret;
				} else {
					return output as IStreamOutput | IErrorOutput;
				}
			});

			return [diff.start, diff.deleteCount, transformedOutputs];
		});

		this._proxy.$spliceNotebookCellOutputs(this.viewType, this.uri, cell.handle, outputDtos, Array.from(renderers));
	}

	transformMimeTypes(output: vscode.CellDisplayOutput): ITransformedDisplayOutputDto {
		let mimeTypes = Object.keys(output.data);
		let coreDisplayOrder = this.renderingHandler.outputDisplayOrder;
		const sorted = sortMimeTypes(mimeTypes, coreDisplayOrder?.userOrder || [], this._displayOrder, coreDisplayOrder?.defaultOrder || []);

		let orderMimeTypes: IOrderedMimeType[] = [];

		sorted.forEach(mimeType => {
			let handlers = this.renderingHandler.findBestMatchedRenderer(mimeType);

			if (handlers.length) {
				let renderedOutput = handlers[0].render(this, output, mimeType);

				orderMimeTypes.push({
					mimeType: mimeType,
					isResolved: true,
					rendererId: handlers[0].handle,
					output: renderedOutput
				});

				for (let i = 1; i < handlers.length; i++) {
					orderMimeTypes.push({
						mimeType: mimeType,
						isResolved: false,
						rendererId: handlers[i].handle
					});
				}

				if (mimeTypeSupportedByCore(mimeType)) {
					orderMimeTypes.push({
						mimeType: mimeType,
						isResolved: false,
						rendererId: -1
					});
				}
			} else {
				orderMimeTypes.push({
					mimeType: mimeType,
					isResolved: false
				});
			}
		});

		return {
			outputKind: output.outputKind,
			data: output.data,
			orderedMimeTypes: orderMimeTypes,
			pickedMimeTypeIndex: 0
		};
	}

	getCell(cellHandle: number) {
		return this.cells.find(cell => cell.handle === cellHandle);
	}

	attachCellTextDocument(textDocument: ExtHostDocumentData) {
		let cell = this.cells.find(cell => cell.uri.toString() === textDocument.document.uri.toString());
		if (cell) {
			cell.attachTextDocument(textDocument);
		}
	}

	detachCellTextDocument(textDocument: ExtHostDocumentData) {
		let cell = this.cells.find(cell => cell.uri.toString() === textDocument.document.uri.toString());
		if (cell) {
			cell.detachTextDocument();
		}
	}
}

export class NotebookEditorCellEditBuilder implements vscode.NotebookEditorCellEdit {
	private _finalized: boolean = false;
	private readonly _documentVersionId: number;
	private _collectedEdits: ICellEditOperation[] = [];
	private _renderers = new Set<number>();

	constructor(
		readonly editor: ExtHostNotebookEditor
	) {
		this._documentVersionId = editor.document.versionId;
	}

	finalize(): INotebookEditData {
		this._finalized = true;
		return {
			documentVersionId: this._documentVersionId,
			edits: this._collectedEdits,
			renderers: Array.from(this._renderers)
		};
	}

	private _throwIfFinalized() {
		if (this._finalized) {
			throw new Error('Edit is only valid while callback runs');
		}
	}

	insert(index: number, content: string | string[], language: string, type: CellKind, outputs: vscode.CellOutput[], metadata: vscode.NotebookCellMetadata | undefined): void {
		this._throwIfFinalized();

		const sourceArr = Array.isArray(content) ? content : content.split(/\r|\n|\r\n/g);
		let cell = {
			source: sourceArr,
			language,
			cellKind: type,
			outputs: (outputs as any[]), // TODO@rebornix
			metadata
		};

		const transformedOutputs = outputs.map(output => {
			if (output.outputKind === CellOutputKind.Rich) {
				const ret = this.editor.document.transformMimeTypes(output);

				if (ret.orderedMimeTypes[ret.pickedMimeTypeIndex].isResolved) {
					this._renderers.add(ret.orderedMimeTypes[ret.pickedMimeTypeIndex].rendererId!);
				}
				return ret;
			} else {
				return output as IStreamOutput | IErrorOutput;
			}
		});

		cell.outputs = transformedOutputs;

		this._collectedEdits.push({
			editType: CellEditType.Insert,
			index,
			cells: [cell]
		});
	}

	delete(index: number): void {
		this._throwIfFinalized();

		this._collectedEdits.push({
			editType: CellEditType.Delete,
			index,
			count: 1
		});
	}
}

export class ExtHostNotebookEditor extends Disposable implements vscode.NotebookEditor {
	private _viewColumn: vscode.ViewColumn | undefined;

	selection?: ExtHostCell = undefined;
	onDidReceiveMessage: vscode.Event<any> = this._onDidReceiveMessage.event;

	constructor(
		private readonly viewType: string,
		readonly id: string,
		public uri: URI,
		private _proxy: MainThreadNotebookShape,
		private _onDidReceiveMessage: Emitter<any>,
		public document: ExtHostNotebookDocument,
		private _documentsAndEditors: ExtHostDocumentsAndEditors
	) {
		super();
		this._register(this._documentsAndEditors.onDidAddDocuments(documents => {
			for (const documentData of documents) {
				let data = CellUri.parse(documentData.document.uri);
				if (data) {
					if (this.document.uri.toString() === data.notebook.toString()) {
						document.attachCellTextDocument(documentData);
					}
				}
			}
		}));

		this._register(this._documentsAndEditors.onDidRemoveDocuments(documents => {
			for (const documentData of documents) {
				let data = CellUri.parse(documentData.document.uri);
				if (data) {
					if (this.document.uri.toString() === data.notebook.toString()) {
						document.detachCellTextDocument(documentData);
					}
				}
			}
		}));
	}

	edit(callback: (editBuilder: NotebookEditorCellEditBuilder) => void): Thenable<boolean> {
		const edit = new NotebookEditorCellEditBuilder(this);
		callback(edit);
		return this._applyEdit(edit);
	}

	private _applyEdit(editBuilder: NotebookEditorCellEditBuilder): Promise<boolean> {
		const editData = editBuilder.finalize();

		// return when there is nothing to do
		if (editData.edits.length === 0) {
			return Promise.resolve(true);
		}

		let compressedEdits: ICellEditOperation[] = [];
		let compressedEditsIndex = -1;

		for (let i = 0; i < editData.edits.length; i++) {
			if (compressedEditsIndex < 0) {
				compressedEdits.push(editData.edits[i]);
				compressedEditsIndex++;
				continue;
			}

			let prevIndex = compressedEditsIndex;
			let prev = compressedEdits[prevIndex];

			if (prev.editType === CellEditType.Insert && editData.edits[i].editType === CellEditType.Insert) {
				if (prev.index === editData.edits[i].index) {
					prev.cells.push(...(editData.edits[i] as ICellInsertEdit).cells);
					continue;
				}
			}

			if (prev.editType === CellEditType.Delete && editData.edits[i].editType === CellEditType.Delete) {
				if (prev.index === editData.edits[i].index) {
					prev.count += (editData.edits[i] as ICellDeleteEdit).count;
					continue;
				}
			}

			compressedEdits.push(editData.edits[i]);
			compressedEditsIndex++;
		}

		return this._proxy.$tryApplyEdits(this.viewType, this.uri, editData.documentVersionId, compressedEdits, editData.renderers);
	}

	get viewColumn(): vscode.ViewColumn | undefined {
		return this._viewColumn;
	}

	set viewColumn(value) {
		throw readonly('viewColumn');
	}

	async postMessage(message: any): Promise<boolean> {
		return this._proxy.$postMessage(this.document.handle, message);
	}

}

export class ExtHostNotebookOutputRenderer {
	private static _handlePool: number = 0;
	readonly handle = ExtHostNotebookOutputRenderer._handlePool++;

	constructor(
		public type: string,
		public filter: vscode.NotebookOutputSelector,
		public renderer: vscode.NotebookOutputRenderer
	) {

	}

	matches(mimeType: string): boolean {
		if (this.filter.subTypes) {
			if (this.filter.subTypes.indexOf(mimeType) >= 0) {
				return true;
			}
		}
		return false;
	}

	render(document: ExtHostNotebookDocument, output: vscode.CellDisplayOutput, mimeType: string): string {
		let html = this.renderer.render(document, output, mimeType);

		return html;
	}
}

export interface ExtHostNotebookOutputRenderingHandler {
	outputDisplayOrder: INotebookDisplayOrder | undefined;
	findBestMatchedRenderer(mimeType: string): ExtHostNotebookOutputRenderer[];
}

export class ExtHostNotebookController implements ExtHostNotebookShape, ExtHostNotebookOutputRenderingHandler {
	private static _handlePool: number = 0;

	private readonly _proxy: MainThreadNotebookShape;
	private readonly _notebookContentProviders = new Map<string, { readonly provider: vscode.NotebookContentProvider, readonly extension: IExtensionDescription; }>();
	private readonly _documents = new Map<string, ExtHostNotebookDocument>();
	private readonly _editors = new Map<string, { editor: ExtHostNotebookEditor, onDidReceiveMessage: Emitter<any>; }>();
	private readonly _notebookOutputRenderers = new Map<number, ExtHostNotebookOutputRenderer>();

	private readonly _onDidChangeNotebookDocument = new Emitter<{ document: ExtHostNotebookDocument, changes: NotebookCellsChangedEvent[]; }>();
	readonly onDidChangeNotebookDocument: Event<{ document: ExtHostNotebookDocument, changes: NotebookCellsChangedEvent[]; }> = this._onDidChangeNotebookDocument.event;

	private _outputDisplayOrder: INotebookDisplayOrder | undefined;

	get outputDisplayOrder(): INotebookDisplayOrder | undefined {
		return this._outputDisplayOrder;
	}

	private _activeNotebookDocument: ExtHostNotebookDocument | undefined;

	get activeNotebookDocument() {
		return this._activeNotebookDocument;
	}

	private _activeNotebookEditor: ExtHostNotebookEditor | undefined;

	get activeNotebookEditor() {
		return this._activeNotebookEditor;
	}

	private _onDidOpenNotebookDocument = new Emitter<vscode.NotebookDocument>();
	onDidOpenNotebookDocument: Event<vscode.NotebookDocument> = this._onDidOpenNotebookDocument.event;
	private _onDidCloseNotebookDocument = new Emitter<vscode.NotebookDocument>();
	onDidCloseNotebookDocument: Event<vscode.NotebookDocument> = this._onDidCloseNotebookDocument.event;

	constructor(mainContext: IMainContext, commands: ExtHostCommands, private _documentsAndEditors: ExtHostDocumentsAndEditors) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadNotebook);

		commands.registerArgumentProcessor({
			processArgument: arg => {
				if (arg && arg.$mid === 12) {
					const documentHandle = arg.notebookEditor?.notebookHandle;
					const cellHandle = arg.cell.handle;

					for (let value of this._editors) {
						if (value[1].editor.document.handle === documentHandle) {
							const cell = value[1].editor.document.getCell(cellHandle);
							if (cell) {
								return cell;
							}
						}
					}
				}
				return arg;
			}
		});
	}

	registerNotebookOutputRenderer(
		type: string,
		extension: IExtensionDescription,
		filter: vscode.NotebookOutputSelector,
		renderer: vscode.NotebookOutputRenderer
	): vscode.Disposable {
		let extHostRenderer = new ExtHostNotebookOutputRenderer(type, filter, renderer);
		this._notebookOutputRenderers.set(extHostRenderer.handle, extHostRenderer);
		this._proxy.$registerNotebookRenderer({ id: extension.identifier, location: extension.extensionLocation }, type, filter, extHostRenderer.handle, renderer.preloads || []);
		return new VSCodeDisposable(() => {
			this._notebookOutputRenderers.delete(extHostRenderer.handle);
			this._proxy.$unregisterNotebookRenderer(extHostRenderer.handle);
		});
	}

	findBestMatchedRenderer(mimeType: string): ExtHostNotebookOutputRenderer[] {
		let matches: ExtHostNotebookOutputRenderer[] = [];
		for (let renderer of this._notebookOutputRenderers) {
			if (renderer[1].matches(mimeType)) {
				matches.push(renderer[1]);
			}
		}

		return matches;
	}

	registerNotebookContentProvider(
		extension: IExtensionDescription,
		viewType: string,
		provider: vscode.NotebookContentProvider,
	): vscode.Disposable {

		if (this._notebookContentProviders.has(viewType)) {
			throw new Error(`Notebook provider for '${viewType}' already registered`);
		}

		this._notebookContentProviders.set(viewType, { extension, provider });
		this._proxy.$registerNotebookProvider({ id: extension.identifier, location: extension.extensionLocation }, viewType);
		return new VSCodeDisposable(() => {
			this._notebookContentProviders.delete(viewType);
			this._proxy.$unregisterNotebookProvider(viewType);
		});
	}

	async $resolveNotebookData(viewType: string, uri: UriComponents): Promise<NotebookDataDto | undefined> {
		let provider = this._notebookContentProviders.get(viewType);
		let document = this._documents.get(URI.revive(uri).toString());

		if (provider && document) {
			const rawCells = await provider.provider.openNotebook(URI.revive(uri));
			const renderers = new Set<number>();
			const dto = {
				metadata: {
					...notebookDocumentMetadataDefaults,
					...rawCells.metadata
				},
				languages: rawCells.languages,
				cells: rawCells.cells.map(cell => {
					let transformedOutputs = cell.outputs.map(output => {
						if (output.outputKind === CellOutputKind.Rich) {
							// TODO display string[]
							const ret = this._transformMimeTypes(document!, (rawCells.metadata.displayOrder as string[]) || [], output);

							if (ret.orderedMimeTypes[ret.pickedMimeTypeIndex].isResolved) {
								renderers.add(ret.orderedMimeTypes[ret.pickedMimeTypeIndex].rendererId!);
							}
							return ret;
						} else {
							return output as IStreamOutput | IErrorOutput;
						}
					});

					return {
						language: cell.language,
						cellKind: cell.cellKind,
						metadata: cell.metadata,
						source: cell.source,
						outputs: transformedOutputs
					};
				})
			};

			return dto;
		}

		return;
	}

	private _transformMimeTypes(document: ExtHostNotebookDocument, displayOrder: string[], output: vscode.CellDisplayOutput): ITransformedDisplayOutputDto {
		let mimeTypes = Object.keys(output.data);
		let coreDisplayOrder = this.outputDisplayOrder;
		const sorted = sortMimeTypes(mimeTypes, coreDisplayOrder?.userOrder || [], displayOrder, coreDisplayOrder?.defaultOrder || []);

		let orderMimeTypes: IOrderedMimeType[] = [];

		sorted.forEach(mimeType => {
			let handlers = this.findBestMatchedRenderer(mimeType);

			if (handlers.length) {
				let renderedOutput = handlers[0].render(document, output, mimeType);

				orderMimeTypes.push({
					mimeType: mimeType,
					isResolved: true,
					rendererId: handlers[0].handle,
					output: renderedOutput
				});

				for (let i = 1; i < handlers.length; i++) {
					orderMimeTypes.push({
						mimeType: mimeType,
						isResolved: false,
						rendererId: handlers[i].handle
					});
				}

				if (mimeTypeSupportedByCore(mimeType)) {
					orderMimeTypes.push({
						mimeType: mimeType,
						isResolved: false,
						rendererId: -1
					});
				}
			} else {
				orderMimeTypes.push({
					mimeType: mimeType,
					isResolved: false
				});
			}
		});

		return {
			outputKind: output.outputKind,
			data: output.data,
			orderedMimeTypes: orderMimeTypes,
			pickedMimeTypeIndex: 0
		};
	}

	async $executeNotebook(viewType: string, uri: UriComponents, cellHandle: number | undefined, token: CancellationToken): Promise<void> {
		let document = this._documents.get(URI.revive(uri).toString());

		if (!document) {
			return;
		}

		if (this._notebookContentProviders.has(viewType)) {
			let cell = cellHandle !== undefined ? document.getCell(cellHandle) : undefined;

			return this._notebookContentProviders.get(viewType)!.provider.executeCell(document, cell, token);
		}
	}

	async $saveNotebook(viewType: string, uri: UriComponents, token: CancellationToken): Promise<boolean> {
		let document = this._documents.get(URI.revive(uri).toString());
		if (!document) {
			return false;
		}

		if (this._notebookContentProviders.has(viewType)) {
			try {
				await this._notebookContentProviders.get(viewType)!.provider.saveNotebook(document, token);
			} catch (e) {
				return false;
			}

			return true;
		}

		return false;
	}

	async $saveNotebookAs(viewType: string, uri: UriComponents, target: UriComponents, token: CancellationToken): Promise<boolean> {
		let document = this._documents.get(URI.revive(uri).toString());
		if (!document) {
			return false;
		}

		if (this._notebookContentProviders.has(viewType)) {
			try {
				await this._notebookContentProviders.get(viewType)!.provider.saveNotebookAs(URI.revive(target), document, token);
			} catch (e) {
				return false;
			}

			return true;
		}

		return false;
	}

	$acceptDisplayOrder(displayOrder: INotebookDisplayOrder): void {
		this._outputDisplayOrder = displayOrder;
	}

	$onDidReceiveMessage(uri: UriComponents, message: any): void {
		let editor = this._editors.get(URI.revive(uri).toString());

		if (editor) {
			editor.onDidReceiveMessage.fire(message);
		}
	}

	$acceptModelChanged(uriComponents: UriComponents, event: NotebookCellsChangedEvent): void {
		let editor = this._editors.get(URI.revive(uriComponents).toString());

		if (editor) {
			editor.editor.document.accpetModelChanged(event);
			this._onDidChangeNotebookDocument.fire({
				document: editor.editor.document,
				changes: [event]
			});
		}

	}

	$acceptEditorPropertiesChanged(uriComponents: UriComponents, data: INotebookEditorPropertiesChangeData): void {
		let editor = this._editors.get(URI.revive(uriComponents).toString());

		if (!editor) {
			return;
		}

		if (data.selections) {
			const cells = editor.editor.document.cells;

			if (data.selections.selections.length) {
				const firstCell = data.selections.selections[0];
				editor.editor.selection = cells.find(cell => cell.handle === firstCell);
			} else {
				editor.editor.selection = undefined;
			}
		}
	}

	async $acceptDocumentAndEditorsDelta(delta: INotebookDocumentsAndEditorsDelta) {
		if (delta.removedDocuments) {
			delta.removedDocuments.forEach((uri) => {
				let document = this._documents.get(URI.revive(uri).toString());

				if (document) {
					document.dispose();
					this._documents.delete(URI.revive(uri).toString());
					this._onDidCloseNotebookDocument.fire(document);
				}

				let editor = this._editors.get(URI.revive(uri).toString());

				if (editor) {
					editor.editor.dispose();
					editor.onDidReceiveMessage.dispose();
					this._editors.delete(URI.revive(uri).toString());
				}
			});
		}

		if (delta.addedDocuments) {
			delta.addedDocuments.forEach(modelData => {
				const revivedUri = URI.revive(modelData.uri);
				const viewType = modelData.viewType;
				if (!this._documents.has(revivedUri.toString())) {
					let document = new ExtHostNotebookDocument(this._proxy, this._documentsAndEditors, viewType, revivedUri, this);
					this._documents.set(revivedUri.toString(), document);
				}

				const onDidReceiveMessage = new Emitter<any>();
				const document = this._documents.get(revivedUri.toString())!;

				let editor = new ExtHostNotebookEditor(
					viewType,
					`${ExtHostNotebookController._handlePool++}`,
					revivedUri,
					this._proxy,
					onDidReceiveMessage,
					document,
					this._documentsAndEditors
				);

				this._onDidOpenNotebookDocument.fire(document);

				// TODO, does it already exist?
				this._editors.set(revivedUri.toString(), { editor, onDidReceiveMessage });
			});
		}

		if (delta.newActiveEditor) {
			this._activeNotebookDocument = this._documents.get(URI.revive(delta.newActiveEditor).toString());
			this._activeNotebookEditor = this._editors.get(URI.revive(delta.newActiveEditor).toString())?.editor;
		}
	}
}
