/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Action } from 'vs/base/common/actions';
import { localize } from 'vs/nls';
import { ITelemetryData } from 'vs/platform/telemetry/common/telemetry';
import { IWorkspaceContextService, WorkbenchState, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IWorkspaceEditingService } from 'vs/workbench/services/workspaces/common/workspaceEditing';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ADD_ROOT_FOLDER_COMMAND_ID, ADD_ROOT_FOLDER_LABEL, PICK_WORKSPACE_FOLDER_COMMAND_ID } from 'vs/workbench/browser/actions/workspaceCommands';
import { IDialogService, IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { MenuRegistry, MenuId, Action2, registerAction2, ILocalizedString } from 'vs/platform/actions/common/actions';
import { EmptyWorkspaceSupportContext, WorkbenchStateContext, WorkspaceFolderCountContext } from 'vs/workbench/browser/contextkeys';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import Severity from 'vs/base/common/severity';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { KeyChord, KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IWorkspacesService, hasWorkspaceFileExtension } from 'vs/platform/workspaces/common/workspaces';
import { WORKSPACE_TRUST_ENABLED } from 'vs/workbench/services/workspaces/common/workspaceTrust';
import { IsWebContext } from 'vs/platform/contextkey/common/contextkeys';
import { KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';

const workspacesCategory: ILocalizedString = { value: localize('workspaces', "Workspaces"), original: 'Workspaces' };

export class OpenFileAction extends Action {

	static readonly ID = 'workbench.action.files.openFile';
	static readonly LABEL = localize('openFile', "Open File...");

	constructor(
		id: string,
		label: string,
		@IFileDialogService private readonly dialogService: IFileDialogService
	) {
		super(id, label);
	}

	override run(event?: unknown, data?: ITelemetryData): Promise<void> {
		return this.dialogService.pickFileAndOpen({ forceNewWindow: false, telemetryExtraData: data });
	}
}

export class OpenFolderAction extends Action {

	static readonly ID = 'workbench.action.files.openFolder';
	static readonly LABEL = localize('openFolder', "Open Folder...");

	constructor(
		id: string,
		label: string,
		@IFileDialogService private readonly dialogService: IFileDialogService
	) {
		super(id, label);
	}

	override run(event?: unknown, data?: ITelemetryData): Promise<void> {
		return this.dialogService.pickFolderAndOpen({ forceNewWindow: false, telemetryExtraData: data });
	}
}

export class OpenFileFolderAction extends Action {

	static readonly ID = 'workbench.action.files.openFileFolder';
	static readonly LABEL = localize('openFileFolder', "Open...");

	constructor(
		id: string,
		label: string,
		@IFileDialogService private readonly dialogService: IFileDialogService
	) {
		super(id, label);
	}

	override run(event?: unknown, data?: ITelemetryData): Promise<void> {
		return this.dialogService.pickFileFolderAndOpen({ forceNewWindow: false, telemetryExtraData: data });
	}
}

export class OpenWorkspaceAction extends Action {

	static readonly ID = 'workbench.action.openWorkspace';
	static readonly LABEL = localize('openWorkspaceAction', "Open Workspace...");

	constructor(
		id: string,
		label: string,
		@IFileDialogService private readonly dialogService: IFileDialogService
	) {
		super(id, label);
	}

	override run(event?: unknown, data?: ITelemetryData): Promise<void> {
		return this.dialogService.pickWorkspaceAndOpen({ telemetryExtraData: data });
	}
}

export class CloseWorkspaceAction extends Action2 {

	static readonly ID = 'workbench.action.closeFolder';

	constructor() {
		super({
			id: CloseWorkspaceAction.ID,
			title: { value: localize('closeWorkspace', "Close Workspace"), original: 'Close Workspace' },
			category: workspacesCategory,
			f1: true,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				when: EmptyWorkspaceSupportContext,
				primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KEY_K, KeyCode.KEY_F)
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const contextService = accessor.get(IWorkspaceContextService);
		const dialogService = accessor.get(IDialogService);
		const hostService = accessor.get(IHostService);
		const environmentService = accessor.get(IWorkbenchEnvironmentService);

		if (contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			dialogService.show(Severity.Error, localize('noWorkspaceOrFolderOpened', "There is currently no workspace or folder opened in this instance to close."), [localize('ok', 'OK')]);
			return;
		}

		return hostService.openWindow({ forceReuseWindow: true, remoteAuthority: environmentService.remoteAuthority });
	}
}

export class OpenWorkspaceConfigFileAction extends Action {

	static readonly ID = 'workbench.action.openWorkspaceConfigFile';
	static readonly LABEL = localize('openWorkspaceConfigFile', "Open Workspace Configuration File");

	constructor(
		id: string,
		label: string,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IEditorService private readonly editorService: IEditorService
	) {
		super(id, label);

		this.enabled = !!this.workspaceContextService.getWorkspace().configuration;
	}

	override async run(): Promise<void> {
		const configuration = this.workspaceContextService.getWorkspace().configuration;
		if (configuration) {
			await this.editorService.openEditor({ resource: configuration, options: { pinned: true } });
		}
	}
}

export class AddRootFolderAction extends Action2 {

	static readonly ID = 'workbench.action.addRootFolder';

	constructor() {
		super({
			id: AddRootFolderAction.ID,
			title: ADD_ROOT_FOLDER_LABEL,
			category: workspacesCategory,
			f1: true
		});
	}

	override run(accessor: ServicesAccessor): Promise<void> {
		const commandService = accessor.get(ICommandService);

		return commandService.executeCommand(ADD_ROOT_FOLDER_COMMAND_ID);
	}
}

class RemoveRootFolderAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.removeRootFolder',
			title: { value: localize('globalRemoveFolderFromWorkspace', "Remove Folder from Workspace..."), original: 'Remove Folder from Workspace...' },
			category: workspacesCategory,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const contextService = accessor.get(IWorkspaceContextService);
		const commandService = accessor.get(ICommandService);
		const workspaceEditingService = accessor.get(IWorkspaceEditingService);

		const state = contextService.getWorkbenchState();

		// Workspace / Folder
		if (state === WorkbenchState.WORKSPACE || state === WorkbenchState.FOLDER) {
			const folder = await commandService.executeCommand<IWorkspaceFolder>(PICK_WORKSPACE_FOLDER_COMMAND_ID);
			if (folder) {
				await workspaceEditingService.removeFolders([folder.uri]);
			}
		}
	}
}

class SaveWorkspaceAsAction extends Action2 {

	static readonly ID = 'workbench.action.saveWorkspaceAs';

	constructor() {
		super({
			id: SaveWorkspaceAsAction.ID,
			title: { value: localize('saveWorkspaceAsAction', "Save Workspace As..."), original: 'Save Workspace As...' },
			category: workspacesCategory,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const workspaceEditingService = accessor.get(IWorkspaceEditingService);
		const contextService = accessor.get(IWorkspaceContextService);

		const configPathUri = await workspaceEditingService.pickNewWorkspacePath();
		if (configPathUri && hasWorkspaceFileExtension(configPathUri)) {
			switch (contextService.getWorkbenchState()) {
				case WorkbenchState.EMPTY:
				case WorkbenchState.FOLDER:
					const folders = contextService.getWorkspace().folders.map(folder => ({ uri: folder.uri }));
					return workspaceEditingService.createAndEnterWorkspace(folders, configPathUri);
				case WorkbenchState.WORKSPACE:
					return workspaceEditingService.saveAndEnterWorkspace(configPathUri);
			}
		}
	}
}

class DuplicateWorkspaceInNewWindowAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.duplicateWorkspaceInNewWindow',
			title: { value: localize('duplicateWorkspaceInNewWindow', "Duplicate As Workspace in New Window"), original: 'Duplicate As Workspace in New Window' },
			category: workspacesCategory,
			f1: true
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const workspaceContextService = accessor.get(IWorkspaceContextService);
		const workspaceEditingService = accessor.get(IWorkspaceEditingService);
		const hostService = accessor.get(IHostService);
		const workspacesService = accessor.get(IWorkspacesService);
		const environmentService = accessor.get(IWorkbenchEnvironmentService);

		const folders = workspaceContextService.getWorkspace().folders;
		const remoteAuthority = environmentService.remoteAuthority;

		const newWorkspace = await workspacesService.createUntitledWorkspace(folders, remoteAuthority);
		await workspaceEditingService.copyWorkspaceSettings(newWorkspace);

		return hostService.openWindow([{ workspaceUri: newWorkspace.configPath }], { forceNewWindow: true });
	}
}

class WorkspaceTrustManageAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.manageTrust',
			title: { value: localize('manageTrustAction', "Manage Workspace Trust"), original: 'Manage Workspace Trust' },
			precondition: ContextKeyExpr.and(IsWebContext.negate(), ContextKeyExpr.equals(`config.${WORKSPACE_TRUST_ENABLED}`, true)),
			category: localize('workspacesCategory', "Workspaces"),
			f1: true
		});
	}

	async run(accessor: ServicesAccessor) {
		const commandService = accessor.get(ICommandService);
		await commandService.executeCommand('workbench.trust.manage');
	}
}

registerAction2(WorkspaceTrustManageAction);

// --- Actions Registration

registerAction2(AddRootFolderAction);
registerAction2(RemoveRootFolderAction);
registerAction2(CloseWorkspaceAction);
registerAction2(SaveWorkspaceAsAction);
registerAction2(DuplicateWorkspaceInNewWindowAction);

// --- Menu Registration

CommandsRegistry.registerCommand(OpenWorkspaceConfigFileAction.ID, serviceAccessor => {
	serviceAccessor.get(IInstantiationService).createInstance(OpenWorkspaceConfigFileAction, OpenWorkspaceConfigFileAction.ID, OpenWorkspaceConfigFileAction.LABEL).run();
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '3_workspace',
	command: {
		id: ADD_ROOT_FOLDER_COMMAND_ID,
		title: localize({ key: 'miAddFolderToWorkspace', comment: ['&& denotes a mnemonic'] }, "A&&dd Folder to Workspace...")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '3_workspace',
	command: {
		id: SaveWorkspaceAsAction.ID,
		title: localize('miSaveWorkspaceAs', "Save Workspace As...")
	},
	order: 2,
	when: EmptyWorkspaceSupportContext
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: OpenWorkspaceConfigFileAction.ID,
		title: { value: `${workspacesCategory}: ${OpenWorkspaceConfigFileAction.LABEL}`, original: 'Workspaces: Open Workspace Configuration File' },
	},
	when: WorkbenchStateContext.isEqualTo('workspace')
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '6_close',
	command: {
		id: CloseWorkspaceAction.ID,
		title: localize({ key: 'miCloseFolder', comment: ['&& denotes a mnemonic'] }, "Close &&Folder"),
		precondition: WorkspaceFolderCountContext.notEqualsTo('0')
	},
	order: 3,
	when: ContextKeyExpr.and(WorkbenchStateContext.notEqualsTo('workspace'), EmptyWorkspaceSupportContext)
});

MenuRegistry.appendMenuItem(MenuId.MenubarFileMenu, {
	group: '6_close',
	command: {
		id: CloseWorkspaceAction.ID,
		title: localize({ key: 'miCloseWorkspace', comment: ['&& denotes a mnemonic'] }, "Close &&Workspace")
	},
	order: 3,
	when: ContextKeyExpr.and(WorkbenchStateContext.isEqualTo('workspace'), EmptyWorkspaceSupportContext)
});
