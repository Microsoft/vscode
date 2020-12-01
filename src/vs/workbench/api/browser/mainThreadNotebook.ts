/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as DOM from 'vs/base/browser/dom';
import { CancellationToken } from 'vs/base/common/cancellation';
import { diffMaps, diffSets } from 'vs/base/common/collections';
import { Emitter } from 'vs/base/common/event';
import { IRelativePattern } from 'vs/base/common/glob';
import { combinedDisposable, Disposable, DisposableStore, dispose, IDisposable, IReference } from 'vs/base/common/lifecycle';
import { ResourceMap } from 'vs/base/common/map';
import { Schemas } from 'vs/base/common/network';
import { IExtUri } from 'vs/base/common/resources';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IAccessibilityService } from 'vs/platform/accessibility/common/accessibility';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { EditorActivation, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { ILogService } from 'vs/platform/log/common/log';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { viewColumnToEditorGroup } from 'vs/workbench/common/editor';
import { INotebookEditor } from 'vs/workbench/contrib/notebook/browser/notebookBrowser';
import { NotebookCellTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookCellTextModel';
import { NotebookTextModel } from 'vs/workbench/contrib/notebook/common/model/notebookTextModel';
import { INotebookCellStatusBarService } from 'vs/workbench/contrib/notebook/common/notebookCellStatusBarService';
import { ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER, CellEditType, DisplayOrderKey, ICellEditOperation, ICellRange, IEditor, IMainCellDto, INotebookDecorationRenderOptions, INotebookDocumentFilter, INotebookEditorModel, INotebookExclusiveDocumentFilter, NotebookCellOutputsSplice, NotebookCellsChangeType, NOTEBOOK_DISPLAY_ORDER, TransientMetadata } from 'vs/workbench/contrib/notebook/common/notebookCommon';
import { INotebookEditorModelResolverService } from 'vs/workbench/contrib/notebook/common/notebookEditorModelResolverService';
import { IMainNotebookController, INotebookService } from 'vs/workbench/contrib/notebook/common/notebookService';
import { IEditorGroup, IEditorGroupsService, preferredSideBySideGroupDirection } from 'vs/workbench/services/editor/common/editorGroupsService';
import { openEditorWith } from 'vs/workbench/services/editor/common/editorOpenWith';
import { IEditorService, SIDE_GROUP } from 'vs/workbench/services/editor/common/editorService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { ExtHostContext, ExtHostNotebookShape, IExtHostContext, INotebookCellStatusBarEntryDto, INotebookDocumentsAndEditorsDelta, INotebookDocumentShowOptions, INotebookModelAddedData, MainContext, MainThreadNotebookShape, NotebookEditorRevealType, NotebookExtensionDescription } from '../common/extHost.protocol';

class DocumentAndEditorState {
	static compute(before: DocumentAndEditorState | undefined, after: DocumentAndEditorState): INotebookDocumentsAndEditorsDelta {
		if (!before) {
			const apiEditors = [];
			for (let id in after.textEditors) {
				const editor = after.textEditors.get(id)!;
				apiEditors.push({ id, documentUri: editor.uri!, selections: editor!.getSelectionHandles(), visibleRanges: editor.visibleRanges });
			}

			return {
				addedDocuments: [],
				addedEditors: apiEditors,
				visibleEditors: [...after.visibleEditors].map(editor => editor[0])
			};
		}
		const documentDelta = diffSets(before.documents, after.documents);
		const editorDelta = diffMaps(before.textEditors, after.textEditors);
		const addedAPIEditors = editorDelta.added.map(add => ({
			id: add.getId(),
			documentUri: add.uri!,
			selections: add.getSelectionHandles(),
			visibleRanges: add.visibleRanges
		}));

		const removedAPIEditors = editorDelta.removed.map(removed => removed.getId());

		// const oldActiveEditor = before.activeEditor !== after.activeEditor ? before.activeEditor : undefined;
		const newActiveEditor = before.activeEditor !== after.activeEditor ? after.activeEditor : undefined;

		const visibleEditorDelta = diffMaps(before.visibleEditors, after.visibleEditors);

		return {
			addedDocuments: documentDelta.added.map((e: NotebookTextModel): INotebookModelAddedData => {
				return {
					viewType: e.viewType,
					uri: e.uri,
					metadata: e.metadata,
					versionId: e.versionId,
					cells: e.cells.map(cell => ({
						handle: cell.handle,
						uri: cell.uri,
						source: cell.textBuffer.getLinesContent(),
						eol: cell.textBuffer.getEOL(),
						language: cell.language,
						cellKind: cell.cellKind,
						outputs: cell.outputs,
						metadata: cell.metadata
					})),
					contentOptions: e.transientOptions,
					// attachedEditor: editorId ? {
					// 	id: editorId,
					// 	selections: document.textModel.selections
					// } : undefined
				};
			}),
			removedDocuments: documentDelta.removed.map(e => e.uri),
			addedEditors: addedAPIEditors,
			removedEditors: removedAPIEditors,
			newActiveEditor: newActiveEditor,
			visibleEditors: visibleEditorDelta.added.length === 0 && visibleEditorDelta.removed.length === 0
				? undefined
				: [...after.visibleEditors].map(editor => editor[0])
		};
	}

	constructor(
		readonly documents: Set<NotebookTextModel>,
		readonly textEditors: Map<string, IEditor>,
		readonly activeEditor: string | null | undefined,
		readonly visibleEditors: Map<string, IEditor>
	) {
		//
	}
}

@extHostNamedCustomer(MainContext.MainThreadNotebook)
export class MainThreadNotebooks extends Disposable implements MainThreadNotebookShape {
	private readonly _notebookProviders = new Map<string, { controller: IMainNotebookController, disposable: IDisposable }>();
	private readonly _notebookKernelProviders = new Map<number, { extension: NotebookExtensionDescription, emitter: Emitter<URI | undefined>, provider: IDisposable }>();
	private readonly _proxy: ExtHostNotebookShape;
	private _toDisposeOnEditorRemove = new Map<string, IDisposable>();
	private _currentState?: DocumentAndEditorState;
	private _editorEventListenersMapping: Map<string, DisposableStore> = new Map();
	private _documentEventListenersMapping: ResourceMap<DisposableStore> = new ResourceMap();
	private readonly _cellStatusBarEntries: Map<number, IDisposable> = new Map();
	private readonly _modelReferenceCollection: BoundModelReferenceCollection;

	constructor(
		extHostContext: IExtHostContext,
		@INotebookService private _notebookService: INotebookService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IEditorService private readonly editorService: IEditorService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorGroupsService private readonly _editorGroupService: IEditorGroupsService,
		@IAccessibilityService private readonly accessibilityService: IAccessibilityService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ILogService private readonly logService: ILogService,
		@INotebookCellStatusBarService private readonly cellStatusBarService: INotebookCellStatusBarService,
		@IWorkingCopyService private readonly _workingCopyService: IWorkingCopyService,
		@INotebookEditorModelResolverService private readonly _notebookModelResolverService: INotebookEditorModelResolverService,
		@IUriIdentityService private readonly _uriIdentityService: IUriIdentityService,
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostNotebook);
		this._modelReferenceCollection = new BoundModelReferenceCollection(this._uriIdentityService.extUri);
		this._register(this._modelReferenceCollection);
		this.registerListeners();
	}

	async $tryApplyEdits(_viewType: string, resource: UriComponents, modelVersionId: number, cellEdits: ICellEditOperation[]): Promise<boolean> {
		const textModel = this._notebookService.getNotebookTextModel(URI.from(resource));
		if (!textModel) {
			return false;
		}
		return textModel.applyEdits(modelVersionId, cellEdits, true, undefined, () => undefined, undefined);
	}

	private _isDeltaEmpty(delta: INotebookDocumentsAndEditorsDelta) {
		if (delta.addedDocuments !== undefined && delta.addedDocuments.length > 0) {
			return false;
		}

		if (delta.removedDocuments !== undefined && delta.removedDocuments.length > 0) {
			return false;
		}

		if (delta.addedEditors !== undefined && delta.addedEditors.length > 0) {
			return false;
		}

		if (delta.removedEditors !== undefined && delta.removedEditors.length > 0) {
			return false;
		}

		if (delta.visibleEditors !== undefined && delta.visibleEditors.length > 0) {
			return false;
		}

		if (delta.newActiveEditor !== undefined) {
			return false;
		}

		return true;
	}

	private _emitDelta(delta: INotebookDocumentsAndEditorsDelta) {
		if (this._isDeltaEmpty(delta)) {
			return;
		}

		return this._proxy.$acceptDocumentAndEditorsDelta(delta);
	}

	registerListeners() {
		this._notebookService.listNotebookEditors().forEach((e) => {
			this._addNotebookEditor(e);
		});

		this._register(this._notebookService.onDidChangeActiveEditor(e => {
			this._updateState();
		}));

		this._register(this._notebookService.onDidChangeVisibleEditors(e => {
			if (this._notebookProviders.size > 0) {
				if (!this._currentState) {
					// no current state means we didn't even create editors in ext host yet.
					return;
				}

				// we can't simply update visibleEditors as we need to check if we should create editors first.
				this._updateState();
			}
		}));

		const notebookEditorAddedHandler = (editor: IEditor) => {
			if (!this._editorEventListenersMapping.has(editor.getId())) {
				const disposableStore = new DisposableStore();
				disposableStore.add(editor.onDidChangeVisibleRanges(() => {
					this._proxy.$acceptEditorPropertiesChanged(editor.getId(), { visibleRanges: { ranges: editor.visibleRanges }, selections: null });
				}));

				disposableStore.add(editor.onDidChangeSelection(() => {
					const selectionHandles = editor.getSelectionHandles();
					this._proxy.$acceptEditorPropertiesChanged(editor.getId(), { visibleRanges: null, selections: { selections: selectionHandles } });
				}));

				this._editorEventListenersMapping.set(editor.getId(), disposableStore);
			}
		};

		this._register(this._notebookService.onNotebookEditorAdd(editor => {
			notebookEditorAddedHandler(editor);
			this._addNotebookEditor(editor);
		}));

		this._register(this._notebookService.onNotebookEditorsRemove(editors => {
			this._removeNotebookEditor(editors);

			editors.forEach(editor => {
				this._editorEventListenersMapping.get(editor.getId())?.dispose();
				this._editorEventListenersMapping.delete(editor.getId());
			});
		}));

		this._notebookService.listNotebookEditors().forEach(editor => {
			notebookEditorAddedHandler(editor);
		});

		const cellToDto = (cell: NotebookCellTextModel): IMainCellDto => {
			return {
				handle: cell.handle,
				uri: cell.uri,
				source: cell.textBuffer.getLinesContent(),
				eol: cell.textBuffer.getEOL(),
				language: cell.language,
				cellKind: cell.cellKind,
				outputs: cell.outputs,
				metadata: cell.metadata
			};
		};


		const notebookDocumentAddedHandler = (textModel: NotebookTextModel) => {
			if (!this._documentEventListenersMapping.has(textModel.uri)) {
				const disposableStore = new DisposableStore();
				disposableStore.add(textModel!.onDidChangeContent(event => {
					const dto = event.rawEvents.map(e => {
						const data =
							e.kind === NotebookCellsChangeType.ModelChange || e.kind === NotebookCellsChangeType.Initialize
								? {
									kind: e.kind,
									versionId: event.versionId,
									changes: e.changes.map(diff => [diff[0], diff[1], diff[2].map(cell => cellToDto(cell as NotebookCellTextModel))] as [number, number, IMainCellDto[]])
								}
								: (
									e.kind === NotebookCellsChangeType.Move
										? {
											kind: e.kind,
											index: e.index,
											length: e.length,
											newIdx: e.newIdx,
											versionId: event.versionId,
											cells: e.cells.map(cell => cellToDto(cell as NotebookCellTextModel))
										}
										: e
								);

						return data;
					});

					/**
					 * TODO@rebornix, @jrieken
					 * When a document is modified, it will trigger onDidChangeContent events.
					 * The first event listener is this one, which doesn't know if the text model is dirty or not. It can ask `workingCopyService` but get the wrong result
					 * The second event listener is `NotebookEditorModel`, which will then set `isDirty` to `true`.
					 * Since `e.transient` decides if the model should be dirty or not, we will use the same logic here.
					 */
					const hasNonTransientEvent = event.rawEvents.find(e => !e.transient);
					this._proxy.$acceptModelChanged(textModel.uri, {
						rawEvents: dto,
						versionId: event.versionId
					}, !!hasNonTransientEvent);

					const hasDocumentMetadataChangeEvent = event.rawEvents.find(e => e.kind === NotebookCellsChangeType.ChangeDocumentMetadata);
					if (!!hasDocumentMetadataChangeEvent) {
						this._proxy.$acceptDocumentPropertiesChanged(textModel.uri, { metadata: textModel.metadata });
					}
				}));
				this._documentEventListenersMapping.set(textModel!.uri, disposableStore);
			}
		};

		this._notebookService.listNotebookDocuments().forEach(notebookDocumentAddedHandler);
		this._register(this._notebookService.onDidAddNotebookDocument(document => {
			notebookDocumentAddedHandler(document);
			this._updateState();
		}));

		this._register(this._notebookService.onDidRemoveNotebookDocument(uri => {
			this._documentEventListenersMapping.get(uri)?.dispose();
			this._documentEventListenersMapping.delete(uri);
			this._updateState();
		}));

		this._register(this._notebookService.onDidChangeNotebookActiveKernel(e => {
			this._proxy.$acceptNotebookActiveKernelChange(e);
		}));

		this._register(this._notebookService.onNotebookDocumentSaved(e => {
			this._proxy.$acceptModelSaved(e);
		}));

		const updateOrder = () => {
			let userOrder = this.configurationService.getValue<string[]>(DisplayOrderKey);
			this._proxy.$acceptDisplayOrder({
				defaultOrder: this.accessibilityService.isScreenReaderOptimized() ? ACCESSIBLE_NOTEBOOK_DISPLAY_ORDER : NOTEBOOK_DISPLAY_ORDER,
				userOrder: userOrder
			});
		};

		updateOrder();

		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectedKeys.indexOf(DisplayOrderKey) >= 0) {
				updateOrder();
			}
		}));

		this._register(this.accessibilityService.onDidChangeScreenReaderOptimized(() => {
			updateOrder();
		}));

		const activeEditorPane = this.editorService.activeEditorPane as any | undefined;
		const notebookEditor = activeEditorPane?.isNotebookEditor ? activeEditorPane.getControl() : undefined;
		this._updateState(notebookEditor);
	}

	private _addNotebookEditor(e: IEditor) {
		this._toDisposeOnEditorRemove.set(e.getId(), combinedDisposable(
			e.onDidChangeModel(() => this._updateState()),
			e.onDidFocusEditorWidget(() => {
				this._updateState(e);
			}),
		));

		const activeEditorPane = this.editorService.activeEditorPane as any | undefined;
		const notebookEditor = activeEditorPane?.isNotebookEditor ? activeEditorPane.getControl() : undefined;
		this._updateState(notebookEditor);
	}

	private _removeNotebookEditor(editors: IEditor[]) {
		editors.forEach(e => {
			const sub = this._toDisposeOnEditorRemove.get(e.getId());
			if (sub) {
				this._toDisposeOnEditorRemove.delete(e.getId());
				sub.dispose();
			}
		});

		this._updateState();
	}

	private async _updateState(focusedNotebookEditor?: IEditor) {
		let activeEditor: string | null = null;

		const activeEditorPane = this.editorService.activeEditorPane as any | undefined;
		if (activeEditorPane?.isNotebookEditor) {
			const notebookEditor = (activeEditorPane.getControl() as INotebookEditor);
			activeEditor = notebookEditor && notebookEditor.hasModel() ? notebookEditor!.getId() : null;
		}

		const documentEditorsMap = new Map<string, IEditor>();

		const editors = new Map<string, IEditor>();
		this._notebookService.listNotebookEditors().forEach(editor => {
			if (editor.textModel) {
				editors.set(editor.getId(), editor);
				documentEditorsMap.set(editor.textModel.uri.toString(), editor);
			}
		});

		const visibleEditorsMap = new Map<string, IEditor>();
		this.editorService.visibleEditorPanes.forEach(editor => {
			if ((editor as any).isNotebookEditor) {
				const nbEditorWidget = (editor as any).getControl() as INotebookEditor;
				if (nbEditorWidget && editors.has(nbEditorWidget.getId())) {
					visibleEditorsMap.set(nbEditorWidget.getId(), nbEditorWidget);
				}
			}
		});

		const documents = new Set<NotebookTextModel>();
		this._notebookService.listNotebookDocuments().forEach(document => {
			documents.add(document);
		});

		if (!activeEditor && focusedNotebookEditor && focusedNotebookEditor.textModel) {
			activeEditor = focusedNotebookEditor.getId();
		}

		// editors always have view model attached, which means there is already a document in exthost.
		const newState = new DocumentAndEditorState(documents, editors, activeEditor, visibleEditorsMap);
		const delta = DocumentAndEditorState.compute(this._currentState, newState);
		// const isEmptyChange = (!delta.addedDocuments || delta.addedDocuments.length === 0)
		// 	&& (!delta.removedDocuments || delta.removedDocuments.length === 0)
		// 	&& (!delta.addedEditors || delta.addedEditors.length === 0)
		// 	&& (!delta.removedEditors || delta.removedEditors.length === 0)
		// 	&& (delta.newActiveEditor === undefined)

		// if (!isEmptyChange) {
		this._currentState = newState;
		await this._emitDelta(delta);
		// }
	}

	async $registerNotebookProvider(extension: NotebookExtensionDescription, viewType: string, supportBackup: boolean, options: {
		transientOutputs: boolean;
		transientMetadata: TransientMetadata;
		viewOptions?: { displayName: string; filenamePattern: (string | IRelativePattern | INotebookExclusiveDocumentFilter)[]; exclusive: boolean; };
	}): Promise<void> {
		let contentOptions = { transientOutputs: options.transientOutputs, transientMetadata: options.transientMetadata };

		const controller: IMainNotebookController = {
			supportBackup,
			get options() {
				return contentOptions;
			},
			set options(newOptions) {
				contentOptions.transientMetadata = newOptions.transientMetadata;
				contentOptions.transientOutputs = newOptions.transientOutputs;
			},
			viewOptions: options.viewOptions,
			reloadNotebook: async (mainthreadTextModel: NotebookTextModel) => {
				const data = await this._proxy.$resolveNotebookData(viewType, mainthreadTextModel.uri);
				mainthreadTextModel.updateLanguages(data.languages);
				mainthreadTextModel.metadata = data.metadata;
				mainthreadTextModel.transientOptions = contentOptions;

				const edits: ICellEditOperation[] = [
					{ editType: CellEditType.Replace, index: 0, count: mainthreadTextModel.cells.length, cells: data.cells }
				];
				await new Promise(resolve => {
					DOM.scheduleAtNextAnimationFrame(() => {
						const ret = mainthreadTextModel!.applyEdits(mainthreadTextModel!.versionId, edits, true, undefined, () => undefined, undefined);
						resolve(ret);
					});
				});
			},
			resolveNotebookDocument: async (viewType: string, uri: URI, backupId?: string) => {
				const data = await this._proxy.$resolveNotebookData(viewType, uri, backupId);
				return {
					data,
					transientOptions: contentOptions
				};
			},
			resolveNotebookEditor: async (viewType: string, uri: URI, editorId: string) => {
				await this._proxy.$resolveNotebookEditor(viewType, uri, editorId);
			},
			onDidReceiveMessage: (editorId: string, rendererType: string | undefined, message: unknown) => {
				this._proxy.$onDidReceiveMessage(editorId, rendererType, message);
			},
			save: async (uri: URI, token: CancellationToken) => {
				return this._proxy.$saveNotebook(viewType, uri, token);
			},
			saveAs: async (uri: URI, target: URI, token: CancellationToken) => {
				return this._proxy.$saveNotebookAs(viewType, uri, target, token);
			},
			backup: async (uri: URI, token: CancellationToken) => {
				return this._proxy.$backup(viewType, uri, token);
			}
		};

		const disposable = this._notebookService.registerNotebookController(viewType, extension, controller);
		this._notebookProviders.set(viewType, { controller, disposable });
		return;
	}

	async $updateNotebookProviderOptions(viewType: string, options?: { transientOutputs: boolean; transientMetadata: TransientMetadata; }): Promise<void> {
		const provider = this._notebookProviders.get(viewType);

		if (provider && options) {
			provider.controller.options = options;
			this._notebookService.listNotebookDocuments().forEach(document => {
				if (document.viewType === viewType) {
					document.transientOptions = provider.controller.options;
				}
			});
		}
	}

	async $unregisterNotebookProvider(viewType: string): Promise<void> {
		const entry = this._notebookProviders.get(viewType);
		if (entry) {
			entry.disposable.dispose();
			this._notebookProviders.delete(viewType);
		}
	}

	async $registerNotebookKernelProvider(extension: NotebookExtensionDescription, handle: number, documentFilter: INotebookDocumentFilter): Promise<void> {
		const emitter = new Emitter<URI | undefined>();
		const that = this;
		const provider = this._notebookService.registerNotebookKernelProvider({
			providerExtensionId: extension.id.value,
			providerDescription: extension.description,
			onDidChangeKernels: emitter.event,
			selector: documentFilter,
			provideKernels: async (uri: URI, token: CancellationToken) => {
				const kernels = await that._proxy.$provideNotebookKernels(handle, uri, token);
				return kernels.map(kernel => {
					return {
						...kernel,
						providerHandle: handle
					};
				});
			},
			resolveKernel: (editorId: string, uri: URI, kernelId: string, token: CancellationToken) => {
				return that._proxy.$resolveNotebookKernel(handle, editorId, uri, kernelId, token);
			},
			executeNotebook: (uri: URI, kernelId: string, cellHandle: number | undefined) => {
				this.logService.debug('MainthreadNotebooks.registerNotebookKernelProvider#executeNotebook', uri.path, kernelId, cellHandle);
				return that._proxy.$executeNotebookKernelFromProvider(handle, uri, kernelId, cellHandle);
			},
			cancelNotebook: (uri: URI, kernelId: string, cellHandle: number | undefined) => {
				this.logService.debug('MainthreadNotebooks.registerNotebookKernelProvider#cancelNotebook', uri.path, kernelId, cellHandle);
				return that._proxy.$cancelNotebookKernelFromProvider(handle, uri, kernelId, cellHandle);
			},
		});
		this._notebookKernelProviders.set(handle, {
			extension,
			emitter,
			provider
		});

		return;
	}

	async $unregisterNotebookKernelProvider(handle: number): Promise<void> {
		const entry = this._notebookKernelProviders.get(handle);

		if (entry) {
			entry.emitter.dispose();
			entry.provider.dispose();
			this._notebookKernelProviders.delete(handle);
		}
	}

	$onNotebookKernelChange(handle: number, uriComponents: UriComponents): void {
		const entry = this._notebookKernelProviders.get(handle);

		entry?.emitter.fire(uriComponents ? URI.revive(uriComponents) : undefined);
	}

	async $updateNotebookLanguages(viewType: string, resource: UriComponents, languages: string[]): Promise<void> {
		this.logService.debug('MainThreadNotebooks#updateNotebookLanguages', resource.path, languages);
		const textModel = this._notebookService.getNotebookTextModel(URI.from(resource));
		textModel?.updateLanguages(languages);
	}

	async $spliceNotebookCellOutputs(viewType: string, resource: UriComponents, cellHandle: number, splices: NotebookCellOutputsSplice[]): Promise<void> {
		this.logService.debug('MainThreadNotebooks#spliceNotebookCellOutputs', resource.path, cellHandle);
		const textModel = this._notebookService.getNotebookTextModel(URI.from(resource));

		if (!textModel) {
			return;
		}

		const cell = textModel.cells.find(cell => cell.handle === cellHandle);

		if (!cell) {
			return;
		}

		textModel.applyEdits(textModel.versionId, [
			{
				editType: CellEditType.OutputsSplice,
				index: textModel.cells.indexOf(cell),
				splices
			}
		], true, undefined, () => undefined, undefined);
	}

	async $postMessage(editorId: string, forRendererId: string | undefined, value: any): Promise<boolean> {
		const editor = this._notebookService.getNotebookEditor(editorId) as INotebookEditor | undefined;
		if (editor?.isNotebookEditor) {
			editor.postMessage(forRendererId, value);
			return true;
		}

		return false;
	}

	$onUndoableContentChange(resource: UriComponents, viewType: string, editId: number, label: string | undefined): void {
		const textModel = this._notebookService.getNotebookTextModel(URI.from(resource));

		if (textModel) {
			textModel.handleUnknownUndoableEdit(label, () => {
				const isDirty = this._workingCopyService.isDirty(textModel.uri.with({ scheme: Schemas.vscodeNotebook }));
				return this._proxy.$undoNotebook(textModel.viewType, textModel.uri, editId, isDirty);
			}, () => {
				const isDirty = this._workingCopyService.isDirty(textModel.uri.with({ scheme: Schemas.vscodeNotebook }));
				return this._proxy.$redoNotebook(textModel.viewType, textModel.uri, editId, isDirty);
			});
		}
	}

	$onContentChange(resource: UriComponents, viewType: string): void {
		const textModel = this._notebookService.getNotebookTextModel(URI.from(resource));

		if (textModel) {
			textModel.applyEdits(textModel.versionId, [
				{
					editType: CellEditType.Unknown
				}
			], true, undefined, () => undefined, undefined);
		}
	}

	async $tryRevealRange(id: string, range: ICellRange, revealType: NotebookEditorRevealType) {
		const editor = this._notebookService.listNotebookEditors().find(editor => editor.getId() === id);
		if (editor && editor.isNotebookEditor) {
			const notebookEditor = editor as INotebookEditor;
			if (!notebookEditor.hasModel()) {
				return;
			}
			const viewModel = notebookEditor.viewModel;
			const cell = viewModel.viewCells[range.start];
			if (!cell) {
				return;
			}

			switch (revealType) {
				case NotebookEditorRevealType.Default:
					notebookEditor.revealInView(cell);
					break;
				case NotebookEditorRevealType.InCenter:
					notebookEditor.revealInCenter(cell);
					break;
				case NotebookEditorRevealType.InCenterIfOutsideViewport:
					notebookEditor.revealInCenterIfOutsideViewport(cell);
					break;
				default:
					break;
			}
		}
	}

	$registerNotebookEditorDecorationType(key: string, options: INotebookDecorationRenderOptions) {
		this._notebookService.registerEditorDecorationType(key, options);
	}

	$removeNotebookEditorDecorationType(key: string) {
		this._notebookService.removeEditorDecorationType(key);
	}

	$trySetDecorations(id: string, range: ICellRange, key: string) {
		const editor = this._notebookService.listNotebookEditors().find(editor => editor.getId() === id);
		if (editor && editor.isNotebookEditor) {
			const notebookEditor = editor as INotebookEditor;
			notebookEditor.setEditorDecorations(key, range);
		}
	}

	async $setStatusBarEntry(id: number, rawStatusBarEntry: INotebookCellStatusBarEntryDto): Promise<void> {
		const statusBarEntry = {
			...rawStatusBarEntry,
			...{ cellResource: URI.revive(rawStatusBarEntry.cellResource) }
		};

		const existingEntry = this._cellStatusBarEntries.get(id);
		if (existingEntry) {
			existingEntry.dispose();
		}

		if (statusBarEntry.visible) {
			this._cellStatusBarEntries.set(
				id,
				this.cellStatusBarService.addEntry(statusBarEntry));
		}
	}


	async $tryOpenDocument(uriComponents: UriComponents, viewType?: string): Promise<URI> {
		const uri = URI.revive(uriComponents);
		const ref = await this._notebookModelResolverService.resolve(uri, viewType);
		this._modelReferenceCollection.add(uri, ref);

		return uri;
	}

	async $tryShowNotebookDocument(resource: UriComponents, viewType: string, options: INotebookDocumentShowOptions): Promise<string> {
		const editorOptions: ITextEditorOptions = {
			preserveFocus: options.preserveFocus,
			pinned: options.pinned,
			// selection: options.selection,
			// preserve pre 1.38 behaviour to not make group active when preserveFocus: true
			// but make sure to restore the editor to fix https://github.com/microsoft/vscode/issues/79633
			activation: options.preserveFocus ? EditorActivation.RESTORE : undefined,
			override: false,
		};

		const columnArg = viewColumnToEditorGroup(this._editorGroupService, options.position);

		let group: IEditorGroup | undefined = undefined;

		if (columnArg === SIDE_GROUP) {
			const direction = preferredSideBySideGroupDirection(this.configurationService);

			let neighbourGroup = this.editorGroupsService.findGroup({ direction });
			if (!neighbourGroup) {
				neighbourGroup = this.editorGroupsService.addGroup(this.editorGroupsService.activeGroup, direction);
			}
			group = neighbourGroup;
		} else {
			group = this.editorGroupsService.getGroup(viewColumnToEditorGroup(this.editorGroupsService, columnArg)) ?? this.editorGroupsService.activeGroup;
		}

		const input = this.editorService.createEditorInput({ resource: URI.revive(resource), options: editorOptions });

		// TODO: handle options.selection
		const editorPane = await openEditorWith(input, viewType, options, group, this.editorService, this.configurationService, this.quickInputService);
		const notebookEditor = (editorPane as unknown as { isNotebookEditor?: boolean })?.isNotebookEditor ? (editorPane!.getControl() as INotebookEditor) : undefined;

		if (notebookEditor) {
			if (notebookEditor.viewModel && options.selection && notebookEditor.viewModel.viewCells[options.selection.start]) {
				const focusedCell = notebookEditor.viewModel.viewCells[options.selection.start];
				notebookEditor.revealInCenterIfOutsideViewport(focusedCell);
				notebookEditor.selectElement(focusedCell);
			}
			return notebookEditor.getId();
		} else {
			throw new Error(`Notebook Editor creation failure for documenet ${resource}`);
		}
	}
}


export class BoundModelReferenceCollection {

	private _data = new Array<{ uri: URI, dispose(): void }>();

	constructor(
		private readonly _extUri: IExtUri,
		private readonly _maxAge: number = 1000 * 60 * 3,
	) {
		//
	}

	dispose(): void {
		this._data = dispose(this._data);
	}

	remove(uri: URI): void {
		for (const entry of [...this._data] /* copy array because dispose will modify it */) {
			if (this._extUri.isEqualOrParent(entry.uri, uri)) {
				entry.dispose();
			}
		}
	}

	add(uri: URI, ref: IReference<INotebookEditorModel>): void {
		let handle: any;
		let entry: { uri: URI, dispose(): void };
		const dispose = () => {
			const idx = this._data.indexOf(entry);
			if (idx >= 0) {
				ref.dispose();
				clearTimeout(handle);
				this._data.splice(idx, 1);
			}
		};
		handle = setTimeout(dispose, this._maxAge);
		entry = { uri, dispose };

		this._data.push(entry);
	}
}
