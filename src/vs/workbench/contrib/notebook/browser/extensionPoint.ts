/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IJSONSchema } from 'vs/base/common/jsonSchema';
import * as nls from 'vs/nls';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';
import { NotebookSelector } from 'vs/workbench/contrib/notebook/common/notebookProvider';
import { NotebookEditorPriority } from 'vs/workbench/contrib/notebook/common/notebookCommon';

namespace NotebookEditorContribution {
	export const viewType = 'viewType';
	export const displayName = 'displayName';
	export const selector = 'selector';
	export const priority = 'priority';
}

export interface INotebookEditorContribution {
	readonly [NotebookEditorContribution.viewType]: string;
	readonly [NotebookEditorContribution.displayName]: string;
	readonly [NotebookEditorContribution.selector]?: readonly NotebookSelector[];
	readonly [NotebookEditorContribution.priority]?: string;
}

namespace NotebookRendererContribution {
	export const viewType = 'viewType';
	export const displayName = 'displayName';
	export const mimeTypes = 'mimeTypes';
	export const entrypoint = 'entrypoint';
}

export interface INotebookRendererContribution {
	readonly [NotebookRendererContribution.viewType]: string;
	readonly [NotebookRendererContribution.displayName]: string;
	readonly [NotebookRendererContribution.mimeTypes]?: readonly string[];
	readonly [NotebookRendererContribution.entrypoint]?: string;
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
			},
			[NotebookEditorContribution.priority]: {
				type: 'string',
				markdownDeprecationMessage: nls.localize('contributes.priority', 'Controls if the custom editor is enabled automatically when the user opens a file. This may be overridden by users using the `workbench.editorAssociations` setting.'),
				enum: [
					NotebookEditorPriority.default,
					NotebookEditorPriority.option,
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
			},
			[NotebookRendererContribution.entrypoint]: {
				type: 'string',
				description: nls.localize('contributes.notebook.renderer.entrypoint', 'File to load in the webview to render the extension.'),
			},
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
