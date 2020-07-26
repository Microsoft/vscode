/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import Severity from 'vs/base/common/severity';
import { TerminateResponse } from 'vs/base/common/processes';
import { Event } from 'vs/base/common/event';
import { Platform } from 'vs/base/common/platform';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { Task, TaskEvent, KeyedTaskIdentifier } from './tasks';
import { ConfigurationTarget } from 'vs/platform/configuration/common/configuration';

export const enum TaskErrors {
	NotConfigured,
	RunningTask,
	NoBuildTask,
	NoTestTask,
	ConfigValidationError,
	TaskNotFound,
	NoValidTaskRunner,
	UnknownError
}

export class TaskError {
	public severity: Severity;
	public message: string;
	public code: TaskErrors;

	constructor(severity: Severity, message: string, code: TaskErrors) {
		this.severity = severity;
		this.message = message;
		this.code = code;
	}
}

/* __GDPR__FRAGMENT__
	"TelemetryEvent" : {
		"trigger" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"runner": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"taskKind": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"command": { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
		"success": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true },
		"exitCode": { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
	}
*/
export interface TelemetryEvent {
	// How the task got trigger. Is either shortcut or command
	trigger: string;

	runner: 'terminal' | 'output';

	taskKind: string;

	// The command triggered
	command: string;

	// Whether the task ran successful
	success: boolean;

	// The exit code
	exitCode?: number;
}

export namespace Triggers {
	export let shortcut: string = 'shortcut';
	export let command: string = 'command';
}

export interface ITaskSummary {
	/**
	 * Exit code of the process.
	 */
	exitCode?: number;
}

export const enum TaskExecuteKind {
	Started = 1,
	Active = 2
}

export interface ITaskExecuteResult {
	kind: TaskExecuteKind;
	promise: Promise<ITaskSummary>;
	task: Task;
	started?: {
		restartOnFileChanges?: string;
	};
	active?: {
		same: boolean;
		background: boolean;
	};
}

export interface ITaskResolver {
	resolve(uri: URI | string, identifier: string | KeyedTaskIdentifier | undefined): Promise<Task | undefined>;
}

export interface TaskTerminateResponse extends TerminateResponse {
	task: Task | undefined;
}

export interface ResolveSet {
	process?: {
		name: string;
		cwd?: string;
		path?: string;
	};
	variables: Set<string>;
}

export interface ResolvedVariables {
	process?: string;
	variables: Map<string, string>;
}

export interface TaskSystemInfo {
	platform: Platform;
	context: any;
	uriProvider: (this: void, path: string) => URI;
	resolveVariables(workspaceFolder: IWorkspaceFolder, toResolve: ResolveSet, target: ConfigurationTarget): Promise<ResolvedVariables | undefined>;
	getDefaultShellAndArgs(): Promise<{ shell: string, args: string[] | string | undefined }>;
	findExecutable(command: string, cwd?: string, paths?: string[]): Promise<string | undefined>;
}

export interface TaskSystemInfoResolver {
	(workspaceFolder: IWorkspaceFolder): TaskSystemInfo | undefined;
}

export interface ITaskSystem {
	onDidStateChange: Event<TaskEvent>;
	run(task: Task, resolver: ITaskResolver): ITaskExecuteResult;
	rerun(): ITaskExecuteResult | undefined;
	isActive(): Promise<boolean>;
	isActiveSync(): boolean;
	getActiveTasks(): Task[];
	getLastInstance(task: Task): Task | undefined;
	getBusyTasks(): Task[];
	canAutoTerminate(): boolean;
	terminate(task: Task): Promise<TaskTerminateResponse>;
	terminateAll(): Promise<TaskTerminateResponse[]>;
	revealTask(task: Task): boolean;
	customExecutionComplete(task: Task, result: number): Promise<void>;
	isTaskVisible(task: Task): boolean;
}
