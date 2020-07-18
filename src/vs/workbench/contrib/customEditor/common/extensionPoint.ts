/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IJSONSchema } from 'vs/base/common/jsonSchema';
import * as nls from 'vs/nls';
import { CustomEditorPriority, CustomEditorSelector } from 'vs/workbench/contrib/customEditor/common/customEditor';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { languagesExtPoint } from 'vs/workbench/services/mode/common/workbenchModeService';

namespace Fields {
	export const viewType = 'viewType';
	export const displayName = 'displayName';
	export const selector = 'selector';
	export const priority = 'priority';
}

export interface ICustomEditorsExtensionPoint {
	readonly [Fields.viewType]: string;
	readonly [Fields.displayName]: string;
	readonly [Fields.selector]?: readonly CustomEditorSelector[];
	readonly [Fields.priority]?: string;
}

const CustomEditorsContribution: IJSONSchema = {
	description: nls.localize('contributes.customEditors', 'Contributed custom editors.'),
	type: 'array',
	defaultSnippets: [{
		body: [{
			[Fields.viewType]: '$1',
			[Fields.displayName]: '$2',
			[Fields.selector]: [{
				filenamePattern: '$3'
			}],
		}]
	}],
	items: {
		type: 'object',
		required: [
			Fields.viewType,
			Fields.displayName,
			Fields.selector,
		],
		properties: {
			[Fields.viewType]: {
				type: 'string',
				markdownDescription: nls.localize('contributes.viewType', 'Identifier for the custom editor. This must be unique across all custom editors, so we recommend including your extension id as part of `viewType`. The `viewType` is used when registering custom editors with `vscode.registerCustomEditorProvider` and in the `onCustomEditor:${id}` [activation event](https://code.visualstudio.com/api/references/activation-events).'),
			},
			[Fields.displayName]: {
				type: 'string',
				description: nls.localize('contributes.displayName', 'Human readable name of the custom editor. This is displayed to users when selecting which editor to use.'),
			},
			[Fields.selector]: {
				type: 'array',
				description: nls.localize('contributes.selector', 'Set of globs that the custom editor is enabled for.'),
				items: {
					type: 'object',
					defaultSnippets: [{
						body: {
							filenamePattern: '$1',
						}
					}],
					properties: {
						filenamePattern: {
							type: 'string',
							description: nls.localize('contributes.selector.filenamePattern', 'Glob that the custom editor is enabled for.'),
						},
					}
				}
			},
			[Fields.priority]: {
				type: 'string',
				markdownDeprecationMessage: nls.localize('contributes.priority', 'Controls if the custom editor is enabled automatically when the user opens a file. This may be overridden by users using the `workbench.editorAssociations` setting.'),
				enum: [
					CustomEditorPriority.default,
					CustomEditorPriority.option,
				],
				markdownEnumDescriptions: [
					nls.localize('contributes.priority.default', 'The editor is automatically used when the user opens a resource, provided that no other default custom editors are registered for that resource.'),
					nls.localize('contributes.priority.option', 'The editor is not automatically used when the user opens a resource, but a user can switch to the editor using the `Reopen With` command.'),
				],
				default: 'default'
			}
		}
	}
};

export const customEditorsExtensionPoint = ExtensionsRegistry.registerExtensionPoint<ICustomEditorsExtensionPoint[]>({
	extensionPoint: 'customEditors',
	deps: [languagesExtPoint],
	jsonSchema: CustomEditorsContribution
});
