/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IConfigurationPropertySchema } from 'vs/platform/configuration/common/configurationRegistry';
import { languagesExtPoint } from 'vs/workbench/services/mode/common/workbenchModeService';

export enum DocumentationExtensionPointFields {
	when = 'when',
	title = 'title',
	command = 'command',
}

export interface RefactoringDocumentationExtensionPoint {
	readonly [DocumentationExtensionPointFields.title]: string;
	readonly [DocumentationExtensionPointFields.when]: string;
	readonly [DocumentationExtensionPointFields.command]: string;
}

export interface DocumentationExtensionPoint {
	readonly refactoring?: readonly RefactoringDocumentationExtensionPoint[];
}

const documentationExtensionPointSchema = Object.freeze<IConfigurationPropertySchema>({
	type: 'object',
	description: nls.localize('contributes.documentation', "Contributed documentation."),
	properties: {
		'refactoring': {
			type: 'array',
			description: nls.localize('contributes.documentation.refactorings', "Contributed documentation for refactorings."),
			items: {
				type: 'object',
				description: nls.localize('contributes.documentation.refactoring', "Contributed documentation for refactoring."),
				required: [
					DocumentationExtensionPointFields.title,
					DocumentationExtensionPointFields.when,
					DocumentationExtensionPointFields.command
				],
				properties: {
					[DocumentationExtensionPointFields.title]: {
						type: 'string',
						description: nls.localize('contributes.documentation.refactoring.title', "Label for the documentation used in the UI."),
					},
					[DocumentationExtensionPointFields.when]: {
						type: 'string',
						description: nls.localize('contributes.documentation.refactoring.when', "When clause."),
					},
					[DocumentationExtensionPointFields.command]: {
						type: 'string',
						description: nls.localize('contributes.documentation.refactoring.command', "Command executed."),
					},
				},
			}
		}
	}
});

export const documentationExtensionPointDescriptor = {
	extensionPoint: 'documentation',
	deps: [languagesExtPoint],
	jsonSchema: documentationExtensionPointSchema
};
