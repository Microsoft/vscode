/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { hash } from 'vs/base/common/hash';
import { Disposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Schemas } from 'vs/base/common/network';
import { joinPath } from 'vs/base/common/resources';
import { URI, UriComponents } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import * as modes from 'vs/editor/common/modes';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { ILogService } from 'vs/platform/log/common/log';
import { IExtHostApiDeprecationService } from 'vs/workbench/api/common/extHostApiDeprecationService';
import { ExtHostDocuments } from 'vs/workbench/api/common/extHostDocuments';
import { IExtensionStoragePaths } from 'vs/workbench/api/common/extHostStoragePaths';
import * as typeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import { IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import { EditorViewColumn } from 'vs/workbench/api/common/shared/editor';
import { asWebviewUri, WebviewInitData } from 'vs/workbench/api/common/shared/webview';
import type * as vscode from 'vscode';
import { Cache } from './cache';
import * as extHostProtocol from './extHost.protocol';
import * as extHostTypes from './extHostTypes';

type IconPath = URI | { light: URI, dark: URI };

export class ExtHostWebview implements vscode.Webview {

	readonly #handle: extHostProtocol.WebviewPanelHandle;
	readonly #proxy: extHostProtocol.MainThreadWebviewsShape;
	readonly #deprecationService: IExtHostApiDeprecationService;

	readonly #initData: WebviewInitData;
	readonly #workspace: IExtHostWorkspace | undefined;
	readonly #extension: IExtensionDescription;

	#html: string = '';
	#options: vscode.WebviewOptions;
	#isDisposed: boolean = false;
	#hasCalledAsWebviewUri = false;

	constructor(
		handle: extHostProtocol.WebviewPanelHandle,
		proxy: extHostProtocol.MainThreadWebviewsShape,
		options: vscode.WebviewOptions,
		initData: WebviewInitData,
		workspace: IExtHostWorkspace | undefined,
		extension: IExtensionDescription,
		deprecationService: IExtHostApiDeprecationService,
	) {
		this.#handle = handle;
		this.#proxy = proxy;
		this.#options = options;
		this.#initData = initData;
		this.#workspace = workspace;
		this.#extension = extension;
		this.#deprecationService = deprecationService;
	}

	/* internal */ readonly _onMessageEmitter = new Emitter<any>();
	public readonly onDidReceiveMessage: Event<any> = this._onMessageEmitter.event;

	public dispose() {
		this._onMessageEmitter.dispose();
	}

	public asWebviewUri(resource: vscode.Uri): vscode.Uri {
		this.#hasCalledAsWebviewUri = true;
		return asWebviewUri(this.#initData, this.#handle, resource);
	}

	public get cspSource(): string {
		return this.#initData.webviewCspSource
			.replace('{{uuid}}', this.#handle);
	}

	public get html(): string {
		this.assertNotDisposed();
		return this.#html;
	}

	public set html(value: string) {
		this.assertNotDisposed();
		if (this.#html !== value) {
			this.#html = value;
			if (!this.#hasCalledAsWebviewUri && /(["'])vscode-resource:([^\s'"]+?)(["'])/i.test(value)) {
				this.#hasCalledAsWebviewUri = true;
				this.#deprecationService.report('Webview vscode-resource: uris', this.#extension,
					`Please migrate to use the 'webview.asWebviewUri' api instead: https://aka.ms/vscode-webview-use-aswebviewuri`);
			}
			this.#proxy.$setHtml(this.#handle, value);
		}
	}

	public get options(): vscode.WebviewOptions {
		this.assertNotDisposed();
		return this.#options;
	}

	public set options(newOptions: vscode.WebviewOptions) {
		this.assertNotDisposed();
		this.#proxy.$setOptions(this.#handle, convertWebviewOptions(this.#extension, this.#workspace, newOptions));
		this.#options = newOptions;
	}

	public postMessage(message: any): Promise<boolean> {
		this.assertNotDisposed();
		return this.#proxy.$postMessage(this.#handle, message);
	}

	private assertNotDisposed() {
		if (this.#isDisposed) {
			throw new Error('Webview is disposed');
		}
	}
}

export class ExtHostWebviewEditor extends Disposable implements vscode.WebviewPanel {

	readonly #handle: extHostProtocol.WebviewPanelHandle;
	readonly #proxy: extHostProtocol.MainThreadWebviewsShape;
	readonly #viewType: string;

	readonly #webview: ExtHostWebview;
	readonly #options: vscode.WebviewPanelOptions;

	#title: string;
	#iconPath?: IconPath;
	#viewColumn: vscode.ViewColumn | undefined = undefined;
	#visible: boolean = true;
	#active: boolean = true;
	#isDisposed: boolean = false;

	readonly #onDidDispose = this._register(new Emitter<void>());
	public readonly onDidDispose = this.#onDidDispose.event;

	readonly #onDidChangeViewState = this._register(new Emitter<vscode.WebviewPanelOnDidChangeViewStateEvent>());
	public readonly onDidChangeViewState = this.#onDidChangeViewState.event;

	constructor(
		handle: extHostProtocol.WebviewPanelHandle,
		proxy: extHostProtocol.MainThreadWebviewsShape,
		viewType: string,
		title: string,
		viewColumn: vscode.ViewColumn | undefined,
		editorOptions: vscode.WebviewPanelOptions,
		webview: ExtHostWebview
	) {
		super();
		this.#handle = handle;
		this.#proxy = proxy;
		this.#viewType = viewType;
		this.#options = editorOptions;
		this.#viewColumn = viewColumn;
		this.#title = title;
		this.#webview = webview;
	}

	public dispose() {
		if (this.#isDisposed) {
			return;
		}

		this.#isDisposed = true;
		this.#onDidDispose.fire();
		this.#proxy.$disposeWebview(this.#handle);
		this.#webview.dispose();

		super.dispose();
	}

	get webview() {
		this.assertNotDisposed();
		return this.#webview;
	}

	get viewType(): string {
		this.assertNotDisposed();
		return this.#viewType;
	}

	get title(): string {
		this.assertNotDisposed();
		return this.#title;
	}

	set title(value: string) {
		this.assertNotDisposed();
		if (this.#title !== value) {
			this.#title = value;
			this.#proxy.$setTitle(this.#handle, value);
		}
	}

	get iconPath(): IconPath | undefined {
		this.assertNotDisposed();
		return this.#iconPath;
	}

	set iconPath(value: IconPath | undefined) {
		this.assertNotDisposed();
		if (this.#iconPath !== value) {
			this.#iconPath = value;

			this.#proxy.$setIconPath(this.#handle, URI.isUri(value) ? { light: value, dark: value } : value);
		}
	}

	get options() {
		return this.#options;
	}

	get viewColumn(): vscode.ViewColumn | undefined {
		this.assertNotDisposed();
		if (typeof this.#viewColumn === 'number' && this.#viewColumn < 0) {
			// We are using a symbolic view column
			// Return undefined instead to indicate that the real view column is currently unknown but will be resolved.
			return undefined;
		}
		return this.#viewColumn;
	}

	public get active(): boolean {
		this.assertNotDisposed();
		return this.#active;
	}

	public get visible(): boolean {
		this.assertNotDisposed();
		return this.#visible;
	}

	_updateViewState(newState: { active: boolean; visible: boolean; viewColumn: vscode.ViewColumn; }) {
		if (this.#isDisposed) {
			return;
		}

		if (this.active !== newState.active || this.visible !== newState.visible || this.viewColumn !== newState.viewColumn) {
			this.#active = newState.active;
			this.#visible = newState.visible;
			this.#viewColumn = newState.viewColumn;
			this.#onDidChangeViewState.fire({ webviewPanel: this });
		}
	}

	public postMessage(message: any): Promise<boolean> {
		this.assertNotDisposed();
		return this.#proxy.$postMessage(this.#handle, message);
	}

	public reveal(viewColumn?: vscode.ViewColumn, preserveFocus?: boolean): void {
		this.assertNotDisposed();
		this.#proxy.$reveal(this.#handle, {
			viewColumn: viewColumn ? typeConverters.ViewColumn.from(viewColumn) : undefined,
			preserveFocus: !!preserveFocus
		});
	}

	private assertNotDisposed() {
		if (this.#isDisposed) {
			throw new Error('Webview is disposed');
		}
	}
}

class CustomDocumentStoreEntry {

	private _backupCounter = 1;

	constructor(
		public readonly document: vscode.CustomDocument,
		private readonly _storagePath: URI | undefined,
	) { }

	private readonly _edits = new Cache<vscode.CustomDocumentEditEvent>('custom documents');

	private _backup?: vscode.CustomDocumentBackup;

	addEdit(item: vscode.CustomDocumentEditEvent): number {
		return this._edits.add([item]);
	}

	async undo(editId: number, isDirty: boolean): Promise<void> {
		await this.getEdit(editId).undo();
		if (!isDirty) {
			this.disposeBackup();
		}
	}

	async redo(editId: number, isDirty: boolean): Promise<void> {
		await this.getEdit(editId).redo();
		if (!isDirty) {
			this.disposeBackup();
		}
	}

	disposeEdits(editIds: number[]): void {
		for (const id of editIds) {
			this._edits.delete(id);
		}
	}

	getNewBackupUri(): URI {
		if (!this._storagePath) {
			throw new Error('Backup requires a valid storage path');
		}
		const fileName = hashPath(this.document.uri) + (this._backupCounter++);
		return joinPath(this._storagePath, fileName);
	}

	updateBackup(backup: vscode.CustomDocumentBackup): void {
		this._backup?.delete();
		this._backup = backup;
	}

	disposeBackup(): void {
		this._backup?.delete();
		this._backup = undefined;
	}

	private getEdit(editId: number): vscode.CustomDocumentEditEvent {
		const edit = this._edits.get(editId, 0);
		if (!edit) {
			throw new Error('No edit found');
		}
		return edit;
	}
}

class CustomDocumentStore {
	private readonly _documents = new Map<string, CustomDocumentStoreEntry>();

	public get(viewType: string, resource: vscode.Uri): CustomDocumentStoreEntry | undefined {
		return this._documents.get(this.key(viewType, resource));
	}

	public add(viewType: string, document: vscode.CustomDocument, storagePath: URI | undefined): CustomDocumentStoreEntry {
		const key = this.key(viewType, document.uri);
		if (this._documents.has(key)) {
			throw new Error(`Document already exists for viewType:${viewType} resource:${document.uri}`);
		}
		const entry = new CustomDocumentStoreEntry(document, storagePath);
		this._documents.set(key, entry);
		return entry;
	}

	public delete(viewType: string, document: vscode.CustomDocument) {
		const key = this.key(viewType, document.uri);
		this._documents.delete(key);
	}

	private key(viewType: string, resource: vscode.Uri): string {
		return `${viewType}@@@${resource}`;
	}

}

const enum WebviewEditorType {
	Text,
	Custom
}

type ProviderEntry = {
	readonly extension: IExtensionDescription;
	readonly type: WebviewEditorType.Text;
	readonly provider: vscode.CustomTextEditorProvider;
} | {
	readonly extension: IExtensionDescription;
	readonly type: WebviewEditorType.Custom;
	readonly provider: vscode.CustomReadonlyEditorProvider;
};

class EditorProviderStore {
	private readonly _providers = new Map<string, ProviderEntry>();

	public addTextProvider(viewType: string, extension: IExtensionDescription, provider: vscode.CustomTextEditorProvider): vscode.Disposable {
		return this.add(WebviewEditorType.Text, viewType, extension, provider);
	}

	public addCustomProvider(viewType: string, extension: IExtensionDescription, provider: vscode.CustomReadonlyEditorProvider): vscode.Disposable {
		return this.add(WebviewEditorType.Custom, viewType, extension, provider);
	}

	public get(viewType: string): ProviderEntry | undefined {
		return this._providers.get(viewType);
	}

	private add(type: WebviewEditorType, viewType: string, extension: IExtensionDescription, provider: vscode.CustomTextEditorProvider | vscode.CustomReadonlyEditorProvider): vscode.Disposable {
		if (this._providers.has(viewType)) {
			throw new Error(`Provider for viewType:${viewType} already registered`);
		}
		this._providers.set(viewType, { type, extension, provider } as ProviderEntry);
		return new extHostTypes.Disposable(() => this._providers.delete(viewType));
	}
}

export class ExtHostWebviews implements extHostProtocol.ExtHostWebviewsShape {

	private static newHandle(): extHostProtocol.WebviewPanelHandle {
		return generateUuid();
	}

	private readonly _proxy: extHostProtocol.MainThreadWebviewsShape;
	private readonly _webviewPanels = new Map<extHostProtocol.WebviewPanelHandle, ExtHostWebviewEditor>();

	private readonly _serializers = new Map<string, {
		readonly serializer: vscode.WebviewPanelSerializer;
		readonly extension: IExtensionDescription;
	}>();

	private readonly _editorProviders = new EditorProviderStore();

	private readonly _documents = new CustomDocumentStore();

	constructor(
		mainContext: extHostProtocol.IMainContext,
		private readonly initData: WebviewInitData,
		private readonly workspace: IExtHostWorkspace | undefined,
		private readonly _logService: ILogService,
		private readonly _deprecationService: IExtHostApiDeprecationService,
		private readonly _extHostDocuments: ExtHostDocuments,
		private readonly _extensionStoragePaths?: IExtensionStoragePaths,
	) {
		this._proxy = mainContext.getProxy(extHostProtocol.MainContext.MainThreadWebviews);
	}

	public createWebviewPanel(
		extension: IExtensionDescription,
		viewType: string,
		title: string,
		showOptions: vscode.ViewColumn | { viewColumn: vscode.ViewColumn, preserveFocus?: boolean },
		options: (vscode.WebviewPanelOptions & vscode.WebviewOptions) = {},
	): vscode.WebviewPanel {
		const viewColumn = typeof showOptions === 'object' ? showOptions.viewColumn : showOptions;
		const webviewShowOptions = {
			viewColumn: typeConverters.ViewColumn.from(viewColumn),
			preserveFocus: typeof showOptions === 'object' && !!showOptions.preserveFocus
		};

		const handle = ExtHostWebviews.newHandle();
		this._proxy.$createWebviewPanel(toExtensionData(extension), handle, viewType, title, webviewShowOptions, convertWebviewOptions(extension, this.workspace, options));

		const webview = new ExtHostWebview(handle, this._proxy, options, this.initData, this.workspace, extension, this._deprecationService);
		const panel = new ExtHostWebviewEditor(handle, this._proxy, viewType, title, viewColumn, options, webview);
		this._webviewPanels.set(handle, panel);
		return panel;
	}

	public registerWebviewPanelSerializer(
		extension: IExtensionDescription,
		viewType: string,
		serializer: vscode.WebviewPanelSerializer
	): vscode.Disposable {
		if (this._serializers.has(viewType)) {
			throw new Error(`Serializer for '${viewType}' already registered`);
		}

		this._serializers.set(viewType, { serializer, extension });
		this._proxy.$registerSerializer(viewType);

		return new extHostTypes.Disposable(() => {
			this._serializers.delete(viewType);
			this._proxy.$unregisterSerializer(viewType);
		});
	}

	public registerCustomEditorProvider(
		extension: IExtensionDescription,
		viewType: string,
		provider: vscode.CustomReadonlyEditorProvider | vscode.CustomTextEditorProvider,
		options: { webviewOptions?: vscode.WebviewPanelOptions, supportsMultipleEditorsPerDocument?: boolean },
	): vscode.Disposable {
		const disposables = new DisposableStore();
		if ('resolveCustomTextEditor' in provider) {
			disposables.add(this._editorProviders.addTextProvider(viewType, extension, provider));
			this._proxy.$registerTextEditorProvider(toExtensionData(extension), viewType, options.webviewOptions || {}, {
				supportsMove: !!provider.moveCustomTextEditor,
			});
		} else {
			disposables.add(this._editorProviders.addCustomProvider(viewType, extension, provider));

			if (this.supportEditing(provider)) {
				disposables.add(provider.onDidChangeCustomDocument(e => {
					const entry = this.getCustomDocumentEntry(viewType, e.document.uri);
					if (isEditEvent(e)) {
						const editId = entry.addEdit(e);
						this._proxy.$onDidEdit(e.document.uri, viewType, editId, e.label);
					} else {
						this._proxy.$onContentChange(e.document.uri, viewType);
					}
				}));
			}

			this._proxy.$registerCustomEditorProvider(toExtensionData(extension), viewType, options.webviewOptions || {}, !!options.supportsMultipleEditorsPerDocument);
		}

		return extHostTypes.Disposable.from(
			disposables,
			new extHostTypes.Disposable(() => {
				this._proxy.$unregisterEditorProvider(viewType);
			}));
	}

	public $onMessage(
		handle: extHostProtocol.WebviewPanelHandle,
		message: any
	): void {
		const panel = this.getWebviewPanel(handle);
		if (panel) {
			panel.webview._onMessageEmitter.fire(message);
		}
	}

	public $onMissingCsp(
		_handle: extHostProtocol.WebviewPanelHandle,
		extensionId: string
	): void {
		this._logService.warn(`${extensionId} created a webview without a content security policy: https://aka.ms/vscode-webview-missing-csp`);
	}

	public $onDidChangeWebviewPanelViewStates(newStates: extHostProtocol.WebviewPanelViewStateData): void {
		const handles = Object.keys(newStates);
		// Notify webviews of state changes in the following order:
		// - Non-visible
		// - Visible
		// - Active
		handles.sort((a, b) => {
			const stateA = newStates[a];
			const stateB = newStates[b];
			if (stateA.active) {
				return 1;
			}
			if (stateB.active) {
				return -1;
			}
			return (+stateA.visible) - (+stateB.visible);
		});

		for (const handle of handles) {
			const panel = this.getWebviewPanel(handle);
			if (!panel) {
				continue;
			}

			const newState = newStates[handle];
			panel._updateViewState({
				active: newState.active,
				visible: newState.visible,
				viewColumn: typeConverters.ViewColumn.to(newState.position),
			});
		}
	}

	async $onDidDisposeWebviewPanel(handle: extHostProtocol.WebviewPanelHandle): Promise<void> {
		const panel = this.getWebviewPanel(handle);
		if (panel) {
			panel.dispose();
			this._webviewPanels.delete(handle);
		}
	}

	async $deserializeWebviewPanel(
		webviewHandle: extHostProtocol.WebviewPanelHandle,
		viewType: string,
		title: string,
		state: any,
		position: EditorViewColumn,
		options: modes.IWebviewOptions & modes.IWebviewPanelOptions
	): Promise<void> {
		const entry = this._serializers.get(viewType);
		if (!entry) {
			throw new Error(`No serializer found for '${viewType}'`);
		}
		const { serializer, extension } = entry;

		const webview = new ExtHostWebview(webviewHandle, this._proxy, reviveOptions(options), this.initData, this.workspace, extension, this._deprecationService);
		const revivedPanel = new ExtHostWebviewEditor(webviewHandle, this._proxy, viewType, title, typeof position === 'number' && position >= 0 ? typeConverters.ViewColumn.to(position) : undefined, options, webview);
		this._webviewPanels.set(webviewHandle, revivedPanel);
		await serializer.deserializeWebviewPanel(revivedPanel, state);
	}

	async $createCustomDocument(resource: UriComponents, viewType: string, backupId: string | undefined, cancellation: CancellationToken) {
		const entry = this._editorProviders.get(viewType);
		if (!entry) {
			throw new Error(`No provider found for '${viewType}'`);
		}

		if (entry.type !== WebviewEditorType.Custom) {
			throw new Error(`Invalid provide type for '${viewType}'`);
		}

		const revivedResource = URI.revive(resource);
		const document = await entry.provider.openCustomDocument(revivedResource, { backupId }, cancellation);

		let storageRoot: URI | undefined;
		if (this.supportEditing(entry.provider) && this._extensionStoragePaths) {
			storageRoot = this._extensionStoragePaths.workspaceValue(entry.extension) ?? this._extensionStoragePaths.globalValue(entry.extension);
		}
		this._documents.add(viewType, document, storageRoot);

		return { editable: this.supportEditing(entry.provider) };
	}

	async $disposeCustomDocument(resource: UriComponents, viewType: string): Promise<void> {
		const entry = this._editorProviders.get(viewType);
		if (!entry) {
			throw new Error(`No provider found for '${viewType}'`);
		}

		if (entry.type !== WebviewEditorType.Custom) {
			throw new Error(`Invalid provider type for '${viewType}'`);
		}

		const revivedResource = URI.revive(resource);
		const { document } = this.getCustomDocumentEntry(viewType, revivedResource);
		this._documents.delete(viewType, document);
		document.dispose();
	}

	async $resolveWebviewEditor(
		resource: UriComponents,
		handle: extHostProtocol.WebviewPanelHandle,
		viewType: string,
		title: string,
		position: EditorViewColumn,
		options: modes.IWebviewOptions & modes.IWebviewPanelOptions,
		cancellation: CancellationToken,
	): Promise<void> {
		const entry = this._editorProviders.get(viewType);
		if (!entry) {
			throw new Error(`No provider found for '${viewType}'`);
		}

		const webview = new ExtHostWebview(handle, this._proxy, reviveOptions(options), this.initData, this.workspace, entry.extension, this._deprecationService);
		const revivedPanel = new ExtHostWebviewEditor(handle, this._proxy, viewType, title, typeof position === 'number' && position >= 0 ? typeConverters.ViewColumn.to(position) : undefined, options, webview);
		this._webviewPanels.set(handle, revivedPanel);

		const revivedResource = URI.revive(resource);

		switch (entry.type) {
			case WebviewEditorType.Custom:
				{
					const { document } = this.getCustomDocumentEntry(viewType, revivedResource);
					return entry.provider.resolveCustomEditor(document, revivedPanel, cancellation);
				}
			case WebviewEditorType.Text:
				{
					const document = this._extHostDocuments.getDocument(revivedResource);
					return entry.provider.resolveCustomTextEditor(document, revivedPanel, cancellation);
				}
			default:
				{
					throw new Error('Unknown webview provider type');
				}
		}
	}

	$disposeEdits(resourceComponents: UriComponents, viewType: string, editIds: number[]): void {
		const document = this.getCustomDocumentEntry(viewType, resourceComponents);
		document.disposeEdits(editIds);
	}

	async $onMoveCustomEditor(handle: string, newResourceComponents: UriComponents, viewType: string): Promise<void> {
		const entry = this._editorProviders.get(viewType);
		if (!entry) {
			throw new Error(`No provider found for '${viewType}'`);
		}

		if (!(entry.provider as vscode.CustomTextEditorProvider).moveCustomTextEditor) {
			throw new Error(`Provider does not implement move '${viewType}'`);
		}

		const webview = this.getWebviewPanel(handle);
		if (!webview) {
			throw new Error(`No webview found`);
		}

		const resource = URI.revive(newResourceComponents);
		const document = this._extHostDocuments.getDocument(resource);
		await (entry.provider as vscode.CustomTextEditorProvider).moveCustomTextEditor!(document, webview, CancellationToken.None);
	}

	async $undo(resourceComponents: UriComponents, viewType: string, editId: number, isDirty: boolean): Promise<void> {
		const entry = this.getCustomDocumentEntry(viewType, resourceComponents);
		return entry.undo(editId, isDirty);
	}

	async $redo(resourceComponents: UriComponents, viewType: string, editId: number, isDirty: boolean): Promise<void> {
		const entry = this.getCustomDocumentEntry(viewType, resourceComponents);
		return entry.redo(editId, isDirty);
	}

	async $revert(resourceComponents: UriComponents, viewType: string, cancellation: CancellationToken): Promise<void> {
		const entry = this.getCustomDocumentEntry(viewType, resourceComponents);
		const provider = this.getCustomEditorProvider(viewType);
		await provider.revertCustomDocument(entry.document, cancellation);
		entry.disposeBackup();
	}

	async $onSave(resourceComponents: UriComponents, viewType: string, cancellation: CancellationToken): Promise<void> {
		const entry = this.getCustomDocumentEntry(viewType, resourceComponents);
		const provider = this.getCustomEditorProvider(viewType);
		await provider.saveCustomDocument(entry.document, cancellation);
		entry.disposeBackup();
	}

	async $onSaveAs(resourceComponents: UriComponents, viewType: string, targetResource: UriComponents, cancellation: CancellationToken): Promise<void> {
		const entry = this.getCustomDocumentEntry(viewType, resourceComponents);
		const provider = this.getCustomEditorProvider(viewType);
		return provider.saveCustomDocumentAs(entry.document, URI.revive(targetResource), cancellation);
	}

	async $backup(resourceComponents: UriComponents, viewType: string, cancellation: CancellationToken): Promise<string> {
		const entry = this.getCustomDocumentEntry(viewType, resourceComponents);
		const provider = this.getCustomEditorProvider(viewType);

		const backup = await provider.backupCustomDocument(entry.document, {
			destination: entry.getNewBackupUri(),
		}, cancellation);
		entry.updateBackup(backup);
		return backup.id;
	}

	private getWebviewPanel(handle: extHostProtocol.WebviewPanelHandle): ExtHostWebviewEditor | undefined {
		return this._webviewPanels.get(handle);
	}

	private getCustomDocumentEntry(viewType: string, resource: UriComponents): CustomDocumentStoreEntry {
		const entry = this._documents.get(viewType, URI.revive(resource));
		if (!entry) {
			throw new Error('No custom document found');
		}
		return entry;
	}

	private getCustomEditorProvider(viewType: string): vscode.CustomEditorProvider {
		const entry = this._editorProviders.get(viewType);
		const provider = entry?.provider;
		if (!provider || !this.supportEditing(provider)) {
			throw new Error('Custom document is not editable');
		}
		return provider;
	}

	private supportEditing(
		provider: vscode.CustomTextEditorProvider | vscode.CustomEditorProvider | vscode.CustomReadonlyEditorProvider
	): provider is vscode.CustomEditorProvider {
		return !!(provider as vscode.CustomEditorProvider).onDidChangeCustomDocument;
	}
}

function toExtensionData(extension: IExtensionDescription): extHostProtocol.WebviewExtensionDescription {
	return { id: extension.identifier, location: extension.extensionLocation };
}

function convertWebviewOptions(
	extension: IExtensionDescription,
	workspace: IExtHostWorkspace | undefined,
	options: vscode.WebviewPanelOptions & vscode.WebviewOptions,
): modes.IWebviewOptions {
	return {
		...options,
		localResourceRoots: options.localResourceRoots || getDefaultLocalResourceRoots(extension, workspace)
	};
}

function reviveOptions(
	options: modes.IWebviewOptions & modes.IWebviewPanelOptions
): vscode.WebviewOptions {
	return {
		...options,
		localResourceRoots: options.localResourceRoots?.map(components => URI.from(components)),
	};
}

function getDefaultLocalResourceRoots(
	extension: IExtensionDescription,
	workspace: IExtHostWorkspace | undefined,
): URI[] {
	return [
		...(workspace?.getWorkspaceFolders() || []).map(x => x.uri),
		extension.extensionLocation,
	];
}

function isEditEvent(e: vscode.CustomDocumentContentChangeEvent | vscode.CustomDocumentEditEvent): e is vscode.CustomDocumentEditEvent {
	return typeof (e as vscode.CustomDocumentEditEvent).undo === 'function'
		&& typeof (e as vscode.CustomDocumentEditEvent).redo === 'function';
}

function hashPath(resource: URI): string {
	const str = resource.scheme === Schemas.file || resource.scheme === Schemas.untitled ? resource.fsPath : resource.toString();
	return hash(str) + '';
}
