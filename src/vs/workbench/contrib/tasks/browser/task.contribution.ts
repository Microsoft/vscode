/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

import { Disposable } from 'vs/base/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { MenuRegistry, MenuId, SyncActionDescriptor } from 'vs/platform/actions/common/actions';

import { ProblemMatcherRegistry } from 'vs/workbench/contrib/tasks/common/problemMatcher';
import { IProgressService, ProgressLocation } from 'vs/platform/progress/common/progress';

import * as jsonContributionRegistry from 'vs/platform/jsonschemas/common/jsonContributionRegistry';
import { IJSONSchema } from 'vs/base/common/jsonSchema';

import { StatusbarAlignment, IStatusbarService, IStatusbarEntryAccessor, IStatusbarEntry } from 'vs/workbench/services/statusbar/common/statusbar';

import { IOutputChannelRegistry, Extensions as OutputExt } from 'vs/workbench/services/output/common/output';

import { TaskEvent, TaskEventKind, TaskGroup, TASK_RUNNING_STATE } from 'vs/workbench/contrib/tasks/common/tasks';
import { ITaskService } from 'vs/workbench/contrib/tasks/common/taskService';

import { Extensions as WorkbenchExtensions, IWorkbenchContributionsRegistry, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IWorkbenchActionRegistry, Extensions as ActionExtensions } from 'vs/workbench/common/actions';
import { RunAutomaticTasks, ManageAutomaticTaskRunning } from 'vs/workbench/contrib/tasks/browser/runAutomaticTasks';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import schemaVersion1 from '../common/jsonSchema_v1';
import schemaVersion2, { updateProblemMatchers } from '../common/jsonSchema_v2';
import { AbstractTaskService, ConfigureTaskAction } from 'vs/workbench/contrib/tasks/browser/abstractTaskService';
import { tasksSchemaId } from 'vs/workbench/services/configuration/common/configuration';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { WorkbenchStateContext } from 'vs/workbench/browser/contextkeys';
import { IQuickAccessRegistry, Extensions as QuickAccessExtensions } from 'vs/platform/quickinput/common/quickAccess';
import { TasksQuickAccessProvider } from 'vs/workbench/contrib/tasks/browser/tasksQuickAccess';

let tasksCategory = nls.localize('tasksCategory', "Tasks");

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(RunAutomaticTasks, LifecyclePhase.Eventually);

const actionRegistry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(ManageAutomaticTaskRunning), 'Tasks: Manage Automatic Tasks in Folder', tasksCategory);

export class TaskStatusBarContributions extends Disposable implements IWorkbenchContribution {
	private runningTasksStatusItem: IStatusbarEntryAccessor | undefined;
	private activeTasksCount: number = 0;

	constructor(
		@ITaskService private readonly taskService: ITaskService,
		@IStatusbarService private readonly statusbarService: IStatusbarService,
		@IProgressService private readonly progressService: IProgressService
	) {
		super();
		this.registerListeners();
	}

	private registerListeners(): void {
		let promise: Promise<void> | undefined = undefined;
		let resolver: (value?: void | Thenable<void>) => void;
		this.taskService.onDidStateChange(event => {
			if (event.kind === TaskEventKind.Changed) {
				this.updateRunningTasksStatus();
			}

			if (!this.ignoreEventForUpdateRunningTasksCount(event)) {
				switch (event.kind) {
					case TaskEventKind.Active:
						this.activeTasksCount++;
						if (this.activeTasksCount === 1) {
							if (!promise) {
								promise = new Promise<void>((resolve) => {
									resolver = resolve;
								});
							}
						}
						break;
					case TaskEventKind.Inactive:
						// Since the exiting of the sub process is communicated async we can't order inactive and terminate events.
						// So try to treat them accordingly.
						if (this.activeTasksCount > 0) {
							this.activeTasksCount--;
							if (this.activeTasksCount === 0) {
								if (promise && resolver!) {
									resolver!();
								}
							}
						}
						break;
					case TaskEventKind.Terminated:
						if (this.activeTasksCount !== 0) {
							this.activeTasksCount = 0;
							if (promise && resolver!) {
								resolver!();
							}
						}
						break;
				}
			}

			if (promise && (event.kind === TaskEventKind.Active) && (this.activeTasksCount === 1)) {
				this.progressService.withProgress({ location: ProgressLocation.Window, command: 'workbench.action.tasks.showTasks' }, progress => {
					progress.report({ message: nls.localize('building', 'Building...') });
					return promise!;
				}).then(() => {
					promise = undefined;
				});
			}
		});
	}

	private async updateRunningTasksStatus(): Promise<void> {
		const tasks = await this.taskService.getActiveTasks();
		if (tasks.length === 0) {
			if (this.runningTasksStatusItem) {
				this.runningTasksStatusItem.dispose();
				this.runningTasksStatusItem = undefined;
			}
		} else {
			const itemProps: IStatusbarEntry = {
				text: `$(tools) ${tasks.length}`,
				ariaLabel: nls.localize('numberOfRunningTasks', "{0} running tasks", tasks.length),
				tooltip: nls.localize('runningTasks', "Show Running Tasks"),
				command: 'workbench.action.tasks.showTasks',
			};

			if (!this.runningTasksStatusItem) {
				this.runningTasksStatusItem = this.statusbarService.addEntry(itemProps, 'status.runningTasks', nls.localize('status.runningTasks', "Running Tasks"), StatusbarAlignment.LEFT, 49 /* Medium Priority, next to Markers */);
			} else {
				this.runningTasksStatusItem.update(itemProps);
			}
		}
	}

	private ignoreEventForUpdateRunningTasksCount(event: TaskEvent): boolean {
		if (!this.taskService.inTerminal()) {
			return false;
		}

		if (event.group !== TaskGroup.Build) {
			return true;
		}

		if (!event.__task) {
			return false;
		}

		return event.__task.configurationProperties.problemMatchers === undefined || event.__task.configurationProperties.problemMatchers.length === 0;
	}
}

workbenchRegistry.registerWorkbenchContribution(TaskStatusBarContributions, LifecyclePhase.Restored);

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


MenuRegistry.appendMenuItem(MenuId.CommandPalette, ({
	command: {
		id: 'workbench.action.tasks.openWorkspaceFileTasks',
		title: nls.localize('workbench.action.tasks.openWorkspaceFileTasks', "Open Workspace Tasks"),
		category: tasksCategory
	},
	when: WorkbenchStateContext.isEqualTo('workspace')
}));

MenuRegistry.addCommand({ id: ConfigureTaskAction.ID, title: { value: ConfigureTaskAction.TEXT, original: 'Configure Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.showLog', title: { value: nls.localize('ShowLogAction.label', "Show Task Log"), original: 'Show Task Log' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.runTask', title: { value: nls.localize('RunTaskAction.label', "Run Task"), original: 'Run Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.reRunTask', title: { value: nls.localize('ReRunTaskAction.label', "Rerun Last Task"), original: 'Rerun Last Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.restartTask', title: { value: nls.localize('RestartTaskAction.label', "Restart Running Task"), original: 'Restart Running Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.showTasks', title: { value: nls.localize('ShowTasksAction.label', "Show Running Tasks"), original: 'Show Running Tasks' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.terminate', title: { value: nls.localize('TerminateAction.label', "Terminate Task"), original: 'Terminate Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.build', title: { value: nls.localize('BuildAction.label', "Run Build Task"), original: 'Run Build Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.test', title: { value: nls.localize('TestAction.label', "Run Test Task"), original: 'Run Test Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.configureDefaultBuildTask', title: { value: nls.localize('ConfigureDefaultBuildTask.label', "Configure Default Build Task"), original: 'Configure Default Build Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.configureDefaultTestTask', title: { value: nls.localize('ConfigureDefaultTestTask.label', "Configure Default Test Task"), original: 'Configure Default Test Task' }, category: { value: tasksCategory, original: 'Tasks' } });
MenuRegistry.addCommand({ id: 'workbench.action.tasks.openUserTasks', title: { value: nls.localize('workbench.action.tasks.openUserTasks', "Open User Tasks"), original: 'Open User Tasks' }, category: { value: tasksCategory, original: 'Tasks' } });
// MenuRegistry.addCommand( { id: 'workbench.action.tasks.rebuild', title: nls.localize('RebuildAction.label', 'Run Rebuild Task'), category: tasksCategory });
// MenuRegistry.addCommand( { id: 'workbench.action.tasks.clean', title: nls.localize('CleanAction.label', 'Run Clean Task'), category: tasksCategory });

KeybindingsRegistry.registerKeybindingRule({
	id: 'workbench.action.tasks.build',
	weight: KeybindingWeight.WorkbenchContrib,
	when: undefined,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_B
});

// Tasks Output channel. Register it before using it in Task Service.
let outputChannelRegistry = Registry.as<IOutputChannelRegistry>(OutputExt.OutputChannels);
outputChannelRegistry.registerChannel({ id: AbstractTaskService.OutputChannelId, label: AbstractTaskService.OutputChannelLabel, log: false });


// Register Quick Access
const quickAccessRegistry = (Registry.as<IQuickAccessRegistry>(QuickAccessExtensions.Quickaccess));
const tasksPickerContextKey = 'inTasksPicker';

quickAccessRegistry.registerQuickAccessProvider({
	ctor: TasksQuickAccessProvider,
	prefix: TasksQuickAccessProvider.PREFIX,
	contextKey: tasksPickerContextKey,
	placeholder: nls.localize('tasksQuickAccessPlaceholder', "Type the name of a task to run."),
	helpEntries: [{ description: nls.localize('tasksQuickAccessHelp', "Run Task"), needsEditor: false }]
});

// tasks.json validation
let schema: IJSONSchema = {
	id: tasksSchemaId,
	description: 'Task definition file',
	type: 'object',
	allowTrailingCommas: true,
	allowComments: true,
	default: {
		version: '2.0.0',
		tasks: [
			{
				label: 'My Task',
				command: 'echo hello',
				type: 'shell',
				args: [],
				problemMatcher: ['$tsc'],
				presentation: {
					reveal: 'always'
				},
				group: 'build'
			}
		]
	}
};

schema.definitions = {
	...schemaVersion1.definitions,
	...schemaVersion2.definitions,
};
schema.oneOf = [...(schemaVersion2.oneOf || []), ...(schemaVersion1.oneOf || [])];

let jsonRegistry = <jsonContributionRegistry.IJSONContributionRegistry>Registry.as(jsonContributionRegistry.Extensions.JSONContribution);
jsonRegistry.registerSchema(tasksSchemaId, schema);

ProblemMatcherRegistry.onMatcherChanged(() => {
	updateProblemMatchers();
	jsonRegistry.notifySchemaChanged(tasksSchemaId);
});

const configurationRegistry = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration);
configurationRegistry.registerConfiguration({
	id: 'task',
	order: 100,
	title: nls.localize('tasksConfigurationTitle', "Tasks"),
	type: 'object',
	properties: {
		'task.problemMatchers.neverPrompt': {
			markdownDescription: nls.localize('task.problemMatchers.neverPrompt', "Configures whether to show the problem matcher prompt when running a task. Set to `true` to never prompt, or use a dictionary of task types to turn off prompting only for specific task types."),
			'oneOf': [
				{
					type: 'boolean',
					markdownDescription: nls.localize('task.problemMatchers.neverPrompt.boolean', 'Sets problem matcher prompting behavior for all tasks.')
				},
				{
					type: 'object',
					patternProperties: {
						'.*': {
							type: 'boolean'
						}
					},
					markdownDescription: nls.localize('task.problemMatchers.neverPrompt.array', 'An object containing task type-boolean pairs to never prompt for problem matchers on.'),
					default: {
						'shell': true
					}
				}
			],
			default: false
		},
		'task.autoDetect': {
			markdownDescription: nls.localize('task.autoDetect', "Controls enablement of `provideTasks` for all task provider extension. If the Tasks: Run Task command is slow, disabling auto detect for task providers may help. Individual extensions may also provide settings that disable auto detection."),
			type: 'string',
			enum: ['on', 'off'],
			default: 'on'
		},
		'task.slowProviderWarning': {
			markdownDescription: nls.localize('task.slowProviderWarning', "Configures whether a warning is shown when a provider is slow"),
			'oneOf': [
				{
					type: 'boolean',
					markdownDescription: nls.localize('task.slowProviderWarning.boolean', 'Sets the slow provider warning for all tasks.')
				},
				{
					type: 'array',
					items: {
						type: 'string',
						markdownDescription: nls.localize('task.slowProviderWarning.array', 'An array of task types to never show the slow provider warning.')
					}
				}
			],
			default: true
		},
		'task.quickOpen.history': {
			markdownDescription: nls.localize('task.quickOpen.history', "Controls the number of recent items tracked in task quick open dialog."),
			type: 'number',
			default: 30, minimum: 0, maximum: 30
		},
		'task.quickOpen.detail': {
			markdownDescription: nls.localize('task.quickOpen.detail', "Controls whether to show the task detail for task that have a detail in the Run Task quick pick."),
			type: 'boolean',
			default: true
		},
		'task.quickOpen.skip': {
			type: 'boolean',
			description: nls.localize('task.quickOpen.skip', "Controls whether the task quick pick is skipped when there is only one task to pick from."),
			default: false
		},
		'task.quickOpen.showAll': {
			type: 'boolean',
			description: nls.localize('task.quickOpen.showAll', "Causes the Tasks: Run Task command to use the slower \"show all\" behavior instead of the faster two level picker where tasks are grouped by provider."),
			default: false
		},
		'task.saveBeforeRun': {
			markdownDescription: nls.localize(
				'task.saveBeforeRun',
				'Save all dirty editors before running a task.'
			),
			type: 'string',
			enum: ['always', 'never', 'prompt'],
			enumDescriptions: [
				nls.localize('task.saveBeforeRun.always', 'Always saves all editors before running.'),
				nls.localize('task.saveBeforeRun.never', 'Never saves editors before running.'),
				nls.localize('task.SaveBeforeRun.prompt', 'Prompts whether to save editors before running.'),
			],
			default: 'always',
		},
	}
});
