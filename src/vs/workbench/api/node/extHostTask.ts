/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'path';

import { URI, UriComponents } from 'vs/base/common/uri';
import * as nls from 'vs/nls';
import * as Objects from 'vs/base/common/objects';
import { asThenable } from 'vs/base/common/async';
import { Event, Emitter } from 'vs/base/common/event';
import { win32 } from 'vs/base/node/processes';

import { IExtensionDescription } from 'vs/workbench/services/extensions/common/extensions';
import * as tasks from 'vs/workbench/parts/tasks/common/tasks';

import { MainContext, MainThreadTaskShape, ExtHostTaskShape, IMainContext } from 'vs/workbench/api/node/extHost.protocol';

import * as types from 'vs/workbench/api/node/extHostTypes';
import { ExtHostWorkspace } from 'vs/workbench/api/node/extHostWorkspace';
import * as vscode from 'vscode';
import {
	TaskDefinitionDTO, TaskExecutionDTO, TaskPresentationOptionsDTO, ProcessExecutionOptionsDTO, ProcessExecutionDTO,
	ShellExecutionOptionsDTO, ShellExecutionDTO, TaskDTO, TaskHandleDTO, TaskFilterDTO, TaskProcessStartedDTO, TaskProcessEndedDTO, TaskSystemInfoDTO
} from '../shared/tasks';
import { ExtHostVariableResolverService } from 'vs/workbench/api/node/extHostDebugService';
import { ExtHostDocumentsAndEditors } from 'vs/workbench/api/node/extHostDocumentsAndEditors';
import { ExtHostConfiguration } from 'vs/workbench/api/node/extHostConfiguration';
import { IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { CancellationToken } from 'vs/base/common/cancellation';

/*
namespace ProblemPattern {
	export function from(value: vscode.ProblemPattern | vscode.MultiLineProblemPattern): Problems.ProblemPattern | Problems.MultiLineProblemPattern {
		if (value === void 0 || value === null) {
			return undefined;
		}
		if (Array.isArray(value)) {
			let result: Problems.ProblemPattern[] = [];
			for (let pattern of value) {
				let converted = fromSingle(pattern);
				if (!converted) {
					return undefined;
				}
				result.push(converted);
			}
			return result;
		} else {
			return fromSingle(value);
		}
	}

	function copyProperty(target: Problems.ProblemPattern, source: vscode.ProblemPattern, tk: keyof Problems.ProblemPattern) {
		let sk: keyof vscode.ProblemPattern = tk;
		let value = source[sk];
		if (typeof value === 'number') {
			target[tk] = value;
		}
	}

	function getValue(value: number, defaultValue: number): number {
		if (value !== void 0 && value === null) {
			return value;
		}
		return defaultValue;
	}

	function fromSingle(problemPattern: vscode.ProblemPattern): Problems.ProblemPattern {
		if (problemPattern === void 0 || problemPattern === null || !(problemPattern.regexp instanceof RegExp)) {
			return undefined;
		}
		let result: Problems.ProblemPattern = {
			regexp: problemPattern.regexp
		};
		copyProperty(result, problemPattern, 'file');
		copyProperty(result, problemPattern, 'location');
		copyProperty(result, problemPattern, 'line');
		copyProperty(result, problemPattern, 'character');
		copyProperty(result, problemPattern, 'endLine');
		copyProperty(result, problemPattern, 'endCharacter');
		copyProperty(result, problemPattern, 'severity');
		copyProperty(result, problemPattern, 'code');
		copyProperty(result, problemPattern, 'message');
		if (problemPattern.loop === true || problemPattern.loop === false) {
			result.loop = problemPattern.loop;
		}
		if (result.location) {
			result.file = getValue(result.file, 1);
			result.message = getValue(result.message, 0);
		} else {
			result.file = getValue(result.file, 1);
			result.line = getValue(result.line, 2);
			result.character = getValue(result.character, 3);
			result.message = getValue(result.message, 0);
		}
		return result;
	}
}

namespace ApplyTo {
	export function from(value: vscode.ApplyToKind): Problems.ApplyToKind {
		if (value === void 0 || value === null) {
			return Problems.ApplyToKind.allDocuments;
		}
		switch (value) {
			case types.ApplyToKind.OpenDocuments:
				return Problems.ApplyToKind.openDocuments;
			case types.ApplyToKind.ClosedDocuments:
				return Problems.ApplyToKind.closedDocuments;
		}
		return Problems.ApplyToKind.allDocuments;
	}
}

namespace FileLocation {
	export function from(value: vscode.FileLocationKind | string): { kind: Problems.FileLocationKind; prefix?: string } {
		if (value === void 0 || value === null) {
			return { kind: Problems.FileLocationKind.Auto };
		}
		if (typeof value === 'string') {
			return { kind: Problems.FileLocationKind.Relative, prefix: value };
		}
		switch (value) {
			case types.FileLocationKind.Absolute:
				return { kind: Problems.FileLocationKind.Absolute };
			case types.FileLocationKind.Relative:
				return { kind: Problems.FileLocationKind.Relative, prefix: '${workspaceFolder}' };
		}
		return { kind: Problems.FileLocationKind.Auto };
	}
}

namespace WatchingPattern {
	export function from(value: RegExp | vscode.BackgroundPattern): Problems.WatchingPattern {
		if (value === void 0 || value === null) {
			return undefined;
		}
		if (value instanceof RegExp) {
			return { regexp: value };
		}
		if (!(value.regexp instanceof RegExp)) {
			return undefined;
		}
		let result: Problems.WatchingPattern = {
			regexp: value.regexp
		};
		if (typeof value.file === 'number') {
			result.file = value.file;
		}
		return result;
	}
}

namespace BackgroundMonitor {
	export function from(value: vscode.BackgroundMonitor): Problems.WatchingMatcher {
		if (value === void 0 || value === null) {
			return undefined;
		}
		let result: Problems.WatchingMatcher = {
			activeOnStart: !!value.activeOnStart,
			beginsPattern: WatchingPattern.from(value.beginsPattern),
			endsPattern: WatchingPattern.from(value.endsPattern)
		};
		return result;
	}
}

namespace ProblemMatcher {
	export function from(values: (string | vscode.ProblemMatcher)[]): (string | Problems.ProblemMatcher)[] {
		if (values === void 0 || values === null) {
			return undefined;
		}
		let result: (string | Problems.ProblemMatcher)[] = [];
		for (let value of values) {
			let converted = typeof value === 'string' ? value : fromSingle(value);
			if (converted) {
				result.push(converted);
			}
		}
		return result;
	}

	function fromSingle(problemMatcher: vscode.ProblemMatcher): Problems.ProblemMatcher {
		if (problemMatcher === void 0 || problemMatcher === null) {
			return undefined;
		}

		let location = FileLocation.from(problemMatcher.fileLocation);
		let result: Problems.ProblemMatcher = {
			owner: typeof problemMatcher.owner === 'string' ? problemMatcher.owner : UUID.generateUuid(),
			applyTo: ApplyTo.from(problemMatcher.applyTo),
			fileLocation: location.kind,
			filePrefix: location.prefix,
			pattern: ProblemPattern.from(problemMatcher.pattern),
			severity: fromDiagnosticSeverity(problemMatcher.severity),
		};
		return result;
	}
}
*/

namespace TaskRevealKind {
	export function from(value: vscode.TaskRevealKind): tasks.RevealKind {
		if (value === void 0 || value === null) {
			return tasks.RevealKind.Always;
		}
		switch (value) {
			case types.TaskRevealKind.Silent:
				return tasks.RevealKind.Silent;
			case types.TaskRevealKind.Never:
				return tasks.RevealKind.Never;
		}
		return tasks.RevealKind.Always;
	}
}

namespace TaskPanelKind {
	export function from(value: vscode.TaskPanelKind): tasks.PanelKind {
		if (value === void 0 || value === null) {
			return tasks.PanelKind.Shared;
		}
		switch (value) {
			case types.TaskPanelKind.Dedicated:
				return tasks.PanelKind.Dedicated;
			case types.TaskPanelKind.New:
				return tasks.PanelKind.New;
			default:
				return tasks.PanelKind.Shared;
		}
	}
}

namespace PresentationOptions {
	export function from(value: vscode.TaskPresentationOptions): tasks.PresentationOptions {
		if (value === void 0 || value === null) {
			return { reveal: tasks.RevealKind.Always, echo: true, focus: false, panel: tasks.PanelKind.Shared, showReuseMessage: true, clear: false };
		}
		return {
			reveal: TaskRevealKind.from(value.reveal),
			echo: value.echo === void 0 ? true : !!value.echo,
			focus: !!value.focus,
			panel: TaskPanelKind.from(value.panel),
			showReuseMessage: value.showReuseMessage === void 0 ? true : !!value.showReuseMessage,
			clear: value.clear === void 0 ? false : !!value.clear,
		};
	}
}

namespace Strings {
	export function from(value: string[]): string[] {
		if (value === void 0 || value === null) {
			return undefined;
		}
		for (let element of value) {
			if (typeof element !== 'string') {
				return [];
			}
		}
		return value;
	}
}

namespace CommandOptions {
	function isShellConfiguration(value: any): value is { executable: string; shellArgs?: string[] } {
		return value && typeof value.executable === 'string';
	}
	export function from(value: vscode.ShellExecutionOptions | vscode.ProcessExecutionOptions): tasks.CommandOptions {
		if (value === void 0 || value === null) {
			return undefined;
		}
		let result: tasks.CommandOptions = {
		};
		if (typeof value.cwd === 'string') {
			result.cwd = value.cwd;
		}
		if (value.env) {
			result.env = Object.create(null);
			Object.keys(value.env).forEach(key => {
				let envValue = value.env[key];
				if (typeof envValue === 'string') {
					result.env[key] = envValue;
				}
			});
		}
		if (isShellConfiguration(value)) {
			result.shell = ShellConfiguration.from(value);
		}
		return result;
	}
}

namespace ShellQuoteOptions {
	export function from(value: vscode.ShellQuotingOptions): tasks.ShellQuotingOptions {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return {
			escape: value.escape,
			strong: value.strong,
			weak: value.strong
		};
	}
}

namespace ShellConfiguration {
	export function from(value: { executable?: string, shellArgs?: string[], quotes?: vscode.ShellQuotingOptions }): tasks.ShellConfiguration {
		if (value === void 0 || value === null || !value.executable) {
			return undefined;
		}

		let result: tasks.ShellConfiguration = {
			executable: value.executable,
			args: Strings.from(value.shellArgs),
			quoting: ShellQuoteOptions.from(value.quotes)
		};
		return result;
	}
}

namespace ShellString {
	export function from(value: (string | vscode.ShellQuotedString)[]): tasks.CommandString[] {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return value.slice(0);
	}
}

namespace Tasks {

	export function from(tasks: vscode.Task[], rootFolder: vscode.WorkspaceFolder, extension: IExtensionDescription): tasks.ContributedTask[] {
		if (tasks === void 0 || tasks === null) {
			return [];
		}
		let result: tasks.ContributedTask[] = [];
		for (let task of tasks) {
			let converted = fromSingle(task, rootFolder, extension);
			if (converted) {
				result.push(converted);
			}
		}
		return result;
	}

	function fromSingle(task: vscode.Task, rootFolder: vscode.WorkspaceFolder, extension: IExtensionDescription): tasks.ContributedTask {
		if (typeof task.name !== 'string') {
			return undefined;
		}
		let command: tasks.CommandConfiguration;
		let execution = task.execution;
		if (execution instanceof types.ProcessExecution) {
			command = getProcessCommand(execution);
		} else if (execution instanceof types.ShellExecution) {
			command = getShellCommand(execution);
		} else {
			return undefined;
		}
		if (command === void 0) {
			return undefined;
		}
		command.presentation = PresentationOptions.from(task.presentationOptions);

		let taskScope: types.TaskScope.Global | types.TaskScope.Workspace | vscode.WorkspaceFolder | undefined = task.scope;
		let workspaceFolder: vscode.WorkspaceFolder | undefined;
		let scope: tasks.TaskScope;
		// For backwards compatibility
		if (taskScope === void 0) {
			scope = tasks.TaskScope.Folder;
			workspaceFolder = rootFolder;
		} else if (taskScope === types.TaskScope.Global) {
			scope = tasks.TaskScope.Global;
		} else if (taskScope === types.TaskScope.Workspace) {
			scope = tasks.TaskScope.Workspace;
		} else {
			scope = tasks.TaskScope.Folder;
			workspaceFolder = taskScope;
		}
		let source: tasks.ExtensionTaskSource = {
			kind: tasks.TaskSourceKind.Extension,
			label: typeof task.source === 'string' ? task.source : extension.name,
			extension: extension.id,
			scope: scope,
			workspaceFolder: undefined
		};
		// We can't transfer a workspace folder object from the extension host to main since they differ
		// in shape and we don't have backwards converting function. So transfer the URI and resolve the
		// workspace folder on the main side.
		(source as any as tasks.ExtensionTaskSourceTransfer).__workspaceFolder = workspaceFolder ? workspaceFolder.uri as URI : undefined;
		(source as any as tasks.ExtensionTaskSourceTransfer).__definition = task.definition;
		let label = nls.localize('task.label', '{0}: {1}', source.label, task.name);
		// The definition id will be prefix on the main side since we compute it there.
		let id = `${extension.id}`;
		let result: tasks.ContributedTask = {
			_id: id,
			_source: source,
			_label: label,
			type: task.definition.type,
			defines: undefined,
			name: task.name,
			identifier: label,
			group: task.group ? (task.group as types.TaskGroup).id : undefined,
			command: command,
			isBackground: !!task.isBackground,
			instanceLimit: !!task.instanceLimit,
			problemMatchers: task.problemMatchers.slice(),
			hasDefinedMatchers: (task as types.Task).hasDefinedMatchers
		};
		return result;
	}

	function getProcessCommand(value: vscode.ProcessExecution): tasks.CommandConfiguration {
		if (typeof value.process !== 'string') {
			return undefined;
		}
		let result: tasks.CommandConfiguration = {
			name: value.process,
			args: Strings.from(value.args),
			runtime: tasks.RuntimeType.Process,
			suppressTaskName: true,
			presentation: undefined
		};
		if (value.options) {
			result.options = CommandOptions.from(value.options);
		}
		return result;
	}

	function getShellCommand(value: vscode.ShellExecution): tasks.CommandConfiguration {
		if (value.args) {
			if (typeof value.command !== 'string' && typeof value.command.value !== 'string') {
				return undefined;
			}
			let result: tasks.CommandConfiguration = {
				name: value.command,
				args: ShellString.from(value.args),
				runtime: tasks.RuntimeType.Shell,
				presentation: undefined
			};
			if (value.options) {
				result.options = CommandOptions.from(value.options);
			}
			return result;
		} else {
			if (typeof value.commandLine !== 'string') {
				return undefined;
			}
			let result: tasks.CommandConfiguration = {
				name: value.commandLine,
				runtime: tasks.RuntimeType.Shell,
				presentation: undefined
			};
			if (value.options) {
				result.options = CommandOptions.from(value.options);
			}
			return result;
		}
	}
}

namespace TaskDefinitionDTO {
	export function from(value: vscode.TaskDefinition): TaskDefinitionDTO {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: TaskDefinitionDTO): vscode.TaskDefinition {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return value;
	}
}

namespace TaskPresentationOptionsDTO {
	export function from(value: vscode.TaskPresentationOptions): TaskPresentationOptionsDTO {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: TaskPresentationOptionsDTO): vscode.TaskPresentationOptions {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return value;
	}
}

namespace ProcessExecutionOptionsDTO {
	export function from(value: vscode.ProcessExecutionOptions): ProcessExecutionOptionsDTO {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: ProcessExecutionOptionsDTO): vscode.ProcessExecutionOptions {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return value;
	}
}

namespace ProcessExecutionDTO {
	export function is(value: ShellExecutionDTO | ProcessExecutionDTO): value is ProcessExecutionDTO {
		let candidate = value as ProcessExecutionDTO;
		return candidate && !!candidate.process;
	}
	export function from(value: vscode.ProcessExecution): ProcessExecutionDTO {
		if (value === void 0 || value === null) {
			return undefined;
		}
		let result: ProcessExecutionDTO = {
			process: value.process,
			args: value.args
		};
		if (value.options) {
			result.options = ProcessExecutionOptionsDTO.from(value.options);
		}
		return result;
	}
	export function to(value: ProcessExecutionDTO): types.ProcessExecution {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return new types.ProcessExecution(value.process, value.args, value.options);
	}
}

namespace ShellExecutionOptionsDTO {
	export function from(value: vscode.ShellExecutionOptions): ShellExecutionOptionsDTO {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return value;
	}
	export function to(value: ShellExecutionOptionsDTO): vscode.ShellExecutionOptions {
		if (value === void 0 || value === null) {
			return undefined;
		}
		return value;
	}
}

namespace ShellExecutionDTO {
	export function is(value: ShellExecutionDTO | ProcessExecutionDTO): value is ShellExecutionDTO {
		let candidate = value as ShellExecutionDTO;
		return candidate && (!!candidate.commandLine || !!candidate.command);
	}
	export function from(value: vscode.ShellExecution): ShellExecutionDTO {
		if (value === void 0 || value === null) {
			return undefined;
		}
		let result: ShellExecutionDTO = {
		};
		if (value.commandLine !== void 0) {
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
	export function to(value: ShellExecutionDTO): types.ShellExecution {
		if (value === void 0 || value === null) {
			return undefined;
		}
		if (value.commandLine) {
			return new types.ShellExecution(value.commandLine, value.options);
		} else {
			return new types.ShellExecution(value.command, value.args ? value.args : [], value.options);
		}
	}
}

namespace TaskHandleDTO {
	export function from(value: types.Task): TaskHandleDTO {
		let folder: UriComponents;
		if (value.scope !== void 0 && typeof value.scope !== 'number') {
			folder = value.scope.uri;
		}
		return {
			id: value._id,
			workspaceFolder: folder
		};
	}
}

namespace TaskDTO {

	export function from(value: vscode.Task, extension: IExtensionDescription): TaskDTO {
		if (value === void 0 || value === null) {
			return undefined;
		}
		let execution: ShellExecutionDTO | ProcessExecutionDTO;
		if (value.execution instanceof types.ProcessExecution) {
			execution = ProcessExecutionDTO.from(value.execution);
		} else if (value.execution instanceof types.ShellExecution) {
			execution = ShellExecutionDTO.from(value.execution);
		}
		let definition: TaskDefinitionDTO = TaskDefinitionDTO.from(value.definition);
		let scope: number | UriComponents;
		if (value.scope) {
			if (typeof value.scope === 'number') {
				scope = value.scope;
			} else {
				scope = value.scope.uri;
			}
		}
		if (!definition || !scope) {
			return undefined;
		}
		let group = (value.group as types.TaskGroup) ? (value.group as types.TaskGroup).id : undefined;
		let result: TaskDTO = {
			_id: (value as types.Task)._id,
			definition,
			name: value.name,
			source: {
				extensionId: extension.id,
				label: value.source,
				scope: scope
			},
			execution,
			isBackground: value.isBackground,
			group: group,
			presentationOptions: TaskPresentationOptionsDTO.from(value.presentationOptions),
			problemMatchers: value.problemMatchers,
			hasDefinedMatchers: (value as types.Task).hasDefinedMatchers
		};
		return result;
	}
	export function to(value: TaskDTO, workspace: ExtHostWorkspace): types.Task {
		if (value === void 0 || value === null) {
			return undefined;
		}
		let execution: types.ShellExecution | types.ProcessExecution;
		if (ProcessExecutionDTO.is(value.execution)) {
			execution = ProcessExecutionDTO.to(value.execution);
		} else if (ShellExecutionDTO.is(value.execution)) {
			execution = ShellExecutionDTO.to(value.execution);
		}
		let definition: vscode.TaskDefinition = TaskDefinitionDTO.to(value.definition);
		let scope: vscode.TaskScope.Global | vscode.TaskScope.Workspace | vscode.WorkspaceFolder;
		if (value.source) {
			if (value.source.scope !== void 0) {
				if (typeof value.source.scope === 'number') {
					scope = value.source.scope;
				} else {
					scope = workspace.resolveWorkspaceFolder(URI.revive(value.source.scope));
				}
			} else {
				scope = types.TaskScope.Workspace;
			}
		}
		if (!definition || !scope) {
			return undefined;
		}
		let result = new types.Task(definition, scope, value.name, value.source.label, execution, value.problemMatchers);
		if (value.isBackground !== void 0) {
			result.isBackground = value.isBackground;
		}
		if (value.group !== void 0) {
			result.group = types.TaskGroup.from(value.group);
		}
		if (value.presentationOptions) {
			result.presentationOptions = TaskPresentationOptionsDTO.to(value.presentationOptions);
		}
		if (value._id) {
			result._id = value._id;
		}
		return result;
	}
}

namespace TaskFilterDTO {
	export function from(value: vscode.TaskFilter): TaskFilterDTO {
		return value;
	}

	export function to(value: TaskFilterDTO): vscode.TaskFilter {
		if (!value) {
			return undefined;
		}
		return Objects.assign(Object.create(null), value);
	}
}

class TaskExecutionImpl implements vscode.TaskExecution {

	constructor(private readonly _tasks: ExtHostTask, readonly _id: string, private readonly _task: vscode.Task) {
	}

	public get task(): vscode.Task {
		return this._task;
	}

	public terminate(): void {
		this._tasks.terminateTask(this);
	}

	public fireDidStartProcess(value: TaskProcessStartedDTO): void {
	}

	public fireDidEndProcess(value: TaskProcessEndedDTO): void {
	}
}

namespace TaskExecutionDTO {
	export function to(value: TaskExecutionDTO, tasks: ExtHostTask): vscode.TaskExecution {
		return new TaskExecutionImpl(tasks, value.id, TaskDTO.to(value.task, tasks.extHostWorkspace));
	}
	export function from(value: vscode.TaskExecution): TaskExecutionDTO {
		return {
			id: (value as TaskExecutionImpl)._id,
			task: undefined
		};
	}
}

interface HandlerData {
	provider: vscode.TaskProvider;
	extension: IExtensionDescription;
}

export class ExtHostTask implements ExtHostTaskShape {

	private _proxy: MainThreadTaskShape;
	private _workspaceService: ExtHostWorkspace;
	private _editorService: ExtHostDocumentsAndEditors;
	private _configurationService: ExtHostConfiguration;
	private _handleCounter: number;
	private _handlers: Map<number, HandlerData>;
	private _taskExecutions: Map<string, TaskExecutionImpl>;

	private readonly _onDidExecuteTask: Emitter<vscode.TaskStartEvent> = new Emitter<vscode.TaskStartEvent>();
	private readonly _onDidTerminateTask: Emitter<vscode.TaskEndEvent> = new Emitter<vscode.TaskEndEvent>();

	private readonly _onDidTaskProcessStarted: Emitter<vscode.TaskProcessStartEvent> = new Emitter<vscode.TaskProcessStartEvent>();
	private readonly _onDidTaskProcessEnded: Emitter<vscode.TaskProcessEndEvent> = new Emitter<vscode.TaskProcessEndEvent>();

	constructor(mainContext: IMainContext, workspaceService: ExtHostWorkspace, editorService: ExtHostDocumentsAndEditors, configurationService: ExtHostConfiguration) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadTask);
		this._workspaceService = workspaceService;
		this._editorService = editorService;
		this._configurationService = configurationService;
		this._handleCounter = 0;
		this._handlers = new Map<number, HandlerData>();
		this._taskExecutions = new Map<string, TaskExecutionImpl>();
	}

	public get extHostWorkspace(): ExtHostWorkspace {
		return this._workspaceService;
	}

	public registerTaskProvider(extension: IExtensionDescription, provider: vscode.TaskProvider): vscode.Disposable {
		if (!provider) {
			return new types.Disposable(() => { });
		}
		let handle = this.nextHandle();
		this._handlers.set(handle, { provider, extension });
		this._proxy.$registerTaskProvider(handle);
		return new types.Disposable(() => {
			this._handlers.delete(handle);
			this._proxy.$unregisterTaskProvider(handle);
		});
	}

	public registerTaskSystem(scheme: string, info: TaskSystemInfoDTO): void {
		this._proxy.$registerTaskSystem(scheme, info);
	}

	public fetchTasks(filter?: vscode.TaskFilter): Thenable<vscode.Task[]> {
		return this._proxy.$fetchTasks(TaskFilterDTO.from(filter)).then((values) => {
			let result: vscode.Task[] = [];
			for (let value of values) {
				let task = TaskDTO.to(value, this._workspaceService);
				if (task) {
					result.push(task);
				}
			}
			return result;
		});
	}

	public executeTask(extension: IExtensionDescription, task: vscode.Task): Thenable<vscode.TaskExecution> {
		let tTask = (task as types.Task);
		// We have a preserved ID. So the task didn't change.
		if (tTask._id !== void 0) {
			return this._proxy.$executeTask(TaskHandleDTO.from(tTask)).then(value => this.getTaskExecution(value, task));
		} else {
			let dto = TaskDTO.from(task, extension);
			if (dto === void 0) {
				return Promise.reject(new Error('Task is not valid'));
			}
			return this._proxy.$executeTask(dto).then(value => this.getTaskExecution(value, task));
		}
	}

	public get taskExecutions(): vscode.TaskExecution[] {
		let result: vscode.TaskExecution[] = [];
		this._taskExecutions.forEach(value => result.push(value));
		return result;
	}

	public terminateTask(execution: vscode.TaskExecution): Thenable<void> {
		if (!(execution instanceof TaskExecutionImpl)) {
			throw new Error('No valid task execution provided');
		}
		return this._proxy.$terminateTask((execution as TaskExecutionImpl)._id);
	}

	public get onDidStartTask(): Event<vscode.TaskStartEvent> {
		return this._onDidExecuteTask.event;
	}

	public $onDidStartTask(execution: TaskExecutionDTO): void {
		this._onDidExecuteTask.fire({
			execution: this.getTaskExecution(execution)
		});
	}

	public get onDidEndTask(): Event<vscode.TaskEndEvent> {
		return this._onDidTerminateTask.event;
	}

	public $OnDidEndTask(execution: TaskExecutionDTO): void {
		const _execution = this.getTaskExecution(execution);
		this._taskExecutions.delete(execution.id);
		this._onDidTerminateTask.fire({
			execution: _execution
		});
	}

	public get onDidStartTaskProcess(): Event<vscode.TaskProcessStartEvent> {
		return this._onDidTaskProcessStarted.event;
	}

	public $onDidStartTaskProcess(value: TaskProcessStartedDTO): void {
		const execution = this.getTaskExecution(value.id);
		if (execution) {
			this._onDidTaskProcessStarted.fire({
				execution: execution,
				processId: value.processId
			});
		}
	}

	public get onDidEndTaskProcess(): Event<vscode.TaskProcessEndEvent> {
		return this._onDidTaskProcessEnded.event;
	}

	public $onDidEndTaskProcess(value: TaskProcessEndedDTO): void {
		const execution = this.getTaskExecution(value.id);
		if (execution) {
			this._onDidTaskProcessEnded.fire({
				execution: execution,
				exitCode: value.exitCode
			});
		}
	}

	public $provideTasks(handle: number, validTypes: { [key: string]: boolean; }): Thenable<tasks.TaskSet> {
		let handler = this._handlers.get(handle);
		if (!handler) {
			return Promise.reject(new Error('no handler found'));
		}
		return asThenable(() => handler.provider.provideTasks(CancellationToken.None)).then(value => {
			let sanitized: vscode.Task[] = [];
			for (let task of value) {
				if (task.definition && validTypes[task.definition.type] === true) {
					sanitized.push(task);
				} else {
					sanitized.push(task);
					console.warn(`The task [${task.source}, ${task.name}] uses an undefined task type. The task will be ignored in the future.`);
				}
			}
			let workspaceFolders = this._workspaceService.getWorkspaceFolders();
			return {
				tasks: Tasks.from(sanitized, workspaceFolders && workspaceFolders.length > 0 ? workspaceFolders[0] : undefined, handler.extension),
				extension: handler.extension
			};
		});
	}

	public $resolveVariables(uriComponents: UriComponents, toResolve: { process?: { name: string; cwd?: string; path?: string }, variables: string[] }): Thenable<{ process?: string, variables: { [key: string]: string; } }> {
		let uri: URI = URI.revive(uriComponents);
		let result = {
			process: undefined as string,
			variables: Object.create(null)
		};
		let workspaceFolder = this._workspaceService.resolveWorkspaceFolder(uri);
		let resolver = new ExtHostVariableResolverService(this._workspaceService, this._editorService, this._configurationService);
		let ws: IWorkspaceFolder = {
			uri: workspaceFolder.uri,
			name: workspaceFolder.name,
			index: workspaceFolder.index,
			toResource: () => {
				throw new Error('Not implemented');
			}
		};
		for (let variable of toResolve.variables) {
			result.variables[variable] = resolver.resolve(ws, variable);
		}
		if (toResolve.process !== void 0) {
			let paths: string[] | undefined = undefined;
			if (toResolve.process.path !== void 0) {
				paths = toResolve.process.path.split(path.delimiter);
				for (let i = 0; i < paths.length; i++) {
					paths[i] = resolver.resolve(ws, paths[i]);
				}
			}
			result.process = win32.findExecutable(
				resolver.resolve(ws, toResolve.process.name),
				toResolve.process.cwd !== void 0 ? resolver.resolve(ws, toResolve.process.cwd) : undefined,
				paths
			);
		}
		return Promise.resolve(result);
	}

	private nextHandle(): number {
		return this._handleCounter++;
	}

	private getTaskExecution(execution: TaskExecutionDTO | string, task?: vscode.Task): TaskExecutionImpl {
		if (typeof execution === 'string') {
			return this._taskExecutions.get(execution);
		}

		let result: TaskExecutionImpl = this._taskExecutions.get(execution.id);
		if (result) {
			return result;
		}
		result = new TaskExecutionImpl(this, execution.id, task ? task : TaskDTO.to(execution.task, this._workspaceService));
		this._taskExecutions.set(execution.id, result);
		return result;
	}
}
