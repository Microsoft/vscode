/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { hasWorkspaceFileExtension, IWorkspaceFolderCreationData, IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { basename, isEqual } from 'vs/base/common/resources';
import { IFileService } from 'vs/platform/files/common/files';
import { IWindowOpenable } from 'vs/platform/windows/common/windows';
import { URI } from 'vs/base/common/uri';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { IBaseTextResourceEditorInput } from 'vs/platform/editor/common/editor';
import { DataTransfers, IDragAndDropData } from 'vs/base/browser/dnd';
import { DragMouseEvent } from 'vs/base/browser/mouseEvent';
import { Mimes } from 'vs/base/common/mime';
import { isWindows } from 'vs/base/common/platform';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { isCodeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorIdentifier, GroupIdentifier, isEditorIdentifier } from 'vs/workbench/common/editor';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Disposable, IDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { addDisposableListener, EventType } from 'vs/base/browser/dom';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IWorkspaceEditingService } from 'vs/workbench/services/workspaces/common/workspaceEditing';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { Emitter } from 'vs/base/common/event';
import { coalesce } from 'vs/base/common/arrays';
import { parse, stringify } from 'vs/base/common/marshalling';
import { ILabelService } from 'vs/platform/label/common/label';

//#region Editor / Resources DND

export class DraggedEditorIdentifier {

	constructor(readonly identifier: IEditorIdentifier) { }
}

export class DraggedEditorGroupIdentifier {

	constructor(readonly identifier: GroupIdentifier) { }
}

export const CodeDataTransfers = {
	EDITORS: 'CodeEditors',
	FILES: 'CodeFiles'
};

export interface IDraggedResourceEditorInput extends IBaseTextResourceEditorInput {
	resource?: URI;
	isExternal?: boolean;
}

export function extractEditorsDropData(e: DragEvent, externalOnly?: boolean): Array<IDraggedResourceEditorInput> {
	const editors: IDraggedResourceEditorInput[] = [];
	if (e.dataTransfer && e.dataTransfer.types.length > 0) {

		// Check for window-to-window DND
		if (!externalOnly) {

			// Data Transfer: Code Editors
			const rawEditorsData = e.dataTransfer.getData(CodeDataTransfers.EDITORS);
			if (rawEditorsData) {
				try {
					editors.push(...parse(rawEditorsData));
				} catch (error) {
					// Invalid transfer
				}
			} else {
				// Data Transfer: Terminals
				const terminalResources = e.dataTransfer.getData(DataTransfers.TERMINALS);
				if (terminalResources) {
					try {
						const terminalURIs: string[] = JSON.parse(terminalResources);
						for (const uri of terminalURIs) {
							editors.push({ resource: URI.parse(uri) });
						}
					} catch (error) {
						// Invalid transfer
					}
				}

				// Data Transfer: Resources
				const rawResourcesData = e.dataTransfer.getData(DataTransfers.RESOURCES);
				if (rawResourcesData) {
					try {
						const resourcesRaw: string[] = JSON.parse(rawResourcesData);
						for (const resourceRaw of resourcesRaw) {
							if (resourceRaw.indexOf(':') > 0) { // mitigate https://github.com/microsoft/vscode/issues/124946
								editors.push({ resource: URI.parse(resourceRaw) });
							}
						}
					} catch (error) {
						// Invalid transfer
					}
				}
			}
		}

		// Check for native file transfer
		if (e.dataTransfer?.files) {
			for (let i = 0; i < e.dataTransfer.files.length; i++) {
				const file = e.dataTransfer.files[i];
				if (file?.path /* Electron only */) {
					try {
						editors.push({ resource: URI.file(file.path), isExternal: true });
					} catch (error) {
						// Invalid URI
					}
				}
			}
		}

		// Check for CodeFiles transfer
		const rawCodeFiles = e.dataTransfer.getData(CodeDataTransfers.FILES);
		if (rawCodeFiles) {
			try {
				const codeFiles: string[] = JSON.parse(rawCodeFiles);
				for (const codeFile of codeFiles) {
					editors.push({ resource: URI.file(codeFile), isExternal: true });
				}
			} catch (error) {
				// Invalid transfer
			}
		}
	}

	return editors;
}

export interface IResourcesDropHandlerOptions {

	/**
	 * Whether to open the actual workspace when a workspace configuration file is dropped
	 * or whether to open the configuration file within the editor as normal file.
	 */
	readonly allowWorkspaceOpen: boolean;
}

/**
 * Shared function across some components to handle drag & drop of resources.
 * E.g. of folders and workspace files to open them in the window instead of
 * the editor or to handle dirty editors being dropped between instances of Code.
 */
export class ResourcesDropHandler {

	constructor(
		private readonly options: IResourcesDropHandlerOptions,
		@IFileService private readonly fileService: IFileService,
		@IWorkspacesService private readonly workspacesService: IWorkspacesService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspaceEditingService private readonly workspaceEditingService: IWorkspaceEditingService,
		@IHostService private readonly hostService: IHostService
	) {
	}

	async handleDrop(event: DragEvent, resolveTargetGroup: () => IEditorGroup | undefined, afterDrop: (targetGroup: IEditorGroup | undefined) => void, targetIndex?: number): Promise<void> {
		const editors = extractEditorsDropData(event);
		if (!editors.length) {
			return;
		}

		// Make the window active to handle the drop properly within
		await this.hostService.focus();

		// Check for workspace file being dropped if we are allowed to do so
		const externalLocalFiles = coalesce(editors.filter(editor => editor.isExternal && editor.resource?.scheme === Schemas.file).map(editor => editor.resource));
		if (this.options.allowWorkspaceOpen) {
			if (externalLocalFiles.length > 0) {
				const isWorkspaceOpening = await this.handleWorkspaceFileDrop(externalLocalFiles);
				if (isWorkspaceOpening) {
					return; // return early if the drop operation resulted in this window changing to a workspace
				}
			}
		}

		// Add external ones to recently open list unless dropped resource is a workspace
		if (externalLocalFiles.length) {
			this.workspacesService.addRecentlyOpened(externalLocalFiles.map(resource => ({ fileUri: resource })));
		}

		// Open in Editor
		const targetGroup = resolveTargetGroup();
		await this.editorService.openEditors(editors.map(editor => ({
			...editor,
			resource: editor.resource,
			options: {
				...editor.options,
				pinned: true,
				index: targetIndex
			}
		})), targetGroup, { validateTrust: true });

		// Finish with provided function
		afterDrop(targetGroup);
	}

	private async handleWorkspaceFileDrop(resources: URI[]): Promise<boolean> {
		const toOpen: IWindowOpenable[] = [];
		const folderURIs: IWorkspaceFolderCreationData[] = [];

		await Promise.all(resources.map(async resource => {

			// Check for Workspace
			if (hasWorkspaceFileExtension(resource)) {
				toOpen.push({ workspaceUri: resource });

				return;
			}

			// Check for Folder
			try {
				const stat = await this.fileService.resolve(resource);
				if (stat.isDirectory) {
					toOpen.push({ folderUri: stat.resource });
					folderURIs.push({ uri: stat.resource });
				}
			} catch (error) {
				// Ignore error
			}
		}));

		// Return early if no external resource is a folder or workspace
		if (toOpen.length === 0) {
			return false;
		}

		// Pass focus to window
		this.hostService.focus();

		// Open in separate windows if we drop workspaces or just one folder
		if (toOpen.length > folderURIs.length || folderURIs.length === 1) {
			await this.hostService.openWindow(toOpen);
		}

		// folders.length > 1: Multiple folders: Create new workspace with folders and open
		else {
			await this.workspaceEditingService.createAndEnterWorkspace(folderURIs);
		}

		return true;
	}
}

interface IResourceStat {
	resource: URI;
	isDirectory?: boolean;
}

export function fillEditorsDragData(accessor: ServicesAccessor, resources: URI[], event: DragMouseEvent | DragEvent): void;
export function fillEditorsDragData(accessor: ServicesAccessor, resources: IResourceStat[], event: DragMouseEvent | DragEvent): void;
export function fillEditorsDragData(accessor: ServicesAccessor, editors: IEditorIdentifier[], event: DragMouseEvent | DragEvent): void;
export function fillEditorsDragData(accessor: ServicesAccessor, resourcesOrEditors: Array<URI | IResourceStat | IEditorIdentifier>, event: DragMouseEvent | DragEvent): void {
	if (resourcesOrEditors.length === 0 || !event.dataTransfer) {
		return;
	}

	const textFileService = accessor.get(ITextFileService);
	const editorService = accessor.get(IEditorService);
	const fileService = accessor.get(IFileService);
	const labelService = accessor.get(ILabelService);

	// Extract resources from URIs or Editors that
	// can be handled by the file service
	const resources = coalesce(resourcesOrEditors.map(resourceOrEditor => {
		if (URI.isUri(resourceOrEditor)) {
			return { resource: resourceOrEditor };
		}

		if (isEditorIdentifier(resourceOrEditor)) {
			if (URI.isUri(resourceOrEditor.editor.resource)) {
				return { resource: resourceOrEditor.editor.resource };
			}

			return undefined; // editor without resource
		}

		return resourceOrEditor;
	}));
	const fileSystemResources = resources.filter(({ resource }) => fileService.canHandleResource(resource));

	// Text: allows to paste into text-capable areas
	const lineDelimiter = isWindows ? '\r\n' : '\n';
	event.dataTransfer.setData(DataTransfers.TEXT, fileSystemResources.map(({ resource }) => labelService.getUriLabel(resource, { noPrefix: true })).join(lineDelimiter));

	// Download URL: enables support to drag a tab as file to desktop (only single file supported)
	const firstFile = fileSystemResources.find(({ isDirectory }) => !isDirectory);
	if (firstFile) {
		// TODO@sandbox this will no longer work when `vscode-file`
		// is enabled because we block loading resources that are not
		// inside installation dir
		event.dataTransfer.setData(DataTransfers.DOWNLOAD_URL, [Mimes.binary, basename(firstFile.resource), FileAccess.asBrowserUri(firstFile.resource).toString()].join(':'));
	}

	// Resource URLs: allows to drop multiple file resources to a target in VS Code
	const files = fileSystemResources.filter(({ isDirectory }) => !isDirectory);
	if (files.length) {
		event.dataTransfer.setData(DataTransfers.RESOURCES, JSON.stringify(files.map(({ resource }) => resource.toString())));
	}

	// Terminal URI
	const terminalResources = resources.filter(({ resource }) => resource.scheme === Schemas.vscodeTerminal);
	if (terminalResources.length) {
		event.dataTransfer.setData(DataTransfers.TERMINALS, JSON.stringify(terminalResources.map(({ resource }) => resource.toString())));
	}

	// Editors: enables cross window DND of editors
	// into the editor area while presering UI state
	const draggedEditors: IDraggedResourceEditorInput[] = [];

	for (const resourceOrEditor of resourcesOrEditors) {

		// Extract resource editor from provided object or URI
		let editor: IDraggedResourceEditorInput | undefined = undefined;
		if (isEditorIdentifier(resourceOrEditor)) {
			editor = resourceOrEditor.editor.toUntyped({ preserveViewState: resourceOrEditor.groupId });
		} else if (URI.isUri(resourceOrEditor)) {
			editor = { resource: resourceOrEditor };
		} else if (!resourceOrEditor.isDirectory) {
			editor = { resource: resourceOrEditor.resource };
		}

		if (!editor) {
			continue; // skip over editors that cannot be transferred via dnd
		}

		// Fill in some properties if they are not there already by accessing
		// some well known things from the text file universe.
		// This is not ideal for custom editors, but those have a chance to
		// provide everything from the `toUntyped` method.
		{
			const resource = editor.resource;
			if (resource) {
				const textFileModel = textFileService.files.get(resource);
				if (textFileModel) {

					// mode
					if (typeof editor.mode !== 'string') {
						editor.mode = textFileModel.getMode();
					}

					// encoding
					if (typeof editor.encoding !== 'string') {
						editor.encoding = textFileModel.getEncoding();
					}

					// contents (only if dirty)
					if (typeof editor.contents !== 'string' && textFileModel.isDirty()) {
						editor.contents = textFileModel.textEditorModel.getValue();
					}
				}

				// viewState
				if (!editor.options?.viewState) {
					editor.options = {
						...editor.options,
						viewState: (() => {
							for (const textEditorControl of editorService.visibleTextEditorControls) {
								if (isCodeEditor(textEditorControl)) {
									const model = textEditorControl.getModel();
									if (isEqual(model?.uri, resource)) {
										return withNullAsUndefined(textEditorControl.saveViewState());
									}
								}
							}

							return undefined;
						})()
					};
				}
			}
		}

		// Add as dragged editor
		draggedEditors.push(editor);
	}

	if (draggedEditors.length) {
		event.dataTransfer.setData(CodeDataTransfers.EDITORS, stringify(draggedEditors));
	}
}

//#endregion

//#region DND Utilities

/**
 * A singleton to store transfer data during drag & drop operations that are only valid within the application.
 */
export class LocalSelectionTransfer<T> {

	private static readonly INSTANCE = new LocalSelectionTransfer();

	private data?: T[];
	private proto?: T;

	private constructor() {
		// protect against external instantiation
	}

	static getInstance<T>(): LocalSelectionTransfer<T> {
		return LocalSelectionTransfer.INSTANCE as LocalSelectionTransfer<T>;
	}

	hasData(proto: T): boolean {
		return proto && proto === this.proto;
	}

	clearData(proto: T): void {
		if (this.hasData(proto)) {
			this.proto = undefined;
			this.data = undefined;
		}
	}

	getData(proto: T): T[] | undefined {
		if (this.hasData(proto)) {
			return this.data;
		}

		return undefined;
	}

	setData(data: T[], proto: T): void {
		if (proto) {
			this.data = data;
			this.proto = proto;
		}
	}
}

export interface IDragAndDropObserverCallbacks {
	readonly onDragEnter: (e: DragEvent) => void;
	readonly onDragLeave: (e: DragEvent) => void;
	readonly onDrop: (e: DragEvent) => void;
	readonly onDragEnd: (e: DragEvent) => void;

	readonly onDragOver?: (e: DragEvent) => void;
}

export class DragAndDropObserver extends Disposable {

	// A helper to fix issues with repeated DRAG_ENTER / DRAG_LEAVE
	// calls see https://github.com/microsoft/vscode/issues/14470
	// when the element has child elements where the events are fired
	// repeadedly.
	private counter: number = 0;

	constructor(private readonly element: HTMLElement, private readonly callbacks: IDragAndDropObserverCallbacks) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(addDisposableListener(this.element, EventType.DRAG_ENTER, (e: DragEvent) => {
			this.counter++;

			this.callbacks.onDragEnter(e);
		}));

		this._register(addDisposableListener(this.element, EventType.DRAG_OVER, (e: DragEvent) => {
			e.preventDefault(); // needed so that the drop event fires (https://stackoverflow.com/questions/21339924/drop-event-not-firing-in-chrome)

			if (this.callbacks.onDragOver) {
				this.callbacks.onDragOver(e);
			}
		}));

		this._register(addDisposableListener(this.element, EventType.DRAG_LEAVE, (e: DragEvent) => {
			this.counter--;

			if (this.counter === 0) {
				this.callbacks.onDragLeave(e);
			}
		}));

		this._register(addDisposableListener(this.element, EventType.DRAG_END, (e: DragEvent) => {
			this.counter = 0;
			this.callbacks.onDragEnd(e);
		}));

		this._register(addDisposableListener(this.element, EventType.DROP, (e: DragEvent) => {
			this.counter = 0;
			this.callbacks.onDrop(e);
		}));
	}
}

export function containsDragType(event: DragEvent, ...dragTypesToFind: string[]): boolean {
	if (!event.dataTransfer) {
		return false;
	}

	const dragTypes = event.dataTransfer.types;
	const lowercaseDragTypes: string[] = [];
	for (let i = 0; i < dragTypes.length; i++) {
		lowercaseDragTypes.push(dragTypes[i].toLowerCase()); // somehow the types are lowercase
	}

	for (const dragType of dragTypesToFind) {
		if (lowercaseDragTypes.indexOf(dragType.toLowerCase()) >= 0) {
			return true;
		}
	}

	return false;
}

//#endregion

//#region Composites DND

export type Before2D = {
	readonly verticallyBefore: boolean;
	readonly horizontallyBefore: boolean;
};

export interface ICompositeDragAndDrop {
	drop(data: IDragAndDropData, target: string | undefined, originalEvent: DragEvent, before?: Before2D): void;
	onDragOver(data: IDragAndDropData, target: string | undefined, originalEvent: DragEvent): boolean;
	onDragEnter(data: IDragAndDropData, target: string | undefined, originalEvent: DragEvent): boolean;
}

export interface ICompositeDragAndDropObserverCallbacks {
	onDragEnter?: (e: IDraggedCompositeData) => void;
	onDragLeave?: (e: IDraggedCompositeData) => void;
	onDrop?: (e: IDraggedCompositeData) => void;
	onDragOver?: (e: IDraggedCompositeData) => void;
	onDragStart?: (e: IDraggedCompositeData) => void;
	onDragEnd?: (e: IDraggedCompositeData) => void;
}

export class CompositeDragAndDropData implements IDragAndDropData {

	constructor(private type: 'view' | 'composite', private id: string) { }

	update(dataTransfer: DataTransfer): void {
		// no-op
	}

	getData(): {
		type: 'view' | 'composite';
		id: string;
	} {
		return { type: this.type, id: this.id };
	}
}

export interface IDraggedCompositeData {
	readonly eventData: DragEvent;
	readonly dragAndDropData: CompositeDragAndDropData;
}

export class DraggedCompositeIdentifier {

	constructor(private compositeId: string) { }

	get id(): string {
		return this.compositeId;
	}
}

export class DraggedViewIdentifier {

	constructor(private viewId: string) { }

	get id(): string {
		return this.viewId;
	}
}

export type ViewType = 'composite' | 'view';

export class CompositeDragAndDropObserver extends Disposable {

	private static instance: CompositeDragAndDropObserver | undefined;

	static get INSTANCE(): CompositeDragAndDropObserver {
		if (!CompositeDragAndDropObserver.instance) {
			CompositeDragAndDropObserver.instance = new CompositeDragAndDropObserver();
		}

		return CompositeDragAndDropObserver.instance;
	}

	private readonly transferData = LocalSelectionTransfer.getInstance<DraggedCompositeIdentifier | DraggedViewIdentifier>();

	private readonly onDragStart = this._register(new Emitter<IDraggedCompositeData>());
	private readonly onDragEnd = this._register(new Emitter<IDraggedCompositeData>());

	private constructor() {
		super();

		this._register(this.onDragEnd.event(e => {
			const id = e.dragAndDropData.getData().id;
			const type = e.dragAndDropData.getData().type;
			const data = this.readDragData(type);
			if (data?.getData().id === id) {
				this.transferData.clearData(type === 'view' ? DraggedViewIdentifier.prototype : DraggedCompositeIdentifier.prototype);
			}
		}));
	}

	private readDragData(type: ViewType): CompositeDragAndDropData | undefined {
		if (this.transferData.hasData(type === 'view' ? DraggedViewIdentifier.prototype : DraggedCompositeIdentifier.prototype)) {
			const data = this.transferData.getData(type === 'view' ? DraggedViewIdentifier.prototype : DraggedCompositeIdentifier.prototype);
			if (data && data[0]) {
				return new CompositeDragAndDropData(type, data[0].id);
			}
		}

		return undefined;
	}

	private writeDragData(id: string, type: ViewType): void {
		this.transferData.setData([type === 'view' ? new DraggedViewIdentifier(id) : new DraggedCompositeIdentifier(id)], type === 'view' ? DraggedViewIdentifier.prototype : DraggedCompositeIdentifier.prototype);
	}

	registerTarget(element: HTMLElement, callbacks: ICompositeDragAndDropObserverCallbacks): IDisposable {
		const disposableStore = new DisposableStore();
		disposableStore.add(new DragAndDropObserver(element, {
			onDragEnd: e => {
				// no-op
			},
			onDragEnter: e => {
				e.preventDefault();

				if (callbacks.onDragEnter) {
					const data = this.readDragData('composite') || this.readDragData('view');
					if (data) {
						callbacks.onDragEnter({ eventData: e, dragAndDropData: data! });
					}
				}
			},
			onDragLeave: e => {
				const data = this.readDragData('composite') || this.readDragData('view');
				if (callbacks.onDragLeave && data) {
					callbacks.onDragLeave({ eventData: e, dragAndDropData: data! });
				}
			},
			onDrop: e => {
				if (callbacks.onDrop) {
					const data = this.readDragData('composite') || this.readDragData('view');
					if (!data) {
						return;
					}

					callbacks.onDrop({ eventData: e, dragAndDropData: data! });

					// Fire drag event in case drop handler destroys the dragged element
					this.onDragEnd.fire({ eventData: e, dragAndDropData: data! });
				}
			},
			onDragOver: e => {
				e.preventDefault();

				if (callbacks.onDragOver) {
					const data = this.readDragData('composite') || this.readDragData('view');
					if (!data) {
						return;
					}

					callbacks.onDragOver({ eventData: e, dragAndDropData: data! });
				}
			}
		}));

		if (callbacks.onDragStart) {
			this.onDragStart.event(e => {
				callbacks.onDragStart!(e);
			}, this, disposableStore);
		}

		if (callbacks.onDragEnd) {
			this.onDragEnd.event(e => {
				callbacks.onDragEnd!(e);
			});
		}

		return this._register(disposableStore);
	}

	registerDraggable(element: HTMLElement, draggedItemProvider: () => { type: ViewType, id: string }, callbacks: ICompositeDragAndDropObserverCallbacks): IDisposable {
		element.draggable = true;

		const disposableStore = new DisposableStore();

		disposableStore.add(addDisposableListener(element, EventType.DRAG_START, e => {
			const { id, type } = draggedItemProvider();
			this.writeDragData(id, type);

			e.dataTransfer?.setDragImage(element, 0, 0);

			this.onDragStart.fire({ eventData: e, dragAndDropData: this.readDragData(type)! });
		}));

		disposableStore.add(new DragAndDropObserver(element, {
			onDragEnd: e => {
				const { type } = draggedItemProvider();
				const data = this.readDragData(type);
				if (!data) {
					return;
				}

				this.onDragEnd.fire({ eventData: e, dragAndDropData: data! });
			},
			onDragEnter: e => {
				if (callbacks.onDragEnter) {
					const data = this.readDragData('composite') || this.readDragData('view');
					if (!data) {
						return;
					}

					if (data) {
						callbacks.onDragEnter({ eventData: e, dragAndDropData: data! });
					}
				}
			},
			onDragLeave: e => {
				const data = this.readDragData('composite') || this.readDragData('view');
				if (!data) {
					return;
				}

				if (callbacks.onDragLeave) {
					callbacks.onDragLeave({ eventData: e, dragAndDropData: data! });
				}
			},
			onDrop: e => {
				if (callbacks.onDrop) {
					const data = this.readDragData('composite') || this.readDragData('view');
					if (!data) {
						return;
					}

					callbacks.onDrop({ eventData: e, dragAndDropData: data! });

					// Fire drag event in case drop handler destroys the dragged element
					this.onDragEnd.fire({ eventData: e, dragAndDropData: data! });
				}
			},
			onDragOver: e => {
				if (callbacks.onDragOver) {
					const data = this.readDragData('composite') || this.readDragData('view');
					if (!data) {
						return;
					}

					callbacks.onDragOver({ eventData: e, dragAndDropData: data! });
				}
			}
		}));

		if (callbacks.onDragStart) {
			this.onDragStart.event(e => {
				callbacks.onDragStart!(e);
			}, this, disposableStore);
		}

		if (callbacks.onDragEnd) {
			this.onDragEnd.event(e => {
				callbacks.onDragEnd!(e);
			}, this, disposableStore);
		}

		return this._register(disposableStore);
	}
}

export function toggleDropEffect(dataTransfer: DataTransfer | null, dropEffect: 'none' | 'copy' | 'link' | 'move', shouldHaveIt: boolean) {
	if (!dataTransfer) {
		return;
	}

	dataTransfer.dropEffect = shouldHaveIt ? dropEffect : 'none';
}

//#endregion
