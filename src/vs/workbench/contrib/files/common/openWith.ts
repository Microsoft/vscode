/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { basename, extname, isEqual } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import * as nls from 'vs/nls';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEditorOptions, ITextEditorOptions } from 'vs/platform/editor/common/editor';
import { IQuickInputService, IQuickPickItem } from 'vs/platform/quickinput/common/quickInput';
import { IEditorInput, IEditorPane } from 'vs/workbench/common/editor';
import { FileEditorInput } from 'vs/workbench/contrib/files/common/editors/fileEditorInput';
import { DEFAULT_EDITOR_ID } from 'vs/workbench/contrib/files/common/files';
import { CustomEditorAssociation, CustomEditorsAssociations, customEditorsAssociationsSettingId } from 'vs/workbench/services/editor/common/editorAssociationsSetting';
import { IEditorGroup } from 'vs/workbench/services/editor/common/editorGroupsService';
import { IEditorService, IOpenEditorOverrideEntry, IOpenEditorOverrideHandler } from 'vs/workbench/services/editor/common/editorService';

const builtinProviderDisplayName = nls.localize('builtinProviderDisplayName', "Built-in");

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

	const allEditorOverrides = getAllAvailableEditors(resource, options, group, editorService);
	if (!allEditorOverrides.length) {
		return;
	}

	const overrideToUse = typeof id === 'string' && allEditorOverrides.find(([_, entry]) => entry.id === id);
	if (overrideToUse) {
		return overrideToUse[0].open(input, options, group, id)?.override;
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

	return pickedItem?.handler.open(input!, options, group, pickedItem.id)?.override;
}

export const defaultEditorOverrideEntry = Object.freeze({
	id: DEFAULT_EDITOR_ID,
	label: nls.localize('promptOpenWith.defaultEditor.displayName', "Text Editor"),
	detail: builtinProviderDisplayName,
});

/**
 * Get a list of all available editors, including the default text editor.
 */
export function getAllAvailableEditors(
	resource: URI,
	options: IEditorOptions | ITextEditorOptions | undefined,
	group: IEditorGroup,
	editorService: IEditorService,
): Array<[IOpenEditorOverrideHandler, IOpenEditorOverrideEntry]> {
	const overrides = editorService.getEditorOverrides(resource, options, group);
	if (!overrides.some(([_, entry]) => entry.id === DEFAULT_EDITOR_ID)) {
		overrides.unshift([
			{
				open: (input: IEditorInput, options: IEditorOptions | ITextEditorOptions | undefined, group: IEditorGroup) => {
					if (!input.resource) {
						return;
					}

					const fileEditorInput = editorService.createEditorInput({ resource: input.resource, forceFile: true });
					const textOptions = options ? { ...options, ignoreOverrides: true } : { ignoreOverrides: true };
					return { override: editorService.openEditor(fileEditorInput, textOptions, group) };
				}
			},
			{
				...defaultEditorOverrideEntry,
				active: editorService.activeEditor instanceof FileEditorInput && isEqual(editorService.activeEditor.resource, resource),
			}]);
	}
	return overrides;
}

