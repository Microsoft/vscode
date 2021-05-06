/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { Action2, MenuId, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { CATEGORIES, } from 'vs/workbench/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

export class ToggleRenderControlCharacterAction extends Action2 {

	static readonly ID = 'editor.action.toggleRenderControlCharacter';

	constructor() {
		super({
			id: ToggleRenderControlCharacterAction.ID,
			title: {
				value: localize('toggleRenderControlCharacters', "Toggle Control Characters"),
				mnemonicTitle: localize({ key: 'miToggleRenderControlCharacters', comment: ['&& denotes a mnemonic'] }, "Render &&Control Characters"),
				original: 'Toggle Control Characters'
			},
			category: CATEGORIES.View,
			f1: true,
			toggled: ContextKeyExpr.equals('config.editor.renderControlCharacters', true),
			menu: {
				id: MenuId.MenubarViewMenu,
				group: '5_editor',
				order: 5
			}
		});
	}

	override run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);

		const newRenderControlCharacters = !configurationService.getValue<boolean>('editor.renderControlCharacters');
		return configurationService.updateValue('editor.renderControlCharacters', newRenderControlCharacters);
	}
}

registerAction2(ToggleRenderControlCharacterAction);
