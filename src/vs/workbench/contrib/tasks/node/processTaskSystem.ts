/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as Objects from 'vs/base/common/objects';
import * as Types from 'vs/base/common/types';
import * as Platform from 'vs/base/common/platform';
import * as Async from 'vs/base/common/async';
import Severity from 'vs/base/common/severity';
import * as Strings from 'vs/base/common/strings';
import { Event, Emitter } from 'vs/base/common/event';

import { SuccessData, ErrorData } from 'vs/base/common/processes';
import { LineProcess, LineData } from 'vs/base/node/processes';

import { IOutputService } from 'vs/workbench/contrib/output/common/output';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';

import { IMarkerService } from 'vs/platform/markers/common/markers';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ProblemMatcher, ProblemMatcherRegistry } from 'vs/workbench/contrib/tasks/common/problemMatcher';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';

import { StartStopProblemCollector, WatchingProblemCollector, ProblemCollectorEventKind } from 'vs/workbench/contrib/tasks/common/problemCollectors';
import {
	ITaskSystem, ITaskSummary, ITaskExecuteResult, TaskExecuteKind, TaskError, TaskErrors, TelemetryEvent, Triggers,
	TaskTerminateResponse
} from 'vs/workbench/contrib/tasks/common/taskSystem';
import {
	Task, CustomTask, CommandOptions, RevealKind, CommandConfiguration, RuntimeType,
	TaskEvent, TaskEventKind
} from 'vs/workbench/contrib/tasks/common/tasks';

import { IDisposable, dispose } from 'vs/base/common/lifecycle';

/**
 * Since ProcessTaskSystem is not receiving new feature updates all strict null check fixing has been done with !.
 */
export class ProcessTaskSystem implements ITaskSystem {

	public static TelemetryEventName: string = 'taskService';

	private markerService: IMarkerService;
	private modelService: IModelService;
	private outputService: IOutputService;
	private telemetryService: ITelemetryService;
	private configurationResolverService: IConfigurationResolverService;

	private errorsShown: boolean;
	private childProcess: LineProcess | null;
	private activeTask: CustomTask | null;
	private activeTaskPromise: Promise<ITaskSummary> | null;

	private readonly _onDidStateChange: Emitter<TaskEvent>;

	constructor(markerService: IMarkerService, modelService: IModelService, telemetryService: ITelemetryService,
		outputService: IOutputService, configurationResolverService: IConfigurationResolverService, private outputChannelId: string) {
		this.markerService = markerService;
		this.modelService = modelService;
		this.outputService = outputService;
		this.telemetryService = telemetryService;
		this.configurationResolverService = configurationResolverService;

		this.childProcess = null;
		this.activeTask = null;
		this.activeTaskPromise = null;
		this.errorsShown = true;
		this._onDidStateChange = new Emitter();
	}

	public get onDidStateChange(): Event<TaskEvent> {
		return this._onDidStateChange.event;
	}

	public isActive(): Promise<boolean> {
		return Promise.resolve(!!this.childProcess);
	}

	public isActiveSync(): boolean {
		return !!this.childProcess;
	}

	public isTaskVisible(): boolean {
		return true;
	}

	public getActiveTasks(): Task[] {
		let result: Task[] = [];
		if (this.activeTask) {
			result.push(this.activeTask);
		}
		return result;
	}

	public getLastInstance(task: Task): Task | undefined {
		let result = undefined;
		if (this.activeTask) {
			result = this.activeTask;
		}
		return result;
	}

	public getBusyTasks(): Task[] {
		return [];
	}

	public run(task: Task): ITaskExecuteResult {
		if (this.activeTask) {
			return { kind: TaskExecuteKind.Active, task, active: { same: this.activeTask._id === task._id, background: this.activeTask.configurationProperties.isBackground! }, promise: this.activeTaskPromise! };
		}
		return this.executeTask(task);
	}

	public revealTask(task: Task): boolean {
		this.showOutput();
		return true;
	}

	public customExecutionComplete(task: Task, result?: number): Promise<void> {
		throw new TaskError(Severity.Error, 'Custom execution task completion is never expected in the process task system.', TaskErrors.UnknownError);
	}

	public hasErrors(value: boolean): void {
		this.errorsShown = !value;
	}

	public canAutoTerminate(): boolean {
		if (this.childProcess) {
			if (this.activeTask) {
				return !this.activeTask.configurationProperties.promptOnClose;
			}
			return false;
		}
		return true;
	}

	public terminate(task: Task): Promise<TaskTerminateResponse> {
		if (!this.activeTask || this.activeTask.getMapKey() !== task.getMapKey()) {
			return Promise.resolve<TaskTerminateResponse>({ success: false, task: undefined });
		}
		return this.terminateAll().then(values => values[0]);
	}

	public terminateAll(): Promise<TaskTerminateResponse[]> {
		if (this.childProcess) {
			let task = this.activeTask;
			return this.childProcess.terminate().then((response) => {
				let result: TaskTerminateResponse = Object.assign({ task: task! }, response);
				this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Terminated, task!));
				return [result];
			});
		}
		return Promise.resolve<TaskTerminateResponse[]>([{ success: true, task: undefined }]);
	}

	private executeTask(task: Task, trigger: string = Triggers.command): ITaskExecuteResult {
		if (!CustomTask.is(task)) {
			throw new Error(nls.localize('version1_0', 'The task system is configured for version 0.1.0 (see tasks.json file), which can only execute custom tasks. Upgrade to version 2.0.0 to run the task: {0}', task._label));
		}
		let telemetryEvent: TelemetryEvent = {
			trigger: trigger,
			runner: 'output',
			taskKind: task.getTelemetryKind(),
			command: 'other',
			success: true
		};
		try {
			let result = this.doExecuteTask(task, telemetryEvent);
			result.promise = result.promise.then((success) => {
				/* __GDPR__
					"taskService" : {
						"${include}": [
							"${TelemetryEvent}"
						]
					}
				*/
				this.telemetryService.publicLog(ProcessTaskSystem.TelemetryEventName, telemetryEvent);
				return success;
			}, (err: any) => {
				telemetryEvent.success = false;
				/* __GDPR__
					"taskService" : {
						"${include}": [
							"${TelemetryEvent}"
						]
					}
				*/
				this.telemetryService.publicLog(ProcessTaskSystem.TelemetryEventName, telemetryEvent);
				return Promise.reject<ITaskSummary>(err);
			});
			return result;
		} catch (err) {
			telemetryEvent.success = false;
			/* __GDPR__
				"taskService" : {
					"${include}": [
						"${TelemetryEvent}"
					]
				}
			*/
			this.telemetryService.publicLog(ProcessTaskSystem.TelemetryEventName, telemetryEvent);
			if (err instanceof TaskError) {
				throw err;
			} else if (err instanceof Error) {
				let error = <Error>err;
				this.appendOutput(error.message);
				throw new TaskError(Severity.Error, error.message, TaskErrors.UnknownError);
			} else {
				this.appendOutput(err.toString());
				throw new TaskError(Severity.Error, nls.localize('TaskRunnerSystem.unknownError', 'A unknown error has occurred while executing a task. See task output log for details.'), TaskErrors.UnknownError);
			}
		}
	}

	public rerun(): ITaskExecuteResult | undefined {
		return undefined;
	}

	private doExecuteTask(task: CustomTask, telemetryEvent: TelemetryEvent): ITaskExecuteResult {
		let taskSummary: ITaskSummary = {};
		let commandConfig: CommandConfiguration = task.command;
		if (!this.errorsShown) {
			this.showOutput();
			this.errorsShown = true;
		} else {
			this.clearOutput();
		}

		let args: string[] = [];
		if (commandConfig.args) {
			for (let arg of commandConfig.args) {
				if (Types.isString(arg)) {
					args.push(arg);
				} else {
					this.log(`Quoting individual arguments is not supported in the process runner. Using plain value: ${arg.value}`);
					args.push(arg.value);
				}
			}
		}
		args = this.resolveVariables(task, args);
		let command: string = this.resolveVariable(task, Types.isString(commandConfig.name) ? commandConfig.name : commandConfig.name!.value);
		this.childProcess = new LineProcess(command, args, commandConfig.runtime === RuntimeType.Shell, this.resolveOptions(task, commandConfig.options!));
		telemetryEvent.command = this.childProcess.getSanitizedCommand();
		// we have no problem matchers defined. So show the output log
		let reveal = task.command.presentation!.reveal;
		if (reveal === RevealKind.Always || (reveal === RevealKind.Silent && task.configurationProperties.problemMatchers!.length === 0)) {
			this.showOutput();
		}

		if (commandConfig.presentation!.echo) {
			let prompt: string = Platform.isWindows ? '>' : '$';
			this.log(`running command${prompt} ${command} ${args.join(' ')}`);
		}
		if (task.configurationProperties.isBackground) {
			let watchingProblemMatcher = new WatchingProblemCollector(this.resolveMatchers(task, task.configurationProperties.problemMatchers!), this.markerService, this.modelService);
			let toDispose: IDisposable[] | null = [];
			let eventCounter: number = 0;
			toDispose.push(watchingProblemMatcher.onDidStateChange((event) => {
				if (event.kind === ProblemCollectorEventKind.BackgroundProcessingBegins) {
					eventCounter++;
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Active, task));
				} else if (event.kind === ProblemCollectorEventKind.BackgroundProcessingEnds) {
					eventCounter--;
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Inactive, task));
				}
			}));
			watchingProblemMatcher.aboutToStart();
			let delayer: Async.Delayer<any> | null = null;
			this.activeTask = task;
			const inactiveEvent = TaskEvent.create(TaskEventKind.Inactive, task);
			let processStartedSignaled: boolean = false;
			const onProgress = (progress: LineData) => {
				let line = Strings.removeAnsiEscapeCodes(progress.line);
				this.appendOutput(line + '\n');
				watchingProblemMatcher.processLine(line);
				if (delayer === null) {
					delayer = new Async.Delayer(3000);
				}
				delayer.trigger(() => {
					watchingProblemMatcher.forceDelivery();
					return null;
				}).then(() => {
					delayer = null;
				});
			};
			const startPromise = this.childProcess.start(onProgress);
			this.childProcess.pid.then(pid => {
				if (pid !== -1) {
					processStartedSignaled = true;
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessStarted, task, pid));
				}
			});
			this.activeTaskPromise = startPromise.then((success): ITaskSummary => {
				this.childProcessEnded();
				watchingProblemMatcher.done();
				watchingProblemMatcher.dispose();
				if (processStartedSignaled) {
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessEnded, task, success.cmdCode!));
				}
				toDispose = dispose(toDispose!);
				toDispose = null;
				for (let i = 0; i < eventCounter; i++) {
					this._onDidStateChange.fire(inactiveEvent);
				}
				eventCounter = 0;
				if (!this.checkTerminated(task, success)) {
					this.log(nls.localize('TaskRunnerSystem.watchingBuildTaskFinished', '\nWatching build tasks has finished.'));
				}
				if (success.cmdCode && success.cmdCode === 1 && watchingProblemMatcher.numberOfMatches === 0 && reveal !== RevealKind.Never) {
					this.showOutput();
				}
				taskSummary.exitCode = success.cmdCode;
				return taskSummary;
			}, (error: ErrorData) => {
				this.childProcessEnded();
				watchingProblemMatcher.dispose();
				toDispose = dispose(toDispose!);
				toDispose = null;
				for (let i = 0; i < eventCounter; i++) {
					this._onDidStateChange.fire(inactiveEvent);
				}
				eventCounter = 0;
				return this.handleError(task, error);
			});
			let result: ITaskExecuteResult = (<any>task).tscWatch
				? { kind: TaskExecuteKind.Started, task, started: { restartOnFileChanges: '**/*.ts' }, promise: this.activeTaskPromise }
				: { kind: TaskExecuteKind.Started, task, started: {}, promise: this.activeTaskPromise };
			return result;
		} else {
			this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Start, task));
			this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.Active, task));
			let startStopProblemMatcher = new StartStopProblemCollector(this.resolveMatchers(task, task.configurationProperties.problemMatchers!), this.markerService, this.modelService);
			this.activeTask = task;
			const inactiveEvent = TaskEvent.create(TaskEventKind.Inactive, task);
			let processStartedSignaled: boolean = false;
			const onProgress = (progress: LineData) => {
				let line = Strings.removeAnsiEscapeCodes(progress.line);
				this.appendOutput(line + '\n');
				startStopProblemMatcher.processLine(line);
			};
			const startPromise = this.childProcess.start(onProgress);
			this.childProcess.pid.then(pid => {
				if (pid !== -1) {
					processStartedSignaled = true;
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessStarted, task, pid));
				}
			});
			this.activeTaskPromise = startPromise.then((success): ITaskSummary => {
				this.childProcessEnded();
				startStopProblemMatcher.done();
				startStopProblemMatcher.dispose();
				this.checkTerminated(task, success);
				if (processStartedSignaled) {
					this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.ProcessEnded, task, success.cmdCode!));
				}
				this._onDidStateChange.fire(inactiveEvent);
				this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.End, task));
				if (success.cmdCode && success.cmdCode === 1 && startStopProblemMatcher.numberOfMatches === 0 && reveal !== RevealKind.Never) {
					this.showOutput();
				}
				taskSummary.exitCode = success.cmdCode;
				return taskSummary;
			}, (error: ErrorData) => {
				this.childProcessEnded();
				startStopProblemMatcher.dispose();
				this._onDidStateChange.fire(inactiveEvent);
				this._onDidStateChange.fire(TaskEvent.create(TaskEventKind.End, task));
				return this.handleError(task, error);
			});
			return { kind: TaskExecuteKind.Started, task, started: {}, promise: this.activeTaskPromise };
		}
	}

	private childProcessEnded(): void {
		this.childProcess = null;
		this.activeTask = null;
		this.activeTaskPromise = null;
	}

	private handleError(task: CustomTask, errorData: ErrorData): Promise<ITaskSummary> {
		let makeVisible = false;
		if (errorData.error && !errorData.terminated) {
			let args: string = task.command.args ? task.command.args.join(' ') : '';
			this.log(nls.localize('TaskRunnerSystem.childProcessError', 'Failed to launch external program {0} {1}.', JSON.stringify(task.command.name), args));
			this.appendOutput(errorData.error.message);
			makeVisible = true;
		}

		if (errorData.stdout) {
			this.appendOutput(errorData.stdout);
			makeVisible = true;
		}
		if (errorData.stderr) {
			this.appendOutput(errorData.stderr);
			makeVisible = true;
		}
		makeVisible = this.checkTerminated(task, errorData) || makeVisible;
		if (makeVisible) {
			this.showOutput();
		}

		const error: Error & ErrorData = errorData.error || new Error();
		error.stderr = errorData.stderr;
		error.stdout = errorData.stdout;
		error.terminated = errorData.terminated;
		return Promise.reject(error);
	}

	private checkTerminated(task: Task, data: SuccessData | ErrorData): boolean {
		if (data.terminated) {
			this.log(nls.localize('TaskRunnerSystem.cancelRequested', '\nThe task \'{0}\' was terminated per user request.', task.configurationProperties.name));
			return true;
		}
		return false;
	}

	private resolveOptions(task: CustomTask, options: CommandOptions): CommandOptions {
		let result: CommandOptions = { cwd: this.resolveVariable(task, options.cwd!) };
		if (options.env) {
			result.env = Object.create(null);
			Object.keys(options.env).forEach((key) => {
				let value: any = options.env![key];
				if (Types.isString(value)) {
					result.env![key] = this.resolveVariable(task, value);
				} else {
					result.env![key] = value.toString();
				}
			});
		}
		return result;
	}

	private resolveVariables(task: CustomTask, value: string[]): string[] {
		return value.map(s => this.resolveVariable(task, s));
	}

	private resolveMatchers(task: CustomTask, values: Array<string | ProblemMatcher>): ProblemMatcher[] {
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
			if (!matcher.filePrefix) {
				result.push(matcher);
			} else {
				let copy = Objects.deepClone(matcher);
				copy.filePrefix = this.resolveVariable(task, copy.filePrefix!);
				result.push(copy);
			}
		});
		return result;
	}

	private resolveVariable(task: CustomTask, value: string): string {
		return this.configurationResolverService.resolve(task.getWorkspaceFolder()!, value);
	}

	public log(value: string): void {
		this.appendOutput(value + '\n');
	}

	private showOutput(): void {
		this.outputService.showChannel(this.outputChannelId, true);
	}

	private appendOutput(output: string): void {
		const outputChannel = this.outputService.getChannel(this.outputChannelId);
		if (outputChannel) {
			outputChannel.append(output);
		}
	}

	private clearOutput(): void {
		const outputChannel = this.outputService.getChannel(this.outputChannelId);
		if (outputChannel) {
			outputChannel.clear();
		}
	}
}
