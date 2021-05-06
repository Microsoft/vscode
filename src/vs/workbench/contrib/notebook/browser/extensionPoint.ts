/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IJSONSchema } from 'vs/base/common/jsonSchema';
import * as nls from 'vs/nls';
import { ExtensionsRegistry } from 'vs/workbench/services/extensions/common/extensionsRegistry';
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
	readonly [NotebookEditorContribution.selector]?: readonly { filenamePattern?: string; excludeFileNamePattern?: string; }[];
	readonly [NotebookEditorContribution.priority]?: string;
}

namespace NotebookRendererContribution {
	export const viewType = 'viewType';
	export const id = 'id';
	export const displayName = 'displayName';
	export const mimeTypes = 'mimeTypes';
	export const entrypoint = 'entrypoint';
	export const hardDependencies = 'dependencies';
	export const optionalDependencies = 'optionalDependencies';
}

export interface INotebookRendererContribution {
	readonly [NotebookRendererContribution.id]?: string;
	readonly [NotebookRendererContribution.viewType]?: string;
	readonly [NotebookRendererContribution.displayName]: string;
	readonly [NotebookRendererContribution.mimeTypes]?: readonly string[];
	readonly [NotebookRendererContribution.entrypoint]: string;
	readonly [NotebookRendererContribution.hardDependencies]: readonly string[];
	readonly [NotebookRendererContribution.optionalDependencies]: readonly string[];
}

enum NotebookMarkupRendererContribution {
	id = 'id',
	displayName = 'displayName',
	entrypoint = 'entrypoint',
	dependsOn = 'dependsOn',
	mimeTypes = 'mimeTypes',
}

export interface INotebookMarkupRendererContribution {
	readonly [NotebookMarkupRendererContribution.id]?: string;
	readonly [NotebookMarkupRendererContribution.displayName]: string;
	readonly [NotebookMarkupRendererContribution.entrypoint]: string;
	readonly [NotebookMarkupRendererContribution.dependsOn]: string | undefined;
	readonly [NotebookMarkupRendererContribution.mimeTypes]: string[] | undefined;
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
	defaultSnippets: [{ body: [{ id: '', displayName: '', mimeTypes: [''], entrypoint: '' }] }],
	items: {
		type: 'object',
		required: [
			NotebookRendererContribution.id,
			NotebookRendererContribution.displayName,
			NotebookRendererContribution.mimeTypes,
			NotebookRendererContribution.entrypoint,
		],
		properties: {
			[NotebookRendererContribution.id]: {
				type: 'string',
				description: nls.localize('contributes.notebook.renderer.viewType', 'Unique identifier of the notebook output renderer.'),
			},
			[NotebookRendererContribution.viewType]: {
				type: 'string',
				deprecationMessage: nls.localize('contributes.notebook.provider.viewType.deprecated', 'Rename `viewType` to `id`.'),
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
			[NotebookRendererContribution.hardDependencies]: {
				type: 'array',
				uniqueItems: true,
				items: { type: 'string' },
				markdownDescription: nls.localize('contributes.notebook.renderer.hardDependencies', 'List of kernel dependencies the renderer requires. If any of the dependencies are present in the `NotebookKernel.preloads`, the renderer can be used.'),
			},
			[NotebookRendererContribution.optionalDependencies]: {
				type: 'array',
				uniqueItems: true,
				items: { type: 'string' },
				markdownDescription: nls.localize('contributes.notebook.renderer.optionalDependencies', 'List of soft kernel dependencies the renderer can make use of. If any of the dependencies are present in the `NotebookKernel.preloads`, the renderer will be preferred over renderers that don\'t interact with the kernel.'),
			},
		}
	}
};
const notebookMarkupRendererContribution: IJSONSchema = {
	description: nls.localize('contributes.notebook.markdownRenderer', 'Contributes a renderer for markdown cells in notebooks.'),
	type: 'array',
	defaultSnippets: [{ body: [{ id: '', displayName: '', entrypoint: '' }] }],
	items: {
		type: 'object',
		required: [
			NotebookMarkupRendererContribution.id,
			NotebookMarkupRendererContribution.displayName,
			NotebookMarkupRendererContribution.entrypoint,
		],
		properties: {
			[NotebookMarkupRendererContribution.id]: {
				type: 'string',
				description: nls.localize('contributes.notebook.markdownRenderer.id', 'Unique identifier of the notebook markdown renderer.'),
			},
			[NotebookMarkupRendererContribution.displayName]: {
				type: 'string',
				description: nls.localize('contributes.notebook.markdownRenderer.displayName', 'Human readable name of the notebook markdown renderer.'),
			},
			[NotebookMarkupRendererContribution.entrypoint]: {
				type: 'string',
				description: nls.localize('contributes.notebook.markdownRenderer.entrypoint', 'File to load in the webview to render the extension.'),
			},
			[NotebookMarkupRendererContribution.mimeTypes]: {
				type: 'array',
				items: { type: 'string' },
				description: nls.localize('contributes.notebook.markdownRenderer.mimeTypes', 'The mime type that the renderer handles.'),
			},
			[NotebookMarkupRendererContribution.dependsOn]: {
				type: 'string',
				description: nls.localize('contributes.notebook.markdownRenderer.dependsOn', 'If specified, this renderer augments another renderer instead of providing full rendering.'),
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

export const notebookMarkupRendererExtensionPoint = ExtensionsRegistry.registerExtensionPoint<INotebookMarkupRendererContribution[]>(
	{
		extensionPoint: 'notebookMarkupRenderers',
		jsonSchema: notebookMarkupRendererContribution
	});
