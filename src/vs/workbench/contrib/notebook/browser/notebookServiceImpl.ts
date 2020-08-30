/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { flatten } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import * as glob from 'vs/base/common/glob';
import { Iterable } from 'vs/base/common/iterator';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ResourceMap } from 'vs/base/common/map';
import { basename } from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import { RedoCommand, UndoCommand } from 'vs/editor/browser/editorExtensions';
import { CopyAction, CutAction, PasteAction } from 'vs/editor/contrib/clipboard/clipboard';
import * as nls from 'vs/nls';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { NotebookExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { Memento } from 'vs/workbench/common/memento';
import { INotebookEditorContribution, notebookProviderExtensionPoint, notebookRendererExtensionPoint } from 'vs/workbench/contrib/notebook/browser/extensionPoint';
import { getActiveNotebookEditor, INotebookEditor, NotebookEditorOptions } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookKernelProviderAssociationRegistry, NotebookViewTypesExtensionRegistry, updateNotebookKernelProvideAssociationSchema } from 'vs/workbench/contrib/notebook/browser/notebookKernelAssociation';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER, BUILTIN_RENDERER_ID, CellEditType, CellOutputKind, CellUri, DisplayOrderKey, ICellEditOperation, IDisplayOutput, INotebookKernelInfo, INotebookKernelInfo2, INotebookKernelProvider, INotebookRendererInfo, INotebookTextModel, IOrderedMimeType, ITransformedDisplayOutputDto, mimeTypeSupportedByCore, NotebookCellOutputsSplice, notebookDocumentFilterMatch, NotebookEditorPriority, NOTEBOOK_DISPLAY_ORDER, sortMimeTypes } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { NotebookOutputRendererInfo } from 'vs/workbench/contrib/notebook/common/notebookOutputRenderer';
import { NotebookEditorDescriptor, NotebookProviderInfo } from 'vs/workbench/contrib/notebook/common/notebookProvider';
import { IMainNotebookController, INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { ICustomEditorInfo, ICustomEditorViewTypesHandler, IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IExtensionPointUser } from 'vs/workbench/services/extensions/common/extensionsRegistry';

export class NotebookKernelProviderInfoStore extends Disposable {
	private readonly _notebookKernelProviders: INotebookKernelProvider[] = [];

	constructor() {
		super();
	}

	add(provider: INotebookKernelProvider) {
		this._notebookKernelProviders.push(provider);
		this._updateProviderExtensionsInfo();

		return toDisposable(() => {
			const idx = this._notebookKernelProviders.indexOf(provider);
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
	private readonly _notebookKernels = new Map<string, INotebookKernelInfo>();
	notebookProviderInfoStore: NotebookProviderInfoStore;
	notebookRenderersInfoStore: NotebookOutputRendererInfoStore = new NotebookOutputRendererInfoStore();
	notebookKernelProviderInfoStore: NotebookKernelProviderInfoStore = new NotebookKernelProviderInfoStore();
	private readonly _models = new ResourceMap<ModelData>();
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
	private readonly _onNotebookDocumentSaved: Emitter<URI> = this._register(new Emitter<URI>());
	public readonly onNotebookDocumentSaved: Event<URI> = this._onNotebookDocumentSaved.event;
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
					if (!notebookContribution.entrypoint) { // avoid crashing
						console.error(`Cannot register renderer for ${extension.description.identifier.value} since it did not have an entrypoint. This is now required: https://github.com/microsoft/vscode/issues/102644`);
						continue;
					}

					const id = notebookContribution.id ?? notebookContribution.viewType;
					if (!id) {
						console.error(`Notebook renderer from ${extension.description.identifier.value} is missing an 'id'`);
						continue;
					}

					this.notebookRenderersInfoStore.add(new NotebookOutputRendererInfo({
						id,
						extension: extension.description,
						entrypoint: notebookContribution.entrypoint,
						displayName: notebookContribution.displayName,
						mimeTypes: notebookContribution.mimeTypes || [],
					}));
				}
			}
		});

		this._editorService.registerCustomEditorViewTypesHandler('Notebook', this);

		const updateOrder = () => {
			const userOrder = this._configurationService.getValue<string[]>(DisplayOrderKey);
			this._displayOrder = {
				defaultOrder: this._accessibilityService.isScreenReaderOptimized() ? ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER : NOTEBOOK_DISPLAY_ORDER,
				userOrder: userOrder
			};
		};

		updateOrder();

		this._register(this._configurationService.onDidChangeConfiguration(e => {
			if (e.affectedKeys.indexOf(DisplayOrderKey) >= 0) {
				updateOrder();
			}
		}));

		this._register(this._accessibilityService.onDidChangeScreenReaderOptimized(() => {
			updateOrder();
		}));

		const getContext = () => {
			const editor = getActiveNotebookEditor(this._editorService);
			const activeCell = editor?.getActiveCell();

			return {
				editor,
				activeCell
			};
		};

		const PRIORITY = 50;
		this._register(UndoCommand.addImplementation(PRIORITY, () => {
			const { editor } = getContext();
			if (editor?.viewModel) {
				editor?.viewModel.undo().then(cellResources => {
					if (cellResources?.length) {
						editor?.setOptions(new NotebookEditorOptions({ cellOptions: { resource: cellResources[0] } }));
					}
				});
				return true;
			}

			return false;
		}));

		this._register(RedoCommand.addImplementation(PRIORITY, () => {
			const { editor } = getContext();
			if (editor?.viewModel) {
				editor?.viewModel.redo().then(cellResources => {
					if (cellResources?.length) {
						editor?.setOptions(new NotebookEditorOptions({ cellOptions: { resource: cellResources[0] } }));
					}
				});
				return true;
			}

			return false;
		}));

		if (CopyAction) {
			this._register(CopyAction.addImplementation(PRIORITY, accessor => {
				const activeElement = <HTMLElement>document.activeElement;
				if (activeElement && ['input', 'textarea'].indexOf(activeElement.tagName.toLowerCase()) >= 0) {
					return false;
				}

				const { editor, activeCell } = getContext();
				if (!editor || !activeCell) {
					return false;
				}

				if (editor.hasOutputTextSelection()) {
					document.execCommand('copy');
					return true;
				}

				const clipboardService = accessor.get<IClipboardService>(IClipboardService);
				const notebookService = accessor.get<INotebookService>(INotebookService);
				clipboardService.writeText(activeCell.getText());
				notebookService.setToCopy([activeCell.model], true);

				return true;
			}));
		}

		if (PasteAction) {
			PasteAction.addImplementation(PRIORITY, () => {
				const activeElement = <HTMLElement>document.activeElement;
				if (activeElement && ['input', 'textarea'].indexOf(activeElement.tagName.toLowerCase()) >= 0) {
					return false;
				}

				const pasteCells = this.getToCopy();

				if (!pasteCells) {
					return false;
				}

				const { editor, activeCell } = getContext();
				if (!editor) {
					return false;
				}

				const viewModel = editor.viewModel;

				if (!viewModel) {
					return false;
				}

				if (!viewModel.metadata.editable) {
					return false;
				}

				if (activeCell) {
					const currCellIndex = viewModel.getCellIndex(activeCell);

					let topPastedCell: CellViewModel | undefined = undefined;
					pasteCells.items.reverse().map(cell => {
						const data = CellUri.parse(cell.uri);

						if (pasteCells.isCopy || data?.notebook.toString() !== viewModel.uri.toString()) {
							return viewModel.notebookDocument.createCellTextModel(
								cell.getValue(),
								cell.language,
								cell.cellKind,
								[],
								{
									editable: cell.metadata?.editable,
									runnable: cell.metadata?.runnable,
									breakpointMargin: cell.metadata?.breakpointMargin,
									hasExecutionOrder: cell.metadata?.hasExecutionOrder,
									inputCollapsed: cell.metadata?.inputCollapsed,
									outputCollapsed: cell.metadata?.outputCollapsed,
									custom: cell.metadata?.custom
								}
							);
						} else {
							return cell;
						}
					}).forEach(pasteCell => {
						const newIdx = typeof currCellIndex === 'number' ? currCellIndex + 1 : 0;
						topPastedCell = viewModel.insertCell(newIdx, pasteCell, true);
					});

					if (topPastedCell) {
						editor.focusNotebookCell(topPastedCell, 'container');
					}
				} else {
					if (viewModel.length !== 0) {
						return false;
					}

					let topPastedCell: CellViewModel | undefined = undefined;
					pasteCells.items.reverse().map(cell => {
						const data = CellUri.parse(cell.uri);

						if (pasteCells.isCopy || data?.notebook.toString() !== viewModel.uri.toString()) {
							return viewModel.notebookDocument.createCellTextModel(
								cell.getValue(),
								cell.language,
								cell.cellKind,
								[],
								cell.metadata
							);
						} else {
							return cell;
						}
					}).forEach(pasteCell => {
						topPastedCell = viewModel.insertCell(0, pasteCell, true);
					});

					if (topPastedCell) {
						editor.focusNotebookCell(topPastedCell, 'container');
					}
				}


				return true;
			});
		}

		if (CutAction) {
			CutAction.addImplementation(PRIORITY, accessor => {
				const activeElement = <HTMLElement>document.activeElement;
				if (activeElement && ['input', 'textarea'].indexOf(activeElement.tagName.toLowerCase()) >= 0) {
					return false;
				}

				const { editor, activeCell } = getContext();
				if (!editor || !activeCell) {
					return false;
				}

				const viewModel = editor.viewModel;

				if (!viewModel) {
					return false;
				}

				if (!viewModel.metadata.editable) {
					return false;
				}

				const clipboardService = accessor.get<IClipboardService>(IClipboardService);
				const notebookService = accessor.get<INotebookService>(INotebookService);
				clipboardService.writeText(activeCell.getText());
				viewModel.deleteCell(viewModel.getCellIndex(activeCell), true);
				notebookService.setToCopy([activeCell.model], false);

				return true;
			});
		}

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
			await this._extensionService.activateByEvent(`onNotebook:${viewType}`);

			// TODO@jrieken deprecated, remove this
			await this._extensionService.activateByEvent(`onNotebookEditor:${viewType}`);
		}
		return this._notebookProviders.has(viewType);
	}

	registerNotebookController(viewType: string, extensionData: NotebookExtensionDescription, controller: IMainNotebookController) {
		this._notebookProviders.set(viewType, { extensionData, controller });
		this._onDidChangeViewTypes.fire();
	}

	unregisterNotebookProvider(viewType: string): void {
		this._notebookProviders.delete(viewType);
		this._onDidChangeViewTypes.fire();
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
					extensionLocation: URI.revive(dto.extensionLocation),
					id: dto.id,
					label: dto.label,
					description: dto.description,
					isPreferred: dto.isPreferred,
					preloads: dto.preloads,
					providerHandle: dto.providerHandle,
					resolve: async (uri: URI, editorId: string, token: CancellationToken) => {
						return provider.resolveKernel(editorId, uri, dto.id, token);
					},
					executeNotebookCell: async (uri: URI, handle: number | undefined) => {
						return provider.executeNotebook(uri, dto.id, handle);
					},
					cancelNotebookCell: (uri: URI, handle: number | undefined): Promise<void> => {
						return provider.cancelNotebook(uri, dto.id, handle);
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
		return this.notebookRenderersInfoStore.get(id);
	}

	async resolveNotebook(viewType: string, uri: URI, forceReload: boolean, editorId?: string, backupId?: string): Promise<NotebookTextModel | undefined> {

		await this.canResolve(viewType);

		const provider = this._notebookProviders.get(viewType);
		if (!provider) {
			throw new Error(`CANNOT load notebook, no provider for '${viewType}'`);
		}

		let notebookModel: NotebookTextModel | undefined = undefined;
		if (this._models.has(uri)) {
			// the model already exists
			notebookModel = this._models.get(uri)!.model;
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

		this._models.set(uri, modelData);
		this._onNotebookDocumentAdd.fire([notebookModel!.uri]);
		// after the document is added to the store and sent to ext host, we transform the ouputs
		await this.transformTextModelOutputs(notebookModel!);

		if (editorId) {
			await provider.controller.resolveNotebookEditor(viewType, uri, editorId);
		}

		return modelData.model;
	}

	getNotebookTextModel(uri: URI): NotebookTextModel | undefined {
		return this._models.get(uri)?.model;
	}

	getNotebookTextModels(): Iterable<NotebookTextModel> {
		return Iterable.map(this._models.values(), data => data.model);
	}

	private async transformTextModelOutputs(textModel: NotebookTextModel) {
		for (let i = 0; i < textModel.cells.length; i++) {
			const cell = textModel.cells[i];

			cell.outputs.forEach((output) => {
				if (output.outputKind === CellOutputKind.Rich) {
					// TODO no string[] casting
					const ret = this._transformMimeTypes(output, output.outputId, textModel.metadata.displayOrder as string[] || []);
					const orderedMimeTypes = ret.orderedMimeTypes!;
					const pickedMimeTypeIndex = ret.pickedMimeTypeIndex!;
					output.pickedMimeTypeIndex = pickedMimeTypeIndex;
					output.orderedMimeTypes = orderedMimeTypes;
				}
			});
		}
	}

	transformEditsOutputs(textModel: NotebookTextModel, edits: ICellEditOperation[]) {
		edits.forEach((edit) => {
			if (edit.editType === CellEditType.Replace) {
				edit.cells.forEach((cell) => {
					const outputs = cell.outputs;
					outputs.map((output) => {
						if (output.outputKind === CellOutputKind.Rich) {
							const ret = this._transformMimeTypes(output, output.outputId, textModel.metadata.displayOrder as string[] || []);
							const orderedMimeTypes = ret.orderedMimeTypes!;
							const pickedMimeTypeIndex = ret.pickedMimeTypeIndex!;
							output.pickedMimeTypeIndex = pickedMimeTypeIndex;
							output.orderedMimeTypes = orderedMimeTypes;
						}
					});
				});
			} else if (edit.editType === CellEditType.Output) {
				edit.outputs.map((output) => {
					if (output.outputKind === CellOutputKind.Rich) {
						const ret = this._transformMimeTypes(output, output.outputId, textModel.metadata.displayOrder as string[] || []);
						const orderedMimeTypes = ret.orderedMimeTypes!;
						const pickedMimeTypeIndex = ret.pickedMimeTypeIndex!;
						output.pickedMimeTypeIndex = pickedMimeTypeIndex;
						output.orderedMimeTypes = orderedMimeTypes;
					}
				});
			}
		});
	}

	transformSpliceOutputs(textModel: NotebookTextModel, splices: NotebookCellOutputsSplice[]) {
		splices.forEach((splice) => {
			const outputs = splice[2];
			outputs.map((output) => {
				if (output.outputKind === CellOutputKind.Rich) {
					const ret = this._transformMimeTypes(output, output.outputId, textModel.metadata.displayOrder as string[] || []);
					const orderedMimeTypes = ret.orderedMimeTypes!;
					const pickedMimeTypeIndex = ret.pickedMimeTypeIndex!;
					output.pickedMimeTypeIndex = pickedMimeTypeIndex;
					output.orderedMimeTypes = orderedMimeTypes;
				}
			});
		});
	}

	private _transformMimeTypes(output: IDisplayOutput, outputId: string, documentDisplayOrder: string[]): ITransformedDisplayOutputDto {
		const mimeTypes = Object.keys(output.data);
		const coreDisplayOrder = this._displayOrder;
		const sorted = sortMimeTypes(mimeTypes, coreDisplayOrder?.userOrder || [], documentDisplayOrder, coreDisplayOrder?.defaultOrder || []);

		const orderMimeTypes: IOrderedMimeType[] = [];

		sorted.forEach(mimeType => {
			const handlers = this._findBestMatchedRenderer(mimeType);

			if (handlers.length) {
				const handler = handlers[0];

				orderMimeTypes.push({
					mimeType: mimeType,
					rendererId: handler.id,
				});

				for (let i = 1; i < handlers.length; i++) {
					orderMimeTypes.push({
						mimeType: mimeType,
						rendererId: handlers[i].id
					});
				}

				if (mimeTypeSupportedByCore(mimeType)) {
					orderMimeTypes.push({
						mimeType: mimeType,
						rendererId: BUILTIN_RENDERER_ID
					});
				}
			} else {
				orderMimeTypes.push({
					mimeType: mimeType,
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

	async executeNotebook(viewType: string, uri: URI, kernelId: string): Promise<void> {
		const kernel = this._notebookKernels.get(kernelId);
		if (kernel) {
			await kernel.executeNotebook(viewType, uri, undefined);
		}
	}

	async executeNotebookCell(viewType: string, uri: URI, handle: number, kernelId: string): Promise<void> {
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

	getContributedNotebookOutputRenderers(viewType: string): NotebookOutputRendererInfo | undefined {
		return this.notebookRenderersInfoStore.get(viewType);
	}

	getNotebookProviderResourceRoots(): URI[] {
		const ret: URI[] = [];
		this._notebookProviders.forEach(val => {
			ret.push(URI.revive(val.extensionData.location));
		});

		return ret;
	}

	removeNotebookEditor(editor: INotebookEditor) {
		const editorCache = this._notebookEditors.get(editor.getId());

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
		const provider = this._notebookProviders.get(viewType);

		if (provider) {
			const ret = await provider.controller.save(resource, token);
			if (ret) {
				this._onNotebookDocumentSaved.fire(resource);
			}

			return ret;
		}

		return false;
	}

	async saveAs(viewType: string, resource: URI, target: URI, token: CancellationToken): Promise<boolean> {
		const provider = this._notebookProviders.get(viewType);

		if (provider) {
			const ret = await provider.controller.saveAs(resource, target, token);
			if (ret) {
				this._onNotebookDocumentSaved.fire(resource);
			}

			return ret;
		}

		return false;
	}

	async backup(viewType: string, uri: URI, token: CancellationToken): Promise<string | undefined> {
		const provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.backup(uri, token);
		}

		return;
	}

	onDidReceiveMessage(viewType: string, editorId: string, rendererType: string | undefined, message: any): void {
		const provider = this._notebookProviders.get(viewType);

		if (provider) {
			return provider.controller.onDidReceiveMessage(editorId, rendererType, message);
		}
	}

	private _onWillDisposeDocument(model: INotebookTextModel): void {

		const modelData = this._models.get(model.uri);
		this._models.delete(model.uri);

		if (modelData) {
			// delete editors and documents
			const willRemovedEditors: INotebookEditor[] = [];
			this._notebookEditors.forEach(editor => {
				if (editor.textModel === modelData!.model) {
					willRemovedEditors.push(editor);
				}
			});

			willRemovedEditors.forEach(e => this._notebookEditors.delete(e.getId()));

			const provider = this._notebookProviders.get(modelData!.model.viewType);

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
