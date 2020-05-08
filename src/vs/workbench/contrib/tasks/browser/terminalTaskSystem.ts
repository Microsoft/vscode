/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import * as nls from 'vs/nls';
import * as Objects from 'vs/base/common/objects';
import * as Types from 'vs/base/common/types';
import * as Platform from 'vs/base/common/platform';
import * as Async from 'vs/base/common/async';
import * as resources from 'vs/base/common/resources';
import { IStringDictionary, values } from 'vs/base/common/collections';
import { LinkedMap, Touch } from 'vs/base/common/map';
import Severity from 'vs/base/common/severity';
import { Event, Emitter } from 'vs/base/common/event';
import { DisposableStore } from 'vs/base/common/lifecycle';
import { isUNC } from 'vs/base/common/extpath';

import { IFileService } from 'vs/platform/files/common/files';
import { IMarkerService, MarkerSeverity } from 'vs/platform/markers/common/markers';
import { IWorkspaceContextService, WorkbenchState, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ProblemMatcher, ProblemMatcherRegistry /*, ProblemPattern, getResource */ } from 'vs/workbench/contrib/tasks/common/problemMatcher';
import Constants from 'vs/workbench/contrib/markers/browser/constants';

import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';

import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IShellLaunchConfig, TERMINAL_VIEW_ID } from 'vs/workbench/contrib/terminal/common/terminal';
import { ITerminalService, ITerminalInstanceService, ITerminalInstance } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IOutputService } from 'vs/workbench/contrib/output/common/output';
import { StartStopProblemCollector, WatchingProblemCollector, ProblemCollectorEventKind, ProblemHandlingStrategy } from 'vs/workbench/contrib/tasks/common/problemCollectors';
import {
	Task, CustomTask, ContributedTask, RevealKind, CommandOptions, ShellConfiguration, RuntimeType, PanelKind,
	TaskEvent, TaskEventKind, ShellQuotingOptions, ShellQuoting, CommandString, CommandConfiguration, ExtensionTaskSource, TaskScope, RevealProblemKind, DependsOrder, TaskSourceKind, InMemoryTask
} from 'vs/workbench/contrib/tasks/common/tasks';
import {
	ITaskSystem, ITaskSummary, ITaskExecuteResult, TaskExecuteKind, TaskError, TaskErrors, ITaskResolver,
	TelemetryEvent, Triggers, TaskTerminateResponse, TaskSystemInfoResolver, TaskSystemInfo, ResolveSet, ResolvedVariables
} from 'vs/workbench/contrib/tasks/common/taskSystem';
import { URI } from 'vs/base/common/uri';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { Schemas } from 'vs/base/common/network';
import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { env as processEnv, cwd as processCwd } from 'vs/base/common/process';
import { IViewsService, IViewDescriptorService, ViewContainerLocation } from 'vs/workbench/common/views';

interface TerminalData {
	terminal: ITerminalInstance;
	lastTask: string;
	group?: string;
}

interface ActiveTerminalData {
	terminal: ITerminalInstance;
	task: Task;
	promise: Promise<ITaskSummary>;
}

class InstanceManager {
	private _currentInstances: number = 0;
	private _counter: number = 0;

	addInstance() {
		this._currentInstances++;
		this._counter++;
	}
	removeInstance() {
		this._currentInstances--;
	}
	get instances() {
		return this._currentInstances;
	}
	get counter() {
		return this._counter;
	}
}

class VariableResolver {

	constructor(public workspaceFolder: IWorkspaceFolder | undefined, public taskSystemInfo: TaskSystemInfo | undefined, private _values: Map<string, string>, private _service: IConfigurationResolverService | undefined) {
	}
	resolve(value: string): string {
		return value.replace(/\$\{(.*?)\}/g, (match: string, variable: string) => {
			// Strip out the ${} because the map contains them variables without those characters.
			let result = this._values.get(match.substring(2, match.length - 1));
			if ((result !== undefined) && (result !== null)) {
				return result;
			}
			if (this._service) {
				return this._service.resolve(this.workspaceFolder, match);
			}
			return match;
		});
	}
}

export class VerifiedTask {
	readonly task: Task;
	readonly resolver: ITaskResolver;
	readonly trigger: string;
	resolvedVariables?: ResolvedVariables;
	systemInfo?: TaskSystemInfo;
	workspaceFolder?: IWorkspaceFolder;
	shellLaunchConfig?: IShellLaunchConfig;

	constructor(task: Task, resolver: ITaskResolver, trigger: string) {
		this.task = task;
		this.resolver = resolver;
		this.trigger = trigger;
	}

	public verify(): boolean {
		let verified = false;
		if (this.trigger && this.resolvedVariables && this.workspaceFolder && (this.shellLaunchConfig !== undefined)) {
			verified = true;
		}
		return verified;
	}

	public getVerifiedTask(): { task: Task, resolver: ITaskResolver, trigger: string, resolvedVariables: ResolvedVariables, systemInfo: TaskSystemInfo, workspaceFolder: IWorkspaceFolder, shellLaunchConfig: IShellLaunchConfig } {
		if (this.verify()) {
			return { task: this.task, resolver: this.resolver, trigger: this.trigger, resolvedVariables: this.resolvedVariables!, systemInfo: this.systemInfo!, workspaceFolder: this.workspaceFolder!, shellLaunchConfig: this.shellLaunchConfig! };
		} else {
			throw new Error('VerifiedTask was not checked. verify must be checked before getVerifiedTask.');
		}
	}
}

export class TerminalTaskSystem implements ITaskSystem {

	public static TelemetryEventName: string = 'taskService';

	private static readonly ProcessVarName = '__process__';

	private static shellQuotes: IStringDictionary<ShellQuotingOptions> = {
		'cmd': {
			strong: '"'
		},
		'powershell': {
			escape: {
				escapeChar: '`',
				charsToEscape: ' "\'()'
			},
			strong: '\'',
			weak: '"'
		},
		'bash': {
			escape: {
				escapeChar: '\\',
				charsToEscape: ' "\''
			},
			strong: '\'',
			weak: '"'
		},
		'zsh': {
			escape: {
				escapeChar: '\\',
				charsToEscape: ' "\''
			},
			strong: '\'',
			weak: '"'
		}
	};

	private static osShellQuotes: IStringDictionary<ShellQuotingOptions> = {
		'Linux': TerminalTaskSystem.shellQuotes['bash'],
		'Mac': TerminalTaskSystem.shellQuotes['bash'],
		'Windows': TerminalTaskSystem.shellQuotes['powershell']
	};

	private activeTasks: IStringDictionary<ActiveTerminalData>;
	private instances: IStringDictionary<InstanceManager>;
	private busyTasks: IStringDictionary<Task>;
	private terminals: IStringDictionary<TerminalData>;
	private idleTaskTerminals: LinkedMap<string, string>;
	private sameTaskTerminals: IStringDictionary<string>;
	private taskSystemInfoResolver: TaskSystemInfoResolver;
	private lastTask: VerifiedTask | undefined;
	// Should always be set in run
	private currentTask!: VerifiedTask;
	private isRerun: boolean = false;
	private previousPanelId: string | undefined;
	private previousTerminalInstance: ITerminalInstance | undefined;

	private readonly _onDidStateChange: Emitter<TaskEvent>;

	constructor(
		private terminalService: ITerminalService,
		private outputService: IOutputService,
		private panelService: IPanelService,
		private viewsService: IViewsService,
		private markerService: IMarkerService, private modelService: IModelService,
		private configurationResolverService: IConfigurationResolverService,
		private telemetryService: ITelemetryService,
		private contextService: IWorkspaceContextService,
		private environmentService: IWorkbenchEnvironmentService,
		private outputChannelId: string,
		private fileService: IFileService,
		private terminalInstanceService: ITerminalInstanceService,
		private pathService: IPathService,
		private viewDescriptorService: IViewDescriptorService,
		taskSystemInfoResolver: TaskSystemInfoResolver,
	) {

		this.activeTasks = Object.create(null);
		this.instances = Object.create(null);
		this.busyTasks = Object.create(null);
		this.terminals = Object.create(null);
		this.idleTaskTerminals = new LinkedMap<string, string>();
		this.sameTaskTerminals = Object.create(null);

		this._onDidStateChange = new Emitter();
		this.taskSystemInfoResolver = taskSystemInfoResolver;
	}

	public get onDidStateChange(): Event<TaskEvent> {
		return this._onDidStateChange.event;
	}

	public log(value: string): void {
		this.appendOutput(value + '\n');
	}

	protected showOutput(): void {
		this.outputService.showChannel(this.outputChannelId, true);
	}

	public run(task: Task, resolver: ITaskResolver, trigger: string = Triggers.command): ITaskExecuteResult {
		task = task.clone(); // A small amount of task state is stored in the task (instance) and tasks passed in to run may have that set already.
		const recentTaskKey = task.getRecentlyUsedKey() ?? '';
		let validInstance = task.runOptions && task.runOptions.instanceLimit && this.instances[recentTaskKey] && this.instances[recentTaskKey].instances < task.runOptions.instanceLimit;
		let instance = this.instances[recentTaskKey] ? this.instances[recentTaskKey].instances : 0;
		this.currentTask = new VerifiedTask(task, resolver, trigger);
		if (instance > 0) {
			task.instance = this.instances[recentTaskKey].counter;
		}
		let lastTaskInstance = this.getLastInstance(task);
		let terminalData = lastTaskInstance ? this.activeTasks[lastTaskInstance.getMapKey()] : undefined;
		if (terminalData && terminalData.promise && !validInstance) {
			this.lastTask = this.currentTask;
			return { kind: TaskExecuteKind.Active, task: terminalData.task, active: { same: true, background: task.configurationProperties.isBackground! }, promise: terminalData.promise };
		}

		try {
			const executeResult = { kind: TaskExecuteKind.Started, task, started: {}, promise: this.executeTask(task, resolver, trigger) };
			executeResult.promise.then(summary => {
				this.lastTask = this.currentTask;
			});
			if (InMemoryTask.is(task) || !this.isTaskEmpty(task)) {
				if (!this.instances[recentTaskKey]) {
					this.instances[recentTaskKey] = new InstanceManager();
				}
				this.instances[recentTaskKey].addInstance();
			}
			return executeResult;
		} catch (error) {
			if (error instanceof TaskError) {
				throw error;
			} else if (error instanceof Error) {
				this.log(error.message);
				throw new TaskError(Severity.Error, error.message, TaskErrors.UnknownError);
			} else {
				this.log(error.toString());
				throw new TaskError(Severity.Error, nls.localize('TerminalTaskSystem.unknownError', 'A unknown error has occurred while executing a task. See task output log for details.'), TaskErrors.UnknownError);
			}
		}
	}

	public rerun(): ITaskExecuteResult | undefined {
		if (this.lastTask && this.lastTask.verify()) {
			if ((this.lastTask.task.runOptions.reevaluateOnRerun !== undefined) && !this.lastTask.task.runOptions.reevaluateOnRerun) {
				this.isRerun = true;
			}
			const result = this.run(this.lastTask.task, this.lastTask.resolver);
			result.promise.then(summary => {
				this.isRerun = false;
			});
			return result;
		} else {
			return undefined;
		}
	}

	public isTaskVisible(task: Task): boolean {
		let terminalData = this.activeTasks[task.getMapKey()];
		if (!terminalData) {
			return false;
		}
		const activeTerminalInstance = this.terminalService.getActiveInstance();
		const isPanelShowingTerminal = !!this.viewsService.getActiveViewWithId(TERMINAL_VIEW_ID);
		return isPanelShowingTerminal && (activeTerminalInstance?.id === terminalData.terminal.id);
	}


	public revealTask(task: Task): boolean {
		let terminalData = this.activeTasks[task.getMapKey()];
		if (!terminalData) {
			return false;
		}
		const isTerminalInPanel: boolean = this.viewDescriptorService.getViewLocationById(TERMINAL_VIEW_ID) === ViewContainerLocation.Panel;
		if (isTerminalInPanel && this.isTaskVisible(task)) {
			if (this.previousPanelId) {
				if (this.previousTerminalInstance) {
					this.terminalService.setActiveInstance(this.previousTerminalInstance);
				}
				this.panelService.openPanel(this.previousPanelId);
			} else {
				this.panelService.hideActivePanel();
			}
			this.previousPanelId = undefined;
			this.previousTerminalInstance = undefined;
		} else {
			if (isTerminalInPanel) {
				this.previousPanelId = this.panelService.getActivePanel()?.getId();
				if (this.previousPanelId === TERMINAL_VIEW_ID) {
					this.previousTerminalInstance = this.terminalService.getActiveInstance() ?? undefined;
				}
			}
			this.terminalService.setActiveInstance(terminalData.terminal);
			if (CustomTask.is(task) || ContributedTask.is(task)) {
				this.terminalService.showPanel(task.command.presentation!.focus);
			}
		}
		return true;
	}

	public isActive(): Promise<boolean> {
		return Promise.resolve(this.isActiveSync());
	}

	public isActiveSync(): boolean {
		return Object.keys(this.activeTasks).length > 0;
	}

	public canAutoTerminate(): boolean {
		return Object.keys(this.activeTasks).every(key => !this.activeTasks[key].task.configurationProperties.promptOnClose);
	}

	public getActiveTasks(): Task[] {
		return Object.keys(this.activeTasks).map(key => this.activeTasks[key].task);
	}

	public getLastInstance(task: Task): Task | undefined {
		let lastInstance = undefined;
		const recentKey = task.getRecentlyUsedKey();
		Object.keys(this.activeTasks).forEach((key) => {
			if (recentKey && recentKey === this.activeTasks[key].task.getRecentlyUsedKey()) {
				lastInstance = this.activeTasks[key].task;
			}
		});
		return lastInstance;
	}

	public getBusyTasks(): Task[] {
		return Object.keys(this.busyTasks).map(key => this.busyTasks[key]);
	}

	public customExecutionComplete(task: Task, result: number): Promise<void> {
		let activeTerminal = this.activeTasks[task.getMapKey()];
		if (!activeTerminal) {
			return Promise.reject(new Error('Expected to have a terminal for an custom execution task'));
		}

		return new Promise<void>((resolve) => {
			// activeTerminal.terminal.rendererExit(result);
			resolve();
		});
	}

	private removeInstances(task: Task) {
		const recentTaskKey = task.getRecentlyUsedKey() ?? '';
		if (this.instances[recentTaskKey]) {
			this.instances[recentTaskKey].removeInstance();
			if (this.instances[recentTaskKey].instances === 0) {
				delete this.instances[recentTaskKey];
			}
		}
	}

	private removeFromActiveTasks(task: Task): void {
		if (!this.activeTasks[task.getMapKey()]) {
			return;
		}
		delete this.activeTasks[task.getMapKey()];
		this.removeInstances(task);
	}

	public terminate(task: Task): Promise<TaskTerminateResponse> {
		let activeTerminal = this.activeTasks[task.getMapKey()];
		if (!activeTerminal) {
			return Promise.resolve<TaskTerminateResponse>({ success: false, task: undefined });
		}
		return new Promise<TaskTerminateResponse>((resolve, reject) => {
			let terminal = activeTerminal.terminal;

			const onExit = terminal.onExit(() => {
				let task = activeTerminal.task;
				try {
					onExit.dispose();
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Terminated, task));
				} catch (error) {
					// Do nothing.
				}
				resolve({ success: true, task: task });
			});
			terminal.dispose();
		});
	}

	public terminateAll(): Promise<TaskTerminateResponse[]> {
		let promises: Promise<TaskTerminateResponse>[] = [];
		Object.keys(this.activeTasks).forEach((key) => {
			let terminalData = this.activeTasks[key];
			let terminal = terminalData.terminal;
			promises.push(new Promise<TaskTerminateResponse>((resolve, reject) => {
				const onExit = terminal.onExit(() => {
					let task = terminalData.task;
					try {
						onExit.dispose();
						this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Terminated, task));
					} catch (error) {
						// Do nothing.
					}
					resolve({ success: true, task: terminalData.task });
				});
			}));
			terminal.dispose();
		});
		this.activeTasks = Object.create(null);
		return Promise.all<TaskTerminateResponse>(promises);
	}

	private async executeTask(task: Task, resolver: ITaskResolver, trigger: string, alreadyResolved?: Map<string, string>): Promise<ITaskSummary> {
		alreadyResolved = alreadyResolved ?? new Map<string, string>();
		let promises: Promise<ITaskSummary>[] = [];
		if (task.configurationProperties.dependsOn) {
			for (const dependency of task.configurationProperties.dependsOn) {
				let dependencyTask = await resolver.resolve(dependency.uri, dependency.task!);
				if (dependencyTask) {
					let key = dependencyTask.getMapKey();
					let promise = this.activeTasks[key] ? this.activeTasks[key].promise : undefined;
					if (!promise) {
						this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.DependsOnStarted, task));
						promise = this.executeTask(dependencyTask, resolver, trigger, alreadyResolved);
					}
					promises.push(promise);
					if (task.configurationProperties.dependsOrder === DependsOrder.sequence) {
						const promiseResult = await promise;
						if (promiseResult.exitCode === 0) {
							promise = Promise.resolve(promiseResult);
						} else {
							promise = Promise.reject(promiseResult);
							break;
						}
					}
					promises.push(promise);
				} else {
					this.log(nls.localize('dependencyFailed',
						'Couldn\'t resolve dependent task \'{0}\' in workspace folder \'{1}\'',
						Types.isString(dependency.task) ? dependency.task : JSON.stringify(dependency.task, undefined, 0),
						dependency.uri.toString()
					));
					this.showOutput();
				}
			}
		}

		if ((ContributedTask.is(task) || CustomTask.is(task)) && (task.command)) {
			return Promise.all(promises).then((summaries): Promise<ITaskSummary> | ITaskSummary => {
				for (let summary of summaries) {
					if (summary.exitCode !== 0) {
						this.removeInstances(task);
						return { exitCode: summary.exitCode };
					}
				}
				if (this.isRerun) {
					return this.reexecuteCommand(task, trigger, alreadyResolved!);
				} else {
					return this.executeCommand(task, trigger, alreadyResolved!);
				}
			});
		} else {
			return Promise.all(promises).then((summaries): ITaskSummary => {
				for (let summary of summaries) {
					if (summary.exitCode !== 0) {
						return { exitCode: summary.exitCode };
					}
				}
				return { exitCode: 0 };
			});
		}
	}

	private resolveAndFindExecutable(workspaceFolder: IWorkspaceFolder | undefined, task: CustomTask | ContributedTask, cwd: string | undefined, envPath: string | undefined): Promise<string> {
		return this.findExecutable(
			this.configurationResolverService.resolve(workspaceFolder, CommandString.value(task.command.name!)),
			cwd ? this.configurationResolverService.resolve(workspaceFolder, cwd) : undefined,
			envPath ? envPath.split(path.delimiter).map(p => this.configurationResolverService.resolve(workspaceFolder, p)) : undefined
		);
	}

	private findUnresolvedVariables(variables: Set<string>, alreadyResolved: Map<string, string>): Set<string> {
		if (alreadyResolved.size === 0) {
			return variables;
		}
		const unresolved = new Set<string>();
		for (const variable of variables) {
			if (!alreadyResolved.has(variable.substring(2, variable.length - 1))) {
				unresolved.add(variable);
			}
		}
		return unresolved;
	}

	private mergeMaps(mergeInto: Map<string, string>, mergeFrom: Map<string, string>) {
		for (const entry of mergeFrom) {
			if (!mergeInto.has(entry[0])) {
				mergeInto.set(entry[0], entry[1]);
			}
		}
	}

	private resolveVariablesFromSet(taskSystemInfo: TaskSystemInfo | undefined, workspaceFolder: IWorkspaceFolder | undefined, task: CustomTask | ContributedTask, variables: Set<string>, alreadyResolved: Map<string, string>): Promise<ResolvedVariables> {
		let isProcess = task.command && task.command.runtime === RuntimeType.Process;
		let options = task.command && task.command.options ? task.command.options : undefined;
		let cwd = options ? options.cwd : undefined;
		let envPath: string | undefined = undefined;
		if (options && options.env) {
			for (let key of Object.keys(options.env)) {
				if (key.toLowerCase() === 'path') {
					if (Types.isString(options.env[key])) {
						envPath = options.env[key];
					}
					break;
				}
			}
		}
		const unresolved = this.findUnresolvedVariables(variables, alreadyResolved);
		let resolvedVariables: Promise<ResolvedVariables>;
		if (taskSystemInfo && workspaceFolder) {
			let resolveSet: ResolveSet = {
				variables: unresolved
			};

			if (taskSystemInfo.platform === Platform.Platform.Windows && isProcess) {
				resolveSet.process = { name: CommandString.value(task.command.name!) };
				if (cwd) {
					resolveSet.process.cwd = cwd;
				}
				if (envPath) {
					resolveSet.process.path = envPath;
				}
			}
			resolvedVariables = taskSystemInfo.resolveVariables(workspaceFolder, resolveSet, TaskSourceKind.toConfigurationTarget(task._source.kind)).then(async (resolved) => {
				this.mergeMaps(alreadyResolved, resolved.variables);
				resolved.variables = new Map(alreadyResolved);
				if (isProcess) {
					let process = CommandString.value(task.command.name!);
					if (taskSystemInfo.platform === Platform.Platform.Windows) {
						process = await this.resolveAndFindExecutable(workspaceFolder, task, cwd, envPath);
					}
					resolved.variables.set(TerminalTaskSystem.ProcessVarName, process);
				}
				return Promise.resolve(resolved);
			});
			return resolvedVariables;
		} else {
			let variablesArray = new Array<string>();
			unresolved.forEach(variable => variablesArray.push(variable));

			return new Promise((resolve, reject) => {
				this.configurationResolverService.resolveWithInteraction(workspaceFolder, variablesArray, 'tasks', undefined, TaskSourceKind.toConfigurationTarget(task._source.kind)).then(async (resolvedVariablesMap: Map<string, string> | undefined) => {
					if (resolvedVariablesMap) {
						this.mergeMaps(alreadyResolved, resolvedVariablesMap);
						resolvedVariablesMap = new Map(alreadyResolved);
						if (isProcess) {
							let processVarValue: string;
							if (Platform.isWindows) {
								processVarValue = await this.resolveAndFindExecutable(workspaceFolder, task, cwd, envPath);
							} else {
								processVarValue = this.configurationResolverService.resolve(workspaceFolder, CommandString.value(task.command.name!));
							}
							resolvedVariablesMap.set(TerminalTaskSystem.ProcessVarName, processVarValue);
						}
						let resolvedVariablesResult: ResolvedVariables = {
							variables: resolvedVariablesMap,
						};
						resolve(resolvedVariablesResult);
					} else {
						resolve(undefined);
					}
				}, reason => {
					reject(reason);
				});
			});
		}
	}

	private executeCommand(task: CustomTask | ContributedTask, trigger: string, alreadyResolved: Map<string, string>): Promise<ITaskSummary> {
		const taskWorkspaceFolder = task.getWorkspaceFolder();
		let workspaceFolder: IWorkspaceFolder | undefined;
		if (taskWorkspaceFolder) {
			workspaceFolder = this.currentTask.workspaceFolder = taskWorkspaceFolder;
		} else {
			const folders = this.contextService.getWorkspace().folders;
			workspaceFolder = folders.length > 0 ? folders[0] : undefined;
		}
		const systemInfo: TaskSystemInfo | undefined = this.currentTask.systemInfo = workspaceFolder ? this.taskSystemInfoResolver(workspaceFolder) : undefined;

		let variables = new Set<string>();
		this.collectTaskVariables(variables, task);
		const resolvedVariables = this.resolveVariablesFromSet(systemInfo, workspaceFolder, task, variables, alreadyResolved);

		return resolvedVariables.then((resolvedVariables) => {
			if (resolvedVariables && !this.isTaskEmpty(task)) {
				this.currentTask.resolvedVariables = resolvedVariables;
				return this.executeInTerminal(task, trigger, new VariableResolver(workspaceFolder, systemInfo, resolvedVariables.variables, this.configurationResolverService), workspaceFolder);
			} else {
				// Allows the taskExecutions array to be updated in the extension host
				this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.End, task));
				return Promise.resolve({ exitCode: 0 });
			}
		}, reason => {
			return Promise.reject(reason);
		});
	}

	private isTaskEmpty(task: CustomTask | ContributedTask): boolean {
		const isCustomExecution = (task.command.runtime === RuntimeType.CustomExecution);
		return !((task.command !== undefined) && task.command.runtime && (isCustomExecution || (task.command.name !== undefined)));
	}

	private reexecuteCommand(task: CustomTask | ContributedTask, trigger: string, alreadyResolved: Map<string, string>): Promise<ITaskSummary> {
		const lastTask = this.lastTask;
		if (!lastTask) {
			return Promise.reject(new Error('No task previously run'));
		}
		const workspaceFolder = this.currentTask.workspaceFolder = lastTask.workspaceFolder;
		let variables = new Set<string>();
		this.collectTaskVariables(variables, task);

		// Check that the task hasn't changed to include new variables
		let hasAllVariables = true;
		variables.forEach(value => {
			if (value.substring(2, value.length - 1) in lastTask.getVerifiedTask().resolvedVariables) {
				hasAllVariables = false;
			}
		});

		if (!hasAllVariables) {
			return this.resolveVariablesFromSet(lastTask.getVerifiedTask().systemInfo, lastTask.getVerifiedTask().workspaceFolder, task, variables, alreadyResolved).then((resolvedVariables) => {
				this.currentTask.resolvedVariables = resolvedVariables;
				return this.executeInTerminal(task, trigger, new VariableResolver(lastTask.getVerifiedTask().workspaceFolder, lastTask.getVerifiedTask().systemInfo, resolvedVariables.variables, this.configurationResolverService), workspaceFolder!);
			}, reason => {
				return Promise.reject(reason);
			});
		} else {
			this.currentTask.resolvedVariables = lastTask.getVerifiedTask().resolvedVariables;
			return this.executeInTerminal(task, trigger, new VariableResolver(lastTask.getVerifiedTask().workspaceFolder, lastTask.getVerifiedTask().systemInfo, lastTask.getVerifiedTask().resolvedVariables.variables, this.configurationResolverService), workspaceFolder!);
		}
	}

	private async executeInTerminal(task: CustomTask | ContributedTask, trigger: string, resolver: VariableResolver, workspaceFolder: IWorkspaceFolder | undefined): Promise<ITaskSummary> {
		let terminal: ITerminalInstance | undefined = undefined;
		let executedCommand: string | undefined = undefined;
		let error: TaskError | undefined = undefined;
		let promise: Promise<ITaskSummary> | undefined = undefined;
		if (task.configurationProperties.isBackground) {
			const problemMatchers = this.resolveMatchers(resolver, task.configurationProperties.problemMatchers);
			let watchingProblemMatcher = new WatchingProblemCollector(problemMatchers, this.markerService, this.modelService, this.fileService);
			if ((problemMatchers.length > 0) && !watchingProblemMatcher.isWatching()) {
				this.appendOutput(nls.localize('TerminalTaskSystem.nonWatchingMatcher', 'Task {0} is a background task but uses a problem matcher without a background pattern', task._label));
				this.showOutput();
			}
			const toDispose = new DisposableStore();
			let eventCounter: number = 0;
			const mapKey = task.getMapKey();
			toDispose.add(watchingProblemMatcher.onDidStateChange((event) => {
				if (event.kind === ProblemCollectorEventKind.BackgroundProcessingBegins) {
					eventCounter++;
					this.busyTasks[mapKey] = task;
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Active, task));
				} else if (event.kind === ProblemCollectorEventKind.BackgroundProcessingEnds) {
					eventCounter--;
					if (this.busyTasks[mapKey]) {
						delete this.busyTasks[mapKey];
					}
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Inactive, task));
					if (eventCounter === 0) {
						if ((watchingProblemMatcher.numberOfMatches > 0) && watchingProblemMatcher.maxMarkerSeverity &&
							(watchingProblemMatcher.maxMarkerSeverity >= MarkerSeverity.Error)) {
							let reveal = task.command.presentation!.reveal;
							let revealProblems = task.command.presentation!.revealProblems;
							if (revealProblems === RevealProblemKind.OnProblem) {
								this.viewsService.openView(Constants.MARKERS_VIEW_ID, true);
							} else if (reveal === RevealKind.Silent) {
								this.terminalService.setActiveInstance(terminal!);
								this.terminalService.showPanel(false);
							}
						}
					}
				}
			}));
			watchingProblemMatcher.aboutToStart();
			let delayer: Async.Delayer<any> | undefined = undefined;
			[terminal, executedCommand, error] = await this.createTerminal(task, resolver, workspaceFolder);

			if (error) {
				return Promise.reject(new Error((<TaskError>error).message));
			}
			if (!terminal) {
				return Promise.reject(new Error(`Failed to create terminal for task ${task._label}`));
			}

			let processStartedSignaled = false;
			terminal.processReady.then(() => {
				if (!processStartedSignaled) {
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessStarted, task, terminal!.processId!));
					processStartedSignaled = true;
				}
			}, (_error) => {
				// The process never got ready. Need to think how to handle this.
			});
			this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Start, task, terminal.id));
			const registeredLinkMatchers = this.registerLinkMatchers(terminal, problemMatchers);
			let skipLine: boolean = (!!task.command.presentation && task.command.presentation.echo);
			const onData = terminal.onLineData((line) => {
				if (skipLine) {
					skipLine = false;
					return;
				}
				watchingProblemMatcher.processLine(line);
				if (!delayer) {
					delayer = new Async.Delayer(3000);
				}
				delayer.trigger(() => {
					watchingProblemMatcher.forceDelivery();
					delayer = undefined;
				});
			});
			promise = new Promise<ITaskSummary>((resolve, reject) => {
				const onExit = terminal!.onExit((exitCode) => {
					onData.dispose();
					onExit.dispose();
					let key = task.getMapKey();
					if (this.busyTasks[mapKey]) {
						delete this.busyTasks[mapKey];
					}
					this.removeFromActiveTasks(task);
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Changed));
					if (exitCode !== undefined) {
						// Only keep a reference to the terminal if it is not being disposed.
						switch (task.command.presentation!.panel) {
							case PanelKind.Dedicated:
								this.sameTaskTerminals[key] = terminal!.id.toString();
								break;
							case PanelKind.Shared:
								this.idleTaskTerminals.set(key, terminal!.id.toString(), Touch.AsOld);
								break;
						}
					}
					let reveal = task.command.presentation!.reveal;
					if ((reveal === RevealKind.Silent) && ((exitCode !== 0) || (watchingProblemMatcher.numberOfMatches > 0) && watchingProblemMatcher.maxMarkerSeverity &&
						(watchingProblemMatcher.maxMarkerSeverity >= MarkerSeverity.Error))) {
						this.terminalService.setActiveInstance(terminal!);
						this.terminalService.showPanel(false);
					}
					watchingProblemMatcher.done();
					watchingProblemMatcher.dispose();
					registeredLinkMatchers.forEach(handle => terminal!.deregisterLinkMatcher(handle));
					if (!processStartedSignaled) {
						this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessStarted, task, terminal!.processId!));
						processStartedSignaled = true;
					}

					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessEnded, task, exitCode));

					for (let i = 0; i < eventCounter; i++) {
						let event = TaskEvent.create(TaskEventKind.Inactive, task);
						this._onDidStateChange.fire(event);
					}
					eventCounter = 0;
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.End, task));
					toDispose.dispose();
					resolve({ exitCode });
				});
			});
		} else {
			[terminal, executedCommand, error] = await this.createTerminal(task, resolver, workspaceFolder);

			if (error) {
				return Promise.reject(new Error((<TaskError>error).message));
			}
			if (!terminal) {
				return Promise.reject(new Error(`Failed to create terminal for task ${task._label}`));
			}

			let processStartedSignaled = false;
			terminal.processReady.then(() => {
				if (!processStartedSignaled) {
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessStarted, task, terminal!.processId!));
					processStartedSignaled = true;
				}
			}, (_error) => {
				// The process never got ready. Need to think how to handle this.
			});
			this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Start, task, terminal.id));
			const mapKey = task.getMapKey();
			this.busyTasks[mapKey] = task;
			this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Active, task));
			let problemMatchers = this.resolveMatchers(resolver, task.configurationProperties.problemMatchers);
			let startStopProblemMatcher = new StartStopProblemCollector(problemMatchers, this.markerService, this.modelService, ProblemHandlingStrategy.Clean, this.fileService);
			const registeredLinkMatchers = this.registerLinkMatchers(terminal, problemMatchers);
			let skipLine: boolean = (!!task.command.presentation && task.command.presentation.echo);
			const onData = terminal.onLineData((line) => {
				if (skipLine) {
					skipLine = false;
					return;
				}
				startStopProblemMatcher.processLine(line);
			});
			promise = new Promise<ITaskSummary>((resolve, reject) => {
				const onExit = terminal!.onExit((exitCode) => {
					onData.dispose();
					onExit.dispose();
					let key = task.getMapKey();
					this.removeFromActiveTasks(task);
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Changed));
					if (exitCode !== undefined) {
						// Only keep a reference to the terminal if it is not being disposed.
						switch (task.command.presentation!.panel) {
							case PanelKind.Dedicated:
								this.sameTaskTerminals[key] = terminal!.id.toString();
								break;
							case PanelKind.Shared:
								this.idleTaskTerminals.set(key, terminal!.id.toString(), Touch.AsOld);
								break;
						}
					}
					let reveal = task.command.presentation!.reveal;
					let revealProblems = task.command.presentation!.revealProblems;
					let revealProblemPanel = terminal && (revealProblems === RevealProblemKind.OnProblem) && (startStopProblemMatcher.numberOfMatches > 0);
					if (revealProblemPanel) {
						this.viewsService.openView(Constants.MARKERS_VIEW_ID);
					} else if (terminal && (reveal === RevealKind.Silent) && ((exitCode !== 0) || (startStopProblemMatcher.numberOfMatches > 0) && startStopProblemMatcher.maxMarkerSeverity &&
						(startStopProblemMatcher.maxMarkerSeverity >= MarkerSeverity.Error))) {
						this.terminalService.setActiveInstance(terminal);
						this.terminalService.showPanel(false);
					}
					startStopProblemMatcher.done();
					startStopProblemMatcher.dispose();
					registeredLinkMatchers.forEach(handle => {
						if (terminal) {
							terminal.deregisterLinkMatcher(handle);
						}
					});
					if (!processStartedSignaled && terminal) {
						this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessStarted, task, terminal.processId!));
						processStartedSignaled = true;
					}

					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessEnded, task, exitCode));
					if (this.busyTasks[mapKey]) {
						delete this.busyTasks[mapKey];
					}
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Inactive, task));
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.End, task));
					resolve({ exitCode });
				});
			});
		}

		let showProblemPanel = task.command.presentation && (task.command.presentation.revealProblems === RevealProblemKind.Always);
		if (showProblemPanel) {
			this.viewsService.openView(Constants.MARKERS_VIEW_ID);
		} else if (task.command.presentation && (task.command.presentation.reveal === RevealKind.Always)) {
			this.terminalService.setActiveInstance(terminal);
			this.terminalService.showPanel(task.command.presentation.focus);
		}
		this.activeTasks[task.getMapKey()] = { terminal, task, promise };
		this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Changed));
		return promise.then((summary) => {
			try {
				let telemetryEvent: TelemetryEvent = {
					trigger: trigger,
					runner: 'terminal',
					taskKind: task.getTelemetryKind(),
					command: this.getSanitizedCommand(executedCommand!),
					success: true,
					exitCode: summary.exitCode
				};
				/* __GDPR__
					"taskService" : {
						"${include}": [
							"${TelemetryEvent}"
						]
					}
				*/
				this.telemetryService.publicLog(TerminalTaskSystem.TelemetryEventName, telemetryEvent);
			} catch (error) {
			}
			return summary;
		}, (error) => {
			try {
				let telemetryEvent: TelemetryEvent = {
					trigger: trigger,
					runner: 'terminal',
					taskKind: task.getTelemetryKind(),
					command: this.getSanitizedCommand(executedCommand!),
					success: false
				};
				/* __GDPR__
					"taskService" : {
						"${include}": [
							"${TelemetryEvent}"
						]
					}
				*/
				this.telemetryService.publicLog(TerminalTaskSystem.TelemetryEventName, telemetryEvent);
			} catch (error) {
			}
			return Promise.reject<ITaskSummary>(error);
		});
	}

	private createTerminalName(task: CustomTask | ContributedTask): string {
		const needsFolderQualification = this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE;
		return nls.localize('TerminalTaskSystem.terminalName', 'Task - {0}', needsFolderQualification ? task.getQualifiedLabel() : task.configurationProperties.name);
	}

	private async createShellLaunchConfig(task: CustomTask | ContributedTask, workspaceFolder: IWorkspaceFolder | undefined, variableResolver: VariableResolver, platform: Platform.Platform, options: CommandOptions, command: CommandString, args: CommandString[], waitOnExit: boolean | string): Promise<IShellLaunchConfig | undefined> {
		let shellLaunchConfig: IShellLaunchConfig;
		let isShellCommand = task.command.runtime === RuntimeType.Shell;
		let needsFolderQualification = this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE;
		let terminalName = this.createTerminalName(task);
		let originalCommand = task.command.name;
		if (isShellCommand) {
			const defaultConfig = variableResolver.taskSystemInfo ? await variableResolver.taskSystemInfo.getDefaultShellAndArgs() : await this.terminalInstanceService.getDefaultShellAndArgs(true, platform);
			shellLaunchConfig = { name: terminalName, executable: defaultConfig.shell, args: defaultConfig.args, waitOnExit };
			let shellSpecified: boolean = false;
			let shellOptions: ShellConfiguration | undefined = task.command.options && task.command.options.shell;
			if (shellOptions) {
				if (shellOptions.executable) {
					shellLaunchConfig.executable = this.resolveVariable(variableResolver, shellOptions.executable);
					shellSpecified = true;
				}
				if (shellOptions.args) {
					shellLaunchConfig.args = this.resolveVariables(variableResolver, shellOptions.args.slice());
				} else {
					shellLaunchConfig.args = [];
				}
			}
			let shellArgs = Array.isArray(shellLaunchConfig.args!) ? <string[]>shellLaunchConfig.args!.slice(0) : [shellLaunchConfig.args!];
			let toAdd: string[] = [];
			let commandLine = this.buildShellCommandLine(platform, shellLaunchConfig.executable!, shellOptions, command, originalCommand, args);
			let windowsShellArgs: boolean = false;
			if (platform === Platform.Platform.Windows) {
				windowsShellArgs = true;
				let basename = path.basename(shellLaunchConfig.executable!).toLowerCase();
				// If we don't have a cwd, then the terminal uses the home dir.
				const userHome = await this.pathService.userHome;
				if (basename === 'cmd.exe' && ((options.cwd && isUNC(options.cwd)) || (!options.cwd && isUNC(userHome.fsPath)))) {
					return undefined;
				}
				if ((basename === 'powershell.exe') || (basename === 'pwsh.exe')) {
					if (!shellSpecified) {
						toAdd.push('-Command');
					}
				} else if ((basename === 'bash.exe') || (basename === 'zsh.exe')) {
					windowsShellArgs = false;
					if (!shellSpecified) {
						toAdd.push('-c');
					}
				} else if (basename === 'wsl.exe') {
					if (!shellSpecified) {
						toAdd.push('-e');
					}
				} else {
					if (!shellSpecified) {
						toAdd.push('/d', '/c');
					}
				}
			} else {
				if (!shellSpecified) {
					// Under Mac remove -l to not start it as a login shell.
					if (platform === Platform.Platform.Mac) {
						let index = shellArgs.indexOf('-l');
						if (index !== -1) {
							shellArgs.splice(index, 1);
						}
					}
					toAdd.push('-c');
				}
			}
			toAdd.forEach(element => {
				if (!shellArgs.some(arg => arg.toLowerCase() === element)) {
					shellArgs.push(element);
				}
			});
			shellArgs.push(commandLine);
			shellLaunchConfig.args = windowsShellArgs ? shellArgs.join(' ') : shellArgs;
			if (task.command.presentation && task.command.presentation.echo) {
				if (needsFolderQualification && workspaceFolder) {
					shellLaunchConfig.initialText = `\x1b[1m> Executing task in folder ${workspaceFolder.name}: ${commandLine} <\x1b[0m\n`;
				} else {
					shellLaunchConfig.initialText = `\x1b[1m> Executing task: ${commandLine} <\x1b[0m\n`;
				}
			}
		} else {
			let commandExecutable = (task.command.runtime !== RuntimeType.CustomExecution) ? CommandString.value(command) : undefined;
			let executable = !isShellCommand
				? this.resolveVariable(variableResolver, '${' + TerminalTaskSystem.ProcessVarName + '}')
				: commandExecutable;

			// When we have a process task there is no need to quote arguments. So we go ahead and take the string value.
			shellLaunchConfig = {
				name: terminalName,
				executable: executable,
				args: args.map(a => Types.isString(a) ? a : a.value),
				waitOnExit
			};
			if (task.command.presentation && task.command.presentation.echo) {
				let getArgsToEcho = (args: string | string[] | undefined): string => {
					if (!args || args.length === 0) {
						return '';
					}
					if (Types.isString(args)) {
						return args;
					}
					return args.join(' ');
				};
				if (needsFolderQualification && workspaceFolder) {
					shellLaunchConfig.initialText = `\x1b[1m> Executing task in folder ${workspaceFolder.name}: ${shellLaunchConfig.executable} ${getArgsToEcho(shellLaunchConfig.args)} <\x1b[0m\n`;
				} else {
					shellLaunchConfig.initialText = `\x1b[1m> Executing task: ${shellLaunchConfig.executable} ${getArgsToEcho(shellLaunchConfig.args)} <\x1b[0m\n`;
				}
			}
		}

		if (options.cwd) {
			let cwd = options.cwd;
			if (!path.isAbsolute(cwd)) {
				if (workspaceFolder && (workspaceFolder.uri.scheme === 'file')) {
					cwd = path.join(workspaceFolder.uri.fsPath, cwd);
				}
			}
			// This must be normalized to the OS
			shellLaunchConfig.cwd = resources.toLocalResource(URI.from({ scheme: Schemas.file, path: cwd }), this.environmentService.configuration.remoteAuthority);
		}
		if (options.env) {
			shellLaunchConfig.env = options.env;
		}
		return shellLaunchConfig;
	}

	private async createTerminal(task: CustomTask | ContributedTask, resolver: VariableResolver, workspaceFolder: IWorkspaceFolder | undefined): Promise<[ITerminalInstance | undefined, string | undefined, TaskError | undefined]> {
		let platform = resolver.taskSystemInfo ? resolver.taskSystemInfo.platform : Platform.platform;
		let options = this.resolveOptions(resolver, task.command.options);

		let waitOnExit: boolean | string = false;
		const presentationOptions = task.command.presentation;
		if (!presentationOptions) {
			throw new Error('Task presentation options should not be undefined here.');
		}

		if (presentationOptions.reveal !== RevealKind.Never || !task.configurationProperties.isBackground) {
			if (presentationOptions.panel === PanelKind.New) {
				waitOnExit = nls.localize('closeTerminal', 'Press any key to close the terminal.');
			} else if (presentationOptions.showReuseMessage) {
				waitOnExit = nls.localize('reuseTerminal', 'Terminal will be reused by tasks, press any key to close it.');
			} else {
				waitOnExit = true;
			}
		}

		let commandExecutable: string | undefined;
		let command: CommandString | undefined;
		let args: CommandString[] | undefined;
		let launchConfigs: IShellLaunchConfig | undefined;

		if (task.command.runtime === RuntimeType.CustomExecution) {
			this.currentTask.shellLaunchConfig = launchConfigs = {
				isExtensionTerminal: true,
				waitOnExit,
				name: this.createTerminalName(task),
				initialText: task.command.presentation && task.command.presentation.echo ? `\x1b[1m> Executing task: ${task._label} <\x1b[0m\n` : undefined
			};
		} else {
			let resolvedResult: { command: CommandString, args: CommandString[] } = this.resolveCommandAndArgs(resolver, task.command);
			command = resolvedResult.command;
			args = resolvedResult.args;
			commandExecutable = CommandString.value(command);

			this.currentTask.shellLaunchConfig = launchConfigs = (this.isRerun && this.lastTask) ? this.lastTask.getVerifiedTask().shellLaunchConfig : await this.createShellLaunchConfig(task, workspaceFolder, resolver, platform, options, command, args, waitOnExit);
			if (launchConfigs === undefined) {
				return [undefined, undefined, new TaskError(Severity.Error, nls.localize('TerminalTaskSystem', 'Can\'t execute a shell command on an UNC drive using cmd.exe.'), TaskErrors.UnknownError)];
			}
		}

		let prefersSameTerminal = presentationOptions.panel === PanelKind.Dedicated;
		let allowsSharedTerminal = presentationOptions.panel === PanelKind.Shared;
		let group = presentationOptions.group;

		let taskKey = task.getMapKey();
		let terminalToReuse: TerminalData | undefined;
		if (prefersSameTerminal) {
			let terminalId = this.sameTaskTerminals[taskKey];
			if (terminalId) {
				terminalToReuse = this.terminals[terminalId];
				delete this.sameTaskTerminals[taskKey];
			}
		} else if (allowsSharedTerminal) {
			// Always allow to reuse the terminal previously used by the same task.
			let terminalId = this.idleTaskTerminals.remove(taskKey);
			if (!terminalId) {
				// There is no idle terminal which was used by the same task.
				// Search for any idle terminal used previously by a task of the same group
				// (or, if the task has no group, a terminal used by a task without group).
				for (const taskId of this.idleTaskTerminals.keys()) {
					const idleTerminalId = this.idleTaskTerminals.get(taskId)!;
					if (idleTerminalId && this.terminals[idleTerminalId] && this.terminals[idleTerminalId].group === group) {
						terminalId = this.idleTaskTerminals.remove(taskId);
						break;
					}
				}
			}
			if (terminalId) {
				terminalToReuse = this.terminals[terminalId];
			}
		}
		if (terminalToReuse) {
			if (!launchConfigs) {
				throw new Error('Task shell launch configuration should not be undefined here.');
			}

			terminalToReuse.terminal.scrollToBottom();
			terminalToReuse.terminal.reuseTerminal(launchConfigs);

			if (task.command.presentation && task.command.presentation.clear) {
				terminalToReuse.terminal.clear();
			}
			this.terminals[terminalToReuse.terminal.id.toString()].lastTask = taskKey;
			return [terminalToReuse.terminal, commandExecutable, undefined];
		}

		let result: ITerminalInstance | null = null;
		if (group) {
			// Try to find an existing terminal to split.
			// Even if an existing terminal is found, the split can fail if the terminal width is too small.
			for (const terminal of values(this.terminals)) {
				if (terminal.group === group) {
					const originalInstance = terminal.terminal;
					await originalInstance.waitForTitle();
					result = this.terminalService.splitInstance(originalInstance, launchConfigs);
					if (result) {
						break;
					}
				}
			}
		}
		if (!result) {
			// Either no group is used, no terminal with the group exists or splitting an existing terminal failed.
			result = this.terminalService.createTerminal(launchConfigs);
		}

		const terminalKey = result.id.toString();
		result.onDisposed((terminal) => {
			let terminalData = this.terminals[terminalKey];
			if (terminalData) {
				delete this.terminals[terminalKey];
				delete this.sameTaskTerminals[terminalData.lastTask];
				this.idleTaskTerminals.delete(terminalData.lastTask);
				// Delete the task now as a work around for cases when the onExit isn't fired.
				// This can happen if the terminal wasn't shutdown with an "immediate" flag and is expected.
				// For correct terminal re-use, the task needs to be deleted immediately.
				// Note that this shouldn't be a problem anymore since user initiated terminal kills are now immediate.
				const mapKey = task.getMapKey();
				this.removeFromActiveTasks(task);
				if (this.busyTasks[mapKey]) {
					delete this.busyTasks[mapKey];
				}
			}
		});
		this.terminals[terminalKey] = { terminal: result, lastTask: taskKey, group };
		return [result, commandExecutable, undefined];
	}

	private buildShellCommandLine(platform: Platform.Platform, shellExecutable: string, shellOptions: ShellConfiguration | undefined, command: CommandString, originalCommand: CommandString | undefined, args: CommandString[]): string {
		let basename = path.parse(shellExecutable).name.toLowerCase();
		let shellQuoteOptions = this.getQuotingOptions(basename, shellOptions, platform);

		function needsQuotes(value: string): boolean {
			if (value.length >= 2) {
				let first = value[0] === shellQuoteOptions.strong ? shellQuoteOptions.strong : value[0] === shellQuoteOptions.weak ? shellQuoteOptions.weak : undefined;
				if (first === value[value.length - 1]) {
					return false;
				}
			}
			let quote: string | undefined;
			for (let i = 0; i < value.length; i++) {
				// We found the end quote.
				let ch = value[i];
				if (ch === quote) {
					quote = undefined;
				} else if (quote !== undefined) {
					// skip the character. We are quoted.
					continue;
				} else if (ch === shellQuoteOptions.escape) {
					// Skip the next character
					i++;
				} else if (ch === shellQuoteOptions.strong || ch === shellQuoteOptions.weak) {
					quote = ch;
				} else if (ch === ' ') {
					return true;
				}
			}
			return false;
		}

		function quote(value: string, kind: ShellQuoting): [string, boolean] {
			if (kind === ShellQuoting.Strong && shellQuoteOptions.strong) {
				return [shellQuoteOptions.strong + value + shellQuoteOptions.strong, true];
			} else if (kind === ShellQuoting.Weak && shellQuoteOptions.weak) {
				return [shellQuoteOptions.weak + value + shellQuoteOptions.weak, true];
			} else if (kind === ShellQuoting.Escape && shellQuoteOptions.escape) {
				if (Types.isString(shellQuoteOptions.escape)) {
					return [value.replace(/ /g, shellQuoteOptions.escape + ' '), true];
				} else {
					let buffer: string[] = [];
					for (let ch of shellQuoteOptions.escape.charsToEscape) {
						buffer.push(`\\${ch}`);
					}
					let regexp: RegExp = new RegExp('[' + buffer.join(',') + ']', 'g');
					let escapeChar = shellQuoteOptions.escape.escapeChar;
					return [value.replace(regexp, (match) => escapeChar + match), true];
				}
			}
			return [value, false];
		}

		function quoteIfNecessary(value: CommandString): [string, boolean] {
			if (Types.isString(value)) {
				if (needsQuotes(value)) {
					return quote(value, ShellQuoting.Strong);
				} else {
					return [value, false];
				}
			} else {
				return quote(value.value, value.quoting);
			}
		}

		// If we have no args and the command is a string then use the command to stay backwards compatible with the old command line
		// model. To allow variable resolving with spaces we do continue if the resolved value is different than the original one
		// and the resolved one needs quoting.
		if ((!args || args.length === 0) && Types.isString(command) && (command === originalCommand as string || needsQuotes(originalCommand as string))) {
			return command;
		}

		let result: string[] = [];
		let commandQuoted = false;
		let argQuoted = false;
		let value: string;
		let quoted: boolean;
		[value, quoted] = quoteIfNecessary(command);
		result.push(value);
		commandQuoted = quoted;
		for (let arg of args) {
			[value, quoted] = quoteIfNecessary(arg);
			result.push(value);
			argQuoted = argQuoted || quoted;
		}

		let commandLine = result.join(' ');
		// There are special rules quoted command line in cmd.exe
		if (platform === Platform.Platform.Windows) {
			if (basename === 'cmd' && commandQuoted && argQuoted) {
				commandLine = '"' + commandLine + '"';
			} else if (basename === 'powershell' && commandQuoted) {
				commandLine = '& ' + commandLine;
			}
		}

		if (basename === 'cmd' && platform === Platform.Platform.Windows && commandQuoted && argQuoted) {
			commandLine = '"' + commandLine + '"';
		}
		return commandLine;
	}

	private getQuotingOptions(shellBasename: string, shellOptions: ShellConfiguration | undefined, platform: Platform.Platform): ShellQuotingOptions {
		if (shellOptions && shellOptions.quoting) {
			return shellOptions.quoting;
		}
		return TerminalTaskSystem.shellQuotes[shellBasename] || TerminalTaskSystem.osShellQuotes[Platform.PlatformToString(platform)];
	}

	private collectTaskVariables(variables: Set<string>, task: CustomTask | ContributedTask): void {
		if (task.command && task.command.name) {
			this.collectCommandVariables(variables, task.command, task);
		}
		this.collectMatcherVariables(variables, task.configurationProperties.problemMatchers);
	}

	private collectCommandVariables(variables: Set<string>, command: CommandConfiguration, task: CustomTask | ContributedTask): void {
		// The custom execution should have everything it needs already as it provided
		// the callback.
		if (command.runtime === RuntimeType.CustomExecution) {
			return;
		}

		if (command.name === undefined) {
			throw new Error('Command name should never be undefined here.');
		}
		this.collectVariables(variables, command.name);
		if (command.args) {
			command.args.forEach(arg => this.collectVariables(variables, arg));
		}
		// Try to get a scope.
		const scope = (<ExtensionTaskSource>task._source).scope;
		if (scope !== TaskScope.Global) {
			variables.add('${workspaceFolder}');
		}
		if (command.options) {
			let options = command.options;
			if (options.cwd) {
				this.collectVariables(variables, options.cwd);
			}
			const optionsEnv = options.env;
			if (optionsEnv) {
				Object.keys(optionsEnv).forEach((key) => {
					let value: any = optionsEnv[key];
					if (Types.isString(value)) {
						this.collectVariables(variables, value);
					}
				});
			}
			if (options.shell) {
				if (options.shell.executable) {
					this.collectVariables(variables, options.shell.executable);
				}
				if (options.shell.args) {
					options.shell.args.forEach(arg => this.collectVariables(variables, arg));
				}
			}
		}
	}

	private collectMatcherVariables(variables: Set<string>, values: Array<string | ProblemMatcher> | undefined): void {
		if (values === undefined || values === null || values.length === 0) {
			return;
		}
		values.forEach((value) => {
			let matcher: ProblemMatcher;
			if (Types.isString(value)) {
				if (value[0] === '$') {
					matcher = ProblemMatcherRegistry.get(value.substring(1));
				} else {
					matcher = ProblemMatcherRegistry.get(value);
				}
			} else {
				matcher = value;
			}
			if (matcher && matcher.filePrefix) {
				this.collectVariables(variables, matcher.filePrefix);
			}
		});
	}

	private collectVariables(variables: Set<string>, value: string | CommandString): void {
		let string: string = Types.isString(value) ? value : value.value;
		let r = /\$\{(.*?)\}/g;
		let matches: RegExpExecArray | null;
		do {
			matches = r.exec(string);
			if (matches) {
				variables.add(matches[0]);
			}
		} while (matches);
	}

	private resolveCommandAndArgs(resolver: VariableResolver, commandConfig: CommandConfiguration): { command: CommandString, args: CommandString[] } {
		// First we need to use the command args:
		let args: CommandString[] = commandConfig.args ? commandConfig.args.slice() : [];
		args = this.resolveVariables(resolver, args);
		let command: CommandString = this.resolveVariable(resolver, commandConfig.name);
		return { command, args };
	}

	private resolveVariables(resolver: VariableResolver, value: string[]): string[];
	private resolveVariables(resolver: VariableResolver, value: CommandString[]): CommandString[];
	private resolveVariables(resolver: VariableResolver, value: CommandString[]): CommandString[] {
		return value.map(s => this.resolveVariable(resolver, s));
	}

	private resolveMatchers(resolver: VariableResolver, values: Array<string | ProblemMatcher> | undefined): ProblemMatcher[] {
		if (values === undefined || values === null || values.length === 0) {
			return [];
		}
		let result: ProblemMatcher[] = [];
		values.forEach((value) => {
			let matcher: ProblemMatcher;
			if (Types.isString(value)) {
				if (value[0] === '$') {
					matcher = ProblemMatcherRegistry.get(value.substring(1));
				} else {
					matcher = ProblemMatcherRegistry.get(value);
				}
			} else {
				matcher = value;
			}
			if (!matcher) {
				this.appendOutput(nls.localize('unknownProblemMatcher', 'Problem matcher {0} can\'t be resolved. The matcher will be ignored'));
				return;
			}
			let taskSystemInfo: TaskSystemInfo | undefined = resolver.taskSystemInfo;
			let hasFilePrefix = matcher.filePrefix !== undefined;
			let hasUriProvider = taskSystemInfo !== undefined && taskSystemInfo.uriProvider !== undefined;
			if (!hasFilePrefix && !hasUriProvider) {
				result.push(matcher);
			} else {
				let copy = Objects.deepClone(matcher);
				if (hasUriProvider && (taskSystemInfo !== undefined)) {
					copy.uriProvider = taskSystemInfo.uriProvider;
				}
				if (hasFilePrefix) {
					copy.filePrefix = this.resolveVariable(resolver, copy.filePrefix);
				}
				result.push(copy);
			}
		});
		return result;
	}

	private resolveVariable(resolver: VariableResolver, value: string | undefined): string;
	private resolveVariable(resolver: VariableResolver, value: CommandString | undefined): CommandString;
	private resolveVariable(resolver: VariableResolver, value: CommandString | undefined): CommandString {
		// TODO@Dirk Task.getWorkspaceFolder should return a WorkspaceFolder that is defined in workspace.ts
		if (Types.isString(value)) {
			return resolver.resolve(value);
		} else if (value !== undefined) {
			return {
				value: resolver.resolve(value.value),
				quoting: value.quoting
			};
		} else { // This should never happen
			throw new Error('Should never try to resolve undefined.');
		}
	}

	private resolveOptions(resolver: VariableResolver, options: CommandOptions | undefined): CommandOptions {
		if (options === undefined || options === null) {
			let cwd: string | undefined;
			try {
				cwd = this.resolveVariable(resolver, '${workspaceFolder}');
			} catch (e) {
				// No workspace
			}
			return { cwd };
		}
		let result: CommandOptions = Types.isString(options.cwd)
			? { cwd: this.resolveVariable(resolver, options.cwd) }
			: { cwd: this.resolveVariable(resolver, '${workspaceFolder}') };
		if (options.env) {
			result.env = Object.create(null);
			Object.keys(options.env).forEach((key) => {
				let value: any = options.env![key];
				if (Types.isString(value)) {
					result.env![key] = this.resolveVariable(resolver, value);
				} else {
					result.env![key] = value.toString();
				}
			});
		}
		return result;
	}

	private registerLinkMatchers(terminal: ITerminalInstance, problemMatchers: ProblemMatcher[]): number[] {
		let result: number[] = [];
		/*
		let handlePattern = (matcher: ProblemMatcher, pattern: ProblemPattern): void => {
			if (pattern.regexp instanceof RegExp && Types.isNumber(pattern.file)) {
				result.push(terminal.registerLinkMatcher(pattern.regexp, (match: string) => {
					let resource: URI = getResource(match, matcher);
					if (resource) {
						this.workbenchEditorService.openEditor({
							resource: resource
						});
					}
				}, 0));
			}
		};

		for (let problemMatcher of problemMatchers) {
			if (Array.isArray(problemMatcher.pattern)) {
				for (let pattern of problemMatcher.pattern) {
					handlePattern(problemMatcher, pattern);
				}
			} else if (problemMatcher.pattern) {
				handlePattern(problemMatcher, problemMatcher.pattern);
			}
		}
		*/
		return result;
	}

	private static WellKnowCommands: IStringDictionary<boolean> = {
		'ant': true,
		'cmake': true,
		'eslint': true,
		'gradle': true,
		'grunt': true,
		'gulp': true,
		'jake': true,
		'jenkins': true,
		'jshint': true,
		'make': true,
		'maven': true,
		'msbuild': true,
		'msc': true,
		'nmake': true,
		'npm': true,
		'rake': true,
		'tsc': true,
		'xbuild': true
	};

	public getSanitizedCommand(cmd: string): string {
		let result = cmd.toLowerCase();
		let index = result.lastIndexOf(path.sep);
		if (index !== -1) {
			result = result.substring(index + 1);
		}
		if (TerminalTaskSystem.WellKnowCommands[result]) {
			return result;
		}
		return 'other';
	}

	private appendOutput(output: string): void {
		const outputChannel = this.outputService.getChannel(this.outputChannelId);
		if (outputChannel) {
			outputChannel.append(output);
		}
	}

	private async fileExists(path: string): Promise<boolean> {
		const uri: URI = resources.toLocalResource(URI.from({ scheme: Schemas.file, path: path }), this.environmentService.configuration.remoteAuthority);
		if (await this.fileService.exists(uri)) {
			return !((await this.fileService.resolve(uri)).isDirectory);
		}
		return false;
	}

	private async findExecutable(command: string, cwd?: string, paths?: string[]): Promise<string> {
		// If we have an absolute path then we take it.
		if (path.isAbsolute(command)) {
			return command;
		}
		if (cwd === undefined) {
			cwd = processCwd();
		}
		const dir = path.dirname(command);
		if (dir !== '.') {
			// We have a directory and the directory is relative (see above). Make the path absolute
			// to the current working directory.
			return path.join(cwd, command);
		}
		if (paths === undefined && Types.isString(processEnv.PATH)) {
			paths = processEnv.PATH.split(path.delimiter);
		}
		// No PATH environment. Make path absolute to the cwd.
		if (paths === undefined || paths.length === 0) {
			return path.join(cwd, command);
		}
		// We have a simple file name. We get the path variable from the env
		// and try to find the executable on the path.
		for (let pathEntry of paths) {
			// The path entry is absolute.
			let fullPath: string;
			if (path.isAbsolute(pathEntry)) {
				fullPath = path.join(pathEntry, command);
			} else {
				fullPath = path.join(cwd, pathEntry, command);
			}

			if (await this.fileExists(fullPath)) {
				return fullPath;
			}
			let withExtension = fullPath + '.com';
			if (await this.fileExists(withExtension)) {
				return withExtension;
			}
			withExtension = fullPath + '.exe';
			if (await this.fileExists(withExtension)) {
				return withExtension;
			}
		}
		return path.join(cwd, command);
	}
}
