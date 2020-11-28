/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { URI, UriComponents } from 'vs/base/common/uri';
import * as typeConverters from 'vs/workbench/api/common/extHostTypeConverters';
import { CommandsRegistry, ICommandService, ICommandHandler } from 'vs/platform/commands/common/commands';
import { ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { EditorGroupColumn } from 'vs/workbench/common/editor';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IOpenEmptyWindowOptions } from 'vs/platform/windows/common/windows';
import { IWorkspacesService, IRecent } from 'vs/platform/workspaces/common/workspaces';
import { ILogService } from 'vs/platform/log/common/log';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IViewDescriptorService, IViewsService, ViewVisibilityState } from 'vs/workbench/common/views';
import { IOpenerService } from 'vs/platform/opener/common/opener';

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

export class OpenWithAPICommand {
	public static readonly ID = 'vscode.openWith';
	public static execute(executor: ICommandsExecutor, resource: URI, viewType: string, columnOrOptions?: vscode.ViewColumn | typeConverters.TextEditorOpenOptions): Promise<any> {
		let options: ITextEditorOptions | undefined;
		let position: EditorGroupColumn | undefined;

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

CommandsRegistry.registerCommand('_extensionTests.setLogLevel', function (accessor: ServicesAccessor, level: number) {
	const logService = accessor.get(ILogService);
	const environmentService = accessor.get(IEnvironmentService);

	if (environmentService.isExtensionDevelopment && !!environmentService.extensionTestsLocationURI) {
		logService.setLevel(level);
	}
});

CommandsRegistry.registerCommand('_workbench.openExternal', function (accessor: ServicesAccessor, uri: UriComponents, options: { allowTunneling?: boolean }) {
	// TODO: discuss martin, ben where to put this
	const openerService = accessor.get(IOpenerService);
	openerService.open(URI.revive(uri), options);
});


CommandsRegistry.registerCommand('_extensionTests.getLogLevel', function (accessor: ServicesAccessor) {
	const logService = accessor.get(ILogService);

	return logService.getLevel();
});


CommandsRegistry.registerCommand('_workbench.action.moveViews', async function (accessor: ServicesAccessor, options: { viewIds: string[], destinationId: string }) {
	const viewDescriptorService = accessor.get(IViewDescriptorService);

	const destination = viewDescriptorService.getViewContainerById(options.destinationId);
	if (!destination) {
		return;
	}

	// FYI, don't use `moveViewsToContainer` in 1 shot, because it expects all views to have the same current location
	for (const viewId of options.viewIds) {
		const viewDescriptor = viewDescriptorService.getViewDescriptorById(viewId);
		if (viewDescriptor?.canMoveView) {
			viewDescriptorService.moveViewsToContainer([viewDescriptor], destination, ViewVisibilityState.Default);
		}
	}

	await accessor.get(IViewsService).openViewContainer(destination.id, true);
});

export class MoveViewsAPICommand {
	public static readonly ID = 'vscode.moveViews';
	public static execute(executor: ICommandsExecutor, options: { viewIds: string[], destinationId: string }): Promise<any> {
		if (!Array.isArray(options?.viewIds) || typeof options?.destinationId !== 'string') {
			return Promise.reject('Invalid arguments');
		}

		return executor.executeCommand('_workbench.action.moveViews', options);
	}
}
CommandsRegistry.registerCommand({
	id: MoveViewsAPICommand.ID,
	handler: adjustHandler(MoveViewsAPICommand.execute),
	description: {
		description: 'Move Views',
		args: []
	}
});


// -----------------------------------------------------------------
// The following commands are registered on the renderer but as API
// command. DO NOT USE this unless you have understood what this
// means
// -----------------------------------------------------------------


class OpenAPICommand {
	public static readonly ID = 'vscode.open';
	public static execute(executor: ICommandsExecutor, resource: URI): Promise<any> {

		return executor.executeCommand('_workbench.open', resource);
	}
}
CommandsRegistry.registerCommand(OpenAPICommand.ID, adjustHandler(OpenAPICommand.execute));

class DiffAPICommand {
	public static readonly ID = 'vscode.diff';
	public static execute(executor: ICommandsExecutor, left: URI, right: URI, label: string, options?: typeConverters.TextEditorOpenOptions): Promise<any> {
		return executor.executeCommand('_workbench.diff', [
			left, right,
			label,
		]);
	}
}
CommandsRegistry.registerCommand(DiffAPICommand.ID, adjustHandler(DiffAPICommand.execute));
