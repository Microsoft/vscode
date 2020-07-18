/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { PickerQuickAccessProvider, IPickerQuickAccessItem, TriggerAction } from 'vs/platform/quickinput/browser/pickerQuickAccess';
import { localize } from 'vs/nls';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IDebugService } from 'vs/workbench/contrib/debug/common/debug';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { matchesFuzzy } from 'vs/base/common/filters';
import { withNullAsUndefined } from 'vs/base/common/types';
import { ADD_CONFIGURATION_ID } from 'vs/workbench/contrib/debug/browser/debugCommands';

export class StartDebugQuickAccessProvider extends PickerQuickAccessProvider<IPickerQuickAccessItem> {

	static PREFIX = 'debug ';

	constructor(
		@IDebugService private readonly debugService: IDebugService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super(StartDebugQuickAccessProvider.PREFIX, {
			noResultsPick: {
				label: localize('noDebugResults', "No matching launch configurations")
			}
		});
	}

	protected async getPicks(filter: string): Promise<(IQuickPickSeparator | IPickerQuickAccessItem)[]> {
		const picks: Array<IPickerQuickAccessItem | IQuickPickSeparator> = [];
		picks.push({ type: 'separator', label: 'launch.json' });

		const configManager = this.debugService.getConfigurationManager();

		// Entries: configs
		let lastGroup: string | undefined;
		for (let config of configManager.getAllConfigurations()) {
			const highlights = matchesFuzzy(filter, config.name, true);
			if (highlights) {

				// Separator
				if (lastGroup !== config.presentation?.group) {
					picks.push({ type: 'separator' });
					lastGroup = config.presentation?.group;
				}

				// Launch entry
				picks.push({
					label: config.name,
					description: this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE ? config.launch.name : '',
					highlights: { label: highlights },
					buttons: [{
						iconClass: 'codicon-gear',
						tooltip: localize('customizeLaunchConfig', "Configure Launch Configuration")
					}],
					trigger: () => {
						config.launch.openConfigFile(false);

						return TriggerAction.CLOSE_PICKER;
					},
					accept: async () => {
						this.debugService.getConfigurationManager().selectConfiguration(config.launch, config.name);
						try {
							await this.debugService.startDebugging(config.launch);
						} catch (error) {
							this.notificationService.error(error);
						}
					}
				});
			}
		}

		// Entries detected configurations
		const dynamicProviders = await configManager.getDynamicProviders();
		if (dynamicProviders.length > 0) {
			picks.push({
				type: 'separator', label: localize({
					key: 'contributed',
					comment: ['contributed is lower case because it looks better like that in UI. Nothing preceeds it. It is a name of the grouping of debug configurations.']
				}, "contributed")
			});
		}

		dynamicProviders.forEach(provider => {
			picks.push({
				label: `$(folder) ${provider.label}...`,
				ariaLabel: localize({ key: 'providerAriaLabel', comment: ['Placeholder stands for the provider label. For example "NodeJS".'] }, "{0} contributed configurations", provider.label),
				accept: async () => {
					const pick = await provider.pick();
					if (pick) {
						this.debugService.startDebugging(pick.launch, pick.config);
					}
				}
			});
		});


		// Entries: launches
		const visibleLaunches = configManager.getLaunches().filter(launch => !launch.hidden);

		// Separator
		if (visibleLaunches.length > 0) {
			picks.push({ type: 'separator', label: localize('configure', "configure") });
		}

		for (const launch of visibleLaunches) {
			const label = this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE ?
				localize("addConfigTo", "Add Config ({0})...", launch.name) :
				localize('addConfiguration', "Add Configuration...");

			// Add Config entry
			picks.push({
				label,
				description: this.contextService.getWorkbenchState() === WorkbenchState.WORKSPACE ? launch.name : '',
				highlights: { label: withNullAsUndefined(matchesFuzzy(filter, label, true)) },
				accept: () => this.commandService.executeCommand(ADD_CONFIGURATION_ID, launch.uri.toString())
			});
		}

		return picks;
	}
}
