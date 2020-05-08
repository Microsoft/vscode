/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IJSONSchema } from 'vs/base/common/jsonSchema';
import * as nls from 'vs/nls';
import { IConfigurationNode, IConfigurationRegistry, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { workbenchConfigurationNodeBase } from 'vs/workbench/common/configuration';
import { Registry } from 'vs/platform/registry/common/platform';
import { ICustomEditorInfo } from 'vs/workbench/services/editor/common/editorService';

export const customEditorsAssociationsSettingId = 'workbench.editorAssociations';

export const viewTypeSchamaAddition: IJSONSchema = {
	type: 'string',
	enum: []
};

export type CustomEditorAssociation = {
	readonly viewType: string;
	readonly filenamePattern?: string;
};

export type CustomEditorsAssociations = readonly CustomEditorAssociation[];

export const editorAssociationsConfigurationNode: IConfigurationNode = {
	...workbenchConfigurationNodeBase,
	properties: {
		[customEditorsAssociationsSettingId]: {
			type: 'array',
			markdownDescription: nls.localize('editor.editorAssociations', "Configure which editor to use for specific file types."),
			items: {
				type: 'object',
				defaultSnippets: [{
					body: {
						'viewType': '$1',
						'filenamePattern': '$2'
					}
				}],
				properties: {
					'viewType': {
						anyOf: [
							{
								type: 'string',
								description: nls.localize('editor.editorAssociations.viewType', "The unique id of the editor to use."),
							},
							viewTypeSchamaAddition
						]
					},
					'filenamePattern': {
						type: 'string',
						description: nls.localize('editor.editorAssociations.filenamePattern', "Glob pattern specifying which files the editor should be used for."),
					}
				}
			}
		}
	}
};


const builtinProviderDisplayName = nls.localize('builtinProviderDisplayName', "Built-in");

export const DEFAULT_CUSTOM_EDITOR: ICustomEditorInfo = {
	id: 'default',
	displayName: nls.localize('promptOpenWith.defaultEditor.displayName', "Text Editor"),
	providerDisplayName: builtinProviderDisplayName
};

export function updateViewTypeSchema(enumValues: string[], enumDescriptions: string[]): void {
	viewTypeSchamaAddition.enum = enumValues;
	viewTypeSchamaAddition.enumDescriptions = enumDescriptions;

	Registry.as<IConfigurationRegistry>(Extensions.Configuration)
		.notifyConfigurationSchemaUpdated(editorAssociationsConfigurationNode);
}
