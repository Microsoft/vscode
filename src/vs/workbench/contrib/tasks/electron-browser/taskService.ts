/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Objects from 'vs/base/common/objects';
import * as semver from 'semver-umd';
import { IStringDictionary } from 'vs/base/common/collections';
import { WorkbenchState, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { ITaskSystem } from 'vs/workbench/contrib/tasks/common/taskSystem';
import { ExecutionEngine, TaskRunSource } from 'vs/workbench/contrib/tasks/common/tasks';
import * as TaskConfig from '../common/taskConfiguration';
import { ProcessTaskSystem } from 'vs/workbench/contrib/tasks/node/processTaskSystem';
import { ProcessRunnerDetector } from 'vs/workbench/contrib/tasks/node/processRunnerDetector';
import { AbstractTaskService } from 'vs/workbench/contrib/tasks/browser/abstractTaskService';
import { TaskFilter, ITaskService } from 'vs/workbench/contrib/tasks/common/taskService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

interface WorkspaceFolderConfigurationResult {
	workspaceFolder: IWorkspaceFolder;
	config: TaskConfig.ExternalTaskRunnerConfiguration | undefined;
	hasErrors: boolean;
}

export class TaskService extends AbstractTaskService {
	private _configHasErrors: boolean = false;

	protected getTaskSystem(): ITaskSystem {
		if (this._taskSystem) {
			return this._taskSystem;
		}
		if (this.executionEngine === ExecutionEngine.Terminal) {
			this._taskSystem = this.createTerminalTaskSystem();
		} else {
			let system = new ProcessTaskSystem(
				this.markerService, this.modelService, this.telemetryService, this.outputService,
				this.configurationResolverService, TaskService.OutputChannelId,
			);
			system.hasErrors(this._configHasErrors);
			this._taskSystem = system;
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
			if (this.executionEngine === ExecutionEngine.Process && this._taskSystem instanceof ProcessTaskSystem) {
				// We can only have a process engine if we have one folder.
				value.forEach((value) => {
					this._configHasErrors = value.hasErrors;
					(this._taskSystem as ProcessTaskSystem).hasErrors(this._configHasErrors);
				});
			}
			return value;
		});
	}

	private hasDetectorSupport(config: TaskConfig.ExternalTaskRunnerConfiguration): boolean {
		if (!config.command || this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return false;
		}
		return ProcessRunnerDetector.supports(TaskConfig.CommandString.value(config.command));
	}

	protected computeLegacyConfiguration(workspaceFolder: IWorkspaceFolder): Promise<WorkspaceFolderConfigurationResult> {
		let { config, hasParseErrors } = this.getConfiguration(workspaceFolder);
		if (hasParseErrors) {
			return Promise.resolve({ workspaceFolder: workspaceFolder, hasErrors: true, config: undefined });
		}
		if (config) {
			if (this.hasDetectorSupport(config)) {
				return new ProcessRunnerDetector(workspaceFolder, this.fileService, this.contextService, this.configurationResolverService, config).detect(true).then((value): WorkspaceFolderConfigurationResult => {
					let hasErrors = this.printStderr(value.stderr);
					let detectedConfig = value.config;
					if (!detectedConfig) {
						return { workspaceFolder, config, hasErrors };
					}
					let result: TaskConfig.ExternalTaskRunnerConfiguration = Objects.deepClone(config)!;
					let configuredTasks: IStringDictionary<TaskConfig.CustomTask> = Object.create(null);
					const resultTasks = result.tasks;
					if (!resultTasks) {
						if (detectedConfig.tasks) {
							result.tasks = detectedConfig.tasks;
						}
					} else {
						resultTasks.forEach(task => {
							if (task.taskName) {
								configuredTasks[task.taskName] = task;
							}
						});
						if (detectedConfig.tasks) {
							detectedConfig.tasks.forEach((task) => {
								if (task.taskName && !configuredTasks[task.taskName]) {
									resultTasks.push(task);
								}
							});
						}
					}
					return { workspaceFolder, config: result, hasErrors };
				});
			} else {
				return Promise.resolve({ workspaceFolder, config, hasErrors: false });
			}
		} else {
			return new ProcessRunnerDetector(workspaceFolder, this.fileService, this.contextService, this.configurationResolverService).detect(true).then((value) => {
				let hasErrors = this.printStderr(value.stderr);
				return { workspaceFolder, config: value.config!, hasErrors };
			});
		}
	}

	protected versionAndEngineCompatible(filter?: TaskFilter): boolean {
		let range = filter && filter.version ? filter.version : undefined;
		let engine = this.executionEngine;

		return (range === undefined) || ((semver.satisfies('0.1.0', range) && engine === ExecutionEngine.Process) || (semver.satisfies('2.0.0', range) && engine === ExecutionEngine.Terminal));
	}

	private printStderr(stderr: string[]): boolean {
		let result = false;
		if (stderr && stderr.length > 0) {
			stderr.forEach((line) => {
				result = true;
				this._outputChannel.append(line + '\n');
			});
			this.showOutput();
		}
		return result;
	}
}

registerSingleton(ITaskService, TaskService, true);
