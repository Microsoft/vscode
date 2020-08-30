/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IJSONSchema } from 'vs/base/common/jsonSchema';

const idDescription = nls.localize('JsonSchema.input.id', "The input's id is used to associate an input with a variable of the form ${input:id}.");
const typeDescription = nls.localize('JsonSchema.input.type', "The type of user input prompt to use.");
const descriptionDescription = nls.localize('JsonSchema.input.description', "The description is shown when the user is prompted for input.");
const defaultDescription = nls.localize('JsonSchema.input.default', "The default value for the input.");


export const inputsSchema: IJSONSchema = {
	definitions: {
		inputs: {
			type: 'array',
			description: nls.localize('JsonSchema.inputs', 'User inputs. Used for defining user input prompts, such as free string input or a choice from several options.'),
			items: {
				oneOf: [
					{
						type: 'object',
						required: ['id', 'type', 'description'],
						additionalProperties: false,
						properties: {
							id: {
								type: 'string',
								description: idDescription
							},
							type: {
								type: 'string',
								description: typeDescription,
								enum: ['promptString'],
								enumDescriptions: [
									nls.localize('JsonSchema.input.type.promptString', "The 'promptString' type opens an input box to ask the user for input."),
								]
							},
							description: {
								type: 'string',
								description: descriptionDescription
							},
							default: {
								type: 'string',
								description: defaultDescription
							},
							password: {
								type: 'boolean',
								description: nls.localize('JsonSchema.input.password', "Controls if a password input is shown. Password input hides the typed text."),
							},
						}
					},
					{
						type: 'object',
						required: ['id', 'type', 'description', 'options'],
						additionalProperties: false,
						properties: {
							id: {
								type: 'string',
								description: idDescription
							},
							type: {
								type: 'string',
								description: typeDescription,
								enum: ['pickString'],
								enumDescriptions: [
									nls.localize('JsonSchema.input.type.pickString', "The 'pickString' type shows a selection list."),
								]
							},
							description: {
								type: 'string',
								description: descriptionDescription
							},
							default: {
								type: 'string',
								description: defaultDescription
							},
							options: {
								type: 'array',
								description: nls.localize('JsonSchema.input.options', "An array of strings that defines the options for a quick pick."),
								items: {
									oneOf: [
										{
											type: 'string'
										},
										{
											type: 'object',
											required: ['value'],
											additionalProperties: false,
											properties: {
												label: {
													type: 'string',
													description: nls.localize('JsonSchema.input.pickString.optionLabel', "Label for the option.")
												},
												value: {
													type: 'string',
													description: nls.localize('JsonSchema.input.pickString.optionValue', "Value for the option.")
												}
											}
										}
									]
								}
							}
						}
					},
					{
						type: 'object',
						required: ['id', 'type', 'command'],
						additionalProperties: false,
						properties: {
							id: {
								type: 'string',
								description: idDescription
							},
							type: {
								type: 'string',
								description: typeDescription,
								enum: ['command'],
								enumDescriptions: [
									nls.localize('JsonSchema.input.type.command', "The 'command' type executes a command."),
								]
							},
							command: {
								type: 'string',
								description: nls.localize('JsonSchema.input.command.command', "The command to execute for this input variable.")
							},
							args: {
								oneOf: [
									{
										type: 'object',
										description: nls.localize('JsonSchema.input.command.args', "Optional arguments passed to the command.")
									},
									{
										type: 'array',
										description: nls.localize('JsonSchema.input.command.args', "Optional arguments passed to the command.")
									},
									{
										type: 'string',
										description: nls.localize('JsonSchema.input.command.args', "Optional arguments passed to the command.")
									}
								]
							}
						}
					}
				]
			}
		}
	}
};
