/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import Severity from 'vs/base/common/severity';
import * as Objects from 'vs/base/common/objects';
import * as resources from 'vs/base/common/resources';
import * as json from 'vs/base/common/json';
import { URI } from 'vs/base/common/uri';
import { IStringDictionary } from 'vs/base/common/collections';
import { Action } from 'vs/base/common/actions';
import { IDisposable, Disposable, IReference } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import * as Types from 'vs/base/common/types';
import { TerminateResponseCode } from 'vs/base/common/processes';
import { ValidationStatus, ValidationState } from 'vs/base/common/parsers';
import * as UUID from 'vs/base/common/uuid';
import * as Platform from 'vs/base/common/platform';
import { LRUCache, Touch } from 'vs/base/common/map';
import { IMarkerService } from 'vs/platform/markers/common/markers';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IFileService, IFileStat } from 'vs/platform/files/common/files';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { CommandsRegistry, ICommandService } from 'vs/platform/commands/common/commands';
import { ProblemMatcherRegistry, NamedProblemMatcher } from 'vs/workbench/contrib/tasks/common/problemMatcher';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { IProgressService, IProgressOptions, ProgressLocation } from 'vs/platform/progress/common/progress';

import { IOpenerService } from 'vs/platform/opener/common/opener';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';

import { IModelService } from 'vs/editor/common/services/modelService';

import { IPanelService } from 'vs/workbench/services/panel/common/panelService';
import Constants from 'vs/workbench/contrib/markers/browser/constants';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { IWorkspaceContextService, WorkbenchState, IWorkspaceFolder, IWorkspace, WorkspaceFolder } from 'vs/platform/workspace/common/workspace';

import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IOutputService, IOutputChannel } from 'vs/workbench/contrib/output/common/output';

import { ITerminalGroupService, ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { ITerminalProfileResolverService } from 'vs/workbench/contrib/terminal/common/terminal';

import { ITaskSystem, ITaskResolver, ITaskSummary, TaskExecuteKind, TaskError, TaskErrors, TaskTerminateResponse, TaskSystemInfo, ITaskExecuteResult } from 'vs/workbench/contrib/tasks/common/taskSystem';
import {
	Task, CustomTask, ConfiguringTask, ContributedTask, InMemoryTask, TaskEvent,
	TaskSet, TaskGroup, GroupType, ExecutionEngine, JsonSchemaVersion, TaskSourceKind,
	TaskSorter, TaskIdentifier, KeyedTaskIdentifier, TASK_RUNNING_STATE, TaskRunSource,
	KeyedTaskIdentifier as NKeyedTaskIdentifier, TaskDefinition, RuntimeType
} from 'vs/workbench/contrib/tasks/common/tasks';
import { ITaskService, ITaskProvider, ProblemMatcherRunOptions, CustomizationProperties, TaskFilter, WorkspaceFolderTaskResult, USER_TASKS_GROUP_KEY, CustomExecutionSupportedContext, ShellExecutionSupportedContext, ProcessExecutionSupportedContext } from 'vs/workbench/contrib/tasks/common/taskService';
import { getTemplates as getTaskTemplates } from 'vs/workbench/contrib/tasks/common/taskTemplates';

import * as TaskConfig from '../common/taskConfiguration';
import { TerminalTaskSystem } from './terminalTaskSystem';

import { IQuickInputService, IQuickPickItem, QuickPickInput, IQuickPick } from 'vs/platform/quickinput/common/quickInput';

import { TaskDefinitionRegistry } from 'vs/workbench/contrib/tasks/common/taskDefinitionRegistry';
import { IContextKey, IContextKeyService } from 'vs/platform/contextkey/common/contextkey';
import { RunAutomaticTasks } from 'vs/workbench/contrib/tasks/browser/runAutomaticTasks';

import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { format } from 'vs/base/common/jsonFormatter';
import { ITextModelService, IResolvedTextEditorModel } from 'vs/editor/common/services/resolverService';
import { applyEdits } from 'vs/base/common/jsonEdit';
import { SaveReason } from 'vs/workbench/common/editor';
import { ITextEditorSelection, TextEditorSelectionRevealType } from 'vs/platform/editor/common/editor';
import { IPreferencesService } from 'vs/workbench/services/preferences/common/preferences';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { IViewsService, IViewDescriptorService } from 'vs/workbench/common/views';
import { isWorkspaceFolder, TaskQuickPickEntry, QUICKOPEN_DETAIL_CONFIG, TaskQuickPick, QUICKOPEN_SKIP_CONFIG, configureTaskIcon } from 'vs/workbench/contrib/tasks/browser/taskQuickPick';
import { ILogService } from 'vs/platform/log/common/log';
import { once } from 'vs/base/common/functional';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { IWorkspaceTrustManagementService, IWorkspaceTrustRequestService } from 'vs/platform/workspace/common/workspaceTrust';
import { VirtualWorkspaceContext } from 'vs/workbench/browser/contextkeys';
import { Schemas } from 'vs/base/common/network';

const QUICKOPEN_HISTORY_LIMIT_CONFIG = 'task.quickOpen.history';
const PROBLEM_MATCHER_NEVER_CONFIG = 'task.problemMatchers.neverPrompt';
const USE_SLOW_PICKER = 'task.quickOpen.showAll';

export namespace ConfigureTaskAction {
	export const ID = 'workbench.action.tasks.configureTaskRunner';
	export const TEXT = nls.localize('ConfigureTaskRunnerAction.label', "Configure Task");
}

type TaskQuickPickEntryType = (IQuickPickItem & { task: Task; }) | (IQuickPickItem & { folder: IWorkspaceFolder; }) | (IQuickPickItem & { settingType: string; });

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

export interface WorkspaceFolderConfigurationResult {
	workspaceFolder: IWorkspaceFolder;
	config: TaskConfig.ExternalTaskRunnerConfiguration | undefined;
	hasErrors: boolean;
}

interface TaskCustomizationTelemetryEvent {
	properties: string[];
}

interface CommandUpgrade {
	command?: string;
	args?: string[];
}

class TaskMap {
	private _store: Map<string, Task[]> = new Map();

	public forEach(callback: (value: Task[], folder: string) => void): void {
		this._store.forEach(callback);
	}

	private getKey(workspaceFolder: IWorkspace | IWorkspaceFolder | string): string {
		let key: string | undefined;
		if (Types.isString(workspaceFolder)) {
			key = workspaceFolder;
		} else {
			const uri: URI | null | undefined = isWorkspaceFolder(workspaceFolder) ? workspaceFolder.uri : workspaceFolder.configuration;
			key = uri ? uri.toString() : '';
		}
		return key;
	}

	public get(workspaceFolder: IWorkspace | IWorkspaceFolder | string): Task[] {
		const key = this.getKey(workspaceFolder);
		let result: Task[] | undefined = this._store.get(key);
		if (!result) {
			result = [];
			this._store.set(key, result);
		}
		return result;
	}

	public add(workspaceFolder: IWorkspace | IWorkspaceFolder | string, ...task: Task[]): void {
		const key = this.getKey(workspaceFolder);
		let values = this._store.get(key);
		if (!values) {
			values = [];
			this._store.set(key, values);
		}
		values.push(...task);
	}

	public all(): Task[] {
		let result: Task[] = [];
		this._store.forEach((values) => result.push(...values));
		return result;
	}
}

interface ProblemMatcherDisableMetrics {
	type: string;
}
type ProblemMatcherDisableMetricsClassification = {
	type: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

export abstract class AbstractTaskService extends Disposable implements ITaskService {

	// private static autoDetectTelemetryName: string = 'taskServer.autoDetect';
	private static readonly RecentlyUsedTasks_Key = 'workbench.tasks.recentlyUsedTasks';
	private static readonly RecentlyUsedTasks_KeyV2 = 'workbench.tasks.recentlyUsedTasks2';
	private static readonly IgnoreTask010DonotShowAgain_key = 'workbench.tasks.ignoreTask010Shown';

	private static CustomizationTelemetryEventName: string = 'taskService.customize';
	public _serviceBrand: undefined;
	public static OutputChannelId: string = 'tasks';
	public static OutputChannelLabel: string = nls.localize('tasks', "Tasks");

	private static nextHandle: number = 0;

	private _schemaVersion: JsonSchemaVersion | undefined;
	private _executionEngine: ExecutionEngine | undefined;
	private _workspaceFolders: IWorkspaceFolder[] | undefined;
	private _workspace: IWorkspace | undefined;
	private _ignoredWorkspaceFolders: IWorkspaceFolder[] | undefined;
	private _showIgnoreMessage?: boolean;
	private _providers: Map<number, ITaskProvider>;
	private _providerTypes: Map<number, string>;
	protected _taskSystemInfos: Map<string, TaskSystemInfo>;

	protected _workspaceTasksPromise?: Promise<Map<string, WorkspaceFolderTaskResult>>;

	protected _taskSystem?: ITaskSystem;
	protected _taskSystemListener?: IDisposable;
	private _recentlyUsedTasksV1: LRUCache<string, string> | undefined;
	private _recentlyUsedTasks: LRUCache<string, string> | undefined;

	protected _taskRunningState: IContextKey<boolean>;

	protected _outputChannel: IOutputChannel;
	protected readonly _onDidStateChange: Emitter<TaskEvent>;
	private _waitForSupportedExecutions: Promise<void>;
	private _onDidRegisterSupportedExecutions: Emitter<void> = new Emitter();
	private _onDidChangeTaskSystemInfo: Emitter<void> = new Emitter();
	public onDidChangeTaskSystemInfo: Event<void> = this._onDidChangeTaskSystemInfo.event;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IMarkerService protected readonly markerService: IMarkerService,
		@IOutputService protected readonly outputService: IOutputService,
		@IPanelService private readonly panelService: IPanelService,
		@IViewsService private readonly viewsService: IViewsService,
		@ICommandService private readonly commandService: ICommandService,
		@IEditorService private readonly editorService: IEditorService,
		@IFileService protected readonly fileService: IFileService,
		@IWorkspaceContextService protected readonly contextService: IWorkspaceContextService,
		@ITelemetryService protected readonly telemetryService: ITelemetryService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IModelService protected readonly modelService: IModelService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IConfigurationResolverService protected readonly configurationResolverService: IConfigurationResolverService,
		@ITerminalService private readonly terminalService: ITerminalService,
		@ITerminalGroupService private readonly terminalGroupService: ITerminalGroupService,
		@IStorageService private readonly storageService: IStorageService,
		@IProgressService private readonly progressService: IProgressService,
		@IOpenerService private readonly openerService: IOpenerService,
		@IDialogService protected readonly dialogService: IDialogService,
		@INotificationService private readonly notificationService: INotificationService,
		@IContextKeyService protected readonly contextKeyService: IContextKeyService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@ITerminalProfileResolverService private readonly terminalProfileResolverService: ITerminalProfileResolverService,
		@IPathService private readonly pathService: IPathService,
		@ITextModelService private readonly textModelResolverService: ITextModelService,
		@IPreferencesService private readonly preferencesService: IPreferencesService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IWorkspaceTrustRequestService private readonly workspaceTrustRequestService: IWorkspaceTrustRequestService,
		@IWorkspaceTrustManagementService private readonly workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this._workspaceTasksPromise = undefined;
		this._taskSystem = undefined;
		this._taskSystemListener = undefined;
		this._outputChannel = this.outputService.getChannel(AbstractTaskService.OutputChannelId)!;
		this._providers = new Map<number, ITaskProvider>();
		this._providerTypes = new Map<number, string>();
		this._taskSystemInfos = new Map<string, TaskSystemInfo>();
		this._register(this.contextService.onDidChangeWorkspaceFolders(() => {
			let folderSetup = this.computeWorkspaceFolderSetup();
			if (this.executionEngine !== folderSetup[2]) {
				this.disposeTaskSystemListeners();
				this._taskSystem = undefined;
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

			this.setTaskLRUCacheLimit();
			this.updateWorkspaceTasks(TaskRunSource.ConfigurationChange);
		}));
		this._taskRunningState = TASK_RUNNING_STATE.bindTo(contextKeyService);
		this._onDidStateChange = this._register(new Emitter());
		this.registerCommands();
		this.configurationResolverService.contributeVariable('defaultBuildTask', async (): Promise<string | undefined> => {
			let tasks = await this.getTasksForGroup(TaskGroup.Build);
			if (tasks.length > 0) {
				let { defaults, users } = this.splitPerGroupType(tasks);
				if (defaults.length === 1) {
					return defaults[0]._label;
				} else if (defaults.length + users.length > 0) {
					tasks = defaults.concat(users);
				}
			}

			let entry: TaskQuickPickEntry | null | undefined;
			if (tasks && tasks.length > 0) {
				entry = await this.showQuickPick(tasks, nls.localize('TaskService.pickBuildTaskForLabel', 'Select the build task (there is no default build task defined)'));
			}

			let task: Task | undefined | null = entry ? entry.task : undefined;
			if (!task) {
				return undefined;
			}
			return task._label;
		});

		this._waitForSupportedExecutions = new Promise(resolve => {
			once(this._onDidRegisterSupportedExecutions.event)(() => resolve());
		});
		this.upgrade();
	}

	public registerSupportedExecutions(custom?: boolean, shell?: boolean, process?: boolean) {
		if (custom !== undefined) {
			const customContext = CustomExecutionSupportedContext.bindTo(this.contextKeyService);
			customContext.set(custom);
		}
		const isVirtual = !!VirtualWorkspaceContext.getValue(this.contextKeyService);
		if (shell !== undefined) {
			const shellContext = ShellExecutionSupportedContext.bindTo(this.contextKeyService);
			shellContext.set(shell && !isVirtual);
		}
		if (process !== undefined) {
			const processContext = ProcessExecutionSupportedContext.bindTo(this.contextKeyService);
			processContext.set(process && !isVirtual);
		}
		this._onDidRegisterSupportedExecutions.fire();
	}

	public get onDidStateChange(): Event<TaskEvent> {
		return this._onDidStateChange.event;
	}

	public get supportsMultipleTaskExecutions(): boolean {
		return this.inTerminal();
	}

	private registerCommands(): void {
		CommandsRegistry.registerCommand({
			id: 'workbench.action.tasks.runTask',
			handler: async (accessor, arg) => {
				if (await this.trust()) {
					this.runTaskCommand(arg);
				}
			},
			description: {
				description: 'Run Task',
				args: [{
					name: 'args',
					schema: {
						'type': 'string',
					}
				}]
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.reRunTask', async (accessor, arg) => {
			if (await this.trust()) {
				this.reRunTaskCommand();
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.restartTask', async (accessor, arg) => {
			if (await this.trust()) {
				this.runRestartTaskCommand(arg);
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.terminate', async (accessor, arg) => {
			if (await this.trust()) {
				this.runTerminateCommand(arg);
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.showLog', () => {
			if (!this.canRunCommand()) {
				return;
			}
			this.showOutput();
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.build', async () => {
			if (!this.canRunCommand()) {
				return;
			}
			if (await this.trust()) {
				this.runBuildCommand();
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.test', async () => {
			if (!this.canRunCommand()) {
				return;
			}
			if (await this.trust()) {
				this.runTestCommand();
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.configureTaskRunner', async () => {
			if (await this.trust()) {
				this.runConfigureTasks();
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.configureDefaultBuildTask', async (accessor, arg) => {
			if (await this.trust()) {
				this.runConfigureDefaultBuildTask(arg);
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.configureDefaultTestTask', async () => {
			if (await this.trust()) {
				this.runConfigureDefaultTestTask();
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.showTasks', async () => {
			if (await this.trust()) {
				return this.runShowTasks();
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.toggleProblems', () => this.commandService.executeCommand(Constants.TOGGLE_MARKERS_VIEW_ACTION_ID));

		CommandsRegistry.registerCommand('workbench.action.tasks.openUserTasks', async () => {
			const resource = this.getResourceForKind(TaskSourceKind.User);
			if (resource) {
				this.openTaskFile(resource, TaskSourceKind.User);
			}
		});

		CommandsRegistry.registerCommand('workbench.action.tasks.openWorkspaceFileTasks', async () => {
			const resource = this.getResourceForKind(TaskSourceKind.WorkspaceFile);
			if (resource) {
				this.openTaskFile(resource, TaskSourceKind.WorkspaceFile);
			}
		});
	}

	private get workspaceFolders(): IWorkspaceFolder[] {
		if (!this._workspaceFolders) {
			this.updateSetup();
		}
		return this._workspaceFolders!;
	}

	private get ignoredWorkspaceFolders(): IWorkspaceFolder[] {
		if (!this._ignoredWorkspaceFolders) {
			this.updateSetup();
		}
		return this._ignoredWorkspaceFolders!;
	}

	protected get executionEngine(): ExecutionEngine {
		if (this._executionEngine === undefined) {
			this.updateSetup();
		}
		return this._executionEngine!;
	}

	private get schemaVersion(): JsonSchemaVersion {
		if (this._schemaVersion === undefined) {
			this.updateSetup();
		}
		return this._schemaVersion!;
	}

	private get showIgnoreMessage(): boolean {
		if (this._showIgnoreMessage === undefined) {
			this._showIgnoreMessage = !this.storageService.getBoolean(AbstractTaskService.IgnoreTask010DonotShowAgain_key, StorageScope.WORKSPACE, false);
		}
		return this._showIgnoreMessage;
	}

	private updateSetup(setup?: [IWorkspaceFolder[], IWorkspaceFolder[], ExecutionEngine, JsonSchemaVersion, IWorkspace | undefined]): void {
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
		this._workspace = setup[4];
	}

	protected showOutput(runSource: TaskRunSource = TaskRunSource.User): void {
		if (!VirtualWorkspaceContext.getValue(this.contextKeyService) && ((runSource === TaskRunSource.User) || (runSource === TaskRunSource.ConfigurationChange))) {
			this.notificationService.prompt(Severity.Warning, nls.localize('taskServiceOutputPrompt', 'There are task errors. See the output for details.'),
				[{
					label: nls.localize('showOutput', "Show output"),
					run: () => {
						this.outputService.showChannel(this._outputChannel.id, true);
					}
				}]);
		}
	}

	protected disposeTaskSystemListeners(): void {
		if (this._taskSystemListener) {
			this._taskSystemListener.dispose();
		}
	}

	public registerTaskProvider(provider: ITaskProvider, type: string): IDisposable {
		if (!provider) {
			return {
				dispose: () => { }
			};
		}
		let handle = AbstractTaskService.nextHandle++;
		this._providers.set(handle, provider);
		this._providerTypes.set(handle, type);
		return {
			dispose: () => {
				this._providers.delete(handle);
				this._providerTypes.delete(handle);
			}
		};
	}

	get hasTaskSystemInfo(): boolean {
		return this._taskSystemInfos.size > 0;
	}

	public registerTaskSystem(key: string, info: TaskSystemInfo): void {
		if (!this._taskSystemInfos.has(key) || info.platform !== Platform.Platform.Web) {
			this._taskSystemInfos.set(key, info);
			this._onDidChangeTaskSystemInfo.fire();
		}
	}

	private getTaskSystemInfo(key: string): TaskSystemInfo | undefined {
		return this._taskSystemInfos.get(key);
	}

	public extensionCallbackTaskComplete(task: Task, result: number): Promise<void> {
		if (!this._taskSystem) {
			return Promise.resolve();
		}
		return this._taskSystem.customExecutionComplete(task, result);
	}

	public async getTask(folder: IWorkspace | IWorkspaceFolder | string, identifier: string | TaskIdentifier, compareId: boolean = false): Promise<Task | undefined> {
		if (!(await this.trust())) {
			return;
		}
		const name = Types.isString(folder) ? folder : isWorkspaceFolder(folder) ? folder.name : folder.configuration ? resources.basename(folder.configuration) : undefined;
		if (this.ignoredWorkspaceFolders.some(ignored => ignored.name === name)) {
			return Promise.reject(new Error(nls.localize('TaskServer.folderIgnored', 'The folder {0} is ignored since it uses task version 0.1.0', name)));
		}
		const key: string | KeyedTaskIdentifier | undefined = !Types.isString(identifier)
			? TaskDefinition.createTaskIdentifier(identifier, console)
			: identifier;

		if (key === undefined) {
			return Promise.resolve(undefined);
		}
		return this.getGroupedTasks().then((map) => {
			let values = map.get(folder);
			values = values.concat(map.get(USER_TASKS_GROUP_KEY));

			if (!values) {
				return undefined;
			}
			values = values.filter(task => task.matches(key, compareId)).sort(task => task._source.kind === TaskSourceKind.Extension ? 1 : -1);
			return values.length > 0 ? values[0] : undefined;
		});
	}

	public async tryResolveTask(configuringTask: ConfiguringTask): Promise<Task | undefined> {
		if (!(await this.trust())) {
			return;
		}
		await Promise.all([this.extensionService.activateByEvent('onCommand:workbench.action.tasks.runTask'), this.extensionService.whenInstalledExtensionsRegistered()]);
		let matchingProvider: ITaskProvider | undefined;
		let matchingProviderUnavailable: boolean = false;
		for (const [handle, provider] of this._providers) {
			const providerType = this._providerTypes.get(handle);
			if (configuringTask.type === providerType) {
				if (providerType && !this.isTaskProviderEnabled(providerType)) {
					matchingProviderUnavailable = true;
					continue;
				}
				matchingProvider = provider;
				break;
			}
		}

		if (!matchingProvider) {
			if (matchingProviderUnavailable) {
				this._outputChannel.append(nls.localize(
					'TaskService.providerUnavailable',
					'Warning: {0} tasks are unavailable in the current environment.\n',
					configuringTask.configures.type
				));
			}
			return;
		}

		// Try to resolve the task first
		try {
			const resolvedTask = await matchingProvider.resolveTask(configuringTask);
			if (resolvedTask && (resolvedTask._id === configuringTask._id)) {
				return TaskConfig.createCustomTask(resolvedTask, configuringTask);
			}
		} catch (error) {
			// Ignore errors. The task could not be provided by any of the providers.
		}

		// The task couldn't be resolved. Instead, use the less efficient provideTask.
		const tasks = await this.tasks({ type: configuringTask.type });
		for (const task of tasks) {
			if (task._id === configuringTask._id) {
				return TaskConfig.createCustomTask(<ContributedTask>task, configuringTask);
			}
		}

		return;
	}

	protected abstract versionAndEngineCompatible(filter?: TaskFilter): boolean;

	public async tasks(filter?: TaskFilter): Promise<Task[]> {
		if (!(await this.trust())) {
			return [];
		}
		if (!this.versionAndEngineCompatible(filter)) {
			return Promise.resolve<Task[]>([]);
		}
		return this.getGroupedTasks(filter ? filter.type : undefined).then((map) => {
			if (!filter || !filter.type) {
				return map.all();
			}
			let result: Task[] = [];
			map.forEach((tasks) => {
				for (let task of tasks) {
					if (ContributedTask.is(task) && ((task.defines.type === filter.type) || (task._source.label === filter.type))) {
						result.push(task);
					} else if (CustomTask.is(task)) {
						if (task.type === filter.type) {
							result.push(task);
						} else {
							let customizes = task.customizes();
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

	public taskTypes(): string[] {
		const types: string[] = [];
		if (this.isProvideTasksEnabled()) {
			for (const [handle] of this._providers) {
				const type = this._providerTypes.get(handle);
				if (type && this.isTaskProviderEnabled(type)) {
					types.push(type);
				}
			}
		}
		return types;
	}

	public createSorter(): TaskSorter {
		return new TaskSorter(this.contextService.getWorkspace() ? this.contextService.getWorkspace().folders : []);
	}

	private isActive(): Promise<boolean> {
		if (!this._taskSystem) {
			return Promise.resolve(false);
		}
		return this._taskSystem.isActive();
	}

	public async getActiveTasks(): Promise<Task[]> {
		if (!this._taskSystem) {
			return [];
		}
		return this._taskSystem.getActiveTasks();
	}

	public async getBusyTasks(): Promise<Task[]> {
		if (!this._taskSystem) {
			return [];
		}
		return this._taskSystem.getBusyTasks();
	}

	public getRecentlyUsedTasksV1(): LRUCache<string, string> {
		if (this._recentlyUsedTasksV1) {
			return this._recentlyUsedTasksV1;
		}
		const quickOpenHistoryLimit = this.configurationService.getValue<number>(QUICKOPEN_HISTORY_LIMIT_CONFIG);
		this._recentlyUsedTasksV1 = new LRUCache<string, string>(quickOpenHistoryLimit);

		let storageValue = this.storageService.get(AbstractTaskService.RecentlyUsedTasks_Key, StorageScope.WORKSPACE);
		if (storageValue) {
			try {
				let values: string[] = JSON.parse(storageValue);
				if (Array.isArray(values)) {
					for (let value of values) {
						this._recentlyUsedTasksV1.set(value, value);
					}
				}
			} catch (error) {
				// Ignore. We use the empty result
			}
		}
		return this._recentlyUsedTasksV1;
	}

	private getRecentlyUsedTasks(): LRUCache<string, string> {
		if (this._recentlyUsedTasks) {
			return this._recentlyUsedTasks;
		}
		const quickOpenHistoryLimit = this.configurationService.getValue<number>(QUICKOPEN_HISTORY_LIMIT_CONFIG);
		this._recentlyUsedTasks = new LRUCache<string, string>(quickOpenHistoryLimit);

		let storageValue = this.storageService.get(AbstractTaskService.RecentlyUsedTasks_KeyV2, StorageScope.WORKSPACE);
		if (storageValue) {
			try {
				let values: [string, string][] = JSON.parse(storageValue);
				if (Array.isArray(values)) {
					for (let value of values) {
						this._recentlyUsedTasks.set(value[0], value[1]);
					}
				}
			} catch (error) {
				// Ignore. We use the empty result
			}
		}
		return this._recentlyUsedTasks;
	}

	private getFolderFromTaskKey(key: string): string | undefined {
		const keyValue: { folder: string | undefined } = JSON.parse(key);
		return keyValue.folder;
	}

	public async readRecentTasks(): Promise<(Task | ConfiguringTask)[]> {
		const folderMap: IStringDictionary<IWorkspaceFolder> = Object.create(null);
		this.workspaceFolders.forEach(folder => {
			folderMap[folder.uri.toString()] = folder;
		});
		const folderToTasksMap: Map<string, any> = new Map();
		const recentlyUsedTasks = this.getRecentlyUsedTasks();
		const tasks: (Task | ConfiguringTask)[] = [];
		for (const entry of recentlyUsedTasks.entries()) {
			const key = entry[0];
			const task = JSON.parse(entry[1]);
			const folder = this.getFolderFromTaskKey(key);
			if (folder && !folderToTasksMap.has(folder)) {
				folderToTasksMap.set(folder, []);
			}
			if (folder && (folderMap[folder] || (folder === USER_TASKS_GROUP_KEY)) && task) {
				folderToTasksMap.get(folder).push(task);
			}
		}
		const readTasksMap: Map<string, (Task | ConfiguringTask)> = new Map();
		for (const key of folderToTasksMap.keys()) {
			let custom: CustomTask[] = [];
			let customized: IStringDictionary<ConfiguringTask> = Object.create(null);
			await this.computeTasksForSingleConfig(folderMap[key] ?? await this.getAFolder(), {
				version: '2.0.0',
				tasks: folderToTasksMap.get(key)
			}, TaskRunSource.System, custom, customized, folderMap[key] ? TaskConfig.TaskConfigSource.TasksJson : TaskConfig.TaskConfigSource.User, true);
			custom.forEach(task => {
				const taskKey = task.getRecentlyUsedKey();
				if (taskKey) {
					readTasksMap.set(taskKey, task);
				}
			});
			for (const configuration in customized) {
				const taskKey = customized[configuration].getRecentlyUsedKey();
				if (taskKey) {
					readTasksMap.set(taskKey, customized[configuration]);
				}
			}
		}

		for (const key of recentlyUsedTasks.keys()) {
			if (readTasksMap.has(key)) {
				tasks.push(readTasksMap.get(key)!);
			}
		}
		return tasks;
	}

	public removeRecentlyUsedTask(taskRecentlyUsedKey: string) {
		if (this.getRecentlyUsedTasks().has(taskRecentlyUsedKey)) {
			this.getRecentlyUsedTasks().delete(taskRecentlyUsedKey);
			this.saveRecentlyUsedTasks();
		}
	}

	private setTaskLRUCacheLimit() {
		const quickOpenHistoryLimit = this.configurationService.getValue<number>(QUICKOPEN_HISTORY_LIMIT_CONFIG);
		if (this._recentlyUsedTasks) {
			this._recentlyUsedTasks.limit = quickOpenHistoryLimit;
		}
	}

	private async setRecentlyUsedTask(task: Task): Promise<void> {
		let key = task.getRecentlyUsedKey();
		if (!InMemoryTask.is(task) && key) {
			const customizations = this.createCustomizableTask(task);
			if (ContributedTask.is(task) && customizations) {
				let custom: CustomTask[] = [];
				let customized: IStringDictionary<ConfiguringTask> = Object.create(null);
				await this.computeTasksForSingleConfig(task._source.workspaceFolder ?? this.workspaceFolders[0], {
					version: '2.0.0',
					tasks: [customizations]
				}, TaskRunSource.System, custom, customized, TaskConfig.TaskConfigSource.TasksJson, true);
				for (const configuration in customized) {
					key = customized[configuration].getRecentlyUsedKey()!;
				}
			}
			this.getRecentlyUsedTasks().set(key, JSON.stringify(customizations));
			this.saveRecentlyUsedTasks();
		}
	}

	private saveRecentlyUsedTasks(): void {
		if (!this._recentlyUsedTasks) {
			return;
		}
		const quickOpenHistoryLimit = this.configurationService.getValue<number>(QUICKOPEN_HISTORY_LIMIT_CONFIG);
		// setting history limit to 0 means no LRU sorting
		if (quickOpenHistoryLimit === 0) {
			return;
		}
		let keys = [...this._recentlyUsedTasks.keys()];
		if (keys.length > quickOpenHistoryLimit) {
			keys = keys.slice(0, quickOpenHistoryLimit);
		}
		const keyValues: [string, string][] = [];
		for (const key of keys) {
			keyValues.push([key, this._recentlyUsedTasks.get(key, Touch.None)!]);
		}
		this.storageService.store(AbstractTaskService.RecentlyUsedTasks_KeyV2, JSON.stringify(keyValues), StorageScope.WORKSPACE, StorageTarget.USER);
	}

	private openDocumentation(): void {
		this.openerService.open(URI.parse('https://code.visualstudio.com/docs/editor/tasks#_defining-a-problem-matcher'));
	}

	private build(): Promise<ITaskSummary> {
		return this.getGroupedTasks().then((tasks) => {
			let runnable = this.createRunnableTask(tasks, TaskGroup.Build);
			if (!runnable || !runnable.task) {
				if (this.schemaVersion === JsonSchemaVersion.V0_1_0) {
					throw new TaskError(Severity.Info, nls.localize('TaskService.noBuildTask1', 'No build task defined. Mark a task with \'isBuildCommand\' in the tasks.json file.'), TaskErrors.NoBuildTask);
				} else {
					throw new TaskError(Severity.Info, nls.localize('TaskService.noBuildTask2', 'No build task defined. Mark a task with as a \'build\' group in the tasks.json file.'), TaskErrors.NoBuildTask);
				}
			}
			return this.executeTask(runnable.task, runnable.resolver, TaskRunSource.User);
		}).then(value => value, (error) => {
			this.handleError(error);
			return Promise.reject(error);
		});
	}

	private runTest(): Promise<ITaskSummary> {
		return this.getGroupedTasks().then((tasks) => {
			let runnable = this.createRunnableTask(tasks, TaskGroup.Test);
			if (!runnable || !runnable.task) {
				if (this.schemaVersion === JsonSchemaVersion.V0_1_0) {
					throw new TaskError(Severity.Info, nls.localize('TaskService.noTestTask1', 'No test task defined. Mark a task with \'isTestCommand\' in the tasks.json file.'), TaskErrors.NoTestTask);
				} else {
					throw new TaskError(Severity.Info, nls.localize('TaskService.noTestTask2', 'No test task defined. Mark a task with as a \'test\' group in the tasks.json file.'), TaskErrors.NoTestTask);
				}
			}
			return this.executeTask(runnable.task, runnable.resolver, TaskRunSource.User);
		}).then(value => value, (error) => {
			this.handleError(error);
			return Promise.reject(error);
		});
	}

	public async run(task: Task | undefined, options?: ProblemMatcherRunOptions, runSource: TaskRunSource = TaskRunSource.System): Promise<ITaskSummary | undefined> {
		if (!(await this.trust())) {
			return;
		}

		if (!task) {
			throw new TaskError(Severity.Info, nls.localize('TaskServer.noTask', 'Task to execute is undefined'), TaskErrors.TaskNotFound);
		}

		return new Promise<ITaskSummary | undefined>(async (resolve) => {
			let resolver = this.createResolver();
			if (options && options.attachProblemMatcher && this.shouldAttachProblemMatcher(task) && !InMemoryTask.is(task)) {
				const toExecute = await this.attachProblemMatcher(task);
				if (toExecute) {
					resolve(this.executeTask(toExecute, resolver, runSource));
				} else {
					resolve(undefined);
				}
			} else {
				resolve(this.executeTask(task, resolver, runSource));
			}
		}).then((value) => {
			if (runSource === TaskRunSource.User) {
				this.getWorkspaceTasks().then(workspaceTasks => {
					RunAutomaticTasks.promptForPermission(this, this.storageService, this.notificationService, this.workspaceTrustManagementService, this.openerService, workspaceTasks);
				});
			}
			return value;
		}, (error) => {
			this.handleError(error);
			return Promise.reject(error);
		});
	}

	private isProvideTasksEnabled(): boolean {
		const settingValue = this.configurationService.getValue('task.autoDetect');
		return settingValue === 'on';
	}

	private isProblemMatcherPromptEnabled(type?: string): boolean {
		const settingValue = this.configurationService.getValue(PROBLEM_MATCHER_NEVER_CONFIG);
		if (Types.isBoolean(settingValue)) {
			return !settingValue;
		}
		if (type === undefined) {
			return true;
		}
		const settingValueMap: IStringDictionary<boolean> = <any>settingValue;
		return !settingValueMap[type];
	}

	private getTypeForTask(task: Task): string {
		let type: string;
		if (CustomTask.is(task)) {
			let configProperties: TaskConfig.ConfigurationProperties = task._source.config.element;
			type = (<any>configProperties).type;
		} else {
			type = task.getDefinition()!.type;
		}
		return type;
	}

	private shouldAttachProblemMatcher(task: Task): boolean {
		const enabled = this.isProblemMatcherPromptEnabled(this.getTypeForTask(task));
		if (enabled === false) {
			return false;
		}
		if (!this.canCustomize(task)) {
			return false;
		}
		if (task.configurationProperties.group !== undefined && task.configurationProperties.group !== TaskGroup.Build) {
			return false;
		}
		if (task.configurationProperties.problemMatchers !== undefined && task.configurationProperties.problemMatchers.length > 0) {
			return false;
		}
		if (ContributedTask.is(task)) {
			return !task.hasDefinedMatchers && !!task.configurationProperties.problemMatchers && (task.configurationProperties.problemMatchers.length === 0);
		}
		if (CustomTask.is(task)) {
			let configProperties: TaskConfig.ConfigurationProperties = task._source.config.element;
			return configProperties.problemMatcher === undefined && !task.hasDefinedMatchers;
		}
		return false;
	}

	private async updateNeverProblemMatcherSetting(type: string): Promise<void> {
		this.telemetryService.publicLog2<ProblemMatcherDisableMetrics, ProblemMatcherDisableMetricsClassification>('problemMatcherDisabled', { type });
		const current = this.configurationService.getValue(PROBLEM_MATCHER_NEVER_CONFIG);
		if (current === true) {
			return;
		}
		let newValue: IStringDictionary<boolean>;
		if (current !== false) {
			newValue = <any>current;
		} else {
			newValue = Object.create(null);
		}
		newValue[type] = true;
		return this.configurationService.updateValue(PROBLEM_MATCHER_NEVER_CONFIG, newValue);
	}

	private attachProblemMatcher(task: ContributedTask | CustomTask): Promise<Task | undefined> {
		interface ProblemMatcherPickEntry extends IQuickPickItem {
			matcher: NamedProblemMatcher | undefined;
			never?: boolean;
			learnMore?: boolean;
			setting?: string;
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
			entries = entries.sort((a, b) => {
				if (a.label && b.label) {
					return a.label.localeCompare(b.label);
				} else {
					return 0;
				}
			});
			entries.unshift({ type: 'separator', label: nls.localize('TaskService.associate', 'associate') });
			let taskType: string;
			if (CustomTask.is(task)) {
				let configProperties: TaskConfig.ConfigurationProperties = task._source.config.element;
				taskType = (<any>configProperties).type;
			} else {
				taskType = task.getDefinition().type;
			}
			entries.unshift(
				{ label: nls.localize('TaskService.attachProblemMatcher.continueWithout', 'Continue without scanning the task output'), matcher: undefined },
				{ label: nls.localize('TaskService.attachProblemMatcher.never', 'Never scan the task output for this task'), matcher: undefined, never: true },
				{ label: nls.localize('TaskService.attachProblemMatcher.neverType', 'Never scan the task output for {0} tasks', taskType), matcher: undefined, setting: taskType },
				{ label: nls.localize('TaskService.attachProblemMatcher.learnMoreAbout', 'Learn more about scanning the task output'), matcher: undefined, learnMore: true }
			);
			return this.quickInputService.pick(entries, {
				placeHolder: nls.localize('selectProblemMatcher', 'Select for which kind of errors and warnings to scan the task output'),
			}).then(async (selected) => {
				if (selected) {
					if (selected.learnMore) {
						this.openDocumentation();
						return undefined;
					} else if (selected.never) {
						this.customize(task, { problemMatcher: [] }, true);
						return task;
					} else if (selected.matcher) {
						let newTask = task.clone();
						let matcherReference = `$${selected.matcher.name}`;
						let properties: CustomizationProperties = { problemMatcher: [matcherReference] };
						newTask.configurationProperties.problemMatchers = [matcherReference];
						let matcher = ProblemMatcherRegistry.get(selected.matcher.name);
						if (matcher && matcher.watching !== undefined) {
							properties.isBackground = true;
							newTask.configurationProperties.isBackground = true;
						}
						this.customize(task, properties, true);
						return newTask;
					} else if (selected.setting) {
						await this.updateNeverProblemMatcherSetting(selected.setting);
						return task;
					} else {
						return task;
					}
				} else {
					return undefined;
				}
			});
		}
		return Promise.resolve(task);
	}

	private getTasksForGroup(group: string): Promise<Task[]> {
		return this.getGroupedTasks().then((groups) => {
			let result: Task[] = [];
			groups.forEach((tasks) => {
				for (let task of tasks) {
					if (task.configurationProperties.group === group) {
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

	private canCustomize(task: Task): boolean {
		if (this.schemaVersion !== JsonSchemaVersion.V2_0_0) {
			return false;
		}
		if (CustomTask.is(task)) {
			return true;
		}
		if (ContributedTask.is(task)) {
			return !!task.getWorkspaceFolder();
		}
		return false;
	}

	private async formatTaskForJson(resource: URI, task: TaskConfig.CustomTask | TaskConfig.ConfiguringTask): Promise<string> {
		let reference: IReference<IResolvedTextEditorModel> | undefined;
		let stringValue: string = '';
		try {
			reference = await this.textModelResolverService.createModelReference(resource);
			const model = reference.object.textEditorModel;
			const { tabSize, insertSpaces } = model.getOptions();
			const eol = model.getEOL();
			const edits = format(JSON.stringify(task), undefined, { eol, tabSize, insertSpaces });
			let stringified = applyEdits(JSON.stringify(task), edits);
			const regex = new RegExp(eol + (insertSpaces ? ' '.repeat(tabSize) : '\\t'), 'g');
			stringified = stringified.replace(regex, eol + (insertSpaces ? ' '.repeat(tabSize * 3) : '\t\t\t'));
			const twoTabs = insertSpaces ? ' '.repeat(tabSize * 2) : '\t\t';
			stringValue = twoTabs + stringified.slice(0, stringified.length - 1) + twoTabs + stringified.slice(stringified.length - 1);
		} finally {
			if (reference) {
				reference.dispose();
			}
		}
		return stringValue;
	}

	private openEditorAtTask(resource: URI | undefined, task: TaskConfig.CustomTask | TaskConfig.ConfiguringTask | string | undefined, configIndex: number = -1): Promise<boolean> {
		if (resource === undefined) {
			return Promise.resolve(false);
		}
		let selection: ITextEditorSelection | undefined;
		return this.fileService.readFile(resource).then(content => content.value).then(async content => {
			if (!content) {
				return false;
			}
			if (task) {
				const contentValue = content.toString();
				let stringValue: string | undefined;
				if (configIndex !== -1) {
					const json: TaskConfig.ExternalTaskRunnerConfiguration = this.configurationService.getValue<TaskConfig.ExternalTaskRunnerConfiguration>('tasks', { resource });
					if (json.tasks && (json.tasks.length > configIndex)) {
						stringValue = await this.formatTaskForJson(resource, json.tasks[configIndex]);
					}
				}
				if (!stringValue) {
					if (typeof task === 'string') {
						stringValue = task;
					} else {
						stringValue = await this.formatTaskForJson(resource, task);
					}
				}

				const index = contentValue.indexOf(stringValue);
				let startLineNumber = 1;
				for (let i = 0; i < index; i++) {
					if (contentValue.charAt(i) === '\n') {
						startLineNumber++;
					}
				}
				let endLineNumber = startLineNumber;
				for (let i = 0; i < stringValue.length; i++) {
					if (stringValue.charAt(i) === '\n') {
						endLineNumber++;
					}
				}
				selection = startLineNumber > 1 ? { startLineNumber, startColumn: startLineNumber === endLineNumber ? 4 : 3, endLineNumber, endColumn: startLineNumber === endLineNumber ? undefined : 4 } : undefined;
			}

			return this.editorService.openEditor({
				resource,
				options: {
					pinned: false,
					forceReload: true, // because content might have changed
					selection,
					selectionRevealType: TextEditorSelectionRevealType.CenterIfOutsideViewport
				}
			}).then(() => !!selection);
		});
	}

	private createCustomizableTask(task: ContributedTask | CustomTask | ConfiguringTask): TaskConfig.CustomTask | TaskConfig.ConfiguringTask | undefined {
		let toCustomize: TaskConfig.CustomTask | TaskConfig.ConfiguringTask | undefined;
		let taskConfig = CustomTask.is(task) || ConfiguringTask.is(task) ? task._source.config : undefined;
		if (taskConfig && taskConfig.element) {
			toCustomize = { ...(taskConfig.element) };
		} else if (ContributedTask.is(task)) {
			toCustomize = {
			};
			let identifier: TaskConfig.TaskIdentifier = Object.assign(Object.create(null), task.defines);
			delete identifier['_key'];
			Object.keys(identifier).forEach(key => (<any>toCustomize)![key] = identifier[key]);
			if (task.configurationProperties.problemMatchers && task.configurationProperties.problemMatchers.length > 0 && Types.isStringArray(task.configurationProperties.problemMatchers)) {
				toCustomize.problemMatcher = task.configurationProperties.problemMatchers;
			}
			if (task.configurationProperties.group) {
				toCustomize.group = task.configurationProperties.group;
			}
		}
		if (!toCustomize) {
			return undefined;
		}
		if (toCustomize.problemMatcher === undefined && task.configurationProperties.problemMatchers === undefined || (task.configurationProperties.problemMatchers && task.configurationProperties.problemMatchers.length === 0)) {
			toCustomize.problemMatcher = [];
		}
		if (task._source.label !== 'Workspace') {
			toCustomize.label = task.configurationProperties.identifier;
		} else {
			toCustomize.label = task._label;
		}
		toCustomize.detail = task.configurationProperties.detail;
		return toCustomize;
	}

	public async customize(task: ContributedTask | CustomTask | ConfiguringTask, properties?: CustomizationProperties, openConfig?: boolean): Promise<void> {
		if (!(await this.trust())) {
			return;
		}

		const workspaceFolder = task.getWorkspaceFolder();
		if (!workspaceFolder) {
			return Promise.resolve(undefined);
		}
		let configuration = this.getConfiguration(workspaceFolder, task._source.kind);
		if (configuration.hasParseErrors) {
			this.notificationService.warn(nls.localize('customizeParseErrors', 'The current task configuration has errors. Please fix the errors first before customizing a task.'));
			return Promise.resolve<void>(undefined);
		}

		let fileConfig = configuration.config;
		const toCustomize = this.createCustomizableTask(task);
		if (!toCustomize) {
			return Promise.resolve(undefined);
		}
		const index: number | undefined = CustomTask.is(task) ? task._source.config.index : undefined;
		if (properties) {
			for (let property of Object.getOwnPropertyNames(properties)) {
				let value = (<any>properties)[property];
				if (value !== undefined && value !== null) {
					(<any>toCustomize)[property] = value;
				}
			}
		}

		let promise: Promise<void> | undefined;
		if (!fileConfig) {
			let value = {
				version: '2.0.0',
				tasks: [toCustomize]
			};
			let content = [
				'{',
				nls.localize('tasksJsonComment', '\t// See https://go.microsoft.com/fwlink/?LinkId=733558 \n\t// for the documentation about the tasks.json format'),
			].join('\n') + JSON.stringify(value, null, '\t').substr(1);
			let editorConfig = this.configurationService.getValue<any>();
			if (editorConfig.editor.insertSpaces) {
				content = content.replace(/(\n)(\t+)/g, (_, s1, s2) => s1 + ' '.repeat(s2.length * editorConfig.editor.tabSize));
			}
			promise = this.textFileService.create([{ resource: workspaceFolder.toResource('.vscode/tasks.json'), value: content }]).then(() => { });
		} else {
			// We have a global task configuration
			if ((index === -1) && properties) {
				if (properties.problemMatcher !== undefined) {
					fileConfig.problemMatcher = properties.problemMatcher;
					promise = this.writeConfiguration(workspaceFolder, 'tasks.problemMatchers', fileConfig.problemMatcher, task._source.kind);
				} else if (properties.group !== undefined) {
					fileConfig.group = properties.group;
					promise = this.writeConfiguration(workspaceFolder, 'tasks.group', fileConfig.group, task._source.kind);
				}
			} else {
				if (!Array.isArray(fileConfig.tasks)) {
					fileConfig.tasks = [];
				}
				if (index === undefined) {
					fileConfig.tasks.push(toCustomize);
				} else {
					fileConfig.tasks[index] = toCustomize;
				}
				promise = this.writeConfiguration(workspaceFolder, 'tasks.tasks', fileConfig.tasks, task._source.kind);
			}
		}
		if (!promise) {
			return Promise.resolve(undefined);
		}
		return promise.then(() => {
			let event: TaskCustomizationTelemetryEvent = {
				properties: properties ? Object.getOwnPropertyNames(properties) : []
			};
			/* __GDPR__
				"taskService.customize" : {
					"properties" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			*/
			this.telemetryService.publicLog(AbstractTaskService.CustomizationTelemetryEventName, event);
			if (openConfig) {
				this.openEditorAtTask(this.getResourceForTask(task), toCustomize);
			}
		});
	}

	private writeConfiguration(workspaceFolder: IWorkspaceFolder, key: string, value: any, source?: string): Promise<void> | undefined {
		let target: ConfigurationTarget | undefined = undefined;
		switch (source) {
			case TaskSourceKind.User: target = ConfigurationTarget.USER; break;
			case TaskSourceKind.WorkspaceFile: target = ConfigurationTarget.WORKSPACE; break;
			default: if (this.contextService.getWorkbenchState() === WorkbenchState.FOLDER) {
				target = ConfigurationTarget.WORKSPACE;
			} else if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
				target = ConfigurationTarget.WORKSPACE_FOLDER;
			}
		}
		if (target) {
			return this.configurationService.updateValue(key, value, { resource: workspaceFolder.uri }, target);
		} else {
			return undefined;
		}
	}

	private getResourceForKind(kind: string): URI | undefined {
		this.updateSetup();
		switch (kind) {
			case TaskSourceKind.User: {
				return resources.joinPath(resources.dirname(this.preferencesService.userSettingsResource), 'tasks.json');
			}
			case TaskSourceKind.WorkspaceFile: {
				if (this._workspace && this._workspace.configuration) {
					return this._workspace.configuration;
				}
			}
			default: {
				return undefined;
			}
		}
	}

	private getResourceForTask(task: CustomTask | ConfiguringTask | ContributedTask): URI {
		if (CustomTask.is(task)) {
			let uri = this.getResourceForKind(task._source.kind);
			if (!uri) {
				const taskFolder = task.getWorkspaceFolder();
				if (taskFolder) {
					uri = taskFolder.toResource(task._source.config.file);
				} else {
					uri = this.workspaceFolders[0].uri;
				}
			}
			return uri;
		} else {
			return task.getWorkspaceFolder()!.toResource('.vscode/tasks.json');
		}
	}

	public async openConfig(task: CustomTask | ConfiguringTask | undefined): Promise<boolean> {
		let resource: URI | undefined;
		if (task) {
			resource = this.getResourceForTask(task);
		} else {
			resource = (this._workspaceFolders && (this._workspaceFolders.length > 0)) ? this._workspaceFolders[0].toResource('.vscode/tasks.json') : undefined;
		}
		return this.openEditorAtTask(resource, task ? task._label : undefined, task ? task._source.config.index : -1);
	}

	private createRunnableTask(tasks: TaskMap, group: TaskGroup): { task: Task; resolver: ITaskResolver } | undefined {
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
				if (task.configurationProperties.identifier) {
					data.identifier.set(task.configurationProperties.identifier, task);
				}
				if (group && task.configurationProperties.group === group) {
					if (task._source.kind === TaskSourceKind.Workspace) {
						workspaceTasks.push(task);
					} else {
						extensionTasks.push(task);
					}
				}
			}
		});
		let resolver: ITaskResolver = {
			resolve: async (uri: URI | string, alias: string) => {
				let data = resolverData.get(typeof uri === 'string' ? uri : uri.toString());
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
			let task: InMemoryTask = new InMemoryTask(
				id,
				{ kind: TaskSourceKind.InMemory, label: 'inMemory' },
				id,
				'inMemory',
				{ reevaluateOnRerun: true },
				{
					identifier: id,
					dependsOn: extensionTasks.map((extensionTask) => { return { uri: extensionTask.getWorkspaceFolder()!.uri, task: extensionTask._id }; }),
					name: id,
				}
			);
			return { task, resolver };
		}
	}

	private createResolver(grouped?: TaskMap): ITaskResolver {
		interface ResolverData {
			label: Map<string, Task>;
			identifier: Map<string, Task>;
			taskIdentifier: Map<string, Task>;
		}

		let resolverData: Map<string, ResolverData> | undefined;

		return {
			resolve: async (uri: URI | string, identifier: string | TaskIdentifier | undefined) => {
				if (resolverData === undefined) {
					resolverData = new Map();
					(grouped || await this.getGroupedTasks()).forEach((tasks, folder) => {
						let data = resolverData!.get(folder);
						if (!data) {
							data = { label: new Map<string, Task>(), identifier: new Map<string, Task>(), taskIdentifier: new Map<string, Task>() };
							resolverData!.set(folder, data);
						}
						for (let task of tasks) {
							data.label.set(task._label, task);
							if (task.configurationProperties.identifier) {
								data.identifier.set(task.configurationProperties.identifier, task);
							}
							let keyedIdentifier = task.getDefinition(true);
							if (keyedIdentifier !== undefined) {
								data.taskIdentifier.set(keyedIdentifier._key, task);
							}
						}
					});
				}
				let data = resolverData.get(typeof uri === 'string' ? uri : uri.toString());
				if (!data || !identifier) {
					return undefined;
				}
				if (Types.isString(identifier)) {
					return data.label.get(identifier) || data.identifier.get(identifier);
				} else {
					let key = TaskDefinition.createTaskIdentifier(identifier, console);
					return key !== undefined ? data.taskIdentifier.get(key._key) : undefined;
				}
			}
		};
	}

	private executeTask(task: Task, resolver: ITaskResolver, runSource: TaskRunSource): Promise<ITaskSummary> {
		enum SaveBeforeRunConfigOptions {
			Always = 'always',
			Never = 'never',
			Prompt = 'prompt'
		}

		const saveBeforeRunTaskConfig: SaveBeforeRunConfigOptions = this.configurationService.getValue('task.saveBeforeRun');

		const execTask = async (task: Task, resolver: ITaskResolver): Promise<ITaskSummary> => {
			return ProblemMatcherRegistry.onReady().then(() => {
				let executeResult = this.getTaskSystem().run(task, resolver);
				return this.handleExecuteResult(executeResult, runSource);
			});
		};

		const saveAllEditorsAndExecTask = async (task: Task, resolver: ITaskResolver): Promise<ITaskSummary> => {
			return this.editorService.saveAll({ reason: SaveReason.AUTO }).then(() => {
				return execTask(task, resolver);
			});
		};

		const promptAsk = async (task: Task, resolver: ITaskResolver): Promise<ITaskSummary> => {
			const dialogOptions = await this.dialogService.show(
				Severity.Info,
				nls.localize('TaskSystem.saveBeforeRun.prompt.title', 'Save all editors?'),
				[nls.localize('saveBeforeRun.save', 'Save'), nls.localize('saveBeforeRun.dontSave', 'Don\'t save')],
				{
					detail: nls.localize('detail', "Do you want to save all editors before running the task?"),
					cancelId: 1
				}
			);

			if (dialogOptions.choice === 0) {
				return saveAllEditorsAndExecTask(task, resolver);
			} else {
				return execTask(task, resolver);
			}
		};

		if (saveBeforeRunTaskConfig === SaveBeforeRunConfigOptions.Never) {
			return execTask(task, resolver);
		} else if (saveBeforeRunTaskConfig === SaveBeforeRunConfigOptions.Prompt) {
			return promptAsk(task, resolver);
		} else {
			return saveAllEditorsAndExecTask(task, resolver);
		}
	}

	private async handleExecuteResult(executeResult: ITaskExecuteResult, runSource?: TaskRunSource): Promise<ITaskSummary> {
		if (executeResult.task.taskLoadMessages && executeResult.task.taskLoadMessages.length > 0) {
			executeResult.task.taskLoadMessages.forEach(loadMessage => {
				this._outputChannel.append(loadMessage + '\n');
			});
			this.showOutput();
		}

		if (runSource === TaskRunSource.User) {
			await this.setRecentlyUsedTask(executeResult.task);
		}
		if (executeResult.kind === TaskExecuteKind.Active) {
			let active = executeResult.active;
			if (active && active.same) {
				if (this._taskSystem?.isTaskVisible(executeResult.task)) {
					const message = nls.localize('TaskSystem.activeSame.noBackground', 'The task \'{0}\' is already active.', executeResult.task.getQualifiedLabel());
					let lastInstance = this.getTaskSystem().getLastInstance(executeResult.task) ?? executeResult.task;
					this.notificationService.prompt(Severity.Warning, message,
						[{
							label: nls.localize('terminateTask', "Terminate Task"),
							run: () => this.terminate(lastInstance)
						},
						{
							label: nls.localize('restartTask', "Restart Task"),
							run: () => this.restart(lastInstance)
						}],
						{ sticky: true }
					);
				} else {
					this._taskSystem?.revealTask(executeResult.task);
				}
			} else {
				throw new TaskError(Severity.Warning, nls.localize('TaskSystem.active', 'There is already a task running. Terminate it first before executing another task.'), TaskErrors.RunningTask);
			}
		}
		return executeResult.promise;
	}

	private restart(task: Task): void {
		if (!this._taskSystem) {
			return;
		}
		this._taskSystem.terminate(task).then((response) => {
			if (response.success) {
				this.run(task).then(undefined, reason => {
					// eat the error, it has already been surfaced to the user and we don't care about it here
				});
			} else {
				this.notificationService.warn(nls.localize('TaskSystem.restartFailed', 'Failed to terminate and restart task {0}', Types.isString(task) ? task : task.configurationProperties.name));
			}
			return response;
		});
	}

	public async terminate(task: Task): Promise<TaskTerminateResponse> {
		if (!(await this.trust())) {
			return { success: true, task: undefined };
		}

		if (!this._taskSystem) {
			return { success: true, task: undefined };
		}
		return this._taskSystem.terminate(task);
	}

	private terminateAll(): Promise<TaskTerminateResponse[]> {
		if (!this._taskSystem) {
			return Promise.resolve<TaskTerminateResponse[]>([]);
		}
		return this._taskSystem.terminateAll();
	}

	protected createTerminalTaskSystem(): ITaskSystem {
		return new TerminalTaskSystem(
			this.terminalService, this.terminalGroupService, this.outputService, this.panelService, this.viewsService, this.markerService,
			this.modelService, this.configurationResolverService, this.telemetryService,
			this.contextService, this.environmentService,
			AbstractTaskService.OutputChannelId, this.fileService, this.terminalProfileResolverService,
			this.pathService, this.viewDescriptorService, this.logService, this.configurationService,
			this,
			(workspaceFolder: IWorkspaceFolder | undefined) => {
				if (workspaceFolder) {
					return this.getTaskSystemInfo(workspaceFolder.uri.scheme);
				} else if (this._taskSystemInfos.size > 0) {
					const infos = Array.from(this._taskSystemInfos.entries());
					const notFile = infos.filter(info => info[0] !== Schemas.file);
					if (notFile.length > 0) {
						return notFile[0][1];
					}
					return infos[0][1];
				} else {
					return undefined;
				}
			}
		);
	}

	protected abstract getTaskSystem(): ITaskSystem;

	private isTaskProviderEnabled(type: string) {
		const definition = TaskDefinitionRegistry.get(type);
		return !definition || !definition.when || this.contextKeyService.contextMatchesRules(definition.when);
	}

	private getGroupedTasks(type?: string): Promise<TaskMap> {
		const needsRecentTasksMigration = this.needsRecentTasksMigration();
		return Promise.all([this.extensionService.activateByEvent('onCommand:workbench.action.tasks.runTask'), this.extensionService.whenInstalledExtensionsRegistered()]).then(() => {
			let validTypes: IStringDictionary<boolean> = Object.create(null);
			TaskDefinitionRegistry.all().forEach(definition => validTypes[definition.taskType] = true);
			validTypes['shell'] = true;
			validTypes['process'] = true;
			return new Promise<TaskSet[]>(resolve => {
				let result: TaskSet[] = [];
				let counter: number = 0;
				let done = (value: TaskSet | undefined) => {
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
							this.showOutput();
						} else {
							this._outputChannel.append('Unknown error received while collecting tasks from providers.\n');
							this.showOutput();
						}
					} finally {
						if (--counter === 0) {
							resolve(result);
						}
					}
				};
				if (this.isProvideTasksEnabled() && (this.schemaVersion === JsonSchemaVersion.V2_0_0) && (this._providers.size > 0)) {
					for (const [handle, provider] of this._providers) {
						const providerType = this._providerTypes.get(handle);
						if ((type === undefined) || (type === providerType)) {
							if (providerType && !this.isTaskProviderEnabled(providerType)) {
								continue;
							}
							counter++;
							provider.provideTasks(validTypes).then((taskSet: TaskSet) => {
								// Check that the tasks provided are of the correct type
								for (const task of taskSet.tasks) {
									if (task.type !== this._providerTypes.get(handle)) {
										this._outputChannel.append(nls.localize('unexpectedTaskType', "The task provider for \"{0}\" tasks unexpectedly provided a task of type \"{1}\".\n", this._providerTypes.get(handle), task.type));
										if ((task.type !== 'shell') && (task.type !== 'process')) {
											this.showOutput();
										}
										break;
									}
								}
								return done(taskSet);
							}, error);
						}
					}
				} else {
					resolve(result);
				}
			});
		}).then((contributedTaskSets) => {
			let result: TaskMap = new TaskMap();
			let contributedTasks: TaskMap = new TaskMap();

			for (let set of contributedTaskSets) {
				for (let task of set.tasks) {
					let workspaceFolder = task.getWorkspaceFolder();
					if (workspaceFolder) {
						contributedTasks.add(workspaceFolder, task);
					}
				}
			}

			return this.getWorkspaceTasks().then(async (customTasks) => {
				const customTasksKeyValuePairs = Array.from(customTasks);
				const customTasksPromises = customTasksKeyValuePairs.map(async ([key, folderTasks]) => {
					let contributed = contributedTasks.get(key);
					if (!folderTasks.set) {
						if (contributed) {
							result.add(key, ...contributed);
						}
						return;
					}

					if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
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

							const unUsedConfigurationsAsArray = Array.from(unUsedConfigurations);

							const unUsedConfigurationPromises = unUsedConfigurationsAsArray.map(async (value) => {
								let configuringTask = configurations!.byIdentifier[value];
								if (type && (type !== configuringTask.configures.type)) {
									return;
								}

								let requiredTaskProviderUnavailable: boolean = false;

								for (const [handle, provider] of this._providers) {
									const providerType = this._providerTypes.get(handle);
									if (configuringTask.type === providerType) {
										if (providerType && !this.isTaskProviderEnabled(providerType)) {
											requiredTaskProviderUnavailable = true;
											continue;
										}

										try {
											const resolvedTask = await provider.resolveTask(configuringTask);
											if (resolvedTask && (resolvedTask._id === configuringTask._id)) {
												result.add(key, TaskConfig.createCustomTask(resolvedTask, configuringTask));
												return;
											}
										} catch (error) {
											// Ignore errors. The task could not be provided by any of the providers.
										}
									}
								}

								if (requiredTaskProviderUnavailable) {
									this._outputChannel.append(nls.localize(
										'TaskService.providerUnavailable',
										'Warning: {0} tasks are unavailable in the current environment.\n',
										configuringTask.configures.type
									));
								} else {
									this._outputChannel.append(nls.localize(
										'TaskService.noConfiguration',
										'Error: The {0} task detection didn\'t contribute a task for the following configuration:\n{1}\nThe task will be ignored.\n',
										configuringTask.configures.type,
										JSON.stringify(configuringTask._source.config.element, undefined, 4)
									));
									this.showOutput();
								}
							});

							await Promise.all(unUsedConfigurationPromises);
						} else {
							result.add(key, ...folderTasks.set.tasks);
							result.add(key, ...contributed);
						}
					}
				});

				await Promise.all(customTasksPromises);
				if (needsRecentTasksMigration) {
					// At this point we have all the tasks and can migrate the recently used tasks.
					await this.migrateRecentTasks(result.all());
				}
				return result;
			}, () => {
				// If we can't read the tasks.json file provide at least the contributed tasks
				let result: TaskMap = new TaskMap();
				for (let set of contributedTaskSets) {
					for (let task of set.tasks) {
						const folder = task.getWorkspaceFolder();
						if (folder) {
							result.add(folder, task);
						}
					}
				}
				return result;
			});
		});
	}

	private getLegacyTaskConfigurations(workspaceTasks: TaskSet): IStringDictionary<CustomTask> | undefined {
		let result: IStringDictionary<CustomTask> | undefined;
		function getResult(): IStringDictionary<CustomTask> {
			if (result) {
				return result;
			}
			result = Object.create(null);
			return result!;
		}
		for (let task of workspaceTasks.tasks) {
			if (CustomTask.is(task)) {
				let commandName = task.command && task.command.name;
				// This is for backwards compatibility with the 0.1.0 task annotation code
				// if we had a gulp, jake or grunt command a task specification was a annotation
				if (commandName === 'gulp' || commandName === 'grunt' || commandName === 'jake') {
					let identifier = NKeyedTaskIdentifier.create({
						type: commandName,
						task: task.configurationProperties.name
					});
					getResult()[identifier._key] = task;
				}
			}
		}
		return result;
	}

	public async getWorkspaceTasks(runSource: TaskRunSource = TaskRunSource.User): Promise<Map<string, WorkspaceFolderTaskResult>> {
		if (!(await this.trust())) {
			return new Map();
		}
		await this._waitForSupportedExecutions;
		if (this._workspaceTasksPromise) {
			return this._workspaceTasksPromise;
		}
		this.updateWorkspaceTasks(runSource);
		return this._workspaceTasksPromise!;
	}

	private updateWorkspaceTasks(runSource: TaskRunSource = TaskRunSource.User): void {
		this._workspaceTasksPromise = this.computeWorkspaceTasks(runSource);
	}

	private async getAFolder(): Promise<IWorkspaceFolder> {
		let folder = this.workspaceFolders.length > 0 ? this.workspaceFolders[0] : undefined;
		if (!folder) {
			const userhome = await this.pathService.userHome();
			folder = new WorkspaceFolder({ uri: userhome, name: resources.basename(userhome), index: 0 });
		}
		return folder;
	}

	protected computeWorkspaceTasks(runSource: TaskRunSource = TaskRunSource.User): Promise<Map<string, WorkspaceFolderTaskResult>> {
		let promises: Promise<WorkspaceFolderTaskResult | undefined>[] = [];
		for (let folder of this.workspaceFolders) {
			promises.push(this.computeWorkspaceFolderTasks(folder, runSource).then((value) => value, () => undefined));
		}
		return Promise.all(promises).then(async (values) => {
			let result = new Map<string, WorkspaceFolderTaskResult>();
			for (let value of values) {
				if (value) {
					result.set(value.workspaceFolder.uri.toString(), value);
				}
			}
			const folder = await this.getAFolder();
			const userTasks = await this.computeUserTasks(folder, runSource).then((value) => value, () => undefined);
			if (userTasks) {
				result.set(USER_TASKS_GROUP_KEY, userTasks);
			}

			if (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY) {
				const workspaceFileTasks = await this.computeWorkspaceFileTasks(folder, runSource).then((value) => value, () => undefined);
				if (workspaceFileTasks && this._workspace && this._workspace.configuration) {
					result.set(this._workspace.configuration.toString(), workspaceFileTasks);
				}
			}
			return result;
		});
	}

	private get jsonTasksSupported(): boolean {
		return !!ShellExecutionSupportedContext.getValue(this.contextKeyService) && !!ProcessExecutionSupportedContext.getValue(this.contextKeyService);
	}

	private computeWorkspaceFolderTasks(workspaceFolder: IWorkspaceFolder, runSource: TaskRunSource = TaskRunSource.User): Promise<WorkspaceFolderTaskResult> {
		return (this.executionEngine === ExecutionEngine.Process
			? this.computeLegacyConfiguration(workspaceFolder)
			: this.computeConfiguration(workspaceFolder)).
			then((workspaceFolderConfiguration) => {
				if (!workspaceFolderConfiguration || !workspaceFolderConfiguration.config || workspaceFolderConfiguration.hasErrors) {
					return Promise.resolve({ workspaceFolder, set: undefined, configurations: undefined, hasErrors: workspaceFolderConfiguration ? workspaceFolderConfiguration.hasErrors : false });
				}
				return ProblemMatcherRegistry.onReady().then(async (): Promise<WorkspaceFolderTaskResult> => {
					let taskSystemInfo: TaskSystemInfo | undefined = this.getTaskSystemInfo(workspaceFolder.uri.scheme);
					let problemReporter = new ProblemReporter(this._outputChannel);
					let parseResult = TaskConfig.parse(workspaceFolder, undefined, taskSystemInfo ? taskSystemInfo.platform : Platform.platform, workspaceFolderConfiguration.config!, problemReporter, TaskConfig.TaskConfigSource.TasksJson, this.contextKeyService);
					let hasErrors = false;
					if (!parseResult.validationStatus.isOK() && (parseResult.validationStatus.state !== ValidationState.Info)) {
						hasErrors = true;
						this.showOutput(runSource);
					}
					if (problemReporter.status.isFatal()) {
						problemReporter.fatal(nls.localize('TaskSystem.configurationErrors', 'Error: the provided task configuration has validation errors and can\'t not be used. Please correct the errors first.'));
						return { workspaceFolder, set: undefined, configurations: undefined, hasErrors };
					}
					let customizedTasks: { byIdentifier: IStringDictionary<ConfiguringTask>; } | undefined;
					if (parseResult.configured && parseResult.configured.length > 0) {
						customizedTasks = {
							byIdentifier: Object.create(null)
						};
						for (let task of parseResult.configured) {
							customizedTasks.byIdentifier[task.configures._key] = task;
						}
					}
					if (!this.jsonTasksSupported && (parseResult.custom.length > 0)) {
						console.warn('Custom workspace tasks are not supported.');
					}
					return { workspaceFolder, set: { tasks: this.jsonTasksSupported ? parseResult.custom : [] }, configurations: customizedTasks, hasErrors };
				});
			});
	}

	private testParseExternalConfig(config: TaskConfig.ExternalTaskRunnerConfiguration | undefined, location: string): { config: TaskConfig.ExternalTaskRunnerConfiguration | undefined, hasParseErrors: boolean } {
		if (!config) {
			return { config: undefined, hasParseErrors: false };
		}
		let parseErrors: string[] = (config as any).$parseErrors;
		if (parseErrors) {
			let isAffected = false;
			for (const parseError of parseErrors) {
				if (/tasks\.json$/.test(parseError)) {
					isAffected = true;
					break;
				}
			}
			if (isAffected) {
				this._outputChannel.append(nls.localize({ key: 'TaskSystem.invalidTaskJsonOther', comment: ['Message notifies of an error in one of several places there is tasks related json, not necessarily in a file named tasks.json'] }, 'Error: The content of the tasks json in {0} has syntax errors. Please correct them before executing a task.\n', location));
				this.showOutput();
				return { config, hasParseErrors: true };
			}
		}
		return { config, hasParseErrors: false };
	}

	private async computeWorkspaceFileTasks(workspaceFolder: IWorkspaceFolder, runSource: TaskRunSource = TaskRunSource.User): Promise<WorkspaceFolderTaskResult> {
		if (this.executionEngine === ExecutionEngine.Process) {
			return this.emptyWorkspaceTaskResults(workspaceFolder);
		}
		const workspaceFileConfig = this.getConfiguration(workspaceFolder, TaskSourceKind.WorkspaceFile);
		const configuration = this.testParseExternalConfig(workspaceFileConfig.config, nls.localize('TasksSystem.locationWorkspaceConfig', 'workspace file'));
		let customizedTasks: { byIdentifier: IStringDictionary<ConfiguringTask>; } = {
			byIdentifier: Object.create(null)
		};

		const custom: CustomTask[] = [];
		await this.computeTasksForSingleConfig(workspaceFolder, configuration.config, runSource, custom, customizedTasks.byIdentifier, TaskConfig.TaskConfigSource.WorkspaceFile);
		const engine = configuration.config ? TaskConfig.ExecutionEngine.from(configuration.config) : ExecutionEngine.Terminal;
		if (engine === ExecutionEngine.Process) {
			this.notificationService.warn(nls.localize('TaskSystem.versionWorkspaceFile', 'Only tasks version 2.0.0 permitted in workspace configuration files.'));
			return this.emptyWorkspaceTaskResults(workspaceFolder);
		}
		return { workspaceFolder, set: { tasks: custom }, configurations: customizedTasks, hasErrors: configuration.hasParseErrors };
	}

	private async computeUserTasks(workspaceFolder: IWorkspaceFolder, runSource: TaskRunSource = TaskRunSource.User): Promise<WorkspaceFolderTaskResult> {
		if (this.executionEngine === ExecutionEngine.Process) {
			return this.emptyWorkspaceTaskResults(workspaceFolder);
		}
		const userTasksConfig = this.getConfiguration(workspaceFolder, TaskSourceKind.User);
		const configuration = this.testParseExternalConfig(userTasksConfig.config, nls.localize('TasksSystem.locationUserConfig', 'user settings'));
		let customizedTasks: { byIdentifier: IStringDictionary<ConfiguringTask>; } = {
			byIdentifier: Object.create(null)
		};

		const custom: CustomTask[] = [];
		await this.computeTasksForSingleConfig(workspaceFolder, configuration.config, runSource, custom, customizedTasks.byIdentifier, TaskConfig.TaskConfigSource.User);
		const engine = configuration.config ? TaskConfig.ExecutionEngine.from(configuration.config) : ExecutionEngine.Terminal;
		if (engine === ExecutionEngine.Process) {
			this.notificationService.warn(nls.localize('TaskSystem.versionSettings', 'Only tasks version 2.0.0 permitted in user settings.'));
			return this.emptyWorkspaceTaskResults(workspaceFolder);
		}
		return { workspaceFolder, set: { tasks: custom }, configurations: customizedTasks, hasErrors: configuration.hasParseErrors };
	}

	private emptyWorkspaceTaskResults(workspaceFolder: IWorkspaceFolder): WorkspaceFolderTaskResult {
		return { workspaceFolder, set: undefined, configurations: undefined, hasErrors: false };
	}

	private async computeTasksForSingleConfig(workspaceFolder: IWorkspaceFolder, config: TaskConfig.ExternalTaskRunnerConfiguration | undefined, runSource: TaskRunSource, custom: CustomTask[], customized: IStringDictionary<ConfiguringTask>, source: TaskConfig.TaskConfigSource, isRecentTask: boolean = false): Promise<boolean> {
		if (!config) {
			return false;
		}
		let taskSystemInfo: TaskSystemInfo | undefined = workspaceFolder ? this.getTaskSystemInfo(workspaceFolder.uri.scheme) : undefined;
		let problemReporter = new ProblemReporter(this._outputChannel);
		let parseResult = TaskConfig.parse(workspaceFolder, this._workspace, taskSystemInfo ? taskSystemInfo.platform : Platform.platform, config, problemReporter, source, this.contextKeyService, isRecentTask);
		let hasErrors = false;
		if (!parseResult.validationStatus.isOK() && (parseResult.validationStatus.state !== ValidationState.Info)) {
			this.showOutput(runSource);
			hasErrors = true;
		}
		if (problemReporter.status.isFatal()) {
			problemReporter.fatal(nls.localize('TaskSystem.configurationErrors', 'Error: the provided task configuration has validation errors and can\'t not be used. Please correct the errors first.'));
			return hasErrors;
		}
		if (parseResult.configured && parseResult.configured.length > 0) {
			for (let task of parseResult.configured) {
				customized[task.configures._key] = task;
			}
		}
		if (!this.jsonTasksSupported && (parseResult.custom.length > 0)) {
			console.warn('Custom workspace tasks are not supported.');
		} else {
			for (let task of parseResult.custom) {
				custom.push(task);
			}
		}
		return hasErrors;
	}

	private computeConfiguration(workspaceFolder: IWorkspaceFolder): Promise<WorkspaceFolderConfigurationResult> {
		let { config, hasParseErrors } = this.getConfiguration(workspaceFolder);
		return Promise.resolve<WorkspaceFolderConfigurationResult>({ workspaceFolder, config, hasErrors: hasParseErrors });
	}

	protected abstract computeLegacyConfiguration(workspaceFolder: IWorkspaceFolder): Promise<WorkspaceFolderConfigurationResult>;

	private computeWorkspaceFolderSetup(): [IWorkspaceFolder[], IWorkspaceFolder[], ExecutionEngine, JsonSchemaVersion, IWorkspace | undefined] {
		let workspaceFolders: IWorkspaceFolder[] = [];
		let ignoredWorkspaceFolders: IWorkspaceFolder[] = [];
		let executionEngine = ExecutionEngine.Terminal;
		let schemaVersion = JsonSchemaVersion.V2_0_0;
		let workspace: IWorkspace | undefined;
		if (this.contextService.getWorkbenchState() === WorkbenchState.FOLDER) {
			let workspaceFolder: IWorkspaceFolder = this.contextService.getWorkspace().folders[0];
			workspaceFolders.push(workspaceFolder);
			executionEngine = this.computeExecutionEngine(workspaceFolder);
			const telemetryData: { [key: string]: any; } = {
				executionEngineVersion: executionEngine
			};
			/* __GDPR__
				"taskService.engineVersion" : {
					"executionEngineVersion" : { "classification": "SystemMetaData", "purpose": "FeatureInsight" }
				}
			*/
			this.telemetryService.publicLog('taskService.engineVersion', telemetryData);
			schemaVersion = this.computeJsonSchemaVersion(workspaceFolder);
		} else if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			workspace = this.contextService.getWorkspace();
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
		return [workspaceFolders, ignoredWorkspaceFolders, executionEngine, schemaVersion, workspace];
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

	protected getConfiguration(workspaceFolder: IWorkspaceFolder, source?: string): { config: TaskConfig.ExternalTaskRunnerConfiguration | undefined; hasParseErrors: boolean } {
		let result;
		if (this.contextService.getWorkbenchState() === WorkbenchState.EMPTY) {
			result = undefined;
		} else {
			const wholeConfig = this.configurationService.inspect<TaskConfig.ExternalTaskRunnerConfiguration>('tasks', { resource: workspaceFolder.uri });
			switch (source) {
				case TaskSourceKind.User: {
					if (wholeConfig.userValue !== wholeConfig.workspaceFolderValue) {
						result = Objects.deepClone(wholeConfig.userValue);
					}
					break;
				}
				case TaskSourceKind.Workspace: result = Objects.deepClone(wholeConfig.workspaceFolderValue); break;
				case TaskSourceKind.WorkspaceFile: {
					if ((this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE)
						&& (wholeConfig.workspaceFolderValue !== wholeConfig.workspaceValue)) {
						result = Objects.deepClone(wholeConfig.workspaceValue);
					}
					break;
				}
				default: result = Objects.deepClone(wholeConfig.workspaceFolderValue);
			}
		}
		if (!result) {
			return { config: undefined, hasParseErrors: false };
		}
		let parseErrors: string[] = (result as any).$parseErrors;
		if (parseErrors) {
			let isAffected = false;
			for (const parseError of parseErrors) {
				if (/tasks\.json$/.test(parseError)) {
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

	public inTerminal(): boolean {
		if (this._taskSystem) {
			return this._taskSystem instanceof TerminalTaskSystem;
		}
		return this.executionEngine === ExecutionEngine.Terminal;
	}

	public configureAction(): Action {
		const thisCapture: AbstractTaskService = this;
		return new class extends Action {
			constructor() {
				super(ConfigureTaskAction.ID, ConfigureTaskAction.TEXT, undefined, true, () => { thisCapture.runConfigureTasks(); return Promise.resolve(undefined); });
			}
		};
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
			showOutput = false;
		} else if (Types.isString(err)) {
			this.notificationService.error(<string>err);
		} else {
			this.notificationService.error(nls.localize('TaskSystem.unknownError', 'An error has occurred while running a task. See task log for details.'));
		}
		if (showOutput) {
			this.showOutput();
		}
	}

	private canRunCommand(): boolean {
		return true;
	}

	private showDetail(): boolean {
		return this.configurationService.getValue<boolean>(QUICKOPEN_DETAIL_CONFIG);
	}

	private async createTaskQuickPickEntries(tasks: Task[], group: boolean = false, sort: boolean = false, selectedEntry?: TaskQuickPickEntry, includeRecents: boolean = true): Promise<TaskQuickPickEntry[]> {
		let count: { [key: string]: number; } = {};
		if (tasks === undefined || tasks === null || tasks.length === 0) {
			return [];
		}
		const TaskQuickPickEntry = (task: Task): TaskQuickPickEntry => {
			let entryLabel = task._label;
			if (count[task._id]) {
				entryLabel = entryLabel + ' (' + count[task._id].toString() + ')';
				count[task._id]++;
			} else {
				count[task._id] = 1;
			}
			return { label: entryLabel, description: this.getTaskDescription(task), task, detail: this.showDetail() ? task.configurationProperties.detail : undefined };

		};
		function fillEntries(entries: QuickPickInput<TaskQuickPickEntry>[], tasks: Task[], groupLabel: string): void {
			if (tasks.length) {
				entries.push({ type: 'separator', label: groupLabel });
			}
			for (let task of tasks) {
				let entry: TaskQuickPickEntry = TaskQuickPickEntry(task);
				entry.buttons = [{ iconClass: ThemeIcon.asClassName(configureTaskIcon), tooltip: nls.localize('configureTask', "Configure Task") }];
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
				let recentlyUsedTasks = await this.readRecentTasks();
				let recent: Task[] = [];
				let recentSet: Set<string> = new Set();
				let configured: Task[] = [];
				let detected: Task[] = [];
				let taskMap: IStringDictionary<Task> = Object.create(null);
				tasks.forEach(task => {
					let key = task.getCommonTaskId();
					if (key) {
						taskMap[key] = task;
					}
				});
				recentlyUsedTasks.reverse().forEach(recentTask => {
					const key = recentTask.getCommonTaskId();
					if (key) {
						recentSet.add(key);
						let task = taskMap[key];
						if (task) {
							recent.push(task);
						}
					}
				});
				for (let task of tasks) {
					let key = task.getCommonTaskId();
					if (!key || !recentSet.has(key)) {
						if ((task._source.kind === TaskSourceKind.Workspace) || (task._source.kind === TaskSourceKind.User)) {
							configured.push(task);
						} else {
							detected.push(task);
						}
					}
				}
				const sorter = this.createSorter();
				if (includeRecents) {
					fillEntries(entries, recent, nls.localize('recentlyUsed', 'recently used tasks'));
				}
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
		count = {};
		return entries;
	}

	private async showTwoLevelQuickPick(placeHolder: string, defaultEntry?: TaskQuickPickEntry) {
		return TaskQuickPick.show(this, this.configurationService, this.quickInputService, this.notificationService, this.dialogService, placeHolder, defaultEntry);
	}

	private async showQuickPick(tasks: Promise<Task[]> | Task[], placeHolder: string, defaultEntry?: TaskQuickPickEntry, group: boolean = false, sort: boolean = false, selectedEntry?: TaskQuickPickEntry, additionalEntries?: TaskQuickPickEntry[]): Promise<TaskQuickPickEntry | undefined | null> {
		const tokenSource = new CancellationTokenSource();
		const cancellationToken: CancellationToken = tokenSource.token;
		let _createEntries = new Promise<QuickPickInput<TaskQuickPickEntry>[]>((resolve) => {
			if (Array.isArray(tasks)) {
				resolve(this.createTaskQuickPickEntries(tasks, group, sort, selectedEntry));
			} else {
				resolve(tasks.then((tasks) => this.createTaskQuickPickEntries(tasks, group, sort, selectedEntry)));
			}
		});

		const timeout: boolean = await Promise.race([new Promise<boolean>(async (resolve) => {
			await _createEntries;
			resolve(false);
		}), new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				clearTimeout(timer);
				resolve(true);
			}, 200);
		})]);

		if (!timeout && ((await _createEntries).length === 1) && this.configurationService.getValue<boolean>(QUICKOPEN_SKIP_CONFIG)) {
			return (<TaskQuickPickEntry>(await _createEntries)[0]);
		}

		const pickEntries = _createEntries.then((entries) => {
			if ((entries.length === 1) && this.configurationService.getValue<boolean>(QUICKOPEN_SKIP_CONFIG)) {
				tokenSource.cancel();
			} else if ((entries.length === 0) && defaultEntry) {
				entries.push(defaultEntry);
			} else if (entries.length > 1 && additionalEntries && additionalEntries.length > 0) {
				entries.push({ type: 'separator', label: '' });
				entries.push(additionalEntries[0]);
			}
			return entries;
		});

		const picker: IQuickPick<TaskQuickPickEntry> = this.quickInputService.createQuickPick();
		picker.placeholder = placeHolder;
		picker.matchOnDescription = true;

		picker.onDidTriggerItemButton(context => {
			let task = context.item.task;
			this.quickInputService.cancel();
			if (ContributedTask.is(task)) {
				this.customize(task, undefined, true);
			} else if (CustomTask.is(task)) {
				this.openConfig(task);
			}
		});
		picker.busy = true;
		pickEntries.then(entries => {
			picker.busy = false;
			picker.items = entries;
		});
		picker.show();

		return new Promise<TaskQuickPickEntry | undefined | null>(resolve => {
			this._register(picker.onDidAccept(async () => {
				let selection = picker.selectedItems ? picker.selectedItems[0] : undefined;
				if (cancellationToken.isCancellationRequested) {
					// canceled when there's only one task
					const task = (await pickEntries)[0];
					if ((<any>task).task) {
						selection = <TaskQuickPickEntry>task;
					}
				}
				picker.dispose();
				if (!selection) {
					resolve(undefined);
				}
				resolve(selection);
			}));
		});
	}

	private needsRecentTasksMigration(): boolean {
		return (this.getRecentlyUsedTasksV1().size > 0) && (this.getRecentlyUsedTasks().size === 0);
	}

	private async migrateRecentTasks(tasks: Task[]) {
		if (!this.needsRecentTasksMigration()) {
			return;
		}
		let recentlyUsedTasks = this.getRecentlyUsedTasksV1();
		let taskMap: IStringDictionary<Task> = Object.create(null);
		tasks.forEach(task => {
			let key = task.getRecentlyUsedKey();
			if (key) {
				taskMap[key] = task;
			}
		});
		const reversed = [...recentlyUsedTasks.keys()].reverse();
		for (const key in reversed) {
			let task = taskMap[key];
			if (task) {
				await this.setRecentlyUsedTask(task);
			}
		}
		this.storageService.remove(AbstractTaskService.RecentlyUsedTasks_Key, StorageScope.WORKSPACE);
	}

	private showIgnoredFoldersMessage(): Promise<void> {
		if (this.ignoredWorkspaceFolders.length === 0 || !this.showIgnoreMessage) {
			return Promise.resolve(undefined);
		}

		this.notificationService.prompt(
			Severity.Info,
			nls.localize('TaskService.ignoredFolder', 'The following workspace folders are ignored since they use task version 0.1.0: {0}', this.ignoredWorkspaceFolders.map(f => f.name).join(', ')),
			[{
				label: nls.localize('TaskService.notAgain', "Don't Show Again"),
				isSecondary: true,
				run: () => {
					this.storageService.store(AbstractTaskService.IgnoreTask010DonotShowAgain_key, true, StorageScope.WORKSPACE, StorageTarget.USER);
					this._showIgnoreMessage = false;
				}
			}]
		);

		return Promise.resolve(undefined);
	}

	private async trust(): Promise<boolean> {
		return (await this.workspaceTrustRequestService.requestWorkspaceTrust(
			{
				message: nls.localize('TaskService.requestTrust', "Listing and running tasks requires that some of the files in this workspace be executed as code.")
			})) === true;
	}

	private runTaskCommand(arg?: any): void {
		if (!this.canRunCommand()) {
			return;
		}
		let identifier = this.getTaskIdentifier(arg);
		if (identifier !== undefined) {
			this.getGroupedTasks().then(async (grouped) => {
				let task = await this.resolveTask(grouped, identifier);
				if (task) {
					this.run(task).then(undefined, reason => {
						// eat the error, it has already been surfaced to the user and we don't care about it here
					});
					return;
				}

				this.doRunTaskCommand(grouped.all());
			}, () => {
				this.doRunTaskCommand();
			});
		} else {
			this.doRunTaskCommand();
		}
	}

	private tasksAndGroupedTasks(filter?: TaskFilter): { tasks: Promise<Task[]>, grouped: Promise<TaskMap> } {
		if (!this.versionAndEngineCompatible(filter)) {
			return { tasks: Promise.resolve<Task[]>([]), grouped: Promise.resolve(new TaskMap()) };
		}
		const grouped = this.getGroupedTasks(filter ? filter.type : undefined);
		const tasks = grouped.then((map) => {
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
							let customizes = task.customizes();
							if (customizes && customizes.type === filter.type) {
								result.push(task);
							}
						}
					}
				}
			});
			return result;
		});
		return { tasks, grouped };
	}

	private doRunTaskCommand(tasks?: Task[]): void {
		const pickThen = (task: Task | undefined | null) => {
			if (task === undefined) {
				return;
			}
			if (task === null) {
				this.runConfigureTasks();
			} else {
				this.run(task, { attachProblemMatcher: true }, TaskRunSource.User).then(undefined, reason => {
					// eat the error, it has already been surfaced to the user and we don't care about it here
				});
			}
		};

		const placeholder = nls.localize('TaskService.pickRunTask', 'Select the task to run');

		this.showIgnoredFoldersMessage().then(() => {
			if (this.configurationService.getValue(USE_SLOW_PICKER)) {
				let taskResult: { tasks: Promise<Task[]>, grouped: Promise<TaskMap> } | undefined = undefined;
				if (!tasks) {
					taskResult = this.tasksAndGroupedTasks();
				}
				this.showQuickPick(tasks ? tasks : taskResult!.tasks, placeholder,
					{
						label: nls.localize('TaskService.noEntryToRunSlow', '$(plus) Configure a Task'),
						task: null
					},
					true).
					then((entry) => {
						return pickThen(entry ? entry.task : undefined);
					});
			} else {
				this.showTwoLevelQuickPick(placeholder,
					{
						label: nls.localize('TaskService.noEntryToRun', '$(plus) Configure a Task'),
						task: null
					}).
					then(pickThen);
			}
		});
	}

	private reRunTaskCommand(): void {
		if (!this.canRunCommand()) {
			return;
		}

		ProblemMatcherRegistry.onReady().then(() => {
			return this.editorService.saveAll({ reason: SaveReason.AUTO }).then(() => { // make sure all dirty editors are saved
				let executeResult = this.getTaskSystem().rerun();
				if (executeResult) {
					return this.handleExecuteResult(executeResult);
				} else {
					this.doRunTaskCommand();
					return Promise.resolve(undefined);
				}
			});
		});
	}

	private splitPerGroupType(tasks: Task[]): { none: Task[], defaults: Task[], users: Task[] } {
		let none: Task[] = [];
		let defaults: Task[] = [];
		let users: Task[] = [];
		for (let task of tasks) {
			if (task.configurationProperties.groupType === GroupType.default) {
				defaults.push(task);
			} else if (task.configurationProperties.groupType === GroupType.user) {
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
		let promise = this.getWorkspaceTasks().then(tasks => {
			const buildTasks: ConfiguringTask[] = [];
			for (const taskSource of tasks) {
				for (const task in taskSource[1].configurations?.byIdentifier) {
					if ((taskSource[1].configurations?.byIdentifier[task].configurationProperties.group === TaskGroup.Build) &&
						(taskSource[1].configurations?.byIdentifier[task].configurationProperties.groupType === GroupType.default)) {
						buildTasks.push(taskSource[1].configurations.byIdentifier[task]);
					}
				}
			}
			if (buildTasks.length === 1) {
				this.tryResolveTask(buildTasks[0]).then(resolvedTask => {
					this.run(resolvedTask, undefined, TaskRunSource.User).then(undefined, reason => {
						// eat the error, it has already been surfaced to the user and we don't care about it here
					});
				});
				return;
			}

			return this.getTasksForGroup(TaskGroup.Build).then((tasks) => {
				if (tasks.length > 0) {
					let { defaults, users } = this.splitPerGroupType(tasks);
					if (defaults.length === 1) {
						this.run(defaults[0], undefined, TaskRunSource.User).then(undefined, reason => {
							// eat the error, it has already been surfaced to the user and we don't care about it here
						});
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
						true).then((entry) => {
							let task: Task | undefined | null = entry ? entry.task : undefined;
							if (task === undefined) {
								return;
							}
							if (task === null) {
								this.runConfigureDefaultBuildTask();
								return;
							}
							this.run(task, { attachProblemMatcher: true }, TaskRunSource.User).then(undefined, reason => {
								// eat the error, it has already been surfaced to the user and we don't care about it here
							});
						});
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
					this.run(defaults[0], undefined, TaskRunSource.User).then(undefined, reason => {
						// eat the error, it has already been surfaced to the user and we don't care about it here
					});
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
				).then((entry) => {
					let task: Task | undefined | null = entry ? entry.task : undefined;
					if (task === undefined) {
						return;
					}
					if (task === null) {
						this.runConfigureTasks();
						return;
					}
					this.run(task, undefined, TaskRunSource.User).then(undefined, reason => {
						// eat the error, it has already been surfaced to the user and we don't care about it here
					});
				});
			});
		});
		this.progressService.withProgress(options, () => promise);
	}

	private runTerminateCommand(arg?: any): void {
		if (!this.canRunCommand()) {
			return;
		}
		if (arg === 'terminateAll') {
			this.terminateAll();
			return;
		}
		let runQuickPick = (promise?: Promise<Task[]>) => {
			this.showQuickPick(promise || this.getActiveTasks(),
				nls.localize('TaskService.taskToTerminate', 'Select a task to terminate'),
				{
					label: nls.localize('TaskService.noTaskRunning', 'No task is currently running'),
					task: undefined
				},
				false, true,
				undefined,
				[{
					label: nls.localize('TaskService.terminateAllRunningTasks', 'All Running Tasks'),
					id: 'terminateAll',
					task: undefined
				}]
			).then(entry => {
				if (entry && entry.id === 'terminateAll') {
					this.terminateAll();
				}
				let task: Task | undefined | null = entry ? entry.task : undefined;
				if (task === undefined || task === null) {
					return;
				}
				this.terminate(task);
			});
		};
		if (this.inTerminal()) {
			let identifier = this.getTaskIdentifier(arg);
			let promise: Promise<Task[]>;
			if (identifier !== undefined) {
				promise = this.getActiveTasks();
				promise.then((tasks) => {
					for (let task of tasks) {
						if (task.matches(identifier)) {
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
		let runQuickPick = (promise?: Promise<Task[]>) => {
			this.showQuickPick(promise || this.getActiveTasks(),
				nls.localize('TaskService.taskToRestart', 'Select the task to restart'),
				{
					label: nls.localize('TaskService.noTaskToRestart', 'No task to restart'),
					task: null
				},
				false, true
			).then(entry => {
				let task: Task | undefined | null = entry ? entry.task : undefined;
				if (task === undefined || task === null) {
					return;
				}
				this.restart(task);
			});
		};
		if (this.inTerminal()) {
			let identifier = this.getTaskIdentifier(arg);
			let promise: Promise<Task[]>;
			if (identifier !== undefined) {
				promise = this.getActiveTasks();
				promise.then((tasks) => {
					for (let task of tasks) {
						if (task.matches(identifier)) {
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
		let result: string | KeyedTaskIdentifier | undefined = undefined;
		if (Types.isString(arg)) {
			result = arg;
		} else if (arg && Types.isString((arg as TaskIdentifier).type)) {
			result = TaskDefinition.createTaskIdentifier(arg as TaskIdentifier, console);
		}
		return result;
	}

	private configHasTasks(taskConfig?: TaskConfig.ExternalTaskRunnerConfiguration): boolean {
		return !!taskConfig && !!taskConfig.tasks && taskConfig.tasks.length > 0;
	}

	private openTaskFile(resource: URI, taskSource: string) {
		let configFileCreated = false;
		this.fileService.resolve(resource).then((stat) => stat, () => undefined).then(async (stat) => {
			const fileExists: boolean = !!stat;
			const configValue = this.configurationService.inspect<TaskConfig.ExternalTaskRunnerConfiguration>('tasks');
			let tasksExistInFile: boolean;
			let target: ConfigurationTarget;
			switch (taskSource) {
				case TaskSourceKind.User: tasksExistInFile = this.configHasTasks(configValue.userValue); target = ConfigurationTarget.USER; break;
				case TaskSourceKind.WorkspaceFile: tasksExistInFile = this.configHasTasks(configValue.workspaceValue); target = ConfigurationTarget.WORKSPACE; break;
				default: tasksExistInFile = this.configHasTasks(configValue.value); target = ConfigurationTarget.WORKSPACE_FOLDER;
			}
			let content;
			if (!tasksExistInFile) {
				const pickTemplateResult = await this.quickInputService.pick(getTaskTemplates(), { placeHolder: nls.localize('TaskService.template', 'Select a Task Template') });
				if (!pickTemplateResult) {
					return Promise.resolve(undefined);
				}
				content = pickTemplateResult.content;
				let editorConfig = this.configurationService.getValue() as any;
				if (editorConfig.editor.insertSpaces) {
					content = content.replace(/(\n)(\t+)/g, (_, s1, s2) => s1 + ' '.repeat(s2.length * editorConfig.editor.tabSize));
				}
				configFileCreated = true;
				type TaskServiceTemplateClassification = {
					templateId?: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
					autoDetect: { classification: 'SystemMetaData', purpose: 'FeatureInsight', isMeasurement: true };
				};
				type TaskServiceEvent = {
					templateId?: string;
					autoDetect: boolean;
				};
				this.telemetryService.publicLog2<TaskServiceEvent, TaskServiceTemplateClassification>('taskService.template', {
					templateId: pickTemplateResult.id,
					autoDetect: pickTemplateResult.autoDetect
				});
			}

			if (!fileExists && content) {
				return this.textFileService.create([{ resource, value: content }]).then(result => {
					return result[0].resource;
				});
			} else if (fileExists && (tasksExistInFile || content)) {
				if (content) {
					this.configurationService.updateValue('tasks', json.parse(content), target);
				}
				return stat?.resource;
			}
			return undefined;
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
	}

	private isTaskEntry(value: IQuickPickItem): value is IQuickPickItem & { task: Task } {
		let candidate: IQuickPickItem & { task: Task } = value as any;
		return candidate && !!candidate.task;
	}

	private isSettingEntry(value: IQuickPickItem): value is IQuickPickItem & { settingType: string } {
		let candidate: IQuickPickItem & { settingType: string } = value as any;
		return candidate && !!candidate.settingType;
	}

	private configureTask(task: Task) {
		if (ContributedTask.is(task)) {
			this.customize(task, undefined, true);
		} else if (CustomTask.is(task)) {
			this.openConfig(task);
		} else if (ConfiguringTask.is(task)) {
			// Do nothing.
		}
	}

	private handleSelection(selection: TaskQuickPickEntryType | undefined) {
		if (!selection) {
			return;
		}
		if (this.isTaskEntry(selection)) {
			this.configureTask(selection.task);
		} else if (this.isSettingEntry(selection)) {
			const taskQuickPick = new TaskQuickPick(this, this.configurationService, this.quickInputService, this.notificationService, this.dialogService);
			taskQuickPick.handleSettingOption(selection.settingType);
		} else if (selection.folder && (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY)) {
			this.openTaskFile(selection.folder.toResource('.vscode/tasks.json'), TaskSourceKind.Workspace);
		} else {
			const resource = this.getResourceForKind(TaskSourceKind.User);
			if (resource) {
				this.openTaskFile(resource, TaskSourceKind.User);
			}
		}
	}

	public getTaskDescription(task: Task | ConfiguringTask): string | undefined {
		let description: string | undefined;
		if (task._source.kind === TaskSourceKind.User) {
			description = nls.localize('taskQuickPick.userSettings', 'User Settings');
		} else if (task._source.kind === TaskSourceKind.WorkspaceFile) {
			description = task.getWorkspaceFileName();
		} else if (this.needsFolderQualification()) {
			let workspaceFolder = task.getWorkspaceFolder();
			if (workspaceFolder) {
				description = workspaceFolder.name;
			}
		}
		return description;
	}

	private async runConfigureTasks(): Promise<void> {
		if (!(await this.trust())) {
			return;
		}

		if (!this.canRunCommand()) {
			return undefined;
		}
		let taskPromise: Promise<TaskMap>;
		if (this.schemaVersion === JsonSchemaVersion.V2_0_0) {
			taskPromise = this.getGroupedTasks();
		} else {
			taskPromise = Promise.resolve(new TaskMap());
		}

		let stats = this.contextService.getWorkspace().folders.map<Promise<IFileStat | undefined>>((folder) => {
			return this.fileService.resolve(folder.toResource('.vscode/tasks.json')).then(stat => stat, () => undefined);
		});

		let createLabel = nls.localize('TaskService.createJsonFile', 'Create tasks.json file from template');
		let openLabel = nls.localize('TaskService.openJsonFile', 'Open tasks.json file');
		const tokenSource = new CancellationTokenSource();
		const cancellationToken: CancellationToken = tokenSource.token;
		let entries = Promise.all(stats).then((stats) => {
			return taskPromise.then((taskMap) => {
				let entries: QuickPickInput<TaskQuickPickEntryType>[] = [];
				let needsCreateOrOpen: boolean = true;
				let tasks = taskMap.all();
				if (tasks.length > 0) {
					tasks = tasks.sort((a, b) => a._label.localeCompare(b._label));
					for (let task of tasks) {
						entries.push({ label: task._label, task, description: this.getTaskDescription(task), detail: this.showDetail() ? task.configurationProperties.detail : undefined });
						if (!ContributedTask.is(task)) {
							needsCreateOrOpen = false;
						}
					}
				}
				if (needsCreateOrOpen) {
					let label = stats[0] !== undefined ? openLabel : createLabel;
					if (entries.length) {
						entries.push({ type: 'separator' });
					}
					entries.push({ label, folder: this.contextService.getWorkspace().folders[0] });
				}
				if ((entries.length === 1) && !needsCreateOrOpen) {
					tokenSource.cancel();
				}
				return entries;
			});
		});

		const timeout: boolean = await Promise.race([new Promise<boolean>(async (resolve) => {
			await entries;
			resolve(false);
		}), new Promise<boolean>((resolve) => {
			const timer = setTimeout(() => {
				clearTimeout(timer);
				resolve(true);
			}, 200);
		})]);

		if (!timeout && ((await entries).length === 1) && this.configurationService.getValue<boolean>(QUICKOPEN_SKIP_CONFIG)) {
			const entry: any = <any>((await entries)[0]);
			if (entry.task) {
				this.handleSelection(entry);
				return;
			}
		}

		const entriesWithSettings = entries.then(resolvedEntries => {
			resolvedEntries.push(...TaskQuickPick.allSettingEntries(this.configurationService));
			return resolvedEntries;
		});

		this.quickInputService.pick(entriesWithSettings,
			{ placeHolder: nls.localize('TaskService.pickTask', 'Select a task to configure') }, cancellationToken).
			then(async (selection) => {
				if (cancellationToken.isCancellationRequested) {
					// canceled when there's only one task
					const task = (await entries)[0];
					if ((<any>task).task) {
						selection = <TaskQuickPickEntryType>task;
					}
				}
				this.handleSelection(selection);
			});
	}

	private runConfigureDefaultBuildTask(arg?: any): void {
		if (!this.canRunCommand()) {
			return;
		}

		let selectedTask: Task | undefined;

		this.getGroupedTasks().then(async (grouped) => {
			const allTasks: Task[] = grouped.all();
			for (let task of allTasks) {
				if (task.configurationProperties.group?._id === TaskGroup.Build._id && task.configurationProperties.groupType === GroupType.default) {
					selectedTask = task;
					break;
				}
			}

			let identifier = this.getTaskIdentifier(arg);
			if (identifier) {
				const resolvedTask: Task | undefined = await this.resolveTask(grouped, identifier);
				if (resolvedTask) {
					this.doConfigureDefaultBuildTask(resolvedTask, selectedTask);
					return;
				}
			}

			this.showConfigureDefaultBuildTask(allTasks, selectedTask);
		}, () => {
			this.showConfigureDefaultBuildTask();
		});
	}

	private doConfigureDefaultBuildTask(newDefaultTask: Task, existingDefaultTask?: Task): void {
		if (!InMemoryTask.is(newDefaultTask)) {
			this.customize(newDefaultTask, { group: { kind: 'build', isDefault: true } }, true).then(() => {
				if (existingDefaultTask && (newDefaultTask !== existingDefaultTask) && !InMemoryTask.is(existingDefaultTask)) {
					this.customize(existingDefaultTask, { group: 'build' }, false);
				}
			});
		}
	}

	private showConfigureDefaultBuildTask(tasks?: Task[], selectedTask?: Task): void {
		if (this.schemaVersion === JsonSchemaVersion.V2_0_0) {
			if (!tasks || tasks.length === 0) {
				this.runConfigureTasks();
				return;
			}

			let selectedEntry: TaskQuickPickEntry;
			if (selectedTask) {
				selectedEntry = {
					label: nls.localize('TaskService.defaultBuildTaskExists', '{0} is already marked as the default build task', selectedTask.getQualifiedLabel()),
					task: selectedTask,
					detail: this.showDetail() ? selectedTask.configurationProperties.detail : undefined
				};
			}
			this.showIgnoredFoldersMessage().then(() => {
				this.showQuickPick(tasks,
					nls.localize('TaskService.pickDefaultBuildTask', 'Select the task to be used as the default build task'), undefined, true, false, selectedEntry).
					then((entry) => {
						let task: Task | undefined | null = entry ? entry.task : undefined;
						if ((task === undefined) || (task === null)) {
							return;
						}
						if (task === selectedTask && CustomTask.is(task)) {
							this.openConfig(task);
						}
						this.doConfigureDefaultBuildTask(task, selectedTask);
					});
			});
		} else {
			this.runConfigureTasks();
		}
	}

	private async resolveTask(grouped: TaskMap, identifier: string | KeyedTaskIdentifier | undefined): Promise<Task | undefined> {
		let resolver = this.createResolver(grouped);
		let folderURIs: (URI | string)[] = this.contextService.getWorkspace().folders.map(folder => folder.uri);
		if (this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE) {
			folderURIs.push(this.contextService.getWorkspace().configuration!);
		}
		folderURIs.push(USER_TASKS_GROUP_KEY);
		for (let uri of folderURIs) {
			let task = await resolver.resolve(uri, identifier);
			if (task) {
				return task;
			}
		}
		return;
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
				let selectedTask: Task | undefined;
				let selectedEntry: TaskQuickPickEntry;

				for (let task of tasks) {
					if (task.configurationProperties.group === TaskGroup.Test && task.configurationProperties.groupType === GroupType.default) {
						selectedTask = task;
						break;
					}
				}
				if (selectedTask) {
					selectedEntry = {
						label: nls.localize('TaskService.defaultTestTaskExists', '{0} is already marked as the default test task.', selectedTask.getQualifiedLabel()),
						task: selectedTask,
						detail: this.showDetail() ? selectedTask.configurationProperties.detail : undefined
					};
				}

				this.showIgnoredFoldersMessage().then(() => {
					this.showQuickPick(tasks,
						nls.localize('TaskService.pickDefaultTestTask', 'Select the task to be used as the default test task'), undefined, true, false, selectedEntry).then((entry) => {
							let task: Task | undefined | null = entry ? entry.task : undefined;
							if (!task) {
								return;
							}
							if (task === selectedTask && CustomTask.is(task)) {
								this.openConfig(task);
							}
							if (!InMemoryTask.is(task)) {
								this.customize(task, { group: { kind: 'test', isDefault: true } }, true).then(() => {
									if (selectedTask && (task !== selectedTask) && !InMemoryTask.is(selectedTask)) {
										this.customize(selectedTask, { group: 'test' }, false);
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

	public async runShowTasks(): Promise<void> {
		if (!this.canRunCommand()) {
			return;
		}
		const activeTasksPromise: Promise<Task[]> = this.getActiveTasks();
		const activeTasks: Task[] = await activeTasksPromise;
		let group: string | undefined;
		if (activeTasks.length === 1) {
			this._taskSystem!.revealTask(activeTasks[0]);
		} else if (activeTasks.every((task) => {
			if (InMemoryTask.is(task)) {
				return false;
			}

			if (!group) {
				group = task.command.presentation?.group;
			}
			return task.command.presentation?.group && (task.command.presentation.group === group);
		})) {
			this._taskSystem!.revealTask(activeTasks[0]);
		} else {
			this.showQuickPick(activeTasksPromise,
				nls.localize('TaskService.pickShowTask', 'Select the task to show its output'),
				{
					label: nls.localize('TaskService.noTaskIsRunning', 'No task is running'),
					task: null
				},
				false, true
			).then((entry) => {
				let task: Task | undefined | null = entry ? entry.task : undefined;
				if (task === undefined || task === null) {
					return;
				}
				this._taskSystem!.revealTask(task);
			});
		}
	}

	private async createTasksDotOld(folder: IWorkspaceFolder): Promise<[URI, URI] | undefined> {
		const tasksFile = folder.toResource('.vscode/tasks.json');
		if (await this.fileService.exists(tasksFile)) {
			const oldFile = tasksFile.with({ path: `${tasksFile.path}.old` });
			await this.fileService.copy(tasksFile, oldFile, true);
			return [oldFile, tasksFile];
		}
		return undefined;
	}

	private upgradeTask(task: Task, suppressTaskName: boolean, globalConfig: { windows?: CommandUpgrade, osx?: CommandUpgrade, linux?: CommandUpgrade }): TaskConfig.CustomTask | TaskConfig.ConfiguringTask | undefined {
		if (!CustomTask.is(task)) {
			return;
		}
		const configElement: any = {
			label: task._label
		};
		const oldTaskTypes = new Set(['gulp', 'jake', 'grunt']);
		if (Types.isString(task.command.name) && oldTaskTypes.has(task.command.name)) {
			configElement.type = task.command.name;
			configElement.task = task.command.args![0];
		} else {
			if (task.command.runtime === RuntimeType.Shell) {
				configElement.type = RuntimeType.toString(RuntimeType.Shell);
			}
			if (task.command.name && !suppressTaskName && !globalConfig.windows?.command && !globalConfig.osx?.command && !globalConfig.linux?.command) {
				configElement.command = task.command.name;
			} else if (suppressTaskName) {
				configElement.command = task._source.config.element.command;
			}
			if (task.command.args && (!Types.isArray(task.command.args) || (task.command.args.length > 0))) {
				if (!globalConfig.windows?.args && !globalConfig.osx?.args && !globalConfig.linux?.args) {
					configElement.args = task.command.args;
				} else {
					configElement.args = task._source.config.element.args;
				}
			}
		}

		if (task.configurationProperties.presentation) {
			configElement.presentation = task.configurationProperties.presentation;
		}
		if (task.configurationProperties.isBackground) {
			configElement.isBackground = task.configurationProperties.isBackground;
		}
		if (task.configurationProperties.problemMatchers) {
			configElement.problemMatcher = task._source.config.element.problemMatcher;
		}
		if (task.configurationProperties.group) {
			configElement.group = task.configurationProperties.group;
		}

		task._source.config.element = configElement;
		const tempTask = new CustomTask(task._id, task._source, task._label, task.type, task.command, task.hasDefinedMatchers, task.runOptions, task.configurationProperties);
		const configTask = this.createCustomizableTask(tempTask);
		if (configTask) {
			return configTask;
		}
		return;
	}

	private async upgrade(): Promise<void> {
		if (this.schemaVersion === JsonSchemaVersion.V2_0_0) {
			return;
		}

		if (!this.workspaceTrustManagementService.isWorkspaceTrusted()) {
			this._register(Event.once(this.workspaceTrustManagementService.onDidChangeTrust)(isTrusted => {
				if (isTrusted) {
					this.upgrade();
				}
			}));
			return;
		}

		const tasks = await this.getGroupedTasks();
		const fileDiffs: [URI, URI][] = [];
		for (const folder of this.workspaceFolders) {
			const diff = await this.createTasksDotOld(folder);
			if (diff) {
				fileDiffs.push(diff);
			}
			if (!diff) {
				continue;
			}

			const configTasks: (TaskConfig.CustomTask | TaskConfig.ConfiguringTask)[] = [];
			const suppressTaskName = !!this.configurationService.getValue('tasks.suppressTaskName', { resource: folder.uri });
			const globalConfig = {
				windows: <CommandUpgrade>this.configurationService.getValue('tasks.windows', { resource: folder.uri }),
				osx: <CommandUpgrade>this.configurationService.getValue('tasks.osx', { resource: folder.uri }),
				linux: <CommandUpgrade>this.configurationService.getValue('tasks.linux', { resource: folder.uri })
			};
			tasks.get(folder).forEach(task => {
				const configTask = this.upgradeTask(task, suppressTaskName, globalConfig);
				if (configTask) {
					configTasks.push(configTask);
				}
			});
			this._taskSystem = undefined;
			this._workspaceTasksPromise = undefined;
			await this.writeConfiguration(folder, 'tasks.tasks', configTasks);
			await this.writeConfiguration(folder, 'tasks.version', '2.0.0');
			if (this.configurationService.getValue('tasks.showOutput', { resource: folder.uri })) {
				await this.configurationService.updateValue('tasks.showOutput', undefined, { resource: folder.uri });
			}
			if (this.configurationService.getValue('tasks.isShellCommand', { resource: folder.uri })) {
				await this.configurationService.updateValue('tasks.isShellCommand', undefined, { resource: folder.uri });
			}
			if (this.configurationService.getValue('tasks.suppressTaskName', { resource: folder.uri })) {
				await this.configurationService.updateValue('tasks.suppressTaskName', undefined, { resource: folder.uri });
			}
		}
		this.updateSetup();

		this.notificationService.prompt(Severity.Warning,
			fileDiffs.length === 1 ?
				nls.localize('taskService.upgradeVersion', "The deprecated tasks version 0.1.0 has been removed. Your tasks have been upgraded to version 2.0.0. Open the diff to review the upgrade.")
				: nls.localize('taskService.upgradeVersionPlural', "The deprecated tasks version 0.1.0 has been removed. Your tasks have been upgraded to version 2.0.0. Open the diffs to review the upgrade."),
			[{
				label: fileDiffs.length === 1 ? nls.localize('taskService.openDiff', "Open diff") : nls.localize('taskService.openDiffs', "Open diffs"),
				run: async () => {
					for (const upgrade of fileDiffs) {
						await this.editorService.openEditor({
							original: { resource: upgrade[0] },
							modified: { resource: upgrade[1] }
						});
					}
				}
			}]
		);
	}
}
