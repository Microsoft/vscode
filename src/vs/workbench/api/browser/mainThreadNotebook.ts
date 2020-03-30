/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { MainContext, MainThreadNotebookShape, NotebookExtensionDescription, IExtHostContext, ExtHostNotebookShape, ExtHostContext } from '../common/extHost.protocol';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { INotebookService, IMainNotebookController } from 'vs/workbench/services/notebook/browser/notebookService';
import { INotebookTextModel, INotebookMimeTypeSelector, NOTEBOOK_DISPLAY_ORDER, NotebookCellOutputsSplice, CellKind, NotebookDocumentMetadata, NotebookCellMetadata, ICellEditOperation } from 'vs/workbench/services/notebook/common/notebookCommon';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { NotebookTextModel } from 'vs/workbench/services/notebook/common/model/notebookTextModel';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';

export class MainThreadNotebookDocument extends Disposable {
	private _textModel: NotebookTextModel;

	get textModel() {
		return this._textModel;
	}

	constructor(
		private readonly _proxy: ExtHostNotebookShape,
		public handle: number,
		public viewType: string,
		public uri: URI
	) {
		super();
		this._textModel = new NotebookTextModel(handle, viewType, uri);
		this._register(this._textModel.onDidModelChange(e => {
			this._proxy.$acceptModelChanged(this.uri, e);
		}));
	}

	applyEdit(modelVersionId: number, edits: ICellEditOperation[]): boolean {
		return this._textModel.applyEdit(modelVersionId, edits);
	}

	updateRenderers(renderers: number[]) {
		this._textModel.updateRenderers(renderers);
	}

	dispose() {
		this._textModel.dispose();
		super.dispose();
	}
}

@extHostNamedCustomer(MainContext.MainThreadNotebook)
export class MainThreadNotebooks extends Disposable implements MainThreadNotebookShape {
	private readonly _notebookProviders = new Map<string, MainThreadNotebookController>();
	private readonly _proxy: ExtHostNotebookShape;

	constructor(
		extHostContext: IExtHostContext,
		@INotebookService private _notebookService: INotebookService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,

	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostNotebook);
		this.registerListeners();
	}

	async $tryApplyEdits(viewType: string, resource: UriComponents, modelVersionId: number, edits: ICellEditOperation[], renderers: number[]): Promise<boolean> {
		let controller = this._notebookProviders.get(viewType);

		if (controller) {
			return controller.tryApplyEdits(resource, modelVersionId, edits, renderers);
		}

		return false;
	}

	registerListeners() {
		this._register(this._notebookService.onDidChangeActiveEditor(e => {
			this._proxy.$updateActiveEditor(e.viewType, e.uri);
		}));

		let userOrder = this.configurationService.getValue<string[]>('notebook.displayOrder');
		this._proxy.$acceptDisplayOrder({
			defaultOrder: NOTEBOOK_DISPLAY_ORDER,
			userOrder: userOrder
		});

		this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectedKeys.indexOf('notebook.displayOrder') >= 0) {
				let userOrder = this.configurationService.getValue<string[]>('notebook.displayOrder');

				this._proxy.$acceptDisplayOrder({
					defaultOrder: NOTEBOOK_DISPLAY_ORDER,
					userOrder: userOrder
				});
			}
		});
	}

	async $registerNotebookRenderer(extension: NotebookExtensionDescription, type: string, selectors: INotebookMimeTypeSelector, handle: number, preloads: UriComponents[]): Promise<void> {
		this._notebookService.registerNotebookRenderer(handle, extension, type, selectors, preloads.map(uri => URI.revive(uri)));
	}

	async $unregisterNotebookRenderer(handle: number): Promise<void> {
		this._notebookService.unregisterNotebookRenderer(handle);
	}

	async $registerNotebookProvider(extension: NotebookExtensionDescription, viewType: string): Promise<void> {
		let controller = new MainThreadNotebookController(this._proxy, this, viewType);
		this._notebookProviders.set(viewType, controller);
		this._notebookService.registerNotebookController(viewType, extension, controller);
		return;
	}

	async $unregisterNotebookProvider(viewType: string): Promise<void> {
		this._notebookProviders.delete(viewType);
		this._notebookService.unregisterNotebookProvider(viewType);
		return;
	}

	async $createNotebookDocument(handle: number, viewType: string, resource: UriComponents): Promise<void> {
		let controller = this._notebookProviders.get(viewType);

		if (controller) {
			controller.createNotebookDocument(handle, viewType, resource);
		}

		return;
	}

	async $updateNotebookLanguages(viewType: string, resource: UriComponents, languages: string[]): Promise<void> {
		let controller = this._notebookProviders.get(viewType);

		if (controller) {
			controller.updateLanguages(resource, languages);
		}
	}

	async $updateNotebookMetadata(viewType: string, resource: UriComponents, metadata: NotebookDocumentMetadata): Promise<void> {
		let controller = this._notebookProviders.get(viewType);

		if (controller) {
			controller.updateNotebookMetadata(resource, metadata);
		}
	}

	async $updateNotebookCellMetadata(viewType: string, resource: UriComponents, handle: number, metadata: NotebookCellMetadata): Promise<void> {
		let controller = this._notebookProviders.get(viewType);

		if (controller) {
			controller.updateNotebookCellMetadata(resource, handle, metadata);
		}
	}

	async resolveNotebook(viewType: string, uri: URI): Promise<number | undefined> {
		let handle = await this._proxy.$resolveNotebook(viewType, uri);
		return handle;
	}

	async $spliceNotebookCellOutputs(viewType: string, resource: UriComponents, cellHandle: number, splices: NotebookCellOutputsSplice[], renderers: number[]): Promise<void> {
		let controller = this._notebookProviders.get(viewType);
		controller?.spliceNotebookCellOutputs(resource, cellHandle, splices, renderers);
	}

	async executeNotebook(viewType: string, uri: URI): Promise<void> {
		return this._proxy.$executeNotebook(viewType, uri, undefined);
	}

	async $postMessage(handle: number, value: any): Promise<boolean> {

		const activeEditorPane = this.editorService.activeEditorPane as any | undefined;
		if (activeEditorPane?.isNotebookEditor) {
			const notebookEditor = (activeEditorPane as INotebookEditor);

			if (notebookEditor.viewModel?.handle === handle) {
				notebookEditor.postMessage(value);
				return true;
			}
		}

		return false;
	}
}

export class MainThreadNotebookController implements IMainNotebookController {
	private _mapping: Map<string, MainThreadNotebookDocument> = new Map();

	constructor(
		private readonly _proxy: ExtHostNotebookShape,
		private _mainThreadNotebook: MainThreadNotebooks,
		private _viewType: string
	) {
	}

	async resolveNotebook(viewType: string, uri: URI): Promise<NotebookTextModel | undefined> {
		// TODO: resolve notebook should wait for all notebook document destory operations to finish.
		let mainthreadNotebook = this._mapping.get(URI.from(uri).toString());

		if (mainthreadNotebook) {
			return mainthreadNotebook.textModel;
		}

		let notebookHandle = await this._mainThreadNotebook.resolveNotebook(viewType, uri);
		if (notebookHandle !== undefined) {
			mainthreadNotebook = this._mapping.get(URI.from(uri).toString());
			if (mainthreadNotebook && mainthreadNotebook.textModel.cells.length === 0) {
				// it's empty, we should create an empty template one
				const mainCell = mainthreadNotebook.textModel.createCellTextModel([''], mainthreadNotebook.textModel.languages.length ? mainthreadNotebook.textModel.languages[0] : '', CellKind.Code, [], undefined);
				mainthreadNotebook.textModel.insertTemplateCell(mainCell);
			}
			return mainthreadNotebook?.textModel;
		}

		return undefined;
	}

	async tryApplyEdits(resource: UriComponents, modelVersionId: number, edits: ICellEditOperation[], renderers: number[]): Promise<boolean> {
		let mainthreadNotebook = this._mapping.get(URI.from(resource).toString());

		if (mainthreadNotebook) {
			mainthreadNotebook.updateRenderers(renderers);
			return mainthreadNotebook.applyEdit(modelVersionId, edits);
		}

		return false;
	}

	spliceNotebookCellOutputs(resource: UriComponents, cellHandle: number, splices: NotebookCellOutputsSplice[], renderers: number[]): void {
		let mainthreadNotebook = this._mapping.get(URI.from(resource).toString());
		mainthreadNotebook?.textModel.updateRenderers(renderers);
		mainthreadNotebook?.textModel.$spliceNotebookCellOutputs(cellHandle, splices);
	}

	async executeNotebook(viewType: string, uri: URI): Promise<void> {
		this._mainThreadNotebook.executeNotebook(viewType, uri);
	}

	onDidReceiveMessage(uri: UriComponents, message: any): void {
		this._proxy.$onDidReceiveMessage(uri, message);
	}

	// Methods for ExtHost
	async createNotebookDocument(handle: number, viewType: string, resource: UriComponents): Promise<void> {
		let document = new MainThreadNotebookDocument(this._proxy, handle, viewType, URI.revive(resource));
		this._mapping.set(URI.revive(resource).toString(), document);
	}

	updateLanguages(resource: UriComponents, languages: string[]) {
		let document = this._mapping.get(URI.from(resource).toString());
		document?.textModel.updateLanguages(languages);
	}

	updateNotebookMetadata(resource: UriComponents, metadata: NotebookDocumentMetadata) {
		let document = this._mapping.get(URI.from(resource).toString());
		document?.textModel.updateNotebookMetadata(metadata);
	}

	updateNotebookCellMetadata(resource: UriComponents, handle: number, metadata: NotebookCellMetadata) {
		let document = this._mapping.get(URI.from(resource).toString());
		document?.textModel.updateNotebookCellMetadata(handle, metadata);
	}

	updateNotebookRenderers(resource: UriComponents, renderers: number[]): void {
		let document = this._mapping.get(URI.from(resource).toString());
		document?.textModel.updateRenderers(renderers);
	}

	async executeNotebookCell(uri: URI, handle: number): Promise<void> {
		return this._proxy.$executeNotebook(this._viewType, uri, handle);
	}

	async destoryNotebookDocument(notebook: INotebookTextModel): Promise<void> {
		let document = this._mapping.get(URI.from(notebook.uri).toString());

		if (!document) {
			return;
		}

		let removeFromExtHost = await this._proxy.$destoryNotebookDocument(this._viewType, notebook.uri);
		if (removeFromExtHost) {
			document.dispose();
			this._mapping.delete(URI.from(notebook.uri).toString());
		}
	}

	async save(uri: URI): Promise<boolean> {
		return this._proxy.$saveNotebook(this._viewType, uri);
	}
}
