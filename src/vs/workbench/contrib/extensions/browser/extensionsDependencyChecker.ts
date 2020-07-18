/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IExtensionsWorkbenchService } from 'vs/workbench/contrib/extensions/common/extensions';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import { areSameExtensions } from 'vs/platform/extensionManagement/common/extensionManagementUtil';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { Action } from 'vs/base/common/actions';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { Disposable } from 'vs/base/common/lifecycle';
import { CancellationToken } from 'vs/base/common/cancellation';

export class ExtensionDependencyChecker extends Disposable implements IWorkbenchContribution {

	constructor(
		@IExtensionService private readonly extensionService: IExtensionService,
		@IExtensionsWorkbenchService private readonly extensionsWorkbenchService: IExtensionsWorkbenchService,
		@INotificationService private readonly notificationService: INotificationService,
		@IHostService private readonly hostService: IHostService
	) {
		super();
		CommandsRegistry.registerCommand('workbench.extensions.installMissingDependencies', () => this.installMissingDependencies());
		MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
			command: {
				id: 'workbench.extensions.installMissingDependencies',
				category: localize('extensions', "Extensions"),
				title: localize('auto install missing deps', "Install Missing Dependencies")
			}
		});
	}

	private async getUninstalledMissingDependencies(): Promise<string[]> {
		const allMissingDependencies = await this.getAllMissingDependencies();
		const localExtensions = await this.extensionsWorkbenchService.queryLocal();
		return allMissingDependencies.filter(id => localExtensions.every(l => !areSameExtensions(l.identifier, { id })));
	}

	private async getAllMissingDependencies(): Promise<string[]> {
		const runningExtensions = await this.extensionService.getExtensions();
		const runningExtensionsIds: Set<string> = runningExtensions.reduce((result, r) => { result.add(r.identifier.value.toLowerCase()); return result; }, new Set<string>());
		const missingDependencies: Set<string> = new Set<string>();
		for (const extension of runningExtensions) {
			if (extension.extensionDependencies) {
				extension.extensionDependencies.forEach(dep => {
					if (!runningExtensionsIds.has(dep.toLowerCase())) {
						missingDependencies.add(dep);
					}
				});
			}
		}
		return [...missingDependencies.values()];
	}

	private async installMissingDependencies(): Promise<void> {
		const missingDependencies = await this.getUninstalledMissingDependencies();
		if (missingDependencies.length) {
			const extensions = (await this.extensionsWorkbenchService.queryGallery({ names: missingDependencies, pageSize: missingDependencies.length }, CancellationToken.None)).firstPage;
			if (extensions.length) {
				await Promise.all(extensions.map(extension => this.extensionsWorkbenchService.install(extension)));
				this.notificationService.notify({
					severity: Severity.Info,
					message: localize('finished installing missing deps', "Finished installing missing dependencies. Please reload the window now."),
					actions: {
						primary: [new Action('realod', localize('reload', "Reload Window"), '', true,
							() => this.hostService.reload())]
					}
				});
			}
		} else {
			this.notificationService.info(localize('no missing deps', "There are no missing dependencies to install."));
		}
	}
}
