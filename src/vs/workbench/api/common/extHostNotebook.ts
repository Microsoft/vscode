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
import { CellKind, CellOutputKind, ExtHostNotebookShape, IMainContext, MainContext, MainThreadNotebookShape, NotebookCellOutputsSplice } from 'vs/workbench/api/common/extHost.protocol';
import { ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { CellEditType, CellUri, diff, ICellEditOperation, ICellInsertEdit, IErrorOutput, INotebookDisplayOrder, INotebookEditData, IOrderedMimeType, IStreamOutput, ITransformedDisplayOutputDto, mimeTypeSupportedByCore, NotebookCellsChangedEvent, NotebookCellsSplice2, sortMimeTypes, ICellDeleteEdit } from 'vs/workbench/services/notebook/common/notebookCommon';
import { Disposable as VSCodeDisposable } from './extHostTypes';

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

const notebookDocumentMetadataDefaults: vscode.NotebookDocumentMetadata = {
	editable: true,
	cellEditable: true,
	cellRunnable: true
};

export class ExtHostCell extends Disposable implements vscode.NotebookCell {

	private originalSource: string[];
	private _outputs: any[];
	private _onDidChangeOutputs = new Emitter<ISplice<vscode.CellOutput>[]>();
	onDidChangeOutputs: Event<ISplice<vscode.CellOutput>[]> = this._onDidChangeOutputs.event;
	private _textDocument: vscode.TextDocument | undefined;
	private _initalVersion: number = -1;
	private _outputMapping = new Set<vscode.CellOutput>();
	private _metadata: vscode.NotebookCellMetadata;

	private _metadataChangeListener: IDisposable;

	get source() {
		if (this._textDocument && this._initalVersion !== this._textDocument?.version) {
			return this._textDocument.getText();
		} else {
			return this.originalSource.join('\n');
		}
	}

	constructor(
		private viewType: string,
		private documentUri: URI,
		readonly handle: number,
		readonly uri: URI,
		private _content: string,
		public readonly cellKind: CellKind,
		public language: string,
		outputs: any[],
		_metadata: vscode.NotebookCellMetadata | undefined,
		private _proxy: MainThreadNotebookShape
	) {
		super();
		this.originalSource = this._content.split(/\r|\n|\r\n/g);
		this._outputs = outputs;

		const observableMetadata = getObservable(_metadata || {} as any);
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
		this._metadataChangeListener.dispose();
		const observableMetadata = getObservable(newMetadata || {} as any); // TODO defaults
		this._metadata = observableMetadata.proxy;
		this._metadataChangeListener = this._register(observableMetadata.onDidChange(() => {
			this.updateMetadata();
		}));

		this.updateMetadata();
	}

	private updateMetadata(): Promise<void> {
		return this._proxy.$updateNotebookCellMetadata(this.viewType, this.documentUri, this.handle, this._metadata);
	}

	getContent(): string {
		if (this._textDocument && this._initalVersion !== this._textDocument?.version) {
			return this._textDocument.getText();
		} else {
			return this.originalSource.join('\n');
		}
	}

	attachTextDocument(document: vscode.TextDocument) {
		this._textDocument = document;
		this._initalVersion = this._textDocument.version;
	}

	detachTextDocument() {
		if (this._textDocument && this._textDocument.version !== this._initalVersion) {
			this.originalSource = this._textDocument.getText().split(/\r|\n|\r\n/g);
		}

		this._textDocument = undefined;
		this._initalVersion = -1;
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

	private _metadata: vscode.NotebookDocumentMetadata | undefined = notebookDocumentMetadataDefaults;

	get metadata() {
		return this._metadata;
	}

	set metadata(newMetadata: vscode.NotebookDocumentMetadata | undefined) {
		this._metadata = newMetadata || notebookDocumentMetadataDefaults;
		this._proxy.$updateNotebookMetadata(this.viewType, this.uri, this._metadata);
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
	}

	dispose() {
		super.dispose();
		this._cellDisposableMapping.forEach(cell => cell.dispose());
	}

	get fileName() { return this.uri.fsPath; }

	get isDirty() { return false; }

	accpetModelChanged(event: NotebookCellsChangedEvent) {
		this.$spliceNotebookCells(event.changes);
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
				const document = this._documentsAndEditors.getDocument(URI.revive(cell.uri));

				if (document) {
					extCell.attachTextDocument(document.document);
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

		// TODO@rebornix, the document display order might be assigned a bit later. We need to postpone sending the outputs to the core side.
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

	attachCellTextDocument(textDocument: vscode.TextDocument) {
		let cell = this.cells.find(cell => cell.uri.toString() === textDocument.uri.toString());
		if (cell) {
			cell.attachTextDocument(textDocument);
		}
	}

	detachCellTextDocument(textDocument: vscode.TextDocument) {
		let cell = this.cells.find(cell => cell.uri.toString() === textDocument.uri.toString());
		if (cell) {
			cell.detachTextDocument();
		}
	}
}

export class NotebookEditorCellEdit {
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

	insert(index: number, content: string, language: string, type: CellKind, outputs: vscode.CellOutput[], metadata: vscode.NotebookCellMetadata | undefined): void {
		this._throwIfFinalized();

		let cell = {
			source: [content],
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
			for (const { document: textDocument } of documents) {
				let data = CellUri.parse(textDocument.uri);
				if (data) {
					if (this.document.uri.toString() === data.notebook.toString()) {
						document.attachCellTextDocument(textDocument);
					}
				}
			}
		}));

		this._register(this._documentsAndEditors.onDidRemoveDocuments(documents => {
			for (const { document: textDocument } of documents) {
				let data = CellUri.parse(textDocument.uri);
				if (data) {
					if (this.document.uri.toString() === data.notebook.toString()) {
						document.detachCellTextDocument(textDocument);
					}
				}
			}
		}));
	}

	edit(callback: (editBuilder: NotebookEditorCellEdit) => void): Thenable<boolean> {
		const edit = new NotebookEditorCellEdit(this);
		callback(edit);
		return this._applyEdit(edit);
	}

	private _applyEdit(editBuilder: NotebookEditorCellEdit): Promise<boolean> {
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

	render(document: ExtHostNotebookDocument, output: vscode.CellOutput, mimeType: string): string {
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
	private readonly _notebookProviders = new Map<string, { readonly provider: vscode.NotebookProvider, readonly extension: IExtensionDescription; }>();
	private readonly _documents = new Map<string, ExtHostNotebookDocument>();
	private readonly _editors = new Map<string, { editor: ExtHostNotebookEditor, onDidReceiveMessage: Emitter<any> }>();
	private readonly _notebookOutputRenderers = new Map<number, ExtHostNotebookOutputRenderer>();
	private _outputDisplayOrder: INotebookDisplayOrder | undefined;

	get outputDisplayOrder(): INotebookDisplayOrder | undefined {
		return this._outputDisplayOrder;
	}

	private _activeNotebookDocument: ExtHostNotebookDocument | undefined;

	get activeNotebookDocument() {
		return this._activeNotebookDocument;
	}

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

	registerNotebookProvider(
		extension: IExtensionDescription,
		viewType: string,
		provider: vscode.NotebookProvider,
	): vscode.Disposable {

		if (this._notebookProviders.has(viewType)) {
			throw new Error(`Notebook provider for '${viewType}' already registered`);
		}

		this._notebookProviders.set(viewType, { extension, provider });
		this._proxy.$registerNotebookProvider({ id: extension.identifier, location: extension.extensionLocation }, viewType);
		return new VSCodeDisposable(() => {
			this._notebookProviders.delete(viewType);
			this._proxy.$unregisterNotebookProvider(viewType);
		});
	}

	async $resolveNotebook(viewType: string, uri: UriComponents): Promise<number | undefined> {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			if (!this._documents.has(URI.revive(uri).toString())) {
				let document = new ExtHostNotebookDocument(this._proxy, this._documentsAndEditors, viewType, URI.revive(uri), this);
				await this._proxy.$createNotebookDocument(
					document.handle,
					viewType,
					uri
				);

				this._documents.set(URI.revive(uri).toString(), document);
			}

			const onDidReceiveMessage = new Emitter<any>();

			let editor = new ExtHostNotebookEditor(
				viewType,
				`${ExtHostNotebookController._handlePool++}`,
				URI.revive(uri),
				this._proxy,
				onDidReceiveMessage,
				this._documents.get(URI.revive(uri).toString())!,
				this._documentsAndEditors
			);

			this._editors.set(URI.revive(uri).toString(), { editor, onDidReceiveMessage });
			await provider.provider.resolveNotebook(editor);
			// await editor.document.$updateCells();
			return editor.document.handle;
		}

		return Promise.resolve(undefined);
	}

	async $executeNotebook(viewType: string, uri: UriComponents, cellHandle: number | undefined): Promise<void> {
		let provider = this._notebookProviders.get(viewType);

		if (!provider) {
			return;
		}

		let document = this._documents.get(URI.revive(uri).toString());

		if (!document) {
			return;
		}

		let cell = cellHandle !== undefined ? document.getCell(cellHandle) : undefined;
		return provider.provider.executeCell(document!, cell);
	}

	async $saveNotebook(viewType: string, uri: UriComponents): Promise<boolean> {
		let provider = this._notebookProviders.get(viewType);
		let document = this._documents.get(URI.revive(uri).toString());

		if (provider && document) {
			return await provider.provider.save(document);
		}

		return false;
	}

	async $updateActiveEditor(viewType: string, uri: UriComponents): Promise<void> {
		this._activeNotebookDocument = this._documents.get(URI.revive(uri).toString());
	}

	async $destoryNotebookDocument(viewType: string, uri: UriComponents): Promise<boolean> {
		let provider = this._notebookProviders.get(viewType);

		if (!provider) {
			return false;
		}

		let document = this._documents.get(URI.revive(uri).toString());

		if (document) {
			document.dispose();
			this._documents.delete(URI.revive(uri).toString());
		}

		let editor = this._editors.get(URI.revive(uri).toString());

		if (editor) {
			editor.editor.dispose();
			editor.onDidReceiveMessage.dispose();
			this._editors.delete(URI.revive(uri).toString());
		}

		return true;
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
		}

	}
}
