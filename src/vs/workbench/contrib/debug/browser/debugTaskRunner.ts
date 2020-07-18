/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import severity from 'vs/base/common/severity';
import { Event } from 'vs/base/common/event';
import Constants from 'vs/workbench/contrib/markers/browser/constants';
import { ITaskService, ITaskSummary } from 'vs/workbench/contrib/tasks/common/taskService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkspaceFolder, IWorkspace } from 'vs/platform/workspace/common/workspace';
import { TaskEvent, TaskEventKind, TaskIdentifier } from 'vs/workbench/contrib/tasks/common/tasks';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IAction } from 'vs/base/common/actions';
import { withUndefinedAsNull } from 'vs/base/common/types';
import { IMarkerService } from 'vs/platform/markers/common/markers';
import { IDebugConfiguration } from 'vs/workbench/contrib/debug/common/debug';
import { createErrorWithActions } from 'vs/base/common/errorsWithActions';
import { IViewsService } from 'vs/workbench/common/views';

function once(match: (e: TaskEvent) => boolean, event: Event<TaskEvent>): Event<TaskEvent> {
	return (listener, thisArgs = null, disposables?) => {
		const result = event(e => {
			if (match(e)) {
				result.dispose();
				return listener.call(thisArgs, e);
			}
		}, null, disposables);
		return result;
	};
}

export const enum TaskRunResult {
	Failure,
	Success
}

export class DebugTaskRunner {

	private canceled = false;

	constructor(
		@ITaskService private readonly taskService: ITaskService,
		@IMarkerService private readonly markerService: IMarkerService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IViewsService private readonly viewsService: IViewsService,
		@IDialogService private readonly dialogService: IDialogService,
	) { }

	cancel(): void {
		this.canceled = true;
	}

	async runTaskAndCheckErrors(root: IWorkspaceFolder | IWorkspace | undefined, taskId: string | TaskIdentifier | undefined, onError: (msg: string, actions: IAction[]) => Promise<void>): Promise<TaskRunResult> {
		try {
			this.canceled = false;
			const taskSummary = await this.runTask(root, taskId);
			if (this.canceled || (taskSummary && taskSummary.exitCode === undefined)) {
				// User canceled, either debugging, or the prelaunch task
				return TaskRunResult.Failure;
			}

			const errorCount = taskId ? this.markerService.getStatistics().errors : 0;
			const successExitCode = taskSummary && taskSummary.exitCode === 0;
			const failureExitCode = taskSummary && taskSummary.exitCode !== 0;
			const onTaskErrors = this.configurationService.getValue<IDebugConfiguration>('debug').onTaskErrors;
			if (successExitCode || onTaskErrors === 'debugAnyway' || (errorCount === 0 && !failureExitCode)) {
				return TaskRunResult.Success;
			}
			if (onTaskErrors === 'showErrors') {
				await this.viewsService.openView(Constants.MARKERS_VIEW_ID, true);
				return Promise.resolve(TaskRunResult.Failure);
			}
			if (onTaskErrors === 'abort') {
				return Promise.resolve(TaskRunResult.Failure);
			}

			const taskLabel = typeof taskId === 'string' ? taskId : taskId ? taskId.name : '';
			const message = errorCount > 1
				? nls.localize('preLaunchTaskErrors', "Errors exist after running preLaunchTask '{0}'.", taskLabel)
				: errorCount === 1
					? nls.localize('preLaunchTaskError', "Error exists after running preLaunchTask '{0}'.", taskLabel)
					: taskSummary && typeof taskSummary.exitCode === 'number'
						? nls.localize('preLaunchTaskExitCode', "The preLaunchTask '{0}' terminated with exit code {1}.", taskLabel, taskSummary.exitCode)
						: nls.localize('preLaunchTaskTerminated', "The preLaunchTask '{0}' terminated.", taskLabel);

			const result = await this.dialogService.show(severity.Warning, message, [nls.localize('debugAnyway', "Debug Anyway"), nls.localize('showErrors', "Show Errors"), nls.localize('abort', "Abort")], {
				checkbox: {
					label: nls.localize('remember', "Remember my choice in user settings"),
				},
				cancelId: 2
			});


			const debugAnyway = result.choice === 0;
			const abort = result.choice === 2;
			if (result.checkboxChecked) {
				this.configurationService.updateValue('debug.onTaskErrors', result.choice === 0 ? 'debugAnyway' : abort ? 'abort' : 'showErrors');
			}

			if (abort) {
				return Promise.resolve(TaskRunResult.Failure);
			}
			if (debugAnyway) {
				return TaskRunResult.Success;
			}

			await this.viewsService.openView(Constants.MARKERS_VIEW_ID, true);
			return Promise.resolve(TaskRunResult.Failure);
		} catch (err) {
			await onError(err.message, [this.taskService.configureAction()]);
			return TaskRunResult.Failure;
		}
	}

	async runTask(root: IWorkspace | IWorkspaceFolder | undefined, taskId: string | TaskIdentifier | undefined): Promise<ITaskSummary | null> {
		if (!taskId) {
			return Promise.resolve(null);
		}
		if (!root) {
			return Promise.reject(new Error(nls.localize('invalidTaskReference', "Task '{0}' can not be referenced from a launch configuration that is in a different workspace folder.", typeof taskId === 'string' ? taskId : taskId.type)));
		}
		// run a task before starting a debug session
		const task = await this.taskService.getTask(root, taskId);
		if (!task) {
			const errorMessage = typeof taskId === 'string'
				? nls.localize('DebugTaskNotFoundWithTaskId', "Could not find the task '{0}'.", taskId)
				: nls.localize('DebugTaskNotFound', "Could not find the specified task.");
			return Promise.reject(createErrorWithActions(errorMessage));
		}

		// If a task is missing the problem matcher the promise will never complete, so we need to have a workaround #35340
		let taskStarted = false;
		const inactivePromise: Promise<ITaskSummary | null> = new Promise((c, e) => once(e => {
			// When a task isBackground it will go inactive when it is safe to launch.
			// But when a background task is terminated by the user, it will also fire an inactive event.
			// This means that we will not get to see the real exit code from running the task (undefined when terminated by the user).
			// Catch the ProcessEnded event here, which occurs before inactive, and capture the exit code to prevent this.
			return (e.kind === TaskEventKind.Inactive
				|| (e.kind === TaskEventKind.ProcessEnded && e.exitCode === undefined))
				&& e.taskId === task._id;
		}, this.taskService.onDidStateChange)(e => {
			taskStarted = true;
			c(e.kind === TaskEventKind.ProcessEnded ? { exitCode: e.exitCode } : null);
		}));

		const promise: Promise<ITaskSummary | null> = this.taskService.getActiveTasks().then(async (tasks): Promise<ITaskSummary | null> => {
			if (tasks.find(t => t._id === task._id)) {
				// Check that the task isn't busy and if it is, wait for it
				const busyTasks = await this.taskService.getBusyTasks();
				if (busyTasks.find(t => t._id === task._id)) {
					taskStarted = true;
					return inactivePromise;
				}
				// task is already running and isn't busy - nothing to do.
				return Promise.resolve(null);
			}
			once(e => ((e.kind === TaskEventKind.Active) || (e.kind === TaskEventKind.DependsOnStarted)) && e.taskId === task._id, this.taskService.onDidStateChange)(() => {
				// Task is active, so everything seems to be fine, no need to prompt after 10 seconds
				// Use case being a slow running task should not be prompted even though it takes more than 10 seconds
				taskStarted = true;
			});
			const taskPromise = this.taskService.run(task);
			if (task.configurationProperties.isBackground) {
				return inactivePromise;
			}

			return taskPromise.then(withUndefinedAsNull);
		});

		return new Promise((c, e) => {
			promise.then(result => {
				taskStarted = true;
				c(result);
			}, error => e(error));

			setTimeout(() => {
				if (!taskStarted) {
					const errorMessage = typeof taskId === 'string'
						? nls.localize('taskNotTrackedWithTaskId', "The specified task cannot be tracked.")
						: nls.localize('taskNotTracked', "The task '{0}' cannot be tracked.", JSON.stringify(taskId));
					e({ severity: severity.Error, message: errorMessage });
				}
			}, 10000);
		});
	}
}
