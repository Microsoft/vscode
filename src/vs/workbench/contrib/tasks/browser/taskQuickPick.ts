/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as Objects from 'vs/base/common/objects';
import { Task, ContributedTask, CustomTask, ConfiguringTask, TaskSorter, KeyedTaskIdentifier } from 'vs/workbench/contrib/tasks/common/tasks';
import { IWorkspace, IWorkspaceFolder } from 'vs/platform/workspace/common/workspace';
import * as Types from 'vs/base/common/types';
import { ITaskService, WorkspaceFolderTaskResult } from 'vs/workbench/contrib/tasks/common/taskService';
import { IQuickPickItem, QuickPickInput, IQuickPick, IQuickInputButton } from 'vs/base/parts/quickinput/common/quickInput';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { Disposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { Codicon } from 'vs/base/common/codicons';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';

export const QUICKOPEN_DETAIL_CONFIG = 'task.quickOpen.detail';
export const QUICKOPEN_SKIP_CONFIG = 'task.quickOpen.skip';

export function isWorkspaceFolder(folder: IWorkspace | IWorkspaceFolder): folder is IWorkspaceFolder {
	return 'uri' in folder;
}

export interface TaskQuickPickEntry extends IQuickPickItem {
	task: Task | undefined | null;
}

export interface TaskTwoLevelQuickPickEntry extends IQuickPickItem {
	task: Task | ConfiguringTask | string | undefined | null;
	settingType?: string;
}

const SHOW_ALL: string = nls.localize('taskQuickPick.showAll', "Show All Tasks...");

export const configureTaskIcon = registerIcon('tasks-list-configure', Codicon.gear, nls.localize('configureTaskIcon', 'Configuration icon in the tasks selection list.'));
const removeTaskIcon = registerIcon('tasks-remove', Codicon.close, nls.localize('removeTaskIcon', 'Icon for remove in the tasks selection list.'));

export class TaskQuickPick extends Disposable {
	private sorter: TaskSorter;
	private topLevelEntries: QuickPickInput<TaskTwoLevelQuickPickEntry>[] | undefined;
	constructor(
		private taskService: ITaskService,
		private configurationService: IConfigurationService,
		private quickInputService: IQuickInputService,
		private notificationService: INotificationService,
		private dialogService: IDialogService) {
		super();
		this.sorter = this.taskService.createSorter();
	}

	private showDetail(): boolean {
		// Ensure invalid values get converted into boolean values
		return !!this.configurationService.getValue(QUICKOPEN_DETAIL_CONFIG);
	}

	private guessTaskLabel(task: Task | ConfiguringTask): string {
		if (task._label) {
			return task._label;
		}
		if (ConfiguringTask.is(task)) {
			let label: string = task.configures.type;
			const configures: Partial<KeyedTaskIdentifier> = Objects.deepClone(task.configures);
			delete configures['_key'];
			delete configures['type'];
			Object.keys(configures).forEach(key => label += `: ${configures[key]}`);
			return label;
		}
		return '';
	}

	private createTaskEntry(task: Task | ConfiguringTask, extraButtons: IQuickInputButton[] = []): TaskTwoLevelQuickPickEntry {
		const entry: TaskTwoLevelQuickPickEntry = { label: this.guessTaskLabel(task), description: this.taskService.getTaskDescription(task), task, detail: this.showDetail() ? task.configurationProperties.detail : undefined };
		entry.buttons = [{ iconClass: ThemeIcon.asClassName(configureTaskIcon), tooltip: nls.localize('configureTask', "Configure Task") }, ...extraButtons];
		return entry;
	}

	private createEntriesForGroup(entries: QuickPickInput<TaskTwoLevelQuickPickEntry>[], tasks: (Task | ConfiguringTask)[],
		groupLabel: string, extraButtons: IQuickInputButton[] = []) {
		entries.push({ type: 'separator', label: groupLabel });
		tasks.forEach(task => {
			entries.push(this.createTaskEntry(task, extraButtons));
		});
	}

	private createTypeEntries(entries: QuickPickInput<TaskTwoLevelQuickPickEntry>[], types: string[]) {
		entries.push({ type: 'separator', label: nls.localize('contributedTasks', "contributed") });
		types.forEach(type => {
			entries.push({ label: `$(folder) ${type}`, task: type, ariaLabel: nls.localize('taskType', "All {0} tasks", type) });
		});
		entries.push({ label: SHOW_ALL, task: SHOW_ALL, alwaysShow: true });
	}

	private handleFolderTaskResult(result: Map<string, WorkspaceFolderTaskResult>): (Task | ConfiguringTask)[] {
		let tasks: (Task | ConfiguringTask)[] = [];
		Array.from(result).forEach(([key, folderTasks]) => {
			if (folderTasks.set) {
				tasks.push(...folderTasks.set.tasks);
			}
			if (folderTasks.configurations) {
				for (const configuration in folderTasks.configurations.byIdentifier) {
					tasks.push(folderTasks.configurations.byIdentifier[configuration]);
				}
			}
		});
		return tasks;
	}

	private dedupeConfiguredAndRecent(recentTasks: (Task | ConfiguringTask)[], configuredTasks: (Task | ConfiguringTask)[]): { configuredTasks: (Task | ConfiguringTask)[], recentTasks: (Task | ConfiguringTask)[] } {
		let dedupedConfiguredTasks: (Task | ConfiguringTask)[] = [];
		const foundRecentTasks: boolean[] = Array(recentTasks.length).fill(false);
		for (let j = 0; j < configuredTasks.length; j++) {
			const workspaceFolder = configuredTasks[j].getWorkspaceFolder()?.uri.toString();
			const definition = configuredTasks[j].getDefinition()?._key;
			const type = configuredTasks[j].type;
			const label = configuredTasks[j]._label;
			const recentKey = configuredTasks[j].getRecentlyUsedKey();
			const findIndex = recentTasks.findIndex((value) => {
				return (workspaceFolder && definition && value.getWorkspaceFolder()?.uri.toString() === workspaceFolder
					&& ((value.getDefinition()?._key === definition) || (value.type === type && value._label === label)))
					|| (recentKey && value.getRecentlyUsedKey() === recentKey);
			});
			if (findIndex === -1) {
				dedupedConfiguredTasks.push(configuredTasks[j]);
			} else {
				recentTasks[findIndex] = configuredTasks[j];
				foundRecentTasks[findIndex] = true;
			}
		}
		dedupedConfiguredTasks = dedupedConfiguredTasks.sort((a, b) => this.sorter.compare(a, b));
		const prunedRecentTasks: (Task | ConfiguringTask)[] = [];
		for (let i = 0; i < recentTasks.length; i++) {
			if (foundRecentTasks[i] || ConfiguringTask.is(recentTasks[i])) {
				prunedRecentTasks.push(recentTasks[i]);
			}
		}
		return { configuredTasks: dedupedConfiguredTasks, recentTasks: prunedRecentTasks };
	}

	public async getTopLevelEntries(defaultEntry?: TaskQuickPickEntry): Promise<{ entries: QuickPickInput<TaskTwoLevelQuickPickEntry>[], isSingleConfigured?: Task | ConfiguringTask }> {
		if (this.topLevelEntries !== undefined) {
			return { entries: this.topLevelEntries };
		}
		let recentTasks: (Task | ConfiguringTask)[] = (await this.taskService.readRecentTasks()).reverse();
		const configuredTasks: (Task | ConfiguringTask)[] = this.handleFolderTaskResult(await this.taskService.getWorkspaceTasks());
		const extensionTaskTypes = await this.taskService.getPossibleTaskTypes();
		this.topLevelEntries = [];
		// Dedupe will update recent tasks if they've changed in tasks.json.
		const dedupeAndPrune = this.dedupeConfiguredAndRecent(recentTasks, configuredTasks);
		let dedupedConfiguredTasks: (Task | ConfiguringTask)[] = dedupeAndPrune.configuredTasks;
		recentTasks = dedupeAndPrune.recentTasks;
		if (recentTasks.length > 0) {
			const removeRecentButton: IQuickInputButton = {
				iconClass: ThemeIcon.asClassName(removeTaskIcon),
				tooltip: nls.localize('removeRecent', 'Remove Recently Used Task')
			};
			this.createEntriesForGroup(this.topLevelEntries, recentTasks, nls.localize('recentlyUsed', 'recently used'), [removeRecentButton]);
		}
		if (configuredTasks.length > 0) {
			if (dedupedConfiguredTasks.length > 0) {
				this.createEntriesForGroup(this.topLevelEntries, dedupedConfiguredTasks, nls.localize('configured', 'configured'));
			}
		}

		if (defaultEntry && (configuredTasks.length === 0)) {
			this.topLevelEntries.push({ type: 'separator', label: nls.localize('configured', 'configured') });
			this.topLevelEntries.push(defaultEntry);
		}

		if (extensionTaskTypes.length > 0) {
			this.createTypeEntries(this.topLevelEntries, extensionTaskTypes);
		}
		return { entries: this.topLevelEntries, isSingleConfigured: configuredTasks.length === 1 ? configuredTasks[0] : undefined };
	}

	public async handleSettingOption(selectedType: string) {
		const noButton = nls.localize('TaskQuickPick.changeSettingNo', "No");
		const yesButton = nls.localize('TaskQuickPick.changeSettingYes', "Yes");
		const changeSettingResult = await this.dialogService.show(Severity.Warning,
			nls.localize('TaskQuickPick.changeSettingDetails',
				"Task detection for {0} tasks causes files in any workspace you open to be run as code. Enabling {0} task detection is a user setting and will apply to any workspace you open. Do you want to enable {0} task detection for all workspaces?", selectedType),
			[noButton, yesButton]);
		if (changeSettingResult.choice === 1) {
			await this.configurationService.updateValue(`${selectedType}.autoDetect`, 'on');
			await new Promise<void>(resolve => setTimeout(() => resolve(), 100));
			return this.show(nls.localize('TaskService.pickRunTask', 'Select the task to run'), undefined, selectedType);
		}
		return undefined;
	}

	public async show(placeHolder: string, defaultEntry?: TaskQuickPickEntry, startAtType?: string): Promise<Task | undefined | null> {
		const picker: IQuickPick<TaskTwoLevelQuickPickEntry> = this.quickInputService.createQuickPick();
		picker.placeholder = placeHolder;
		picker.matchOnDescription = true;
		picker.ignoreFocusOut = false;
		picker.show();

		picker.onDidTriggerItemButton(async (context) => {
			let task = context.item.task;
			if (context.button.iconClass === ThemeIcon.asClassName(removeTaskIcon)) {
				const key = (task && !Types.isString(task)) ? task.getRecentlyUsedKey() : undefined;
				if (key) {
					this.taskService.removeRecentlyUsedTask(key);
				}
				const indexToRemove = picker.items.indexOf(context.item);
				if (indexToRemove >= 0) {
					picker.items = [...picker.items.slice(0, indexToRemove), ...picker.items.slice(indexToRemove + 1)];
				}
			} else {
				this.quickInputService.cancel();
				if (ContributedTask.is(task)) {
					this.taskService.customize(task, undefined, true);
				} else if (CustomTask.is(task) || ConfiguringTask.is(task)) {
					let canOpenConfig: boolean = false;
					try {
						canOpenConfig = await this.taskService.openConfig(task);
					} catch (e) {
						// do nothing.
					}
					if (!canOpenConfig) {
						this.taskService.customize(task, undefined, true);
					}
				}
			}
		});

		let firstLevelTask: Task | ConfiguringTask | string | undefined | null = startAtType;
		if (!firstLevelTask) {
			// First show recent tasks configured tasks. Other tasks will be available at a second level
			const topLevelEntriesResult = await this.getTopLevelEntries(defaultEntry);
			if (topLevelEntriesResult.isSingleConfigured && this.configurationService.getValue<boolean>(QUICKOPEN_SKIP_CONFIG)) {
				picker.dispose();
				return this.toTask(topLevelEntriesResult.isSingleConfigured);
			}
			const taskQuickPickEntries: QuickPickInput<TaskTwoLevelQuickPickEntry>[] = topLevelEntriesResult.entries;
			firstLevelTask = await this.doPickerFirstLevel(picker, taskQuickPickEntries);
		}
		do {
			if (Types.isString(firstLevelTask)) {
				// Proceed to second level of quick pick
				const selectedEntry = await this.doPickerSecondLevel(picker, firstLevelTask);
				if (selectedEntry && !selectedEntry.settingType && selectedEntry.task === null) {
					// The user has chosen to go back to the first level
					firstLevelTask = await this.doPickerFirstLevel(picker, (await this.getTopLevelEntries(defaultEntry)).entries);
				} else if (selectedEntry && Types.isString(selectedEntry.settingType)) {
					picker.dispose();
					return this.handleSettingOption(selectedEntry.settingType);
				} else {
					picker.dispose();
					return (selectedEntry?.task && !Types.isString(selectedEntry?.task)) ? this.toTask(selectedEntry?.task) : undefined;
				}
			} else if (firstLevelTask) {
				picker.dispose();
				return this.toTask(firstLevelTask);
			} else {
				picker.dispose();
				return firstLevelTask;
			}
		} while (1);
		return;
	}

	private async doPickerFirstLevel(picker: IQuickPick<TaskTwoLevelQuickPickEntry>, taskQuickPickEntries: QuickPickInput<TaskTwoLevelQuickPickEntry>[]): Promise<Task | ConfiguringTask | string | null | undefined> {
		picker.items = taskQuickPickEntries;
		const firstLevelPickerResult = await new Promise<TaskTwoLevelQuickPickEntry | undefined | null>(resolve => {
			Event.once(picker.onDidAccept)(async () => {
				resolve(picker.selectedItems ? picker.selectedItems[0] : undefined);
			});
		});
		return firstLevelPickerResult?.task;
	}

	private async doPickerSecondLevel(picker: IQuickPick<TaskTwoLevelQuickPickEntry>, type: string) {
		picker.busy = true;
		if (type === SHOW_ALL) {
			const items = (await this.taskService.tasks()).sort((a, b) => this.sorter.compare(a, b)).map(task => this.createTaskEntry(task));
			items.push(...TaskQuickPick.allSettingEntries(this.configurationService));
			picker.items = items;
		} else {
			picker.value = '';
			picker.items = await this.getEntriesForProvider(type);
		}
		picker.busy = false;
		const secondLevelPickerResult = await new Promise<TaskTwoLevelQuickPickEntry | undefined | null>(resolve => {
			Event.once(picker.onDidAccept)(async () => {
				resolve(picker.selectedItems ? picker.selectedItems[0] : undefined);
			});
		});

		return secondLevelPickerResult;
	}

	public static allSettingEntries(configurationService: IConfigurationService): (TaskTwoLevelQuickPickEntry & { settingType: string })[] {
		const entries: (TaskTwoLevelQuickPickEntry & { settingType: string })[] = [];
		const gruntEntry = TaskQuickPick.getSettingEntry(configurationService, 'grunt');
		if (gruntEntry) {
			entries.push(gruntEntry);
		}
		const gulpEntry = TaskQuickPick.getSettingEntry(configurationService, 'gulp');
		if (gulpEntry) {
			entries.push(gulpEntry);
		}
		const jakeEntry = TaskQuickPick.getSettingEntry(configurationService, 'jake');
		if (jakeEntry) {
			entries.push(jakeEntry);
		}
		return entries;
	}

	public static getSettingEntry(configurationService: IConfigurationService, type: string): (TaskTwoLevelQuickPickEntry & { settingType: string }) | undefined {
		if (configurationService.getValue(`${type}.autoDetect`) === 'off') {
			return {
				label: nls.localize('TaskQuickPick.changeSettingsOptions', "$(gear) {0} task detection is turned off. Enable {1} task detection...",
					type[0].toUpperCase() + type.slice(1), type),
				task: null,
				settingType: type,
				alwaysShow: true
			};
		}
		return undefined;
	}

	private async getEntriesForProvider(type: string): Promise<QuickPickInput<TaskTwoLevelQuickPickEntry>[]> {
		const tasks = (await this.taskService.tasks({ type })).sort((a, b) => this.sorter.compare(a, b));
		let taskQuickPickEntries: QuickPickInput<TaskTwoLevelQuickPickEntry>[];
		if (tasks.length > 0) {
			taskQuickPickEntries = tasks.map(task => this.createTaskEntry(task));
			taskQuickPickEntries.push({
				type: 'separator'
			}, {
				label: nls.localize('TaskQuickPick.goBack', 'Go back ↩'),
				task: null,
				alwaysShow: true
			});
		} else {
			taskQuickPickEntries = [{
				label: nls.localize('TaskQuickPick.noTasksForType', 'No {0} tasks found. Go back ↩', type),
				task: null,
				alwaysShow: true
			}];
		}

		const settingEntry = TaskQuickPick.getSettingEntry(this.configurationService, type);
		if (settingEntry) {
			taskQuickPickEntries.push(settingEntry);
		}
		return taskQuickPickEntries;
	}

	private async toTask(task: Task | ConfiguringTask): Promise<Task | undefined> {
		if (!ConfiguringTask.is(task)) {
			return task;
		}

		const resolvedTask = await this.taskService.tryResolveTask(task);

		if (!resolvedTask) {
			this.notificationService.error(nls.localize('noProviderForTask', "There is no task provider registered for tasks of type \"{0}\".", task.type));
		}
		return resolvedTask;
	}

	static async show(taskService: ITaskService, configurationService: IConfigurationService,
		quickInputService: IQuickInputService, notificationService: INotificationService,
		dialogService: IDialogService, placeHolder: string, defaultEntry?: TaskQuickPickEntry) {
		const taskQuickPick = new TaskQuickPick(taskService, configurationService, quickInputService, notificationService, dialogService);
		return taskQuickPick.show(placeHolder, defaultEntry);
	}
}
