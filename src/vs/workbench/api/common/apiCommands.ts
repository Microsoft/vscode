/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CommandsRegistry, ICommandService, ICommandHandler } from 'vs/platform/commands/common/commands';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IViewDescriptorService, IViewsService, ViewVisibilityState } from 'vs/workbench/common/views';

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

CommandsRegistry.registerCommand('_workbench.action.hideView', async function (accessor: ServicesAccessor, viewId: string) {
	const viewDescriptorService = accessor.get(IViewDescriptorService);

	const viewDescriptor = viewDescriptorService.getViewDescriptorById(viewId);
	if (viewDescriptor?.canToggleVisibility) {
		const viewContainer = viewDescriptorService.getViewContainerByViewId(viewId);
		if (viewContainer) {
			const viewContainerModel = viewDescriptorService.getViewContainerModel(viewContainer);
			// Check if view is visible and active
			if (viewContainerModel.isVisible(viewId) && viewContainerModel.activeViewDescriptors.some(viewDescriptor => viewDescriptor.id === viewId)) {
				viewContainerModel.setVisible(viewId, false);
			}
		}
	}
});

export class HideViewAPICommand {
	public static readonly ID = 'vscode.hideView';
	public static execute(executor: ICommandsExecutor, viewId: string): Promise<any> {
		if (typeof viewId !== 'string') {
			return Promise.reject('Invalid arguments');
		}

		return executor.executeCommand('_workbench.action.hideView', viewId);
	}
}
CommandsRegistry.registerCommand({
	id: HideViewAPICommand.ID,
	handler: adjustHandler(HideViewAPICommand.execute),
	description: {
		description: 'Hide View',
		args: []
	}
});
