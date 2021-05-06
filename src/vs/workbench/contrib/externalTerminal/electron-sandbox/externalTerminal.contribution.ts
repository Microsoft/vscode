/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as paths from 'vs/base/common/path';
import { DEFAULT_TERMINAL_OSX, IExternalTerminalService } from 'vs/platform/externalTerminal/common/externalTerminal';
import { MenuId, MenuRegistry } from 'vs/platform/actions/common/actions';
import { KeyMod, KeyCode } from 'vs/base/common/keyCodes';
import { KEYBINDING_CONTEXT_TERMINAL_NOT_FOCUSED } from 'vs/workbench/contrib/terminal/common/terminal';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { KeybindingsRegistry, KeybindingWeight } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { Schemas } from 'vs/base/common/network';
import { IPathService } from 'vs/workbench/services/path/common/pathService';
import { IConfigurationRegistry, Extensions, ConfigurationScope } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IExternalTerminalMainService } from 'vs/platform/externalTerminal/electron-sandbox/externalTerminalMainService';

const OPEN_NATIVE_CONSOLE_COMMAND_ID = 'workbench.action.terminal.openNativeConsole';
KeybindingsRegistry.registerCommandAndKeybindingRule({
	id: OPEN_NATIVE_CONSOLE_COMMAND_ID,
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_C,
	when: KEYBINDING_CONTEXT_TERMINAL_NOT_FOCUSED,
	weight: KeybindingWeight.WorkbenchContrib,
	handler: async (accessor) => {
		const historyService = accessor.get(IHistoryService);
		// Open external terminal in local workspaces
		const terminalService = accessor.get(IExternalTerminalService);
		const root = historyService.getLastActiveWorkspaceRoot(Schemas.file);
		if (root) {
			terminalService.openTerminal(root.fsPath);
		} else {
			// Opens current file's folder, if no folder is open in editor
			const activeFile = historyService.getLastActiveFile(Schemas.file);
			if (activeFile) {
				terminalService.openTerminal(paths.dirname(activeFile.fsPath));
			} else {
				const pathService = accessor.get(IPathService);
				const userHome = await pathService.userHome();
				terminalService.openTerminal(userHome.fsPath);
			}
		}
	}
});

MenuRegistry.appendMenuItem(MenuId.CommandPalette, {
	command: {
		id: OPEN_NATIVE_CONSOLE_COMMAND_ID,
		title: { value: nls.localize('globalConsoleAction', "Open New External Terminal"), original: 'Open New External Terminal' }
	}
});

export class ExternalTerminalContribution implements IWorkbenchContribution {

	public _serviceBrand: undefined;
	constructor(@IExternalTerminalMainService private readonly _externalTerminalService: IExternalTerminalMainService) {
		this._updateConfiguration();
	}

	private async _updateConfiguration(): Promise<void> {
		const terminals = await this._externalTerminalService.getDefaultTerminalForPlatforms();
		let configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
		configurationRegistry.registerConfiguration({
			id: 'externalTerminal',
			order: 100,
			title: nls.localize('terminalConfigurationTitle', "External Terminal"),
			type: 'object',
			properties: {
				'terminal.explorerKind': {
					type: 'string',
					enum: [
						'integrated',
						'external'
					],
					enumDescriptions: [
						nls.localize('terminal.explorerKind.integrated', "Use VS Code's integrated terminal."),
						nls.localize('terminal.explorerKind.external', "Use the configured external terminal.")
					],
					description: nls.localize('explorer.openInTerminalKind', "Customizes what kind of terminal to launch."),
					default: 'integrated'
				},
				'terminal.external.windowsExec': {
					type: 'string',
					description: nls.localize('terminal.external.windowsExec', "Customizes which terminal to run on Windows."),
					default: terminals.windows,
					scope: ConfigurationScope.APPLICATION
				},
				'terminal.external.osxExec': {
					type: 'string',
					description: nls.localize('terminal.external.osxExec', "Customizes which terminal application to run on macOS."),
					default: DEFAULT_TERMINAL_OSX,
					scope: ConfigurationScope.APPLICATION
				},
				'terminal.external.linuxExec': {
					type: 'string',
					description: nls.localize('terminal.external.linuxExec', "Customizes which terminal to run on Linux."),
					default: terminals.linux,
					scope: ConfigurationScope.APPLICATION
				}
			}
		});
	}
}
