/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as resources from 'vs/base/common/resources';
import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { ITaskService, WorkspaceFolderTaskResult } from 'vs/workbench/contrib/tasks/common/taskService';
import { forEach } from 'vs/base/common/collections';
import { RunOnOptions, Task, TaskRunSource, TaskSource, TaskSourceKind, TASKS_CATEGORY, WorkspaceFileTaskSource, WorkspaceTaskSource } from 'vs/workbench/contrib/tasks/common/tasks';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IQuickPickItem, IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { Action2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from 'vs/platform/workspace/common/workspaceTrust';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';

const ARE_AUTOMATIC_TASKS_ALLOWED_IN_WORKSPACE = 'tasks.run.allowAutomatic';

export class RunAutomaticTasks extends Disposable implements IWorkbenchContribution {
	constructor(
		@ITaskService private readonly taskService: ITaskService,
		@IStorageService storageService: IStorageService,
		@IWorkspaceTrustManagementService workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IWorkspaceTrustRequestService workspaceTrustRequestService: IWorkspaceTrustRequestService) {
		super();
		const isFolderAutomaticAllowed = storageService.getBoolean(ARE_AUTOMATIC_TASKS_ALLOWED_IN_WORKSPACE, StorageScope.WORKSPACE, undefined);
		const isWorkspaceTrusted = workspaceTrustManagementService.isWorkpaceTrusted();
		this.tryRunTasks(isFolderAutomaticAllowed && isWorkspaceTrusted);
	}

	private tryRunTasks(isAllowed: boolean | undefined) {
		// Only run if allowed. Prompting for permission occurs when a user first tries to run a task.
		if (isAllowed === true) {
			this.taskService.getWorkspaceTasks(TaskRunSource.FolderOpen).then(workspaceTaskResult => {
				let { tasks } = RunAutomaticTasks.findAutoTasks(this.taskService, workspaceTaskResult);
				if (tasks.length > 0) {
					RunAutomaticTasks.runTasks(this.taskService, tasks);
				}
			});
		}
	}

	private static runTasks(taskService: ITaskService, tasks: Array<Task | Promise<Task | undefined>>) {
		tasks.forEach(task => {
			if (task instanceof Promise) {
				task.then(promiseResult => {
					if (promiseResult) {
						taskService.run(promiseResult);
					}
				});
			} else {
				taskService.run(task);
			}
		});
	}

	private static getTaskSource(source: TaskSource): URI | undefined {
		const taskKind = TaskSourceKind.toConfigurationTarget(source.kind);
		switch (taskKind) {
			case ConfigurationTarget.WORKSPACE_FOLDER: {
				return resources.joinPath((<WorkspaceTaskSource>source).config.workspaceFolder!.uri, (<WorkspaceTaskSource>source).config.file);
			}
			case ConfigurationTarget.WORKSPACE: {
				return (<WorkspaceFileTaskSource>source).config.workspace?.configuration ?? undefined;
			}
		}
		return undefined;
	}

	private static findAutoTasks(taskService: ITaskService, workspaceTaskResult: Map<string, WorkspaceFolderTaskResult>): { tasks: Array<Task | Promise<Task | undefined>>, taskNames: Array<string>, locations: Map<string, URI> } {
		const tasks = new Array<Task | Promise<Task | undefined>>();
		const taskNames = new Array<string>();
		const locations = new Map<string, URI>();

		if (workspaceTaskResult) {
			workspaceTaskResult.forEach(resultElement => {
				if (resultElement.set) {
					resultElement.set.tasks.forEach(task => {
						if (task.runOptions.runOn === RunOnOptions.folderOpen) {
							tasks.push(task);
							taskNames.push(task._label);
							const location = RunAutomaticTasks.getTaskSource(task._source);
							if (location) {
								locations.set(location.fsPath, location);
							}
						}
					});
				}
				if (resultElement.configurations) {
					forEach(resultElement.configurations.byIdentifier, (configedTask) => {
						if (configedTask.value.runOptions.runOn === RunOnOptions.folderOpen) {
							tasks.push(new Promise<Task | undefined>(resolve => {
								taskService.getTask(resultElement.workspaceFolder, configedTask.value._id, true).then(task => resolve(task));
							}));
							if (configedTask.value._label) {
								taskNames.push(configedTask.value._label);
							} else {
								taskNames.push(configedTask.value.configures.task);
							}
							const location = RunAutomaticTasks.getTaskSource(configedTask.value._source);
							if (location) {
								locations.set(location.fsPath, location);
							}
						}
					});
				}
			});
		}
		return { tasks, taskNames, locations };
	}

	public static async promptForPermission(taskService: ITaskService, storageService: IStorageService, notificationService: INotificationService, workspaceTrustManagementService: IWorkspaceTrustManagementService,
		openerService: IOpenerService, workspaceTaskResult: Map<string, WorkspaceFolderTaskResult>) {
		const isWorkspaceTrusted = workspaceTrustManagementService.isWorkpaceTrusted;
		if (!isWorkspaceTrusted) {
			return;
		}

		const isFolderAutomaticAllowed = storageService.getBoolean(ARE_AUTOMATIC_TASKS_ALLOWED_IN_WORKSPACE, StorageScope.WORKSPACE, undefined);
		if (isFolderAutomaticAllowed !== undefined) {
			return;
		}

		let { tasks, taskNames, locations } = RunAutomaticTasks.findAutoTasks(taskService, workspaceTaskResult);
		if (taskNames.length > 0) {
			// We have automatic tasks, prompt to allow.
			this.showPrompt(notificationService, storageService, taskService, openerService, taskNames, locations).then(allow => {
				if (allow) {
					RunAutomaticTasks.runTasks(taskService, tasks);
				}
			});
		}
	}

	private static showPrompt(notificationService: INotificationService, storageService: IStorageService, taskService: ITaskService,
		openerService: IOpenerService, taskNames: Array<string>, locations: Map<string, URI>): Promise<boolean> {
		return new Promise<boolean>(resolve => {
			notificationService.prompt(Severity.Info, nls.localize('tasks.run.allowAutomatic',
				"This workspace has tasks ({0}) defined ({1}) that run automatically when you open this workspace. Do you allow automatic tasks to run when you open this workspace?",
				taskNames.join(', '),
				Array.from(locations.keys()).join(', ')
			),
				[{
					label: nls.localize('allow', "Allow and run"),
					run: () => {
						resolve(true);
						storageService.store(ARE_AUTOMATIC_TASKS_ALLOWED_IN_WORKSPACE, true, StorageScope.WORKSPACE, StorageTarget.MACHINE);
					}
				},
				{
					label: nls.localize('disallow', "Disallow"),
					run: () => {
						resolve(false);
						storageService.store(ARE_AUTOMATIC_TASKS_ALLOWED_IN_WORKSPACE, false, StorageScope.WORKSPACE, StorageTarget.MACHINE);
					}
				},
				{
					label: locations.size === 1 ? nls.localize('openTask', "Open file") : nls.localize('openTasks', "Open files"),
					run: async () => {
						for (const location of locations) {
							await openerService.open(location[1]);
						}
						resolve(false);
					}
				}]
			);
		});
	}

}

export class ManageAutomaticTaskRunning extends Action2 {

	public static readonly ID = 'workbench.action.tasks.manageAutomaticRunning';
	public static readonly LABEL = nls.localize('workbench.action.tasks.manageAutomaticRunning', "Manage Automatic Tasks in Folder");

	constructor() {
		super({
			id: ManageAutomaticTaskRunning.ID,
			title: ManageAutomaticTaskRunning.LABEL,
			category: TASKS_CATEGORY
		});
	}

	public async run(accessor: ServicesAccessor): Promise<any> {
		const quickInputService = accessor.get(IQuickInputService);
		const storageService = accessor.get(IStorageService);
		const allowItem: IQuickPickItem = { label: nls.localize('workbench.action.tasks.allowAutomaticTasks', "Allow Automatic Tasks in Folder") };
		const disallowItem: IQuickPickItem = { label: nls.localize('workbench.action.tasks.disallowAutomaticTasks', "Disallow Automatic Tasks in Folder") };
		const value = await quickInputService.pick([allowItem, disallowItem], { canPickMany: false });
		if (!value) {
			return;
		}

		storageService.store(ARE_AUTOMATIC_TASKS_ALLOWED_IN_WORKSPACE, value === allowItem, StorageScope.WORKSPACE, StorageTarget.MACHINE);
	}
}
