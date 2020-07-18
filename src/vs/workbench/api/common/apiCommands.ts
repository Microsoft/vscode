/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { URI } from 'vs/base/common/uri';
import * as typeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import { CommandsRegistry, ICommandService, ICommandHandler } from 'vs/platform/commands/common/commands';
import { ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { EditorViewColumn } from 'vs/workbench/api/common/shared/editor';
import { EditorGroupLayout } from 'vs/workbench/services/editor/common/editorGroupsService';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IOpenWindowOptions, IWindowOpenable, IOpenEmptyWindowOptions } from 'vs/platform/windows/common/windows';
import { IWorkspacesService, hasWorkspaceFileExtension, IRecent } from 'vs/platform/workspaces/common/workspaces';
import { Schemas } from 'vs/base/common/network';
import { ILogService } from 'vs/platform/log/common/log';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';

// -----------------------------------------------------------------
// The following commands are registered on both sides separately.
//
// We are trying to maintain backwards compatibility for cases where
// API commands are encoded as markdown links, for example.
// -----------------------------------------------------------------

export interface ICommandsExecutor {
	executeCommand<T>(id: string, ...args: any[]): Promise<T | undefined>;
}

function adjustHandler(handler: (executor: ICommandsExecutor, ...args: any[]) => any): ICommandHandler {
	return (accessor, ...args: any[]) => {
		return handler(accessor.get(ICommandService), ...args);
	};
}

interface IOpenFolderAPICommandOptions {
	forceNewWindow?: boolean;
	forceReuseWindow?: boolean;
	noRecentEntry?: boolean;
}

export class OpenFolderAPICommand {
	public static readonly ID = 'vscode.openFolder';
	public static execute(executor: ICommandsExecutor, uri?: URI, forceNewWindow?: boolean): Promise<any>;
	public static execute(executor: ICommandsExecutor, uri?: URI, options?: IOpenFolderAPICommandOptions): Promise<any>;
	public static execute(executor: ICommandsExecutor, uri?: URI, arg: boolean | IOpenFolderAPICommandOptions = {}): Promise<any> {
		if (typeof arg === 'boolean') {
			arg = { forceNewWindow: arg };
		}
		if (!uri) {
			return executor.executeCommand('_files.pickFolderAndOpen', { forceNewWindow: arg.forceNewWindow });
		}
		const options: IOpenWindowOptions = { forceNewWindow: arg.forceNewWindow, forceReuseWindow: arg.forceReuseWindow, noRecentEntry: arg.noRecentEntry };
		uri = URI.revive(uri);
		const uriToOpen: IWindowOpenable = (hasWorkspaceFileExtension(uri) || uri.scheme === Schemas.untitled) ? { workspaceUri: uri } : { folderUri: uri };
		return executor.executeCommand('_files.windowOpen', [uriToOpen], options);
	}
}
CommandsRegistry.registerCommand({
	id: OpenFolderAPICommand.ID,
	handler: adjustHandler(OpenFolderAPICommand.execute),
	description: {
		description: 'Open a folder or workspace in the current window or new window depending on the newWindow argument. Note that opening in the same window will shutdown the current extension host process and start a new one on the given folder/workspace unless the newWindow parameter is set to true.',
		args: [
			{ name: 'uri', description: '(optional) Uri of the folder or workspace file to open. If not provided, a native dialog will ask the user for the folder', constraint: (value: any) => value === undefined || value instanceof URI },
			{ name: 'options', description: '(optional) Options. Object with the following properties: `forceNewWindow `: Whether to open the folder/workspace in a new window or the same. Defaults to opening in the same window. `noRecentEntry`: Wheter the opened URI will appear in the \'Open Recent\' list. Defaults to true.  Note, for backward compatibility, options can also be of type boolean, representing the `forceNewWindow` setting.', constraint: (value: any) => value === undefined || typeof value === 'object' || typeof value === 'boolean' }
		]
	}
});

interface INewWindowAPICommandOptions {
	reuseWindow?: boolean;
	remoteAuthority?: string;
}

export class NewWindowAPICommand {
	public static readonly ID = 'vscode.newWindow';
	public static execute(executor: ICommandsExecutor, options?: INewWindowAPICommandOptions): Promise<any> {
		const commandOptions: IOpenEmptyWindowOptions = {
			forceReuseWindow: options && options.reuseWindow,
			remoteAuthority: options && options.remoteAuthority
		};

		return executor.executeCommand('_files.newWindow', commandOptions);
	}
}
CommandsRegistry.registerCommand({
	id: NewWindowAPICommand.ID,
	handler: adjustHandler(NewWindowAPICommand.execute),
	description: {
		description: 'Opens an new window',
		args: [
		]
	}
});

export class DiffAPICommand {
	public static readonly ID = 'vscode.diff';
	public static execute(executor: ICommandsExecutor, left: URI, right: URI, label: string, options?: typeConverters.TextEditorOpenOptions): Promise<any> {
		return executor.executeCommand('_workbench.diff', [
			left, right,
			label,
			undefined,
			typeConverters.TextEditorOpenOptions.from(options),
			options ? typeConverters.ViewColumn.from(options.viewColumn) : undefined
		]);
	}
}
CommandsRegistry.registerCommand(DiffAPICommand.ID, adjustHandler(DiffAPICommand.execute));

export class OpenAPICommand {
	public static readonly ID = 'vscode.open';
	public static execute(executor: ICommandsExecutor, resource: URI, columnOrOptions?: vscode.ViewColumn | typeConverters.TextEditorOpenOptions, label?: string): Promise<any> {
		let options: ITextEditorOptions | undefined;
		let position: EditorViewColumn | undefined;

		if (columnOrOptions) {
			if (typeof columnOrOptions === 'number') {
				position = typeConverters.ViewColumn.from(columnOrOptions);
			} else {
				options = typeConverters.TextEditorOpenOptions.from(columnOrOptions);
				position = typeConverters.ViewColumn.from(columnOrOptions.viewColumn);
			}
		}

		return executor.executeCommand('_workbench.open', [
			resource,
			options,
			position,
			label
		]);
	}
}
CommandsRegistry.registerCommand(OpenAPICommand.ID, adjustHandler(OpenAPICommand.execute));

export class OpenWithAPICommand {
	public static readonly ID = 'vscode.openWith';
	public static execute(executor: ICommandsExecutor, resource: URI, viewType: string, columnOrOptions?: vscode.ViewColumn | typeConverters.TextEditorOpenOptions): Promise<any> {
		let options: ITextEditorOptions | undefined;
		let position: EditorViewColumn | undefined;

		if (typeof columnOrOptions === 'number') {
			position = typeConverters.ViewColumn.from(columnOrOptions);
		} else if (typeof columnOrOptions !== 'undefined') {
			options = typeConverters.TextEditorOpenOptions.from(columnOrOptions);
		}

		return executor.executeCommand('_workbench.openWith', [
			resource,
			viewType,
			options,
			position
		]);
	}
}
CommandsRegistry.registerCommand(OpenWithAPICommand.ID, adjustHandler(OpenWithAPICommand.execute));

CommandsRegistry.registerCommand('_workbench.removeFromRecentlyOpened', function (accessor: ServicesAccessor, uri: URI) {
	const workspacesService = accessor.get(IWorkspacesService);
	return workspacesService.removeRecentlyOpened([uri]);
});

export class RemoveFromRecentlyOpenedAPICommand {
	public static readonly ID = 'vscode.removeFromRecentlyOpened';
	public static execute(executor: ICommandsExecutor, path: string | URI): Promise<any> {
		if (typeof path === 'string') {
			path = path.match(/^[^:/?#]+:\/\//) ? URI.parse(path) : URI.file(path);
		} else {
			path = URI.revive(path); // called from extension host
		}
		return executor.executeCommand('_workbench.removeFromRecentlyOpened', path);
	}
}
CommandsRegistry.registerCommand(RemoveFromRecentlyOpenedAPICommand.ID, adjustHandler(RemoveFromRecentlyOpenedAPICommand.execute));

export interface OpenIssueReporterArgs {
	readonly extensionId: string;
	readonly issueTitle?: string;
	readonly issueBody?: string;
}

export class OpenIssueReporter {
	public static readonly ID = 'vscode.openIssueReporter';

	public static execute(executor: ICommandsExecutor, args: string | OpenIssueReporterArgs): Promise<void> {
		const commandArgs = typeof args === 'string'
			? { extensionId: args }
			: args;
		return executor.executeCommand('workbench.action.openIssueReporter', commandArgs);
	}
}

interface RecentEntry {
	uri: URI;
	type: 'workspace' | 'folder' | 'file';
	label?: string;
}

CommandsRegistry.registerCommand('_workbench.addToRecentlyOpened', async function (accessor: ServicesAccessor, recentEntry: RecentEntry) {
	const workspacesService = accessor.get(IWorkspacesService);
	let recent: IRecent | undefined = undefined;
	const uri = recentEntry.uri;
	const label = recentEntry.label;
	if (recentEntry.type === 'workspace') {
		const workspace = await workspacesService.getWorkspaceIdentifier(uri);
		recent = { workspace, label };
	} else if (recentEntry.type === 'folder') {
		recent = { folderUri: uri, label };
	} else {
		recent = { fileUri: uri, label };
	}
	return workspacesService.addRecentlyOpened([recent]);
});

CommandsRegistry.registerCommand('_workbench.getRecentlyOpened', async function (accessor: ServicesAccessor) {
	const workspacesService = accessor.get(IWorkspacesService);
	return workspacesService.getRecentlyOpened();
});

export class SetEditorLayoutAPICommand {
	public static readonly ID = 'vscode.setEditorLayout';
	public static execute(executor: ICommandsExecutor, layout: EditorGroupLayout): Promise<any> {
		return executor.executeCommand('layoutEditorGroups', layout);
	}
}
CommandsRegistry.registerCommand({
	id: SetEditorLayoutAPICommand.ID,
	handler: adjustHandler(SetEditorLayoutAPICommand.execute),
	description: {
		description: 'Set Editor Layout',
		args: [{
			name: 'args',
			schema: {
				'type': 'object',
				'required': ['groups'],
				'properties': {
					'orientation': {
						'type': 'number',
						'default': 0,
						'enum': [0, 1]
					},
					'groups': {
						'$ref': '#/definitions/editorGroupsSchema', // defined in keybindingService.ts ...
						'default': [{}, {}],
					}
				}
			}
		}]
	}
});

CommandsRegistry.registerCommand('_extensionTests.setLogLevel', function (accessor: ServicesAccessor, level: number) {
	const logService = accessor.get(ILogService);
	const environmentService = accessor.get(IEnvironmentService);

	if (environmentService.isExtensionDevelopment && !!environmentService.extensionTestsLocationURI) {
		logService.setLevel(level);
	}
});

CommandsRegistry.registerCommand('_extensionTests.getLogLevel', function (accessor: ServicesAccessor) {
	const logService = accessor.get(ILogService);

	return logService.getLevel();
});
