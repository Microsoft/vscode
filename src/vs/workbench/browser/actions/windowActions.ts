/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { IWindowOpenable } from 'vs/platform/windows/common/windows';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { SyncActionDescriptor, MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { Registry } from 'vs/platform/registry/common/platform';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { IsFullscreenContext } from 'vs/workbench/browser/contextkeys';
import { IsMacNativeContext, IsDevelopmentContext } from 'vs/platform/contextkey/common/contextkeys';
import { IWorkbenchActionRegistry, Extensions } from 'vs/workbench/common/actions';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { IQuickInputButton, IQuickInputService, IQuickPickSeparator, IKeyMods, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { ILabelService } from 'vs/platform/label/common/label';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IRecent, isRecentFolder, isRecentWorkspace, IWorkspacesService, IWorkspaceIdentifier, isWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { URI } from 'vs/base/common/uri';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { FileKind } from 'vs/platform/files/common/files';
import { splitName } from 'vs/base/common/labels';
import { isMacintosh } from 'vs/base/common/platform';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { inQuickPickContext, getQuickNavigateHandler } from 'vs/workbench/browser/quickaccess';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { ResourceMap } from 'vs/base/common/map';
import { Codicon } from 'vs/base/common/codicons';

export const inRecentFilesPickerContextKey = 'inRecentFilesPicker';

interface IRecentlyOpenedPick extends IQuickPickItem {
	resource: URI,
	openable: IWindowOpenable;
}

abstract class BaseOpenRecentAction extends Action {

	private readonly removeFromRecentlyOpened: IQuickInputButton = {
		iconClass: Codicon.removeClose.classNames,
		tooltip: nls.localize('remove', "Remove from Recently Opened")
	};

	private readonly dirtyRecentlyOpened: IQuickInputButton = {
		iconClass: 'dirty-workspace ' + Codicon.closeDirty.classNames,
		tooltip: nls.localize('dirtyRecentlyOpened', "Workspace With Dirty Files"),
		alwaysVisible: true
	};

	constructor(
		id: string,
		label: string,
		private workspacesService: IWorkspacesService,
		private quickInputService: IQuickInputService,
		private contextService: IWorkspaceContextService,
		private labelService: ILabelService,
		private keybindingService: IKeybindingService,
		private modelService: IModelService,
		private modeService: IModeService,
		private hostService: IHostService,
		private dialogService: IDialogService
	) {
		super(id, label);
	}

	protected abstract isQuickNavigate(): boolean;

	async run(): Promise<void> {
		const recentlyOpened = await this.workspacesService.getRecentlyOpened();
		const dirtyWorkspacesAndFolders = await this.workspacesService.getDirtyWorkspaces();

		// Identify all folders and workspaces with dirty files
		const dirtyFolders = new ResourceMap<boolean>();
		const dirtyWorkspaces = new ResourceMap<IWorkspaceIdentifier>();
		for (const dirtyWorkspace of dirtyWorkspacesAndFolders) {
			if (URI.isUri(dirtyWorkspace)) {
				dirtyFolders.set(dirtyWorkspace, true);
			} else {
				dirtyWorkspaces.set(dirtyWorkspace.configPath, dirtyWorkspace);
			}
		}

		// Identify all recently opened folders and workspaces
		const recentFolders = new ResourceMap<boolean>();
		const recentWorkspaces = new ResourceMap<IWorkspaceIdentifier>();
		for (const recent of recentlyOpened.workspaces) {
			if (isRecentFolder(recent)) {
				recentFolders.set(recent.folderUri, true);
			} else {
				recentWorkspaces.set(recent.workspace.configPath, recent.workspace);
			}
		}

		// Fill in all known recently opened workspaces
		const workspacePicks: IRecentlyOpenedPick[] = [];
		for (const recent of recentlyOpened.workspaces) {
			const isDirty = isRecentFolder(recent) ? dirtyFolders.has(recent.folderUri) : dirtyWorkspaces.has(recent.workspace.configPath);

			workspacePicks.push(this.toQuickPick(recent, isDirty));
		}

		// Fill any backup workspace that is not yet shown at the end
		for (const dirtyWorkspaceOrFolder of dirtyWorkspacesAndFolders) {
			if (URI.isUri(dirtyWorkspaceOrFolder) && !recentFolders.has(dirtyWorkspaceOrFolder)) {
				workspacePicks.push(this.toQuickPick({ folderUri: dirtyWorkspaceOrFolder }, true));
			} else if (isWorkspaceIdentifier(dirtyWorkspaceOrFolder) && !recentWorkspaces.has(dirtyWorkspaceOrFolder.configPath)) {
				workspacePicks.push(this.toQuickPick({ workspace: dirtyWorkspaceOrFolder }, true));
			}
		}

		const filePicks = recentlyOpened.files.map(p => this.toQuickPick(p, false));

		// focus second entry if the first recent workspace is the current workspace
		const firstEntry = recentlyOpened.workspaces[0];
		const autoFocusSecondEntry: boolean = firstEntry && this.contextService.isCurrentWorkspace(isRecentWorkspace(firstEntry) ? firstEntry.workspace : firstEntry.folderUri);

		let keyMods: IKeyMods | undefined;

		const workspaceSeparator: IQuickPickSeparator = { type: 'separator', label: nls.localize('workspaces', "workspaces") };
		const fileSeparator: IQuickPickSeparator = { type: 'separator', label: nls.localize('files', "files") };
		const picks = [workspaceSeparator, ...workspacePicks, fileSeparator, ...filePicks];

		const pick = await this.quickInputService.pick(picks, {
			contextKey: inRecentFilesPickerContextKey,
			activeItem: [...workspacePicks, ...filePicks][autoFocusSecondEntry ? 1 : 0],
			placeHolder: isMacintosh ? nls.localize('openRecentPlaceholderMac', "Select to open (hold Cmd-key to force new window or Alt-key for same window)") : nls.localize('openRecentPlaceholder', "Select to open (hold Ctrl-key to force new window or Alt-key for same window)"),
			matchOnDescription: true,
			onKeyMods: mods => keyMods = mods,
			quickNavigate: this.isQuickNavigate() ? { keybindings: this.keybindingService.lookupKeybindings(this.id) } : undefined,
			onDidTriggerItemButton: async context => {

				// Remove
				if (context.button === this.removeFromRecentlyOpened) {
					await this.workspacesService.removeRecentlyOpened([context.item.resource]);
					context.removeItem();
				}

				// Dirty Workspace
				else if (context.button === this.dirtyRecentlyOpened) {
					const result = await this.dialogService.confirm({
						type: 'question',
						title: nls.localize('dirtyWorkspace', "Workspace with Dirty Files"),
						message: nls.localize('dirtyWorkspaceConfirm', "Do you want to open the workspace to review the dirty files?"),
						detail: nls.localize('dirtyWorkspaceConfirmDetail', "Workspaces with dirty files cannot be removed until all dirty files have been saved or reverted.")
					});

					if (result.confirmed) {
						this.hostService.openWindow([context.item.openable]);
						this.quickInputService.cancel();
					}
				}
			}
		});

		if (pick) {
			return this.hostService.openWindow([pick.openable], { forceNewWindow: keyMods?.ctrlCmd, forceReuseWindow: keyMods?.alt });
		}
	}

	private toQuickPick(recent: IRecent, isDirty: boolean): IRecentlyOpenedPick {
		let openable: IWindowOpenable | undefined;
		let iconClasses: string[];
		let fullLabel: string | undefined;
		let resource: URI | undefined;

		// Folder
		if (isRecentFolder(recent)) {
			resource = recent.folderUri;
			iconClasses = getIconClasses(this.modelService, this.modeService, resource, FileKind.FOLDER);
			openable = { folderUri: resource };
			fullLabel = recent.label || this.labelService.getWorkspaceLabel(resource, { verbose: true });
		}

		// Workspace
		else if (isRecentWorkspace(recent)) {
			resource = recent.workspace.configPath;
			iconClasses = getIconClasses(this.modelService, this.modeService, resource, FileKind.ROOT_FOLDER);
			openable = { workspaceUri: resource };
			fullLabel = recent.label || this.labelService.getWorkspaceLabel(recent.workspace, { verbose: true });
		}

		// File
		else {
			resource = recent.fileUri;
			iconClasses = getIconClasses(this.modelService, this.modeService, resource, FileKind.FILE);
			openable = { fileUri: resource };
			fullLabel = recent.label || this.labelService.getUriLabel(resource);
		}

		const { name, parentPath } = splitName(fullLabel);

		return {
			iconClasses,
			label: name,
			ariaLabel: isDirty ? nls.localize('recentDirtyAriaLabel', "{0}, dirty workspace", name) : name,
			description: parentPath,
			buttons: isDirty ? [this.dirtyRecentlyOpened] : [this.removeFromRecentlyOpened],
			openable,
			resource
		};
	}
}

export class OpenRecentAction extends BaseOpenRecentAction {

	static readonly ID = 'workbench.action.openRecent';
	static readonly LABEL = nls.localize('openRecent', "Open Recent...");

	constructor(
		id: string,
		label: string,
		@IWorkspacesService workspacesService: IWorkspacesService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IModelService modelService: IModelService,
		@IModeService modeService: IModeService,
		@ILabelService labelService: ILabelService,
		@IHostService hostService: IHostService,
		@IDialogService dialogService: IDialogService
	) {
		super(id, label, workspacesService, quickInputService, contextService, labelService, keybindingService, modelService, modeService, hostService, dialogService);
	}

	protected isQuickNavigate(): boolean {
		return false;
	}
}

class QuickPickRecentAction extends BaseOpenRecentAction {

	static readonly ID = 'workbench.action.quickOpenRecent';
	static readonly LABEL = nls.localize('quickOpenRecent', "Quick Open Recent...");

	constructor(
		id: string,
		label: string,
		@IWorkspacesService workspacesService: IWorkspacesService,
		@IQuickInputService quickInputService: IQuickInputService,
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IModelService modelService: IModelService,
		@IModeService modeService: IModeService,
		@ILabelService labelService: ILabelService,
		@IHostService hostService: IHostService,
		@IDialogService dialogService: IDialogService
	) {
		super(id, label, workspacesService, quickInputService, contextService, labelService, keybindingService, modelService, modeService, hostService, dialogService);
	}

	protected isQuickNavigate(): boolean {
		return true;
	}
}

class ToggleFullScreenAction extends Action {

	static readonly ID = 'workbench.action.toggleFullScreen';
	static readonly LABEL = nls.localize('toggleFullScreen', "Toggle Full Screen");

	constructor(
		id: string,
		label: string,
		@IHostService private readonly hostService: IHostService
	) {
		super(id, label);
	}

	run(): Promise<void> {
		return this.hostService.toggleFullScreen();
	}
}

export class ReloadWindowAction extends Action {

	static readonly ID = 'workbench.action.reloadWindow';
	static readonly LABEL = nls.localize('reloadWindow', "Reload Window");

	constructor(
		id: string,
		label: string,
		@IHostService private readonly hostService: IHostService
	) {
		super(id, label);
	}

	async run(): Promise<boolean> {
		await this.hostService.reload();

		return true;
	}
}

class ShowAboutDialogAction extends Action {

	static readonly ID = 'workbench.action.showAboutDialog';
	static readonly LABEL = nls.localize('about', "About");

	constructor(
		id: string,
		label: string,
		@IDialogService private readonly dialogService: IDialogService
	) {
		super(id, label);
	}

	run(): Promise<void> {
		return this.dialogService.about();
	}
}

export class NewWindowAction extends Action {

	static readonly ID = 'workbench.action.newWindow';
	static readonly LABEL = nls.localize('newWindow', "New Window");

	constructor(
		id: string,
		label: string,
		@IHostService private readonly hostService: IHostService
	) {
		super(id, label);
	}

	run(): Promise<void> {
		return this.hostService.openWindow();
	}
}

const registry = Registry.as<IWorkbenchActionRegistry>(Extensions.WorkbenchActions);

// --- Actions Registration

const fileCategory = nls.localize('file', "File");
registry.registerWorkbenchAction(SyncActionDescriptor.from(NewWindowAction, { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_N }), 'New Window');
registry.registerWorkbenchAction(SyncActionDescriptor.from(QuickPickRecentAction), 'File: Quick Open Recent...', fileCategory);
registry.registerWorkbenchAction(SyncActionDescriptor.from(OpenRecentAction, { primary: KeyMod.CtrlCmd | KeyCode.KEY_R, mac: { primary: KeyMod.WinCtrl | KeyCode.KEY_R } }), 'File: Open Recent...', fileCategory);

const viewCategory = nls.localize('view', "View");
registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleFullScreenAction, { primary: KeyCode.F11, mac: { primary: KeyMod.CtrlCmd | KeyMod.WinCtrl | KeyCode.KEY_F } }), 'View: Toggle Full Screen', viewCategory);

const developerCategory = nls.localize({ key: 'developer', comment: ['A developer on Code itself or someone diagnosing issues in Code'] }, "Developer");
registry.registerWorkbenchAction(SyncActionDescriptor.from(ReloadWindowAction), 'Developer: Reload Window', developerCategory);

const helpCategory = nls.localize('help', "Help");
registry.registerWorkbenchAction(SyncActionDescriptor.from(ShowAboutDialogAction), `Help: About`, helpCategory);

// --- Commands/Keybindings Registration

const recentFilesPickerContext = ContextKeyExpr.and(inQuickPickContext, ContextKeyExpr.has(inRecentFilesPickerContextKey));

const quickPickNavigateNextInRecentFilesPickerId = 'workbench.action.quickOpenNavigateNextInRecentFilesPicker';
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: quickPickNavigateNextInRecentFilesPickerId,
	weight: KeybindingWeight.WorkbenchContrib + 50,
	handler: getQuickNavigateHandler(quickPickNavigateNextInRecentFilesPickerId, true),
	when: recentFilesPickerContext,
	primary: KeyMod.CtrlCmd | KeyCode.KEY_R,
	mac: { primary: KeyMod.WinCtrl | KeyCode.KEY_R }
});

const quickPickNavigatePreviousInRecentFilesPicker = 'workbench.action.quickOpenNavigatePreviousInRecentFilesPicker';
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: quickPickNavigatePreviousInRecentFilesPicker,
	weight: KeybindingWeight.WorkbenchContrib + 50,
	handler: getQuickNavigateHandler(quickPickNavigatePreviousInRecentFilesPicker, false),
	when: recentFilesPickerContext,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_R,
	mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.KEY_R }
});

KeybindingsRegistry.registerKeybindingRule({
	id: ReloadWindowAction.ID,
	weight: KeybindingWeight.WorkbenchContrib + 50,
	when: IsDevelopmentContext,
	primary: KeyMod.CtrlCmd | KeyCode.KEY_R
});

// --- Menu Registration

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '1_new',
	command: {
		id: NewWindowAction.ID,
		title: nls.localize({ key: 'miNewWindow', comment: ['&& denotes a mnemonic'] }, "New &&Window")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	title: nls.localize({ key: 'miOpenRecent', comment: ['&& denotes a mnemonic'] }, "Open &&Recent"),
	submenu: MenuId.MenubarRecentMenu,
	group: '2_open',
	order: 4
});

MenuRegistry.appendMenuItem(MenuId.MenubarRecentMenu, {
	group: 'y_more',
	command: {
		id: OpenRecentAction.ID,
		title: nls.localize({ key: 'miMore', comment: ['&& denotes a mnemonic'] }, "&&More...")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarAppearanceMenu, {
	group: '1_toggle_view',
	command: {
		id: ToggleFullScreenAction.ID,
		title: nls.localize({ key: 'miToggleFullScreen', comment: ['&& denotes a mnemonic'] }, "&&Full Screen"),
		toggled: IsFullscreenContext
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarHelpMenu, {
	group: 'z_about',
	command: {
		id: ShowAboutDialogAction.ID,
		title: nls.localize({ key: 'miAbout', comment: ['&& denotes a mnemonic'] }, "&&About")
	},
	order: 1,
	when: IsMacNativeContext.toNegated()
});
