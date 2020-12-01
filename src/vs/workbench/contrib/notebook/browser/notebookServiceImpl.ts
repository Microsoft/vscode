/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getZoomLevel } from 'vs/base/browser/browser';
import { flatten } from 'vs/base/common/arrays';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Emitter, Event } from 'vs/base/common/event';
import { Iterable } from 'vs/base/common/iterator';
import { Disposable, DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { ResourceMap } from 'vs/base/common/map';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import * as UUID from 'vs/base/common/uuid';
import { RedoCommand, UndoCommand } from 'vs/editor/browser/editorExtensions';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { IEditorOptions } from 'vs/editor/common/config/editorOptions';
import { BareFontInfo } from 'vs/editor/common/config/fontInfo';
import { CopyAction, CutAction, PasteAction } from 'vs/editor/contrib/clipboard/clipboard';
import * as nls from 'vs/nls';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { NotebookExtensionDescription } from 'vs/workbench/api/common/extHost.protocol';
import { Memento } from 'vs/workbench/common/memento';
import { INotebookEditorContribution, notebookProviderExtensionPoint, notebookRendererExtensionPoint } from 'vs/workbench/contrib/notebook/browser/extensionPoint';
import { CellEditState, getActiveNotebookEditor, INotebookEditor, NotebookEditorOptions, updateEditorTopPadding } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookKernelProviderAssociationRegistry, NotebookViewTypesExtensionRegistry, updateNotebookKernelProvideAssociationSchema } from 'vs/workbench/contrib/notebook/browser/notebookKernelAssociation';
import { CellViewModel } from 'vs/workbench/contrib/notebook/browser/viewModel/notebookViewModel';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER, BUILTIN_RENDERER_ID, CellKind, CellOutputKind, DisplayOrderKey, IDisplayOutput, INotebookDecorationRenderOptions, INotebookKernelInfo2, INotebookKernelProvider, INotebookRendererInfo, INotebookTextModel, IOrderedMimeType, ITransformedDisplayOutputDto, mimeTypeIsAlwaysSecure, mimeTypeSupportedByCore, notebookDocumentFilterMatch, NotebookEditorPriority, NOTEBOOK_DISPLAY_ORDER, RENDERER_NOT_AVAILABLE, sortMimeTypes } from 'vs/workbench/contrib/notebook/common/notebookCommon';
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

		const mementoObject = this._memento.getMemento(StorageScope.GLOBAL, StorageTarget.MACHINE);
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
					selectors: notebookContribution.selector || [],
					priority: this._convertPriority(notebookContribution.priority),
					providerExtensionId: extension.description.identifier.value,
					providerDescription: extension.description.description,
					providerDisplayName: extension.description.isBuiltin ? nls.localize('builtinProviderDisplayName', "Built-in") : extension.description.displayName || extension.description.identifier.value,
					providerExtensionLocation: extension.description.extensionLocation,
					dynamicContribution: false,
					exclusive: false
				}));
			}
		}

		const mementoObject = this._memento.getMemento(StorageScope.GLOBAL, StorageTarget.MACHINE);
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

		const mementoObject = this._memento.getMemento(StorageScope.GLOBAL, StorageTarget.MACHINE);
		mementoObject[NotebookProviderInfoStore.CUSTOM_EDITORS_ENTRY_ID] = Array.from(this._contributedEditors.values());
		this._memento.saveMemento();
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
	private readonly _notebookProviders = new Map<string, { controller: IMainNotebookController, extensionData: NotebookExtensionDescription }>();
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

	private readonly _onDidAddNotebookDocument = this._register(new Emitter<NotebookTextModel>());
	private readonly _onDidRemoveNotebookDocument = this._register(new Emitter<URI>());
	readonly onDidAddNotebookDocument = this._onDidAddNotebookDocument.event;
	readonly onDidRemoveNotebookDocument = this._onDidRemoveNotebookDocument.event;

	private readonly _onNotebookDocumentSaved: Emitter<URI> = this._register(new Emitter<URI>());
	public readonly onNotebookDocumentSaved: Event<URI> = this._onNotebookDocumentSaved.event;
	private readonly _notebookEditors = new Map<string, INotebookEditor>();

	private readonly _onDidChangeViewTypes = new Emitter<void>();
	onDidChangeViewTypes: Event<void> = this._onDidChangeViewTypes.event;

	private readonly _onDidChangeKernels = new Emitter<URI | undefined>();
	onDidChangeKernels: Event<URI | undefined> = this._onDidChangeKernels.event;
	private readonly _onDidChangeNotebookActiveKernel = new Emitter<{ uri: URI, providerHandle: number | undefined, kernelId: string | undefined }>();
	onDidChangeNotebookActiveKernel: Event<{ uri: URI, providerHandle: number | undefined, kernelId: string | undefined }> = this._onDidChangeNotebookActiveKernel.event;
	private cutItems: NotebookCellTextModel[] | undefined;
	private _lastClipboardIsCopy: boolean = true;

	private _displayOrder: { userOrder: string[], defaultOrder: string[] } = Object.create(null);
	private readonly _decorationOptionProviders = new Map<string, INotebookDecorationRenderOptions>();

	constructor(
		@IExtensionService private readonly _extensionService: IExtensionService,
		@IEditorService private readonly _editorService: IEditorService,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@IAccessibilityService private readonly _accessibilityService: IAccessibilityService,
		@IStorageService private readonly _storageService: IStorageService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ICodeEditorService private readonly _codeEditorService: ICodeEditorService,
		@IConfigurationService private readonly configurationService: IConfigurationService
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

		let decorationTriggeredAdjustment = false;
		let decorationCheckSet = new Set<string>();
		this._register(this._codeEditorService.onDecorationTypeRegistered(e => {
			if (decorationTriggeredAdjustment) {
				return;
			}

			if (decorationCheckSet.has(e)) {
				return;
			}

			const options = this._codeEditorService.resolveDecorationOptions(e, true);
			if (options.afterContentClassName || options.beforeContentClassName) {
				const cssRules = this._codeEditorService.resolveDecorationCSSRules(e);
				if (cssRules !== null) {
					for (let i = 0; i < cssRules.length; i++) {
						// The following ways to index into the list are equivalent
						if (
							((cssRules[i] as CSSStyleRule).selectorText.endsWith('::after') || (cssRules[i] as CSSStyleRule).selectorText.endsWith('::after'))
							&& (cssRules[i] as CSSStyleRule).cssText.indexOf('top:') > -1
						) {
							// there is a `::before` or `::after` text decoration whose position is above or below current line
							// we at least make sure that the editor top padding is at least one line
							const editorOptions = this.configurationService.getValue<IEditorOptions>('editor');
							updateEditorTopPadding(BareFontInfo.createFromRawSettings(editorOptions, getZoomLevel()).lineHeight + 2);
							decorationTriggeredAdjustment = true;
							break;
						}
					}
				}
			}

			decorationCheckSet.add(e);
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
				return editor.viewModel.undo().then(cellResources => {
					if (cellResources?.length) {
						editor?.viewModel?.viewCells.forEach(cell => {
							if (cell.cellKind === CellKind.Markdown && cellResources.find(resource => resource.fragment === cell.model.uri.fragment)) {
								cell.editState = CellEditState.Editing;
							}
						});

						editor?.setOptions(new NotebookEditorOptions({ cellOptions: { resource: cellResources[0] }, preserveFocus: true }));
					}
				});
			}

			return false;
		}));

		this._register(RedoCommand.addImplementation(PRIORITY, () => {
			const { editor } = getContext();
			if (editor?.viewModel) {
				return editor.viewModel.redo().then(cellResources => {
					if (cellResources?.length) {
						editor?.viewModel?.viewCells.forEach(cell => {
							if (cell.cellKind === CellKind.Markdown && cellResources.find(resource => resource.fragment === cell.model.uri.fragment)) {
								cell.editState = CellEditState.Editing;
							}
						});

						editor?.setOptions(new NotebookEditorOptions({ cellOptions: { resource: cellResources[0] }, preserveFocus: true }));
					}
				});
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
						return {
							source: cell.getValue(),
							language: cell.language,
							cellKind: cell.cellKind,
							outputs: cell.outputs.map(output => {
								if (output.outputKind === CellOutputKind.Rich) {
									return {
										...output,
										outputId: UUID.generateUuid()
									};
								}

								return output;
							}),
							metadata: {
								editable: cell.metadata?.editable,
								runnable: cell.metadata?.runnable,
								breakpointMargin: cell.metadata?.breakpointMargin,
								hasExecutionOrder: cell.metadata?.hasExecutionOrder,
								inputCollapsed: cell.metadata?.inputCollapsed,
								outputCollapsed: cell.metadata?.outputCollapsed,
								custom: cell.metadata?.custom
							}
						};
					}).forEach(pasteCell => {
						const newIdx = typeof currCellIndex === 'number' ? currCellIndex + 1 : 0;
						topPastedCell = viewModel.createCell(newIdx, pasteCell.source, pasteCell.language, pasteCell.cellKind, pasteCell.metadata, pasteCell.outputs, true);
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
						return {
							source: cell.getValue(),
							language: cell.language,
							cellKind: cell.cellKind,
							outputs: cell.outputs.map(output => {
								if (output.outputKind === CellOutputKind.Rich) {
									return {
										...output,
										outputId: UUID.generateUuid()
									};
								}

								return output;
							}),
							metadata: {
								editable: cell.metadata?.editable,
								runnable: cell.metadata?.runnable,
								breakpointMargin: cell.metadata?.breakpointMargin,
								hasExecutionOrder: cell.metadata?.hasExecutionOrder,
								inputCollapsed: cell.metadata?.inputCollapsed,
								outputCollapsed: cell.metadata?.outputCollapsed,
								custom: cell.metadata?.custom
							}
						};
					}).forEach(pasteCell => {
						topPastedCell = viewModel.createCell(0, pasteCell.source, pasteCell.language, pasteCell.cellKind, pasteCell.metadata, pasteCell.outputs, true);
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

	registerEditorDecorationType(key: string, options: INotebookDecorationRenderOptions): void {
		if (this._decorationOptionProviders.has(key)) {
			return;
		}

		this._decorationOptionProviders.set(key, options);
	}

	removeEditorDecorationType(key: string): void {
		this._decorationOptionProviders.delete(key);

		this.listNotebookEditors().forEach(editor => editor.removeEditorDecorations(key));
	}

	resolveEditorDecorationOptions(key: string): INotebookDecorationRenderOptions | undefined {
		return this._decorationOptionProviders.get(key);
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
			// this awaits full activation of all matching extensions
			await this._extensionService.activateByEvent(`onNotebook:${viewType}`);
			if (this._notebookProviders.has(viewType)) {
				return true;
			} else {
				// notebook providers/kernels/renderers might use `*` as activation event.
				// TODO, only activate by `*` if this._notebookProviders.get(viewType).dynamicContribution === true
				await this._extensionService.activateByEvent(`*`);
			}
		}
		return this._notebookProviders.has(viewType);
	}

	registerNotebookController(viewType: string, extensionData: NotebookExtensionDescription, controller: IMainNotebookController): IDisposable {
		this._notebookProviders.set(viewType, { extensionData, controller });

		if (controller.viewOptions && !this.notebookProviderInfoStore.get(viewType)) {
			// register this content provider to the static contribution, if it does not exist
			const info = new NotebookProviderInfo({
				displayName: controller.viewOptions.displayName,
				id: viewType,
				priority: NotebookEditorPriority.default,
				selectors: [],
				providerExtensionId: extensionData.id.value,
				providerDescription: extensionData.description,
				providerDisplayName: extensionData.id.value,
				providerExtensionLocation: URI.revive(extensionData.location),
				dynamicContribution: true,
				exclusive: controller.viewOptions.exclusive
			});

			info.update({ selectors: controller.viewOptions.filenamePattern });
			info.update({ options: controller.options });
			this.notebookProviderInfoStore.add(info);
		}

		this.notebookProviderInfoStore.get(viewType)?.update({ options: controller.options });

		this._onDidChangeViewTypes.fire();
		return toDisposable(() => {
			this._notebookProviders.delete(viewType);
			this._onDidChangeViewTypes.fire();
		});
	}

	registerNotebookKernelProvider(provider: INotebookKernelProvider): IDisposable {
		const d = this.notebookKernelProviderInfoStore.add(provider);
		const kernelChangeEventListener = provider.onDidChangeKernels((e) => {
			this._onDidChangeKernels.fire(e);
		});

		this._onDidChangeKernels.fire(undefined);
		return toDisposable(() => {
			kernelChangeEventListener.dispose();
			d.dispose();
		});
	}

	async getContributedNotebookKernels(viewType: string, resource: URI, token: CancellationToken): Promise<INotebookKernelInfo2[]> {
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
					detail: dto.detail,
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

	getRendererInfo(id: string): INotebookRendererInfo | undefined {
		return this.notebookRenderersInfoStore.get(id);
	}

	async resolveNotebook(viewType: string, uri: URI, forceReload: boolean, backupId?: string): Promise<NotebookTextModel> {

		if (!await this.canResolve(viewType)) {
			throw new Error(`CANNOT load notebook, no provider for '${viewType}'`);
		}

		const provider = this._notebookProviders.get(viewType)!;
		let notebookModel: NotebookTextModel;
		if (this._models.has(uri)) {
			// the model already exists
			notebookModel = this._models.get(uri)!.model;
			if (forceReload) {
				await provider.controller.reloadNotebook(notebookModel);
			}
			return notebookModel;

		} else {
			const dataDto = await provider.controller.resolveNotebookDocument(viewType, uri, backupId);
			let cells = dataDto.data.cells.length ? dataDto.data.cells : (uri.scheme === Schemas.untitled ? [{
				cellKind: CellKind.Code,
				language: dataDto.data.languages.length ? dataDto.data.languages[0] : '',
				outputs: [],
				metadata: undefined,
				source: ''
			}] : []);

			notebookModel = this._instantiationService.createInstance(NotebookTextModel, viewType, provider.controller.supportBackup, uri, cells, dataDto.data.languages, dataDto.data.metadata, dataDto.transientOptions);
		}

		// new notebook model created
		const modelData = new ModelData(
			notebookModel,
			(model) => this._onWillDisposeDocument(model),
		);

		this._models.set(uri, modelData);
		this._onDidAddNotebookDocument.fire(notebookModel);

		return modelData.model;
	}

	getNotebookTextModel(uri: URI): NotebookTextModel | undefined {
		return this._models.get(uri)?.model;
	}

	getNotebookTextModels(): Iterable<NotebookTextModel> {
		return Iterable.map(this._models.values(), data => data.model);
	}

	getMimeTypeInfo(textModel: NotebookTextModel, output: ITransformedDisplayOutputDto): readonly IOrderedMimeType[] {
		// TODO@rebornix no string[] casting
		return this._getOrderedMimeTypes(textModel, output, textModel.metadata.displayOrder as string[] ?? []);
	}

	private _getOrderedMimeTypes(textModel: NotebookTextModel, output: IDisplayOutput, documentDisplayOrder: string[]): IOrderedMimeType[] {
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
					isTrusted: textModel.metadata.trusted
				});

				for (let i = 1; i < handlers.length; i++) {
					orderMimeTypes.push({
						mimeType: mimeType,
						rendererId: handlers[i].id,
						isTrusted: textModel.metadata.trusted
					});
				}

				if (mimeTypeSupportedByCore(mimeType)) {
					orderMimeTypes.push({
						mimeType: mimeType,
						rendererId: BUILTIN_RENDERER_ID,
						isTrusted: mimeTypeIsAlwaysSecure(mimeType) || textModel.metadata.trusted
					});
				}
			} else {
				if (mimeTypeSupportedByCore(mimeType)) {
					orderMimeTypes.push({
						mimeType: mimeType,
						rendererId: BUILTIN_RENDERER_ID,
						isTrusted: mimeTypeIsAlwaysSecure(mimeType) || textModel.metadata.trusted
					});
				} else {
					orderMimeTypes.push({
						mimeType: mimeType,
						rendererId: RENDERER_NOT_AVAILABLE,
						isTrusted: textModel.metadata.trusted
					});
				}
			}
		});

		return orderMimeTypes;
	}

	private _findBestMatchedRenderer(mimeType: string): readonly NotebookOutputRendererInfo[] {
		return this.notebookRenderersInfoStore.getContributedRenderer(mimeType);
	}

	getContributedNotebookProviders(resource?: URI): readonly NotebookProviderInfo[] {
		if (resource) {
			return this.notebookProviderInfoStore.getContributedNotebook(resource);
		}

		return [...this.notebookProviderInfoStore];
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

	async resolveNotebookEditor(viewType: string, uri: URI, editorId: string): Promise<void> {
		const entry = this._notebookProviders.get(viewType);
		if (entry) {
			entry.controller.resolveNotebookEditor(viewType, uri, editorId);
		}
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
			for (const editor of this._notebookEditors.values()) {
				if (editor.textModel === modelData.model) {
					willRemovedEditors.push(editor);
				}
			}

			modelData.model.dispose();
			modelData.dispose();

			willRemovedEditors.forEach(e => this._notebookEditors.delete(e.getId()));
			this._onNotebookEditorsRemove.fire(willRemovedEditors.map(e => e));
			this._onDidRemoveNotebookDocument.fire(modelData.model.uri);
		}
	}
}
