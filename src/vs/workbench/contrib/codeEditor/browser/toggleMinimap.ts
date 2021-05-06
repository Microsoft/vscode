/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { CATEGORIES } from 'vs/workbench/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

export class ToggleMinimapAction extends Action2 {

	static readonly ID = 'editor.action.toggleMinimap';

	constructor() {
		super({
			id: ToggleMinimapAction.ID,
			title: {
				value: localize('toggleMinimap', "Toggle Minimap"),
				original: 'Toggle Minimap',
				mnemonicTitle: localize({ key: 'miShowMinimap', comment: ['&& denotes a mnemonic'] }, "Show &&Minimap")
			},
			category: CATEGORIES.View,
			f1: true,
			toggled: ContextKeyExpr.equals('config.editor.minimap.enabled', true),
			menu: {
				id: MenuId.MenubarViewMenu,
				group: '5_editor',
				order: 2
			}
		});
	}

	override async run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);

		const newValue = !configurationService.getValue<boolean>('editor.minimap.enabled');
		return configurationService.updateValue('editor.minimap.enabled', newValue);
	}
}

registerAction2(ToggleMinimapAction);
