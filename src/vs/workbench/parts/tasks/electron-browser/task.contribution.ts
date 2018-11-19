/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import 'vs/css!./media/task.contribution';

import * as nls from 'vs/nls';
import * as semver from 'semver';

import { QuickOpenHandler } from 'vs/workbench/parts/tasks/browser/taskQuickOpen';
import { TPromise } from 'vs/base/common/winjs.base';
import Severity from 'vs/base/common/severity';
import * as Objects from 'vs/base/common/objects';
import { URI } from 'vs/base/common/uri';
import { IStringDictionary } from 'vs/base/common/collections';
import { Action } from 'vs/base/common/actions';
import * as Dom from 'vs/base/browser/dom';
import { IDisposable, dispose, toDisposable, Disposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import * as Types from 'vs/base/common/types';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { TerminateResponseCode } from 'vs/base/common/processes';
import * as strings from 'vs/base/common/strings';
import { ValidationStatus, ValidationState } from 'vs/base/common/parsers';
import * as UUID from 'vs/base/common/uuid';
import * as Platform from 'vs/base/common/platform';
import { LinkedMap, Touch } from 'vs/base/common/map';
import { OcticonLabel } from 'vs/base/browser/ui/octiconLabel/octiconLabel';

import { Registry } from 'vs/platform/registry/common/platform';
import { ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IMarkerService, MarkerStatistics } from 'vs/platform/markers/common/markers';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IFileService, IFileStat } from 'vs/platform/files/common/files';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { ProblemMatcherRegistry, NamedProblemMatcher } from 'vs/workbench/parts/tasks/common/problemMatcher';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { IProgressService2, IProgressOptions, ProgressLocation } from 'vs/platform/progress/common/progress';

import { IOpenerService } from 'vs/platform/opener/common/opener';
import { IWindowService } from 'vs/platform/windows/common/windows';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IDialogService, IConfirmationResult } from 'vs/platform/dialogs/common/dialogs';

import { IModelService } from 'vs/editor/common/services/modelService';

import * as jsonContributionRegistry from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { IJSONSchema } from 'vs/base/common/jsonSchema';

import { IStatusbarItem, IStatusbarRegistry, Extensions as StatusbarExtensions, StatusbarItemDescriptor } from 'vs/workbench/browser/parts/statusbar/statusbar';
import { StatusbarAlignment } from 'vs/platform/statusbar/common/statusbar';
import { IQuickOpenRegistry, Extensions as QuickOpenExtensions, QuickOpenHandlerDescriptor } from 'vs/workbench/browser/quickopen';

import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import Constants from 'vs/workbench/parts/markers/electron-browser/constants';
import { IPartService } from 'vs/workbench/services/part/common/partService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IWorkspaceContextService, WorkbenchState, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';

import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IOutputService, IOutputChannelRegistry, Extensions as OutputExt, IOutputChannel } from 'vs/workbench/parts/output/common/output';
import { Scope, IActionBarRegistry, Extensions as ActionBarExtensions } from 'vs/workbench/browser/actions';

import { ITerminalService } from 'vs/workbench/parts/terminal/common/terminal';

import { ITaskSystem, ITaskResolver, ITaskSummary, TaskExecuteKind, TaskError, TaskErrors, TaskTerminateResponse, TaskSystemInfo } from 'vs/workbench/parts/tasks/common/taskSystem';
import {
	Task, CustomTask, ConfiguringTask, ContributedTask, InMemoryTask, TaskEvent,
	TaskEventKind, TaskSet, TaskGroup, GroupType, ExecutionEngine, JsonSchemaVersion, TaskSourceKind,
	TaskSorter, TaskIdentifier, KeyedTaskIdentifier, TASK_RUNNING_STATE
} from 'vs/workbench/parts/tasks/common/tasks';
import { ITaskService, ITaskProvider, RunOptions, CustomizationProperties, TaskFilter } from 'vs/workbench/parts/tasks/common/taskService';
import { getTemplates as getTaskTemplates } from 'vs/workbench/parts/tasks/common/taskTemplates';

import { KeyedTaskIdentifier as NKeyedTaskIdentifier, TaskDefinition } from 'vs/workbench/parts/tasks/node/tasks';

import * as TaskConfig from '../node/taskConfiguration';
import { ProcessTaskSystem } from 'vs/workbench/parts/tasks/node/processTaskSystem';
import { TerminalTaskSystem } from './terminalTaskSystem';
import { ProcessRunnerDetector } from 'vs/workbench/parts/tasks/node/processRunnerDetector';
import { QuickOpenActionContributor } from '../browser/quickOpen';

import { Themable, STATUS_BAR_FOREGROUND, STATUS_BAR_NO_FOLDER_FOREGROUND } from 'vs/workbench/common/theme';
import { IThemeService } from 'vs/platform/theme/common/themeService';
import { IQuickInputService, IQuickPickItem, QuickPickInput } from 'vs/platform/quickinput/common/quickInput';

import { TaskDefinitionRegistry } from 'vs/workbench/parts/tasks/common/taskDefinitionRegistry';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';

let tasksCategory = nls.localize('tasksCategory', "Tasks");

namespace ConfigureTaskAction {
	export const ID = 'workbench.action.tasks.configureTaskRunner';
	export const TEXT = nls.localize('ConfigureTaskRunnerAction.label', "Configure Task");
}

class BuildStatusBarItem extends Themable implements IStatusbarItem {
	private activeCount: number;
	private icons: HTMLElement[];

	constructor(
		@IPanelService private panelService: IPanelService,
		@IMarkerService private markerService: IMarkerService,
		@ITaskService private taskService: ITaskService,
		@IPartService private partService: IPartService,
		@IThemeService themeService: IThemeService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService
	) {
		super(themeService);

		this.activeCount = 0;
		this.icons = [];

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.contextService.onDidChangeWorkbenchState(() => this.updateStyles()));
	}

	protected updateStyles(): void {
		super.updateStyles();

		this.icons.forEach(icon => {
			icon.style.backgroundColor = this.getColor(this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY ? STATUS_BAR_FOREGROUND : STATUS_BAR_NO_FOLDER_FOREGROUND);
		});
	}

	public render(container: HTMLElement): IDisposable {
		let callOnDispose: IDisposable[] = [];

		const element = document.createElement('div');
		const label = document.createElement('a');
		const errorIcon = document.createElement('div');
		const warningIcon = document.createElement('div');
		const infoIcon = document.createElement('div');
		const error = document.createElement('div');
		const warning = document.createElement('div');
		const info = document.createElement('div');
		const building = document.createElement('div');

		const errorTitle = n => nls.localize('totalErrors', "{0} Errors", n);
		const warningTitle = n => nls.localize('totalWarnings', "{0} Warnings", n);
		const infoTitle = n => nls.localize('totalInfos', "{0} Infos", n);

		Dom.addClass(element, 'task-statusbar-item');
		element.title = nls.localize('problems', "Problems");

		Dom.addClass(label, 'task-statusbar-item-label');
		element.appendChild(label);

		Dom.addClass(errorIcon, 'task-statusbar-item-label-error');
		Dom.addClass(errorIcon, 'mask-icon');
		label.appendChild(errorIcon);
		this.icons.push(errorIcon);

		Dom.addClass(error, 'task-statusbar-item-label-counter');
		error.innerHTML = '0';
		error.title = errorIcon.title = errorTitle(0);
		label.appendChild(error);

		Dom.addClass(warningIcon, 'task-statusbar-item-label-warning');
		Dom.addClass(warningIcon, 'mask-icon');
		label.appendChild(warningIcon);
		this.icons.push(warningIcon);

		Dom.addClass(warning, 'task-statusbar-item-label-counter');
		warning.innerHTML = '0';
		warning.title = warningIcon.title = warningTitle(0);
		label.appendChild(warning);

		Dom.addClass(infoIcon, 'task-statusbar-item-label-info');
		Dom.addClass(infoIcon, 'mask-icon');
		label.appendChild(infoIcon);
		this.icons.push(infoIcon);
		Dom.hide(infoIcon);

		Dom.addClass(info, 'task-statusbar-item-label-counter');
		label.appendChild(info);
		Dom.hide(info);

		Dom.addClass(building, 'task-statusbar-item-building');
		element.appendChild(building);
		building.innerHTML = nls.localize('building', 'Building...');
		Dom.hide(building);

		callOnDispose.push(Dom.addDisposableListener(label, 'click', (e: MouseEvent) => {
			const panel = this.panelService.getActivePanel();
			if (panel && panel.getId() === Constants.MARKERS_PANEL_ID) {
				this.partService.setPanelHidden(true);
			} else {
				this.panelService.openPanel(Constants.MARKERS_PANEL_ID, true);
			}
		}));

		const manyProblems = nls.localize('manyProblems', "10K+");
		const packNumber = n => n > 9999 ? manyProblems : n > 999 ? n.toString().charAt(0) + 'K' : n.toString();
		let updateLabel = (stats: MarkerStatistics) => {
			error.innerHTML = packNumber(stats.errors);
			error.title = errorIcon.title = errorTitle(stats.errors);
			warning.innerHTML = packNumber(stats.warnings);
			warning.title = warningIcon.title = warningTitle(stats.warnings);
			if (stats.infos > 0) {
				info.innerHTML = packNumber(stats.infos);
				info.title = infoIcon.title = infoTitle(stats.infos);
				Dom.show(info);
				Dom.show(infoIcon);
			} else {
				Dom.hide(info);
				Dom.hide(infoIcon);
			}
		};

		this.markerService.onMarkerChanged((changedResources) => {
			updateLabel(this.markerService.getStatistics());
		});

		callOnDispose.push(this.taskService.onDidStateChange((event) => {
			if (this.ignoreEvent(event)) {
				return;
			}
			switch (event.kind) {
				case TaskEventKind.Active:
					this.activeCount++;
					if (this.activeCount === 1) {
						Dom.show(building);
					}
					break;
				case TaskEventKind.Inactive:
					// Since the exiting of the sub process is communicated async we can't order inactive and terminate events.
					// So try to treat them accordingly.
					if (this.activeCount > 0) {
						this.activeCount--;
						if (this.activeCount === 0) {
							Dom.hide(building);
						}
					}
					break;
				case TaskEventKind.Terminated:
					if (this.activeCount !== 0) {
						Dom.hide(building);
						this.activeCount = 0;
					}
					break;
			}
		}));

		container.appendChild(element);

		this.updateStyles();

		return toDisposable(() => {
			callOnDispose = dispose(callOnDispose);
		});
	}

	private ignoreEvent(event: TaskEvent): boolean {
		if (!this.taskService.inTerminal()) {
			return false;
		}
		if (event.group !== TaskGroup.Build) {
			return true;
		}
		if (!event.__task) {
			return false;
		}
		return event.__task.problemMatchers === void 0 || event.__task.problemMatchers.length === 0;
	}
}

class TaskStatusBarItem extends Themable implements IStatusbarItem {

	constructor(
		@ITaskService private taskService: ITaskService,
		@IThemeService themeService: IThemeService,
	) {
		super(themeService);
	}

	protected updateStyles(): void {
		super.updateStyles();
	}

	public render(container: HTMLElement): IDisposable {

		let callOnDispose: IDisposable[] = [];
		const element = document.createElement('a');
		Dom.addClass(element, 'task-statusbar-runningItem');

		let labelElement = document.createElement('div');
		Dom.addClass(labelElement, 'task-statusbar-runningItem-label');
		element.appendChild(labelElement);

		let label = new OcticonLabel(labelElement);
		label.title = nls.localize('runningTasks', "Show Running Tasks");

		Dom.hide(element);

		callOnDispose.push(Dom.addDisposableListener(labelElement, 'click', (e: MouseEvent) => {
			(this.taskService as TaskService).runShowTasks();
		}));

		let updateStatus = (): void => {
			this.taskService.getActiveTasks().then(tasks => {
				if (tasks.length === 0) {
					Dom.hide(element);
				} else {
					label.text = `$(tools) ${tasks.length}`;
					Dom.show(element);
				}
			});
		};

		callOnDispose.push(this.taskService.onDidStateChange((event) => {
			if (event.kind === TaskEventKind.Changed) {
				updateStatus();
			}
		}));

		container.appendChild(element);

		this.updateStyles();
		updateStatus();

		return {
			dispose: () => {
				callOnDispose = dispose(callOnDispose);
			}
		};
	}
}

class ProblemReporter implements TaskConfig.IProblemReporter {

	private _validationStatus: ValidationStatus;

	constructor(private _outputChannel: IOutputChannel) {
		this._validationStatus = new ValidationStatus();
	}

	public info(message: string): void {
		this._validationStatus.state = ValidationState.Info;
		this._outputChannel.append(message + '\n');
	}

	public warn(message: string): void {
		this._validationStatus.state = ValidationState.Warning;
		this._outputChannel.append(message + '\n');
	}

	public error(message: string): void {
		this._validationStatus.state = ValidationState.Error;
		this._outputChannel.append(message + '\n');
	}

	public fatal(message: string): void {
		this._validationStatus.state = ValidationState.Fatal;
		this._outputChannel.append(message + '\n');
	}

	public get status(): ValidationStatus {
		return this._validationStatus;
	}
}

interface WorkspaceTaskResult {
	set: TaskSet;
	configurations: {
		byIdentifier: IStringDictionary<ConfiguringTask>;
	};
	hasErrors: boolean;
}

interface WorkspaceFolderTaskResult extends WorkspaceTaskResult {
	workspaceFolder: IWorkspaceFolder;
}

interface WorkspaceFolderConfigurationResult {
	workspaceFolder: IWorkspaceFolder;
	config: TaskConfig.ExternalTaskRunnerConfiguration;
	hasErrors: boolean;
}

interface TaskCustomizationTelementryEvent {
	properties: string[];
}

class TaskMap {
	private _store: Map<string, Task[]> = new Map();

	constructor() {
	}

	public forEach(callback: (value: Task[], folder: string) => void): void {
		this._store.forEach(callback);
	}

	public get(workspaceFolder: IWorkspaceFolder | string): Task[] {
		let result: Task[] = Types.isString(workspaceFolder) ? this._store.get(workspaceFolder) : this._store.get(workspaceFolder.uri.toString());
		if (!result) {
			result = [];
			Types.isString(workspaceFolder) ? this._store.set(workspaceFolder, result) : this._store.set(workspaceFolder.uri.toString(), result);
		}
		return result;
	}

	public add(workspaceFolder: IWorkspaceFolder | string, ...task: Task[]): void {
		let values = Types.isString(workspaceFolder) ? this._store.get(workspaceFolder) : this._store.get(workspaceFolder.uri.toString());
		if (!values) {
			values = [];
			Types.isString(workspaceFolder) ? this._store.set(workspaceFolder, values) : this._store.set(workspaceFolder.uri.toString(), values);
		}
		values.push(...task);
	}

	public all(): Task[] {
		let result: Task[] = [];
		this._store.forEach((values) => result.push(...values));
		return result;
	}
}

interface TaskQuickPickEntry extends IQuickPickItem {
	task: Task;
}

class TaskService extends Disposable implements ITaskService {

	// private static autoDetectTelemetryName: string = 'taskServer.autoDetect';
	private static readonly RecentlyUsedTasks_Key = 'workbench.tasks.recentlyUsedTasks';
	private static readonly IgnoreTask010DonotShowAgain_key = 'workbench.tasks.ignoreTask010Shown';

	private static CustomizationTelemetryEventName: string = 'taskService.customize';
	public static TemplateTelemetryEventName: string = 'taskService.template';

	public _serviceBrand: any;
	public static OutputChannelId: string = 'tasks';
	public static OutputChannelLabel: string = nls.localize('tasks', "Tasks");

	private static nextHandle: number = 0;

	private _configHasErrors: boolean;
	private _schemaVersion: JsonSchemaVersion;
	private _executionEngine: ExecutionEngine;
	private _workspaceFolders: IWorkspaceFolder[];
	private _ignoredWorkspaceFolders: IWorkspaceFolder[];
	private _showIgnoreMessage: boolean;
	private _providers: Map<number, ITaskProvider>;
	private _taskSystemInfos: Map<string, TaskSystemInfo>;

	private _workspaceTasksPromise: TPromise<Map<string, WorkspaceFolderTaskResult>>;

	private _taskSystem: ITaskSystem;
	private _taskSystemListener: IDisposable;
	private _recentlyUsedTasks: LinkedMap<string, string>;

	private _taskRunningState: IContextKey<boolean>;

	private _outputChannel: IOutputChannel;
	private readonly _onDidStateChange: Emitter<TaskEvent>;

	constructor(
		@IConfigurationService private configurationService: IConfigurationService,
		@IMarkerService private markerService: IMarkerService,
		@IOutputService private outputService: IOutputService,
		@IEditorService private editorService: IEditorService,
		@IFileService private fileService: IFileService,
		@IWorkspaceContextService private contextService: IWorkspaceContextService,
		@ITelemetryService private telemetryService: ITelemetryService,
		@ITextFileService private textFileService: ITextFileService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IModelService private modelService: IModelService,
		@IExtensionService private extensionService: IExtensionService,
		@IQuickInputService private quickInputService: IQuickInputService,
		@IConfigurationResolverService private configurationResolverService: IConfigurationResolverService,
		@ITerminalService private terminalService: ITerminalService,
		@IStorageService private storageService: IStorageService,
		@IProgressService2 private progressService: IProgressService2,
		@IOpenerService private openerService: IOpenerService,
		@IWindowService private readonly _windowService: IWindowService,
		@IDialogService private dialogService: IDialogService,
		@INotificationService private notificationService: INotificationService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this._configHasErrors = false;
		this._workspaceTasksPromise = undefined;
		this._taskSystem = undefined;
		this._taskSystemListener = undefined;
		this._outputChannel = this.outputService.getChannel(TaskService.OutputChannelId);
		this._providers = new Map<number, ITaskProvider>();
		this._taskSystemInfos = new Map<string, TaskSystemInfo>();
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => {
			if (!this._taskSystem && !this._workspaceTasksPromise) {
				return;
			}
			let folderSetup = this.computeWorkspaceFolderSetup();
			if (this.executionEngine !== folderSetup[2]) {
				if (this._taskSystem && this._taskSystem.getActiveTasks().length > 0) {
					this.notificationService.prompt(
						Severity.Info,
						nls.localize(
							'TaskSystem.noHotSwap',
							'Changing the task execution engine with an active task running requires to reload the Window'
						),
						[{
							label: nls.localize('reloadWindow', "Reload Window"),
							run: () => this._windowService.reloadWindow()
						}],
						{ sticky: true }
					);
					return;
				} else {
					this.disposeTaskSystemListeners();
					this._taskSystem = undefined;
				}
			}
			this.updateSetup(folderSetup);
			this.updateWorkspaceTasks();
		}));
		this._register(this.configurationService.onDidChangeConfiguration(() => {
			if (!this._taskSystem && !this._workspaceTasksPromise) {
				return;
			}
			if (!this._taskSystem || this._taskSystem instanceof TerminalTaskSystem) {
				this._outputChannel.clear();
			}
			this.updateWorkspaceTasks();
		}));
		this._taskRunningState = TASK_RUNNING_STATE.bindTo(contextKeyService);
		this._register(lifecycleService.onWillShutdown(event => event.veto(this.beforeShutdown())));
		this._register(storageService.onWillSaveState(() => this.saveState()));
		this._onDidStateChange = this._register(new Emitter());
		this.registerCommands();
	}

	public get onDidStateChange(): Event<TaskEvent> {
		return this._onDidStateChange.event;
	}

	public get supportsMultipleTaskExecutions(): boolean {
		return this.inTerminal();
	}

	private registerCommands(): void {
		CommandsRegistry.registerCommand('workbench.action.tasks.runTask', (accessor, arg) => {
			this.runTaskCommand(arg);
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.restartTask', (accessor, arg) => {
			this.runRestartTaskCommand(arg);
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.terminate', (accessor, arg) => {
			this.runTerminateCommand(arg);
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.showLog', () => {
			if (!this.canRunCommand()) {
				return;
			}
			this.showOutput();
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.build', () => {
			if (!this.canRunCommand()) {
				return;
			}
			this.runBuildCommand();
		});

		KeybindingsRegistry.registerKeybindingRule({
			id: 'workbench.action.tasks.build',
			weight: KeybindingWeight.WorkbenchContrib,
			when: undefined,
			primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_B
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.test', () => {
			if (!this.canRunCommand()) {
				return;
			}
			this.runTestCommand();
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.configureTaskRunner', () => {
			this.runConfigureTasks();
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.configureDefaultBuildTask', () => {
			this.runConfigureDefaultBuildTask();
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.configureDefaultTestTask', () => {
			this.runConfigureDefaultTestTask();
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.showTasks', () => {
			this.runShowTasks();
		});
	}

	private get workspaceFolders(): IWorkspaceFolder[] {
		if (!this._workspaceFolders) {
			this.updateSetup();
		}
		return this._workspaceFolders;
	}

	private get ignoredWorkspaceFolders(): IWorkspaceFolder[] {
		if (!this._ignoredWorkspaceFolders) {
			this.updateSetup();
		}
		return this._ignoredWorkspaceFolders;
	}

	private get executionEngine(): ExecutionEngine {
		if (this._executionEngine === void 0) {
			this.updateSetup();
		}
		return this._executionEngine;
	}

	private get schemaVersion(): JsonSchemaVersion {
		if (this._schemaVersion === void 0) {
			this.updateSetup();
		}
		return this._schemaVersion;
	}

	private get showIgnoreMessage(): boolean {
		if (this._showIgnoreMessage === void 0) {
			this._showIgnoreMessage = !this.storageService.getBoolean(TaskService.IgnoreTask010DonotShowAgain_key, StorageScope.WORKSPACE, false);
		}
		return this._showIgnoreMessage;
	}

	private updateSetup(setup?: [IWorkspaceFolder[], IWorkspaceFolder[], ExecutionEngine, JsonSchemaVersion]): void {
		if (!setup) {
			setup = this.computeWorkspaceFolderSetup();
		}
		this._workspaceFolders = setup[0];
		if (this._ignoredWorkspaceFolders) {
			if (this._ignoredWorkspaceFolders.length !== setup[1].length) {
				this._showIgnoreMessage = undefined;
			} else {
				let set: Set<string> = new Set();
				this._ignoredWorkspaceFolders.forEach(folder => set.add(folder.uri.toString()));
				for (let folder of setup[1]) {
					if (!set.has(folder.uri.toString())) {
						this._showIgnoreMessage = undefined;
						break;
					}
				}
			}
		}
		this._ignoredWorkspaceFolders = setup[1];
		this._executionEngine = setup[2];
		this._schemaVersion = setup[3];
	}

	private showOutput(): void {
		this.outputService.showChannel(this._outputChannel.id, true);
	}

	private disposeTaskSystemListeners(): void {
		if (this._taskSystemListener) {
			this._taskSystemListener.dispose();
		}
	}

	public registerTaskProvider(provider: ITaskProvider): IDisposable {
		if (!provider) {
			return {
				dispose: () => { }
			};
		}
		let handle = TaskService.nextHandle++;
		this._providers.set(handle, provider);
		return {
			dispose: () => {
				this._providers.delete(handle);
			}
		};
	}

	public registerTaskSystem(key: string, info: TaskSystemInfo): void {
		this._taskSystemInfos.set(key, info);
	}

	public getTask(folder: IWorkspaceFolder | string, identifier: string | TaskIdentifier, compareId: boolean = false): TPromise<Task> {
		let name = Types.isString(folder) ? folder : folder.name;
		if (this.ignoredWorkspaceFolders.some(ignored => ignored.name === name)) {
			return TPromise.wrapError(new Error(nls.localize('TaskServer.folderIgnored', 'The folder {0} is ignored since it uses task version 0.1.0', name)));
		}
		let key: string | KeyedTaskIdentifier;
		if (!Types.isString(identifier)) {
			key = TaskDefinition.createTaskIdentifier(identifier, console);
		} else {
			key = identifier;
		}
		if (key === void 0) {
			return TPromise.as(undefined);
		}
		return this.getGroupedTasks().then((map) => {
			let values = map.get(folder);
			if (!values) {
				return undefined;
			}
			for (let task of values) {
				if (Task.matches(task, key, compareId)) {
					return task;
				}
			}
			return undefined;
		});
	}

	public tasks(filter?: TaskFilter): TPromise<Task[]> {
		let range = filter && filter.version ? filter.version : undefined;
		let engine = this.executionEngine;

		if (range && ((semver.satisfies('0.1.0', range) && engine === ExecutionEngine.Terminal) || (semver.satisfies('2.0.0', range) && engine === ExecutionEngine.Process))) {
			return TPromise.as<Task[]>([]);
		}
		return this.getGroupedTasks().then((map) => {
			if (!filter || !filter.type) {
				return map.all();
			}
			let result: Task[] = [];
			map.forEach((tasks) => {
				for (let task of tasks) {
					if (ContributedTask.is(task) && task.defines.type === filter.type) {
						result.push(task);
					} else if (CustomTask.is(task)) {
						if (task.type === filter.type) {
							result.push(task);
						} else {
							let customizes = CustomTask.customizes(task);
							if (customizes && customizes.type === filter.type) {
								result.push(task);
							}
						}
					}
				}
			});
			return result;
		});
	}

	public createSorter(): TaskSorter {
		return new TaskSorter(this.contextService.getWorkspace() ? this.contextService.getWorkspace().folders : []);
	}

	public isActive(): TPromise<boolean> {
		if (!this._taskSystem) {
			return TPromise.as(false);
		}
		return this._taskSystem.isActive();
	}

	public getActiveTasks(): TPromise<Task[]> {
		if (!this._taskSystem) {
			return TPromise.as([]);
		}
		return TPromise.as(this._taskSystem.getActiveTasks());
	}

	public getRecentlyUsedTasks(): LinkedMap<string, string> {
		if (this._recentlyUsedTasks) {
			return this._recentlyUsedTasks;
		}
		this._recentlyUsedTasks = new LinkedMap<string, string>();
		let storageValue = this.storageService.get(TaskService.RecentlyUsedTasks_Key, StorageScope.WORKSPACE);
		if (storageValue) {
			try {
				let values: string[] = JSON.parse(storageValue);
				if (Array.isArray(values)) {
					for (let value of values) {
						this._recentlyUsedTasks.set(value, value);
					}
				}
			} catch (error) {
				// Ignore. We use the empty result
			}
		}
		return this._recentlyUsedTasks;
	}

	private saveState(): void {
		if (!this._taskSystem || !this._recentlyUsedTasks) {
			return;
		}
		let values = this._recentlyUsedTasks.values();
		if (values.length > 30) {
			values = values.slice(0, 30);
		}
		this.storageService.store(TaskService.RecentlyUsedTasks_Key, JSON.stringify(values), StorageScope.WORKSPACE);
	}

	private openDocumentation(): void {
		this.openerService.open(URI.parse('https://go.microsoft.com/fwlink/?LinkId=733558'));
	}

	public build(): TPromise<ITaskSummary> {
		return this.getGroupedTasks().then((tasks) => {
			let runnable = this.createRunnableTask(tasks, TaskGroup.Build);
			if (!runnable || !runnable.task) {
				if (this.schemaVersion === JsonSchemaVersion.V0_1_0) {
					throw new TaskError(Severity.Info, nls.localize('TaskService.noBuildTask1', 'No build task defined. Mark a task with \'isBuildCommand\' in the tasks.json file.'), TaskErrors.NoBuildTask);
				} else {
					throw new TaskError(Severity.Info, nls.localize('TaskService.noBuildTask2', 'No build task defined. Mark a task with as a \'build\' group in the tasks.json file.'), TaskErrors.NoBuildTask);
				}
			}
			return this.executeTask(runnable.task, runnable.resolver);
		}).then(value => value, (error) => {
			this.handleError(error);
			return TPromise.wrapError(error);
		});
	}

	public runTest(): TPromise<ITaskSummary> {
		return this.getGroupedTasks().then((tasks) => {
			let runnable = this.createRunnableTask(tasks, TaskGroup.Test);
			if (!runnable || !runnable.task) {
				if (this.schemaVersion === JsonSchemaVersion.V0_1_0) {
					throw new TaskError(Severity.Info, nls.localize('TaskService.noTestTask1', 'No test task defined. Mark a task with \'isTestCommand\' in the tasks.json file.'), TaskErrors.NoTestTask);
				} else {
					throw new TaskError(Severity.Info, nls.localize('TaskService.noTestTask2', 'No test task defined. Mark a task with as a \'test\' group in the tasks.json file.'), TaskErrors.NoTestTask);
				}
			}
			return this.executeTask(runnable.task, runnable.resolver);
		}).then(value => value, (error) => {
			this.handleError(error);
			return TPromise.wrapError(error);
		});
	}

	public run(task: Task, options?: RunOptions): TPromise<ITaskSummary> {
		return this.getGroupedTasks().then((grouped) => {
			if (!task) {
				throw new TaskError(Severity.Info, nls.localize('TaskServer.noTask', 'Requested task {0} to execute not found.', task.name), TaskErrors.TaskNotFound);
			} else {
				let resolver = this.createResolver(grouped);
				if (options && options.attachProblemMatcher && this.shouldAttachProblemMatcher(task) && !InMemoryTask.is(task)) {
					return this.attachProblemMatcher(task).then((toExecute) => {
						if (toExecute) {
							return this.executeTask(toExecute, resolver);
						} else {
							return TPromise.as(undefined);
						}
					});
				}
				return this.executeTask(task, resolver);
			}
		}).then(value => value, (error) => {
			this.handleError(error);
			return TPromise.wrapError(error);
		});
	}

	private shouldAttachProblemMatcher(task: Task): boolean {
		if (!this.canCustomize(task)) {
			return false;
		}
		if (task.group !== void 0 && task.group !== TaskGroup.Build) {
			return false;
		}
		if (task.problemMatchers !== void 0 && task.problemMatchers.length > 0) {
			return false;
		}
		if (ContributedTask.is(task)) {
			return !task.hasDefinedMatchers && task.problemMatchers.length === 0;
		}
		if (CustomTask.is(task)) {
			let configProperties: TaskConfig.ConfigurationProperties = task._source.config.element;
			return configProperties.problemMatcher === void 0 && !task.hasDefinedMatchers;
		}
		return false;
	}

	private attachProblemMatcher(task: ContributedTask | CustomTask): TPromise<Task> {
		interface ProblemMatcherPickEntry extends IQuickPickItem {
			matcher: NamedProblemMatcher;
			never?: boolean;
			learnMore?: boolean;
		}
		let entries: QuickPickInput<ProblemMatcherPickEntry>[] = [];
		for (let key of ProblemMatcherRegistry.keys()) {
			let matcher = ProblemMatcherRegistry.get(key);
			if (matcher.deprecated) {
				continue;
			}
			if (matcher.name === matcher.label) {
				entries.push({ label: matcher.name, matcher: matcher });
			} else {
				entries.push({
					label: matcher.label,
					description: `$${matcher.name}`,
					matcher: matcher
				});
			}
		}
		if (entries.length > 0) {
			entries = entries.sort((a, b) => a.label.localeCompare(b.label));
			entries.unshift({ type: 'separator', label: nls.localize('TaskService.associate', 'associate') });
			entries.unshift(
				{ label: nls.localize('TaskService.attachProblemMatcher.continueWithout', 'Continue without scanning the task output'), matcher: undefined },
				{ label: nls.localize('TaskService.attachProblemMatcher.never', 'Never scan the task output'), matcher: undefined, never: true },
				{ label: nls.localize('TaskService.attachProblemMatcher.learnMoreAbout', 'Learn more about scanning the task output'), matcher: undefined, learnMore: true }
			);
			return this.quickInputService.pick(entries, {
				placeHolder: nls.localize('selectProblemMatcher', 'Select for which kind of errors and warnings to scan the task output'),
			}).then((selected) => {
				if (selected) {
					if (selected.learnMore) {
						this.openDocumentation();
						return undefined;
					} else if (selected.never) {
						this.customize(task, { problemMatcher: [] }, true);
						return task;
					} else if (selected.matcher) {
						let newTask = Task.clone(task);
						let matcherReference = `$${selected.matcher.name}`;
						let properties: CustomizationProperties = { problemMatcher: [matcherReference] };
						newTask.problemMatchers = [matcherReference];
						let matcher = ProblemMatcherRegistry.get(selected.matcher.name);
						if (matcher && matcher.watching !== void 0) {
							properties.isBackground = true;
							newTask.isBackground = true;
						}
						this.customize(task, properties, true);
						return newTask;
					} else {
						return task;
					}
				} else {
					return undefined;
				}
			});
		}
		return TPromise.as(task);
	}

	public getTasksForGroup(group: string): TPromise<Task[]> {
		return this.getGroupedTasks().then((groups) => {
			let result: Task[] = [];
			groups.forEach((tasks) => {
				for (let task of tasks) {
					if (task.group === group) {
						result.push(task);
					}
				}
			});
			return result;
		});
	}

	public needsFolderQualification(): boolean {
		return this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE;
	}

	public canCustomize(task: Task): boolean {
		if (this.schemaVersion !== JsonSchemaVersion.V2_0_0) {
			return false;
		}
		if (CustomTask.is(task)) {
			return true;
		}
		if (ContributedTask.is(task)) {
			return !!Task.getWorkspaceFolder(task);
		}
		return false;
	}

	public customize(task: ContributedTask | CustomTask, properties?: CustomizationProperties, openConfig?: boolean): TPromise<void> {
		let workspaceFolder = Task.getWorkspaceFolder(task);
		if (!workspaceFolder) {
			return TPromise.wrap<void>(undefined);
		}
		let configuration = this.getConfiguration(workspaceFolder);
		if (configuration.hasParseErrors) {
			this.notificationService.warn(nls.localize('customizeParseErrors', 'The current task configuration has errors. Please fix the errors first before customizing a task.'));
			return TPromise.wrap<void>(undefined);
		}

		let fileConfig = configuration.config;
		let index: number;
		let toCustomize: TaskConfig.CustomTask | TaskConfig.ConfiguringTask;
		let taskConfig = CustomTask.is(task) ? task._source.config : undefined;
		if (taskConfig && taskConfig.element) {
			index = taskConfig.index;
			toCustomize = taskConfig.element;
		} else if (ContributedTask.is(task)) {
			toCustomize = {
			};
			let identifier: TaskConfig.TaskIdentifier = Objects.assign(Object.create(null), task.defines);
			delete identifier['_key'];
			Object.keys(identifier).forEach(key => toCustomize[key] = identifier[key]);
			if (task.problemMatchers && task.problemMatchers.length > 0 && Types.isStringArray(task.problemMatchers)) {
				toCustomize.problemMatcher = task.problemMatchers;
			}
		}
		if (!toCustomize) {
			return TPromise.as(undefined);
		}
		if (properties) {
			for (let property of Object.getOwnPropertyNames(properties)) {
				let value = properties[property];
				if (value !== void 0 && value !== null) {
					toCustomize[property] = value;
				}
			}
		} else {
			if (toCustomize.problemMatcher === void 0 && task.problemMatchers === void 0 || task.problemMatchers.length === 0) {
				toCustomize.problemMatcher = [];
			}
		}

		let promise: TPromise<void>;
		if (!fileConfig) {
			let value = {
				version: '2.0.0',
				tasks: [toCustomize]
			};
			let content = [
				'{',
				'\t// See https://go.microsoft.com/fwlink/?LinkId=733558',
				'\t// for the documentation about the tasks.json format',
			].join('\n') + JSON.stringify(value, null, '\t').substr(1);
			let editorConfig = this.configurationService.getValue<any>();
			if (editorConfig.editor.insertSpaces) {
				content = content.replace(/(\n)(\t+)/g, (_, s1, s2) => s1 + strings.repeat(' ', s2.length * editorConfig.editor.tabSize));
			}
			promise = this.fileService.createFile(workspaceFolder.toResource('.vscode/tasks.json'), content).then(() => { });
		} else {
			// We have a global task configuration
			if (index === -1) {
				if (properties.problemMatcher !== void 0) {
					fileConfig.problemMatcher = properties.problemMatcher;
					promise = this.writeConfiguration(workspaceFolder, 'tasks.problemMatchers', fileConfig.problemMatcher);
				} else if (properties.group !== void 0) {
					fileConfig.group = properties.group;
					promise = this.writeConfiguration(workspaceFolder, 'tasks.group', fileConfig.group);
				}
			} else {
				if (!Array.isArray(fileConfig.tasks)) {
					fileConfig.tasks = [];
				}
				if (index === void 0) {
					fileConfig.tasks.push(toCustomize);
				} else {
					fileConfig.tasks[index] = toCustomize;
				}
				promise = this.writeConfiguration(workspaceFolder, 'tasks.tasks', fileConfig.tasks);
			}
		}
		if (!promise) {
			return TPromise.as(undefined);
		}
		return promise.then(() => {
			let event: TaskCustomizationTelementryEvent = {
				properties: properties ? Object.getOwnPropertyNames(properties) : []
			};
			/* __GDPR__
				"taskService.customize" : {
					"properties" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			*/
			this.telemetryService.publicLog(TaskService.CustomizationTelemetryEventName, event);
			if (openConfig) {
				let resource = workspaceFolder.toResource('.vscode/tasks.json');
				this.editorService.openEditor({
					resource,
					options: {
						pinned: false,
						forceReload: true // because content might have changed
					}
				});
			}
		});
	}

	private writeConfiguration(workspaceFolder: IWorkspaceFolder, key: string, value: any): TPromise<void> {
		if (this.contextService.getWorkbenchState() === WorkbenchState.FOLDER) {
			return this.configurationService.updateValue(key, value, { resource: workspaceFolder.uri }, ConfigurationTarget.WORKSPACE);
		} else if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			return this.configurationService.updateValue(key, value, { resource: workspaceFolder.uri }, ConfigurationTarget.WORKSPACE_FOLDER);
		} else {
			return undefined;
		}
	}

	public openConfig(task: CustomTask): TPromise<void> {
		let resource = Task.getWorkspaceFolder(task).toResource(task._source.config.file);
		return this.editorService.openEditor({
			resource,
			options: {
				pinned: false
			}
		}).then(() => undefined);
	}

	private createRunnableTask(tasks: TaskMap, group: TaskGroup): { task: Task; resolver: ITaskResolver } {
		interface ResolverData {
			id: Map<string, Task>;
			label: Map<string, Task>;
			identifier: Map<string, Task>;
		}

		let resolverData: Map<string, ResolverData> = new Map();
		let workspaceTasks: Task[] = [];
		let extensionTasks: Task[] = [];
		tasks.forEach((tasks, folder) => {
			let data = resolverData.get(folder);
			if (!data) {
				data = {
					id: new Map<string, Task>(),
					label: new Map<string, Task>(),
					identifier: new Map<string, Task>()
				};
				resolverData.set(folder, data);
			}
			for (let task of tasks) {
				data.id.set(task._id, task);
				data.label.set(task._label, task);
				data.identifier.set(task.identifier, task);
				if (group && task.group === group) {
					if (task._source.kind === TaskSourceKind.Workspace) {
						workspaceTasks.push(task);
					} else {
						extensionTasks.push(task);
					}
				}
			}
		});
		let resolver: ITaskResolver = {
			resolve: (workspaceFolder: IWorkspaceFolder, alias: string) => {
				let data = resolverData.get(workspaceFolder.uri.toString());
				if (!data) {
					return undefined;
				}
				return data.id.get(alias) || data.label.get(alias) || data.identifier.get(alias);
			}
		};
		if (workspaceTasks.length > 0) {
			if (workspaceTasks.length > 1) {
				this._outputChannel.append(nls.localize('moreThanOneBuildTask', 'There are many build tasks defined in the tasks.json. Executing the first one.\n'));
			}
			return { task: workspaceTasks[0], resolver };
		}
		if (extensionTasks.length === 0) {
			return undefined;
		}

		// We can only have extension tasks if we are in version 2.0.0. Then we can even run
		// multiple build tasks.
		if (extensionTasks.length === 1) {
			return { task: extensionTasks[0], resolver };
		} else {
			let id: string = UUID.generateUuid();
			let task: InMemoryTask = {
				_id: id,
				_source: { kind: TaskSourceKind.InMemory, label: 'inMemory' },
				_label: id,
				type: 'inMemory',
				name: id,
				identifier: id,
				dependsOn: extensionTasks.map((task) => { return { workspaceFolder: Task.getWorkspaceFolder(task), task: task._id }; })
			};
			return { task, resolver };
		}
	}

	private createResolver(grouped: TaskMap): ITaskResolver {
		interface ResolverData {
			label: Map<string, Task>;
			identifier: Map<string, Task>;
			taskIdentifier: Map<string, Task>;
		}

		let resolverData: Map<string, ResolverData> = new Map();
		grouped.forEach((tasks, folder) => {
			let data = resolverData.get(folder);
			if (!data) {
				data = { label: new Map<string, Task>(), identifier: new Map<string, Task>(), taskIdentifier: new Map<string, Task>() };
				resolverData.set(folder, data);
			}
			for (let task of tasks) {
				data.label.set(task._label, task);
				data.identifier.set(task.identifier, task);
				let keyedIdentifier = Task.getTaskDefinition(task, true);
				if (keyedIdentifier !== void 0) {
					data.taskIdentifier.set(keyedIdentifier._key, task);
				}
			}
		});
		return {
			resolve: (workspaceFolder: IWorkspaceFolder, identifier: string | TaskIdentifier) => {
				let data = resolverData.get(workspaceFolder.uri.toString());
				if (!data) {
					return undefined;
				}
				if (Types.isString(identifier)) {
					return data.label.get(identifier) || data.identifier.get(identifier);
				} else {
					let key = TaskDefinition.createTaskIdentifier(identifier, console);
					return key !== void 0 ? data.taskIdentifier.get(key._key) : undefined;
				}
			}
		};
	}

	private executeTask(task: Task, resolver: ITaskResolver): TPromise<ITaskSummary> {
		return ProblemMatcherRegistry.onReady().then(() => {
			return this.textFileService.saveAll().then((value) => { // make sure all dirty files are saved
				let executeResult = this.getTaskSystem().run(task, resolver);
				let key = Task.getRecentlyUsedKey(task);
				if (key) {
					this.getRecentlyUsedTasks().set(key, key, Touch.AsOld);
				}
				if (executeResult.kind === TaskExecuteKind.Active) {
					let active = executeResult.active;
					if (active.same) {
						let message;
						if (task.instanceLimit) {
							this.restart(task);
							message = nls.localize('TaskSystem.instanceLimit', 'Restarting \'{0}\'.', Task.getQualifiedLabel(task));
						} else if (active.background) {
							message = nls.localize('TaskSystem.activeSame.background', 'The task \'{0}\' is already active and in background mode.', Task.getQualifiedLabel(task));
						} else {
							message = nls.localize('TaskSystem.activeSame.noBackground', 'The task \'{0}\' is already active.', Task.getQualifiedLabel(task));
						}
						this.notificationService.prompt(Severity.Info, message,
							[{
								label: nls.localize('terminateTask', "Terminate Task"),
								run: () => this.terminate(task)
							},
							{
								label: nls.localize('restartTask', "Restart Task"),
								run: () => this.restart(task)
							}],
							{ sticky: true }
						);
					} else {
						throw new TaskError(Severity.Warning, nls.localize('TaskSystem.active', 'There is already a task running. Terminate it first before executing another task.'), TaskErrors.RunningTask);
					}
				}
				return executeResult.promise;
			});
		});
	}

	public restart(task: Task): void {
		if (!this._taskSystem) {
			return;
		}
		this._taskSystem.terminate(task).then((response) => {
			if (response.success) {
				this.run(task);
			} else {
				this.notificationService.warn(nls.localize('TaskSystem.restartFailed', 'Failed to terminate and restart task {0}', Types.isString(task) ? task : task.name));
			}
			return response;
		});
	}

	public terminate(task: Task): TPromise<TaskTerminateResponse> {
		if (!this._taskSystem) {
			return TPromise.as({ success: true, task: undefined });
		}
		return this._taskSystem.terminate(task);
	}

	public terminateAll(): TPromise<TaskTerminateResponse[]> {
		if (!this._taskSystem) {
			return TPromise.as<TaskTerminateResponse[]>([]);
		}
		return this._taskSystem.terminateAll();
	}

	private getTaskSystem(): ITaskSystem {
		if (this._taskSystem) {
			return this._taskSystem;
		}
		if (this.executionEngine === ExecutionEngine.Terminal) {
			this._taskSystem = new TerminalTaskSystem(
				this.terminalService, this.outputService, this.markerService,
				this.modelService, this.configurationResolverService, this.telemetryService,
				this.contextService, TaskService.OutputChannelId,
				(workspaceFolder: IWorkspaceFolder) => {
					if (!workspaceFolder) {
						return undefined;
					}
					return this._taskSystemInfos.get(workspaceFolder.uri.scheme);
				}
			);
		} else {
			let system = new ProcessTaskSystem(
				this.markerService, this.modelService, this.telemetryService, this.outputService,
				this.configurationResolverService, TaskService.OutputChannelId,
			);
			system.hasErrors(this._configHasErrors);
			this._taskSystem = system;
		}
		this._taskSystemListener = this._taskSystem.onDidStateChange((event) => {
			if (this._taskSystem) {
				this._taskRunningState.set(this._taskSystem.isActiveSync());
			}
			this._onDidStateChange.fire(event);
		});
		return this._taskSystem;
	}

	private getGroupedTasks(): TPromise<TaskMap> {
		return TPromise.join([this.extensionService.activateByEvent('onCommand:workbench.action.tasks.runTask'), TaskDefinitionRegistry.onReady()]).then(() => {
			let validTypes: IStringDictionary<boolean> = Object.create(null);
			TaskDefinitionRegistry.all().forEach(definition => validTypes[definition.taskType] = true);
			return new TPromise<TaskSet[]>((resolve, reject) => {
				let result: TaskSet[] = [];
				let counter: number = 0;
				let done = (value: TaskSet) => {
					if (value) {
						result.push(value);
					}
					if (--counter === 0) {
						resolve(result);
					}
				};
				let error = (error: any) => {
					try {
						if (error && Types.isString(error.message)) {
							this._outputChannel.append('Error: ');
							this._outputChannel.append(error.message);
							this._outputChannel.append('\n');
							this.outputService.showChannel(this._outputChannel.id, true);
						} else {
							this._outputChannel.append('Unknown error received while collecting tasks from providers.\n');
							this.outputService.showChannel(this._outputChannel.id, true);
						}
					} finally {
						if (--counter === 0) {
							resolve(result);
						}
					}
				};
				if (this.schemaVersion === JsonSchemaVersion.V2_0_0 && this._providers.size > 0) {
					this._providers.forEach((provider) => {
						counter++;
						provider.provideTasks(validTypes).then(done, error);
					});
				} else {
					resolve(result);
				}
			});
		}).then((contributedTaskSets) => {
			let result: TaskMap = new TaskMap();
			let contributedTasks: TaskMap = new TaskMap();
			for (let set of contributedTaskSets) {
				for (let task of set.tasks) {
					let workspaceFolder = Task.getWorkspaceFolder(task);
					if (workspaceFolder) {
						contributedTasks.add(workspaceFolder, task);
					}
				}
			}
			return this.getWorkspaceTasks().then((customTasks) => {
				customTasks.forEach((folderTasks, key) => {
					let contributed = contributedTasks.get(key);
					if (!folderTasks.set) {
						if (contributed) {
							result.add(key, ...contributed);
						}
						return;
					}

					if (!contributed) {
						result.add(key, ...folderTasks.set.tasks);
					} else {
						let configurations = folderTasks.configurations;
						let legacyTaskConfigurations = folderTasks.set ? this.getLegacyTaskConfigurations(folderTasks.set) : undefined;
						let customTasksToDelete: Task[] = [];
						if (configurations || legacyTaskConfigurations) {
							let unUsedConfigurations: Set<string> = new Set<string>();
							if (configurations) {
								Object.keys(configurations.byIdentifier).forEach(key => unUsedConfigurations.add(key));
							}
							for (let task of contributed) {
								if (!ContributedTask.is(task)) {
									continue;
								}
								if (configurations) {
									let configuringTask = configurations.byIdentifier[task.defines._key];
									if (configuringTask) {
										unUsedConfigurations.delete(task.defines._key);
										result.add(key, TaskConfig.createCustomTask(task, configuringTask));
									} else {
										result.add(key, task);
									}
								} else if (legacyTaskConfigurations) {
									let configuringTask = legacyTaskConfigurations[task.defines._key];
									if (configuringTask) {
										result.add(key, TaskConfig.createCustomTask(task, configuringTask));
										customTasksToDelete.push(configuringTask);
									} else {
										result.add(key, task);
									}
								} else {
									result.add(key, task);
								}
							}
							if (customTasksToDelete.length > 0) {
								let toDelete = customTasksToDelete.reduce<IStringDictionary<boolean>>((map, task) => {
									map[task._id] = true;
									return map;
								}, Object.create(null));
								for (let task of folderTasks.set.tasks) {
									if (toDelete[task._id]) {
										continue;
									}
									result.add(key, task);
								}
							} else {
								result.add(key, ...folderTasks.set.tasks);
							}
							unUsedConfigurations.forEach((value) => {
								let configuringTask = configurations.byIdentifier[value];
								this._outputChannel.append(nls.localize(
									'TaskService.noConfiguration',
									'Error: The {0} task detection didn\'t contribute a task for the following configuration:\n{1}\nThe task will be ignored.\n',
									configuringTask.configures.type,
									JSON.stringify(configuringTask._source.config.element, undefined, 4)
								));
								this.showOutput();
							});
						} else {
							result.add(key, ...folderTasks.set.tasks);
							result.add(key, ...contributed);
						}
					}
				});
				return result;
			}, () => {
				// If we can't read the tasks.json file provide at least the contributed tasks
				let result: TaskMap = new TaskMap();
				for (let set of contributedTaskSets) {
					for (let task of set.tasks) {
						result.add(Task.getWorkspaceFolder(task), task);
					}
				}
				return result;
			});
		});
	}

	private getLegacyTaskConfigurations(workspaceTasks: TaskSet): IStringDictionary<CustomTask> {
		let result: IStringDictionary<CustomTask>;
		function getResult() {
			if (result) {
				return result;
			}
			result = Object.create(null);
			return result;
		}
		for (let task of workspaceTasks.tasks) {
			if (CustomTask.is(task)) {
				let commandName = task.command && task.command.name;
				// This is for backwards compatibility with the 0.1.0 task annotation code
				// if we had a gulp, jake or grunt command a task specification was a annotation
				if (commandName === 'gulp' || commandName === 'grunt' || commandName === 'jake') {
					let identifier = NKeyedTaskIdentifier.create({
						type: commandName,
						task: task.name
					});
					getResult()[identifier._key] = task;
				}
			}
		}
		return result;
	}

	private getWorkspaceTasks(): TPromise<Map<string, WorkspaceFolderTaskResult>> {
		if (this._workspaceTasksPromise) {
			return this._workspaceTasksPromise;
		}
		this.updateWorkspaceTasks();
		return this._workspaceTasksPromise;
	}

	private updateWorkspaceTasks(): void {
		this._workspaceTasksPromise = this.computeWorkspaceTasks().then(value => {
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

	private computeWorkspaceTasks(): TPromise<Map<string, WorkspaceFolderTaskResult>> {
		if (this.workspaceFolders.length === 0) {
			return TPromise.as(new Map<string, WorkspaceFolderTaskResult>());
		} else {
			let promises: TPromise<WorkspaceFolderTaskResult>[] = [];
			for (let folder of this.workspaceFolders) {
				promises.push(this.computeWorkspaceFolderTasks(folder).then((value) => value, () => undefined));
			}
			return TPromise.join(promises).then((values) => {
				let result = new Map<string, WorkspaceFolderTaskResult>();
				for (let value of values) {
					if (value) {
						result.set(value.workspaceFolder.uri.toString(), value);
					}
				}
				return result;
			});
		}
	}

	private computeWorkspaceFolderTasks(workspaceFolder: IWorkspaceFolder): TPromise<WorkspaceFolderTaskResult> {
		return (this.executionEngine === ExecutionEngine.Process
			? this.computeLegacyConfiguration(workspaceFolder)
			: this.computeConfiguration(workspaceFolder)).
			then((workspaceFolderConfiguration) => {
				if (!workspaceFolderConfiguration || !workspaceFolderConfiguration.config || workspaceFolderConfiguration.hasErrors) {
					return TPromise.as({ workspaceFolder, set: undefined, configurations: undefined, hasErrors: workspaceFolderConfiguration ? workspaceFolderConfiguration.hasErrors : false });
				}
				return ProblemMatcherRegistry.onReady().then((): WorkspaceFolderTaskResult => {
					let taskSystemInfo: TaskSystemInfo = this._taskSystemInfos.get(workspaceFolder.uri.scheme);
					let problemReporter = new ProblemReporter(this._outputChannel);
					let parseResult = TaskConfig.parse(workspaceFolder, taskSystemInfo ? taskSystemInfo.platform : Platform.platform, workspaceFolderConfiguration.config, problemReporter);
					let hasErrors = false;
					if (!parseResult.validationStatus.isOK()) {
						hasErrors = true;
						this.showOutput();
					}
					if (problemReporter.status.isFatal()) {
						problemReporter.fatal(nls.localize('TaskSystem.configurationErrors', 'Error: the provided task configuration has validation errors and can\'t not be used. Please correct the errors first.'));
						return { workspaceFolder, set: undefined, configurations: undefined, hasErrors };
					}
					let customizedTasks: { byIdentifier: IStringDictionary<ConfiguringTask>; };
					if (parseResult.configured && parseResult.configured.length > 0) {
						customizedTasks = {
							byIdentifier: Object.create(null)
						};
						for (let task of parseResult.configured) {
							customizedTasks.byIdentifier[task.configures._key] = task;
						}
					}
					return { workspaceFolder, set: { tasks: parseResult.custom }, configurations: customizedTasks, hasErrors };
				});
			});
	}

	private computeConfiguration(workspaceFolder: IWorkspaceFolder): TPromise<WorkspaceFolderConfigurationResult> {
		let { config, hasParseErrors } = this.getConfiguration(workspaceFolder);
		return TPromise.as<WorkspaceFolderConfigurationResult>({ workspaceFolder, config, hasErrors: hasParseErrors });
	}

	private computeLegacyConfiguration(workspaceFolder: IWorkspaceFolder): TPromise<WorkspaceFolderConfigurationResult> {
		let { config, hasParseErrors } = this.getConfiguration(workspaceFolder);
		if (hasParseErrors) {
			return TPromise.as({ workspaceFolder: workspaceFolder, hasErrors: true, config: undefined });
		}
		if (config) {
			if (this.hasDetectorSupport(config)) {
				return new ProcessRunnerDetector(workspaceFolder, this.fileService, this.contextService, this.configurationResolverService, config).detect(true).then((value): WorkspaceFolderConfigurationResult => {
					let hasErrors = this.printStderr(value.stderr);
					let detectedConfig = value.config;
					if (!detectedConfig) {
						return { workspaceFolder, config, hasErrors };
					}
					let result: TaskConfig.ExternalTaskRunnerConfiguration = Objects.deepClone(config);
					let configuredTasks: IStringDictionary<TaskConfig.CustomTask> = Object.create(null);
					if (!result.tasks) {
						if (detectedConfig.tasks) {
							result.tasks = detectedConfig.tasks;
						}
					} else {
						result.tasks.forEach(task => configuredTasks[task.taskName] = task);
						detectedConfig.tasks.forEach((task) => {
							if (!configuredTasks[task.taskName]) {
								result.tasks.push(task);
							}
						});
					}
					return { workspaceFolder, config: result, hasErrors };
				});
			} else {
				return TPromise.as({ workspaceFolder, config, hasErrors: false });
			}
		} else {
			return new ProcessRunnerDetector(workspaceFolder, this.fileService, this.contextService, this.configurationResolverService).detect(true).then((value) => {
				let hasErrors = this.printStderr(value.stderr);
				return { workspaceFolder, config: value.config, hasErrors };
			});
		}
	}

	private computeWorkspaceFolderSetup(): [IWorkspaceFolder[], IWorkspaceFolder[], ExecutionEngine, JsonSchemaVersion] {
		let workspaceFolders: IWorkspaceFolder[] = [];
		let ignoredWorkspaceFolders: IWorkspaceFolder[] = [];
		let executionEngine = ExecutionEngine.Terminal;
		let schemaVersion = JsonSchemaVersion.V2_0_0;

		if (this.contextService.getWorkbenchState() === WorkbenchState.FOLDER) {
			let workspaceFolder: IWorkspaceFolder = this.contextService.getWorkspace().folders[0];
			workspaceFolders.push(workspaceFolder);
			executionEngine = this.computeExecutionEngine(workspaceFolder);
			schemaVersion = this.computeJsonSchemaVersion(workspaceFolder);
		} else if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			for (let workspaceFolder of this.contextService.getWorkspace().folders) {
				if (schemaVersion === this.computeJsonSchemaVersion(workspaceFolder)) {
					workspaceFolders.push(workspaceFolder);
				} else {
					ignoredWorkspaceFolders.push(workspaceFolder);
					this._outputChannel.append(nls.localize(
						'taskService.ignoreingFolder',
						'Ignoring task configurations for workspace folder {0}. Multi folder workspace task support requires that all folders use task version 2.0.0\n',
						workspaceFolder.uri.fsPath));
				}
			}
		}
		return [workspaceFolders, ignoredWorkspaceFolders, executionEngine, schemaVersion];
	}

	private computeExecutionEngine(workspaceFolder: IWorkspaceFolder): ExecutionEngine {
		let { config } = this.getConfiguration(workspaceFolder);
		if (!config) {
			return ExecutionEngine._default;
		}
		return TaskConfig.ExecutionEngine.from(config);
	}

	private computeJsonSchemaVersion(workspaceFolder: IWorkspaceFolder): JsonSchemaVersion {
		let { config } = this.getConfiguration(workspaceFolder);
		if (!config) {
			return JsonSchemaVersion.V2_0_0;
		}
		return TaskConfig.JsonSchemaVersion.from(config);
	}

	private getConfiguration(workspaceFolder: IWorkspaceFolder): { config: TaskConfig.ExternalTaskRunnerConfiguration; hasParseErrors: boolean } {
		let result = this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY
			? Objects.deepClone(this.configurationService.getValue<TaskConfig.ExternalTaskRunnerConfiguration>('tasks', { resource: workspaceFolder.uri }))
			: undefined;
		if (!result) {
			return { config: undefined, hasParseErrors: false };
		}
		let parseErrors: string[] = (result as any).$parseErrors;
		if (parseErrors) {
			let isAffected = false;
			for (let i = 0; i < parseErrors.length; i++) {
				if (/tasks\.json$/.test(parseErrors[i])) {
					isAffected = true;
					break;
				}
			}
			if (isAffected) {
				this._outputChannel.append(nls.localize('TaskSystem.invalidTaskJson', 'Error: The content of the tasks.json file has syntax errors. Please correct them before executing a task.\n'));
				this.showOutput();
				return { config: undefined, hasParseErrors: true };
			}
		}
		return { config: result, hasParseErrors: false };
	}

	private printStderr(stderr: string[]): boolean {
		let result = false;
		if (stderr && stderr.length > 0) {
			stderr.forEach((line) => {
				result = true;
				this._outputChannel.append(line + '\n');
			});
			this.outputService.showChannel(this._outputChannel.id, true);
		}
		return result;
	}

	public inTerminal(): boolean {
		if (this._taskSystem) {
			return this._taskSystem instanceof TerminalTaskSystem;
		}
		return this.executionEngine === ExecutionEngine.Terminal;
	}

	private hasDetectorSupport(config: TaskConfig.ExternalTaskRunnerConfiguration): boolean {
		if (!config.command || this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			return false;
		}
		return ProcessRunnerDetector.supports(TaskConfig.CommandString.value(config.command));
	}

	public configureAction(): Action {
		let run = () => { this.runConfigureTasks(); return TPromise.as(undefined); };
		return new class extends Action {
			constructor() {
				super(ConfigureTaskAction.ID, ConfigureTaskAction.TEXT, undefined, true, run);
			}
		};
	}

	public beforeShutdown(): boolean | TPromise<boolean> {
		if (!this._taskSystem) {
			return false;
		}
		if (!this._taskSystem.isActiveSync()) {
			return false;
		}
		// The terminal service kills all terminal on shutdown. So there
		// is nothing we can do to prevent this here.
		if (this._taskSystem instanceof TerminalTaskSystem) {
			return false;
		}

		let terminatePromise: TPromise<IConfirmationResult>;
		if (this._taskSystem.canAutoTerminate()) {
			terminatePromise = TPromise.wrap({ confirmed: true });
		} else {
			terminatePromise = this.dialogService.confirm({
				message: nls.localize('TaskSystem.runningTask', 'There is a task running. Do you want to terminate it?'),
				primaryButton: nls.localize({ key: 'TaskSystem.terminateTask', comment: ['&& denotes a mnemonic'] }, "&&Terminate Task"),
				type: 'question'
			});
		}

		return terminatePromise.then(res => {
			if (res.confirmed) {
				return this._taskSystem.terminateAll().then((responses) => {
					let success = true;
					let code: number | undefined = undefined;
					for (let response of responses) {
						success = success && response.success;
						// We only have a code in the old output runner which only has one task
						// So we can use the first code.
						if (code === void 0 && response.code !== void 0) {
							code = response.code;
						}
					}
					if (success) {
						this._taskSystem = null;
						this.disposeTaskSystemListeners();
						return false; // no veto
					} else if (code && code === TerminateResponseCode.ProcessNotFound) {
						return this.dialogService.confirm({
							message: nls.localize('TaskSystem.noProcess', 'The launched task doesn\'t exist anymore. If the task spawned background processes exiting VS Code might result in orphaned processes. To avoid this start the last background process with a wait flag.'),
							primaryButton: nls.localize({ key: 'TaskSystem.exitAnyways', comment: ['&& denotes a mnemonic'] }, "&&Exit Anyways"),
							type: 'info'
						}).then(res => !res.confirmed);
					}
					return true; // veto
				}, (err) => {
					return true; // veto
				});
			}

			return true; // veto
		});
	}

	private handleError(err: any): void {
		let showOutput = true;
		if (err instanceof TaskError) {
			let buildError = <TaskError>err;
			let needsConfig = buildError.code === TaskErrors.NotConfigured || buildError.code === TaskErrors.NoBuildTask || buildError.code === TaskErrors.NoTestTask;
			let needsTerminate = buildError.code === TaskErrors.RunningTask;
			if (needsConfig || needsTerminate) {
				this.notificationService.prompt(buildError.severity, buildError.message, [{
					label: needsConfig ? ConfigureTaskAction.TEXT : nls.localize('TerminateAction.label', "Terminate Task"),
					run: () => {
						if (needsConfig) {
							this.runConfigureTasks();
						} else {
							this.runTerminateCommand();
						}
					}
				}]);
			} else {
				this.notificationService.notify({ severity: buildError.severity, message: buildError.message });
			}
		} else if (err instanceof Error) {
			let error = <Error>err;
			this.notificationService.error(error.message);
		} else if (Types.isString(err)) {
			this.notificationService.error(<string>err);
		} else {
			this.notificationService.error(nls.localize('TaskSystem.unknownError', 'An error has occurred while running a task. See task log for details.'));
		}
		if (showOutput) {
			this.outputService.showChannel(this._outputChannel.id, true);
		}
	}

	private canRunCommand(): boolean {
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			this.notificationService.info(nls.localize('TaskService.noWorkspace', 'Tasks are only available on a workspace folder.'));
			return false;
		}
		return true;
	}

	private createTaskQuickPickEntries(tasks: Task[], group: boolean = false, sort: boolean = false, selectedEntry?: TaskQuickPickEntry): TaskQuickPickEntry[] {
		if (tasks === void 0 || tasks === null || tasks.length === 0) {
			return [];
		}
		const TaskQuickPickEntry = (task: Task): TaskQuickPickEntry => {
			let description: string;
			if (this.needsFolderQualification()) {
				let workspaceFolder = Task.getWorkspaceFolder(task);
				if (workspaceFolder) {
					description = workspaceFolder.name;
				}
			}
			return { label: task._label, description, task };
		};
		function fillEntries(entries: QuickPickInput<TaskQuickPickEntry>[], tasks: Task[], groupLabel: string): void {
			if (tasks.length) {
				entries.push({ type: 'separator', label: groupLabel });
			}
			for (let task of tasks) {
				let entry: TaskQuickPickEntry = TaskQuickPickEntry(task);
				entry.buttons = [{ iconClass: 'quick-open-task-configure', tooltip: nls.localize('configureTask', "Configure Task") }];
				if (selectedEntry && (task === selectedEntry.task)) {
					entries.unshift(selectedEntry);
				} else {
					entries.push(entry);
				}
			}
		}
		let entries: TaskQuickPickEntry[];
		if (group) {
			entries = [];
			if (tasks.length === 1) {
				entries.push(TaskQuickPickEntry(tasks[0]));
			} else {
				let recentlyUsedTasks = this.getRecentlyUsedTasks();
				let recent: Task[] = [];
				let configured: Task[] = [];
				let detected: Task[] = [];
				let taskMap: IStringDictionary<Task> = Object.create(null);
				tasks.forEach(task => {
					let key = Task.getRecentlyUsedKey(task);
					if (key) {
						taskMap[key] = task;
					}
				});
				recentlyUsedTasks.keys().forEach(key => {
					let task = taskMap[key];
					if (task) {
						recent.push(task);
					}
				});
				for (let task of tasks) {
					let key = Task.getRecentlyUsedKey(task);
					if (!key || !recentlyUsedTasks.has(key)) {
						if (task._source.kind === TaskSourceKind.Workspace) {
							configured.push(task);
						} else {
							detected.push(task);
						}
					}
				}
				const sorter = this.createSorter();
				fillEntries(entries, recent, nls.localize('recentlyUsed', 'recently used tasks'));
				configured = configured.sort((a, b) => sorter.compare(a, b));
				fillEntries(entries, configured, nls.localize('configured', 'configured tasks'));
				detected = detected.sort((a, b) => sorter.compare(a, b));
				fillEntries(entries, detected, nls.localize('detected', 'detected tasks'));
			}
		} else {
			if (sort) {
				const sorter = this.createSorter();
				tasks = tasks.sort((a, b) => sorter.compare(a, b));
			}
			entries = tasks.map<TaskQuickPickEntry>(task => TaskQuickPickEntry(task));
		}
		return entries;
	}

	private showQuickPick(tasks: TPromise<Task[]> | Task[], placeHolder: string, defaultEntry?: TaskQuickPickEntry, group: boolean = false, sort: boolean = false, selectedEntry?: TaskQuickPickEntry): TPromise<Task> {
		let _createEntries = (): TPromise<TaskQuickPickEntry[]> => {
			if (Array.isArray(tasks)) {
				return TPromise.as(this.createTaskQuickPickEntries(tasks, group, sort, selectedEntry));
			} else {
				return tasks.then((tasks) => this.createTaskQuickPickEntries(tasks, group, sort, selectedEntry));
			}
		};
		return this.quickInputService.pick(_createEntries().then((entries) => {
			if ((entries.length === 0) && defaultEntry) {
				entries.push(defaultEntry);
			}
			return entries;
		}), {
				placeHolder,
				matchOnDescription: true,
				onDidTriggerItemButton: context => {
					let task = context.item.task;
					this.quickInputService.cancel();
					if (ContributedTask.is(task)) {
						this.customize(task, undefined, true);
					} else if (CustomTask.is(task)) {
						this.openConfig(task);
					}
				}
			}).then(entry => entry ? entry.task : undefined);
	}

	private showIgnoredFoldersMessage(): TPromise<void> {
		if (this.ignoredWorkspaceFolders.length === 0 || !this.showIgnoreMessage) {
			return TPromise.as(undefined);
		}

		this.notificationService.prompt(
			Severity.Info,
			nls.localize('TaskService.ignoredFolder', 'The following workspace folders are ignored since they use task version 0.1.0: {0}', this.ignoredWorkspaceFolders.map(f => f.name).join(', ')),
			[{
				label: nls.localize('TaskService.notAgain', 'Don\'t Show Again'),
				isSecondary: true,
				run: () => {
					this.storageService.store(TaskService.IgnoreTask010DonotShowAgain_key, true, StorageScope.WORKSPACE);
					this._showIgnoreMessage = false;
				}
			}]
		);

		return TPromise.as(undefined);
	}

	private runTaskCommand(arg?: any): void {
		if (!this.canRunCommand()) {
			return;
		}
		let identifier = this.getTaskIdentifier(arg);
		if (identifier !== void 0) {
			this.getGroupedTasks().then((grouped) => {
				let resolver = this.createResolver(grouped);
				let folders = this.contextService.getWorkspace().folders;
				for (let folder of folders) {
					let task = resolver.resolve(folder, identifier);
					if (task) {
						this.run(task);
						return;
					}
				}
				this.doRunTaskCommand(grouped.all());
			}, () => {
				this.doRunTaskCommand();
			});
		} else {
			this.doRunTaskCommand();
		}
	}

	private doRunTaskCommand(tasks?: Task[]): void {
		this.showIgnoredFoldersMessage().then(() => {
			this.showQuickPick(tasks ? tasks : this.tasks(),
				nls.localize('TaskService.pickRunTask', 'Select the task to run'),
				{
					label: nls.localize('TaslService.noEntryToRun', 'No task to run found. Configure Tasks...'),
					task: null
				},
				true).
				then((task) => {
					if (task === void 0) {
						return;
					}
					if (task === null) {
						this.runConfigureTasks();
					} else {
						this.run(task, { attachProblemMatcher: true });
					}
				});
		});
	}

	private splitPerGroupType(tasks: Task[]): { none: Task[], defaults: Task[], users: Task[] } {
		let none: Task[] = [];
		let defaults: Task[] = [];
		let users: Task[] = [];
		for (let task of tasks) {
			if (task.groupType === GroupType.default) {
				defaults.push(task);
			} else if (task.groupType === GroupType.user) {
				users.push(task);
			} else {
				none.push(task);
			}
		}
		return { none, defaults, users };
	}

	private runBuildCommand(): void {
		if (!this.canRunCommand()) {
			return;
		}
		if (this.schemaVersion === JsonSchemaVersion.V0_1_0) {
			this.build();
			return;
		}
		let options: IProgressOptions = {
			location: ProgressLocation.Window,
			title: nls.localize('TaskService.fetchingBuildTasks', 'Fetching build tasks...')
		};
		let promise = this.getTasksForGroup(TaskGroup.Build).then((tasks) => {
			if (tasks.length > 0) {
				let { defaults, users } = this.splitPerGroupType(tasks);
				if (defaults.length === 1) {
					this.run(defaults[0]);
					return;
				} else if (defaults.length + users.length > 0) {
					tasks = defaults.concat(users);
				}
			}
			this.showIgnoredFoldersMessage().then(() => {
				this.showQuickPick(tasks,
					nls.localize('TaskService.pickBuildTask', 'Select the build task to run'),
					{
						label: nls.localize('TaskService.noBuildTask', 'No build task to run found. Configure Build Task...'),
						task: null
					},
					true).then((task) => {
						if (task === void 0) {
							return;
						}
						if (task === null) {
							this.runConfigureDefaultBuildTask();
							return;
						}
						this.run(task, { attachProblemMatcher: true });
					});
			});
		});
		this.progressService.withProgress(options, () => promise);
	}

	private runTestCommand(): void {
		if (!this.canRunCommand()) {
			return;
		}
		if (this.schemaVersion === JsonSchemaVersion.V0_1_0) {
			this.runTest();
			return;
		}
		let options: IProgressOptions = {
			location: ProgressLocation.Window,
			title: nls.localize('TaskService.fetchingTestTasks', 'Fetching test tasks...')
		};
		let promise = this.getTasksForGroup(TaskGroup.Test).then((tasks) => {
			if (tasks.length > 0) {
				let { defaults, users } = this.splitPerGroupType(tasks);
				if (defaults.length === 1) {
					this.run(defaults[0]);
					return;
				} else if (defaults.length + users.length > 0) {
					tasks = defaults.concat(users);
				}
			}
			this.showIgnoredFoldersMessage().then(() => {
				this.showQuickPick(tasks,
					nls.localize('TaskService.pickTestTask', 'Select the test task to run'),
					{
						label: nls.localize('TaskService.noTestTaskTerminal', 'No test task to run found. Configure Tasks...'),
						task: null
					}, true
				).then((task) => {
					if (task === void 0) {
						return;
					}
					if (task === null) {
						this.runConfigureTasks();
						return;
					}
					this.run(task);
				});
			});
		});
		this.progressService.withProgress(options, () => promise);
	}

	private runTerminateCommand(arg?: any): void {
		if (!this.canRunCommand()) {
			return;
		}
		let runQuickPick = (promise?: TPromise<Task[]>) => {
			this.showQuickPick(promise || this.getActiveTasks(),
				nls.localize('TaskService.tastToTerminate', 'Select task to terminate'),
				{
					label: nls.localize('TaskService.noTaskRunning', 'No task is currently running'),
					task: null
				},
				false, true
			).then(task => {
				if (task === void 0 || task === null) {
					return;
				}
				this.terminate(task);
			});
		};
		if (this.inTerminal()) {
			let identifier = this.getTaskIdentifier(arg);
			let promise: TPromise<Task[]>;
			if (identifier !== void 0) {
				promise = this.getActiveTasks();
				promise.then((tasks) => {
					for (let task of tasks) {
						if (Task.matches(task, identifier)) {
							this.terminate(task);
							return;
						}
					}
					runQuickPick(promise);
				});
			} else {
				runQuickPick();
			}
		} else {
			this.isActive().then((active) => {
				if (active) {
					this.terminateAll().then((responses) => {
						// the output runner has only one task
						let response = responses[0];
						if (response.success) {
							return;
						}
						if (response.code && response.code === TerminateResponseCode.ProcessNotFound) {
							this.notificationService.error(nls.localize('TerminateAction.noProcess', 'The launched process doesn\'t exist anymore. If the task spawned background tasks exiting VS Code might result in orphaned processes.'));
						} else {
							this.notificationService.error(nls.localize('TerminateAction.failed', 'Failed to terminate running task'));
						}
					});
				}
			});
		}
	}

	private runRestartTaskCommand(arg?: any): void {
		if (!this.canRunCommand()) {
			return;
		}
		let runQuickPick = (promise?: TPromise<Task[]>) => {
			this.showQuickPick(promise || this.getActiveTasks(),
				nls.localize('TaskService.tastToRestart', 'Select the task to restart'),
				{
					label: nls.localize('TaskService.noTaskToRestart', 'No task to restart'),
					task: null
				},
				false, true
			).then(task => {
				if (task === void 0 || task === null) {
					return;
				}
				this.restart(task);
			});
		};
		if (this.inTerminal()) {
			let identifier = this.getTaskIdentifier(arg);
			let promise: TPromise<Task[]>;
			if (identifier !== void 0) {
				promise = this.getActiveTasks();
				promise.then((tasks) => {
					for (let task of tasks) {
						if (Task.matches(task, identifier)) {
							this.restart(task);
							return;
						}
					}
					runQuickPick(promise);
				});
			} else {
				runQuickPick();
			}
		} else {
			this.getActiveTasks().then((activeTasks) => {
				if (activeTasks.length === 0) {
					return;
				}
				let task = activeTasks[0];
				this.restart(task);
			});
		}
	}

	private getTaskIdentifier(arg?: any): string | KeyedTaskIdentifier | undefined {
		let result: string | KeyedTaskIdentifier = undefined;
		if (Types.isString(arg)) {
			result = arg;
		} else if (arg && Types.isString((arg as TaskIdentifier).type)) {
			result = TaskDefinition.createTaskIdentifier(arg as TaskIdentifier, console);
		}
		return result;
	}

	private runConfigureTasks(): void {
		if (!this.canRunCommand()) {
			return undefined;
		}
		let taskPromise: TPromise<TaskMap>;
		if (this.schemaVersion === JsonSchemaVersion.V2_0_0) {
			taskPromise = this.getGroupedTasks();
		} else {
			taskPromise = TPromise.as(new TaskMap());
		}

		let openTaskFile = (workspaceFolder: IWorkspaceFolder): void => {
			let resource = workspaceFolder.toResource('.vscode/tasks.json');
			let configFileCreated = false;
			this.fileService.resolveFile(resource).then((stat) => stat, () => undefined).then((stat) => {
				if (stat) {
					return stat.resource;
				}
				return this.quickInputService.pick(getTaskTemplates(), { placeHolder: nls.localize('TaskService.template', 'Select a Task Template') }).then((selection) => {
					if (!selection) {
						return undefined;
					}
					let content = selection.content;
					let editorConfig = this.configurationService.getValue<any>();
					if (editorConfig.editor.insertSpaces) {
						content = content.replace(/(\n)(\t+)/g, (_, s1, s2) => s1 + strings.repeat(' ', s2.length * editorConfig.editor.tabSize));
					}
					configFileCreated = true;
					/* __GDPR__
						"taskService.template" : {
							"templateId" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" },
							"autoDetect" : { "classification": "SystemMetaData", "purpose": "FeatureInsight", "isMeasurement": true }
						}
					*/
					return this.fileService.createFile(resource, content).then((result): URI => {
						this.telemetryService.publicLog(TaskService.TemplateTelemetryEventName, {
							templateId: selection.id,
							autoDetect: selection.autoDetect
						});
						return result.resource;
					});
				});
			}).then((resource) => {
				if (!resource) {
					return;
				}
				this.editorService.openEditor({
					resource,
					options: {
						pinned: configFileCreated // pin only if config file is created #8727
					}
				});
			});
		};

		let configureTask = (task: Task): void => {
			if (ContributedTask.is(task)) {
				this.customize(task, undefined, true);
			} else if (CustomTask.is(task)) {
				this.openConfig(task);
			} else if (ConfiguringTask.is(task)) {
				// Do nothing.
			}
		};

		function isTaskEntry(value: IQuickPickItem): value is IQuickPickItem & { task: Task } {
			let candidate: IQuickPickItem & { task: Task } = value as any;
			return candidate && !!candidate.task;
		}

		let stats = this.contextService.getWorkspace().folders.map<TPromise<IFileStat>>((folder) => {
			return this.fileService.resolveFile(folder.toResource('.vscode/tasks.json')).then(stat => stat, () => undefined);
		});

		let createLabel = nls.localize('TaskService.createJsonFile', 'Create tasks.json file from template');
		let openLabel = nls.localize('TaskService.openJsonFile', 'Open tasks.json file');
		let entries = TPromise.join(stats).then((stats) => {
			return taskPromise.then((taskMap) => {
				type EntryType = (IQuickPickItem & { task: Task; }) | (IQuickPickItem & { folder: IWorkspaceFolder; });
				let entries: QuickPickInput<EntryType>[] = [];
				if (this.contextService.getWorkbenchState() === WorkbenchState.FOLDER) {
					let tasks = taskMap.all();
					let needsCreateOrOpen: boolean = true;
					if (tasks.length > 0) {
						tasks = tasks.sort((a, b) => a._label.localeCompare(b._label));
						for (let task of tasks) {
							entries.push({ label: task._label, task });
							if (!ContributedTask.is(task)) {
								needsCreateOrOpen = false;
							}
						}
					}
					if (needsCreateOrOpen) {
						let label = stats[0] !== void 0 ? openLabel : createLabel;
						if (entries.length) {
							entries.push({ type: 'separator' });
						}
						entries.push({ label, folder: this.contextService.getWorkspace().folders[0] });
					}
				} else {
					let folders = this.contextService.getWorkspace().folders;
					let index = 0;
					for (let folder of folders) {
						let tasks = taskMap.get(folder);
						if (tasks.length > 0) {
							tasks = tasks.slice().sort((a, b) => a._label.localeCompare(b._label));
							for (let i = 0; i < tasks.length; i++) {
								let entry: EntryType = { label: tasks[i]._label, task: tasks[i], description: folder.name };
								if (i === 0) {
									entries.push({ type: 'separator', label: folder.name });
								}
								entries.push(entry);
							}
						} else {
							let label = stats[index] !== void 0 ? openLabel : createLabel;
							let entry: EntryType = { label, folder: folder };
							entries.push({ type: 'separator', label: folder.name });
							entries.push(entry);
						}
						index++;
					}
				}
				return entries;
			});
		});

		this.quickInputService.pick(entries,
			{ placeHolder: nls.localize('TaskService.pickTask', 'Select a task to configure') }).
			then((selection) => {
				if (!selection) {
					return;
				}
				if (isTaskEntry(selection)) {
					configureTask(selection.task);
				} else {
					openTaskFile(selection.folder);
				}
			});
	}

	private runConfigureDefaultBuildTask(): void {
		if (!this.canRunCommand()) {
			return;
		}
		if (this.schemaVersion === JsonSchemaVersion.V2_0_0) {
			this.tasks().then((tasks => {
				if (tasks.length === 0) {
					this.runConfigureTasks();
					return;
				}
				let selectedTask: Task;
				let selectedEntry: TaskQuickPickEntry;
				for (let task of tasks) {
					if (task.group === TaskGroup.Build && task.groupType === GroupType.default) {
						selectedTask = task;
						break;
					}
				}
				if (selectedTask) {
					selectedEntry = {
						label: nls.localize('TaskService.defaultBuildTaskExists', '{0} is already marked as the default build task', Task.getQualifiedLabel(selectedTask)),
						task: selectedTask
					};
				}
				this.showIgnoredFoldersMessage().then(() => {
					this.showQuickPick(tasks,
						nls.localize('TaskService.pickDefaultBuildTask', 'Select the task to be used as the default build task'), undefined, true, false, selectedEntry).
						then((task) => {
							if (task === void 0) {
								return;
							}
							if (task === selectedTask && CustomTask.is(task)) {
								this.openConfig(task);
							}
							if (!InMemoryTask.is(task)) {
								this.customize(task, { group: { kind: 'build', isDefault: true } }, true).then(() => {
									if (selectedTask && (task !== selectedTask) && !InMemoryTask.is(selectedTask)) {
										this.customize(selectedTask, { group: 'build' }, true);
									}
								});
							}
						});
				});
			}));
		} else {
			this.runConfigureTasks();
		}
	}

	private runConfigureDefaultTestTask(): void {
		if (!this.canRunCommand()) {
			return;
		}
		if (this.schemaVersion === JsonSchemaVersion.V2_0_0) {
			this.tasks().then((tasks => {
				if (tasks.length === 0) {
					this.runConfigureTasks();
					return;
				}
				let selectedTask: Task;
				let selectedEntry: TaskQuickPickEntry;

				for (let task of tasks) {
					if (task.group === TaskGroup.Test && task.groupType === GroupType.default) {
						selectedTask = task;
						break;
					}
				}
				if (selectedTask) {
					selectedEntry = {
						label: nls.localize('TaskService.defaultTestTaskExists', '{0} is already marked as the default test task.', Task.getQualifiedLabel(selectedTask)),
						task: selectedTask
					};
				}

				this.showIgnoredFoldersMessage().then(() => {
					this.showQuickPick(tasks,
						nls.localize('TaskService.pickDefaultTestTask', 'Select the task to be used as the default test task'), undefined, true, false, selectedEntry).then((task) => {
							if (!task) {
								return;
							}
							if (task === selectedTask && CustomTask.is(task)) {
								this.openConfig(task);
							}
							if (!InMemoryTask.is(task)) {
								this.customize(task, { group: { kind: 'test', isDefault: true } }, true).then(() => {
									if (selectedTask && (task !== selectedTask) && !InMemoryTask.is(selectedTask)) {
										this.customize(selectedTask, { group: 'test' }, true);
									}
								});
							}
						});
				});
			}));
		} else {
			this.runConfigureTasks();
		}
	}

	public runShowTasks(): void {
		if (!this.canRunCommand()) {
			return;
		}
		this.showQuickPick(this.getActiveTasks(),
			nls.localize('TaskService.pickShowTask', 'Select the task to show its output'),
			{
				label: nls.localize('TaskService.noTaskIsRunning', 'No task is running'),
				task: null
			},
			false, true
		).then((task) => {
			if (task === void 0 || task === null) {
				return;
			}
			this._taskSystem.revealTask(task);
		});
	}
}

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
	group: '2_run',
	command: {
		id: 'workbench.action.tasks.runTask',
		title: nls.localize({ key: 'miRunTask', comment: ['&& denotes a mnemonic'] }, "&&Run Task...")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
	group: '2_run',
	command: {
		id: 'workbench.action.tasks.build',
		title: nls.localize({ key: 'miBuildTask', comment: ['&& denotes a mnemonic'] }, "Run &&Build Task...")
	},
	order: 2
});

// Manage Tasks
MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
	group: '3_manage',
	command: {
		precondition: TASK_RUNNING_STATE,
		id: 'workbench.action.tasks.showTasks',
		title: nls.localize({ key: 'miRunningTask', comment: ['&& denotes a mnemonic'] }, "Show Runnin&&g Tasks...")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
	group: '3_manage',
	command: {
		precondition: TASK_RUNNING_STATE,
		id: 'workbench.action.tasks.restartTask',
		title: nls.localize({ key: 'miRestartTask', comment: ['&& denotes a mnemonic'] }, "R&&estart Running Task...")
	},
	order: 2
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
	group: '3_manage',
	command: {
		precondition: TASK_RUNNING_STATE,
		id: 'workbench.action.tasks.terminate',
		title: nls.localize({ key: 'miTerminateTask', comment: ['&& denotes a mnemonic'] }, "&&Terminate Task...")
	},
	order: 3
});

// Configure Tasks
MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
	group: '4_configure',
	command: {
		id: 'workbench.action.tasks.configureTaskRunner',
		title: nls.localize({ key: 'miConfigureTask', comment: ['&& denotes a mnemonic'] }, "&&Configure Tasks...")
	},
	order: 1
});

MenuRegistry.appendMenuItem(MenuId.MenubarTerminalMenu, {
	group: '4_configure',
	command: {
		id: 'workbench.action.tasks.configureDefaultBuildTask',
		title: nls.localize({ key: 'miConfigureBuildTask', comment: ['&& denotes a mnemonic'] }, "Configure De&&fault Build Task...")
	},
	order: 2
});


MenuRegistry.addCommand({ id: ConfigureTaskAction.ID, title: { value: ConfigureTaskAction.TEXT, original: 'Configure Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.showLog', title: { value: nls.localize('ShowLogAction.label', "Show Task Log"), original: 'Show Task Log' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.runTask', title: { value: nls.localize('RunTaskAction.label', "Run Task"), original: 'Run Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.restartTask', title: { value: nls.localize('RestartTaskAction.label', "Restart Running Task"), original: 'Restart Running Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.showTasks', title: { value: nls.localize('ShowTasksAction.label', "Show Running Tasks"), original: 'Show Running Tasks' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.terminate', title: { value: nls.localize('TerminateAction.label', "Terminate Task"), original: 'Terminate Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.build', title: { value: nls.localize('BuildAction.label', "Run Build Task"), original: 'Run Build Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.test', title: { value: nls.localize('TestAction.label', "Run Test Task"), original: 'Run Test Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.configureDefaultBuildTask', title: { value: nls.localize('ConfigureDefaultBuildTask.label', "Configure Default Build Task"), original: 'Configure Default Build Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.configureDefaultTestTask', title: { value: nls.localize('ConfigureDefaultTestTask.label', "Configure Default Test Task"), original: 'Configure Default Test Task' }, category: { value: tasksCategory, original: 'Tasks' } });
// MenuRegistry.addCommand( { id: 'workbench.action.tasks.rebuild', title: nls.localize('RebuildAction.label', 'Run Rebuild Task'), category: tasksCategory });
// MenuRegistry.addCommand( { id: 'workbench.action.tasks.clean', title: nls.localize('CleanAction.label', 'Run Clean Task'), category: tasksCategory });

// Tasks Output channel. Register it before using it in Task Service.
let outputChannelRegistry = Registry.as<IOutputChannelRegistry>(OutputExt.OutputChannels);
outputChannelRegistry.registerChannel({ id: TaskService.OutputChannelId, label: TaskService.OutputChannelLabel, log: false });

// Task Service
registerSingleton(ITaskService, TaskService, true);

// Register Quick Open
const quickOpenRegistry = (Registry.as<IQuickOpenRegistry>(QuickOpenExtensions.Quickopen));
const tasksPickerContextKey = 'inTasksPicker';

quickOpenRegistry.registerQuickOpenHandler(
	new QuickOpenHandlerDescriptor(
		QuickOpenHandler,
		QuickOpenHandler.ID,
		'task ',
		tasksPickerContextKey,
		nls.localize('quickOpen.task', "Run Task")
	)
);

const actionBarRegistry = Registry.as<IActionBarRegistry>(ActionBarExtensions.Actionbar);
actionBarRegistry.registerActionBarContributor(Scope.VIEWER, QuickOpenActionContributor);

// Status bar
let statusbarRegistry = Registry.as<IStatusbarRegistry>(StatusbarExtensions.Statusbar);
statusbarRegistry.registerStatusbarItem(new StatusbarItemDescriptor(BuildStatusBarItem, StatusbarAlignment.LEFT, 50 /* Medium Priority */));
statusbarRegistry.registerStatusbarItem(new StatusbarItemDescriptor(TaskStatusBarItem, StatusbarAlignment.LEFT, 50 /* Medium Priority */));

// tasks.json validation
let schemaId = 'vscode://schemas/tasks';
let schema: IJSONSchema = {
	id: schemaId,
	description: 'Task definition file',
	type: 'object',
	default: {
		version: '0.1.0',
		command: 'myCommand',
		isShellCommand: false,
		args: [],
		showOutput: 'always',
		tasks: [
			{
				taskName: 'build',
				showOutput: 'silent',
				isBuildCommand: true,
				problemMatcher: ['$tsc', '$lessCompile']
			}
		]
	}
};

import schemaVersion1 from './jsonSchema_v1';
import schemaVersion2 from './jsonSchema_v2';
schema.definitions = {
	...schemaVersion1.definitions,
	...schemaVersion2.definitions,
};
schema.oneOf = [...schemaVersion2.oneOf, ...schemaVersion1.oneOf];

let jsonRegistry = <jsonContributionRegistry.IJSONContributionRegistry>Registry.as(jsonContributionRegistry.Extensions.JSONContribution);
jsonRegistry.registerSchema(schemaId, schema);
