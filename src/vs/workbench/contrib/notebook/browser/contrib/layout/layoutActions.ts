/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { INotebookActionContext, NOTEBOOK_ACTIONS_CATEGORY } from 'vs/workbench/contrib/notebook/browser/contrib/coreActions';
import { CellToolbarLocKey } from 'vs/workbench/contrib/notebook/common/notebookCommon';

const TOGGLE_CELL_TOOLBAR_POSITION = 'notebook.toggleCellToolbarPosition';

export class ToggleCellToolbarPositionAction extends Action2 {
	constructor() {
		super({
			id: TOGGLE_CELL_TOOLBAR_POSITION,
			title: { value: localize('notebook.toggleCellToolbarPosition', "Toggle Cell Toolbar Position"), original: 'Toggle Cell Toolbar Position' },
			menu: [{
				id: MenuId.NotebookCellTitle,
				group: 'View',
				order: 1
			}],
			category: NOTEBOOK_ACTIONS_CATEGORY,
			f1: false
		});
	}

	async run(accessor: ServicesAccessor, context: any): Promise<void> {
		const editor = context && context.ui ? (context as INotebookActionContext).notebookEditor : undefined;
		if (editor && editor.hasModel()) {
			// from toolbar
			const viewType = editor.viewModel.viewType;
			const configurationService = accessor.get(IConfigurationService);
			const toolbarPosition = configurationService.getValue<string | { [key: string]: string }>(CellToolbarLocKey);
			const newConfig = this.togglePosition(viewType, toolbarPosition);
			await configurationService.updateValue(CellToolbarLocKey, newConfig);
		}
	}

	togglePosition(viewType: string, toolbarPosition: string | { [key: string]: string }): { [key: string]: string } {
		if (typeof toolbarPosition === 'string') {
			// legacy
			if (['left', 'right', 'hidden'].indexOf(toolbarPosition) >= 0) {
				// valid position
				const newViewValue = toolbarPosition === 'right' ? 'left' : 'right';
				let config: { [key: string]: string } = {
					default: toolbarPosition
				};
				config[viewType] = newViewValue;
				return config;
			} else {
				// invalid position
				let config: { [key: string]: string } = {
					default: 'right',
				};
				config[viewType] = 'left';
				return config;
			}
		} else {
			const oldValue = toolbarPosition[viewType] ?? toolbarPosition['default'] ?? 'right';
			const newViewValue = oldValue === 'right' ? 'left' : 'right';
			let newConfig = {
				...toolbarPosition
			};
			newConfig[viewType] = newViewValue;
			return newConfig;
		}

	}
}
registerAction2(ToggleCellToolbarPositionAction);

