/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Disposable, IDisposable, DisposableStore, toDisposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { notebookProviderExtensionPoint, notebookRendererExtensionPoint, INotebookEditorContribution } from 'vs/workbench/contrib/notebook/browser/extensionPoint';
import { NotebookProviderInfo, NotebookEditorDescriptor } from 'vs/workbench/contrib/notebook/common/notebookProvider';
import { NotebookExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { Emitter, Event } from 'vs/base/common/event';
import { INotebookTextModel, INotebookRendererInfo, INotebookKernelInfo, CellOutputKind, ITransformedDisplayOutputDto, IDisplayOutput, ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER, NOTEBOOK_DISPLAY_ORDER, sortMimeTypes, IOrderedMimeType, mimeTypeSupportedByCore, IOutputRenderRequestOutputInfo, IOutputRenderRequestCellInfo, NotebookCellOutputsSplice, ICellEditOperation, CellEditType, ICellInsertEdit, IOutputRenderResponse, IProcessedOutput, BUILTIN_RENDERER_ID, NotebookEditorPriority, INotebookKernelProvider, notebookDocumentFilterMatch, INotebookKernelInfo2 } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { NotebookOutputRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookOutputRenderer';
import { Iterable } from 'vs/base/common/iterator';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IEditorService, ICustomEditorViewTypesHandler, ICustomEditorInfo } from 'vs/workbench/services/editor/common/editorService';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { INotebookService, IMainNotebookController } from 'vs/workbench/contrib/notebook/common/notebookService';
import * as glob from 'vs/base/common/glob';
import { basename } from 'vs/base/common/path';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { Memento } from 'vs/workbench/common/memento';
import { StorageScope, IStorageService } from 'vs/platform/storage/common/storage';
import { IExtensionPointUser } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { generateUuid } from 'vs/base/common/uuid';
import { flatten } from 'vs/base/common/arrays';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { NotebookKernelProviderAssociationRegistry, updateNotebookKernelProvideAssociationSchema, NotebookViewTypesExtensionRegistry } from 'vs/workbench/contrib/notebook/browser/notebookKernelAssociation';
import { PureNotebookOutputRenderer } from 'vs/workbench/contrib/notebook/browser/notebookPureOutputRenderer';

function MODEL_ID(resource: URI): string {
	return resource.toString();
}

export class NotebookKernelProviderInfoStore extends Disposable {
	private readonly _notebookKernelProviders: INotebookKernelProvider[] = [];

	constructor() {
		super();
	}

	add(provider: INotebookKernelProvider) {
		this._notebookKernelProviders.push(provider);
		this._updateProviderExtensionsInfo();

		return toDisposable(() => {
			let idx = this._notebookKernelProviders.indexOf(provider);
			if (idx >= 0) {
				this._notebookKernelProviders.splice(idx, 1);
			}

			this._updateProviderExtensionsInfo();
		});
	}

	get(viewType: string, resource: URI) {
		return this._notebookKernelProviders.filter(provider => notebookDocumentFilterMatch(provider.selector, viewType, resource));
	}

	private _updateProviderExtensionsInfo() {
		NotebookKernelProviderAssociationRegistry.extensionIds.length = 0;
		NotebookKernelProviderAssociationRegistry.extensionDescriptions.length = 0;

		this._notebookKernelProviders.forEach(provider => {
			NotebookKernelProviderAssociationRegistry.extensionIds.push(provider.providerExtensionId);
			NotebookKernelProviderAssociationRegistry.extensionDescriptions.push(provider.providerDescription || '');
		});

		updateNotebookKernelProvideAssociationSchema();
	}
}

export class NotebookProviderInfoStore extends Disposable {
	private static readonly CUSTOM_EDITORS_STORAGE_ID = 'notebookEditors';
	private static readonly CUSTOM_EDITORS_ENTRY_ID = 'editors';

	private readonly _memento: Memento;
	private _handled: boolean = false;
	constructor(
		storageService: IStorageService,
		extensionService: IExtensionService

	) {
		super();
		this._memento = new Memento(NotebookProviderInfoStore.CUSTOM_EDITORS_STORAGE_ID, storageService);

		const mementoObject = this._memento.getMemento(StorageScope.GLOBAL);
		for (const info of (mementoObject[NotebookProviderInfoStore.CUSTOM_EDITORS_ENTRY_ID] || []) as NotebookEditorDescriptor[]) {
			this.add(new NotebookProviderInfo(info));
		}

		this._updateProviderExtensionsInfo();

		this._register(extensionService.onDidRegisterExtensions(() => {
			if (!this._handled) {
				// there is no extension point registered for notebook content provider
				// clear the memento and cache
				this.clear();
				mementoObject[NotebookProviderInfoStore.CUSTOM_EDITORS_ENTRY_ID] = [];
				this._memento.saveMemento();

				this._updateProviderExtensionsInfo();
			}
		}));
	}

	setupHandler(extensions: readonly IExtensionPointUser<INotebookEditorContribution[]>[]) {
		this._handled = true;
		this.clear();

		for (const extension of extensions) {
			for (const notebookContribution of extension.value) {
				this.add(new NotebookProviderInfo({
					id: notebookContribution.viewType,
					displayName: notebookContribution.displayName,
					selector: notebookContribution.selector || [],
					priority: this._convertPriority(notebookContribution.priority),
					providerExtensionId: extension.description.identifier.value,
					providerDescription: extension.description.description,
					providerDisplayName: extension.description.isBuiltin ? nls.localize('builtinProviderDisplayName', "Built-in") : extension.description.displayName || extension.description.identifier.value,
					providerExtensionLocation: extension.description.extensionLocation
				}));
			}
		}

		const mementoObject = this._memento.getMemento(StorageScope.GLOBAL);
		mementoObject[NotebookProviderInfoStore.CUSTOM_EDITORS_ENTRY_ID] = Array.from(this._contributedEditors.values());
		this._memento.saveMemento();

		this._updateProviderExtensionsInfo();
	}

	private _updateProviderExtensionsInfo() {
		NotebookViewTypesExtensionRegistry.viewTypes.length = 0;
		NotebookViewTypesExtensionRegistry.viewTypeDescriptions.length = 0;

		for (const contribute of this._contributedEditors) {
			if (contribute[1].providerExtensionId) {
				NotebookViewTypesExtensionRegistry.viewTypes.push(contribute[1].id);
				NotebookViewTypesExtensionRegistry.viewTypeDescriptions.push(`${contribute[1].displayName}`);
			}
		}

		updateNotebookKernelProvideAssociationSchema();
	}

	private _convertPriority(priority?: string) {
		if (!priority) {
			return NotebookEditorPriority.default;
		}

		if (priority === NotebookEditorPriority.default) {
			return NotebookEditorPriority.default;
		}

		return NotebookEditorPriority.option;

	}

	private readonly _contributedEditors = new Map<string, NotebookProviderInfo>();

	clear() {
		this._contributedEditors.clear();
	}

	get(viewType: string): NotebookProviderInfo | undefined {
		return this._contributedEditors.get(viewType);
	}

	add(info: NotebookProviderInfo): void {
		if (this._contributedEditors.has(info.id)) {
			return;
		}
		this._contributedEditors.set(info.id, info);
	}

	getContributedNotebook(resource: URI): readonly NotebookProviderInfo[] {
		return [...Iterable.filter(this._contributedEditors.values(), customEditor => resource.scheme === 'untitled' || customEditor.matches(resource))];
	}

	public [Symbol.iterator](): Iterator<NotebookProviderInfo> {
		return this._contributedEditors.values();
	}
}

export class NotebookOutputRendererInfoStore {
	private readonly contributedRenderers = new Map<string, NotebookOutputRendererInfo>();

	clear() {
		this.contributedRenderers.clear();
	}

	get(viewType: string): NotebookOutputRendererInfo | undefined {
		return this.contributedRenderers.get(viewType);
	}

	add(info: NotebookOutputRendererInfo): void {
		if (this.contributedRenderers.has(info.id)) {
			return;
		}
		this.contributedRenderers.set(info.id, info);
	}

	getContributedRenderer(mimeType: string): readonly NotebookOutputRendererInfo[] {
		return Array.from(this.contributedRenderers.values()).filter(customEditor =>
			customEditor.matches(mimeType));
	}
}

class ModelData implements IDisposable {
	private readonly _modelEventListeners = new DisposableStore();

	constructor(
		public model: NotebookTextModel,
		onWillDispose: (model: INotebookTextModel) => void
	) {
		this._modelEventListeners.add(model.onWillDispose(() => onWillDispose(model)));
	}

	dispose(): void {
		this._modelEventListeners.dispose();
	}
}
export class NotebookService extends Disposable implements INotebookService, ICustomEditorViewTypesHandler {
	declare readonly _serviceBrand: undefined;
	static mainthreadNotebookDocumentHandle: number = 0;
	private readonly _notebookProviders = new Map<string, { controller: IMainNotebookController, extensionData: NotebookExtensionDescription }>();
	private readonly _notebookRenderers = new Map<string, INotebookRendererInfo>();
	private readonly _notebookKernels = new Map<string, INotebookKernelInfo>();
	notebookProviderInfoStore: NotebookProviderInfoStore;
	notebookRenderersInfoStore: NotebookOutputRendererInfoStore = new NotebookOutputRendererInfoStore();
	notebookKernelProviderInfoStore: NotebookKernelProviderInfoStore = new NotebookKernelProviderInfoStore();
	private readonly _models = new Map<string, ModelData>();
	private _onDidChangeActiveEditor = new Emitter<string | null>();
	onDidChangeActiveEditor: Event<string | null> = this._onDidChangeActiveEditor.event;
	private _activeEditorDisposables = new DisposableStore();
	private _onDidChangeVisibleEditors = new Emitter<string[]>();
	onDidChangeVisibleEditors: Event<string[]> = this._onDidChangeVisibleEditors.event;
	private readonly _onNotebookEditorAdd: Emitter<INotebookEditor> = this._register(new Emitter<INotebookEditor>());
	public readonly onNotebookEditorAdd: Event<INotebookEditor> = this._onNotebookEditorAdd.event;
	private readonly _onNotebookEditorsRemove: Emitter<INotebookEditor[]> = this._register(new Emitter<INotebookEditor[]>());
	public readonly onNotebookEditorsRemove: Event<INotebookEditor[]> = this._onNotebookEditorsRemove.event;
	private readonly _onNotebookDocumentAdd: Emitter<URI[]> = this._register(new Emitter<URI[]>());
	public readonly onNotebookDocumentAdd: Event<URI[]> = this._onNotebookDocumentAdd.event;
	private readonly _onNotebookDocumentRemove: Emitter<URI[]> = this._register(new Emitter<URI[]>());
	public readonly onNotebookDocumentRemove: Event<URI[]> = this._onNotebookDocumentRemove.event;
	private readonly _notebookEditors = new Map<string, INotebookEditor>();

	private readonly _onDidChangeViewTypes = new Emitter<void>();
	onDidChangeViewTypes: Event<void> = this._onDidChangeViewTypes.event;

	private readonly _onDidChangeKernels = new Emitter<void>();
	onDidChangeKernels: Event<void> = this._onDidChangeKernels.event;
	private readonly _onDidChangeNotebookActiveKernel = new Emitter<{ uri: URI, providerHandle: number | undefined, kernelId: string | undefined }>();
	onDidChangeNotebookActiveKernel: Event<{ uri: URI, providerHandle: number | undefined, kernelId: string | undefined }> = this._onDidChangeNotebookActiveKernel.event;
	private cutItems: NotebookCellTextModel[] | undefined;
	private _lastClipboardIsCopy: boolean = true;

	private _displayOrder: { userOrder: string[], defaultOrder: string[] } = Object.create(null);

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IEditorService private readonly _editorService: IEditorService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IStorageService private readonly _storageService: IStorageService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService
	) {
		super();

		this.notebookProviderInfoStore = new NotebookProviderInfoStore(this._storageService, this._extensionService);
		this._register(this.notebookProviderInfoStore);

		notebookProviderExtensionPoint.setHandler((extensions) => {
			this.notebookProviderInfoStore.setupHandler(extensions);
		});

		notebookRendererExtensionPoint.setHandler((renderers) => {
			this.notebookRenderersInfoStore.clear();

			for (const extension of renderers) {
				for (const notebookContribution of extension.value) {
					this.notebookRenderersInfoStore.add(new NotebookOutputRendererInfo({
						id: notebookContribution.viewType,
						displayName: notebookContribution.displayName,
						mimeTypes: notebookContribution.mimeTypes || [],
					}));

					if (notebookContribution.entrypoint) {
						this._notebookRenderers.set(notebookContribution.viewType, new PureNotebookOutputRenderer(notebookContribution.viewType, extension.description, notebookContribution.entrypoint));
					}
				}
			}

			// console.log(this.notebookRenderersInfoStore);
		});

		this._editorService.registerCustomEditorViewTypesHandler('Notebook', this);

		const updateOrder = () => {
			let userOrder = this._configurationService.getValue<string[]>('notebook.displayOrder');
			this._displayOrder = {
				defaultOrder: this._accessibilityService.isScreenReaderOptimized() ? ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER : NOTEBOOK_DISPLAY_ORDER,
				userOrder: userOrder
			};
		};

		updateOrder();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectedKeys.indexOf('notebook.displayOrder') >= 0) {
				updateOrder();
			}
		}));

		this._register(this._accessibilityService.onDidChangeScreenReaderOptimized(() => {
			updateOrder();
		}));
	}

	getViewTypes(): ICustomEditorInfo[] {
		return [...this.notebookProviderInfoStore].map(info => ({
			id: info.id,
			displayName: info.displayName,
			providerDisplayName: info.providerDisplayName
		}));
	}

	async canResolve(viewType: string): Promise<boolean> {
		if (!this._notebookProviders.has(viewType)) {
			await this._extensionService.whenInstalledExtensionsRegistered();
			// notebook providers/kernels/renderers might use `*` as activation event.
			await this._extensionService.activateByEvent(`*`);
			// this awaits full activation of all matching extensions
			await this._extensionService.activateByEvent(`onNotebookEditor:${viewType}`);
		}
		return this._notebookProviders.has(viewType);
	}

	registerNotebookController(viewType: string, extensionData: NotebookExtensionDescription, controller: IMainNotebookController) {
		this._notebookProviders.set(viewType, { extensionData, controller });
		this.notebookProviderInfoStore.get(viewType)!.kernel = controller.kernel;
		this._onDidChangeViewTypes.fire();
	}

	unregisterNotebookProvider(viewType: string): void {
		this._notebookProviders.delete(viewType);
		this._onDidChangeViewTypes.fire();
	}

	registerNotebookRenderer(id: string, renderer: INotebookRendererInfo) {
		this._notebookRenderers.set(id, renderer);
	}

	unregisterNotebookRenderer(id: string) {
		this._notebookRenderers.delete(id);
	}

	registerNotebookKernel(notebook: INotebookKernelInfo): void {
		this._notebookKernels.set(notebook.id, notebook);
		this._onDidChangeKernels.fire();
	}

	unregisterNotebookKernel(id: string): void {
		this._notebookKernels.delete(id);
		this._onDidChangeKernels.fire();
	}

	registerNotebookKernelProvider(provider: INotebookKernelProvider): IDisposable {
		const d = this.notebookKernelProviderInfoStore.add(provider);
		const kernelChangeEventListener = provider.onDidChangeKernels(() => {
			this._onDidChangeKernels.fire();
		});

		this._onDidChangeKernels.fire();
		return toDisposable(() => {
			kernelChangeEventListener.dispose();
			d.dispose();
		});
	}

	async getContributedNotebookKernels2(viewType: string, resource: URI, token: CancellationToken): Promise<INotebookKernelInfo2[]> {
		const filteredProvider = this.notebookKernelProviderInfoStore.get(viewType, resource);
		const result = new Array<INotebookKernelInfo2[]>(filteredProvider.length);

		const promises = filteredProvider.map(async (provider, index) => {
			const data = await provider.provideKernels(resource, token);
			result[index] = data.map(dto => {
				return {
					extension: dto.extension,
					extensionLocation: dto.extensionLocation,
					id: dto.id,
					label: dto.label,
					description: dto.description,
					isPreferred: dto.isPreferred,
					preloads: dto.preloads,
					resolve: async (uri: URI, editorId: string, token: CancellationToken) => {
						return provider.resolveKernel(editorId, uri, dto.id, token);
					},
					executeNotebookCell: async (uri: URI, handle: number | undefined) => {
						return provider.executeNotebook(uri, dto.id, handle);
					}
				};
			});
		});

		await Promise.all(promises);

		return flatten(result);
	}

	getContributedNotebookKernels(viewType: string, resource: URI): INotebookKernelInfo[] {
		let kernelInfos: INotebookKernelInfo[] = [];
		this._notebookKernels.forEach(kernel => {
			if (this._notebookKernelMatch(resource, kernel!.selectors)) {
				kernelInfos.push(kernel!);
			}
		});

		// sort by extensions

		const notebookContentProvider = this._notebookProviders.get(viewType);

		if (!notebookContentProvider) {
			return kernelInfos;
		}

		kernelInfos = kernelInfos.sort((a, b) => {
			if (a.extension.value === notebookContentProvider!.extensionData.id.value) {
				return -1;
			} else if (b.extension.value === notebookContentProvider!.extensionData.id.value) {
				return 1;
			} else {
				return 0;
			}
		});

		return kernelInfos;
	}

	private _notebookKernelMatch(resource: URI, selectors: (string | glob.IRelativePattern)[]): boolean {
		for (let i = 0; i < selectors.length; i++) {
			const pattern = typeof selectors[i] !== 'string' ? selectors[i] : selectors[i].toString();
			if (glob.match(pattern, basename(resource.fsPath).toLowerCase())) {
				return true;
			}
		}

		return false;
	}

	getRendererInfo(id: string): INotebookRendererInfo | undefined {
		const renderer = this._notebookRenderers.get(id);

		return renderer;
	}

	async resolveNotebook(viewType: string, uri: URI, forceReload: boolean, editorId?: string, backupId?: string): Promise<NotebookTextModel | undefined> {
		const provider = this._notebookProviders.get(viewType);
		if (!provider) {
			return undefined;
		}

		const modelId = MODEL_ID(uri);

		let notebookModel: NotebookTextModel | undefined = undefined;
		if (this._models.has(modelId)) {
			// the model already exists
			notebookModel = this._models.get(modelId)!.model;
			if (forceReload) {
				await provider.controller.reloadNotebook(notebookModel);
			}

			return notebookModel;
		} else {
			notebookModel = this._instantiationService.createInstance(NotebookTextModel, NotebookService.mainthreadNotebookDocumentHandle++, viewType, provider.controller.supportBackup, uri);
			await provider.controller.createNotebook(notebookModel, backupId);

			if (!notebookModel) {
				return undefined;
			}
		}

		// new notebook model created
		const modelData = new ModelData(
			notebookModel!,
			(model) => this._onWillDisposeDocument(model),
		);

		this._models.set(modelId, modelData);
		this._onNotebookDocumentAdd.fire([notebookModel!.uri]);
		// after the document is added to the store and sent to ext host, we transform the ouputs
		await this.transformTextModelOutputs(notebookModel!);

		if (editorId) {
			await provider.controller.resolveNotebookEditor(viewType, uri, editorId);
		}

		return modelData.model;
	}

	getNotebookTextModel(uri: URI): NotebookTextModel | undefined {
		const modelId = MODEL_ID(uri);

		return this._models.get(modelId)?.model;
	}

	private async _fillInTransformedOutputs<T>(
		renderers: Set<string>,
		requestItems: IOutputRenderRequestCellInfo<T>[],
		renderFunc: (rendererId: string, items: IOutputRenderRequestCellInfo<T>[]) => Promise<IOutputRenderResponse<T> | undefined>,
		lookUp: (key: T) => { outputs: IProcessedOutput[] }
	) {
		for (let id of renderers) {
			const requestsPerRenderer: IOutputRenderRequestCellInfo<T>[] = requestItems.map(req => {
				return {
					key: req.key,
					outputs: req.outputs.filter(output => output.handlerId === id)
				};
			});

			const response = await renderFunc(id, requestsPerRenderer);

			// mix the response with existing outputs, which will replace the picked transformed mimetype with resolved result
			if (response) {
				response.items.forEach(cellInfo => {
					const cell = lookUp(cellInfo.key)!;
					cellInfo.outputs.forEach(outputInfo => {
						const output = cell.outputs[outputInfo.index];
						if (output.outputKind === CellOutputKind.Rich && output.orderedMimeTypes && output.orderedMimeTypes.length) {
							output.orderedMimeTypes[0] = {
								mimeType: outputInfo.mimeType,
								isResolved: true,
								rendererId: outputInfo.handlerId,
								output: outputInfo.transformedOutput
							};
						}
					});
				});
			}
		}
	}

	async transformTextModelOutputs(textModel: NotebookTextModel) {
		const renderers = new Set<string>();

		const cellMapping: Map<string, NotebookCellTextModel> = new Map();

		const requestItems: IOutputRenderRequestCellInfo<UriComponents>[] = [];
		for (let i = 0; i < textModel.cells.length; i++) {
			const cell = textModel.cells[i];
			cellMapping.set(cell.uri.fragment, cell);
			const outputs = cell.outputs;
			const outputRequest: IOutputRenderRequestOutputInfo[] = [];

			outputs.forEach((output, index) => {
				if (output.outputKind === CellOutputKind.Rich) {
					// TODO no string[] casting
					const ret = this._transformMimeTypes(output, output.outputId, textModel.metadata.displayOrder as string[] || []);
					const orderedMimeTypes = ret.orderedMimeTypes!;
					const pickedMimeTypeIndex = ret.pickedMimeTypeIndex!;
					output.pickedMimeTypeIndex = pickedMimeTypeIndex;
					output.orderedMimeTypes = orderedMimeTypes;

					if (orderedMimeTypes[pickedMimeTypeIndex!].rendererId && orderedMimeTypes[pickedMimeTypeIndex].rendererId !== BUILTIN_RENDERER_ID) {
						outputRequest.push({ index, handlerId: orderedMimeTypes[pickedMimeTypeIndex].rendererId!, mimeType: orderedMimeTypes[pickedMimeTypeIndex].mimeType, outputId: output.outputId });
						renderers.add(orderedMimeTypes[pickedMimeTypeIndex].rendererId!);
					}
				}
			});

			requestItems.push({ key: cell.uri, outputs: outputRequest });
		}

		await this._fillInTransformedOutputs<UriComponents>(renderers, requestItems, async (rendererId, items) => {
			return await this._notebookRenderers.get(rendererId)?.render(textModel.uri, { items: items });
		}, (key: UriComponents) => { return cellMapping.get(URI.revive(key).fragment)!; });

		textModel.updateRenderers([...renderers]);
	}

	async transformEditsOutputs(textModel: NotebookTextModel, edits: ICellEditOperation[]) {
		const renderers = new Set<string>();
		const requestItems: IOutputRenderRequestCellInfo<[number, number]>[] = [];

		edits.forEach((edit, editIndex) => {
			if (edit.editType === CellEditType.Insert) {
				edit.cells.forEach((cell, cellIndex) => {
					const outputs = cell.outputs;
					const outputRequest: IOutputRenderRequestOutputInfo[] = [];
					outputs.map((output, index) => {
						if (output.outputKind === CellOutputKind.Rich) {
							const ret = this._transformMimeTypes(output, output.outputId, textModel.metadata.displayOrder as string[] || []);
							const orderedMimeTypes = ret.orderedMimeTypes!;
							const pickedMimeTypeIndex = ret.pickedMimeTypeIndex!;
							output.pickedMimeTypeIndex = pickedMimeTypeIndex;
							output.orderedMimeTypes = orderedMimeTypes;

							if (orderedMimeTypes[pickedMimeTypeIndex!].rendererId && orderedMimeTypes[pickedMimeTypeIndex].rendererId !== BUILTIN_RENDERER_ID) {
								outputRequest.push({ index, handlerId: orderedMimeTypes[pickedMimeTypeIndex].rendererId!, mimeType: orderedMimeTypes[pickedMimeTypeIndex].mimeType, output: output, outputId: output.outputId });
								renderers.add(orderedMimeTypes[pickedMimeTypeIndex].rendererId!);
							}
						}
					});

					requestItems.push({ key: [editIndex, cellIndex], outputs: outputRequest });
				});
			}
		});

		await this._fillInTransformedOutputs<[number, number]>(renderers, requestItems, async (rendererId, items) => {
			return await this._notebookRenderers.get(rendererId)?.render2<[number, number]>(textModel.uri, { items: items });
		}, (key: [number, number]) => {
			return (edits[key[0]] as ICellInsertEdit).cells[key[1]];
		});

		textModel.updateRenderers([...renderers]);
	}

	async transformSpliceOutputs(textModel: NotebookTextModel, splices: NotebookCellOutputsSplice[]) {
		const renderers = new Set<string>();
		const requestItems: IOutputRenderRequestCellInfo<number>[] = [];

		splices.forEach((splice, spliceIndex) => {
			const outputs = splice[2];
			const outputRequest: IOutputRenderRequestOutputInfo[] = [];
			outputs.map((output, index) => {
				if (output.outputKind === CellOutputKind.Rich) {
					const ret = this._transformMimeTypes(output, output.outputId, textModel.metadata.displayOrder as string[] || []);
					const orderedMimeTypes = ret.orderedMimeTypes!;
					const pickedMimeTypeIndex = ret.pickedMimeTypeIndex!;
					output.pickedMimeTypeIndex = pickedMimeTypeIndex;
					output.orderedMimeTypes = orderedMimeTypes;

					if (orderedMimeTypes[pickedMimeTypeIndex!].rendererId && orderedMimeTypes[pickedMimeTypeIndex].rendererId !== BUILTIN_RENDERER_ID) {
						outputRequest.push({ index, handlerId: orderedMimeTypes[pickedMimeTypeIndex].rendererId!, mimeType: orderedMimeTypes[pickedMimeTypeIndex].mimeType, output: output, outputId: output.outputId });
						renderers.add(orderedMimeTypes[pickedMimeTypeIndex].rendererId!);
					}
				}
			});
			requestItems.push({ key: spliceIndex, outputs: outputRequest });
		});

		await this._fillInTransformedOutputs<number>(renderers, requestItems, async (rendererId, items) => {
			return await this._notebookRenderers.get(rendererId)?.render2<number>(textModel.uri, { items: items });
		}, (key: number) => {
			return { outputs: splices[key][2] };
		});

		textModel.updateRenderers([...renderers]);
	}

	async transformSingleOutput(textModel: NotebookTextModel, output: IProcessedOutput, rendererId: string, mimeType: string): Promise<IOrderedMimeType | undefined> {
		const items = [
			{
				key: 0,
				outputs: [
					{
						index: 0,
						outputId: generateUuid(),
						handlerId: rendererId,
						mimeType: mimeType,
						output: output
					}
				]
			}
		];
		const response = await this._notebookRenderers.get(rendererId)?.render2<number>(textModel.uri, { items: items });

		if (response) {
			textModel.updateRenderers([rendererId]);
			const outputInfo = response.items[0].outputs[0];

			return {
				mimeType: outputInfo.mimeType,
				isResolved: true,
				rendererId: outputInfo.handlerId,
				output: outputInfo.transformedOutput
			};
		}

		return;
	}

	private _transformMimeTypes(output: IDisplayOutput, outputId: string, documentDisplayOrder: string[]): ITransformedDisplayOutputDto {
		let mimeTypes = Object.keys(output.data);
		let coreDisplayOrder = this._displayOrder;
		const sorted = sortMimeTypes(mimeTypes, coreDisplayOrder?.userOrder || [], documentDisplayOrder, coreDisplayOrder?.defaultOrder || []);

		let orderMimeTypes: IOrderedMimeType[] = [];

		sorted.forEach(mimeType => {
			let handlers = this._findBestMatchedRenderer(mimeType);

			if (handlers.length) {
				const handler = handlers[0];

				orderMimeTypes.push({
					mimeType: mimeType,
					isResolved: false,
					rendererId: handler.id,
				});

				for (let i = 1; i < handlers.length; i++) {
					orderMimeTypes.push({
						mimeType: mimeType,
						isResolved: false,
						rendererId: handlers[i].id
					});
				}

				if (mimeTypeSupportedByCore(mimeType)) {
					orderMimeTypes.push({
						mimeType: mimeType,
						isResolved: false,
						rendererId: BUILTIN_RENDERER_ID
					});
				}
			} else {
				orderMimeTypes.push({
					mimeType: mimeType,
					isResolved: false,
					rendererId: BUILTIN_RENDERER_ID
				});
			}
		});

		return {
			outputKind: output.outputKind,
			outputId,
			data: output.data,
			orderedMimeTypes: orderMimeTypes,
			pickedMimeTypeIndex: 0
		};
	}

	private _findBestMatchedRenderer(mimeType: string): readonly NotebookOutputRendererInfo[] {
		return this.notebookRenderersInfoStore.getContributedRenderer(mimeType);
	}

	async executeNotebook(viewType: string, uri: URI): Promise<void> {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.executeNotebookByAttachedKernel(viewType, uri);
		}

		return;
	}

	async executeNotebookCell(viewType: string, uri: URI, handle: number): Promise<void> {
		const provider = this._notebookProviders.get(viewType);
		if (provider) {
			await provider.controller.executeNotebookCell(uri, handle);
		}
	}

	async cancelNotebook(viewType: string, uri: URI): Promise<void> {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.cancelNotebookByAttachedKernel(viewType, uri);
		}

		return;
	}

	async cancelNotebookCell(viewType: string, uri: URI, handle: number): Promise<void> {
		const provider = this._notebookProviders.get(viewType);
		if (provider) {
			await provider.controller.cancelNotebookCell(uri, handle);
		}
	}

	async executeNotebook2(viewType: string, uri: URI, kernelId: string): Promise<void> {
		const kernel = this._notebookKernels.get(kernelId);
		if (kernel) {
			await kernel.executeNotebook(viewType, uri, undefined);
		}
	}

	async executeNotebookCell2(viewType: string, uri: URI, handle: number, kernelId: string): Promise<void> {
		const kernel = this._notebookKernels.get(kernelId);
		if (kernel) {
			await kernel.executeNotebook(viewType, uri, handle);
		}
	}

	getContributedNotebookProviders(resource: URI): readonly NotebookProviderInfo[] {
		return this.notebookProviderInfoStore.getContributedNotebook(resource);
	}

	getContributedNotebookProvider(viewType: string): NotebookProviderInfo | undefined {
		return this.notebookProviderInfoStore.get(viewType);
	}

	getContributedNotebookOutputRenderers(mimeType: string): readonly NotebookOutputRendererInfo[] {
		return this.notebookRenderersInfoStore.getContributedRenderer(mimeType);
	}

	getNotebookProviderResourceRoots(): URI[] {
		let ret: URI[] = [];
		this._notebookProviders.forEach(val => {
			ret.push(URI.revive(val.extensionData.location));
		});

		return ret;
	}

	removeNotebookEditor(editor: INotebookEditor) {
		let editorCache = this._notebookEditors.get(editor.getId());

		if (editorCache) {
			this._notebookEditors.delete(editor.getId());
			this._onNotebookEditorsRemove.fire([editor]);
		}
	}

	addNotebookEditor(editor: INotebookEditor) {
		this._notebookEditors.set(editor.getId(), editor);
		this._onNotebookEditorAdd.fire(editor);
	}

	getNotebookEditor(editorId: string) {
		return this._notebookEditors.get(editorId);
	}

	listNotebookEditors(): INotebookEditor[] {
		return [...this._notebookEditors].map(e => e[1]);
	}

	listVisibleNotebookEditors(): INotebookEditor[] {
		return this._editorService.visibleEditorPanes
			.filter(pane => (pane as unknown as { isNotebookEditor?: boolean }).isNotebookEditor)
			.map(pane => pane.getControl() as INotebookEditor)
			.filter(editor => !!editor)
			.filter(editor => this._notebookEditors.has(editor.getId()));
	}

	listNotebookDocuments(): NotebookTextModel[] {
		return [...this._models].map(e => e[1].model);
	}

	destoryNotebookDocument(viewType: string, notebook: INotebookTextModel): void {
		this._onWillDisposeDocument(notebook);
	}

	updateActiveNotebookEditor(editor: INotebookEditor | null) {
		this._activeEditorDisposables.clear();

		if (editor) {
			this._activeEditorDisposables.add(editor.onDidChangeKernel(() => {
				this._onDidChangeNotebookActiveKernel.fire({
					uri: editor.uri!,
					providerHandle: editor.activeKernel?.providerHandle,
					kernelId: editor.activeKernel?.id
				});
			}));
		}
		this._onDidChangeActiveEditor.fire(editor ? editor.getId() : null);
	}

	updateVisibleNotebookEditor(editors: string[]) {
		const alreadyCreated = editors.filter(editorId => this._notebookEditors.has(editorId));
		this._onDidChangeVisibleEditors.fire(alreadyCreated);
	}

	setToCopy(items: NotebookCellTextModel[], isCopy: boolean) {
		this.cutItems = items;
		this._lastClipboardIsCopy = isCopy;
	}

	getToCopy(): { items: NotebookCellTextModel[], isCopy: boolean; } | undefined {
		if (this.cutItems) {
			return { items: this.cutItems, isCopy: this._lastClipboardIsCopy };
		}

		return undefined;
	}

	async save(viewType: string, resource: URI, token: CancellationToken): Promise<boolean> {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.save(resource, token);
		}

		return false;
	}

	async saveAs(viewType: string, resource: URI, target: URI, token: CancellationToken): Promise<boolean> {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.saveAs(resource, target, token);
		}

		return false;
	}

	async backup(viewType: string, uri: URI, token: CancellationToken): Promise<string | undefined> {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.backup(uri, token);
		}

		return;
	}

	onDidReceiveMessage(viewType: string, editorId: string, rendererType: string | undefined, message: any): void {
		let provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.onDidReceiveMessage(editorId, rendererType, message);
		}
	}

	private _onWillDisposeDocument(model: INotebookTextModel): void {
		let modelId = MODEL_ID(model.uri);

		let modelData = this._models.get(modelId);
		this._models.delete(modelId);

		if (modelData) {
			// delete editors and documents
			const willRemovedEditors: INotebookEditor[] = [];
			this._notebookEditors.forEach(editor => {
				if (editor.textModel === modelData!.model) {
					willRemovedEditors.push(editor);
				}
			});

			willRemovedEditors.forEach(e => this._notebookEditors.delete(e.getId()));

			let provider = this._notebookProviders.get(modelData!.model.viewType);

			if (provider) {
				provider.controller.removeNotebookDocument(modelData!.model.uri);
				modelData!.model.dispose();
			}


			this._onNotebookEditorsRemove.fire(willRemovedEditors.map(e => e));
			this._onNotebookDocumentRemove.fire([modelData.model.uri]);
			modelData?.dispose();
		}
	}
}
