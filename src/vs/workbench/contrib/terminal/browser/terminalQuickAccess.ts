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
import { TERMINAL_COMMAND_ID } from 'vs/workbench/contrib/terminal/common/terminal';

export class TerminalQuickAccessProvider extends PickerQuickAccessProvider<IPickerQuickAccessItem> {

	static PREFIX = 'term ';

	constructor(
		@ITerminalService private readonly terminalService: ITerminalService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super(TerminalQuickAccessProvider.PREFIX, { canAcceptInBackground: true });
	}

	protected getPicks(filter: string): Array<IPickerQuickAccessItem | IQuickPickSeparator> {
		const terminalPicks: Array<IPickerQuickAccessItem | IQuickPickSeparator> = [];

		const terminalTabs = this.terminalService.terminalTabs;
		for (let tabIndex = 0; tabIndex < terminalTabs.length; tabIndex++) {
			const terminalTab = terminalTabs[tabIndex];
			for (let terminalIndex = 0; terminalIndex < terminalTab.terminalInstances.length; terminalIndex++) {
				const terminal = terminalTab.terminalInstances[terminalIndex];
				const label = `${tabIndex + 1}.${terminalIndex + 1}: ${terminal.title}`;

				const highlights = matchesFuzzy(filter, label, true);
				if (highlights) {
					terminalPicks.push({
						label,
						highlights: { label: highlights },
						buttons: [
							{
								iconClass: 'codicon-gear',
								tooltip: localize('renameTerminal', "Rename Terminal")
							},
							{
								iconClass: 'codicon-trash',
								tooltip: localize('killTerminal', "Kill Terminal Instance")
							}
						],
						trigger: buttonIndex => {
							switch (buttonIndex) {
								case 0:
									this.commandService.executeCommand(TERMINAL_COMMAND_ID.RENAME, terminal);
									return TriggerAction.NO_ACTION;
								case 1:
									terminal.dispose(true);
									return TriggerAction.REMOVE_ITEM;
							}

							return TriggerAction.NO_ACTION;
						},
						accept: (keyMod, event) => {
							this.terminalService.setActiveInstance(terminal);
							this.terminalService.showPanel(!event.inBackground);
						}
					});
				}
			}
		}

		if (terminalPicks.length > 0) {
			terminalPicks.push({ type: 'separator' });
		}

		const createTerminalLabel = localize("workbench.action.terminal.newplus", "Create New Integrated Terminal");
		terminalPicks.push({
			label: `$(plus) ${createTerminalLabel}`,
			ariaLabel: createTerminalLabel,
			accept: () => this.commandService.executeCommand('workbench.action.terminal.new')
		});

		return terminalPicks;

	}
}
