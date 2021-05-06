/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { EditorResourceAccessor, IEditorCommandsContext, SideBySideEditor, IEditorIdentifier, SaveReason, SideBySideEditorInput, EditorsOrder } from 'vs/workbench/common/editor';
import { IWindowOpenable, IOpenWindowOptions, isWorkspaceToOpen, IOpenEmptyWindowOptions } from 'vs/platform/windows/common/windows';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ServicesAccessor, IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ExplorerFocusCondition, TextFileContentProvider, VIEWLET_ID, ExplorerCompressedFocusContext, ExplorerCompressedFirstFocusContext, ExplorerCompressedLastFocusContext, FilesExplorerFocusCondition, ExplorerFolderContext } from 'vs/workbench/contrib/files/common/files';
import { ExplorerViewPaneContainer } from 'vs/workbench/contrib/files/browser/explorerViewlet';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { IListService } from 'vs/platform/list/browser/listService';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { RawContextKey, IContextKey, IContextKeyService, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IFileService } from 'vs/platform/files/common/files';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyMod, KeyCode, KeyChord } from 'vs/base/common/keyCodes';
import { isWindows } from 'vs/base/common/platform';
import { ITextModelService } from 'vs/editor/common/services/resolverService';
import { getResourceForCommand, getMultiSelectedResources, getOpenEditorsViewMultiSelection, IExplorerService } from 'vs/workbench/contrib/files/browser/files';
import { IWorkspaceEditingService } from 'vs/workbench/services/workspaces/common/workspaceEditing';
import { getMultiSelectedEditorContexts } from 'vs/workbench/browser/parts/editor/editorCommands';
import { Schemas } from 'vs/base/common/network';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { EditorContextKeys } from 'vs/editor/common/editorContextKeys';
import { IEditorService, SIDE_GROUP, ISaveEditorsOptions } from 'vs/workbench/services/editor/common/editorService';
import { IEditorGroupsService, GroupsOrder, IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ILabelService } from 'vs/platform/label/common/label';
import { basename, joinPath, isEqual } from 'vs/base/common/resources';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { UNTITLED_WORKSPACE_NAME } from 'vs/platform/workspaces/common/workspaces';
import { coalesce } from 'vs/base/common/arrays';
import { ICodeEditorService } from 'vs/editor/browser/services/codeEditorService';
import { EmbeddedCodeEditorWidget } from 'vs/editor/browser/widget/embeddedCodeEditorWidget';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { toAction } from 'vs/base/common/actions';
import { EditorOverride } from 'vs/platform/editor/common/editor';
import { hash } from 'vs/base/common/hash';

// Commands

export const REVEAL_IN_EXPLORER_COMMAND_ID = 'revealInExplorer';
export const REVERT_FILE_COMMAND_ID = 'workbench.action.files.revert';
export const OPEN_TO_SIDE_COMMAND_ID = 'explorer.openToSide';
export const OPEN_WITH_EXPLORER_COMMAND_ID = 'explorer.openWith';
export const SELECT_FOR_COMPARE_COMMAND_ID = 'selectForCompare';

export const COMPARE_SELECTED_COMMAND_ID = 'compareSelected';
export const COMPARE_RESOURCE_COMMAND_ID = 'compareFiles';
export const COMPARE_WITH_SAVED_COMMAND_ID = 'workbench.files.action.compareWithSaved';
export const COPY_PATH_COMMAND_ID = 'copyFilePath';
export const COPY_RELATIVE_PATH_COMMAND_ID = 'copyRelativeFilePath';

export const SAVE_FILE_AS_COMMAND_ID = 'workbench.action.files.saveAs';
export const SAVE_FILE_AS_LABEL = nls.localize('saveAs', "Save As...");
export const SAVE_FILE_COMMAND_ID = 'workbench.action.files.save';
export const SAVE_FILE_LABEL = nls.localize('save', "Save");
export const SAVE_FILE_WITHOUT_FORMATTING_COMMAND_ID = 'workbench.action.files.saveWithoutFormatting';
export const SAVE_FILE_WITHOUT_FORMATTING_LABEL = nls.localize('saveWithoutFormatting', "Save without Formatting");

export const SAVE_ALL_COMMAND_ID = 'saveAll';
export const SAVE_ALL_LABEL = nls.localize('saveAll', "Save All");

export const SAVE_ALL_IN_GROUP_COMMAND_ID = 'workbench.files.action.saveAllInGroup';

export const SAVE_FILES_COMMAND_ID = 'workbench.action.files.saveFiles';

export const OpenEditorsGroupContext = new RawContextKey<boolean>('groupFocusedInOpenEditors', false);
export const OpenEditorsDirtyEditorContext = new RawContextKey<boolean>('dirtyEditorFocusedInOpenEditors', false);
export const OpenEditorsReadonlyEditorContext = new RawContextKey<boolean>('readonlyEditorFocusedInOpenEditors', false);
export const ResourceSelectedForCompareContext = new RawContextKey<boolean>('resourceSelectedForCompare', false);

export const REMOVE_ROOT_FOLDER_COMMAND_ID = 'removeRootFolder';
export const REMOVE_ROOT_FOLDER_LABEL = nls.localize('removeFolderFromWorkspace', "Remove Folder from Workspace");

export const PREVIOUS_COMPRESSED_FOLDER = 'previousCompressedFolder';
export const NEXT_COMPRESSED_FOLDER = 'nextCompressedFolder';
export const FIRST_COMPRESSED_FOLDER = 'firstCompressedFolder';
export const LAST_COMPRESSED_FOLDER = 'lastCompressedFolder';
export const NEW_UNTITLED_FILE_COMMAND_ID = 'workbench.action.files.newUntitledFile';
export const NEW_UNTITLED_FILE_LABEL = nls.localize('newUntitledFile', "New Untitled File");

export const openWindowCommand = (accessor: ServicesAccessor, toOpen: IWindowOpenable[], options?: IOpenWindowOptions) => {
	if (Array.isArray(toOpen)) {
		const hostService = accessor.get(IHostService);
		const environmentService = accessor.get(IEnvironmentService);

		// rewrite untitled: workspace URIs to the absolute path on disk
		toOpen = toOpen.map(openable => {
			if (isWorkspaceToOpen(openable) && openable.workspaceUri.scheme === Schemas.untitled) {
				return {
					workspaceUri: joinPath(environmentService.untitledWorkspacesHome, openable.workspaceUri.path, UNTITLED_WORKSPACE_NAME)
				};
			}

			return openable;
		});

		hostService.openWindow(toOpen, options);
	}
};

export const newWindowCommand = (accessor: ServicesAccessor, options?: IOpenEmptyWindowOptions) => {
	const hostService = accessor.get(IHostService);
	hostService.openWindow(options);
};

// Command registration

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib,
	when: ExplorerFocusCondition,
	primary: KeyMod.CtrlCmd | KeyCode.Enter,
	mac: {
		primary: KeyMod.WinCtrl | KeyCode.Enter
	},
	id: OPEN_TO_SIDE_COMMAND_ID, handler: async (accessor, resource: URI | object) => {
		const editorService = accessor.get(IEditorService);
		const listService = accessor.get(IListService);
		const fileService = accessor.get(IFileService);
		const explorerService = accessor.get(IExplorerService);
		const resources = getMultiSelectedResources(resource, listService, editorService, explorerService);

		// Set side input
		if (resources.length) {
			const untitledResources = resources.filter(resource => resource.scheme === Schemas.untitled);
			const fileResources = resources.filter(resource => resource.scheme !== Schemas.untitled);

			const items = await Promise.all(fileResources.map(async resource => {
				const item = explorerService.findClosest(resource);
				if (item) {
					// Explorer already resolved the item, no need to go to the file service #109780
					return item;
				}

				return await fileService.resolve(resource);
			}));
			const files = items.filter(i => !i.isDirectory);
			const editors = files.map(f => ({
				resource: f.resource,
				options: { pinned: true }
			})).concat(...untitledResources.map(untitledResource => ({ resource: untitledResource, options: { pinned: true } })));

			await editorService.openEditors(editors, SIDE_GROUP);
		}
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib + 10,
	when: ContextKeyExpr.and(FilesExplorerFocusCondition, ExplorerFolderContext.toNegated()),
	primary: KeyCode.Enter,
	mac: {
		primary: KeyMod.CtrlCmd | KeyCode.DownArrow
	},
	id: 'explorer.openAndPassFocus', handler: async (accessor, _resource: URI | object) => {
		const editorService = accessor.get(IEditorService);
		const explorerService = accessor.get(IExplorerService);
		const resources = explorerService.getContext(true);

		if (resources.length) {
			await editorService.openEditors(resources.map(r => ({ resource: r.resource, options: { preserveFocus: false, pinned: true } })));
		}
	}
});

const COMPARE_WITH_SAVED_SCHEMA = 'showModifications';
let providerDisposables: IDisposable[] = [];
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: COMPARE_WITH_SAVED_COMMAND_ID,
	when: undefined,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_D),
	handler: async (accessor, resource: URI | object) => {
		const instantiationService = accessor.get(IInstantiationService);
		const textModelService = accessor.get(ITextModelService);
		const editorService = accessor.get(IEditorService);
		const fileService = accessor.get(IFileService);

		// Register provider at first as needed
		let registerEditorListener = false;
		if (providerDisposables.length === 0) {
			registerEditorListener = true;

			const provider = instantiationService.createInstance(TextFileContentProvider);
			providerDisposables.push(provider);
			providerDisposables.push(textModelService.registerTextModelContentProvider(COMPARE_WITH_SAVED_SCHEMA, provider));
		}

		// Open editor (only resources that can be handled by file service are supported)
		const uri = getResourceForCommand(resource, accessor.get(IListService), editorService);
		if (uri && fileService.canHandleResource(uri)) {
			const name = basename(uri);
			const editorLabel = nls.localize('modifiedLabel', "{0} (in file) ↔ {1}", name, name);

			try {
				await TextFileContentProvider.open(uri, COMPARE_WITH_SAVED_SCHEMA, editorLabel, editorService, { pinned: true });
				// Dispose once no more diff editor is opened with the scheme
				if (registerEditorListener) {
					providerDisposables.push(editorService.onDidVisibleEditorsChange(() => {
						if (!editorService.editors.some(editor => !!EditorResourceAccessor.getCanonicalUri(editor, { supportSideBySide: SideBySideEditor.SECONDARY, filterByScheme: COMPARE_WITH_SAVED_SCHEMA }))) {
							providerDisposables = dispose(providerDisposables);
						}
					}));
				}
			} catch {
				providerDisposables = dispose(providerDisposables);
			}
		}
	}
});

let globalResourceToCompare: URI | undefined;
let resourceSelectedForCompareContext: IContextKey<boolean>;
CommandsRegistry.registerCommand({
	id: SELECT_FOR_COMPARE_COMMAND_ID,
	handler: (accessor, resource: URI | object) => {
		const listService = accessor.get(IListService);

		globalResourceToCompare = getResourceForCommand(resource, listService, accessor.get(IEditorService));
		if (!resourceSelectedForCompareContext) {
			resourceSelectedForCompareContext = ResourceSelectedForCompareContext.bindTo(accessor.get(IContextKeyService));
		}
		resourceSelectedForCompareContext.set(true);
	}
});

CommandsRegistry.registerCommand({
	id: COMPARE_SELECTED_COMMAND_ID,
	handler: async (accessor, resource: URI | object) => {
		const editorService = accessor.get(IEditorService);
		const explorerService = accessor.get(IExplorerService);
		const resources = getMultiSelectedResources(resource, accessor.get(IListService), editorService, explorerService);

		if (resources.length === 2) {
			return editorService.openEditor({
				leftResource: resources[0],
				rightResource: resources[1],
				options: { pinned: true }
			});
		}

		return true;
	}
});

CommandsRegistry.registerCommand({
	id: COMPARE_RESOURCE_COMMAND_ID,
	handler: (accessor, resource: URI | object) => {
		const editorService = accessor.get(IEditorService);
		const listService = accessor.get(IListService);

		const rightResource = getResourceForCommand(resource, listService, editorService);
		if (globalResourceToCompare && rightResource) {
			editorService.openEditor({
				leftResource: globalResourceToCompare,
				rightResource,
				options: { pinned: true }
			});
		}
	}
});

async function resourcesToClipboard(resources: URI[], relative: boolean, clipboardService: IClipboardService, notificationService: INotificationService, labelService: ILabelService): Promise<void> {
	if (resources.length) {
		const lineDelimiter = isWindows ? '\r\n' : '\n';

		const text = resources.map(resource => labelService.getUriLabel(resource, { relative, noPrefix: true }))
			.join(lineDelimiter);
		await clipboardService.writeText(text);
	}
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib,
	when: EditorContextKeys.focus.toNegated(),
	primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_C,
	win: {
		primary: KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_C
	},
	id: COPY_PATH_COMMAND_ID,
	handler: async (accessor, resource: URI | object) => {
		const resources = getMultiSelectedResources(resource, accessor.get(IListService), accessor.get(IEditorService), accessor.get(IExplorerService));
		await resourcesToClipboard(resources, false, accessor.get(IClipboardService), accessor.get(INotificationService), accessor.get(ILabelService));
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib,
	when: EditorContextKeys.focus.toNegated(),
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyMod.Alt | KeyCode.KEY_C,
	win: {
		primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_C)
	},
	id: COPY_RELATIVE_PATH_COMMAND_ID,
	handler: async (accessor, resource: URI | object) => {
		const resources = getMultiSelectedResources(resource, accessor.get(IListService), accessor.get(IEditorService), accessor.get(IExplorerService));
		await resourcesToClipboard(resources, true, accessor.get(IClipboardService), accessor.get(INotificationService), accessor.get(ILabelService));
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib,
	when: undefined,
	primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_P),
	id: 'workbench.action.files.copyPathOfActiveFile',
	handler: async (accessor) => {
		const editorService = accessor.get(IEditorService);
		const activeInput = editorService.activeEditor;
		const resource = EditorResourceAccessor.getOriginalUri(activeInput, { supportSideBySide: SideBySideEditor.PRIMARY });
		const resources = resource ? [resource] : [];
		await resourcesToClipboard(resources, false, accessor.get(IClipboardService), accessor.get(INotificationService), accessor.get(ILabelService));
	}
});

CommandsRegistry.registerCommand({
	id: REVEAL_IN_EXPLORER_COMMAND_ID,
	handler: async (accessor, resource: URI | object) => {
		const viewletService = accessor.get(IViewletService);
		const contextService = accessor.get(IWorkspaceContextService);
		const explorerService = accessor.get(IExplorerService);
		const uri = getResourceForCommand(resource, accessor.get(IListService), accessor.get(IEditorService));

		const viewlet = (await viewletService.openViewlet(VIEWLET_ID, false))?.getViewPaneContainer() as ExplorerViewPaneContainer;

		if (uri && contextService.isInsideWorkspace(uri)) {
			const explorerView = viewlet.getExplorerView();
			if (explorerView) {
				explorerView.setExpanded(true);
				await explorerService.select(uri, true);
				explorerView.focus();
			}
		} else {
			const openEditorsView = viewlet.getOpenEditorsView();
			if (openEditorsView) {
				openEditorsView.setExpanded(true);
				openEditorsView.focus();
			}
		}
	}
});

CommandsRegistry.registerCommand({
	id: OPEN_WITH_EXPLORER_COMMAND_ID,
	handler: async (accessor, resource: URI | object) => {
		const editorService = accessor.get(IEditorService);

		const uri = getResourceForCommand(resource, accessor.get(IListService), accessor.get(IEditorService));
		if (uri) {
			return editorService.openEditor({ resource: uri, options: { override: EditorOverride.PICK } });
		}

		return undefined;
	}
});

// Save / Save As / Save All / Revert

async function saveSelectedEditors(accessor: ServicesAccessor, options?: ISaveEditorsOptions): Promise<void> {
	const listService = accessor.get(IListService);
	const editorGroupService = accessor.get(IEditorGroupsService);
	const codeEditorService = accessor.get(ICodeEditorService);
	const textFileService = accessor.get(ITextFileService);

	// Retrieve selected or active editor
	let editors = getOpenEditorsViewMultiSelection(listService, editorGroupService);
	if (!editors) {
		const activeGroup = editorGroupService.activeGroup;
		if (activeGroup.activeEditor) {
			editors = [];

			// Special treatment for side by side editors: if the active editor
			// has 2 sides, we consider both, to support saving both sides.
			// We only allow this when saving, not for "Save As" and not if any
			// editor is untitled which would bring up a "Save As" dialog too.
			// See also https://github.com/microsoft/vscode/issues/4180
			// See also https://github.com/microsoft/vscode/issues/106330
			if (
				activeGroup.activeEditor instanceof SideBySideEditorInput &&
				!options?.saveAs && !(activeGroup.activeEditor.primary.isUntitled() || activeGroup.activeEditor.secondary.isUntitled())
			) {
				editors.push({ groupId: activeGroup.id, editor: activeGroup.activeEditor.primary });
				editors.push({ groupId: activeGroup.id, editor: activeGroup.activeEditor.secondary });
			} else {
				editors.push({ groupId: activeGroup.id, editor: activeGroup.activeEditor });
			}
		}
	}

	if (!editors || editors.length === 0) {
		return; // nothing to save
	}

	// Save editors
	await doSaveEditors(accessor, editors, options);

	// Special treatment for embedded editors: if we detect that focus is
	// inside an embedded code editor, we save that model as well if we
	// find it in our text file models. Currently, only textual editors
	// support embedded editors.
	const focusedCodeEditor = codeEditorService.getFocusedCodeEditor();
	if (focusedCodeEditor instanceof EmbeddedCodeEditorWidget) {
		const resource = focusedCodeEditor.getModel()?.uri;

		// Check that the resource of the model was not saved already
		if (resource && !editors.some(({ editor }) => isEqual(EditorResourceAccessor.getCanonicalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY }), resource))) {
			const model = textFileService.files.get(resource);
			if (!model?.isReadonly()) {
				await textFileService.save(resource, options);
			}
		}
	}
}

function saveDirtyEditorsOfGroups(accessor: ServicesAccessor, groups: readonly IEditorGroup[], options?: ISaveEditorsOptions): Promise<void> {
	const dirtyEditors: IEditorIdentifier[] = [];
	for (const group of groups) {
		for (const editor of group.getEditors(EditorsOrder.MOST_RECENTLY_ACTIVE)) {
			if (editor.isDirty()) {
				dirtyEditors.push({ groupId: group.id, editor });
			}
		}
	}

	return doSaveEditors(accessor, dirtyEditors, options);
}

async function doSaveEditors(accessor: ServicesAccessor, editors: IEditorIdentifier[], options?: ISaveEditorsOptions): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const notificationService = accessor.get(INotificationService);
	const instantiationService = accessor.get(IInstantiationService);

	try {
		await editorService.save(editors, options);
	} catch (error) {
		if (!isPromiseCanceledError(error)) {
			notificationService.notify({
				id: editors.map(({ editor }) => hash(editor.resource?.toString())).join(), // ensure unique notification ID per set of editor
				severity: Severity.Error,
				message: nls.localize({ key: 'genericSaveError', comment: ['{0} is the resource that failed to save and {1} the error message'] }, "Failed to save '{0}': {1}", editors.map(({ editor }) => editor.getName()).join(', '), toErrorMessage(error, false)),
				actions: {
					primary: [
						toAction({ id: 'workbench.action.files.saveEditors', label: nls.localize('retry', "Retry"), run: () => instantiationService.invokeFunction(accessor => doSaveEditors(accessor, editors, options)) }),
						toAction({ id: 'workbench.action.files.revertEditors', label: nls.localize('discard', "Discard"), run: () => editorService.revert(editors) })
					]
				}
			});
		}
	}
}

KeybindingsRegistry.registerCommandAndKeybindingRule({
	when: undefined,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyMod.CtrlCmd | KeyCode.KEY_S,
	id: SAVE_FILE_COMMAND_ID,
	handler: accessor => {
		return saveSelectedEditors(accessor, { reason: SaveReason.EXPLICIT, force: true /* force save even when non-dirty */ });
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	when: undefined,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_S),
	win: { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_S) },
	id: SAVE_FILE_WITHOUT_FORMATTING_COMMAND_ID,
	handler: accessor => {
		return saveSelectedEditors(accessor, { reason: SaveReason.EXPLICIT, force: true /* force save even when non-dirty */, skipSaveParticipants: true });
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: SAVE_FILE_AS_COMMAND_ID,
	weight: KeybindingWeight.WorkbenchContrib,
	when: undefined,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_S,
	handler: accessor => {
		return saveSelectedEditors(accessor, { reason: SaveReason.EXPLICIT, saveAs: true });
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	when: undefined,
	weight: KeybindingWeight.WorkbenchContrib,
	primary: undefined,
	mac: { primary: KeyMod.CtrlCmd | KeyMod.Alt | KeyCode.KEY_S },
	win: { primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_S) },
	id: SAVE_ALL_COMMAND_ID,
	handler: (accessor) => {
		return saveDirtyEditorsOfGroups(accessor, accessor.get(IEditorGroupsService).getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE), { reason: SaveReason.EXPLICIT });
	}
});

CommandsRegistry.registerCommand({
	id: SAVE_ALL_IN_GROUP_COMMAND_ID,
	handler: (accessor, _: URI | object, editorContext: IEditorCommandsContext) => {
		const editorGroupService = accessor.get(IEditorGroupsService);

		const contexts = getMultiSelectedEditorContexts(editorContext, accessor.get(IListService), accessor.get(IEditorGroupsService));

		let groups: readonly IEditorGroup[] | undefined = undefined;
		if (!contexts.length) {
			groups = editorGroupService.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE);
		} else {
			groups = coalesce(contexts.map(context => editorGroupService.getGroup(context.groupId)));
		}

		return saveDirtyEditorsOfGroups(accessor, groups, { reason: SaveReason.EXPLICIT });
	}
});

CommandsRegistry.registerCommand({
	id: SAVE_FILES_COMMAND_ID,
	handler: accessor => {
		const editorService = accessor.get(IEditorService);

		return editorService.saveAll({ includeUntitled: false, reason: SaveReason.EXPLICIT });
	}
});

CommandsRegistry.registerCommand({
	id: REVERT_FILE_COMMAND_ID,
	handler: async accessor => {
		const notificationService = accessor.get(INotificationService);
		const listService = accessor.get(IListService);
		const editorGroupService = accessor.get(IEditorGroupsService);
		const editorService = accessor.get(IEditorService);

		// Retrieve selected or active editor
		let editors = getOpenEditorsViewMultiSelection(listService, editorGroupService);
		if (!editors) {
			const activeGroup = editorGroupService.activeGroup;
			if (activeGroup.activeEditor) {
				editors = [{ groupId: activeGroup.id, editor: activeGroup.activeEditor }];
			}
		}

		if (!editors || editors.length === 0) {
			return; // nothing to revert
		}

		try {
			await editorService.revert(editors.filter(({ editor }) => !editor.isUntitled() /* all except untitled */), { force: true });
		} catch (error) {
			notificationService.error(nls.localize('genericRevertError', "Failed to revert '{0}': {1}", editors.map(({ editor }) => editor.getName()).join(', '), toErrorMessage(error, false)));
		}
	}
});

CommandsRegistry.registerCommand({
	id: REMOVE_ROOT_FOLDER_COMMAND_ID,
	handler: (accessor, resource: URI | object) => {
		const workspaceEditingService = accessor.get(IWorkspaceEditingService);
		const contextService = accessor.get(IWorkspaceContextService);
		const uriIdentityService = accessor.get(IUriIdentityService);
		const workspace = contextService.getWorkspace();
		const resources = getMultiSelectedResources(resource, accessor.get(IListService), accessor.get(IEditorService), accessor.get(IExplorerService)).filter(resource =>
			workspace.folders.some(folder => uriIdentityService.extUri.isEqual(folder.uri, resource)) // Need to verify resources are workspaces since multi selection can trigger this command on some non workspace resources
		);

		return workspaceEditingService.removeFolders(resources);
	}
});

// Compressed item navigation

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib + 10,
	when: ContextKeyExpr.and(FilesExplorerFocusCondition, ExplorerCompressedFocusContext, ExplorerCompressedFirstFocusContext.negate()),
	primary: KeyCode.LeftArrow,
	id: PREVIOUS_COMPRESSED_FOLDER,
	handler: (accessor) => {
		const viewletService = accessor.get(IViewletService);
		const viewlet = viewletService.getActiveViewlet();

		if (viewlet?.getId() !== VIEWLET_ID) {
			return;
		}

		const explorer = viewlet.getViewPaneContainer() as ExplorerViewPaneContainer;
		const view = explorer.getExplorerView();
		view.previousCompressedStat();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib + 10,
	when: ContextKeyExpr.and(FilesExplorerFocusCondition, ExplorerCompressedFocusContext, ExplorerCompressedLastFocusContext.negate()),
	primary: KeyCode.RightArrow,
	id: NEXT_COMPRESSED_FOLDER,
	handler: (accessor) => {
		const viewletService = accessor.get(IViewletService);
		const viewlet = viewletService.getActiveViewlet();

		if (viewlet?.getId() !== VIEWLET_ID) {
			return;
		}

		const explorer = viewlet.getViewPaneContainer() as ExplorerViewPaneContainer;
		const view = explorer.getExplorerView();
		view.nextCompressedStat();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib + 10,
	when: ContextKeyExpr.and(FilesExplorerFocusCondition, ExplorerCompressedFocusContext, ExplorerCompressedFirstFocusContext.negate()),
	primary: KeyCode.Home,
	id: FIRST_COMPRESSED_FOLDER,
	handler: (accessor) => {
		const viewletService = accessor.get(IViewletService);
		const viewlet = viewletService.getActiveViewlet();

		if (viewlet?.getId() !== VIEWLET_ID) {
			return;
		}

		const explorer = viewlet.getViewPaneContainer() as ExplorerViewPaneContainer;
		const view = explorer.getExplorerView();
		view.firstCompressedStat();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib + 10,
	when: ContextKeyExpr.and(FilesExplorerFocusCondition, ExplorerCompressedFocusContext, ExplorerCompressedLastFocusContext.negate()),
	primary: KeyCode.End,
	id: LAST_COMPRESSED_FOLDER,
	handler: (accessor) => {
		const viewletService = accessor.get(IViewletService);
		const viewlet = viewletService.getActiveViewlet();

		if (viewlet?.getId() !== VIEWLET_ID) {
			return;
		}

		const explorer = viewlet.getViewPaneContainer() as ExplorerViewPaneContainer;
		const view = explorer.getExplorerView();
		view.lastCompressedStat();
	}
});

KeybindingsRegistry.registerCommandAndKeybindingRule({
	weight: KeybindingWeight.WorkbenchContrib,
	when: null,
	primary: KeyMod.CtrlCmd | KeyCode.KEY_N,
	id: NEW_UNTITLED_FILE_COMMAND_ID,
	description: {
		description: NEW_UNTITLED_FILE_LABEL,
		args: [
			{
				isOptional: true,
				name: 'viewType',
				description: 'The editor view type',
				schema: {
					'type': 'object',
					'required': ['viewType'],
					'properties': {
						'viewType': {
							'type': 'string'
						}
					}
				}
			}
		]
	},
	handler: async (accessor, args?: { viewType: string }) => {
		const editorService = accessor.get(IEditorService);

		if (typeof args?.viewType === 'string') {
			const editorGroupsService = accessor.get(IEditorGroupsService);

			const group = editorGroupsService.activeGroup;
			await editorService.openEditor({ options: { override: args.viewType, pinned: true } }, group);
		} else {
			await editorService.openEditor({ options: { pinned: true } }); // untitled are always pinned
		}
	}
});


