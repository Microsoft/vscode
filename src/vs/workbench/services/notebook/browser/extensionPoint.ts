/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IJSONSchema } from 'vs/base/common/jsonSchema';
import * as nls from 'vs/nls';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { NotebookSelector } from 'vs/workbench/services/notebook/common/notebookProvider';

namespace NotebookEditorContribution {
	export const viewType = 'viewType';
	export const displayName = 'displayName';
	export const selector = 'selector';
}

interface INotebookEditorContribution {
	readonly [NotebookEditorContribution.viewType]: string;
	readonly [NotebookEditorContribution.displayName]: string;
	readonly [NotebookEditorContribution.selector]?: readonly NotebookSelector[];
}

namespace NotebookRendererContribution {
	export const viewType = 'viewType';
	export const displayName = 'displayName';
	export const mimeTypes = 'mimeTypes';
}

interface INotebookRendererContribution {
	readonly [NotebookRendererContribution.viewType]: string;
	readonly [NotebookRendererContribution.displayName]: string;
	readonly [NotebookRendererContribution.mimeTypes]?: readonly string[];
}



const notebookProviderContribution: IJSONSchema = {
	description: nls.localize('contributes.notebook.provider', 'Contributes notebook document provider.'),
	type: 'array',
	defaultSnippets: [{ body: [{ viewType: '', displayName: '' }] }],
	items: {
		type: 'object',
		required: [
			NotebookEditorContribution.viewType,
			NotebookEditorContribution.displayName,
			NotebookEditorContribution.selector,
		],
		properties: {
			[NotebookEditorContribution.viewType]: {
				type: 'string',
				description: nls.localize('contributes.notebook.provider.viewType', 'Unique identifier of the notebook.'),
			},
			[NotebookEditorContribution.displayName]: {
				type: 'string',
				description: nls.localize('contributes.notebook.provider.displayName', 'Human readable name of the notebook.'),
			},
			[NotebookEditorContribution.selector]: {
				type: 'array',
				description: nls.localize('contributes.notebook.provider.selector', 'Set of globs that the notebook is for.'),
				items: {
					type: 'object',
					properties: {
						filenamePattern: {
							type: 'string',
							description: nls.localize('contributes.notebook.provider.selector.filenamePattern', 'Glob that the notebook is enabled for.'),
						},
						excludeFileNamePattern: {
							type: 'string',
							description: nls.localize('contributes.notebook.selector.provider.excludeFileNamePattern', 'Glob that the notebook is disabled for.')
						}
					}
				}
			}
		}
	}
};

const notebookRendererContribution: IJSONSchema = {
	description: nls.localize('contributes.notebook.renderer', 'Contributes notebook output renderer provider.'),
	type: 'array',
	defaultSnippets: [{ body: [{ viewType: '', displayName: '', mimeTypes: [''] }] }],
	items: {
		type: 'object',
		required: [
			NotebookRendererContribution.viewType,
			NotebookRendererContribution.displayName,
			NotebookRendererContribution.mimeTypes,
		],
		properties: {
			[NotebookRendererContribution.viewType]: {
				type: 'string',
				description: nls.localize('contributes.notebook.renderer.viewType', 'Unique identifier of the notebook output renderer.'),
			},
			[NotebookRendererContribution.displayName]: {
				type: 'string',
				description: nls.localize('contributes.notebook.renderer.displayName', 'Human readable name of the notebook output renderer.'),
			},
			[NotebookRendererContribution.mimeTypes]: {
				type: 'array',
				description: nls.localize('contributes.notebook.selector', 'Set of globs that the notebook is for.'),
				items: {
					type: 'string'
				}
			}
		}
	}
};

export const notebookProviderExtensionPoint = ExtensionsRegistry.registerExtensionPoint<INotebookEditorContribution[]>(
	{
		extensionPoint: 'notebookProvider',
		jsonSchema: notebookProviderContribution
	});

export const notebookRendererExtensionPoint = ExtensionsRegistry.registerExtensionPoint<INotebookRendererContribution[]>(
	{
		extensionPoint: 'notebookOutputRenderer',
		jsonSchema: notebookRendererContribution
	});
