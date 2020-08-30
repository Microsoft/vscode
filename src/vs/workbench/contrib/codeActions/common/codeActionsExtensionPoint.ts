/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IConfigurationPropertySchema } from 'vs/platform/configuration/common/configurationRegistry';
import { languagesExtPoint } from 'vs/workbench/services/mode/common/workbenchModeService';

export enum CodeActionExtensionPointFields {
	languages = 'languages',
	actions = 'actions',
	kind = 'kind',
	title = 'title',
	description = 'description'
}

export interface ContributedCodeAction {
	readonly [CodeActionExtensionPointFields.kind]: string;
	readonly [CodeActionExtensionPointFields.title]: string;
	readonly [CodeActionExtensionPointFields.description]?: string;
}

export interface CodeActionsExtensionPoint {
	readonly [CodeActionExtensionPointFields.languages]: readonly string[];
	readonly [CodeActionExtensionPointFields.actions]: readonly ContributedCodeAction[];
}

const codeActionsExtensionPointSchema = Object.freeze<IConfigurationPropertySchema>({
	type: 'array',
	markdownDescription: nls.localize('contributes.codeActions', "Configure which editor to use for a resource."),
	items: {
		type: 'object',
		required: [CodeActionExtensionPointFields.languages, CodeActionExtensionPointFields.actions],
		properties: {
			[CodeActionExtensionPointFields.languages]: {
				type: 'array',
				description: nls.localize('contributes.codeActions.languages', "Language modes that the code actions are enabled for."),
				items: { type: 'string' }
			},
			[CodeActionExtensionPointFields.actions]: {
				type: 'object',
				required: [CodeActionExtensionPointFields.kind, CodeActionExtensionPointFields.title],
				properties: {
					[CodeActionExtensionPointFields.kind]: {
						type: 'string',
						markdownDescription: nls.localize('contributes.codeActions.kind', "`CodeActionKind` of the contributed code action."),
					},
					[CodeActionExtensionPointFields.title]: {
						type: 'string',
						description: nls.localize('contributes.codeActions.title', "Label for the code action used in the UI."),
					},
					[CodeActionExtensionPointFields.description]: {
						type: 'string',
						description: nls.localize('contributes.codeActions.description', "Description of what the code action does."),
					},
				}
			}
		}
	}
});

export const codeActionsExtensionPointDescriptor = {
	extensionPoint: 'codeActions',
	deps: [languagesExtPoint],
	jsonSchema: codeActionsExtensionPointSchema
};
