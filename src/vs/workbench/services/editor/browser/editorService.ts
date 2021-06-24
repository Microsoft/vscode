/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IResourceEditorInput, IEditorOptions, EditorActivation, EditorOverride, IResourceEditorInputIdentifier, ITextEditorOptions, ITextResourceEditorInput, isResourceEditorInput } from 'vs/platform/editor/common/editor';
import { SideBySideEditor, IEditorInput, IEditorPane, GroupIdentifier, IFileEditorInput, IUntitledTextResourceEditorInput, IResourceDiffEditorInput, IEditorInputFactoryRegistry, EditorExtensions, IEditorInputWithOptions, isEditorInputWithOptions, IEditorIdentifier, IEditorCloseEvent, ITextEditorPane, ITextDiffEditorPane, IRevertOptions, SaveReason, EditorsOrder, isTextEditorPane, IWorkbenchEditorConfiguration, EditorResourceAccessor, IVisibleEditorPane, IEditorInputWithOptionsAndGroup, EditorInputCapabilities, isResourceDiffEditorInput, IUntypedEditorInput, DEFAULT_EDITOR_ASSOCIATION } from 'vs/workbench/common/editor';
import { EditorInput, isEditorInput } from 'vs/workbench/common/editor/editorInput';
import { SideBySideEditorInput } from 'vs/workbench/common/editor/sideBySideEditorInput';
import { TextResourceEditorInput } from 'vs/workbench/common/editor/textResourceEditorInput';
import { Registry } from 'vs/platform/registry/common/platform';
import { ResourceMap } from 'vs/base/common/map';
import { IUntitledTextEditorService } from 'vs/workbench/services/untitled/common/untitledTextEditorService';
import { IFileService, FileOperationEvent, FileOperation, FileChangesEvent, FileChangeType } from 'vs/platform/files/common/files';
import { Schemas } from 'vs/base/common/network';
import { Event, Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { basename, joinPath } from 'vs/base/common/resources';
import { DiffEditorInput } from 'vs/workbench/common/editor/diffEditorInput';
import { IEditorGroupsService, IEditorGroup, GroupsOrder, IEditorReplacement, GroupChangeKind, preferredSideBySideGroupDirection } from 'vs/workbench/services/editor/common/editorGroupsService';
import { SIDE_GROUP, IResourceEditorReplacement, IEditorService, SIDE_GROUP_TYPE, ACTIVE_GROUP_TYPE, ISaveEditorsOptions, ISaveAllEditorsOptions, IRevertAllEditorsOptions, IBaseSaveRevertAllEditorOptions, IOpenEditorsOptions } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { Disposable, IDisposable, dispose, DisposableStore } from 'vs/base/common/lifecycle';
import { coalesce, distinct } from 'vs/base/common/arrays';
import { isCodeEditor, isDiffEditor, ICodeEditor, IDiffEditor, isCompositeEditor } from 'vs/editor/browser/editorBrowser';
import { IEditorGroupView, EditorServiceImpl } from 'vs/workbench/browser/parts/editor/editor';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { isUndefined, withNullAsUndefined } from 'vs/base/common/types';
import { EditorsObserver } from 'vs/workbench/browser/parts/editor/editorsObserver';
import { IUntitledTextEditorModel } from 'vs/workbench/services/untitled/common/untitledTextEditorModel';
import { UntitledTextEditorInput } from 'vs/workbench/services/untitled/common/untitledTextEditorInput';
import { Promises, timeout } from 'vs/base/common/async';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { indexOfPath } from 'vs/base/common/extpath';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { RegisteredEditorPriority, IEditorOverrideService, OverrideStatus } from 'vs/workbench/services/editor/common/editorOverrideService';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IWorkspaceTrustRequestService, WorkspaceTrustUriResponse } from 'vs/platform/workspace/common/workspaceTrust';
import { IHostService } from 'vs/workbench/services/host/browser/host';

type CachedEditorInput = TextResourceEditorInput | IFileEditorInput | UntitledTextEditorInput;
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
		@IUriIdentityService private readonly uriIdentityService: IUriIdentityService,
		@IEditorOverrideService private readonly editorOverrideService: IEditorOverrideService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService,
		@IWorkspaceTrustRequestService private readonly workspaceTrustRequestService: IWorkspaceTrustRequestService,
		@IHostService private readonly hostService: IHostService,
	) {
		super();

		this.onConfigurationUpdated(configurationService.getValue<IWorkbenchEditorConfiguration>());

		this.registerListeners();

		// Register the default editor to the override service
		// so that it shows up in the editors picker
		this.registerDefaultOverride();
	}

	private registerListeners(): void {

		// Editor & group changes
		this.editorGroupService.whenReady.then(() => this.onEditorGroupsReady());
		this.editorGroupService.onDidChangeActiveGroup(group => this.handleActiveEditorChange(group));
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

	private registerDefaultOverride(): void {
		this._register(this.editorOverrideService.registerEditor(
			'*',
			{
				id: DEFAULT_EDITOR_ASSOCIATION.id,
				label: DEFAULT_EDITOR_ASSOCIATION.displayName,
				detail: DEFAULT_EDITOR_ASSOCIATION.providerDisplayName,
				priority: RegisteredEditorPriority.builtin
			},
			{},
			(resource, options) => ({ editor: this.createEditorInput({ resource, options }) }),
			diffEditor => ({ editor: this.createEditorInput(diffEditor) })
		));
	}

	//#region Editor & group event handlers

	private lastActiveEditor: IEditorInput | undefined = undefined;

	private onEditorGroupsReady(): void {

		// Register listeners to each opened group
		for (const group of this.editorGroupService.groups) {
			this.registerGroupListeners(group as IEditorGroupView);
		}

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
		for (const resource of this.activeOutOfWorkspaceWatchers.keys()) {
			if (!visibleOutOfWorkspaceResources.get(resource)) {
				dispose(this.activeOutOfWorkspaceWatchers.get(resource));
				this.activeOutOfWorkspaceWatchers.delete(resource);
			}
		}

		// Handle newly visible out of workspace resources
		for (const resource of visibleOutOfWorkspaceResources.keys()) {
			if (!this.activeOutOfWorkspaceWatchers.get(resource)) {
				const disposable = this.fileService.watch(resource);
				this.activeOutOfWorkspaceWatchers.set(resource, disposable);
			}
		}
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
					const index = indexOfPath(resource.path, source.path, this.uriIdentityService.extUri.ignorePathCasing(resource));
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
				if (isEditorInput(moveResult.editor)) {
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
				// - we close any editor when `closeOnFileDelete: true`
				// - we close any editor when the delete occurred from within VSCode
				// - we close any editor without resolved working copy assuming that
				//   this editor could not be opened after the file is gone
				if (this.closeOnFileDelete || !isExternal || !this.workingCopyService.has(resource)) {

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
			if (editor.hasCapability(EditorInputCapabilities.Untitled) && !options.includeUntitled) {
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

	getEditors(order: EditorsOrder, options?: { excludeSticky?: boolean }): readonly IEditorIdentifier[] {
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

				for (const group of this.editorGroupService.getGroups(GroupsOrder.GRID_APPEARANCE)) {
					editors.push(...group.getEditors(EditorsOrder.SEQUENTIAL, options).map(editor => ({ editor, groupId: group.id })));
				}

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

	//#region openEditor()

	openEditor(editor: IEditorInput, options?: IEditorOptions, group?: OpenInEditorGroup): Promise<IEditorPane | undefined>;
	openEditor(editor: IResourceEditorInput | IUntitledTextResourceEditorInput, group?: OpenInEditorGroup): Promise<ITextEditorPane | undefined>;
	openEditor(editor: IResourceDiffEditorInput, group?: OpenInEditorGroup): Promise<ITextDiffEditorPane | undefined>;
	async openEditor(editor: IEditorInput | IUntypedEditorInput, optionsOrGroup?: IEditorOptions | OpenInEditorGroup, group?: OpenInEditorGroup): Promise<IEditorPane | undefined> {
		const result = this.doResolveEditorOpenRequest(editor, optionsOrGroup, group);
		if (result) {
			const [resolvedGroup, resolvedEditor, resolvedOptions] = result;

			// Override handling: request override from override service
			if (resolvedOptions?.override !== EditorOverride.DISABLED) {
				const overrideResult = await this.editorOverrideService.resolveEditorOverride(resolvedEditor, resolvedOptions, resolvedGroup);
				if (overrideResult === OverrideStatus.ABORT) {
					return;
				} else if (overrideResult === OverrideStatus.NONE) {
					return resolvedGroup.openEditor(resolvedEditor, resolvedOptions);
				}
				if (overrideResult) {
					return (overrideResult.group ?? resolvedGroup).openEditor(
						overrideResult.editor,
						overrideResult.options ?? resolvedOptions
					);
				}
			}

			// Override handling: disabled or no override found
			return resolvedGroup.openEditor(resolvedEditor, resolvedOptions);
		}

		return undefined;
	}

	private doResolveEditorOpenRequest(editor: IEditorInput | IUntypedEditorInput, optionsOrGroup?: IEditorOptions | OpenInEditorGroup, group?: OpenInEditorGroup): [IEditorGroup, EditorInput, IEditorOptions | undefined] | undefined {
		let resolvedGroup: IEditorGroup | undefined;
		let candidateGroup: OpenInEditorGroup | undefined;

		let typedEditor: EditorInput | undefined;
		let options: IEditorOptions | undefined;

		// Typed Editor Support
		if (editor instanceof EditorInput) {
			typedEditor = editor;
			options = optionsOrGroup as IEditorOptions;

			candidateGroup = group;
			resolvedGroup = this.findTargetGroup(typedEditor, options, candidateGroup);
		}

		// Untyped Text Editor Support
		else {
			const textInput = editor as IUntypedEditorInput;
			typedEditor = this.createEditorInput(textInput);
			if (typedEditor) {
				options = textInput.options;

				candidateGroup = optionsOrGroup as OpenInEditorGroup;
				resolvedGroup = this.findTargetGroup(typedEditor, options, candidateGroup);
			}
		}

		if (typedEditor && resolvedGroup) {
			if (
				this.editorGroupService.activeGroup !== resolvedGroup && 	// only if target group is not already active
				options && !options.inactive &&								// never for inactive editors
				options.preserveFocus &&									// only if preserveFocus
				typeof options.activation !== 'number' &&					// only if activation is not already defined (either true or false)
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
				options.activation = EditorActivation.ACTIVATE;
			}

			return [resolvedGroup, typedEditor, options];
		}

		return undefined;
	}

	private findTargetGroup(editor: IEditorInput | IUntypedEditorInput, options?: IEditorOptions, group?: OpenInEditorGroup): IEditorGroup {
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
					if (group.isActive(editor)) {
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
						if (group.contains(editor)) {
							if (!groupWithInputOpened) {
								groupWithInputOpened = group;
							}

							if (!groupWithInputActive && group.isActive(editor)) {
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

	//#endregion

	//#region openEditors()

	openEditors(editors: IEditorInputWithOptions[], group?: OpenInEditorGroup, options?: IOpenEditorsOptions): Promise<IEditorPane[]>;
	openEditors(editors: IUntypedEditorInput[], group?: OpenInEditorGroup, options?: IOpenEditorsOptions): Promise<IEditorPane[]>;
	async openEditors(editors: Array<IEditorInputWithOptions | IUntypedEditorInput>, group?: OpenInEditorGroup, options?: IOpenEditorsOptions): Promise<IEditorPane[]> {

		// Pass all editors to trust service to determine if
		// we should proceed with opening the editors if we
		// are asked to validate trust.
		if (options?.validateTrust) {
			const editorsTrusted = await this.handleWorkspaceTrust(editors);
			if (!editorsTrusted) {
				return [];
			}
		}

		// Convert to typed editors and options
		let typedEditors: IEditorInputWithOptions[] = editors.map(editor => {
			if (isEditorInputWithOptions(editor)) {
				return editor;
			}

			return {
				editor: this.createEditorInput(editor),
				options: editor.options
			};
		});

		// Find target groups to open
		const mapGroupToEditorsCandidates = new Map<IEditorGroup, IEditorInputWithOptions[]>();
		if (group === SIDE_GROUP) {
			// Custom editors which are open and only support one editor per resource should just move
			const singletonEditors = this.getEditors(EditorsOrder.SEQUENTIAL).filter(e => typedEditors.find(t => isEqual(e.editor.resource, t.editor.resource)) && !e.editor.canSplit());
			// We remove the singleton editors from the opening list
			typedEditors = typedEditors.filter(t => !singletonEditors.find(e => isEqual(e.editor.resource, t.editor.resource)));
			mapGroupToEditorsCandidates.set(this.findSideBySideGroup(), typedEditors);
			// Move the editors which are opened and can't be opened again to the side
			singletonEditors.forEach(e => this.editorGroupService.getGroup(e.groupId)?.moveEditor(e.editor, this.findSideBySideGroup()));
		} else {
			for (const typedEditor of typedEditors) {
				const targetGroup = this.findTargetGroup(typedEditor.editor, typedEditor.options, group);

				let targetGroupEditors = mapGroupToEditorsCandidates.get(targetGroup);
				if (!targetGroupEditors) {
					targetGroupEditors = [];
					mapGroupToEditorsCandidates.set(targetGroup, targetGroupEditors);
				}

				targetGroupEditors.push(typedEditor);
			}
		}

		// Resolve overrides
		const mapGroupToEditors = new Map<IEditorGroup, IEditorInputWithOptions[]>();
		for (const [group, editorsWithOptions] of mapGroupToEditorsCandidates) {
			for (const { editor, options } of editorsWithOptions) {
				let editorOverride: IEditorInputWithOptionsAndGroup | undefined;
				if (options?.override !== EditorOverride.DISABLED) {
					const overrideResult = await this.editorOverrideService.resolveEditorOverride(editor, options, group);
					if (overrideResult === OverrideStatus.ABORT) {
						continue;
					} else {
						editorOverride = overrideResult === OverrideStatus.NONE ? undefined : overrideResult;
					}
				}

				const targetGroup = editorOverride?.group ?? group;
				let targetGroupEditors = mapGroupToEditors.get(targetGroup);
				if (!targetGroupEditors) {
					targetGroupEditors = [];
					mapGroupToEditors.set(targetGroup, targetGroupEditors);
				}

				targetGroupEditors.push(editorOverride ?
					{ editor: editorOverride.editor, options: editorOverride.options } :
					{ editor, options }
				);
			}
		}

		// Open in target groups
		const result: Promise<IEditorPane | null>[] = [];
		for (const [group, editorsWithOptions] of mapGroupToEditors) {
			result.push(group.openEditors(editorsWithOptions));
		}

		return coalesce(await Promises.settled(result));
	}

	private async handleWorkspaceTrust(editors: Array<IEditorInputWithOptions | IUntypedEditorInput>): Promise<boolean> {
		const { resources, diffMode } = this.extractEditorResources(editors);

		const trustResult = await this.workspaceTrustRequestService.requestOpenFilesTrust(resources);
		switch (trustResult) {
			case WorkspaceTrustUriResponse.Open:
				return true;
			case WorkspaceTrustUriResponse.OpenInNewWindow:
				await this.hostService.openWindow(resources.map(resource => ({ fileUri: resource })), { forceNewWindow: true, diffMode });
				return false;
			case WorkspaceTrustUriResponse.Cancel:
				return false;
		}
	}

	private extractEditorResources(editors: Array<IEditorInputWithOptions | IUntypedEditorInput>): { resources: URI[], diffMode?: boolean } {
		const resources = new ResourceMap<boolean>();
		let diffMode = false;

		for (const editor of editors) {

			// Typed Editor
			if (isEditorInputWithOptions(editor)) {
				const resource = EditorResourceAccessor.getOriginalUri(editor.editor, { supportSideBySide: SideBySideEditor.BOTH });
				if (URI.isUri(resource)) {
					resources.set(resource, true);
				} else if (resource) {
					if (resource.primary) {
						resources.set(resource.primary, true);
					}

					if (resource.secondary) {
						resources.set(resource.secondary, true);
					}

					diffMode = editor.editor instanceof DiffEditorInput;
				}
			}

			// Untyped editor
			else {
				if (isResourceDiffEditorInput(editor)) {
					const originalResourceEditor = editor.originalInput;
					if (URI.isUri(originalResourceEditor.resource)) {
						resources.set(originalResourceEditor.resource, true);
					}

					const modifiedResourceEditor = editor.modifiedInput;
					if (URI.isUri(modifiedResourceEditor.resource)) {
						resources.set(modifiedResourceEditor.resource, true);
					}

					diffMode = true;
				}

				if (isResourceEditorInput(editor)) {
					resources.set(editor.resource, true);
				}
			}
		}

		return {
			resources: Array.from(resources.keys()),
			diffMode
		};
	}

	//#endregion

	//#region isOpened()

	isOpened(editor: IResourceEditorInputIdentifier): boolean {
		return this.editorsObserver.hasEditor({
			resource: this.uriIdentityService.asCanonicalUri(editor.resource),
			typeId: editor.typeId,
			editorId: editor.editorId
		});
	}

	//#endregion

	//#region isOpened()

	isVisible(editor: IEditorInput): boolean {
		for (const group of this.editorGroupService.groups) {
			if (group.activeEditor?.matches(editor)) {
				return true;
			}
		}

		return false;
	}

	//#endregion

	//#region findEditors()

	findEditors(resource: URI): readonly IEditorIdentifier[];
	findEditors(editor: IResourceEditorInputIdentifier): readonly IEditorIdentifier[];
	findEditors(resource: URI, group: IEditorGroup | GroupIdentifier): readonly IEditorInput[];
	findEditors(editor: IResourceEditorInputIdentifier, group: IEditorGroup | GroupIdentifier): IEditorInput | undefined;
	findEditors(arg1: URI | IResourceEditorInputIdentifier, arg2?: IEditorGroup | GroupIdentifier): readonly IEditorIdentifier[] | readonly IEditorInput[] | IEditorInput | undefined;
	findEditors(arg1: URI | IResourceEditorInputIdentifier, arg2?: IEditorGroup | GroupIdentifier): readonly IEditorIdentifier[] | readonly IEditorInput[] | IEditorInput | undefined {
		const resource = URI.isUri(arg1) ? arg1 : arg1.resource;
		const typeId = URI.isUri(arg1) ? undefined : arg1.typeId;

		// Do a quick check for the resource via the editor observer
		// which is a very efficient way to find an editor by resource
		if (!this.editorsObserver.hasEditors(resource)) {
			if (URI.isUri(arg1) || isUndefined(arg2)) {
				return [];
			}

			return undefined;
		}

		// Search only in specific group
		if (!isUndefined(arg2)) {
			const targetGroup = typeof arg2 === 'number' ? this.editorGroupService.getGroup(arg2) : arg2;

			// Resource provided: result is an array
			if (URI.isUri(arg1)) {
				if (!targetGroup) {
					return [];
				}

				return targetGroup.findEditors(resource);
			}

			// Editor identifier provided, result is single
			else {
				if (!targetGroup) {
					return undefined;
				}

				const editors = targetGroup.findEditors(resource);
				for (const editor of editors) {
					if (editor.typeId === typeId) {
						return editor;
					}
				}

				return undefined;
			}
		}

		// Search across all groups in MRU order
		else {
			const result: IEditorIdentifier[] = [];

			for (const group of this.editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE)) {
				const editors: IEditorInput[] = [];

				// Resource provided: result is an array
				if (URI.isUri(arg1)) {
					editors.push(...this.findEditors(arg1, group));
				}

				// Editor identifier provided, result is single
				else {
					const editor = this.findEditors(arg1, group);
					if (editor) {
						editors.push(editor);
					}
				}

				result.push(...editors.map(editor => ({ editor, groupId: group.id })));
			}

			return result;
		}
	}

	//#endregion

	//#region replaceEditors()

	async replaceEditors(editors: IResourceEditorReplacement[], group: IEditorGroup | GroupIdentifier): Promise<void>;
	async replaceEditors(editors: IEditorReplacement[], group: IEditorGroup | GroupIdentifier): Promise<void>;
	async replaceEditors(editors: Array<IEditorReplacement | IResourceEditorReplacement>, group: IEditorGroup | GroupIdentifier): Promise<void> {
		const typedEditors: IEditorReplacement[] = [];
		const targetGroup = typeof group === 'number' ? this.editorGroupService.getGroup(group) : group;

		for (const replaceEditorArg of editors) {
			if (replaceEditorArg.editor instanceof EditorInput) {
				const replacementArg = replaceEditorArg as IEditorReplacement;
				if (replacementArg.options?.override !== EditorOverride.DISABLED && targetGroup) {
					const override = await this.editorOverrideService.resolveEditorOverride(replacementArg.replacement, replacementArg.options, targetGroup);
					if (override === OverrideStatus.ABORT) {
						continue;
					} else if (override !== OverrideStatus.NONE) {
						replacementArg.options = override?.options ?? replacementArg.options;
						replacementArg.replacement = override?.editor ?? replacementArg.replacement;
					}
				}
				typedEditors.push({
					editor: replacementArg.editor,
					replacement: replacementArg.replacement,
					forceReplaceDirty: replacementArg.forceReplaceDirty,
					options: replacementArg.options
				});
			} else {
				const replacementArg = replaceEditorArg as IResourceEditorReplacement;

				typedEditors.push({
					editor: this.createEditorInput(replacementArg.editor),
					replacement: this.createEditorInput(replacementArg.replacement),
					options: replacementArg.replacement.options
				});
			}
		}

		if (targetGroup) {
			return targetGroup.replaceEditors(typedEditors);
		}
	}

	//#endregion

	//#region createEditorInput()

	private readonly editorInputCache = new ResourceMap<CachedEditorInput>();

	createEditorInput(input: IEditorInputWithOptions | IEditorInput | IUntypedEditorInput): EditorInput {

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
		if (isResourceDiffEditorInput(input)) {
			const originalInput = this.createEditorInput({ ...input.originalInput, forceFile: input.forceFile });
			const modifiedInput = this.createEditorInput({ ...input.modifiedInput, forceFile: input.forceFile });

			return this.instantiationService.createInstance(DiffEditorInput,
				input.label,
				input.description,
				originalInput,
				modifiedInput,
				undefined
			);
		}

		// Untitled file support
		const untitledInput = input as IUntitledTextResourceEditorInput;
		if (untitledInput.forceUntitled || !untitledInput.resource || (untitledInput.resource.scheme === Schemas.untitled)) {
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
				Event.once(input.onWillDispose)(() => untitledModel.dispose());

				return input;
			}) as EditorInput;
		}

		// Text Resource Editor Support
		const textResourceEditorInput = input as ITextResourceEditorInput;
		if (textResourceEditorInput.resource instanceof URI) {

			// Derive the label from the path if not provided explicitly
			const label = textResourceEditorInput.label || basename(textResourceEditorInput.resource);

			// We keep track of the preferred resource this input is to be created
			// with but it may be different from the canonical resource (see below)
			const preferredResource = textResourceEditorInput.resource;

			// From this moment on, only operate on the canonical resource
			// to ensure we reduce the chance of opening the same resource
			// with different resource forms (e.g. path casing on Windows)
			const canonicalResource = this.uriIdentityService.asCanonicalUri(preferredResource);

			return this.createOrGetCached(canonicalResource, () => {

				// File
				if (textResourceEditorInput.forceFile || this.fileService.canHandleResource(canonicalResource)) {
					return this.fileEditorInputFactory.createFileEditorInput(canonicalResource, preferredResource, textResourceEditorInput.label, textResourceEditorInput.description, textResourceEditorInput.encoding, textResourceEditorInput.mode, textResourceEditorInput.contents, this.instantiationService);
				}

				// Resource
				return this.instantiationService.createInstance(TextResourceEditorInput, canonicalResource, textResourceEditorInput.label, textResourceEditorInput.description, textResourceEditorInput.mode, textResourceEditorInput.contents);
			}, cachedInput => {

				// Untitled
				if (cachedInput instanceof UntitledTextEditorInput) {
					return;
				}

				// Files
				else if (!(cachedInput instanceof TextResourceEditorInput)) {
					cachedInput.setPreferredResource(preferredResource);

					if (textResourceEditorInput.label) {
						cachedInput.setPreferredName(textResourceEditorInput.label);
					}

					if (textResourceEditorInput.description) {
						cachedInput.setPreferredDescription(textResourceEditorInput.description);
					}

					if (textResourceEditorInput.encoding) {
						cachedInput.setPreferredEncoding(textResourceEditorInput.encoding);
					}

					if (textResourceEditorInput.mode) {
						cachedInput.setPreferredMode(textResourceEditorInput.mode);
					}

					if (typeof textResourceEditorInput.contents === 'string') {
						cachedInput.setPreferredContents(textResourceEditorInput.contents);
					}
				}

				// Resources
				else {
					if (label) {
						cachedInput.setName(label);
					}

					if (textResourceEditorInput.description) {
						cachedInput.setDescription(textResourceEditorInput.description);
					}

					if (textResourceEditorInput.mode) {
						cachedInput.setPreferredMode(textResourceEditorInput.mode);
					}

					if (typeof textResourceEditorInput.contents === 'string') {
						cachedInput.setPreferredContents(textResourceEditorInput.contents);
					}
				}
			}) as EditorInput;
		}

		throw new Error('Unknown input type');
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
		Event.once(input.onWillDispose)(() => this.editorInputCache.delete(resource));

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
				if (editor.hasCapability(EditorInputCapabilities.Untitled)) {
					editorsToSaveSequentially.push({ groupId, editor });
				} else {
					editorsToSaveParallel.push({ groupId, editor });
				}
			}
		}

		// Editors to save in parallel
		const saveResults = await Promises.settled(editorsToSaveParallel.map(({ groupId, editor }) => {

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
			const editorPane = await this.openEditor(editor, undefined, groupId);
			const editorOptions: ITextEditorOptions = {
				pinned: true,
				viewState: isTextEditorPane(editorPane) ? editorPane.getViewState() : undefined
			};

			const result = options?.saveAs ? await editor.saveAs(groupId, options) : await editor.save(groupId, options);
			saveResults.push(result);

			if (!result) {
				break; // failed or cancelled, abort
			}

			// Replace editor preserving viewstate (either across all groups or
			// only selected group) if the resulting editor is different from the
			// current one.
			if (!result.matches(editor)) {
				const targetGroups = editor.hasCapability(EditorInputCapabilities.Untitled) ? this.editorGroupService.groups.map(group => group.id) /* untitled replaces across all groups */ : [groupId];
				for (const group of targetGroups) {
					await this.replaceEditors([{ editor, replacement: result, options: editorOptions }], group);
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

		await Promises.settled(uniqueEditors.map(async ({ groupId, editor }) => {

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

				if (!options?.includeUntitled && editor.hasCapability(EditorInputCapabilities.Untitled)) {
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

	override dispose(): void {
		super.dispose();

		// Dispose remaining watchers if any
		this.activeOutOfWorkspaceWatchers.forEach(disposable => dispose(disposable));
		this.activeOutOfWorkspaceWatchers.clear();
	}
}

registerSingleton(IEditorService, EditorService);
