/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { IConfigurationNode, IConfigurationRegistry, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { workbenchConfigurationNodeBase } from 'vs/workbench/common/configuration';
import { Registry } from 'vs/platform/registry/common/platform';

export class NotebookKernelProviderAssociationRegistry {
	static extensionIds: (string | null)[] = [];
	static extensionDescriptions: string[] = [];
}

export class NotebookViewTypesExtensionRegistry {
	static viewTypes: string[] = [];
	static viewTypeDescriptions: string[] = [];
}

export type NotebookKernelProviderAssociation = {
	readonly viewType: string;
	readonly kernelProvider?: string;
};

export type NotebookKernelProviderAssociations = readonly NotebookKernelProviderAssociation[];


export const notebookKernelProviderAssociationsSettingId = 'notebook.kernelProviderAssociations';

export const viewTypeSchamaAddition: IJSONSchema = {
	type: 'string',
	enum: []
};

export const notebookKernelProviderAssociationsConfigurationNode: IConfigurationNode = {
	...workbenchConfigurationNodeBase,
	properties: {
		[notebookKernelProviderAssociationsSettingId]: {
			type: 'array',
			markdownDescription: nls.localize('notebook.kernelProviderAssociations', "Defines a default kernel provider which takes precedence over all other kernel providers settings. Must be the identifier of an extension contributing a kernel provider."),
			items: {
				type: 'object',
				defaultSnippets: [{
					body: {
						'viewType': '$1',
						'kernelProvider': '$2'
					}
				}],
				properties: {
					'viewType': {
						type: ['string', 'null'],
						default: null,
						enum: NotebookViewTypesExtensionRegistry.viewTypes,
						markdownEnumDescriptions: NotebookViewTypesExtensionRegistry.viewTypeDescriptions
					},
					'kernelProvider': {
						type: ['string', 'null'],
						default: null,
						enum: NotebookKernelProviderAssociationRegistry.extensionIds,
						markdownEnumDescriptions: NotebookKernelProviderAssociationRegistry.extensionDescriptions
					}
				}
			}
		}
	}
};

export function updateNotebookKernelProvideAssociationSchema(): void {
	Registry.as<IConfigurationRegistry>(Extensions.Configuration)
		.notifyConfigurationSchemaUpdated(notebookKernelProviderAssociationsConfigurationNode);
}

Registry.as<IConfigurationRegistry>(Extensions.Configuration)
	.registerConfiguration(notebookKernelProviderAssociationsConfigurationNode);
