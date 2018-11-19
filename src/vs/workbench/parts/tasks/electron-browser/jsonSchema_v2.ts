/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as Objects from 'vs/base/common/objects';
import { IJSONSchema, IJSONSchemaMap } from 'vs/base/common/jsonSchema';

import commonSchema from './jsonSchemaCommon';

import { ProblemMatcherRegistry } from 'vs/workbench/parts/tasks/common/problemMatcher';
import { TaskDefinitionRegistry } from '../common/taskDefinitionRegistry';
import * as ConfigurationResolverUtils from 'vs/workbench/services/configurationResolver/common/configurationResolverUtils';

function fixReferences(literal: any) {
	if (Array.isArray(literal)) {
		literal.forEach(fixReferences);
	} else if (typeof literal === 'object') {
		if (literal['$ref']) {
			literal['$ref'] = literal['$ref'] + '2';
		}
		Object.getOwnPropertyNames(literal).forEach(property => {
			let value = literal[property];
			if (Array.isArray(value) || typeof value === 'object') {
				fixReferences(value);
			}
		});
	}
}

const shellCommand: IJSONSchema = {
	anyOf: [
		{
			type: 'boolean',
			default: true,
			description: nls.localize('JsonSchema.shell', 'Specifies whether the command is a shell command or an external program. Defaults to false if omitted.')
		},
		{
			$ref: '#definitions/shellConfiguration'
		}
	],
	deprecationMessage: nls.localize('JsonSchema.tasks.isShellCommand.deprecated', 'The property isShellCommand is deprecated. Use the type property of the task and the shell property in the options instead. See also the 1.14 release notes.')
};

const taskIdentifier: IJSONSchema = {
	type: 'object',
	additionalProperties: true,
	properties: {
		type: {
			type: 'string',
			description: nls.localize('JsonSchema.tasks.dependsOn.identifier', 'The task indentifier.')
		}
	}
};

const dependsOn: IJSONSchema = {
	anyOf: [
		{
			type: 'string',
			description: nls.localize('JsonSchema.tasks.dependsOn.string', 'Another task this task depends on.')
		},
		taskIdentifier,
		{
			type: 'array',
			description: nls.localize('JsonSchema.tasks.dependsOn.array', 'The other tasks this task depends on.'),
			items: {
				anyOf: [
					{
						type: 'string',
					},
					taskIdentifier
				]
			}
		}
	]
};

const presentation: IJSONSchema = {
	type: 'object',
	default: {
		echo: true,
		reveal: 'always',
		focus: false,
		panel: 'shared',
		showReuseMessage: true,
		clear: false,
	},
	description: nls.localize('JsonSchema.tasks.presentation', 'Configures the panel that is used to present the task\'s ouput and reads its input.'),
	additionalProperties: false,
	properties: {
		echo: {
			type: 'boolean',
			default: true,
			description: nls.localize('JsonSchema.tasks.presentation.echo', 'Controls whether the executed command is echoed to the panel. Default is true.')
		},
		focus: {
			type: 'boolean',
			default: false,
			description: nls.localize('JsonSchema.tasks.presentation.focus', 'Controls whether the panel takes focus. Default is false. If set to true the panel is revealed as well.')
		},
		reveal: {
			type: 'string',
			enum: ['always', 'silent', 'never'],
			enumDescriptions: [
				nls.localize('JsonSchema.tasks.presentation.reveal.always', 'Always reveals the terminal when this task is executed.'),
				nls.localize('JsonSchema.tasks.presentation.reveal.silent', 'Only reveals the terminal if no problem matcher is associated with the task and an errors occurs executing it.'),
				nls.localize('JsonSchema.tasks.presentation.reveal.never', 'Never reveals the terminal when this task is executed.'),
			],
			default: 'always',
			description: nls.localize('JsonSchema.tasks.presentation.reveals', 'Controls whether the panel running the task is revealed or not. Default is \"always\".')
		},
		panel: {
			type: 'string',
			enum: ['shared', 'dedicated', 'new'],
			default: 'shared',
			description: nls.localize('JsonSchema.tasks.presentation.instance', 'Controls if the panel is shared between tasks, dedicated to this task or a new one is created on every run.')
		},
		showReuseMessage: {
			type: 'boolean',
			default: true,
			description: nls.localize('JsonSchema.tasks.presentation.showReuseMessage', 'Controls whether to show the `Terminal will be reused by tasks, press any key to close it` message.')
		},
		clear: {
			type: 'boolean',
			default: false,
			description: nls.localize('JsonSchema.tasks.presentation.clear', 'Controls whether the terminal is cleared before executing the task.')
		}
	}
};

const terminal: IJSONSchema = Objects.deepClone(presentation);
terminal.deprecationMessage = nls.localize('JsonSchema.tasks.terminal', 'The terminal property is deprecated. Use presentation instead');

const group: IJSONSchema = {
	oneOf: [
		{
			type: 'string',
		},
		{
			type: 'object',
			properties: {
				kind: {
					type: 'string',
					default: 'none',
					description: nls.localize('JsonSchema.tasks.group.kind', 'The task\'s execution group.')
				},
				isDefault: {
					type: 'boolean',
					default: false,
					description: nls.localize('JsonSchema.tasks.group.isDefault', 'Defines if this task is the default task in the group.')
				}
			}
		},
	],
	enum: [
		{ kind: 'build', isDefault: true },
		{ kind: 'test', isDefault: true },
		'build',
		'test',
		'none'
	],
	enumDescriptions: [
		nls.localize('JsonSchema.tasks.group.defaultBuild', 'Marks the task as the default build task.'),
		nls.localize('JsonSchema.tasks.group.defaultTest', 'Marks the task as the default test task.'),
		nls.localize('JsonSchema.tasks.group.build', 'Marks the task as a build task accesible through the \'Run Build Task\' command.'),
		nls.localize('JsonSchema.tasks.group.test', 'Marks the task as a test task accesible through the \'Run Test Task\' command.'),
		nls.localize('JsonSchema.tasks.group.none', 'Assigns the task to no group')
	],
	description: nls.localize('JsonSchema.tasks.group', 'Defines to which execution group this task belongs to. It supports "build" to add it to the build group and "test" to add it to the test group.')
};

const taskType: IJSONSchema = {
	type: 'string',
	enum: ['shell', 'process'],
	default: 'shell',
	description: nls.localize('JsonSchema.tasks.type', 'Defines whether the task is run as a process or as a command inside a shell.')
};

const command: IJSONSchema = {
	oneOf: [
		{
			oneOf: [
				{
					type: 'string'
				},
				{
					type: 'array',
					items: {
						type: 'string'
					},
					description: nls.localize('JsonSchema.commandArray', 'The shell command to be executed. Array items will be joined using a space character')
				}
			]
		},
		{
			type: 'object',
			required: ['value', 'quoting'],
			properties: {
				value: {
					oneOf: [
						{
							type: 'string'
						},
						{
							type: 'array',
							items: {
								type: 'string'
							},
							description: nls.localize('JsonSchema.commandArray', 'The shell command to be executed. Array items will be joined using a space character')
						}
					],
					description: nls.localize('JsonSchema.command.quotedString.value', 'The actual command value')
				},
				quoting: {
					type: 'string',
					enum: ['escape', 'strong', 'weak'],
					enumDescriptions: [
						nls.localize('JsonSchema.tasks.quoting.escape', 'Escapes characters using the shell\'s escape character (e.g. ` under PowerShell and \\ under bash).'),
						nls.localize('JsonSchema.tasks.quoting.strong', 'Quotes the argument using the shell\'s strong quote character (e.g. " under PowerShell and bash).'),
						nls.localize('JsonSchema.tasks.quoting.weak', 'Quotes the argument using the shell\'s weak quote character (e.g. \' under PowerShell and bash).'),
					],
					default: 'strong',
					description: nls.localize('JsonSchema.command.quotesString.quote', 'How the command value should be quoted.')
				}
			}

		}
	],
	description: nls.localize('JsonSchema.command', 'The command to be executed. Can be an external program or a shell command.')
};

const args: IJSONSchema = {
	type: 'array',
	items: {
		oneOf: [
			{
				type: 'string',
			},
			{
				type: 'object',
				required: ['value', 'quoting'],
				properties: {
					value: {
						type: 'string',
						description: nls.localize('JsonSchema.args.quotedString.value', 'The actual argument value')
					},
					quoting: {
						type: 'string',
						enum: ['escape', 'strong', 'weak'],
						enumDescriptions: [
							nls.localize('JsonSchema.tasks.quoting.escape', 'Escapes characters using the shell\'s escape character (e.g. ` under PowerShell and \\ under bash).'),
							nls.localize('JsonSchema.tasks.quoting.strong', 'Quotes the argument using the shell\'s strong quote character (e.g. " under PowerShell and bash).'),
							nls.localize('JsonSchema.tasks.quoting.weak', 'Quotes the argument using the shell\'s weak quote character (e.g. \' under PowerShell and bash).'),
						],
						default: 'strong',
						description: nls.localize('JsonSchema.args.quotesString.quote', 'How the argument value should be quoted.')
					}
				}

			}
		]
	},
	description: nls.localize('JsonSchema.tasks.args', 'Arguments passed to the command when this task is invoked.')
};

const label: IJSONSchema = {
	type: 'string',
	description: nls.localize('JsonSchema.tasks.label', "The task's user interface label")
};

const version: IJSONSchema = {
	type: 'string',
	enum: ['2.0.0'],
	description: nls.localize('JsonSchema.version', 'The config\'s version number.')
};

const identifier: IJSONSchema = {
	type: 'string',
	description: nls.localize('JsonSchema.tasks.identifier', 'A user defined identifier to reference the task in launch.json or a dependsOn clause.'),
	deprecationMessage: nls.localize('JsonSchema.tasks.identifier.deprecated', 'User defined identifiers are deprecated. For custom task use the name as a reference and for tasks provided by extensions use their defined task identifier.')
};

const options: IJSONSchema = Objects.deepClone(commonSchema.definitions.options);
options.properties.shell = Objects.deepClone(commonSchema.definitions.shellConfiguration);

let taskConfiguration: IJSONSchema = {
	type: 'object',
	additionalProperties: false,
	properties: {
		label: {
			type: 'string',
			description: nls.localize('JsonSchema.tasks.taskLabel', "The task's label")
		},
		taskName: {
			type: 'string',
			description: nls.localize('JsonSchema.tasks.taskName', 'The task\'s name'),
			deprecationMessage: nls.localize('JsonSchema.tasks.taskName.deprecated', 'The task\'s name property is deprecated. Use the label property instead.')
		},
		identifier: Objects.deepClone(identifier),
		group: Objects.deepClone(group),
		isBackground: {
			type: 'boolean',
			description: nls.localize('JsonSchema.tasks.background', 'Whether the executed task is kept alive and is running in the background.'),
			default: true
		},
		instanceLimit: {
			type: 'boolean',
			description: nls.localize('JsonSchema.tasks.instanceLimit', 'Whether the executed task can have only 1 active instance at a time.'),
			default: false
		},
		promptOnClose: {
			type: 'boolean',
			description: nls.localize('JsonSchema.tasks.promptOnClose', 'Whether the user is prompted when VS Code closes with a running task.'),
			default: false
		},
		presentation: Objects.deepClone(presentation),
		options: options,
		problemMatcher: {
			$ref: '#/definitions/problemMatcherType',
			description: nls.localize('JsonSchema.tasks.matchers', 'The problem matcher(s) to use. Can either be a string or a problem matcher definition or an array of strings and problem matchers.')
		}
	}
};

let taskDefinitions: IJSONSchema[] = [];
TaskDefinitionRegistry.onReady().then(() => {
	for (let taskType of TaskDefinitionRegistry.all()) {
		let schema: IJSONSchema = Objects.deepClone(taskConfiguration);
		// Since we do this after the schema is assigned we need to patch the refs.
		schema.properties.type = {
			type: 'string',
			description: nls.localize('JsonSchema.customizations.customizes.type', 'The task type to customize'),
			enum: [taskType.taskType]
		};
		if (taskType.required) {
			schema.required = taskType.required.slice();
		}
		if (taskType.properties) {
			for (let key of Object.keys(taskType.properties)) {
				let property = taskType.properties[key];
				schema.properties[key] = Objects.deepClone(property);
			}
		}
		fixReferences(schema);
		taskDefinitions.push(schema);
	}
});

let customize = Objects.deepClone(taskConfiguration);
customize.properties.customize = {
	type: 'string',
	deprecationMessage: nls.localize('JsonSchema.tasks.customize.deprecated', 'The customize property is deprecated. See the 1.14 release notes on how to migrate to the new task customization approach')
};
taskDefinitions.push(customize);

let definitions = Objects.deepClone(commonSchema.definitions);
let taskDescription: IJSONSchema = definitions.taskDescription;
taskDescription.required = ['label'];
taskDescription.properties.label = Objects.deepClone(label);
taskDescription.properties.command = Objects.deepClone(command);
taskDescription.properties.args = Objects.deepClone(args);
taskDescription.properties.isShellCommand = Objects.deepClone(shellCommand);
taskDescription.properties.dependsOn = dependsOn;
taskDescription.properties.identifier = Objects.deepClone(identifier);
taskDescription.properties.type = Objects.deepClone(taskType);
taskDescription.properties.presentation = Objects.deepClone(presentation);
taskDescription.properties.terminal = terminal;
taskDescription.properties.group = Objects.deepClone(group);
taskDescription.properties.taskName.deprecationMessage = nls.localize(
	'JsonSchema.tasks.taskName.deprecated',
	'The task\'s name property is deprecated. Use the label property instead.'
);
taskDescription.default = {
	label: 'My Task',
	type: 'shell',
	command: 'echo Hello',
	problemMatcher: []
};
definitions.showOutputType.deprecationMessage = nls.localize(
	'JsonSchema.tasks.showOputput.deprecated',
	'The property showOutput is deprecated. Use the reveal property inside the presentation property instead. See also the 1.14 release notes.'
);
definitions.taskDescription.properties.echoCommand.deprecationMessage = nls.localize(
	'JsonSchema.tasks.echoCommand.deprecated',
	'The property echoCommand is deprecated. Use the echo property inside the presentation property instead. See also the 1.14 release notes.'
);
definitions.taskDescription.properties.suppressTaskName.deprecationMessage = nls.localize(
	'JsonSchema.tasks.suppressTaskName.deprecated',
	'The property suppressTaskName is deprecated. Inline the command with its arguments into the task instead. See also the 1.14 release notes.'
);
definitions.taskDescription.properties.isBuildCommand.deprecationMessage = nls.localize(
	'JsonSchema.tasks.isBuildCommand.deprecated',
	'The property isBuildCommand is deprecated. Use the group property instead. See also the 1.14 release notes.'
);
definitions.taskDescription.properties.isTestCommand.deprecationMessage = nls.localize(
	'JsonSchema.tasks.isTestCommand.deprecated',
	'The property isTestCommand is deprecated. Use the group property instead. See also the 1.14 release notes.'
);

taskDefinitions.push({
	$ref: '#/definitions/taskDescription'
} as IJSONSchema);

let tasks = definitions.taskRunnerConfiguration.properties.tasks;
tasks.items = {
	oneOf: taskDefinitions
};

definitions.commandConfiguration.properties.isShellCommand = Objects.deepClone(shellCommand);
definitions.options.properties.shell = {
	$ref: '#/definitions/shellConfiguration'
};

definitions.taskRunnerConfiguration.properties.isShellCommand = Objects.deepClone(shellCommand);
definitions.taskRunnerConfiguration.properties.type = Objects.deepClone(taskType);
definitions.taskRunnerConfiguration.properties.group = Objects.deepClone(group);
definitions.taskRunnerConfiguration.properties.presentation = Objects.deepClone(presentation);
definitions.taskRunnerConfiguration.properties.suppressTaskName.deprecationMessage = nls.localize(
	'JsonSchema.tasks.suppressTaskName.deprecated',
	'The property suppressTaskName is deprecated. Inline the command with its arguments into the task instead. See also the 1.14 release notes.'
);
definitions.taskRunnerConfiguration.properties.taskSelector.deprecationMessage = nls.localize(
	'JsonSchema.tasks.taskSelector.deprecated',
	'The property taskSelector is deprecated. Inline the command with its arguments into the task instead. See also the 1.14 release notes.'
);

let osSpecificTaskRunnerConfiguration = Objects.deepClone(definitions.taskRunnerConfiguration);
delete osSpecificTaskRunnerConfiguration.properties.tasks;
osSpecificTaskRunnerConfiguration.additionalProperties = false;
definitions.osSpecificTaskRunnerConfiguration = osSpecificTaskRunnerConfiguration;
definitions.taskRunnerConfiguration.properties.version = Objects.deepClone(version);

const schema: IJSONSchema = {
	oneOf: [
		{
			'allOf': [
				{
					type: 'object',
					required: ['version'],
					properties: {
						version: Objects.deepClone(version),
						windows: {
							'$ref': '#/definitions/osSpecificTaskRunnerConfiguration',
							'description': nls.localize('JsonSchema.windows', 'Windows specific command configuration')
						},
						osx: {
							'$ref': '#/definitions/osSpecificTaskRunnerConfiguration',
							'description': nls.localize('JsonSchema.mac', 'Mac specific command configuration')
						},
						linux: {
							'$ref': '#/definitions/osSpecificTaskRunnerConfiguration',
							'description': nls.localize('JsonSchema.linux', 'Linux specific command configuration')
						}
					}
				},
				{
					$ref: '#/definitions/taskRunnerConfiguration'
				}
			]
		}
	]
};

schema.definitions = definitions;

function deprecatedVariableMessage(schemaMap: IJSONSchemaMap, property: string) {
	if (schemaMap[property].properties) {
		Object.keys(schemaMap[property].properties).forEach(name => {
			deprecatedVariableMessage(schemaMap[property].properties, name);
		});
	} else {
		ConfigurationResolverUtils.applyDeprecatedVariableMessage(schemaMap[property]);
	}
}

Object.getOwnPropertyNames(definitions).forEach(key => {
	let newKey = key + '2';
	definitions[newKey] = definitions[key];
	delete definitions[key];
	deprecatedVariableMessage(definitions, newKey);
});
fixReferences(schema);

ProblemMatcherRegistry.onReady().then(() => {
	try {
		let matcherIds = ProblemMatcherRegistry.keys().map(key => '$' + key);
		definitions.problemMatcherType2.oneOf[0].enum = matcherIds;
		(definitions.problemMatcherType2.oneOf[2].items as IJSONSchema).anyOf[1].enum = matcherIds;
	} catch (err) {
		console.log('Installing problem matcher ids failed');
	}
});

export default schema;
