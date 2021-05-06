/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IQuickPickSeparator } from 'vs/platform/quickinput/common/quickInput';
import { IPickerQuickAccessItem, PickerQuickAccessProvider, TriggerAction } from 'vs/platform/quickinput/browser/pickerQuickAccess';
import { matchesFuzzy } from 'vs/base/common/filters';
import { ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { TerminalCommandId } from 'vs/workbench/contrib/terminal/common/terminal';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { killTerminalIcon, renameTerminalIcon } from 'vs/workbench/contrib/terminal/browser/terminalIcons';

export class TerminalQuickAccessProvider extends PickerQuickAccessProvider<IPickerQuickAccessItem> {

	static PREFIX = 'term ';

	constructor(
		@ITerminalService private readonly _terminalService: ITerminalService,
		@ICommandService private readonly _commandService: ICommandService,
	) {
		super(TerminalQuickAccessProvider.PREFIX, { canAcceptInBackground: true });
	}

	protected _getPicks(filter: string): Array<IPickerQuickAccessItem | IQuickPickSeparator> {
		const terminalPicks: Array<IPickerQuickAccessItem | IQuickPickSeparator> = [];

		const terminalGroups = this._terminalService.terminalGroups;
		for (let groupIndex = 0; groupIndex < terminalGroups.length; groupIndex++) {
			const terminalGroup = terminalGroups[groupIndex];
			for (let terminalIndex = 0; terminalIndex < terminalGroup.terminalInstances.length; terminalIndex++) {
				const terminal = terminalGroup.terminalInstances[terminalIndex];
				const label = `$(${terminal.icon?.id}) ${groupIndex + 1}.${terminalIndex + 1}: ${terminal.title}`;

				const highlights = matchesFuzzy(filter, label, true);
				if (highlights) {
					terminalPicks.push({
						label,
						highlights: { label: highlights },
						buttons: [
							{
								iconClass: ThemeIcon.asClassName(renameTerminalIcon),
								tooltip: localize('renameTerminal', "Rename Terminal")
							},
							{
								iconClass: ThemeIcon.asClassName(killTerminalIcon),
								tooltip: localize('killTerminal', "Kill Terminal Instance")
							}
						],
						trigger: buttonIndex => {
							switch (buttonIndex) {
								case 0:
									this._commandService.executeCommand(TerminalCommandId.Rename, terminal);
									return TriggerAction.NO_ACTION;
								case 1:
									terminal.dispose(true);
									return TriggerAction.REMOVE_ITEM;
							}

							return TriggerAction.NO_ACTION;
						},
						accept: (keyMod, event) => {
							this._terminalService.setActiveInstance(terminal);
							this._terminalService.showPanel(!event.inBackground);
						}
					});
				}
			}
		}

		if (terminalPicks.length > 0) {
			terminalPicks.push({ type: 'separator' });
		}

		const createTerminalLabel = localize("workbench.action.terminal.newplus", "Create New Terminal");
		terminalPicks.push({
			label: `$(plus) ${createTerminalLabel}`,
			ariaLabel: createTerminalLabel,
			accept: () => this._commandService.executeCommand(TerminalCommandId.New)
		});
		const createWithProfileLabel = localize("workbench.action.terminal.newWithProfilePlus", "Create New Terminal With Profile");
		terminalPicks.push({
			label: `$(plus) ${createWithProfileLabel}`,
			ariaLabel: createWithProfileLabel,
			accept: () => this._commandService.executeCommand(TerminalCommandId.NewWithProfile)
		});

		return terminalPicks;

	}
}
