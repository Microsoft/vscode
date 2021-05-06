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

class ToggleRenderWhitespaceAction extends Action2 {

	static readonly ID = 'editor.action.toggleRenderWhitespace';

	constructor() {
		super({
			id: ToggleRenderWhitespaceAction.ID,
			title: {
				value: localize('toggleRenderWhitespace', "Toggle Render Whitespace"),
				mnemonicTitle: localize({ key: 'miToggleRenderWhitespace', comment: ['&& denotes a mnemonic'] }, "&&Render Whitespace"),
				original: 'Toggle Render Whitespace'
			},
			category: CATEGORIES.View,
			f1: true,
			toggled: ContextKeyExpr.notEquals('config.editor.renderWhitespace', 'none'),
			menu: {
				id: MenuId.MenubarViewMenu,
				group: '5_editor',
				order: 4
			}
		});
	}

	override run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);

		const renderWhitespace = configurationService.getValue<string>('editor.renderWhitespace');

		let newRenderWhitespace: string;
		if (renderWhitespace === 'none') {
			newRenderWhitespace = 'all';
		} else {
			newRenderWhitespace = 'none';
		}

		return configurationService.updateValue('editor.renderWhitespace', newRenderWhitespace);
	}
}

registerAction2(ToggleRenderWhitespaceAction);
