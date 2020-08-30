/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as Objects from 'vs/base/common/objects';
import { IJSONSchema } from 'vs/base/common/jsonSchema';

import { ProblemMatcherRegistry } from 'vs/workbench/contrib/tasks/common/problemMatcher';

import commonSchema from './jsonSchemaCommon';

const schema: IJSONSchema = {
	oneOf: [
		{
			allOf: [
				{
					type: 'object',
					required: ['version'],
					properties: {
						version: {
							type: 'string',
							enum: ['0.1.0'],
							deprecationMessage: nls.localize('JsonSchema.version.deprecated', 'Task version 0.1.0 is deprecated. Please use 2.0.0'),
							description: nls.localize('JsonSchema.version', 'The config\'s version number')
						},
						_runner: {
							deprecationMessage: nls.localize('JsonSchema._runner', 'The runner has graduated. Use the offical runner property')
						},
						runner: {
							type: 'string',
							enum: ['process', 'terminal'],
							default: 'process',
							description: nls.localize('JsonSchema.runner', 'Defines whether the task is executed as a process and the output is shown in the output window or inside the terminal.')
						},
						windows: {
							$ref: '#/definitions/taskRunnerConfiguration',
							description: nls.localize('JsonSchema.windows', 'Windows specific command configuration')
						},
						osx: {
							$ref: '#/definitions/taskRunnerConfiguration',
							description: nls.localize('JsonSchema.mac', 'Mac specific command configuration')
						},
						linux: {
							$ref: '#/definitions/taskRunnerConfiguration',
							description: nls.localize('JsonSchema.linux', 'Linux specific command configuration')
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

const shellCommand: IJSONSchema = {
	type: 'boolean',
	default: true,
	description: nls.localize('JsonSchema.shell', 'Specifies whether the command is a shell command or an external program. Defaults to false if omitted.')
};

schema.definitions = Objects.deepClone(commonSchema.definitions);
let definitions = schema.definitions!;
definitions['commandConfiguration']['properties']!['isShellCommand'] = Objects.deepClone(shellCommand);
definitions['taskDescription']['properties']!['isShellCommand'] = Objects.deepClone(shellCommand);
definitions['taskRunnerConfiguration']['properties']!['isShellCommand'] = Objects.deepClone(shellCommand);

Object.getOwnPropertyNames(definitions).forEach(key => {
	let newKey = key + '1';
	definitions[newKey] = definitions[key];
	delete definitions[key];
});

function fixReferences(literal: any) {
	if (Array.isArray(literal)) {
		literal.forEach(fixReferences);
	} else if (typeof literal === 'object') {
		if (literal['$ref']) {
			literal['$ref'] = literal['$ref'] + '1';
		}
		Object.getOwnPropertyNames(literal).forEach(property => {
			let value = literal[property];
			if (Array.isArray(value) || typeof value === 'object') {
				fixReferences(value);
			}
		});
	}
}
fixReferences(schema);

ProblemMatcherRegistry.onReady().then(() => {
	try {
		let matcherIds = ProblemMatcherRegistry.keys().map(key => '$' + key);
		definitions.problemMatcherType1.oneOf![0].enum = matcherIds;
		(definitions.problemMatcherType1.oneOf![2].items as IJSONSchema).anyOf![1].enum = matcherIds;
	} catch (err) {
		console.log('Installing problem matcher ids failed');
	}
});

export default schema;
