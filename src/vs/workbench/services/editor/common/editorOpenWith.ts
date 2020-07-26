/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { IJSONSchema } from 'vs/base/common/jsonSchema';
import { IConfigurationNode, IConfigurationRegistry, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { workbenchConfigurationNodeBase } from 'vs/workbench/common/configuration';
import { Registry } from 'vs/platform/registry/common/platform';
import { ICustomEditorInfo, IEditorService, IOpenEditorOverrideHandler, IOpenEditorOverrideEntry } from 'vs/workbench/services/editor/common/editorService';
import { IEditorInput, IEditorPane, IEditorInputFactoryRegistry, Extensions as EditorExtensions } from 'vs/workbench/common/editor';
import { ITextEditorOptions, IEditorOptions } from 'vs/platform/editor/common/editor';
import { IEditorGroup, OpenEditorContext } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { URI } from 'vs/base/common/uri';
import { extname, basename, isEqual } from 'vs/base/common/resources';

/**
 * Id of the default editor for open with.
 */
export const DEFAULT_EDITOR_ID = 'default';

/**
 * Try to open an resource with a given editor.
 *
 * @param input Resource to open.
 * @param id Id of the editor to use. If not provided, the user is prompted for which editor to use.
 */
export async function openEditorWith(
	input: IEditorInput,
	id: string | undefined,
	options: IEditorOptions | ITextEditorOptions | undefined,
	group: IEditorGroup,
	editorService: IEditorService,
	configurationService: IConfigurationService,
	quickInputService: IQuickInputService,
): Promise<IEditorPane | undefined> {
	const resource = input.resource;
	if (!resource) {
		return;
	}

	const overrideOptions = { ...options, override: id };

	const allEditorOverrides = getAllAvailableEditors(resource, id, overrideOptions, group, editorService);
	if (!allEditorOverrides.length) {
		return;
	}

	let overrideToUse;
	if (typeof id === 'string') {
		overrideToUse = allEditorOverrides.find(([_, entry]) => entry.id === id);
	} else if (allEditorOverrides.length === 1) {
		overrideToUse = allEditorOverrides[0];
	}
	if (overrideToUse) {
		return overrideToUse[0].open(input, overrideOptions, group, OpenEditorContext.NEW_EDITOR)?.override;
	}

	// Prompt
	const resourceExt = extname(resource);

	const items: (IQuickPickItem & { handler: IOpenEditorOverrideHandler })[] = allEditorOverrides.map((override) => {
		return {
			handler: override[0],
			id: override[1].id,
			label: override[1].label,
			description: override[1].active ? nls.localize('promptOpenWith.currentlyActive', 'Currently Active') : undefined,
			detail: override[1].detail,
			buttons: resourceExt ? [{
				iconClass: 'codicon-settings-gear',
				tooltip: nls.localize('promptOpenWith.setDefaultTooltip', "Set as default editor for '{0}' files", resourceExt)
			}] : undefined
		};
	});

	const picker = quickInputService.createQuickPick<(IQuickPickItem & { handler: IOpenEditorOverrideHandler })>();
	picker.items = items;
	if (items.length) {
		picker.selectedItems = [items[0]];
	}
	picker.placeholder = nls.localize('promptOpenWith.placeHolder', "Select editor for '{0}'", basename(resource));

	const pickedItem = await new Promise<(IQuickPickItem & { handler: IOpenEditorOverrideHandler }) | undefined>(resolve => {
		picker.onDidAccept(() => {
			resolve(picker.selectedItems.length === 1 ? picker.selectedItems[0] : undefined);
			picker.dispose();
		});

		picker.onDidTriggerItemButton(e => {
			const pick = e.item;
			const id = pick.id;
			resolve(pick); // open the view
			picker.dispose();

			// And persist the setting
			if (pick && id) {
				const newAssociation: CustomEditorAssociation = { viewType: id, filenamePattern: '*' + resourceExt };
				const currentAssociations = [...configurationService.getValue<CustomEditorsAssociations>(customEditorsAssociationsSettingId)];

				// First try updating existing association
				for (let i = 0; i < currentAssociations.length; ++i) {
					const existing = currentAssociations[i];
					if (existing.filenamePattern === newAssociation.filenamePattern) {
						currentAssociations.splice(i, 1, newAssociation);
						configurationService.updateValue(customEditorsAssociationsSettingId, currentAssociations);
						return;
					}
				}

				// Otherwise, create a new one
				currentAssociations.unshift(newAssociation);
				configurationService.updateValue(customEditorsAssociationsSettingId, currentAssociations);
			}
		});

		picker.show();
	});

	return pickedItem?.handler.open(input, { ...options, override: pickedItem.id }, group, OpenEditorContext.NEW_EDITOR)?.override;
}

const builtinProviderDisplayName = nls.localize('builtinProviderDisplayName', "Built-in");

export const defaultEditorOverrideEntry = Object.freeze({
	id: DEFAULT_EDITOR_ID,
	label: nls.localize('promptOpenWith.defaultEditor.displayName', "Text Editor"),
	detail: builtinProviderDisplayName
});

/**
 * Get a list of all available editors, including the default text editor.
 */
export function getAllAvailableEditors(
	resource: URI,
	id: string | undefined,
	options: IEditorOptions | ITextEditorOptions | undefined,
	group: IEditorGroup,
	editorService: IEditorService
): Array<[IOpenEditorOverrideHandler, IOpenEditorOverrideEntry]> {
	const fileEditorInputFactory = Registry.as<IEditorInputFactoryRegistry>(EditorExtensions.EditorInputFactories).getFileEditorInputFactory();
	const overrides = editorService.getEditorOverrides(resource, options, group);
	if (!overrides.some(([_, entry]) => entry.id === DEFAULT_EDITOR_ID)) {
		overrides.unshift([
			{
				open: (input: IEditorInput, options: IEditorOptions | ITextEditorOptions | undefined, group: IEditorGroup) => {
					if (!input.resource) {
						return;
					}

					const fileEditorInput = editorService.createEditorInput({ resource: input.resource, forceFile: true });
					const textOptions: IEditorOptions | ITextEditorOptions = options ? { ...options, override: false } : { override: false };
					return { override: editorService.openEditor(fileEditorInput, textOptions, group) };
				}
			},
			{
				...defaultEditorOverrideEntry,
				active: fileEditorInputFactory.isFileEditorInput(editorService.activeEditor) && isEqual(editorService.activeEditor.resource, resource),
			}]);
	}

	return overrides;
}

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
