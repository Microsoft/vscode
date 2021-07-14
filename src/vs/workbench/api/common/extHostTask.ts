/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from 'vs/base/common/uri';
import { asPromise } from 'vs/base/common/async';
import { Event, Emitter } from 'vs/base/common/event';

import { MainContext, MainThreadTaskShape, ExtHostTaskShape } from 'vs/workbench/api/common/extHost.protocol';
import * as Objects from 'vs/base/common/objects';
import * as types from 'vs/workbench/api/common/extHostTypes';
import { IExtHostWorkspaceProvider, IExtHostWorkspace } from 'vs/workbench/api/common/extHostWorkspace';
import type * as vscode from 'vscode';
import * as tasks from '../common/shared/tasks';
import { IExtHostDocumentsAndEditors } from 'vs/workbench/api/common/extHostDocumentsAndEditors';
import { IExtHostConfiguration } from 'vs/workbench/api/common/extHostConfiguration';
import { CancellationToken } from 'vs/base/common/cancellation';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { IExtHostTerminalService } from 'vs/workbench/api/common/extHostTerminalService';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Schemas } from 'vs/base/common/network';
import * as Platform from 'vs/base/common/platform';
import { ILogService } from 'vs/platform/log/common/log';
import { IExtHostApiDeprecationService } from 'vs/workbench/api/common/extHostApiDeprecationService';
import { USER_TASKS_GROUP_KEY } from 'vs/workbench/contrib/tasks/common/taskService';
import { NotSupportedError } from 'vs/base/common/errors';

export interface IExtHostTask extends ExtHostTaskShape {

	readonly _serviceBrand: undefined;

	taskExecutions: vscode.TaskExecution[];
	onDidStartTask: Event<vscode.TaskStartEvent>;
	onDidEndTask: Event<vscode.TaskEndEvent>;
	onDidStartTaskProcess: Event<vscode.TaskProcessStartEvent>;
	onDidEndTaskProcess: Event<vscode.TaskProcessEndEvent>;

	registerTaskProvider(extension: IExtensionDescription, type: string, provider: vscode.TaskProvider): vscode.Disposable;
	registerTaskSystem(scheme: string, info: tasks.TaskSystemInfoDTO): void;
	fetchTasks(filter?: vscode.TaskFilter): Promise<vscode.Task[]>;
	executeTask(extension: IExtensionDescription, task: vscode.Task): Promise<vscode.TaskExecution>;
	terminateTask(execution: vscode.TaskExecution): Promise<void>;
}

export namespace TaskDefinitionDTO {
	export function from(value: vscode.TaskDefinition): tasks.TaskDefinitionDTO | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: tasks.TaskDefinitionDTO): vscode.TaskDefinition | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
}

export namespace TaskPresentationOptionsDTO {
	export function from(value: vscode.TaskPresentationOptions): tasks.TaskPresentationOptionsDTO | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: tasks.TaskPresentationOptionsDTO): vscode.TaskPresentationOptions | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
}

export namespace ProcessExecutionOptionsDTO {
	export function from(value: vscode.ProcessExecutionOptions): tasks.ProcessExecutionOptionsDTO | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: tasks.ProcessExecutionOptionsDTO): vscode.ProcessExecutionOptions | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
}

export namespace ProcessExecutionDTO {
	export function is(value: tasks.ShellExecutionDTO | tasks.ProcessExecutionDTO | tasks.CustomExecutionDTO | undefined): value is tasks.ProcessExecutionDTO {
		if (value) {
			const candidate = value as tasks.ProcessExecutionDTO;
			return candidate && !!candidate.process;
		} else {
			return false;
		}
	}
	export function from(value: vscode.ProcessExecution): tasks.ProcessExecutionDTO | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		const result: tasks.ProcessExecutionDTO = {
			process: value.process,
			args: value.args
		};
		if (value.options) {
			result.options = ProcessExecutionOptionsDTO.from(value.options);
		}
		return result;
	}
	export function to(value: tasks.ProcessExecutionDTO): types.ProcessExecution | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		return new types.ProcessExecution(value.process, value.args, value.options);
	}
}

export namespace ShellExecutionOptionsDTO {
	export function from(value: vscode.ShellExecutionOptions): tasks.ShellExecutionOptionsDTO | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: tasks.ShellExecutionOptionsDTO): vscode.ShellExecutionOptions | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		return value;
	}
}

export namespace ShellExecutionDTO {
	export function is(value: tasks.ShellExecutionDTO | tasks.ProcessExecutionDTO | tasks.CustomExecutionDTO | undefined): value is tasks.ShellExecutionDTO {
		if (value) {
			const candidate = value as tasks.ShellExecutionDTO;
			return candidate && (!!candidate.commandLine || !!candidate.command);
		} else {
			return false;
		}
	}
	export function from(value: vscode.ShellExecution): tasks.ShellExecutionDTO | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		const result: tasks.ShellExecutionDTO = {
		};
		if (value.commandLine !== undefined) {
			result.commandLine = value.commandLine;
		} else {
			result.command = value.command;
			result.args = value.args;
		}
		if (value.options) {
			result.options = ShellExecutionOptionsDTO.from(value.options);
		}
		return result;
	}
	export function to(value: tasks.ShellExecutionDTO): types.ShellExecution | undefined {
		if (value === undefined || value === null || (value.command === undefined && value.commandLine === undefined)) {
			return undefined;
		}
		if (value.commandLine) {
			return new types.ShellExecution(value.commandLine, value.options);
		} else {
			return new types.ShellExecution(value.command!, value.args ? value.args : [], value.options);
		}
	}
}

export namespace CustomExecutionDTO {
	export function is(value: tasks.ShellExecutionDTO | tasks.ProcessExecutionDTO | tasks.CustomExecutionDTO | undefined): value is tasks.CustomExecutionDTO {
		if (value) {
			let candidate = value as tasks.CustomExecutionDTO;
			return candidate && candidate.customExecution === 'customExecution';
		} else {
			return false;
		}
	}

	export function from(value: vscode.CustomExecution): tasks.CustomExecutionDTO {
		return {
			customExecution: 'customExecution'
		};
	}

	export function to(taskId: string, providedCustomExeutions: Map<string, types.CustomExecution>): types.CustomExecution | undefined {
		return providedCustomExeutions.get(taskId);
	}
}


export namespace TaskHandleDTO {
	export function from(value: types.Task, workspaceService?: IExtHostWorkspace): tasks.TaskHandleDTO {
		let folder: UriComponents | string;
		if (value.scope !== undefined && typeof value.scope !== 'number') {
			folder = value.scope.uri;
		} else if (value.scope !== undefined && typeof value.scope === 'number') {
			if ((value.scope === types.TaskScope.Workspace) && workspaceService && workspaceService.workspaceFile) {
				folder = workspaceService.workspaceFile;
			} else {
				folder = USER_TASKS_GROUP_KEY;
			}
		}
		return {
			id: value._id!,
			workspaceFolder: folder!
		};
	}
}
export namespace TaskGroupDTO {
	export function from(value: vscode.TaskGroup2): tasks.TaskGroupDTO | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		return { _id: value.id, isDefault: value.isDefault };
	}
}

export namespace TaskDTO {
	export function fromMany(tasks: vscode.Task[], extension: IExtensionDescription): tasks.TaskDTO[] {
		if (tasks === undefined || tasks === null) {
			return [];
		}
		const result: tasks.TaskDTO[] = [];
		for (let task of tasks) {
			const converted = from(task, extension);
			if (converted) {
				result.push(converted);
			}
		}
		return result;
	}

	export function from(value: vscode.Task, extension: IExtensionDescription): tasks.TaskDTO | undefined {
		if (value === undefined || value === null) {
			return undefined;
		}
		let execution: tasks.ShellExecutionDTO | tasks.ProcessExecutionDTO | tasks.CustomExecutionDTO | undefined;
		if (value.execution instanceof types.ProcessExecution) {
			execution = ProcessExecutionDTO.from(value.execution);
		} else if (value.execution instanceof types.ShellExecution) {
			execution = ShellExecutionDTO.from(value.execution);
		} else if (value.execution && value.execution instanceof types.CustomExecution) {
			execution = CustomExecutionDTO.from(<types.CustomExecution>value.execution);
		}

		const definition: tasks.TaskDefinitionDTO | undefined = TaskDefinitionDTO.from(value.definition);
		let scope: number | UriComponents;
		if (value.scope) {
			if (typeof value.scope === 'number') {
				scope = value.scope;
			} else {
				scope = value.scope.uri;
			}
		} else {
			// To continue to support the deprecated task constructor that doesn't take a scope, we must add a scope here:
			scope = types.TaskScope.Workspace;
		}
		if (!definition || !scope) {
			return undefined;
		}
		const result: tasks.TaskDTO = {
			_id: (value as types.Task)._id!,
			definition,
			name: value.name,
			source: {
				extensionId: extension.identifier.value,
				label: value.source,
				scope: scope
			},
			execution: execution!,
			isBackground: value.isBackground,
			group: TaskGroupDTO.from(value.group as vscode.TaskGroup2),
			presentationOptions: TaskPresentationOptionsDTO.from(value.presentationOptions),
			problemMatchers: value.problemMatchers,
			hasDefinedMatchers: (value as types.Task).hasDefinedMatchers,
			runOptions: value.runOptions ? value.runOptions : { reevaluateOnRerun: true },
			detail: value.detail
		};
		return result;
	}
	export async function to(value: tasks.TaskDTO | undefined, workspace: IExtHostWorkspaceProvider, providedCustomExeutions: Map<string, types.CustomExecution>): Promise<types.Task | undefined> {
		if (value === undefined || value === null) {
			return undefined;
		}
		let execution: types.ShellExecution | types.ProcessExecution | types.CustomExecution | undefined;
		if (ProcessExecutionDTO.is(value.execution)) {
			execution = ProcessExecutionDTO.to(value.execution);
		} else if (ShellExecutionDTO.is(value.execution)) {
			execution = ShellExecutionDTO.to(value.execution);
		} else if (CustomExecutionDTO.is(value.execution)) {
			execution = CustomExecutionDTO.to(value._id, providedCustomExeutions);
		}
		const definition: vscode.TaskDefinition | undefined = TaskDefinitionDTO.to(value.definition);
		let scope: vscode.TaskScope.Global | vscode.TaskScope.Workspace | vscode.WorkspaceFolder | undefined;
		if (value.source) {
			if (value.source.scope !== undefined) {
				if (typeof value.source.scope === 'number') {
					scope = value.source.scope;
				} else {
					scope = await workspace.resolveWorkspaceFolder(URI.revive(value.source.scope));
				}
			} else {
				scope = types.TaskScope.Workspace;
			}
		}
		if (!definition || !scope) {
			return undefined;
		}
		const result = new types.Task(definition, scope, value.name!, value.source.label, execution, value.problemMatchers);
		if (value.isBackground !== undefined) {
			result.isBackground = value.isBackground;
		}
		if (value.group !== undefined) {
			result.group = types.TaskGroup.from(value.group._id);
			if (result.group) {
				result.group = Objects.deepClone(result.group);
				if (value.group.isDefault) {
					result.group.isDefault = value.group.isDefault;
				}
			}
		}
		if (value.presentationOptions) {
			result.presentationOptions = TaskPresentationOptionsDTO.to(value.presentationOptions)!;
		}
		if (value._id) {
			result._id = value._id;
		}
		if (value.detail) {
			result.detail = value.detail;
		}
		return result;
	}
}

export namespace TaskFilterDTO {
	export function from(value: vscode.TaskFilter | undefined): tasks.TaskFilterDTO | undefined {
		return value;
	}

	export function to(value: tasks.TaskFilterDTO): vscode.TaskFilter | undefined {
		if (!value) {
			return undefined;
		}
		return Object.assign(Object.create(null), value);
	}
}

class TaskExecutionImpl implements vscode.TaskExecution {

	readonly #tasks: ExtHostTaskBase;

	constructor(tasks: ExtHostTaskBase, readonly _id: string, private readonly _task: vscode.Task) {
		this.#tasks = tasks;
	}

	public get task(): vscode.Task {
		return this._task;
	}

	public terminate(): void {
		this.#tasks.terminateTask(this);
	}

	public fireDidStartProcess(value: tasks.TaskProcessStartedDTO): void {
	}

	public fireDidEndProcess(value: tasks.TaskProcessEndedDTO): void {
	}
}

export namespace TaskExecutionDTO {
	export function from(value: vscode.TaskExecution): tasks.TaskExecutionDTO {
		return {
			id: (value as TaskExecutionImpl)._id,
			task: undefined
		};
	}
}

export interface HandlerData {
	type: string;
	provider: vscode.TaskProvider;
	extension: IExtensionDescription;
}

export abstract class ExtHostTaskBase implements ExtHostTaskShape, IExtHostTask {
	readonly _serviceBrand: undefined;

	protected readonly _proxy: MainThreadTaskShape;
	protected readonly _workspaceProvider: IExtHostWorkspaceProvider;
	protected readonly _editorService: IExtHostDocumentsAndEditors;
	protected readonly _configurationService: IExtHostConfiguration;
	protected readonly _terminalService: IExtHostTerminalService;
	protected readonly _logService: ILogService;
	protected readonly _deprecationService: IExtHostApiDeprecationService;
	protected _handleCounter: number;
	protected _handlers: Map<number, HandlerData>;
	protected _taskExecutions: Map<string, TaskExecutionImpl>;
	protected _taskExecutionPromises: Map<string, Promise<TaskExecutionImpl>>;
	protected _providedCustomExecutions2: Map<string, types.CustomExecution>;
	private _notProvidedCustomExecutions: Set<string>; // Used for custom executions tasks that are created and run through executeTask.
	protected _activeCustomExecutions2: Map<string, types.CustomExecution>;
	private _lastStartedTask: string | undefined;
	protected readonly _onDidExecuteTask: Emitter<vscode.TaskStartEvent> = new Emitter<vscode.TaskStartEvent>();
	protected readonly _onDidTerminateTask: Emitter<vscode.TaskEndEvent> = new Emitter<vscode.TaskEndEvent>();

	protected readonly _onDidTaskProcessStarted: Emitter<vscode.TaskProcessStartEvent> = new Emitter<vscode.TaskProcessStartEvent>();
	protected readonly _onDidTaskProcessEnded: Emitter<vscode.TaskProcessEndEvent> = new Emitter<vscode.TaskProcessEndEvent>();

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostInitDataService initData: IExtHostInitDataService,
		@IExtHostWorkspace workspaceService: IExtHostWorkspace,
		@IExtHostDocumentsAndEditors editorService: IExtHostDocumentsAndEditors,
		@IExtHostConfiguration configurationService: IExtHostConfiguration,
		@IExtHostTerminalService extHostTerminalService: IExtHostTerminalService,
		@ILogService logService: ILogService,
		@IExtHostApiDeprecationService deprecationService: IExtHostApiDeprecationService
	) {
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadTask);
		this._workspaceProvider = workspaceService;
		this._editorService = editorService;
		this._configurationService = configurationService;
		this._terminalService = extHostTerminalService;
		this._handleCounter = 0;
		this._handlers = new Map<number, HandlerData>();
		this._taskExecutions = new Map<string, TaskExecutionImpl>();
		this._taskExecutionPromises = new Map<string, Promise<TaskExecutionImpl>>();
		this._providedCustomExecutions2 = new Map<string, types.CustomExecution>();
		this._notProvidedCustomExecutions = new Set<string>();
		this._activeCustomExecutions2 = new Map<string, types.CustomExecution>();
		this._logService = logService;
		this._deprecationService = deprecationService;
		this._proxy.$registerSupportedExecutions(true);
	}

	public registerTaskProvider(extension: IExtensionDescription, type: string, provider: vscode.TaskProvider): vscode.Disposable {
		if (!provider) {
			return new types.Disposable(() => { });
		}
		const handle = this.nextHandle();
		this._handlers.set(handle, { type, provider, extension });
		this._proxy.$registerTaskProvider(handle, type);
		return new types.Disposable(() => {
			this._handlers.delete(handle);
			this._proxy.$unregisterTaskProvider(handle);
		});
	}

	public registerTaskSystem(scheme: string, info: tasks.TaskSystemInfoDTO): void {
		this._proxy.$registerTaskSystem(scheme, info);
	}

	public fetchTasks(filter?: vscode.TaskFilter): Promise<vscode.Task[]> {
		return this._proxy.$fetchTasks(TaskFilterDTO.from(filter)).then(async (values) => {
			const result: vscode.Task[] = [];
			for (let value of values) {
				const task = await TaskDTO.to(value, this._workspaceProvider, this._providedCustomExecutions2);
				if (task) {
					result.push(task);
				}
			}
			return result;
		});
	}

	public abstract executeTask(extension: IExtensionDescription, task: vscode.Task): Promise<vscode.TaskExecution>;

	public get taskExecutions(): vscode.TaskExecution[] {
		const result: vscode.TaskExecution[] = [];
		this._taskExecutions.forEach(value => result.push(value));
		return result;
	}

	public terminateTask(execution: vscode.TaskExecution): Promise<void> {
		if (!(execution instanceof TaskExecutionImpl)) {
			throw new Error('No valid task execution provided');
		}
		return this._proxy.$terminateTask((execution as TaskExecutionImpl)._id);
	}

	public get onDidStartTask(): Event<vscode.TaskStartEvent> {
		return this._onDidExecuteTask.event;
	}

	public async $onDidStartTask(execution: tasks.TaskExecutionDTO, terminalId: number, resolvedDefinition: tasks.TaskDefinitionDTO): Promise<void> {
		const customExecution: types.CustomExecution | undefined = this._providedCustomExecutions2.get(execution.id);
		if (customExecution) {
			if (this._activeCustomExecutions2.get(execution.id) !== undefined) {
				throw new Error('We should not be trying to start the same custom task executions twice.');
			}

			// Clone the custom execution to keep the original untouched. This is important for multiple runs of the same task.
			this._activeCustomExecutions2.set(execution.id, customExecution);
			this._terminalService.attachPtyToTerminal(terminalId, await customExecution.callback(resolvedDefinition));
		}
		this._lastStartedTask = execution.id;

		this._onDidExecuteTask.fire({
			execution: await this.getTaskExecution(execution)
		});
	}

	public get onDidEndTask(): Event<vscode.TaskEndEvent> {
		return this._onDidTerminateTask.event;
	}

	public async $OnDidEndTask(execution: tasks.TaskExecutionDTO): Promise<void> {
		const _execution = await this.getTaskExecution(execution);
		this._taskExecutionPromises.delete(execution.id);
		this._taskExecutions.delete(execution.id);
		this.customExecutionComplete(execution);
		this._onDidTerminateTask.fire({
			execution: _execution
		});
	}

	public get onDidStartTaskProcess(): Event<vscode.TaskProcessStartEvent> {
		return this._onDidTaskProcessStarted.event;
	}

	public async $onDidStartTaskProcess(value: tasks.TaskProcessStartedDTO): Promise<void> {
		const execution = await this.getTaskExecution(value.id);
		this._onDidTaskProcessStarted.fire({
			execution: execution,
			processId: value.processId
		});
	}

	public get onDidEndTaskProcess(): Event<vscode.TaskProcessEndEvent> {
		return this._onDidTaskProcessEnded.event;
	}

	public async $onDidEndTaskProcess(value: tasks.TaskProcessEndedDTO): Promise<void> {
		const execution = await this.getTaskExecution(value.id);
		this._onDidTaskProcessEnded.fire({
			execution: execution,
			exitCode: value.exitCode
		});
	}

	protected abstract provideTasksInternal(validTypes: { [key: string]: boolean; }, taskIdPromises: Promise<void>[], handler: HandlerData, value: vscode.Task[] | null | undefined): { tasks: tasks.TaskDTO[], extension: IExtensionDescription };

	public $provideTasks(handle: number, validTypes: { [key: string]: boolean; }): Thenable<tasks.TaskSetDTO> {
		const handler = this._handlers.get(handle);
		if (!handler) {
			return Promise.reject(new Error('no handler found'));
		}

		// Set up a list of task ID promises that we can wait on
		// before returning the provided tasks. The ensures that
		// our task IDs are calculated for any custom execution tasks.
		// Knowing this ID ahead of time is needed because when a task
		// start event is fired this is when the custom execution is called.
		// The task start event is also the first time we see the ID from the main
		// thread, which is too late for us because we need to save an map
		// from an ID to the custom execution function. (Kind of a cart before the horse problem).
		const taskIdPromises: Promise<void>[] = [];
		const fetchPromise = asPromise(() => handler.provider.provideTasks(CancellationToken.None)).then(value => {
			return this.provideTasksInternal(validTypes, taskIdPromises, handler, value);
		});

		return new Promise((resolve) => {
			fetchPromise.then((result) => {
				Promise.all(taskIdPromises).then(() => {
					resolve(result);
				});
			});
		});
	}

	protected abstract resolveTaskInternal(resolvedTaskDTO: tasks.TaskDTO): Promise<tasks.TaskDTO | undefined>;

	public async $resolveTask(handle: number, taskDTO: tasks.TaskDTO): Promise<tasks.TaskDTO | undefined> {
		const handler = this._handlers.get(handle);
		if (!handler) {
			return Promise.reject(new Error('no handler found'));
		}

		if (taskDTO.definition.type !== handler.type) {
			throw new Error(`Unexpected: Task of type [${taskDTO.definition.type}] cannot be resolved by provider of type [${handler.type}].`);
		}

		const task = await TaskDTO.to(taskDTO, this._workspaceProvider, this._providedCustomExecutions2);
		if (!task) {
			throw new Error('Unexpected: Task cannot be resolved.');
		}

		const resolvedTask = await handler.provider.resolveTask(task, CancellationToken.None);
		if (!resolvedTask) {
			return;
		}

		this.checkDeprecation(resolvedTask, handler);

		const resolvedTaskDTO: tasks.TaskDTO | undefined = TaskDTO.from(resolvedTask, handler.extension);
		if (!resolvedTaskDTO) {
			throw new Error('Unexpected: Task cannot be resolved.');
		}

		if (resolvedTask.definition !== task.definition) {
			throw new Error('Unexpected: The resolved task definition must be the same object as the original task definition. The task definition cannot be changed.');
		}

		if (CustomExecutionDTO.is(resolvedTaskDTO.execution)) {
			await this.addCustomExecution(resolvedTaskDTO, resolvedTask, true);
		}

		return await this.resolveTaskInternal(resolvedTaskDTO);
	}

	public abstract $resolveVariables(uriComponents: UriComponents, toResolve: { process?: { name: string; cwd?: string; path?: string }, variables: string[] }): Promise<{ process?: string, variables: { [key: string]: string; } }>;

	private nextHandle(): number {
		return this._handleCounter++;
	}

	protected async addCustomExecution(taskDTO: tasks.TaskDTO, task: vscode.Task, isProvided: boolean): Promise<void> {
		const taskId = await this._proxy.$createTaskId(taskDTO);
		if (!isProvided && !this._providedCustomExecutions2.has(taskId)) {
			this._notProvidedCustomExecutions.add(taskId);
		}
		this._providedCustomExecutions2.set(taskId, <types.CustomExecution>task.execution);
	}

	protected async getTaskExecution(execution: tasks.TaskExecutionDTO | string, task?: vscode.Task): Promise<TaskExecutionImpl> {
		if (typeof execution === 'string') {
			const taskExecution = this._taskExecutionPromises.get(execution);
			if (!taskExecution) {
				throw new Error('Unexpected: The specified task is missing an execution');
			}
			return taskExecution;
		}

		let result: Promise<TaskExecutionImpl> | undefined = this._taskExecutionPromises.get(execution.id);
		if (result) {
			return result;
		}
		const createdResult: Promise<TaskExecutionImpl> = new Promise(async (resolve, reject) => {
			const taskToCreate = task ? task : await TaskDTO.to(execution.task, this._workspaceProvider, this._providedCustomExecutions2);
			if (!taskToCreate) {
				reject('Unexpected: Task does not exist.');
			} else {
				resolve(new TaskExecutionImpl(this, execution.id, taskToCreate));
			}
		});

		this._taskExecutionPromises.set(execution.id, createdResult);
		return createdResult.then(executionCreatedResult => {
			this._taskExecutions.set(execution.id, executionCreatedResult);
			return executionCreatedResult;
		}, rejected => {
			return Promise.reject(rejected);
		});
	}

	protected checkDeprecation(task: vscode.Task, handler: HandlerData) {
		const tTask = (task as types.Task);
		if (tTask._deprecated) {
			this._deprecationService.report('Task.constructor', handler.extension, 'Use the Task constructor that takes a `scope` instead.');
		}
	}

	private customExecutionComplete(execution: tasks.TaskExecutionDTO): void {
		const extensionCallback2: vscode.CustomExecution | undefined = this._activeCustomExecutions2.get(execution.id);
		if (extensionCallback2) {
			this._activeCustomExecutions2.delete(execution.id);
		}

		// Technically we don't really need to do this, however, if an extension
		// is executing a task through "executeTask" over and over again
		// with different properties in the task definition, then the map of executions
		// could grow indefinitely, something we don't want.
		if (this._notProvidedCustomExecutions.has(execution.id) && (this._lastStartedTask !== execution.id)) {
			this._providedCustomExecutions2.delete(execution.id);
			this._notProvidedCustomExecutions.delete(execution.id);
		}
		let iterator = this._notProvidedCustomExecutions.values();
		let iteratorResult = iterator.next();
		while (!iteratorResult.done) {
			if (!this._activeCustomExecutions2.has(iteratorResult.value) && (this._lastStartedTask !== iteratorResult.value)) {
				this._providedCustomExecutions2.delete(iteratorResult.value);
				this._notProvidedCustomExecutions.delete(iteratorResult.value);
			}
			iteratorResult = iterator.next();
		}
	}

	public abstract $jsonTasksSupported(): Promise<boolean>;

	public abstract $findExecutable(command: string, cwd?: string | undefined, paths?: string[] | undefined): Promise<string | undefined>;
}

export class WorkerExtHostTask extends ExtHostTaskBase {
	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostInitDataService initData: IExtHostInitDataService,
		@IExtHostWorkspace workspaceService: IExtHostWorkspace,
		@IExtHostDocumentsAndEditors editorService: IExtHostDocumentsAndEditors,
		@IExtHostConfiguration configurationService: IExtHostConfiguration,
		@IExtHostTerminalService extHostTerminalService: IExtHostTerminalService,
		@ILogService logService: ILogService,
		@IExtHostApiDeprecationService deprecationService: IExtHostApiDeprecationService
	) {
		super(extHostRpc, initData, workspaceService, editorService, configurationService, extHostTerminalService, logService, deprecationService);
		this.registerTaskSystem(Schemas.vscodeRemote, {
			scheme: Schemas.vscodeRemote,
			authority: '',
			platform: Platform.PlatformToString(Platform.Platform.Web)
		});
	}

	public async executeTask(extension: IExtensionDescription, task: vscode.Task): Promise<vscode.TaskExecution> {
		if (!task.execution) {
			throw new Error('Tasks to execute must include an execution');
		}

		const dto = TaskDTO.from(task, extension);
		if (dto === undefined) {
			throw new Error('Task is not valid');
		}

		// If this task is a custom execution, then we need to save it away
		// in the provided custom execution map that is cleaned up after the
		// task is executed.
		if (CustomExecutionDTO.is(dto.execution)) {
			await this.addCustomExecution(dto, task, false);
		} else {
			throw new NotSupportedError();
		}

		// Always get the task execution first to prevent timing issues when retrieving it later
		const execution = await this.getTaskExecution(await this._proxy.$getTaskExecution(dto), task);
		this._proxy.$executeTask(dto).catch(error => { throw new Error(error); });
		return execution;
	}

	protected provideTasksInternal(validTypes: { [key: string]: boolean; }, taskIdPromises: Promise<void>[], handler: HandlerData, value: vscode.Task[] | null | undefined): { tasks: tasks.TaskDTO[], extension: IExtensionDescription } {
		const taskDTOs: tasks.TaskDTO[] = [];
		if (value) {
			for (let task of value) {
				this.checkDeprecation(task, handler);
				if (!task.definition || !validTypes[task.definition.type]) {
					this._logService.warn(`The task [${task.source}, ${task.name}] uses an undefined task type. The task will be ignored in the future.`);
				}

				const taskDTO: tasks.TaskDTO | undefined = TaskDTO.from(task, handler.extension);
				if (taskDTO && CustomExecutionDTO.is(taskDTO.execution)) {
					taskDTOs.push(taskDTO);
					// The ID is calculated on the main thread task side, so, let's call into it here.
					// We need the task id's pre-computed for custom task executions because when OnDidStartTask
					// is invoked, we have to be able to map it back to our data.
					taskIdPromises.push(this.addCustomExecution(taskDTO, task, true));
				} else {
					this._logService.warn('Only custom execution tasks supported.');
				}
			}
		}
		return {
			tasks: taskDTOs,
			extension: handler.extension
		};
	}

	protected async resolveTaskInternal(resolvedTaskDTO: tasks.TaskDTO): Promise<tasks.TaskDTO | undefined> {
		if (CustomExecutionDTO.is(resolvedTaskDTO.execution)) {
			return resolvedTaskDTO;
		} else {
			this._logService.warn('Only custom execution tasks supported.');
		}
		return undefined;
	}

	public async $resolveVariables(uriComponents: UriComponents, toResolve: { process?: { name: string; cwd?: string; path?: string }, variables: string[] }): Promise<{ process?: string, variables: { [key: string]: string; } }> {
		const result = {
			process: <unknown>undefined as string,
			variables: Object.create(null)
		};
		return result;
	}

	public async $jsonTasksSupported(): Promise<boolean> {
		return false;
	}

	public async $findExecutable(command: string, cwd?: string | undefined, paths?: string[] | undefined): Promise<string | undefined> {
		return undefined;
	}
}

export const IExtHostTask = createDecorator<IExtHostTask>('IExtHostTask');
