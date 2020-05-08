/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { Action } from 'vs/base/common/actions';
import { MenuId, MenuRegistry, SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { ConfigurationTarget, IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';

export class ToggleMinimapAction extends Action {
	public static readonly ID = 'editor.action.toggleMinimap';
	public static readonly LABEL = nls.localize('toggleMinimap', "Toggle Minimap");

	constructor(
		id: string,
		label: string,
		@IConfigurationService private readonly _configurationService: IConfigurationService
	) {
		super(id, label);
	}

	public run(): Promise<any> {
		const newValue = !this._configurationService.getValue<boolean>('editor.minimap.enabled');
		return this._configurationService.updateValue('editor.minimap.enabled', newValue, ConfigurationTarget.USER);
	}
}

const registry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleMinimapAction), 'View: Toggle Minimap', nls.localize('view', "View"));

MenuRegistry.appendMenuItem(MenuId.MenubarViewMenu, {
	group: '5_editor',
	command: {
		id: ToggleMinimapAction.ID,
		title: nls.localize({ key: 'miShowMinimap', comment: ['&& denotes a mnemonic'] }, "Show &&Minimap"),
		toggled: ContextKeyExpr.equals('config.editor.minimap.enabled', true)
	},
	order: 2
});
