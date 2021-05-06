/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IStartEntry, IWalkthrough } from 'vs/platform/extensions/common/extensions';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';

export const walkthroughsExtensionPoint = ExtensionsRegistry.registerExtensionPoint<IWalkthrough[]>({
	extensionPoint: 'walkthroughs',
	jsonSchema: {
		doNotSuggest: true,
		description: localize('walkthroughs', "Contribute collections of steps to help users with your extension. Experimental, available in VS Code Insiders only."),
		type: 'array',
		items: {
			type: 'object',
			required: ['id', 'title', 'description', 'steps'],
			defaultSnippets: [{ body: { 'id': '$1', 'title': '$2', 'description': '$3', 'steps': [] } }],
			properties: {
				id: {
					type: 'string',
					description: localize('walkthroughs.id', "Unique identifier for this walkthrough."),
				},
				title: {
					type: 'string',
					description: localize('walkthroughs.title', "Title of walkthrough.")
				},
				description: {
					type: 'string',
					description: localize('walkthroughs.description', "Description of walkthrough.")
				},
				primary: {
					type: 'boolean',
					description: localize('walkthroughs.primary', "if this is a `primary` walkthrough, hinting if it should be opened on install of the extension. The first `primary` walkthough with a `when` condition matching the current context may be opened by core on install of the extension.")
				},
				when: {
					type: 'string',
					description: localize('walkthroughs.when', "Context key expression to control the visibility of this walkthrough.")
				},
				tasks: {
					deprecationMessage: localize('usesteps', "Deprecated. Use `steps` instead")
				},
				steps: {
					type: 'array',
					description: localize('walkthroughs.steps', "Steps to complete as part of this walkthrough."),
					items: {
						type: 'object',
						required: ['id', 'title', 'description', 'media'],
						defaultSnippets: [{
							body: {
								'id': '$1', 'title': '$2', 'description': '$3',
								'doneOn': { 'command': '$5' },
								'media': { 'path': '$6', 'type': '$7' }
							}
						}],
						properties: {
							id: {
								type: 'string',
								description: localize('walkthroughs.steps.id', "Unique identifier for this step. This is used to keep track of which steps have been completed."),
							},
							title: {
								type: 'string',
								description: localize('walkthroughs.steps.title', "Title of step.")
							},
							description: {
								type: 'string',
								description: localize('walkthroughs.steps.description', "Description of step. Supports ``preformatted``, __italic__, and **bold** text. Use markdown-style links for commands or external links: [Title](command:myext.command), [Title](command:toSide:myext.command), or [Title](https://aka.ms). Links on their own line will be rendered as buttons.")
							},
							button: {
								deprecationMessage: localize('walkthroughs.steps.button.deprecated', "Deprecated. Use markdown links in the description instead, i.e. [Title](command:myext.command), [Title](command:toSide:myext.command), or [Title](https://aka.ms), "),
							},
							media: {
								type: 'object',
								description: localize('walkthroughs.steps.media', "Media to show alongside this step, either an image or markdown content."),
								defaultSnippets: [{ 'body': { 'type': '$1', 'path': '$2' } }],
								oneOf: [
									{
										required: ['path', 'altText'],
										additionalProperties: false,
										properties: {
											path: {
												description: localize('walkthroughs.steps.media.image.path.string', "Path to an image - or object consisting of paths to light, dark, and hc images - relative to extension directory. Depending on context, the image will be displayed from 400px to 800px wide, with similar bounds on height. To support HIDPI displays, the image will be rendered at 1.5x scaling, for example a 900 physical pixels wide image will be displayed as 600 logical pixels wide."),
												oneOf: [
													{
														type: 'string',
													},
													{
														type: 'object',
														required: ['dark', 'light', 'hc'],
														properties: {
															dark: {
																description: localize('walkthroughs.steps.media.image.path.dark.string', "Path to the image for dark themes, relative to extension directory."),
																type: 'string',
															},
															light: {
																description: localize('walkthroughs.steps.media.image.path.light.string', "Path to the image for light themes, relative to extension directory."),
																type: 'string',
															},
															hc: {
																description: localize('walkthroughs.steps.media.image.path.hc.string', "Path to the image for hc themes, relative to extension directory."),
																type: 'string',
															}
														}
													}
												]
											},
											altText: {
												type: 'string',
												description: localize('walkthroughs.steps.media.altText', "Alternate text to display when the image cannot be loaded or in screen readers.")
											}
										}
									}, {
										required: ['path'],
										additionalProperties: false,
										properties: {
											path: {
												description: localize('walkthroughs.steps.media.markdown.path', "Path to the markdown document, relative to extension directory."),
												type: 'string',
											}
										}
									}
								]
							},
							doneOn: {
								description: localize('walkthroughs.steps.doneOn', "Signal to mark step as complete."),
								type: 'object',
								required: ['command'],
								defaultSnippets: [{ 'body': { command: '$1' } }],
								properties: {
									'command': {
										description: localize('walkthroughs.steps.oneOn.command', "Mark step done when the specified command is executed."),
										type: 'string'
									}
								},
							},
							when: {
								type: 'string',
								description: localize('walkthroughs.steps.when', "Context key expression to control the visibility of this step.")
							}
						}
					}
				}
			}
		}
	}
});

export const startEntriesExtensionPoint = ExtensionsRegistry.registerExtensionPoint<IStartEntry[]>({
	extensionPoint: 'startEntries',
	jsonSchema: {
		doNotSuggest: true,
		description: localize('startEntries', "Contribute commands to help users start using your extension. Experimental, available in VS Code Insiders only."),
		type: 'array',
		items: {
			type: 'object',
			required: ['id', 'title', 'description'],
			defaultSnippets: [{ body: { 'id': '$1', 'title': '$2', 'description': '$3' } }],
			properties: {
				title: {
					type: 'string',
					description: localize('startEntries.title', "Title of start item.")
				},
				command: {
					type: 'string',
					description: localize('startEntries.command', "Command to run.")
				},
				description: {
					type: 'string',
					description: localize('startEntries.description', "Description of start item.")
				},
				when: {
					type: 'string',
					description: localize('startEntries.when', "Context key expression to control the visibility of this start item.")
				},
				type: {
					type: 'string',
					enum: ['sample-notebook', 'template-folder'],
					description: localize('startEntries.type', "The type of start item this is, used for grouping. Supported values are `sample-notebook` or `template-folder`.")
				}
			}
		}
	}
});
