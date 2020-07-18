/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IJSONSchema, IJSONSchemaMap } from 'vs/base/common/jsonSchema';
import { IStringDictionary } from 'vs/base/common/collections';
import * as Types from 'vs/base/common/types';
import * as Objects from 'vs/base/common/objects';

import { ExtensionsRegistry, ExtensionMessageCollector } from 'vs/workbench/services/extensions/common/extensionsRegistry';

import * as Tasks from 'vs/workbench/contrib/tasks/common/tasks';
import { ExtensionIdentifier } from 'vs/platform/extensions/common/extensions';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';


const taskDefinitionSchema: IJSONSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		type: {
			type: 'string',
			description: nls.localize('TaskDefinition.description', 'The actual task type. Please note that types starting with a \'$\' are reserved for internal usage.')
		},
		required: {
			type: 'array',
			items: {
				type: 'string'
			}
		},
		properties: {
			type: 'object',
			description: nls.localize('TaskDefinition.properties', 'Additional properties of the task type'),
			additionalProperties: {
				$ref: 'http://json-schema.org/draft-07/schema#'
			}
		},
		when: {
			type: 'string',
			markdownDescription: nls.localize('TaskDefinition.when', 'Condition when the task definition is valid. Consider using `shellExecutionSupported`, `processExecutionSupported`, and `customExecutionSupported` as appropriate for this task definition.')
		}
	}
};

namespace Configuration {
	export interface TaskDefinition {
		type?: string;
		required?: string[];
		properties?: IJSONSchemaMap;
		when?: string;
	}

	export function from(value: TaskDefinition, extensionId: ExtensionIdentifier, messageCollector: ExtensionMessageCollector): Tasks.TaskDefinition | undefined {
		if (!value) {
			return undefined;
		}
		let taskType = Types.isString(value.type) ? value.type : undefined;
		if (!taskType || taskType.length === 0) {
			messageCollector.error(nls.localize('TaskTypeConfiguration.noType', 'The task type configuration is missing the required \'taskType\' property'));
			return undefined;
		}
		let required: string[] = [];
		if (Array.isArray(value.required)) {
			for (let element of value.required) {
				if (Types.isString(element)) {
					required.push(element);
				}
			}
		}
		return {
			extensionId: extensionId.value,
			taskType, required: required,
			properties: value.properties ? Objects.deepClone(value.properties) : {},
			when: value.when ? ContextKeyExpr.deserialize(value.when) : undefined
		};
	}
}


const taskDefinitionsExtPoint = ExtensionsRegistry.registerExtensionPoint<Configuration.TaskDefinition[]>({
	extensionPoint: 'taskDefinitions',
	jsonSchema: {
		description: nls.localize('TaskDefinitionExtPoint', 'Contributes task kinds'),
		type: 'array',
		items: taskDefinitionSchema
	}
});

export interface ITaskDefinitionRegistry {
	onReady(): Promise<void>;

	get(key: string): Tasks.TaskDefinition;
	all(): Tasks.TaskDefinition[];
	getJsonSchema(): IJSONSchema;
}

class TaskDefinitionRegistryImpl implements ITaskDefinitionRegistry {

	private taskTypes: IStringDictionary<Tasks.TaskDefinition>;
	private readyPromise: Promise<void>;
	private _schema: IJSONSchema | undefined;

	constructor() {
		this.taskTypes = Object.create(null);
		this.readyPromise = new Promise<void>((resolve, reject) => {
			taskDefinitionsExtPoint.setHandler((extensions, delta) => {
				try {
					for (let extension of delta.removed) {
						let taskTypes = extension.value;
						for (let taskType of taskTypes) {
							if (this.taskTypes && taskType.type && this.taskTypes[taskType.type]) {
								delete this.taskTypes[taskType.type];
							}
						}
					}
					for (let extension of delta.added) {
						let taskTypes = extension.value;
						for (let taskType of taskTypes) {
							let type = Configuration.from(taskType, extension.description.identifier, extension.collector);
							if (type) {
								this.taskTypes[type.taskType] = type;
							}
						}
					}
				} catch (error) {
				}
				resolve(undefined);
			});
		});
	}

	public onReady(): Promise<void> {
		return this.readyPromise;
	}

	public get(key: string): Tasks.TaskDefinition {
		return this.taskTypes[key];
	}

	public all(): Tasks.TaskDefinition[] {
		return Object.keys(this.taskTypes).map(key => this.taskTypes[key]);
	}

	public getJsonSchema(): IJSONSchema {
		if (this._schema === undefined) {
			let schemas: IJSONSchema[] = [];
			for (let definition of this.all()) {
				let schema: IJSONSchema = {
					type: 'object',
					additionalProperties: false
				};
				if (definition.required.length > 0) {
					schema.required = definition.required.slice(0);
				}
				if (definition.properties !== undefined) {
					schema.properties = Objects.deepClone(definition.properties);
				} else {
					schema.properties = Object.create(null);
				}
				schema.properties!.type = {
					type: 'string',
					enum: [definition.taskType]
				};
				schemas.push(schema);
			}
			this._schema = { oneOf: schemas };
		}
		return this._schema;
	}
}

export const TaskDefinitionRegistry: ITaskDefinitionRegistry = new TaskDefinitionRegistryImpl();
