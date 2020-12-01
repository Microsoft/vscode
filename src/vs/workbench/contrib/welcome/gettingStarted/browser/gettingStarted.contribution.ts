/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { GettingStartedInputFactory, GettingStartedPage, GettingStartedInput } from 'vs/workbench/contrib/welcome/gettingStarted/browser/gettingStarted';
import { Registry } from 'vs/platform/registry/common/platform';
import { Extensions as EditorInputExtensions, IEditorInputFactoryRegistry } from 'vs/workbench/common/editor';
import { MenuId, registerAction2, Action2 } from 'vs/platform/actions/common/actions';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from 'vs/platform/configuration/common/configurationRegistry';
import { workbenchConfigurationNodeBase } from 'vs/workbench/common/configuration';
import product from 'vs/platform/product/common/product';

registerAction2(class extends Action2 {
	constructor() {
		super({
			id: 'workbench.action.showGettingStarted',
			title: localize('Getting Started', "Getting Started"),
			category: localize('help', "Help"),
			f1: true,
			precondition: ContextKeyExpr.has('config.workbench.experimental.gettingStarted'),
			menu: {
				id: MenuId.MenubarHelpMenu,
				when: ContextKeyExpr.has('config.workbench.experimental.gettingStarted'),
				group: '1_welcome',
				order: 2,
			}
		});
	}

	public run(accessor: ServicesAccessor) {
		return accessor.get(IInstantiationService).createInstance(GettingStartedPage, {}).openEditor();
	}
});

Registry.as<IEditorInputFactoryRegistry>(EditorInputExtensions.EditorInputFactories).registerEditorInputFactory(GettingStartedInput.ID, GettingStartedInputFactory);

if (product.quality !== 'stable') {
	Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
		...workbenchConfigurationNodeBase,
		properties: {
			'workbench.experimental.gettingStarted': {
				type: 'boolean',
				description: localize('gettingStartedDescription', "Enables an experimental Getting Started page, accesible via the Help menu."),
				default: false,
			}
		}
	});
}
