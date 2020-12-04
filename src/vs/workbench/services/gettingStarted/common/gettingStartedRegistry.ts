/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { FileAccess } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { ContextKeyExpr, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { Registry } from 'vs/platform/registry/common/platform';
import { content } from 'vs/workbench/services/gettingStarted/common/gettingStartedContent';

export const enum GettingStartedCategory {
	Beginner = 'Beginner',
	Intermediate = 'Intermediate',
	Advanced = 'Advanced'
}

export interface IGettingStartedTask {
	id: string,
	title: string,
	description: string,
	category: GettingStartedCategory | string,
	when: ContextKeyExpression,
	order: number,
	button: { title: string, command: string },
	doneOn: { commandExecuted: string, eventFired?: never } | { eventFired: string, commandExecuted?: never, }
	media: { type: 'image', path: URI, altText: string },
}

export interface IGettingStartedCategoryDescriptor {
	id: GettingStartedCategory | string
	title: string
	description: string
	codicon: string
	when: ContextKeyExpression
	content:
	| { type: 'items' }
	| { type: 'command', command: string }
}

export interface IGettingStartedCategory {
	id: GettingStartedCategory | string
	title: string
	description: string
	codicon: string
	when: ContextKeyExpression
	content:
	| { type: 'items', items: IGettingStartedTask[] }
	| { type: 'command', command: string }
}

export interface IGettingStartedRegistry {
	onDidAddCategory: Event<IGettingStartedCategory>
	onDidAddTask: Event<IGettingStartedTask>

	registerTask(task: IGettingStartedTask): IGettingStartedTask;
	getTask(id: string): IGettingStartedTask

	registerCategory(categoryDescriptor: IGettingStartedCategoryDescriptor): void
	getCategory(id: GettingStartedCategory | string): Readonly<IGettingStartedCategory> | undefined

	getCategories(): readonly Readonly<IGettingStartedCategory>[]
}

export class GettingStartedRegistryImpl implements IGettingStartedRegistry {
	private readonly _onDidAddTask = new Emitter<IGettingStartedTask>();
	onDidAddTask: Event<IGettingStartedTask> = this._onDidAddTask.event;
	private readonly _onDidAddCategory = new Emitter<IGettingStartedCategory>();
	onDidAddCategory: Event<IGettingStartedCategory> = this._onDidAddCategory.event;

	private readonly gettingStartedContributions = new Map<string, IGettingStartedCategory>();
	private readonly tasks = new Map<string, IGettingStartedTask>();

	public registerTask(task: IGettingStartedTask): IGettingStartedTask {
		const category = this.gettingStartedContributions.get(task.category);
		if (!category) { throw Error('Registering getting started task to category that does not exist (' + task.category + ')'); }
		if (category.content.type !== 'items') { throw Error('Registering getting started task to category that is not of `items` type (' + task.category + ')'); }
		if (this.tasks.has(task.id)) { throw Error('Attempting to register task with id ' + task.id + ' twice. Second is dropped.'); }
		this.tasks.set(task.id, task);
		category.content.items.push(task);
		this._onDidAddTask.fire(task);
		return task;
	}

	public registerCategory(categoryDescriptor: IGettingStartedCategoryDescriptor): void {
		const oldCategory = this.gettingStartedContributions.get(categoryDescriptor.id);
		if (oldCategory) {
			console.error(`Skipping attempt to overwrite getting started category. (${categoryDescriptor})`);
			return;
		}

		const category: IGettingStartedCategory = {
			...categoryDescriptor,
			content: categoryDescriptor.content.type === 'items'
				? { type: 'items', items: [] }
				: categoryDescriptor.content
		};

		this.gettingStartedContributions.set(categoryDescriptor.id, category);
		this._onDidAddCategory.fire(category);
	}

	public getCategory(id: GettingStartedCategory | string): Readonly<IGettingStartedCategory> | undefined {
		return this.gettingStartedContributions.get(id);
	}

	public getTask(id: string): IGettingStartedTask {
		const task = this.tasks.get(id);
		if (!task) { throw Error('Attempting to access task which does not exist in registry ' + id); }
		return task;
	}

	public getCategories(): readonly Readonly<IGettingStartedCategory>[] {
		return [...this.gettingStartedContributions.values()];

	}
}

export const GettingStartedRegistryID = 'GettingStartedRegistry';
const registryImpl = new GettingStartedRegistryImpl();

content.forEach(category => {

	registryImpl.registerCategory({
		...category,
		when: ContextKeyExpr.deserialize(category.when) ?? ContextKeyExpr.true()
	});

	if (category.content.type === 'items') {
		category.content.items.forEach((item, index) => {
			registryImpl.registerTask({
				...item,
				category: category.id,
				order: index,
				when: ContextKeyExpr.deserialize(item.when) ?? ContextKeyExpr.true(),
				media: {
					type: item.media.type,
					altText: item.media.altText,
					path: item.media.path.startsWith('https://')
						? URI.parse(item.media.path, true)
						: FileAccess.asFileUri('vs/workbench/services/gettingStarted/common/media/' + item.media.path, require)
				}
			});
		});
	}
});

Registry.add(GettingStartedRegistryID, registryImpl);
export const GettingStartedRegistry: IGettingStartedRegistry = Registry.as(GettingStartedRegistryID);
