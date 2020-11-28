/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IResourceEditorInput, ITextEditorOptions, IEditorOptions, EditorActivation } from 'vs/platform/editor/common/editor';
import { SideBySideEditor, IEditorInput, IEditorPane, GroupIdentifier, IFileEditorInput, IUntitledTextResourceEditorInput, IResourceDiffEditorInput, IEditorInputFactoryRegistry, Extensions as EditorExtensions, EditorInput, SideBySideEditorInput, IEditorInputWithOptions, isEditorInputWithOptions, EditorOptions, TextEditorOptions, IEditorIdentifier, IEditorCloseEvent, ITextEditorPane, ITextDiffEditorPane, IRevertOptions, SaveReason, EditorsOrder, isTextEditorPane, IWorkbenchEditorConfiguration, EditorResourceAccessor, IVisibleEditorPane } from 'vs/workbench/common/editor';
import { ResourceEditorInput } from 'vs/workbench/common/editor/resourceEditorInput';
import { Registry } from 'vs/platform/registry/common/platform';
import { ResourceMap } from 'vs/base/common/map';
import { IUntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { IFileService, FileOperationEvent, FileOperation, FileChangesEvent, FileChangeType, FileSystemProviderCapabilities } from 'vs/platform/files/common/files';
import { Schemas } from 'vs/base/common/network';
import { Event, Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { basename, joinPath, isEqual } from 'vs/base/common/resources';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { IEditorGroupsService, IEditorGroup, GroupsOrder, IEditorReplacement, GroupChangeKind, preferredSideBySideGroupDirection, OpenEditorContext } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IResourceEditorInputType, SIDE_GROUP, IResourceEditorReplacement, IOpenEditorOverrideHandler, IEditorService, SIDE_GROUP_TYPE, ACTIVE_GROUP_TYPE, ISaveEditorsOptions, ISaveAllEditorsOptions, IRevertAllEditorsOptions, IBaseSaveRevertAllEditorOptions, IOpenEditorOverrideEntry, ICustomEditorViewTypesHandler, ICustomEditorInfo } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Disposable, IDisposable, dispose, toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { coalesce, distinct, insert } from 'vs/base/common/arrays';
import { isCodeEditor, isDiffEditor, ICodeEditor, IDiffEditor, isCompositeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorGroupView, IEditorOpeningEvent, EditorServiceImpl } from 'vs/workbench/browser/parts/editor/editor';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { withNullAsUndefined } from 'vs/base/common/types';
import { EditorsObserver } from 'vs/workbench/browser/parts/editor/editorsObserver';
import { IEditorViewState } from 'vs/editor/common/editorCommon';
import { IUntitledTextEditorModel } from 'vs/workbench/services/untitled/common/untitledTextEditorModel';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { timeout } from 'vs/base/common/async';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { indexOfPath } from 'vs/base/common/extpath';
import { DEFAULT_CUSTOM_EDITOR, updateViewTypeSchema, editorAssociationsConfigurationNode } from 'vs/workbench/services/editor/common/editorOpenWith';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ILogService } from 'vs/platform/log/common/log';

type CachedEditorInput = ResourceEditorInput | IFileEditorInput | UntitledTextEditorInput;
type OpenInEditorGroup = IEditorGroup | GroupIdentifier | SIDE_GROUP_TYPE | ACTIVE_GROUP_TYPE;

export class EditorService extends Disposable implements EditorServiceImpl {

	declare readonly _serviceBrand: undefined;

	//#region events

	private readonly _onDidActiveEditorChange = this._register(new Emitter<void>());
	readonly onDidActiveEditorChange = this._onDidActiveEditorChange.event;

	private readonly _onDidVisibleEditorsChange = this._register(new Emitter<void>());
	readonly onDidVisibleEditorsChange = this._onDidVisibleEditorsChange.event;

	private readonly _onDidCloseEditor = this._register(new Emitter<IEditorCloseEvent>());
	readonly onDidCloseEditor = this._onDidCloseEditor.event;

	private readonly _onDidOpenEditorFail = this._register(new Emitter<IEditorIdentifier>());
	readonly onDidOpenEditorFail = this._onDidOpenEditorFail.event;

	private readonly _onDidMostRecentlyActiveEditorsChange = this._register(new Emitter<void>());
	readonly onDidMostRecentlyActiveEditorsChange = this._onDidMostRecentlyActiveEditorsChange.event;

	//#endregion

	private readonly fileEditorInputFactory = Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).getFileEditorInputFactory();

	constructor(
		@IEditorGroupsService private readonly editorGroupService: IEditorGroupsService,
		@IUntitledTextEditorService private readonly untitledTextEditorService: IUntitledTextEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IFileService private readonly fileService: IFileService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.onConfigurationUpdated(configurationService.getValue<IWorkbenchEditorConfiguration>());

		this.registerListeners();
	}

	private registerListeners(): void {

		// Editor & group changes
		this.editorGroupService.whenRestored.then(() => this.onEditorsRestored());
		this.editorGroupService.onDidActiveGroupChange(group => this.handleActiveEditorChange(group));
		this.editorGroupService.onDidAddGroup(group => this.registerGroupListeners(group as IEditorGroupView));
		this.editorsObserver.onDidMostRecentlyActiveEditorsChange(() => this._onDidMostRecentlyActiveEditorsChange.fire());

		// Out of workspace file watchers
		this._register(this.onDidVisibleEditorsChange(() => this.handleVisibleEditorsChange()));

		// File changes & operations
		// Note: there is some duplication with the two file event handlers- Since we cannot always rely on the disk events
		// carrying all necessary data in all environments, we also use the file operation events to make sure operations are handled.
		// In any case there is no guarantee if the local event is fired first or the disk one. Thus, code must handle the case
		// that the event ordering is random as well as might not carry all information needed.
		this._register(this.fileService.onDidRunOperation(e => this.onDidRunFileOperation(e)));
		this._register(this.fileService.onDidFilesChange(e => this.onDidFilesChange(e)));

		// Configuration
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationUpdated(this.configurationService.getValue<IWorkbenchEditorConfiguration>())));
	}

	//#region Editor & group event handlers

	private lastActiveEditor: IEditorInput | undefined = undefined;

	private onEditorsRestored(): void {

		// Register listeners to each opened group
		this.editorGroupService.groups.forEach(group => this.registerGroupListeners(group as IEditorGroupView));

		// Fire initial set of editor events if there is an active editor
		if (this.activeEditor) {
			this.doHandleActiveEditorChangeEvent();
			this._onDidVisibleEditorsChange.fire();
		}
	}

	private handleActiveEditorChange(group: IEditorGroup): void {
		if (group !== this.editorGroupService.activeGroup) {
			return; // ignore if not the active group
		}

		if (!this.lastActiveEditor && !group.activeEditor) {
			return; // ignore if we still have no active editor
		}

		this.doHandleActiveEditorChangeEvent();
	}

	private doHandleActiveEditorChangeEvent(): void {

		// Remember as last active
		const activeGroup = this.editorGroupService.activeGroup;
		this.lastActiveEditor = withNullAsUndefined(activeGroup.activeEditor);

		// Fire event to outside parties
		this._onDidActiveEditorChange.fire();
	}

	private registerGroupListeners(group: IEditorGroupView): void {
		const groupDisposables = new DisposableStore();

		groupDisposables.add(group.onDidGroupChange(e => {
			if (e.kind === GroupChangeKind.EDITOR_ACTIVE) {
				this.handleActiveEditorChange(group);
				this._onDidVisibleEditorsChange.fire();
			}
		}));

		groupDisposables.add(group.onDidCloseEditor(event => {
			this._onDidCloseEditor.fire(event);
		}));

		groupDisposables.add(group.onWillOpenEditor(event => {
			this.onGroupWillOpenEditor(group, event);
		}));

		groupDisposables.add(group.onDidOpenEditorFail(editor => {
			this._onDidOpenEditorFail.fire({ editor, groupId: group.id });
		}));

		Event.once(group.onWillDispose)(() => {
			dispose(groupDisposables);
		});
	}

	//#endregion

	//#region Visible Editors Change: Install file watchers for out of workspace resources that became visible

	private readonly activeOutOfWorkspaceWatchers = new ResourceMap<IDisposable>();

	private handleVisibleEditorsChange(): void {
		const visibleOutOfWorkspaceResources = new ResourceMap<URI>();

		for (const editor of this.visibleEditors) {
			const resources = distinct(coalesce([
				EditorResourceAccessor.getCanonicalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY }),
				EditorResourceAccessor.getCanonicalUri(editor, { supportSideBySide: SideBySideEditor.SECONDARY })
			]), resource => resource.toString());

			for (const resource of resources) {
				if (this.fileService.canHandleResource(resource) && !this.contextService.isInsideWorkspace(resource)) {
					visibleOutOfWorkspaceResources.set(resource, resource);
				}
			}
		}

		// Handle no longer visible out of workspace resources
		[...this.activeOutOfWorkspaceWatchers.keys()].forEach(resource => {
			if (!visibleOutOfWorkspaceResources.get(resource)) {
				dispose(this.activeOutOfWorkspaceWatchers.get(resource));
				this.activeOutOfWorkspaceWatchers.delete(resource);
			}
		});

		// Handle newly visible out of workspace resources
		visibleOutOfWorkspaceResources.forEach(resource => {
			if (!this.activeOutOfWorkspaceWatchers.get(resource)) {
				const disposable = this.fileService.watch(resource);
				this.activeOutOfWorkspaceWatchers.set(resource, disposable);
			}
		});
	}

	//#endregion

	//#region File Changes: Move & Deletes to move or close opend editors

	private onDidRunFileOperation(e: FileOperationEvent): void {

		// Handle moves specially when file is opened
		if (e.isOperation(FileOperation.MOVE)) {
			this.handleMovedFile(e.resource, e.target.resource);
		}

		// Handle deletes
		if (e.isOperation(FileOperation.DELETE) || e.isOperation(FileOperation.MOVE)) {
			this.handleDeletedFile(e.resource, false, e.target ? e.target.resource : undefined);
		}
	}

	private onDidFilesChange(e: FileChangesEvent): void {
		if (e.gotDeleted()) {
			this.handleDeletedFile(e, true);
		}
	}

	private handleMovedFile(source: URI, target: URI): void {
		for (const group of this.editorGroupService.groups) {
			let replacements: (IResourceEditorReplacement | IEditorReplacement)[] = [];

			for (const editor of group.editors) {
				const resource = editor.resource;
				if (!resource || !this.uriIdentityService.extUri.isEqualOrParent(resource, source)) {
					continue; // not matching our resource
				}

				// Determine new resulting target resource
				let targetResource: URI;
				if (this.uriIdentityService.extUri.isEqual(source, resource)) {
					targetResource = target; // file got moved
				} else {
					const ignoreCase = !this.fileService.hasCapability(resource, FileSystemProviderCapabilities.PathCaseSensitive);
					const index = indexOfPath(resource.path, source.path, ignoreCase);
					targetResource = joinPath(target, resource.path.substr(index + source.path.length + 1)); // parent folder got moved
				}

				// Delegate rename() to editor instance
				const moveResult = editor.rename(group.id, targetResource);
				if (!moveResult) {
					return; // not target - ignore
				}

				const optionOverrides = {
					preserveFocus: true,
					pinned: group.isPinned(editor),
					sticky: group.isSticky(editor),
					index: group.getIndexOfEditor(editor),
					inactive: !group.isActive(editor)
				};

				// Construct a replacement with our extra options mixed in
				if (moveResult.editor instanceof EditorInput) {
					replacements.push({
						editor,
						replacement: moveResult.editor,
						options: {
							...moveResult.options,
							...optionOverrides
						}
					});
				} else {
					replacements.push({
						editor: { resource: editor.resource },
						replacement: {
							...moveResult.editor,
							options: {
								...moveResult.editor.options,
								...optionOverrides
							}
						}
					});
				}
			}

			// Apply replacements
			if (replacements.length) {
				this.replaceEditors(replacements, group);
			}
		}
	}

	private closeOnFileDelete: boolean = false;

	private onConfigurationUpdated(configuration: IWorkbenchEditorConfiguration): void {
		if (typeof configuration.workbench?.editor?.closeOnFileDelete === 'boolean') {
			this.closeOnFileDelete = configuration.workbench.editor.closeOnFileDelete;
		} else {
			this.closeOnFileDelete = false; // default
		}
	}

	private handleDeletedFile(arg1: URI | FileChangesEvent, isExternal: boolean, movedTo?: URI): void {
		for (const editor of this.getAllNonDirtyEditors({ includeUntitled: false, supportSideBySide: true })) {
			(async () => {
				const resource = editor.resource;
				if (!resource) {
					return;
				}

				// Handle deletes in opened editors depending on:
				// - the user has not disabled the setting closeOnFileDelete
				// - the file change is local
				// - the input is  a file that is not resolved (we need to dispose because we cannot restore otherwise since we do not have the contents)
				if (this.closeOnFileDelete || !isExternal || (this.fileEditorInputFactory.isFileEditorInput(editor) && !editor.isResolved())) {

					// Do NOT close any opened editor that matches the resource path (either equal or being parent) of the
					// resource we move to (movedTo). Otherwise we would close a resource that has been renamed to the same
					// path but different casing.
					if (movedTo && this.uriIdentityService.extUri.isEqualOrParent(resource, movedTo)) {
						return;
					}

					let matches = false;
					if (arg1 instanceof FileChangesEvent) {
						matches = arg1.contains(resource, FileChangeType.DELETED);
					} else {
						matches = this.uriIdentityService.extUri.isEqualOrParent(resource, arg1);
					}

					if (!matches) {
						return;
					}

					// We have received reports of users seeing delete events even though the file still
					// exists (network shares issue: https://github.com/microsoft/vscode/issues/13665).
					// Since we do not want to close an editor without reason, we have to check if the
					// file is really gone and not just a faulty file event.
					// This only applies to external file events, so we need to check for the isExternal
					// flag.
					let exists = false;
					if (isExternal && this.fileService.canHandleResource(resource)) {
						await timeout(100);
						exists = await this.fileService.exists(resource);
					}

					if (!exists && !editor.isDisposed()) {
						editor.dispose();
					}
				}
			})();
		}
	}

	private getAllNonDirtyEditors(options: { includeUntitled: boolean, supportSideBySide: boolean }): IEditorInput[] {
		const editors: IEditorInput[] = [];

		function conditionallyAddEditor(editor: IEditorInput): void {
			if (editor.isUntitled() && !options.includeUntitled) {
				return;
			}

			if (editor.isDirty()) {
				return;
			}

			editors.push(editor);
		}

		for (const editor of this.editors) {
			if (options.supportSideBySide && editor instanceof SideBySideEditorInput) {
				conditionallyAddEditor(editor.primary);
				conditionallyAddEditor(editor.secondary);
			} else {
				conditionallyAddEditor(editor);
			}
		}

		return editors;
	}

	//#endregion

	//#region Editor accessors

	private readonly editorsObserver = this._register(this.instantiationService.createInstance(EditorsObserver));

	get activeEditorPane(): IVisibleEditorPane | undefined {
		return this.editorGroupService.activeGroup?.activeEditorPane;
	}

	get activeTextEditorControl(): ICodeEditor | IDiffEditor | undefined {
		const activeEditorPane = this.activeEditorPane;
		if (activeEditorPane) {
			const activeControl = activeEditorPane.getControl();
			if (isCodeEditor(activeControl) || isDiffEditor(activeControl)) {
				return activeControl;
			}
			if (isCompositeEditor(activeControl) && isCodeEditor(activeControl.activeCodeEditor)) {
				return activeControl.activeCodeEditor;
			}
		}

		return undefined;
	}

	get activeTextEditorMode(): string | undefined {
		let activeCodeEditor: ICodeEditor | undefined = undefined;

		const activeTextEditorControl = this.activeTextEditorControl;
		if (isDiffEditor(activeTextEditorControl)) {
			activeCodeEditor = activeTextEditorControl.getModifiedEditor();
		} else {
			activeCodeEditor = activeTextEditorControl;
		}

		return activeCodeEditor?.getModel()?.getLanguageIdentifier().language;
	}

	get count(): number {
		return this.editorsObserver.count;
	}

	get editors(): IEditorInput[] {
		return this.getEditors(EditorsOrder.SEQUENTIAL).map(({ editor }) => editor);
	}

	getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }): ReadonlyArray<IEditorIdentifier> {
		switch (order) {

			// MRU
			case EditorsOrder.MOST_RECENTLY_ACTIVE:
				if (options?.excludeSticky) {
					return this.editorsObserver.editors.filter(({ groupId, editor }) => !this.editorGroupService.getGroup(groupId)?.isSticky(editor));
				}

				return this.editorsObserver.editors;

			// Sequential
			case EditorsOrder.SEQUENTIAL:
				const editors: IEditorIdentifier[] = [];

				this.editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE).forEach(group => {
					editors.push(...group.getEditors(EditorsOrder.SEQUENTIAL, options).map(editor => ({ editor, groupId: group.id })));
				});

				return editors;
		}
	}

	get activeEditor(): IEditorInput | undefined {
		const activeGroup = this.editorGroupService.activeGroup;

		return activeGroup ? withNullAsUndefined(activeGroup.activeEditor) : undefined;
	}

	get visibleEditorPanes(): IVisibleEditorPane[] {
		return coalesce(this.editorGroupService.groups.map(group => group.activeEditorPane));
	}

	get visibleTextEditorControls(): Array<ICodeEditor | IDiffEditor> {
		const visibleTextEditorControls: Array<ICodeEditor | IDiffEditor> = [];
		for (const visibleEditorPane of this.visibleEditorPanes) {
			const control = visibleEditorPane.getControl();
			if (isCodeEditor(control) || isDiffEditor(control)) {
				visibleTextEditorControls.push(control);
			}
		}

		return visibleTextEditorControls;
	}

	get visibleEditors(): IEditorInput[] {
		return coalesce(this.editorGroupService.groups.map(group => group.activeEditor));
	}

	//#endregion

	//#region editor overrides

	private readonly openEditorHandlers: IOpenEditorOverrideHandler[] = [];

	overrideOpenEditor(handler: IOpenEditorOverrideHandler): IDisposable {
		const remove = insert(this.openEditorHandlers, handler);

		return toDisposable(() => remove());
	}

	getEditorOverrides(resource: URI, options: IEditorOptions | undefined, group: IEditorGroup | undefined): [IOpenEditorOverrideHandler, IOpenEditorOverrideEntry][] {
		const overrides = [];
		for (const handler of this.openEditorHandlers) {
			if (typeof handler.getEditorOverrides === 'function') {
				try {
					overrides.push(...handler.getEditorOverrides(resource, options, group).map(val => [handler, val] as [IOpenEditorOverrideHandler, IOpenEditorOverrideEntry]));
				} catch (error) {
					this.logService.error(`Unexpected error getting editor overrides: ${error}`);
				}
			}
		}

		return overrides;
	}

	private onGroupWillOpenEditor(group: IEditorGroup, event: IEditorOpeningEvent): void {
		if (event.options?.override === false) {
			return; // return early when overrides are explicitly disabled
		}

		for (const handler of this.openEditorHandlers) {
			const result = handler.open(event.editor, event.options, group, event.context ?? OpenEditorContext.NEW_EDITOR);
			const override = result?.override;
			if (override) {
				event.prevent((() => override.then(editor => withNullAsUndefined(editor))));
				break;
			}
		}
	}

	//#endregion

	//#region openEditor()

	openEditor(editor: IEditorInput, options?: IEditorOptions | ITextEditorOptions, group?: OpenInEditorGroup): Promise<IEditorPane | undefined>;
	openEditor(editor: IResourceEditorInput | IUntitledTextResourceEditorInput, group?: OpenInEditorGroup): Promise<ITextEditorPane | undefined>;
	openEditor(editor: IResourceDiffEditorInput, group?: OpenInEditorGroup): Promise<ITextDiffEditorPane | undefined>;
	async openEditor(editor: IEditorInput | IResourceEditorInputType, optionsOrGroup?: IEditorOptions | ITextEditorOptions | OpenInEditorGroup, group?: OpenInEditorGroup): Promise<IEditorPane | undefined> {
		const result = this.doResolveEditorOpenRequest(editor, optionsOrGroup, group);
		if (result) {
			const [resolvedGroup, resolvedEditor, resolvedOptions] = result;

			return withNullAsUndefined(await resolvedGroup.openEditor(resolvedEditor, resolvedOptions));
		}

		return undefined;
	}

	doResolveEditorOpenRequest(editor: IEditorInput | IResourceEditorInputType, optionsOrGroup?: IEditorOptions | ITextEditorOptions | OpenInEditorGroup, group?: OpenInEditorGroup): [IEditorGroup, EditorInput, EditorOptions | undefined] | undefined {
		let resolvedGroup: IEditorGroup | undefined;
		let candidateGroup: OpenInEditorGroup | undefined;

		let typedEditor: EditorInput | undefined;
		let typedOptions: EditorOptions | undefined;

		// Typed Editor Support
		if (editor instanceof EditorInput) {
			typedEditor = editor;
			typedOptions = this.toOptions(optionsOrGroup as IEditorOptions);

			candidateGroup = group;
			resolvedGroup = this.findTargetGroup(typedEditor, typedOptions, candidateGroup);
		}

		// Untyped Text Editor Support
		else {
			const textInput = <IResourceEditorInputType>editor;
			typedEditor = this.createEditorInput(textInput);
			if (typedEditor) {
				typedOptions = TextEditorOptions.from(textInput);

				candidateGroup = optionsOrGroup as OpenInEditorGroup;
				resolvedGroup = this.findTargetGroup(typedEditor, typedOptions, candidateGroup);
			}
		}

		if (typedEditor && resolvedGroup) {
			if (
				this.editorGroupService.activeGroup !== resolvedGroup && 	// only if target group is not already active
				typedOptions && !typedOptions.inactive &&					// never for inactive editors
				typedOptions.preserveFocus &&								// only if preserveFocus
				typeof typedOptions.activation !== 'number' &&				// only if activation is not already defined (either true or false)
				candidateGroup !== SIDE_GROUP								// never for the SIDE_GROUP
			) {
				// If the resolved group is not the active one, we typically
				// want the group to become active. There are a few cases
				// where we stay away from encorcing this, e.g. if the caller
				// is already providing `activation`.
				//
				// Specifically for historic reasons we do not activate a
				// group is it is opened as `SIDE_GROUP` with `preserveFocus:true`.
				// repeated Alt-clicking of files in the explorer always open
				// into the same side group and not cause a group to be created each time.
				typedOptions.overwrite({ activation: EditorActivation.ACTIVATE });
			}

			return [resolvedGroup, typedEditor, typedOptions];
		}

		return undefined;
	}

	private findTargetGroup(input: IEditorInput, options?: IEditorOptions, group?: OpenInEditorGroup): IEditorGroup {
		let targetGroup: IEditorGroup | undefined;

		// Group: Instance of Group
		if (group && typeof group !== 'number') {
			targetGroup = group;
		}

		// Group: Side by Side
		else if (group === SIDE_GROUP) {
			targetGroup = this.findSideBySideGroup();
		}

		// Group: Specific Group
		else if (typeof group === 'number' && group >= 0) {
			targetGroup = this.editorGroupService.getGroup(group);
		}

		// Group: Unspecified without a specific index to open
		else if (!options || typeof options.index !== 'number') {
			const groupsByLastActive = this.editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);

			// Respect option to reveal an editor if it is already visible in any group
			if (options?.revealIfVisible) {
				for (const group of groupsByLastActive) {
					if (group.isActive(input)) {
						targetGroup = group;
						break;
					}
				}
			}

			// Respect option to reveal an editor if it is open (not necessarily visible)
			// Still prefer to reveal an editor in a group where the editor is active though.
			if (!targetGroup) {
				if (options?.revealIfOpened || this.configurationService.getValue<boolean>('workbench.editor.revealIfOpen')) {
					let groupWithInputActive: IEditorGroup | undefined = undefined;
					let groupWithInputOpened: IEditorGroup | undefined = undefined;

					for (const group of groupsByLastActive) {
						if (group.isOpened(input)) {
							if (!groupWithInputOpened) {
								groupWithInputOpened = group;
							}

							if (!groupWithInputActive && group.isActive(input)) {
								groupWithInputActive = group;
							}
						}

						if (groupWithInputOpened && groupWithInputActive) {
							break; // we found all groups we wanted
						}
					}

					// Prefer a target group where the input is visible
					targetGroup = groupWithInputActive || groupWithInputOpened;
				}
			}
		}

		// Fallback to active group if target not valid
		if (!targetGroup) {
			targetGroup = this.editorGroupService.activeGroup;
		}

		return targetGroup;
	}

	private findSideBySideGroup(): IEditorGroup {
		const direction = preferredSideBySideGroupDirection(this.configurationService);

		let neighbourGroup = this.editorGroupService.findGroup({ direction });
		if (!neighbourGroup) {
			neighbourGroup = this.editorGroupService.addGroup(this.editorGroupService.activeGroup, direction);
		}

		return neighbourGroup;
	}

	private toOptions(options?: IEditorOptions | ITextEditorOptions | EditorOptions): EditorOptions {
		if (!options || options instanceof EditorOptions) {
			return options as EditorOptions;
		}

		const textOptions: ITextEditorOptions = options;
		if (textOptions.selection || textOptions.viewState) {
			return TextEditorOptions.create(options);
		}

		return EditorOptions.create(options);
	}

	//#endregion

	//#region openEditors()

	openEditors(editors: IEditorInputWithOptions[], group?: OpenInEditorGroup): Promise<IEditorPane[]>;
	openEditors(editors: IResourceEditorInputType[], group?: OpenInEditorGroup): Promise<IEditorPane[]>;
	async openEditors(editors: Array<IEditorInputWithOptions | IResourceEditorInputType>, group?: OpenInEditorGroup): Promise<IEditorPane[]> {

		// Convert to typed editors and options
		const typedEditors = editors.map(editor => {
			if (isEditorInputWithOptions(editor)) {
				return editor;
			}

			const editorInput: IEditorInputWithOptions = { editor: this.createEditorInput(editor), options: TextEditorOptions.from(editor) };
			return editorInput;
		});

		// Find target groups to open
		const mapGroupToEditors = new Map<IEditorGroup, IEditorInputWithOptions[]>();
		if (group === SIDE_GROUP) {
			mapGroupToEditors.set(this.findSideBySideGroup(), typedEditors);
		} else {
			typedEditors.forEach(typedEditor => {
				const targetGroup = this.findTargetGroup(typedEditor.editor, typedEditor.options, group);

				let targetGroupEditors = mapGroupToEditors.get(targetGroup);
				if (!targetGroupEditors) {
					targetGroupEditors = [];
					mapGroupToEditors.set(targetGroup, targetGroupEditors);
				}

				targetGroupEditors.push(typedEditor);
			});
		}

		// Open in target groups
		const result: Promise<IEditorPane | null>[] = [];
		mapGroupToEditors.forEach((editorsWithOptions, group) => {
			result.push(group.openEditors(editorsWithOptions));
		});

		return coalesce(await Promise.all(result));
	}

	//#endregion

	//#region isOpen()

	isOpen(editor: IEditorInput): boolean;
	isOpen(editor: IResourceEditorInput): boolean;
	isOpen(editor: IEditorInput | IResourceEditorInput): boolean {
		if (editor instanceof EditorInput) {
			return this.editorGroupService.groups.some(group => group.isOpened(editor));
		}

		if (editor.resource) {
			return this.editorsObserver.hasEditor(this.asCanonicalEditorResource(editor.resource));
		}

		return false;
	}

	//#endregion

	//#region replaceEditors()

	async replaceEditors(editors: IResourceEditorReplacement[], group: IEditorGroup | GroupIdentifier): Promise<void>;
	async replaceEditors(editors: IEditorReplacement[], group: IEditorGroup | GroupIdentifier): Promise<void>;
	async replaceEditors(editors: Array<IEditorReplacement | IResourceEditorReplacement>, group: IEditorGroup | GroupIdentifier): Promise<void> {
		const typedEditors: IEditorReplacement[] = [];

		editors.forEach(replaceEditorArg => {
			if (replaceEditorArg.editor instanceof EditorInput) {
				const replacementArg = replaceEditorArg as IEditorReplacement;

				typedEditors.push({
					editor: replacementArg.editor,
					replacement: replacementArg.replacement,
					options: this.toOptions(replacementArg.options)
				});
			} else {
				const replacementArg = replaceEditorArg as IResourceEditorReplacement;

				typedEditors.push({
					editor: this.createEditorInput(replacementArg.editor),
					replacement: this.createEditorInput(replacementArg.replacement),
					options: this.toOptions(replacementArg.replacement.options)
				});
			}
		});

		const targetGroup = typeof group === 'number' ? this.editorGroupService.getGroup(group) : group;
		if (targetGroup) {
			return targetGroup.replaceEditors(typedEditors);
		}
	}

	//#endregion

	//#region createEditorInput()

	private readonly editorInputCache = new ResourceMap<CachedEditorInput>();

	createEditorInput(input: IEditorInputWithOptions | IEditorInput | IResourceEditorInputType): EditorInput {

		// Typed Editor Input Support (EditorInput)
		if (input instanceof EditorInput) {
			return input;
		}

		// Typed Editor Input Support (IEditorInputWithOptions)
		const editorInputWithOptions = input as IEditorInputWithOptions;
		if (editorInputWithOptions.editor instanceof EditorInput) {
			return editorInputWithOptions.editor;
		}

		// Diff Editor Support
		const resourceDiffInput = input as IResourceDiffEditorInput;
		if (resourceDiffInput.leftResource && resourceDiffInput.rightResource) {
			const leftInput = this.createEditorInput({ resource: resourceDiffInput.leftResource, forceFile: resourceDiffInput.forceFile });
			const rightInput = this.createEditorInput({ resource: resourceDiffInput.rightResource, forceFile: resourceDiffInput.forceFile });

			return this.instantiationService.createInstance(DiffEditorInput,
				resourceDiffInput.label,
				resourceDiffInput.description,
				leftInput,
				rightInput,
				undefined
			);
		}

		// Untitled file support
		const untitledInput = input as IUntitledTextResourceEditorInput;
		if (untitledInput.forceUntitled || !untitledInput.resource || (untitledInput.resource && untitledInput.resource.scheme === Schemas.untitled)) {
			const untitledOptions = {
				mode: untitledInput.mode,
				initialValue: untitledInput.contents,
				encoding: untitledInput.encoding
			};

			// Untitled resource: use as hint for an existing untitled editor
			let untitledModel: IUntitledTextEditorModel;
			if (untitledInput.resource?.scheme === Schemas.untitled) {
				untitledModel = this.untitledTextEditorService.create({ untitledResource: untitledInput.resource, ...untitledOptions });
			}

			// Other resource: use as hint for associated filepath
			else {
				untitledModel = this.untitledTextEditorService.create({ associatedResource: untitledInput.resource, ...untitledOptions });
			}

			return this.createOrGetCached(untitledModel.resource, () => {

				// Factory function for new untitled editor
				const input = this.instantiationService.createInstance(UntitledTextEditorInput, untitledModel);

				// We dispose the untitled model once the editor
				// is being disposed. Even though we may have not
				// created the model initially, the lifecycle for
				// untitled is tightly coupled with the editor
				// lifecycle for now.
				Event.once(input.onDispose)(() => untitledModel.dispose());

				return input;
			}) as EditorInput;
		}

		// Resource Editor Support
		const resourceEditorInput = input as IResourceEditorInput;
		if (resourceEditorInput.resource instanceof URI) {

			// Derive the label from the path if not provided explicitly
			const label = resourceEditorInput.label || basename(resourceEditorInput.resource);

			// We keep track of the preferred resource this input is to be created
			// with but it may be different from the canonical resource (see below)
			const preferredResource = resourceEditorInput.resource;

			// From this moment on, only operate on the canonical resource
			// to ensure we reduce the chance of opening the same resource
			// with different resource forms (e.g. path casing on Windows)
			const canonicalResource = this.asCanonicalEditorResource(preferredResource);

			return this.createOrGetCached(canonicalResource, () => {

				// File
				if (resourceEditorInput.forceFile || this.fileService.canHandleResource(canonicalResource)) {
					return this.fileEditorInputFactory.createFileEditorInput(canonicalResource, preferredResource, resourceEditorInput.label, resourceEditorInput.description, resourceEditorInput.encoding, resourceEditorInput.mode, this.instantiationService);
				}

				// Resource
				return this.instantiationService.createInstance(ResourceEditorInput, canonicalResource, resourceEditorInput.label, resourceEditorInput.description, resourceEditorInput.mode);
			}, cachedInput => {

				// Untitled
				if (cachedInput instanceof UntitledTextEditorInput) {
					return;
				}

				// Files
				else if (!(cachedInput instanceof ResourceEditorInput)) {
					cachedInput.setPreferredResource(preferredResource);

					if (resourceEditorInput.label) {
						cachedInput.setPreferredName(resourceEditorInput.label);
					}

					if (resourceEditorInput.description) {
						cachedInput.setPreferredDescription(resourceEditorInput.description);
					}

					if (resourceEditorInput.encoding) {
						cachedInput.setPreferredEncoding(resourceEditorInput.encoding);
					}

					if (resourceEditorInput.mode) {
						cachedInput.setPreferredMode(resourceEditorInput.mode);
					}
				}

				// Resources
				else {
					if (label) {
						cachedInput.setName(label);
					}

					if (resourceEditorInput.description) {
						cachedInput.setDescription(resourceEditorInput.description);
					}

					if (resourceEditorInput.mode) {
						cachedInput.setPreferredMode(resourceEditorInput.mode);
					}
				}
			}) as EditorInput;
		}

		throw new Error('Unknown input type');
	}

	private _modelService: IModelService | undefined = undefined;
	private get modelService(): IModelService | undefined {
		if (!this._modelService) {
			this._modelService = this.instantiationService.invokeFunction(accessor => accessor.get(IModelService));
		}

		return this._modelService;
	}

	private asCanonicalEditorResource(resource: URI): URI {
		const canonicalResource: URI = this.uriIdentityService.asCanonicalUri(resource);

		// In the unlikely case that a model exists for the original resource but
		// differs from the canonical resource, we print a warning as this means
		// the model will not be able to be opened as editor.
		if (!isEqual(resource, canonicalResource) && this.modelService?.getModel(resource)) {
			this.logService.warn(`EditorService: a model exists for a resource that is not canonical: ${resource.toString(true)}`);
		}

		return canonicalResource;
	}

	private createOrGetCached(resource: URI, factoryFn: () => CachedEditorInput, cachedFn?: (input: CachedEditorInput) => void): CachedEditorInput {

		// Return early if already cached
		let input = this.editorInputCache.get(resource);
		if (input) {
			if (cachedFn) {
				cachedFn(input);
			}

			return input;
		}

		// Otherwise create and add to cache
		input = factoryFn();
		this.editorInputCache.set(resource, input);
		Event.once(input.onDispose)(() => this.editorInputCache.delete(resource));

		return input;
	}

	//#endregion

	//#region save/revert

	async save(editors: IEditorIdentifier | IEditorIdentifier[], options?: ISaveEditorsOptions): Promise<boolean> {

		// Convert to array
		if (!Array.isArray(editors)) {
			editors = [editors];
		}

		// Make sure to not save the same editor multiple times
		// by using the `matches()` method to find duplicates
		const uniqueEditors = this.getUniqueEditors(editors);

		// Split editors up into a bucket that is saved in parallel
		// and sequentially. Unless "Save As", all non-untitled editors
		// can be saved in parallel to speed up the operation. Remaining
		// editors are potentially bringing up some UI and thus run
		// sequentially.
		const editorsToSaveParallel: IEditorIdentifier[] = [];
		const editorsToSaveSequentially: IEditorIdentifier[] = [];
		if (options?.saveAs) {
			editorsToSaveSequentially.push(...uniqueEditors);
		} else {
			for (const { groupId, editor } of uniqueEditors) {
				if (editor.isUntitled()) {
					editorsToSaveSequentially.push({ groupId, editor });
				} else {
					editorsToSaveParallel.push({ groupId, editor });
				}
			}
		}

		// Editors to save in parallel
		const saveResults = await Promise.all(editorsToSaveParallel.map(({ groupId, editor }) => {

			// Use save as a hint to pin the editor if used explicitly
			if (options?.reason === SaveReason.EXPLICIT) {
				this.editorGroupService.getGroup(groupId)?.pinEditor(editor);
			}

			// Save
			return editor.save(groupId, options);
		}));

		// Editors to save sequentially
		for (const { groupId, editor } of editorsToSaveSequentially) {
			if (editor.isDisposed()) {
				continue; // might have been disposed from the save already
			}

			// Preserve view state by opening the editor first if the editor
			// is untitled or we "Save As". This also allows the user to review
			// the contents of the editor before making a decision.
			let viewState: IEditorViewState | undefined = undefined;
			const editorPane = await this.openEditor(editor, undefined, groupId);
			if (isTextEditorPane(editorPane)) {
				viewState = editorPane.getViewState();
			}

			const result = options?.saveAs ? await editor.saveAs(groupId, options) : await editor.save(groupId, options);
			saveResults.push(result);

			if (!result) {
				break; // failed or cancelled, abort
			}

			// Replace editor preserving viewstate (either across all groups or
			// only selected group) if the resulting editor is different from the
			// current one.
			if (!result.matches(editor)) {
				const targetGroups = editor.isUntitled() ? this.editorGroupService.groups.map(group => group.id) /* untitled replaces across all groups */ : [groupId];
				for (const group of targetGroups) {
					await this.replaceEditors([{ editor, replacement: result, options: { pinned: true, viewState } }], group);
				}
			}
		}

		return saveResults.every(result => !!result);
	}

	saveAll(options?: ISaveAllEditorsOptions): Promise<boolean> {
		return this.save(this.getAllDirtyEditors(options), options);
	}

	async revert(editors: IEditorIdentifier | IEditorIdentifier[], options?: IRevertOptions): Promise<boolean> {

		// Convert to array
		if (!Array.isArray(editors)) {
			editors = [editors];
		}

		// Make sure to not revert the same editor multiple times
		// by using the `matches()` method to find duplicates
		const uniqueEditors = this.getUniqueEditors(editors);

		await Promise.all(uniqueEditors.map(async ({ groupId, editor }) => {

			// Use revert as a hint to pin the editor
			this.editorGroupService.getGroup(groupId)?.pinEditor(editor);

			return editor.revert(groupId, options);
		}));

		return !uniqueEditors.some(({ editor }) => editor.isDirty());
	}

	async revertAll(options?: IRevertAllEditorsOptions): Promise<boolean> {
		return this.revert(this.getAllDirtyEditors(options), options);
	}

	private getAllDirtyEditors(options?: IBaseSaveRevertAllEditorOptions): IEditorIdentifier[] {
		const editors: IEditorIdentifier[] = [];

		for (const group of this.editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
			for (const editor of group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
				if (!editor.isDirty()) {
					continue;
				}

				if (!options?.includeUntitled && editor.isUntitled()) {
					continue;
				}

				if (options?.excludeSticky && group.isSticky(editor)) {
					continue;
				}

				editors.push({ groupId: group.id, editor });
			}
		}

		return editors;
	}

	private getUniqueEditors(editors: IEditorIdentifier[]): IEditorIdentifier[] {
		const uniqueEditors: IEditorIdentifier[] = [];
		for (const { editor, groupId } of editors) {
			if (uniqueEditors.some(uniqueEditor => uniqueEditor.editor.matches(editor))) {
				continue;
			}

			uniqueEditors.push({ editor, groupId });
		}

		return uniqueEditors;
	}

	//#endregion

	//#region Custom View Type

	private readonly customEditorViewTypesHandlers = new Map<string, ICustomEditorViewTypesHandler>();

	registerCustomEditorViewTypesHandler(source: string, handler: ICustomEditorViewTypesHandler): IDisposable {
		if (this.customEditorViewTypesHandlers.has(source)) {
			throw new Error(`Use a different name for the custom editor component, ${source} is already occupied.`);
		}

		this.customEditorViewTypesHandlers.set(source, handler);
		this.updateSchema();

		const viewTypeChangeEvent = handler.onDidChangeViewTypes(() => {
			this.updateSchema();
		});

		return {
			dispose: () => {
				viewTypeChangeEvent.dispose();
				this.customEditorViewTypesHandlers.delete(source);
				this.updateSchema();
			}
		};
	}

	private updateSchema() {
		const enumValues: string[] = [];
		const enumDescriptions: string[] = [];

		const infos: ICustomEditorInfo[] = [DEFAULT_CUSTOM_EDITOR];

		for (const [, handler] of this.customEditorViewTypesHandlers) {
			infos.push(...handler.getViewTypes());
		}

		infos.forEach(info => {
			enumValues.push(info.id);
			enumDescriptions.push(nls.localize('editorAssociations.viewType.sourceDescription', "Source: {0}", info.providerDisplayName));
		});

		updateViewTypeSchema(enumValues, enumDescriptions);
	}

	//#endregion

	//#region Editor Tracking

	whenClosed(editors: IResourceEditorInput[], options?: { waitForSaved: boolean }): Promise<void> {
		let remainingEditors = [...editors];

		return new Promise(resolve => {
			const listener = this.onDidCloseEditor(async event => {
				const primaryResource = EditorResourceAccessor.getOriginalUri(event.editor, { supportSideBySide: SideBySideEditor.PRIMARY });
				const secondaryResource = EditorResourceAccessor.getOriginalUri(event.editor, { supportSideBySide: SideBySideEditor.SECONDARY });

				// Remove from resources to wait for being closed based on the
				// resources from editors that got closed
				remainingEditors = remainingEditors.filter(({ resource }) => {
					if (this.uriIdentityService.extUri.isEqual(resource, primaryResource) || this.uriIdentityService.extUri.isEqual(resource, secondaryResource)) {
						return false; // remove - the closing editor matches this resource
					}

					return true; // keep - not yet closed
				});

				// All resources to wait for being closed are closed
				if (remainingEditors.length === 0) {
					if (options?.waitForSaved) {
						// If auto save is configured with the default delay (1s) it is possible
						// to close the editor while the save still continues in the background. As such
						// we have to also check if the editors to track for are dirty and if so wait
						// for them to get saved.
						const dirtyResources = editors.filter(({ resource }) => this.workingCopyService.isDirty(resource)).map(({ resource }) => resource);
						if (dirtyResources.length > 0) {
							await Promise.all(dirtyResources.map(async resource => await this.whenSaved(resource)));
						}
					}

					listener.dispose();

					resolve();
				}
			});
		});
	}

	private whenSaved(resource: URI): Promise<void> {
		return new Promise(resolve => {
			if (!this.workingCopyService.isDirty(resource)) {
				return resolve(); // return early if resource is not dirty
			}

			// Otherwise resolve promise when resource is saved
			const listener = this.workingCopyService.onDidChangeDirty(workingCopy => {
				if (!workingCopy.isDirty() && this.uriIdentityService.extUri.isEqual(resource, workingCopy.resource)) {
					listener.dispose();

					resolve();
				}
			});
		});
	}

	//#endregion

	dispose(): void {
		super.dispose();

		// Dispose remaining watchers if any
		this.activeOutOfWorkspaceWatchers.forEach(disposable => dispose(disposable));
		this.activeOutOfWorkspaceWatchers.clear();
	}
}

export interface IEditorOpenHandler {
	(
		delegate: (group: IEditorGroup, editor: IEditorInput, options?: IEditorOptions) => Promise<IEditorPane | null>,
		group: IEditorGroup,
		editor: IEditorInput,
		options?: IEditorOptions | ITextEditorOptions
	): Promise<IEditorPane | null>;
}

/**
 * The delegating workbench editor service can be used to override the behaviour of the openEditor()
 * method by providing a IEditorOpenHandler. All calls are being delegated to the existing editor
 * service otherwise.
 */
export class DelegatingEditorService implements IEditorService {

	declare readonly _serviceBrand: undefined;

	constructor(
		private editorOpenHandler: IEditorOpenHandler,
		@IEditorService private editorService: EditorService
	) { }

	openEditor(editor: IEditorInput, options?: IEditorOptions | ITextEditorOptions, group?: OpenInEditorGroup): Promise<IEditorPane | undefined>;
	openEditor(editor: IResourceEditorInput | IUntitledTextResourceEditorInput, group?: OpenInEditorGroup): Promise<ITextEditorPane | undefined>;
	openEditor(editor: IResourceDiffEditorInput, group?: OpenInEditorGroup): Promise<ITextDiffEditorPane | undefined>;
	async openEditor(editor: IEditorInput | IResourceEditorInputType, optionsOrGroup?: IEditorOptions | ITextEditorOptions | OpenInEditorGroup, group?: OpenInEditorGroup): Promise<IEditorPane | undefined> {
		const result = this.editorService.doResolveEditorOpenRequest(editor, optionsOrGroup, group);
		if (result) {
			const [resolvedGroup, resolvedEditor, resolvedOptions] = result;

			// Pass on to editor open handler
			const editorPane = await this.editorOpenHandler(
				(group: IEditorGroup, editor: IEditorInput, options?: IEditorOptions) => group.openEditor(editor, options),
				resolvedGroup,
				resolvedEditor,
				resolvedOptions
			);

			if (editorPane) {
				return editorPane; // the opening was handled, so return early
			}

			return withNullAsUndefined(await resolvedGroup.openEditor(resolvedEditor, resolvedOptions));
		}

		return undefined;
	}

	//#region Delegate to IEditorService

	get onDidActiveEditorChange(): Event<void> { return this.editorService.onDidActiveEditorChange; }
	get onDidVisibleEditorsChange(): Event<void> { return this.editorService.onDidVisibleEditorsChange; }
	get onDidCloseEditor(): Event<IEditorCloseEvent> { return this.editorService.onDidCloseEditor; }

	get activeEditor(): IEditorInput | undefined { return this.editorService.activeEditor; }
	get activeEditorPane(): IVisibleEditorPane | undefined { return this.editorService.activeEditorPane; }
	get activeTextEditorControl(): ICodeEditor | IDiffEditor | undefined { return this.editorService.activeTextEditorControl; }
	get activeTextEditorMode(): string | undefined { return this.editorService.activeTextEditorMode; }
	get visibleEditors(): ReadonlyArray<IEditorInput> { return this.editorService.visibleEditors; }
	get visibleEditorPanes(): ReadonlyArray<IVisibleEditorPane> { return this.editorService.visibleEditorPanes; }
	get visibleTextEditorControls(): ReadonlyArray<ICodeEditor | IDiffEditor> { return this.editorService.visibleTextEditorControls; }
	get editors(): ReadonlyArray<IEditorInput> { return this.editorService.editors; }
	get count(): number { return this.editorService.count; }

	getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }): ReadonlyArray<IEditorIdentifier> { return this.editorService.getEditors(order, options); }

	openEditors(editors: IEditorInputWithOptions[], group?: OpenInEditorGroup): Promise<IEditorPane[]>;
	openEditors(editors: IResourceEditorInputType[], group?: OpenInEditorGroup): Promise<IEditorPane[]>;
	openEditors(editors: Array<IEditorInputWithOptions | IResourceEditorInputType>, group?: OpenInEditorGroup): Promise<IEditorPane[]> {
		return this.editorService.openEditors(editors, group);
	}

	replaceEditors(editors: IResourceEditorReplacement[], group: IEditorGroup | GroupIdentifier): Promise<void>;
	replaceEditors(editors: IEditorReplacement[], group: IEditorGroup | GroupIdentifier): Promise<void>;
	replaceEditors(editors: Array<IEditorReplacement | IResourceEditorReplacement>, group: IEditorGroup | GroupIdentifier): Promise<void> {
		return this.editorService.replaceEditors(editors as IResourceEditorReplacement[] /* TS fail */, group);
	}

	isOpen(editor: IEditorInput): boolean;
	isOpen(editor: IResourceEditorInput): boolean;
	isOpen(editor: IEditorInput | IResourceEditorInput): boolean { return this.editorService.isOpen(editor as IResourceEditorInput /* TS fail */); }

	overrideOpenEditor(handler: IOpenEditorOverrideHandler): IDisposable { return this.editorService.overrideOpenEditor(handler); }
	getEditorOverrides(resource: URI, options: IEditorOptions | undefined, group: IEditorGroup | undefined) { return this.editorService.getEditorOverrides(resource, options, group); }

	createEditorInput(input: IResourceEditorInputType): IEditorInput { return this.editorService.createEditorInput(input); }

	save(editors: IEditorIdentifier | IEditorIdentifier[], options?: ISaveEditorsOptions): Promise<boolean> { return this.editorService.save(editors, options); }
	saveAll(options?: ISaveAllEditorsOptions): Promise<boolean> { return this.editorService.saveAll(options); }

	revert(editors: IEditorIdentifier | IEditorIdentifier[], options?: IRevertOptions): Promise<boolean> { return this.editorService.revert(editors, options); }
	revertAll(options?: IRevertAllEditorsOptions): Promise<boolean> { return this.editorService.revertAll(options); }

	registerCustomEditorViewTypesHandler(source: string, handler: ICustomEditorViewTypesHandler): IDisposable { return this.editorService.registerCustomEditorViewTypesHandler(source, handler); }

	whenClosed(editors: IResourceEditorInput[]): Promise<void> { return this.editorService.whenClosed(editors); }

	//#endregion
}

registerSingleton(IEditorService, EditorService);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
	.registerConfiguration(editorAssociationsConfigurationNode);
