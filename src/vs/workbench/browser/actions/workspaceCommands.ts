/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IWorkspaceEditingService } from 'vs/workbench/services/workspaces/common/workspaceEditing';
import { dirname, removeTrailingPathSeparator } from 'vs/base/common/resources';
import { CancellationToken } from 'vs/base/common/cancellation';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands';
import { FileKind } from 'vs/platform/files/common/files';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { IQuickInputService, IPickOptions, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IFileDialogService, IPickAndOpenOptions } from 'vs/platform/dialogs/common/dialogs';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import { IOpenWindowOptions, IWindowOpenable } from 'vs/platform/windows/common/windows';
import { hasWorkspaceFileExtension } from 'vs/platform/workspaces/common/workspaces';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { ILocalizedString } from 'vs/platform/actions/common/actions';

export const ADD_ROOT_FOLDER_COMMAND_ID = 'addRootFolder';
export const ADD_ROOT_FOLDER_LABEL: ILocalizedString = { value: localize('addFolderToWorkspace', "Add Folder to Workspace..."), original: 'Add Folder to Workspace...' };

export const PICK_WORKSPACE_FOLDER_COMMAND_ID = '_workbench.pickWorkspaceFolder';

// Command registration

CommandsRegistry.registerCommand({
	id: 'workbench.action.files.openFileFolderInNewWindow',
	handler: (accessor: ServicesAccessor) => accessor.get(IFileDialogService).pickFileFolderAndOpen({ forceNewWindow: true })
});

CommandsRegistry.registerCommand({
	id: '_files.pickFolderAndOpen',
	handler: (accessor: ServicesAccessor, options: { forceNewWindow: boolean }) => accessor.get(IFileDialogService).pickFolderAndOpen(options)
});

CommandsRegistry.registerCommand({
	id: 'workbench.action.files.openFolderInNewWindow',
	handler: (accessor: ServicesAccessor) => accessor.get(IFileDialogService).pickFolderAndOpen({ forceNewWindow: true })
});

CommandsRegistry.registerCommand({
	id: 'workbench.action.files.openFileInNewWindow',
	handler: (accessor: ServicesAccessor) => accessor.get(IFileDialogService).pickFileAndOpen({ forceNewWindow: true })
});

CommandsRegistry.registerCommand({
	id: 'workbench.action.openWorkspaceInNewWindow',
	handler: (accessor: ServicesAccessor) => accessor.get(IFileDialogService).pickWorkspaceAndOpen({ forceNewWindow: true })
});

CommandsRegistry.registerCommand({
	id: ADD_ROOT_FOLDER_COMMAND_ID,
	handler: async (accessor) => {
		const workspaceEditingService = accessor.get(IWorkspaceEditingService);
		const dialogsService = accessor.get(IFileDialogService);
		const pathService = accessor.get(IPathService);
		const folders = await dialogsService.showOpenDialog({
			openLabel: mnemonicButtonLabel(localize({ key: 'add', comment: ['&& denotes a mnemonic'] }, "&&Add")),
			title: localize('addFolderToWorkspaceTitle', "Add Folder to Workspace"),
			canSelectFolders: true,
			canSelectMany: true,
			defaultUri: await dialogsService.defaultFolderPath(),
			availableFileSystems: [pathService.defaultUriScheme]
		});

		if (!folders || !folders.length) {
			return;
		}

		await workspaceEditingService.addFolders(folders.map(folder => ({ uri: removeTrailingPathSeparator(folder) })));
	}
});

CommandsRegistry.registerCommand(PICK_WORKSPACE_FOLDER_COMMAND_ID, async function (accessor, args?: [IPickOptions<IQuickPickItem>, CancellationToken]) {
	const quickInputService = accessor.get(IQuickInputService);
	const labelService = accessor.get(ILabelService);
	const contextService = accessor.get(IWorkspaceContextService);
	const modelService = accessor.get(IModelService);
	const modeService = accessor.get(IModeService);

	const folders = contextService.getWorkspace().folders;
	if (!folders.length) {
		return;
	}

	const folderPicks: IQuickPickItem[] = folders.map(folder => {
		return {
			label: folder.name,
			description: labelService.getUriLabel(dirname(folder.uri), { relative: true }),
			folder,
			iconClasses: getIconClasses(modelService, modeService, folder.uri, FileKind.ROOT_FOLDER)
		};
	});

	const options: IPickOptions<IQuickPickItem> = (args ? args[0] : undefined) || Object.create(null);

	if (!options.activeItem) {
		options.activeItem = folderPicks[0];
	}

	if (!options.placeHolder) {
		options.placeHolder = localize('workspaceFolderPickerPlaceholder', "Select workspace folder");
	}

	if (typeof options.matchOnDescription !== 'boolean') {
		options.matchOnDescription = true;
	}

	const token: CancellationToken = (args ? args[1] : undefined) || CancellationToken.None;
	const pick = await quickInputService.pick(folderPicks, options, token);

	if (pick) {
		return folders[folderPicks.indexOf(pick)];
	}

	return;
});

// API Command registration

interface IOpenFolderAPICommandOptions {
	forceNewWindow?: boolean;
	forceReuseWindow?: boolean;
	noRecentEntry?: boolean;
	forceLocalWindow?: boolean;
}

CommandsRegistry.registerCommand({
	id: 'vscode.openFolder',
	handler: (accessor: ServicesAccessor, uri?: URI, arg?: boolean | IOpenFolderAPICommandOptions) => {
		const commandService = accessor.get(ICommandService);
		// Be compatible to previous args by converting to options
		if (typeof arg === 'boolean') {
			arg = { forceNewWindow: arg };
		}

		// Without URI, ask to pick a folder or workspace to open
		if (!uri) {
			const options: IPickAndOpenOptions = {
				forceNewWindow: arg?.forceNewWindow
			};
			if (arg?.forceLocalWindow) {
				options.remoteAuthority = null;
				options.availableFileSystems = ['file'];
			}
			return commandService.executeCommand('_files.pickFolderAndOpen', options);
		}

		uri = URI.revive(uri);

		const options: IOpenWindowOptions = {
			forceNewWindow: arg?.forceNewWindow,
			forceReuseWindow: arg?.forceReuseWindow,
			noRecentEntry: arg?.noRecentEntry,
			remoteAuthority: arg?.forceLocalWindow ? null : undefined
		};
		const uriToOpen: IWindowOpenable = (hasWorkspaceFileExtension(uri) || uri.scheme === Schemas.untitled) ? { workspaceUri: uri } : { folderUri: uri };
		return commandService.executeCommand('_files.windowOpen', [uriToOpen], options);
	},
	description: {
		description: 'Open a folder or workspace in the current window or new window depending on the newWindow argument. Note that opening in the same window will shutdown the current extension host process and start a new one on the given folder/workspace unless the newWindow parameter is set to true.',
		args: [
			{
				name: 'uri', description: '(optional) Uri of the folder or workspace file to open. If not provided, a native dialog will ask the user for the folder',
				constraint: (value: any) => value === undefined || value === null || value instanceof URI
			},
			{
				name: 'options',
				description: '(optional) Options. Object with the following properties: ' +
					'`forceNewWindow`: Whether to open the folder/workspace in a new window or the same. Defaults to opening in the same window. ' +
					'`forceReuseWindow`: Whether to force opening the folder/workspace in the same window.  Defaults to false. ' +
					'`noRecentEntry`: Whether the opened URI will appear in the \'Open Recent\' list. Defaults to false. ' +
					'Note, for backward compatibility, options can also be of type boolean, representing the `forceNewWindow` setting.',
				constraint: (value: any) => value === undefined || typeof value === 'object' || typeof value === 'boolean'
			}
		]
	}
});
