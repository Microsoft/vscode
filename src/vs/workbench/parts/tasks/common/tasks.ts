/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as Types from 'vs/base/common/types';
import { IJSONSchemaMap } from 'vs/base/common/jsonSchema';
import * as Objects from 'vs/base/common/objects';
import { UriComponents } from 'vs/base/common/uri';

import { IExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import { ProblemMatcher } from 'vs/workbench/parts/tasks/common/problemMatcher';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';

export const TASK_RUNNING_STATE = new RawContextKey<boolean>('taskRunning', false);

export enum ShellQuoting {
	/**
	 * Use character escaping.
	 */
	Escape = 1,

	/**
	 * Use strong quoting
	 */
	Strong = 2,

	/**
	 * Use weak quoting.
	 */
	Weak = 3,
}

export const CUSTOMIZED_TASK_TYPE = '$customized';

export namespace ShellQuoting {
	export function from(this: void, value: string): ShellQuoting {
		if (!value) {
			return ShellQuoting.Strong;
		}
		switch (value.toLowerCase()) {
			case 'escape':
				return ShellQuoting.Escape;
			case 'strong':
				return ShellQuoting.Strong;
			case 'weak':
				return ShellQuoting.Weak;
			default:
				return ShellQuoting.Strong;
		}
	}
}

export interface ShellQuotingOptions {
	/**
	 * The character used to do character escaping.
	 */
	escape?: string | {
		escapeChar: string;
		charsToEscape: string;
	};

	/**
	 * The character used for string quoting.
	 */
	strong?: string;

	/**
	 * The character used for weak quoting.
	 */
	weak?: string;
}

export interface ShellConfiguration {
	/**
	 * The shell executable.
	 */
	executable?: string;

	/**
	 * The arguments to be passed to the shell executable.
	 */
	args?: string[];

	/**
	 * Which kind of quotes the shell supports.
	 */
	quoting?: ShellQuotingOptions;
}

export interface CommandOptions {

	/**
	 * The shell to use if the task is a shell command.
	 */
	shell?: ShellConfiguration;

	/**
	 * The current working directory of the executed program or shell.
	 * If omitted VSCode's current workspace root is used.
	 */
	cwd?: string;

	/**
	 * The environment of the executed program or shell. If omitted
	 * the parent process' environment is used.
	 */
	env?: { [key: string]: string; };
}

export enum RevealKind {
	/**
	 * Always brings the terminal to front if the task is executed.
	 */
	Always = 1,

	/**
	 * Only brings the terminal to front if a problem is detected executing the task
	 * (e.g. the task couldn't be started because).
	 */
	Silent = 2,

	/**
	 * The terminal never comes to front when the task is executed.
	 */
	Never = 3
}

export namespace RevealKind {
	export function fromString(this: void, value: string): RevealKind {
		switch (value.toLowerCase()) {
			case 'always':
				return RevealKind.Always;
			case 'silent':
				return RevealKind.Silent;
			case 'never':
				return RevealKind.Never;
			default:
				return RevealKind.Always;
		}
	}
}

export enum PanelKind {

	/**
	 * Shares a panel with other tasks. This is the default.
	 */
	Shared = 1,

	/**
	 * Uses a dedicated panel for this tasks. The panel is not
	 * shared with other tasks.
	 */
	Dedicated = 2,

	/**
	 * Creates a new panel whenever this task is executed.
	 */
	New = 3
}

export namespace PanelKind {
	export function fromString(value: string): PanelKind {
		switch (value.toLowerCase()) {
			case 'shared':
				return PanelKind.Shared;
			case 'dedicated':
				return PanelKind.Dedicated;
			case 'new':
				return PanelKind.New;
			default:
				return PanelKind.Shared;
		}
	}
}

export interface PresentationOptions {
	/**
	 * Controls whether the task output is reveal in the user interface.
	 * Defaults to `RevealKind.Always`.
	 */
	reveal: RevealKind;

	/**
	 * Controls whether the command associated with the task is echoed
	 * in the user interface.
	 */
	echo: boolean;

	/**
	 * Controls whether the panel showing the task output is taking focus.
	 */
	focus: boolean;

	/**
	 * Controls if the task panel is used for this task only (dedicated),
	 * shared between tasks (shared) or if a new panel is created on
	 * every task execution (new). Defaults to `TaskInstanceKind.Shared`
	 */
	panel: PanelKind;

	/**
	 * Controls whether to show the "Terminal will be reused by tasks, press any key to close it" message.
	 */
	showReuseMessage: boolean;

	/**
	 * Controls whether to clear the terminal before executing the task.
	 */
	clear: boolean;
}

export enum RuntimeType {
	Shell = 1,
	Process = 2
}

export namespace RuntimeType {
	export function fromString(value: string): RuntimeType {
		switch (value.toLowerCase()) {
			case 'shell':
				return RuntimeType.Shell;
			case 'process':
				return RuntimeType.Process;
			default:
				return RuntimeType.Process;
		}
	}
}

export interface QuotedString {
	value: string;
	quoting: ShellQuoting;
}

export type CommandString = string | QuotedString;

export namespace CommandString {
	export function value(value: CommandString): string {
		if (Types.isString(value)) {
			return value;
		} else {
			return value.value;
		}
	}
}

export interface CommandConfiguration {

	/**
	 * The task type
	 */
	runtime: RuntimeType;

	/**
	 * The command to execute
	 */
	name: CommandString;

	/**
	 * Additional command options.
	 */
	options?: CommandOptions;

	/**
	 * Command arguments.
	 */
	args?: CommandString[];

	/**
	 * The task selector if needed.
	 */
	taskSelector?: string;

	/**
	 * Whether to suppress the task name when merging global args
	 *
	 */
	suppressTaskName?: boolean;

	/**
	 * Describes how the task is presented in the UI.
	 */
	presentation: PresentationOptions;
}

export namespace TaskGroup {
	export const Clean: 'clean' = 'clean';

	export const Build: 'build' = 'build';

	export const Rebuild: 'rebuild' = 'rebuild';

	export const Test: 'test' = 'test';

	export function is(value: string): value is string {
		return value === Clean || value === Build || value === Rebuild || value === Test;
	}
}

export type TaskGroup = 'clean' | 'build' | 'rebuild' | 'test';


export const enum TaskScope {
	Global = 1,
	Workspace = 2,
	Folder = 3
}

export namespace TaskSourceKind {
	export const Workspace: 'workspace' = 'workspace';
	export const Extension: 'extension' = 'extension';
	export const InMemory: 'inMemory' = 'inMemory';
}

export interface TaskSourceConfigElement {
	workspaceFolder: IWorkspaceFolder;
	file: string;
	index: number;
	element: any;
}

export interface WorkspaceTaskSource {
	readonly kind: 'workspace';
	readonly label: string;
	readonly config: TaskSourceConfigElement;
	readonly customizes?: KeyedTaskIdentifier;
}

export interface ExtensionTaskSource {
	readonly kind: 'extension';
	readonly label: string;
	readonly extension: string;
	readonly scope: TaskScope;
	readonly workspaceFolder: IWorkspaceFolder | undefined;
}

export interface ExtensionTaskSourceTransfer {
	__workspaceFolder: UriComponents;
	__definition: { type: string;[name: string]: any };
}

export interface InMemoryTaskSource {
	readonly kind: 'inMemory';
	readonly label: string;
}

export type TaskSource = WorkspaceTaskSource | ExtensionTaskSource | InMemoryTaskSource;

export interface TaskIdentifier {
	type: string;
	[name: string]: any;
}

export interface KeyedTaskIdentifier extends TaskIdentifier {
	_key: string;
}

export interface TaskDependency {
	workspaceFolder: IWorkspaceFolder;
	task: string | KeyedTaskIdentifier;
}

export const enum GroupType {
	default = 'default',
	user = 'user'
}

export interface ConfigurationProperties {

	/**
	 * The task's name
	 */
	name?: string;

	/**
	 * The task's name
	 */
	identifier?: string;

	/**
	 * the task's group;
	 */
	group?: string;

	/**
	 * The group type
	 */
	groupType?: GroupType;

	/**
	 * The presentation options
	 */
	presentation?: PresentationOptions;

	/**
	 * The command options;
	 */
	options?: CommandOptions;

	/**
	 * Whether the task is a background task or not.
	 */
	isBackground?: boolean;

	/**
	 * Defines if the application can have only 1 active instance at a time
	 */
	instanceLimit?: boolean;

	/**
	 * Whether the task should prompt on close for confirmation if running.
	 */
	promptOnClose?: boolean;

	/**
	 * The other tasks this task depends on.
	 */
	dependsOn?: TaskDependency[];

	/**
	 * The problem watchers to use for this task
	 */
	problemMatchers?: (string | ProblemMatcher)[];
}

export interface CommonTask {

	/**
	 * The task's internal id
	 */
	_id: string;

	/**
	 * The cached label.
	 */
	_label: string;

	type: string;
}

export interface CustomTask extends CommonTask, ConfigurationProperties {

	type: '$customized'; // CUSTOMIZED_TASK_TYPE

	/**
	 * Indicated the source of the task (e.g tasks.json or extension)
	 */
	_source: WorkspaceTaskSource;

	name: string;

	identifier: string;

	hasDefinedMatchers: boolean;

	/**
	 * The command configuration
	 */
	command: CommandConfiguration;
}

export namespace CustomTask {
	export function is(value: any): value is CustomTask {
		let candidate: CustomTask = value;
		return candidate && candidate.type === CUSTOMIZED_TASK_TYPE;
	}
	export function getDefinition(task: CustomTask): KeyedTaskIdentifier {
		let type: string;
		if (task.command !== void 0) {
			type = task.command.runtime === RuntimeType.Shell ? 'shell' : 'process';
		} else {
			type = '$composite';
		}
		let result: KeyedTaskIdentifier = {
			type,
			_key: task._id,
			id: task._id
		};
		return result;
	}
	export function customizes(task: CustomTask): KeyedTaskIdentifier | undefined {
		if (task._source && task._source.customizes) {
			return task._source.customizes;
		}
		return undefined;
	}
}

export interface ConfiguringTask extends CommonTask, ConfigurationProperties {

	/**
	 * Indicated the source of the task (e.g tasks.json or extension)
	 */
	_source: WorkspaceTaskSource;

	configures: KeyedTaskIdentifier;
}

export namespace ConfiguringTask {
	export function is(value: any): value is ConfiguringTask {
		let candidate: ConfiguringTask = value;
		return candidate && candidate.configures && Types.isString(candidate.configures.type) && value.command === void 0;
	}
}

export interface ContributedTask extends CommonTask, ConfigurationProperties {

	/**
	 * Indicated the source of the task (e.g tasks.json or extension)
	 */
	_source: ExtensionTaskSource;

	defines: KeyedTaskIdentifier;

	hasDefinedMatchers: boolean;

	/**
	 * The command configuration
	 */
	command: CommandConfiguration;
}

export namespace ContributedTask {
	export function is(value: any): value is ContributedTask {
		let candidate: ContributedTask = value;
		return candidate && candidate.defines && Types.isString(candidate.defines.type) && candidate.command !== void 0;
	}
}

export interface InMemoryTask extends CommonTask, ConfigurationProperties {
	/**
	 * Indicated the source of the task (e.g tasks.json or extension)
	 */
	_source: InMemoryTaskSource;

	type: 'inMemory';

	identifier: string;
}

export namespace InMemoryTask {
	export function is(value: any): value is InMemoryTask {
		let candidate = value as InMemoryTask;
		return candidate && candidate._source && candidate._source.kind === TaskSourceKind.InMemory;
	}
}

export type Task = CustomTask | ContributedTask | InMemoryTask;

export namespace Task {
	export function getRecentlyUsedKey(task: Task): string | undefined {
		interface CustomKey {
			type: string;
			folder: string;
			id: string;
		}
		interface ContributedKey {
			type: string;
			scope: number;
			folder?: string;
			id: string;
		}
		if (InMemoryTask.is(task)) {
			return undefined;
		}
		if (CustomTask.is(task)) {
			let workspaceFolder = task._source.config.workspaceFolder;
			if (!workspaceFolder) {
				return undefined;
			}
			let key: CustomKey = { type: CUSTOMIZED_TASK_TYPE, folder: workspaceFolder.uri.toString(), id: task.identifier };
			return JSON.stringify(key);
		}
		if (ContributedTask.is(task)) {
			let key: ContributedKey = { type: 'contributed', scope: task._source.scope, id: task._id };
			if (task._source.scope === TaskScope.Folder && task._source.workspaceFolder) {
				key.folder = task._source.workspaceFolder.uri.toString();
			}
			return JSON.stringify(key);
		}
		return undefined;
	}

	export function getMapKey(task: Task): string {
		if (CustomTask.is(task)) {
			let workspaceFolder = task._source.config.workspaceFolder;
			return workspaceFolder ? `${workspaceFolder.uri.toString()}|${task._id}` : task._id;
		} else if (ContributedTask.is(task)) {
			let workspaceFolder = task._source.workspaceFolder;
			return workspaceFolder
				? `${task._source.scope.toString()}|${workspaceFolder.uri.toString()}|${task._id}`
				: `${task._source.scope.toString()}|${task._id}`;
		} else {
			return task._id;
		}
	}

	export function getWorkspaceFolder(task: Task): IWorkspaceFolder | undefined {
		if (CustomTask.is(task)) {
			return task._source.config.workspaceFolder;
		} else if (ContributedTask.is(task)) {
			return task._source.workspaceFolder;
		} else {
			return undefined;
		}
	}

	export function clone(task: Task): Task {
		return Objects.assign({}, task);
	}

	export function getTelemetryKind(task: Task): string {
		if (ContributedTask.is(task)) {
			return 'extension';
		} else if (CustomTask.is(task)) {
			if (task._source.customizes) {
				return 'workspace>extension';
			} else {
				return 'workspace';
			}
		} else if (InMemoryTask.is(task)) {
			return 'composite';
		} else {
			return 'unknown';
		}
	}

	export function matches(task: Task, key: string | KeyedTaskIdentifier, compareId: boolean = false): boolean {
		if (key === void 0) {
			return false;
		}
		if (Types.isString(key)) {
			return key === task._label || key === task.identifier || (compareId && key === task._id);
		}
		let identifier = Task.getTaskDefinition(task, true);
		return identifier !== void 0 && identifier._key === key._key;
	}

	export function getQualifiedLabel(task: Task): string {
		let workspaceFolder = getWorkspaceFolder(task);
		if (workspaceFolder) {
			return `${task._label} (${workspaceFolder.name})`;
		} else {
			return task._label;
		}
	}

	export function getTaskDefinition(task: Task, useSource: boolean = false): KeyedTaskIdentifier | undefined {
		if (ContributedTask.is(task)) {
			return task.defines;
		} else if (CustomTask.is(task)) {
			if (useSource && task._source.customizes !== void 0) {
				return task._source.customizes;
			} else {
				return CustomTask.getDefinition(task);
			}
		} else {
			return undefined;
		}
	}

	export function getTaskExecution(task: Task): TaskExecution {
		let result: TaskExecution = {
			id: task._id,
			task: task
		};
		return result;
	}
}

export interface TaskExecution {
	id: string;
	task: Task;
}

export enum ExecutionEngine {
	Process = 1,
	Terminal = 2
}

export namespace ExecutionEngine {
	export const _default: ExecutionEngine = ExecutionEngine.Terminal;
}

export const enum JsonSchemaVersion {
	V0_1_0 = 1,
	V2_0_0 = 2
}

export interface TaskSet {
	tasks: Task[];
	extension?: IExtensionDescription;
}

export interface TaskDefinition {
	extensionId: string;
	taskType: string;
	required: string[];
	properties: IJSONSchemaMap;
}

export class TaskSorter {

	private _order: Map<string, number> = new Map();

	constructor(workspaceFolders: IWorkspaceFolder[]) {
		for (let i = 0; i < workspaceFolders.length; i++) {
			this._order.set(workspaceFolders[i].uri.toString(), i);
		}
	}

	public compare(a: Task, b: Task): number {
		let aw = Task.getWorkspaceFolder(a);
		let bw = Task.getWorkspaceFolder(b);
		if (aw && bw) {
			let ai = this._order.get(aw.uri.toString());
			ai = ai === void 0 ? 0 : ai + 1;
			let bi = this._order.get(bw.uri.toString());
			bi = bi === void 0 ? 0 : bi + 1;
			if (ai === bi) {
				return a._label.localeCompare(b._label);
			} else {
				return ai - bi;
			}
		} else if (!aw && bw) {
			return -1;
		} else if (aw && !bw) {
			return +1;
		} else {
			return 0;
		}
	}
}

export const enum TaskEventKind {
	Start = 'start',
	ProcessStarted = 'processStarted',
	Active = 'active',
	Inactive = 'inactive',
	Changed = 'changed',
	Terminated = 'terminated',
	ProcessEnded = 'processEnded',
	End = 'end'
}


export const enum TaskRunType {
	SingleRun = 'singleRun',
	Background = 'background'
}

export interface TaskEvent {
	kind: TaskEventKind;
	taskId?: string;
	taskName?: string;
	runType?: TaskRunType;
	group?: string;
	processId?: number;
	exitCode?: number;
	__task?: Task;
}

export namespace TaskEvent {
	export function create(kind: TaskEventKind.ProcessStarted, task: Task, processId: number): TaskEvent;
	export function create(kind: TaskEventKind.ProcessEnded, task: Task, exitCode: number): TaskEvent;
	export function create(kind: TaskEventKind.Start | TaskEventKind.Active | TaskEventKind.Inactive | TaskEventKind.Terminated | TaskEventKind.End, task: Task): TaskEvent;
	export function create(kind: TaskEventKind.Changed): TaskEvent;
	export function create(kind: TaskEventKind, task?: Task, processIdOrExitCode?: number): TaskEvent {
		if (task) {
			let result = {
				kind: kind,
				taskId: task._id,
				taskName: task.name,
				runType: task.isBackground ? TaskRunType.Background : TaskRunType.SingleRun,
				group: task.group,
				processId: undefined as number | undefined,
				exitCode: undefined as number | undefined,
				__task: task,
			};
			if (kind === TaskEventKind.ProcessStarted) {
				result.processId = processIdOrExitCode;
			} else if (kind === TaskEventKind.ProcessEnded) {
				result.exitCode = processIdOrExitCode;
			}
			return Object.freeze(result);
		} else {
			return Object.freeze({ kind: TaskEventKind.Changed });
		}
	}
}