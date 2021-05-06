/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { isMacintosh } from 'vs/base/common/platform';
import { Action2, MenuId, MenuRegistry, registerAction2 } from 'vs/platform/actions/common/actions';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IContextKey, IContextKeyService, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as WorkbenchExtensions, IWorkbenchContribution, IWorkbenchContributionsRegistry } from 'vs/workbench/common/contributions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';

export class ToggleMultiCursorModifierAction extends Action2 {

	static readonly ID = 'workbench.action.toggleMultiCursorModifier';

	private static readonly multiCursorModifierConfigurationKey = 'editor.multiCursorModifier';

	constructor() {
		super({
			id: ToggleMultiCursorModifierAction.ID,
			title: { value: localize('toggleLocation', "Toggle Multi-Cursor Modifier"), original: 'Toggle Multi-Cursor Modifier' },
			f1: true
		});
	}

	override run(accessor: ServicesAccessor): Promise<void> {
		const configurationService = accessor.get(IConfigurationService);

		const editorConf = configurationService.getValue<{ multiCursorModifier: 'ctrlCmd' | 'alt' }>('editor');
		const newValue: 'ctrlCmd' | 'alt' = (editorConf.multiCursorModifier === 'ctrlCmd' ? 'alt' : 'ctrlCmd');

		return configurationService.updateValue(ToggleMultiCursorModifierAction.multiCursorModifierConfigurationKey, newValue);
	}
}

const multiCursorModifier = new RawContextKey<string>('multiCursorModifier', 'altKey');

class MultiCursorModifierContextKeyController implements IWorkbenchContribution {

	private readonly _multiCursorModifier: IContextKey<string>;

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService
	) {
		this._multiCursorModifier = multiCursorModifier.bindTo(contextKeyService);

		this._update();
		configurationService.onDidChangeConfiguration((e) => {
			if (e.affectsConfiguration('editor.multiCursorModifier')) {
				this._update();
			}
		});
	}

	private _update(): void {
		const editorConf = this.configurationService.getValue<{ multiCursorModifier: 'ctrlCmd' | 'alt' }>('editor');
		const value = (editorConf.multiCursorModifier === 'ctrlCmd' ? 'ctrlCmd' : 'altKey');
		this._multiCursorModifier.set(value);
	}
}

Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench).registerWorkbenchContribution(MultiCursorModifierContextKeyController, LifecyclePhase.Restored);

registerAction2(ToggleMultiCursorModifierAction);

MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
	group: '4_config',
	command: {
		id: ToggleMultiCursorModifierAction.ID,
		title: localize('miMultiCursorAlt', "Switch to Alt+Click for Multi-Cursor")
	},
	when: multiCursorModifier.isEqualTo('ctrlCmd'),
	order: 1
});
MenuRegistry.appendMenuItem(MenuId.MenubarSelectionMenu, {
	group: '4_config',
	command: {
		id: ToggleMultiCursorModifierAction.ID,
		title: (
			isMacintosh
				? localize('miMultiCursorCmd', "Switch to Cmd+Click for Multi-Cursor")
				: localize('miMultiCursorCtrl', "Switch to Ctrl+Click for Multi-Cursor")
		)
	},
	when: multiCursorModifier.isEqualTo('altKey'),
	order: 1
});
