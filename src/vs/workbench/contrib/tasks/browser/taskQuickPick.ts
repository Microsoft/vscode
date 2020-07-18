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
import { IQuickPickItem, QuickPickInput, IQuickPick } from 'vs/base/parts/quickinput/common/quickInput';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IQuickInputService } from 'vs/platform/quickinput/common/quickInput';
import { Disposable } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { INotificationService } from 'vs/platform/notification/common/notification';

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
}

const SHOW_ALL: string = nls.localize('taskQuickPick.showAll', "Show All Tasks...");

export class TaskQuickPick extends Disposable {
	private sorter: TaskSorter;
	private topLevelEntries: QuickPickInput<TaskTwoLevelQuickPickEntry>[] | undefined;
	constructor(
		private taskService: ITaskService,
		private configurationService: IConfigurationService,
		private quickInputService: IQuickInputService,
		private notificationService: INotificationService) {
		super();
		this.sorter = this.taskService.createSorter();
	}

	private showDetail(): boolean {
		return this.configurationService.getValue<boolean>(QUICKOPEN_DETAIL_CONFIG);
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

	private createTaskEntry(task: Task | ConfiguringTask): TaskTwoLevelQuickPickEntry {
		const entry: TaskTwoLevelQuickPickEntry = { label: this.guessTaskLabel(task), description: this.taskService.getTaskDescription(task), task, detail: this.showDetail() ? task.configurationProperties.detail : undefined };
		entry.buttons = [{ iconClass: 'codicon-gear', tooltip: nls.localize('configureTask', "Configure Task") }];
		return entry;
	}

	private createEntriesForGroup(entries: QuickPickInput<TaskTwoLevelQuickPickEntry>[], tasks: (Task | ConfiguringTask)[], groupLabel: string) {
		entries.push({ type: 'separator', label: groupLabel });
		tasks.forEach(task => {
			entries.push(this.createTaskEntry(task));
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
		const extensionTaskTypes = this.taskService.taskTypes();
		this.topLevelEntries = [];
		// Dedupe will update recent tasks if they've changed in tasks.json.
		const dedupeAndPrune = this.dedupeConfiguredAndRecent(recentTasks, configuredTasks);
		let dedupedConfiguredTasks: (Task | ConfiguringTask)[] = dedupeAndPrune.configuredTasks;
		recentTasks = dedupeAndPrune.recentTasks;
		if (recentTasks.length > 0) {
			this.createEntriesForGroup(this.topLevelEntries, recentTasks, nls.localize('recentlyUsed', 'recently used'));
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

	public async show(placeHolder: string, defaultEntry?: TaskQuickPickEntry, startAtType?: string): Promise<Task | undefined | null> {
		const picker: IQuickPick<TaskTwoLevelQuickPickEntry> = this.quickInputService.createQuickPick();
		picker.placeholder = placeHolder;
		picker.matchOnDescription = true;
		picker.ignoreFocusOut = false;
		picker.show();

		picker.onDidTriggerItemButton(async (context) => {
			let task = context.item.task;
			this.quickInputService.cancel();
			if (ContributedTask.is(task)) {
				this.taskService.customize(task, undefined, true);
			} else if (CustomTask.is(task) || ConfiguringTask.is(task)) {
				if (!(await this.taskService.openConfig(task))) {
					this.taskService.customize(task, undefined, true);
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
				if (selectedEntry && selectedEntry.task === null) {
					// The user has chosen to go back to the first level
					firstLevelTask = await this.doPickerFirstLevel(picker, (await this.getTopLevelEntries(defaultEntry)).entries);
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
		picker.value = '';
		if (type === SHOW_ALL) {
			picker.items = (await this.taskService.tasks()).sort((a, b) => this.sorter.compare(a, b)).map(task => this.createTaskEntry(task));
		} else {
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

	static async show(taskService: ITaskService, configurationService: IConfigurationService, quickInputService: IQuickInputService, notificationService: INotificationService, placeHolder: string, defaultEntry?: TaskQuickPickEntry) {
		const taskQuickPick = new TaskQuickPick(taskService, configurationService, quickInputService, notificationService);
		return taskQuickPick.show(placeHolder, defaultEntry);
	}
}
