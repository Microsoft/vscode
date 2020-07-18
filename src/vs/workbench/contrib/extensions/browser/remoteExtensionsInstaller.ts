/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IExtensionManagementServerService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { ILabelService } from 'vs/platform/label/common/label';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { InstallLocalExtensionsInRemoteAction } from 'vs/workbench/contrib/extensions/browser/extensionsActions';

export class RemoteExtensionsInstaller extends Disposable implements IWorkbenchContribution {

	constructor(
		@IExtensionManagementServerService private readonly extensionManagementServerService: IExtensionManagementServerService,
		@ILabelService labelService: ILabelService,
		@IInstantiationService instantiationService: IInstantiationService
	) {
		super();
		if (this.extensionManagementServerService.localExtensionManagementServer && this.extensionManagementServerService.remoteExtensionManagementServer) {
			const installLocalExtensionsInRemoteAction = instantiationService.createInstance(InstallLocalExtensionsInRemoteAction);
			CommandsRegistry.registerCommand('workbench.extensions.installLocalExtensions', () => installLocalExtensionsInRemoteAction.run());
			let disposable = Disposable.None;
			const appendMenuItem = () => {
				disposable.dispose();
				disposable = MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
					command: {
						id: 'workbench.extensions.installLocalExtensions',
						category: localize({ key: 'remote', comment: ['Remote as in remote machine'] }, "Remote"),
						title: installLocalExtensionsInRemoteAction.label
					}
				});
			};
			appendMenuItem();
			this._register(labelService.onDidChangeFormatters(e => appendMenuItem()));
			this._register(toDisposable(() => disposable.dispose()));
		}
	}

}
