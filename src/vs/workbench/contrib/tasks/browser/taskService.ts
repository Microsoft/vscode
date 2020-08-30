/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { ITaskSystem } from 'vs/workbench/contrib/tasks/common/taskSystem';
import { ExecutionEngine, TaskRunSource } from 'vs/workbench/contrib/tasks/common/tasks';
import { TerminalTaskSystem } from './terminalTaskSystem';
import { AbstractTaskService, WorkspaceFolderConfigurationResult } from 'vs/workbench/contrib/tasks/browser/abstractTaskService';
import { TaskFilter, ITaskService } from 'vs/workbench/contrib/tasks/common/taskService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

export class TaskService extends AbstractTaskService {
	private static readonly ProcessTaskSystemSupportMessage = nls.localize('taskService.processTaskSystem', 'Process task system is not support in the web.');

	protected getTaskSystem(): ITaskSystem {
		if (this._taskSystem) {
			return this._taskSystem;
		}
		if (this.executionEngine === ExecutionEngine.Terminal) {
			this._taskSystem = this.createTerminalTaskSystem();
		} else {
			throw new Error(TaskService.ProcessTaskSystemSupportMessage);
		}
		this._taskSystemListener = this._taskSystem!.onDidStateChange((event) => {
			if (this._taskSystem) {
				this._taskRunningState.set(this._taskSystem.isActiveSync());
			}
			this._onDidStateChange.fire(event);
		});
		return this._taskSystem!;
	}

	protected updateWorkspaceTasks(runSource: TaskRunSource = TaskRunSource.User): void {
		this._workspaceTasksPromise = this.computeWorkspaceTasks(runSource).then(value => {
			if (this.executionEngine !== ExecutionEngine.Terminal || ((this._taskSystem !== undefined) && !(this._taskSystem instanceof TerminalTaskSystem))) {
				throw new Error(TaskService.ProcessTaskSystemSupportMessage);
			}
			return value;
		});
	}

	protected computeLegacyConfiguration(workspaceFolder: IWorkspaceFolder): Promise<WorkspaceFolderConfigurationResult> {
		throw new Error(TaskService.ProcessTaskSystemSupportMessage);
	}

	protected versionAndEngineCompatible(filter?: TaskFilter): boolean {
		return this.executionEngine === ExecutionEngine.Terminal;
	}
}

registerSingleton(ITaskService, TaskService, true);
