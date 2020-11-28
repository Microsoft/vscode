/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import * as UUID from 'vs/base/common/uuid';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ExtHostNotebookShape, ICommandDto, IMainContext, IModelAddedData, INotebookDocumentPropertiesChangeData, INotebookDocumentsAndEditorsDelta, INotebookDocumentShowOptions, INotebookEditorPropertiesChangeData, MainContext, MainThreadBulkEditsShape, MainThreadNotebookShape } from 'vs/workbench/api/common/extHost.protocol';
import { ILogService } from 'vs/platform/log/common/log';
import { CommandsConverter, ExtHostCommands } from 'vs/workbench/api/common/extHostCommands';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { IExtensionStoragePaths } from 'vs/workbench/api/common/extHostStoragePaths';
import * as typeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import * as extHostTypes from 'vs/workbench/api/common/extHostTypes';
import { asWebviewUri, WebviewInitData } from 'vs/workbench/api/common/shared/webview';
import { addIdToOutput, CellStatusbarAlignment, CellUri, INotebookCellStatusBarEntry, INotebookDisplayOrder, INotebookExclusiveDocumentFilter, INotebookKernelInfoDto2, NotebookCellMetadata, NotebookCellsChangedEventDto, NotebookCellsChangeType, NotebookDataDto, notebookDocumentMetadataDefaults } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import * as vscode from 'vscode';
import { ResourceMap } from 'vs/base/common/map';
import { ExtHostCell, ExtHostNotebookDocument } from './extHostNotebookDocument';
import { ExtHostNotebookEditor } from './extHostNotebookEditor';
import { IdGenerator } from 'vs/base/common/idGenerator';
import { IRelativePattern } from 'vs/base/common/glob';
import { assertIsDefined } from 'vs/base/common/types';

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
			this._register(this._provider.onDidChangeKernels((e: vscode.NotebookDocument | undefined) => {
				const uri = e?.uri;
				this._proxy.$onNotebookKernelChange(this._handle, uri);
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
				detail: kernel.detail,
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

export class NotebookEditorDecorationType implements vscode.NotebookEditorDecorationType {

	private static readonly _Keys = new IdGenerator('NotebookEditorDecorationType');

	private _proxy: MainThreadNotebookShape;
	public key: string;

	constructor(proxy: MainThreadNotebookShape, options: vscode.NotebookDecorationRenderOptions) {
		this.key = NotebookEditorDecorationType._Keys.nextId();
		this._proxy = proxy;
		this._proxy.$registerNotebookEditorDecorationType(this.key, typeConverters.NotebookDecorationRenderOptions.from(options));
	}

	public dispose(): void {
		this._proxy.$removeNotebookEditorDecorationType(this.key);
	}
}

export class ExtHostNotebookController implements ExtHostNotebookShape, ExtHostNotebookOutputRenderingHandler {
	private static _notebookKernelProviderHandlePool: number = 0;

	private readonly _proxy: MainThreadNotebookShape;
	private readonly _mainThreadBulkEdits: MainThreadBulkEditsShape;
	private readonly _notebookContentProviders = new Map<string, { readonly provider: vscode.NotebookContentProvider, readonly extension: IExtensionDescription; }>();
	private readonly _notebookKernelProviders = new Map<number, ExtHostNotebookKernelProviderAdapter>();
	private readonly _documents = new ResourceMap<ExtHostNotebookDocument>();
	private readonly _editors = new Map<string, { editor: ExtHostNotebookEditor; }>();
	private readonly _webviewComm = new Map<string, ExtHostWebviewCommWrapper>();
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
		this._mainThreadBulkEdits = mainContext.getProxy(MainContext.MainThreadBulkEdits);
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
						return cell.cell;
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
			viewOptions?: {
				displayName: string;
				filenamePattern: (vscode.GlobPattern | { include: vscode.GlobPattern; exclude: vscode.GlobPattern })[];
				exclusive?: boolean;
			};
		}
	): vscode.Disposable {

		if (this._notebookContentProviders.has(viewType)) {
			throw new Error(`Notebook provider for '${viewType}' already registered`);
		}

		this._notebookContentProviders.set(viewType, { extension, provider });
		const listeners: vscode.Disposable[] = [];

		listeners.push(provider.onDidChangeNotebook
			? provider.onDidChangeNotebook(e => {
				const document = this._documents.get(URI.revive(e.document.uri));

				if (!document) {
					throw new Error(`Notebook document ${e.document.uri.toString()} not found`);
				}

				if (isEditEvent(e)) {
					const editId = document.addEdit(e);
					this._proxy.$onUndoableContentChange(e.document.uri, viewType, editId, e.label);
				} else {
					this._proxy.$onContentChange(e.document.uri, viewType);
				}
			})
			: Disposable.None);

		listeners.push(provider.onDidChangeNotebookContentOptions
			? provider.onDidChangeNotebookContentOptions(() => {
				this._proxy.$updateNotebookProviderOptions(viewType, provider.options);
			})
			: Disposable.None);

		const supportBackup = !!provider.backupNotebook;

		const viewOptionsFilenamePattern = options?.viewOptions?.filenamePattern
			.map(pattern => typeConverters.NotebookExclusiveDocumentPattern.from(pattern))
			.filter(pattern => pattern !== undefined) as (string | IRelativePattern | INotebookExclusiveDocumentFilter)[];

		if (options?.viewOptions?.filenamePattern && !viewOptionsFilenamePattern) {
			console.warn(`Notebook content provider view options file name pattern is invalid ${options?.viewOptions?.filenamePattern}`);
		}

		this._proxy.$registerNotebookProvider({ id: extension.identifier, location: extension.extensionLocation, description: extension.description }, viewType, supportBackup, {
			transientOutputs: options?.transientOutputs || false,
			transientMetadata: options?.transientMetadata || {},
			viewOptions: options?.viewOptions && viewOptionsFilenamePattern ? { displayName: options.viewOptions.displayName, filenamePattern: viewOptionsFilenamePattern, exclusive: options.viewOptions.exclusive || false } : undefined
		});

		return new extHostTypes.Disposable(() => {
			listeners.forEach(d => d.dispose());
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
			filenamePattern: selector.filenamePattern ? typeConverters.NotebookExclusiveDocumentPattern.from(selector.filenamePattern) : undefined
		});

		return new extHostTypes.Disposable(() => {
			adapter.dispose();
			this._notebookKernelProviders.delete(handle);
			this._proxy.$unregisterNotebookKernelProvider(handle);
		});
	}

	createNotebookEditorDecorationType(options: vscode.NotebookDecorationRenderOptions): vscode.NotebookEditorDecorationType {
		return new NotebookEditorDecorationType(this._proxy, options);
	}

	async openNotebookDocument(uriComponents: UriComponents, viewType?: string): Promise<vscode.NotebookDocument> {
		const cached = this._documents.get(URI.revive(uriComponents));
		if (cached) {
			return Promise.resolve(cached.notebookDocument);
		}

		await this._proxy.$tryOpenDocument(uriComponents, viewType);
		const document = this._documents.get(URI.revive(uriComponents));
		return assertIsDefined(document?.notebookDocument);
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

	async showNotebookDocument(notebookDocument: vscode.NotebookDocument, options?: vscode.NotebookDocumentShowOptions): Promise<vscode.NotebookEditor> {
		let resolvedOptions: INotebookDocumentShowOptions;
		if (typeof options === 'object') {
			resolvedOptions = {
				position: typeConverters.ViewColumn.from(options.viewColumn),
				preserveFocus: options.preserveFocus,
				selection: options.selection,
				pinned: typeof options.preview === 'boolean' ? !options.preview : undefined
			};
		} else {
			resolvedOptions = {
				preserveFocus: false
			};
		}

		const editorId = await this._proxy.$tryShowNotebookDocument(notebookDocument.uri, notebookDocument.viewType, resolvedOptions);
		const editor = editorId && this._editors.get(editorId)?.editor;

		if (editor) {
			return editor;
		}

		if (editorId) {
			throw new Error(`Could NOT open editor for "${notebookDocument.toString()}" because another editor opened in the meantime.`);
		} else {
			throw new Error(`Could NOT open editor for "${notebookDocument.toString()}".`);
		}
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

	async $resolveNotebookData(viewType: string, uri: UriComponents, backupId?: string): Promise<NotebookDataDto> {
		const provider = this._notebookContentProviders.get(viewType);
		if (!provider) {
			throw new Error(`NO provider for '${viewType}'`);
		}

		const data = await provider.provider.openNotebook(URI.revive(uri), { backupId });
		return {
			metadata: {
				...notebookDocumentMetadataDefaults,
				...data.metadata
			},
			languages: data.languages,
			cells: data.cells.map(cell => ({
				...cell,
				outputs: cell.outputs.map(o => addIdToOutput(o))
			})),
		};
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
						editor.editor._acceptKernel(kernel);
					}
				});
				this._onDidChangeActiveNotebookKernel.fire({ document: document.notebookDocument, kernel });
			});
		}
	}

	// TODO@rebornix: remove document - editor one on one mapping
	private _getEditorFromURI(uriComponents: UriComponents) {
		const uriStr = URI.revive(uriComponents).toString();
		let editor: { editor: ExtHostNotebookEditor; } | undefined;
		this._editors.forEach(e => {
			if (e.editor.document.uri.toString() === uriStr) {
				editor = e;
			}
		});

		return editor;
	}

	$onDidReceiveMessage(editorId: string, forRendererType: string | undefined, message: any): void {
		this._webviewComm.get(editorId)?.onDidReceiveMessage(forRendererType, message);
	}

	$acceptModelChanged(uriComponents: UriComponents, event: NotebookCellsChangedEventDto, isDirty: boolean): void {
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
	}

	$acceptDocumentPropertiesChanged(uriComponents: UriComponents, data: INotebookDocumentPropertiesChangeData): void {
		this.logService.debug('ExtHostNotebook#$acceptDocumentPropertiesChanged', uriComponents.path, data);
		const editor = this._getEditorFromURI(uriComponents);

		if (!editor) {
			return;
		}

		if (data.metadata) {
			editor.editor.notebookData.acceptDocumentPropertiesChanged(data);
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
			editorId,
			document.notebookDocument.viewType,
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
					if (e.editor.document.uri.toString() === revivedUri.toString()) {
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
				const uri = URI.revive(modelData.uri);
				const viewType = modelData.viewType;
				const entry = this._notebookContentProviders.get(viewType);
				const storageRoot = entry && (this._extensionStoragePaths.workspaceValue(entry.extension) ?? this._extensionStoragePaths.globalValue(entry.extension));

				if (this._documents.has(uri)) {
					throw new Error(`adding EXISTING notebook ${uri}`);
				}
				const that = this;

				const document = new ExtHostNotebookDocument(this._proxy, this._documentsAndEditors, this._mainThreadBulkEdits, {
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
					emitDocumentMetadataChange(event: vscode.NotebookDocumentMetadataChangeEvent): void {
						that._onDidChangeNotebookDocumentMetadata.fire(event);
					}
				}, viewType, modelData.contentOptions, { ...notebookDocumentMetadataDefaults, ...modelData.metadata }, uri, storageRoot);

				document.acceptModelChanged({
					versionId: modelData.versionId,
					rawEvents: [
						{
							kind: NotebookCellsChangeType.Initialize,
							changes: [[
								0,
								0,
								modelData.cells
							]]
						}
					]
				}, false);

				// add cell document as vscode.TextDocument
				addedCellDocuments.push(...modelData.cells.map(cell => ExtHostCell.asModelAddData(document.notebookDocument, cell)));

				this._documents.get(uri)?.dispose();
				this._documents.set(uri, document);

				// create editor if populated
				if (modelData.attachedEditor) {
					this._createExtHostEditor(document, modelData.attachedEditor.id, modelData.attachedEditor.selections, modelData.attachedEditor.visibleRanges);
					editorChanged = true;
				}

				this._documentsAndEditors.$acceptDocumentsAndEditorsDelta({ addedDocuments: addedCellDocuments });

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
