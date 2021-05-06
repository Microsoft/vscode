/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { timeout } from 'vs/base/common/async';
import { VSBuffer } from 'vs/base/common/buffer';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { IRelativePattern } from 'vs/base/common/glob';
import { hash } from 'vs/base/common/hash';
import { IdGenerator } from 'vs/base/common/idGenerator';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ResourceMap } from 'vs/base/common/map';
import { isFalsyOrWhitespace } from 'vs/base/common/strings';
import { assertIsDefined } from 'vs/base/common/types';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { Cache } from 'vs/workbench/api/common/cache';
import { ExtHostNotebookShape, IMainContext, IModelAddedData, INotebookCellStatusBarListDto, INotebookDocumentPropertiesChangeData, INotebookDocumentsAndEditorsDelta, INotebookDocumentShowOptions, INotebookEditorAddData, INotebookEditorPropertiesChangeData, INotebookEditorViewColumnInfo, MainContext, MainThreadNotebookDocumentsShape, MainThreadNotebookEditorsShape, MainThreadNotebookShape } from 'vs/workbench/api/common/extHost.protocol';
import { CommandsConverter, ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { IExtensionStoragePaths } from 'vs/workbench/api/common/extHostStoragePaths';
import * as typeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import { CellEditType, IImmediateCellEditOperation, INotebookExclusiveDocumentFilter, NotebookCellsChangedEventDto, NotebookCellsChangeType, NotebookDataDto, NullablePartialNotebookCellMetadata } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import type * as vscode from 'vscode';
import { ExtHostCell, ExtHostNotebookDocument } from './extHostNotebookDocument';
import { ExtHostNotebookEditor } from './extHostNotebookEditor';


export class NotebookEditorDecorationType {

	private static readonly _Keys = new IdGenerator('NotebookEditorDecorationType');

	readonly value: vscode.NotebookEditorDecorationType;

	constructor(proxy: MainThreadNotebookEditorsShape, options: vscode.NotebookDecorationRenderOptions) {
		const key = NotebookEditorDecorationType._Keys.nextId();
		proxy.$registerNotebookEditorDecorationType(key, typeConverters.NotebookDecorationRenderOptions.from(options));

		this.value = {
			key,
			dispose() {
				proxy.$removeNotebookEditorDecorationType(key);
			}
		};
	}
}


type NotebookContentProviderData = {
	readonly provider: vscode.NotebookContentProvider;
	readonly extension: IExtensionDescription;
};

export class ExtHostNotebookController implements ExtHostNotebookShape {
	private static _notebookStatusBarItemProviderHandlePool: number = 0;

	private readonly _notebookProxy: MainThreadNotebookShape;
	private readonly _notebookDocumentsProxy: MainThreadNotebookDocumentsShape;
	private readonly _notebookEditorsProxy: MainThreadNotebookEditorsShape;

	private readonly _notebookContentProviders = new Map<string, NotebookContentProviderData>();
	private readonly _notebookStatusBarItemProviders = new Map<number, vscode.NotebookCellStatusBarItemProvider>();
	private readonly _documents = new ResourceMap<ExtHostNotebookDocument>();
	private readonly _editors = new Map<string, ExtHostNotebookEditor>();
	private readonly _commandsConverter: CommandsConverter;
	private readonly _onDidChangeNotebookEditorSelection = new Emitter<vscode.NotebookEditorSelectionChangeEvent>();
	readonly onDidChangeNotebookEditorSelection = this._onDidChangeNotebookEditorSelection.event;
	private readonly _onDidChangeNotebookEditorVisibleRanges = new Emitter<vscode.NotebookEditorVisibleRangesChangeEvent>();
	readonly onDidChangeNotebookEditorVisibleRanges = this._onDidChangeNotebookEditorVisibleRanges.event;
	private readonly _onDidChangeNotebookDocumentMetadata = new Emitter<vscode.NotebookDocumentMetadataChangeEvent>();
	readonly onDidChangeNotebookDocumentMetadata = this._onDidChangeNotebookDocumentMetadata.event;
	private readonly _onDidChangeNotebookCells = new Emitter<vscode.NotebookCellsChangeEvent>();
	readonly onDidChangeNotebookCells = this._onDidChangeNotebookCells.event;
	private readonly _onDidChangeCellOutputs = new Emitter<vscode.NotebookCellOutputsChangeEvent>();
	readonly onDidChangeCellOutputs = this._onDidChangeCellOutputs.event;
	private readonly _onDidChangeCellMetadata = new Emitter<vscode.NotebookCellMetadataChangeEvent>();
	readonly onDidChangeCellMetadata = this._onDidChangeCellMetadata.event;
	private readonly _onDidChangeActiveNotebookEditor = new Emitter<vscode.NotebookEditor | undefined>();
	readonly onDidChangeActiveNotebookEditor = this._onDidChangeActiveNotebookEditor.event;
	private readonly _onDidChangeCellExecutionState = new Emitter<vscode.NotebookCellExecutionStateChangeEvent>();
	readonly onDidChangeNotebookCellExecutionState = this._onDidChangeCellExecutionState.event;

	private _activeNotebookEditor: ExtHostNotebookEditor | undefined;
	get activeNotebookEditor(): vscode.NotebookEditor | undefined {
		return this._activeNotebookEditor?.apiEditor;
	}
	private _visibleNotebookEditors: ExtHostNotebookEditor[] = [];
	get visibleNotebookEditors(): vscode.NotebookEditor[] {
		return this._visibleNotebookEditors.map(editor => editor.apiEditor);
	}

	private _onDidOpenNotebookDocument = new Emitter<vscode.NotebookDocument>();
	onDidOpenNotebookDocument: Event<vscode.NotebookDocument> = this._onDidOpenNotebookDocument.event;
	private _onDidCloseNotebookDocument = new Emitter<vscode.NotebookDocument>();
	onDidCloseNotebookDocument: Event<vscode.NotebookDocument> = this._onDidCloseNotebookDocument.event;
	private _onDidSaveNotebookDocument = new Emitter<vscode.NotebookDocument>();
	onDidSaveNotebookDocument: Event<vscode.NotebookDocument> = this._onDidSaveNotebookDocument.event;
	private _onDidChangeVisibleNotebookEditors = new Emitter<vscode.NotebookEditor[]>();
	onDidChangeVisibleNotebookEditors = this._onDidChangeVisibleNotebookEditors.event;

	private _activeExecutions = new ResourceMap<NotebookCellExecutionTask>();

	private _statusBarCache = new Cache<IDisposable>('NotebookCellStatusBarCache');

	constructor(
		mainContext: IMainContext,
		commands: ExtHostCommands,
		private _textDocumentsAndEditors: ExtHostDocumentsAndEditors,
		private _textDocuments: ExtHostDocuments,
		private readonly logService: ILogService,
		private readonly _extensionStoragePaths: IExtensionStoragePaths,
	) {
		this._notebookProxy = mainContext.getProxy(MainContext.MainThreadNotebook);
		this._notebookDocumentsProxy = mainContext.getProxy(MainContext.MainThreadNotebookDocuments);
		this._notebookEditorsProxy = mainContext.getProxy(MainContext.MainThreadNotebookEditors);
		this._commandsConverter = commands.converter;

		commands.registerArgumentProcessor({
			// Serialized INotebookCellActionContext
			processArgument: (arg) => {
				if (arg && arg.$mid === 12) {
					const notebookUri = arg.notebookEditor?.notebookUri;
					const cellHandle = arg.cell.handle;

					const data = this._documents.get(notebookUri);
					const cell = data?.getCell(cellHandle);
					if (cell) {
						return cell.apiCell;
					}
				}
				return arg;
			}
		});
	}

	getEditorById(editorId: string): ExtHostNotebookEditor | undefined {
		return this._editors.get(editorId);
	}

	getIdByEditor(editor: vscode.NotebookEditor): string | undefined {
		for (const [id, candidate] of this._editors) {
			if (candidate.apiEditor === editor) {
				return id;
			}
		}
		return undefined;
	}

	get notebookDocuments() {
		return [...this._documents.values()];
	}

	lookupNotebookDocument(uri: URI): ExtHostNotebookDocument | undefined {
		return this._documents.get(uri);
	}

	private _getNotebookDocument(uri: URI): ExtHostNotebookDocument {
		const result = this._documents.get(uri);
		if (!result) {
			throw new Error(`NO notebook document for '${uri}'`);
		}
		return result;
	}

	private _getProviderData(viewType: string): NotebookContentProviderData {
		const result = this._notebookContentProviders.get(viewType);
		if (!result) {
			throw new Error(`NO provider for '${viewType}'`);
		}
		return result;
	}

	registerNotebookContentProvider(
		extension: IExtensionDescription,
		viewType: string,
		provider: vscode.NotebookContentProvider,
		options?: vscode.NotebookDocumentContentOptions & {
			viewOptions?: {
				displayName: string;
				filenamePattern: (vscode.GlobPattern | { include: vscode.GlobPattern; exclude: vscode.GlobPattern })[];
				exclusive?: boolean;
			};
		}
	): vscode.Disposable {
		if (isFalsyOrWhitespace(viewType)) {
			throw new Error(`viewType cannot be empty or just whitespace`);
		}
		if (this._notebookContentProviders.has(viewType)) {
			throw new Error(`Notebook provider for '${viewType}' already registered`);
		}

		this._notebookContentProviders.set(viewType, { extension, provider });


		let listener: IDisposable | undefined;
		if (provider.onDidChangeNotebookContentOptions) {
			listener = provider.onDidChangeNotebookContentOptions(() => {
				const internalOptions = typeConverters.NotebookDocumentContentOptions.from(provider.options);
				this._notebookProxy.$updateNotebookProviderOptions(viewType, internalOptions);
			});
		}

		const viewOptionsFilenamePattern = options?.viewOptions?.filenamePattern
			.map(pattern => typeConverters.NotebookExclusiveDocumentPattern.from(pattern))
			.filter(pattern => pattern !== undefined) as (string | IRelativePattern | INotebookExclusiveDocumentFilter)[];

		if (options?.viewOptions?.filenamePattern && !viewOptionsFilenamePattern) {
			console.warn(`Notebook content provider view options file name pattern is invalid ${options?.viewOptions?.filenamePattern}`);
		}

		const internalOptions = typeConverters.NotebookDocumentContentOptions.from(options);
		this._notebookProxy.$registerNotebookProvider({ id: extension.identifier, location: extension.extensionLocation }, viewType, {
			transientOutputs: internalOptions.transientOutputs,
			transientCellMetadata: internalOptions.transientCellMetadata,
			transientDocumentMetadata: internalOptions.transientDocumentMetadata,
			viewOptions: options?.viewOptions && viewOptionsFilenamePattern ? { displayName: options.viewOptions.displayName, filenamePattern: viewOptionsFilenamePattern, exclusive: options.viewOptions.exclusive || false } : undefined
		});

		return new extHostTypes.Disposable(() => {
			listener?.dispose();
			this._notebookContentProviders.delete(viewType);
			this._notebookProxy.$unregisterNotebookProvider(viewType);
		});
	}

	registerNotebookCellStatusBarItemProvider(extension: IExtensionDescription, selector: vscode.NotebookSelector, provider: vscode.NotebookCellStatusBarItemProvider) {

		const handle = ExtHostNotebookController._notebookStatusBarItemProviderHandlePool++;
		const eventHandle = typeof provider.onDidChangeCellStatusBarItems === 'function' ? ExtHostNotebookController._notebookStatusBarItemProviderHandlePool++ : undefined;

		this._notebookStatusBarItemProviders.set(handle, provider);
		this._notebookProxy.$registerNotebookCellStatusBarItemProvider(handle, eventHandle, selector);

		let subscription: vscode.Disposable | undefined;
		if (eventHandle !== undefined) {
			subscription = provider.onDidChangeCellStatusBarItems!(_ => this._notebookProxy.$emitCellStatusBarEvent(eventHandle));
		}

		return new extHostTypes.Disposable(() => {
			this._notebookStatusBarItemProviders.delete(handle);
			this._notebookProxy.$unregisterNotebookCellStatusBarItemProvider(handle, eventHandle);
			if (subscription) {
				subscription.dispose();
			}
		});
	}

	createNotebookEditorDecorationType(options: vscode.NotebookDecorationRenderOptions): vscode.NotebookEditorDecorationType {
		return new NotebookEditorDecorationType(this._notebookEditorsProxy, options).value;
	}

	async openNotebookDocument(uri: URI): Promise<vscode.NotebookDocument> {
		const cached = this._documents.get(uri);
		if (cached) {
			return cached.apiNotebook;
		}
		const canonicalUri = await this._notebookDocumentsProxy.$tryOpenDocument(uri);
		const document = this._documents.get(URI.revive(canonicalUri));
		return assertIsDefined(document?.apiNotebook);
	}


	async showNotebookDocument(notebookOrUri: vscode.NotebookDocument | URI, options?: vscode.NotebookDocumentShowOptions): Promise<vscode.NotebookEditor> {

		if (URI.isUri(notebookOrUri)) {
			notebookOrUri = await this.openNotebookDocument(notebookOrUri);
		}

		let resolvedOptions: INotebookDocumentShowOptions;
		if (typeof options === 'object') {
			resolvedOptions = {
				position: typeConverters.ViewColumn.from(options.viewColumn),
				preserveFocus: options.preserveFocus,
				selections: options.selections && options.selections.map(typeConverters.NotebookRange.from),
				pinned: typeof options.preview === 'boolean' ? !options.preview : undefined
			};
		} else {
			resolvedOptions = {
				preserveFocus: false
			};
		}

		const editorId = await this._notebookEditorsProxy.$tryShowNotebookDocument(notebookOrUri.uri, notebookOrUri.viewType, resolvedOptions);
		const editor = editorId && this._editors.get(editorId)?.apiEditor;

		if (editor) {
			return editor;
		}

		if (editorId) {
			throw new Error(`Could NOT open editor for "${notebookOrUri.toString()}" because another editor opened in the meantime.`);
		} else {
			throw new Error(`Could NOT open editor for "${notebookOrUri.toString()}".`);
		}
	}

	async $provideNotebookCellStatusBarItems(handle: number, uri: UriComponents, index: number, token: CancellationToken): Promise<INotebookCellStatusBarListDto | undefined> {
		const provider = this._notebookStatusBarItemProviders.get(handle);
		const revivedUri = URI.revive(uri);
		const document = this._documents.get(revivedUri);
		if (!document || !provider) {
			return;
		}

		const cell = document.getCellFromIndex(index);
		if (!cell) {
			return;
		}

		const result = await provider.provideCellStatusBarItems(cell.apiCell, token);
		if (!result) {
			return undefined;
		}

		const disposables = new DisposableStore();
		const cacheId = this._statusBarCache.add([disposables]);
		const items = (result && result.map(item => typeConverters.NotebookStatusBarItem.from(item, this._commandsConverter, disposables))) ?? undefined;
		return {
			cacheId,
			items
		};
	}

	$releaseNotebookCellStatusBarItems(cacheId: number): void {
		this._statusBarCache.delete(cacheId);
	}

	// --- serialize/deserialize

	private _handlePool = 0;
	private readonly _notebookSerializer = new Map<number, vscode.NotebookSerializer>();

	registerNotebookSerializer(extension: IExtensionDescription, viewType: string, serializer: vscode.NotebookSerializer, options?: vscode.NotebookDocumentContentOptions): vscode.Disposable {
		if (isFalsyOrWhitespace(viewType)) {
			throw new Error(`viewType cannot be empty or just whitespace`);
		}
		const handle = this._handlePool++;
		this._notebookSerializer.set(handle, serializer);
		const internalOptions = typeConverters.NotebookDocumentContentOptions.from(options);
		this._notebookProxy.$registerNotebookSerializer(
			handle,
			{ id: extension.identifier, location: extension.extensionLocation },
			viewType,
			internalOptions
		);
		return toDisposable(() => {
			this._notebookProxy.$unregisterNotebookSerializer(handle);
		});
	}

	async $dataToNotebook(handle: number, bytes: VSBuffer, token: CancellationToken): Promise<NotebookDataDto> {
		const serializer = this._notebookSerializer.get(handle);
		if (!serializer) {
			throw new Error('NO serializer found');
		}
		const data = await serializer.deserializeNotebook(bytes.buffer, token);
		return {
			metadata: typeConverters.NotebookDocumentMetadata.from(data.metadata),
			cells: data.cells.map(typeConverters.NotebookCellData.from),
		};
	}

	async $notebookToData(handle: number, data: NotebookDataDto, token: CancellationToken): Promise<VSBuffer> {
		const serializer = this._notebookSerializer.get(handle);
		if (!serializer) {
			throw new Error('NO serializer found');
		}
		const bytes = await serializer.serializeNotebook({
			metadata: typeConverters.NotebookDocumentMetadata.to(data.metadata),
			cells: data.cells.map(typeConverters.NotebookCellData.to)
		}, token);
		return VSBuffer.wrap(bytes);
	}

	cancelOneNotebookCellExecution(cell: ExtHostCell): void {
		const execution = this._activeExecutions.get(cell.uri);
		execution?.cancel();
	}

	// --- open, save, saveAs, backup

	async $openNotebook(viewType: string, uri: UriComponents, backupId: string | undefined, untitledDocumentData: VSBuffer | undefined, token: CancellationToken): Promise<NotebookDataDto> {
		const { provider } = this._getProviderData(viewType);
		const data = await provider.openNotebook(URI.revive(uri), { backupId, untitledDocumentData: untitledDocumentData?.buffer }, token);
		return {
			metadata: typeConverters.NotebookDocumentMetadata.from(data.metadata),
			cells: data.cells.map(typeConverters.NotebookCellData.from),
		};
	}

	async $saveNotebook(viewType: string, uri: UriComponents, token: CancellationToken): Promise<boolean> {
		const document = this._getNotebookDocument(URI.revive(uri));
		const { provider } = this._getProviderData(viewType);
		await provider.saveNotebook(document.apiNotebook, token);
		return true;
	}

	async $saveNotebookAs(viewType: string, uri: UriComponents, target: UriComponents, token: CancellationToken): Promise<boolean> {
		const document = this._getNotebookDocument(URI.revive(uri));
		const { provider } = this._getProviderData(viewType);
		await provider.saveNotebookAs(URI.revive(target), document.apiNotebook, token);
		return true;
	}

	private _backupIdPool: number = 0;

	async $backupNotebook(viewType: string, uri: UriComponents, cancellation: CancellationToken): Promise<string> {
		const document = this._getNotebookDocument(URI.revive(uri));
		const provider = this._getProviderData(viewType);

		const storagePath = this._extensionStoragePaths.workspaceValue(provider.extension) ?? this._extensionStoragePaths.globalValue(provider.extension);
		const fileName = String(hash([document.uri.toString(), this._backupIdPool++]));
		const backupUri = URI.joinPath(storagePath, fileName);

		const backup = await provider.provider.backupNotebook(document.apiNotebook, { destination: backupUri }, cancellation);
		document.updateBackup(backup);
		return backup.id;
	}

	$acceptModelChanged(uri: UriComponents, event: NotebookCellsChangedEventDto, isDirty: boolean): void {
		const document = this._getNotebookDocument(URI.revive(uri));
		document.acceptModelChanged(event, isDirty);
	}

	$acceptDirtyStateChanged(uri: UriComponents, isDirty: boolean): void {
		const document = this._getNotebookDocument(URI.revive(uri));
		document.acceptModelChanged({ rawEvents: [], versionId: document.apiNotebook.version }, isDirty);
	}

	$acceptModelSaved(uri: UriComponents): void {
		const document = this._getNotebookDocument(URI.revive(uri));
		this._onDidSaveNotebookDocument.fire(document.apiNotebook);
	}

	$acceptEditorPropertiesChanged(id: string, data: INotebookEditorPropertiesChangeData): void {
		this.logService.debug('ExtHostNotebook#$acceptEditorPropertiesChanged', id, data);

		const editor = this._editors.get(id);
		if (!editor) {
			throw new Error(`unknown text editor: ${id}. known editors: ${[...this._editors.keys()]} `);
		}

		// ONE: make all state updates
		if (data.visibleRanges) {
			editor._acceptVisibleRanges(data.visibleRanges.ranges.map(typeConverters.NotebookRange.to));
		}
		if (data.selections) {
			editor._acceptSelections(data.selections.selections.map(typeConverters.NotebookRange.to));
		}

		// TWO: send all events after states have been updated
		if (data.visibleRanges) {
			this._onDidChangeNotebookEditorVisibleRanges.fire({
				notebookEditor: editor.apiEditor,
				visibleRanges: editor.apiEditor.visibleRanges
			});
		}
		if (data.selections) {
			this._onDidChangeNotebookEditorSelection.fire(Object.freeze({
				notebookEditor: editor.apiEditor,
				selections: editor.apiEditor.selections
			}));
		}
	}

	$acceptEditorViewColumns(data: INotebookEditorViewColumnInfo): void {
		for (const id in data) {
			const editor = this._editors.get(id);
			if (!editor) {
				throw new Error(`unknown text editor: ${id}. known editors: ${[...this._editors.keys()]} `);
			}
			editor._acceptViewColumn(typeConverters.ViewColumn.to(data[id]));
		}
	}

	$acceptDocumentPropertiesChanged(uri: UriComponents, data: INotebookDocumentPropertiesChangeData): void {
		this.logService.debug('ExtHostNotebook#$acceptDocumentPropertiesChanged', uri.path, data);
		const document = this._getNotebookDocument(URI.revive(uri));
		document.acceptDocumentPropertiesChanged(data);
		if (data.metadata) {
			this._onDidChangeNotebookDocumentMetadata.fire({ document: document.apiNotebook });
		}
	}

	private _createExtHostEditor(document: ExtHostNotebookDocument, editorId: string, data: INotebookEditorAddData) {

		if (this._editors.has(editorId)) {
			throw new Error(`editor with id ALREADY EXSIST: ${editorId}`);
		}

		const editor = new ExtHostNotebookEditor(
			editorId,
			this._notebookEditorsProxy,
			document,
			data.visibleRanges.map(typeConverters.NotebookRange.to),
			data.selections.map(typeConverters.NotebookRange.to),
			typeof data.viewColumn === 'number' ? typeConverters.ViewColumn.to(data.viewColumn) : undefined
		);

		this._editors.set(editorId, editor);
	}

	$acceptDocumentAndEditorsDelta(delta: INotebookDocumentsAndEditorsDelta): void {

		if (delta.removedDocuments) {
			for (const uri of delta.removedDocuments) {
				const revivedUri = URI.revive(uri);
				const document = this._documents.get(revivedUri);

				if (document) {
					document.dispose();
					this._documents.delete(revivedUri);
					this._textDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({ removedDocuments: document.apiNotebook.getCells().map(cell => cell.document.uri) });
					this._onDidCloseNotebookDocument.fire(document.apiNotebook);
				}

				for (const editor of this._editors.values()) {
					if (editor.notebookData.uri.toString() === revivedUri.toString()) {
						this._editors.delete(editor.id);
					}
				}
			}
		}

		if (delta.addedDocuments) {

			const addedCellDocuments: IModelAddedData[] = [];

			for (const modelData of delta.addedDocuments) {
				const uri = URI.revive(modelData.uri);
				const viewType = modelData.viewType;

				if (this._documents.has(uri)) {
					throw new Error(`adding EXISTING notebook ${uri} `);
				}
				const that = this;

				const document = new ExtHostNotebookDocument(
					this._notebookDocumentsProxy,
					this._textDocumentsAndEditors,
					this._textDocuments,
					{
						emitModelChange(event: vscode.NotebookCellsChangeEvent): void {
							that._onDidChangeNotebookCells.fire(event);
						},
						emitCellOutputsChange(event: vscode.NotebookCellOutputsChangeEvent): void {
							that._onDidChangeCellOutputs.fire(event);
						},
						emitCellMetadataChange(event: vscode.NotebookCellMetadataChangeEvent): void {
							that._onDidChangeCellMetadata.fire(event);
						},
						emitCellExecutionStateChange(event: vscode.NotebookCellExecutionStateChangeEvent): void {
							that._onDidChangeCellExecutionState.fire(event);
						}
					},
					viewType,
					modelData.metadata ? typeConverters.NotebookDocumentMetadata.to(modelData.metadata) : new extHostTypes.NotebookDocumentMetadata(),
					uri,
				);

				document.acceptModelChanged({
					versionId: modelData.versionId,
					rawEvents: [{
						kind: NotebookCellsChangeType.Initialize,
						changes: [[0, 0, modelData.cells]]
					}]
				}, false);

				// add cell document as vscode.TextDocument
				addedCellDocuments.push(...modelData.cells.map(cell => ExtHostCell.asModelAddData(document.apiNotebook, cell)));

				this._documents.get(uri)?.dispose();
				this._documents.set(uri, document);
				this._textDocumentsAndEditors.$acceptDocumentsAndEditorsDelta({ addedDocuments: addedCellDocuments });

				this._onDidOpenNotebookDocument.fire(document.apiNotebook);
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
					this._createExtHostEditor(document, editorModelData.id, editorModelData);
				}
			}
		}

		const removedEditors: ExtHostNotebookEditor[] = [];

		if (delta.removedEditors) {
			for (const editorid of delta.removedEditors) {
				const editor = this._editors.get(editorid);

				if (editor) {
					this._editors.delete(editorid);

					if (this._activeNotebookEditor?.id === editor.id) {
						this._activeNotebookEditor = undefined;
					}

					removedEditors.push(editor);
				}
			}
		}

		if (delta.visibleEditors) {
			this._visibleNotebookEditors = delta.visibleEditors.map(id => this._editors.get(id)!).filter(editor => !!editor) as ExtHostNotebookEditor[];
			const visibleEditorsSet = new Set<string>();
			this._visibleNotebookEditors.forEach(editor => visibleEditorsSet.add(editor.id));

			for (const editor of this._editors.values()) {
				const newValue = visibleEditorsSet.has(editor.id);
				editor._acceptVisibility(newValue);
			}

			this._visibleNotebookEditors = [...this._editors.values()].map(e => e).filter(e => e.visible);
			this._onDidChangeVisibleNotebookEditors.fire(this.visibleNotebookEditors);
		}

		if (delta.newActiveEditor === null) {
			// clear active notebook as current active editor is non-notebook editor
			this._activeNotebookEditor = undefined;
		} else if (delta.newActiveEditor) {
			this._activeNotebookEditor = this._editors.get(delta.newActiveEditor);
		}
		if (delta.newActiveEditor !== undefined) {
			this._onDidChangeActiveNotebookEditor.fire(this._activeNotebookEditor?.apiEditor);
		}
	}
	createNotebookCellExecution(docUri: vscode.Uri, index: number, kernelId: string): vscode.NotebookCellExecutionTask | undefined {
		const document = this.lookupNotebookDocument(docUri);
		if (!document) {
			throw new Error(`Invalid uri: ${docUri} `);
		}

		const cell = document.getCellFromIndex(index);
		if (!cell) {
			throw new Error(`Invalid cell index: ${docUri}, ${index} `);
		}

		// TODO@roblou also validate kernelId, once kernel has moved from editor to document
		if (this._activeExecutions.has(cell.uri)) {
			throw new Error(`duplicate execution for ${cell.uri}`);
		}

		const execution = new NotebookCellExecutionTask(docUri, document, cell, this._notebookDocumentsProxy);
		this._activeExecutions.set(cell.uri, execution);
		const listener = execution.onDidChangeState(() => {
			if (execution.state === NotebookCellExecutionTaskState.Resolved) {
				execution.dispose();
				listener.dispose();
				this._activeExecutions.delete(cell.uri);
			}
		});

		return execution.asApiObject();
	}
}

enum NotebookCellExecutionTaskState {
	Init,
	Started,
	Resolved
}

class NotebookCellExecutionTask extends Disposable {
	private _onDidChangeState = new Emitter<void>();
	readonly onDidChangeState = this._onDidChangeState.event;

	private _state = NotebookCellExecutionTaskState.Init;
	get state(): NotebookCellExecutionTaskState { return this._state; }

	private readonly _tokenSource = this._register(new CancellationTokenSource());

	private readonly _collector: TimeoutBasedCollector<IImmediateCellEditOperation>;

	private _executionOrder: number | undefined;

	constructor(
		private readonly _uri: vscode.Uri,
		private readonly _document: ExtHostNotebookDocument,
		private readonly _cell: ExtHostCell,
		private readonly _proxy: MainThreadNotebookDocumentsShape) {
		super();

		this._collector = new TimeoutBasedCollector(10, edits => this.applyEdits(edits));

		this._executionOrder = _cell.internalMetadata.executionOrder;
		this.mixinMetadata({
			runState: extHostTypes.NotebookCellExecutionState.Pending,
			executionOrder: null
		});
	}

	cancel(): void {
		this._tokenSource.cancel();
	}

	private async applyEditSoon(edit: IImmediateCellEditOperation): Promise<void> {
		await this._collector.addItem(edit);
	}

	private async applyEdits(edits: IImmediateCellEditOperation[]): Promise<void> {
		return this._proxy.$applyEdits(this._uri, edits, false);
	}

	private verifyStateForOutput() {
		if (this._state === NotebookCellExecutionTaskState.Init) {
			throw new Error('Must call start before modifying cell output');
		}

		if (this._state === NotebookCellExecutionTaskState.Resolved) {
			throw new Error('Cannot modify cell output after calling resolve');
		}
	}

	private mixinMetadata(mixinMetadata: NullablePartialNotebookCellMetadata) {
		const edit: IImmediateCellEditOperation = { editType: CellEditType.PartialMetadata, handle: this._cell.handle, metadata: mixinMetadata };
		this.applyEdits([edit]);
	}

	private cellIndexToHandle(cellIndex: number | undefined): number | undefined {
		const cell = typeof cellIndex === 'number' ? this._document.getCellFromIndex(cellIndex) : this._cell;
		if (!cell) {
			return;
		}

		return cell.handle;
	}

	asApiObject(): vscode.NotebookCellExecutionTask {
		const that = this;
		return Object.freeze(<vscode.NotebookCellExecutionTask>{
			get document() { return that._document.apiNotebook; },
			get cell() { return that._cell.apiCell; },

			get executionOrder() { return that._executionOrder; },
			set executionOrder(v: number | undefined) {
				that._executionOrder = v;
				that.mixinMetadata({
					executionOrder: v
				});
			},

			start(context?: vscode.NotebookCellExecuteStartContext): void {
				if (that._state === NotebookCellExecutionTaskState.Resolved || that._state === NotebookCellExecutionTaskState.Started) {
					throw new Error('Cannot call start again');
				}

				that._state = NotebookCellExecutionTaskState.Started;
				that._onDidChangeState.fire();

				that.mixinMetadata({
					runState: extHostTypes.NotebookCellExecutionState.Executing,
					runStartTime: context?.startTime ?? null
				});
			},

			end(result?: vscode.NotebookCellExecuteEndContext): void {
				if (that._state === NotebookCellExecutionTaskState.Resolved) {
					throw new Error('Cannot call resolve twice');
				}

				that._state = NotebookCellExecutionTaskState.Resolved;
				that._onDidChangeState.fire();

				that.mixinMetadata({
					runState: extHostTypes.NotebookCellExecutionState.Idle,
					lastRunSuccess: result?.success ?? null,
					runEndTime: result?.endTime ?? null,
				});
			},

			clearOutput(cellIndex?: number): Thenable<void> {
				that.verifyStateForOutput();
				return this.replaceOutput([], cellIndex);
			},

			async appendOutput(outputs: vscode.NotebookCellOutput | vscode.NotebookCellOutput[], cellIndex?: number): Promise<void> {
				that.verifyStateForOutput();
				const handle = that.cellIndexToHandle(cellIndex);
				if (typeof handle !== 'number') {
					return;
				}

				outputs = Array.isArray(outputs) ? outputs : [outputs];
				return that.applyEditSoon({ editType: CellEditType.Output, handle, append: true, outputs: outputs.map(typeConverters.NotebookCellOutput.from) });
			},

			async replaceOutput(outputs: vscode.NotebookCellOutput | vscode.NotebookCellOutput[], cellIndex?: number): Promise<void> {
				that.verifyStateForOutput();
				const handle = that.cellIndexToHandle(cellIndex);
				if (typeof handle !== 'number') {
					return;
				}

				outputs = Array.isArray(outputs) ? outputs : [outputs];
				return that.applyEditSoon({ editType: CellEditType.Output, handle, outputs: outputs.map(typeConverters.NotebookCellOutput.from) });
			},

			async appendOutputItems(items: vscode.NotebookCellOutputItem | vscode.NotebookCellOutputItem[], outputId: string): Promise<void> {
				that.verifyStateForOutput();
				items = Array.isArray(items) ? items : [items];
				return that.applyEditSoon({ editType: CellEditType.OutputItems, append: true, items: items.map(typeConverters.NotebookCellOutputItem.from), outputId });
			},

			async replaceOutputItems(items: vscode.NotebookCellOutputItem | vscode.NotebookCellOutputItem[], outputId: string): Promise<void> {
				that.verifyStateForOutput();
				items = Array.isArray(items) ? items : [items];
				return that.applyEditSoon({ editType: CellEditType.OutputItems, items: items.map(typeConverters.NotebookCellOutputItem.from), outputId });
			},

			token: that._tokenSource.token
		});
	}
}

class TimeoutBasedCollector<T> {
	private batch: T[] = [];
	private waitPromise: Promise<void> | undefined;

	constructor(
		private readonly delay: number,
		private readonly callback: (items: T[]) => Promise<void>) { }

	addItem(item: T): Promise<void> {
		this.batch.push(item);
		if (!this.waitPromise) {
			this.waitPromise = timeout(this.delay).then(() => {
				this.waitPromise = undefined;
				const batch = this.batch;
				this.batch = [];
				return this.callback(batch);
			});
		}

		return this.waitPromise;
	}
}
