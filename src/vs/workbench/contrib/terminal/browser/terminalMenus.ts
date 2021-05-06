/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { MenuRegistry, MenuId } from 'vs/platform/actions/common/actions';
import { ContextKeyAndExpr, ContextKeyEqualsExpr, ContextKeyExpr } from 'vs/platform/contextkey/common/contextkey';
import { KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED, TerminalCommandId, TerminalSettingId, TERMINAL_VIEW_ID } from 'vs/workbench/contrib/terminal/common/terminal';

const enum ContextMenuGroup {
	Create = '1_create',
	Edit = '2_edit',
	Clear = '3_clear',
	Kill = '4_kill',
	Config = '5_config'
}

export const enum TerminalTabContextMenuGroup {
	Default = '1_create_default',
	Profile = '2_create_profile',
	Configure = '3_configure'
}

export const enum TerminalMenuBarGroup {
	Create = '1_create',
	Run = '2_run',
	Manage = '3_manage',
	Configure = '4_configure'
}

export function setupTerminalMenus(): void {
	MenuRegistry.appendMenuItems(
		[
			{
				id: MenuId.MenubarTerminalMenu, item: {
					group: TerminalMenuBarGroup.Create,
					command: {
						id: TerminalCommandId.New,
						title: localize({ key: 'miNewTerminal', comment: ['&& denotes a mnemonic'] }, "&&New Terminal")
					},
					order: 1
				}
			},
			{
				id: MenuId.MenubarTerminalMenu, item: {
					group: TerminalMenuBarGroup.Create,
					command: {
						id: TerminalCommandId.Split,
						title: localize({ key: 'miSplitTerminal', comment: ['&& denotes a mnemonic'] }, "&&Split Terminal"),
						precondition: ContextKeyExpr.has('terminalIsOpen')
					},
					order: 2,
					when: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
				}
			},
			{
				id: MenuId.MenubarTerminalMenu, item: {
					group: TerminalMenuBarGroup.Run,
					command: {
						id: TerminalCommandId.RunActiveFile,
						title: localize({ key: 'miRunActiveFile', comment: ['&& denotes a mnemonic'] }, "Run &&Active File")
					},
					order: 3,
					when: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
				}
			},
			{
				id: MenuId.MenubarTerminalMenu, item: {
					group: TerminalMenuBarGroup.Run,
					command: {
						id: TerminalCommandId.RunSelectedText,
						title: localize({ key: 'miRunSelectedText', comment: ['&& denotes a mnemonic'] }, "Run &&Selected Text")
					},
					order: 4,
					when: KEYBINDING_CONTEXT_TERMINAL_PROCESS_SUPPORTED
				}
			}
		]
	);

	MenuRegistry.appendMenuItems(
		[
			{
				id: MenuId.TerminalInstanceContext, item: {
					group: ContextMenuGroup.Create,
					command: {
						id: TerminalCommandId.Split,
						title: localize('workbench.action.terminal.split', "Split Terminal")
					}
				}
			},
			{
				id: MenuId.TerminalInstanceContext, item: {
					command: {
						id: TerminalCommandId.New,
						title: localize('workbench.action.terminal.new.short', "New Terminal")
					},
					group: ContextMenuGroup.Create
				}
			},
			{
				id: MenuId.TerminalInstanceContext, item: {
					command: {
						id: TerminalCommandId.Kill,
						title: localize('workbench.action.terminal.kill.short', "Kill Terminal")
					},
					group: ContextMenuGroup.Kill
				}
			},
			{
				id: MenuId.TerminalInstanceContext, item: {
					command: {
						id: TerminalCommandId.CopySelection,
						title: localize('workbench.action.terminal.copySelection.short', "Copy")
					},
					group: ContextMenuGroup.Edit,
					order: 1
				}
			},
			{
				id: MenuId.TerminalInstanceContext, item: {
					command: {
						id: TerminalCommandId.Paste,
						title: localize('workbench.action.terminal.paste.short', "Paste")
					},
					group: ContextMenuGroup.Edit,
					order: 2
				}
			},
			{
				id: MenuId.TerminalInstanceContext, item: {
					command: {
						id: TerminalCommandId.Clear,
						title: localize('workbench.action.terminal.clear', "Clear")
					},
					group: ContextMenuGroup.Clear,
				}
			},
			{
				id: MenuId.TerminalInstanceContext, item: {
					command: {
						id: TerminalCommandId.ShowTabs,
						title: localize('workbench.action.terminal.showsTabs', "Show Tabs")
					},
					when: ContextKeyExpr.not(`config.${TerminalSettingId.TabsEnabled}`),
					group: ContextMenuGroup.Config
				}
			},
			{
				id: MenuId.TerminalInstanceContext, item: {
					command: {
						id: TerminalCommandId.SelectAll,
						title: localize('workbench.action.terminal.selectAll', "Select All"),
					},
					group: ContextMenuGroup.Edit,
					order: 3
				}
			},
		]
	);

	MenuRegistry.appendMenuItems(
		[
			{
				id: MenuId.TerminalTabEmptyAreaContext, item: {
					command: {
						id: TerminalCommandId.NewWithProfile,
						title: localize('workbench.action.terminal.newWithProfile.short', "New Terminal With Profile")
					},
					group: ContextMenuGroup.Create
				}
			},
			{
				id: MenuId.TerminalTabEmptyAreaContext, item: {
					command: {
						id: TerminalCommandId.New,
						title: localize('workbench.action.terminal.new.short', "New Terminal")
					},
					group: ContextMenuGroup.Create
				}
			}
		]
	);

	MenuRegistry.appendMenuItems(
		[
			{
				id: MenuId.TerminalNewDropdownContext, item: {
					command: {
						id: TerminalCommandId.SelectDefaultProfile,
						title: { value: localize('workbench.action.terminal.selectDefaultProfile', "Select Default Profile"), original: 'Select Default Profile' }
					},
					group: TerminalTabContextMenuGroup.Configure
				}
			},
			{
				id: MenuId.TerminalNewDropdownContext, item: {
					command: {
						id: TerminalCommandId.ConfigureTerminalSettings,
						title: localize('workbench.action.terminal.openSettings', "Configure Terminal Settings")
					},
					group: TerminalTabContextMenuGroup.Configure
				}
			}
		]
	);

	MenuRegistry.appendMenuItems(
		[
			{
				id: MenuId.ViewTitle, item: {
					group: 'navigation',
					command: {
						id: TerminalCommandId.Split,
						title: localize('workbench.action.terminal.split', "Split Terminal")
					},
					order: 2,
					when: ContextKeyAndExpr.create([
						ContextKeyEqualsExpr.create('view', TERMINAL_VIEW_ID),
						ContextKeyExpr.not(`config.${TerminalSettingId.TabsEnabled}`)
					])
				}
			},
			{
				id: MenuId.ViewTitle, item: {
					command: {
						id: TerminalCommandId.SwitchTerminal,
						title: { value: localize('workbench.action.terminal.switchTerminal', "Switch Terminal"), original: 'Switch Terminal' }
					},
					group: 'navigation',
					order: 0,
					when: ContextKeyAndExpr.create([
						ContextKeyEqualsExpr.create('view', TERMINAL_VIEW_ID),
						ContextKeyExpr.not(`config.${TerminalSettingId.TabsEnabled}`)
					]),
				}
			}
		]
	);

	MenuRegistry.appendMenuItems(
		[
			{
				id: MenuId.TerminalInlineTabContext, item: {
					command: {
						id: TerminalCommandId.ChangeIcon,
						title: localize('workbench.action.terminal.changeIcon', "Change Icon...")
					},
					group: ContextMenuGroup.Edit,
					order: 3
				}
			},
			{
				id: MenuId.TerminalInlineTabContext, item: {
					command: {
						id: TerminalCommandId.Rename,
						title: localize('workbench.action.terminal.rename', "Rename...")
					}
				}
			},
			{
				id: MenuId.TerminalInlineTabContext, item: {
					command: {
						id: TerminalCommandId.RenameInstance,
						title: localize('workbench.action.terminal.renameInstance', "Rename...")
					},
					group: ContextMenuGroup.Edit
				}
			},
			{
				id: MenuId.TerminalInlineTabContext, item: {
					group: ContextMenuGroup.Create,
					command: {
						id: TerminalCommandId.Split,
						title: localize('workbench.action.terminal.split', "Split Terminal")
					}
				}
			},
			{
				id: MenuId.TerminalInlineTabContext, item: {
					command: {
						id: TerminalCommandId.Kill,
						title: localize('workbench.action.terminal.kill.short', "Kill Terminal")
					},
					group: ContextMenuGroup.Kill
				}
			}
		]
	);

	MenuRegistry.appendMenuItems(
		[
			{
				id: MenuId.TerminalTabContext, item: {
					command: {
						id: TerminalCommandId.RenameInstance,
						title: localize('workbench.action.terminal.renameInstance', "Rename...")
					},
					group: ContextMenuGroup.Edit
				}
			},
			{
				id: MenuId.TerminalTabContext, item: {
					command: {
						id: TerminalCommandId.ChangeIconInstance,
						title: localize('workbench.action.terminal.changeIcon', "Change Icon...")
					},
					group: ContextMenuGroup.Edit
				}
			},
			{
				id: MenuId.TerminalTabContext, item: {
					command: {
						id: TerminalCommandId.SplitInstance,
						title: localize('workbench.action.terminal.splitInstance', "Split Terminal"),
					},
					group: ContextMenuGroup.Create
				}
			},
			{
				id: MenuId.TerminalTabContext, item: {
					command: {
						id: TerminalCommandId.KillInstance,
						title: localize('workbench.action.terminal.killInstance', "Kill Terminal")
					},
					group: ContextMenuGroup.Kill,
				}
			}
		]
	);
}
