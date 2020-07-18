/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';
import * as platform from 'vs/base/common/platform';
import 'vs/css!./media/scrollbar';
import 'vs/css!./media/terminal';
import 'vs/css!./media/widgets';
import 'vs/css!./media/xterm';
import * as nls from 'vs/nls';
import { SyncActionDescriptor } from 'vs/platform/actions/common/actions';
import { CommandsRegistry } from 'vs/platform/commands/common/commands';
import { ContextKeyExpr, ContextKeyExpression } from 'vs/platform/contextkey/common/contextkey';
import { KeybindingWeight, KeybindingsRegistry, IKeybindings } from 'vs/platform/keybinding/common/keybindingsRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import * as panel from 'vs/workbench/browser/panel';
import { getQuickNavigateHandler } from 'vs/workbench/browser/quickaccess';
import { Extensions as ActionExtensions, IWorkbenchActionRegistry } from 'vs/workbench/common/actions';
import { Extensions as ViewContainerExtensions, IViewContainersRegistry, ViewContainerLocation, IViewsRegistry } from 'vs/workbench/common/views';
import { registerTerminalActions, ClearTerminalAction, CopyTerminalSelectionAction, CreateNewTerminalAction, KillTerminalAction, SelectAllTerminalAction, SelectDefaultShellWindowsTerminalAction, SplitInActiveWorkspaceTerminalAction, SplitTerminalAction, TerminalPasteAction, ToggleTerminalAction, terminalSendSequenceCommand } from 'vs/workbench/contrib/terminal/browser/terminalActions';
import { TerminalViewPane } from 'vs/workbench/contrib/terminal/browser/terminalView';
import { KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE_KEY, KEYBINDING_CONTEXT_TERMINAL_FOCUS, KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED, TERMINAL_VIEW_ID, TERMINAL_ACTION_CATEGORY, TERMINAL_COMMAND_ID } from 'vs/workbench/contrib/terminal/common/terminal';
import { registerColors } from 'vs/workbench/contrib/terminal/common/terminalColorRegistry';
import { setupTerminalCommands } from 'vs/workbench/contrib/terminal/browser/terminalCommands';
import { setupTerminalMenu } from 'vs/workbench/contrib/terminal/common/terminalMenu';
import { IConfigurationRegistry, Extensions } from 'vs/platform/configuration/common/configurationRegistry';
import { TerminalService } from 'vs/workbench/contrib/terminal/browser/terminalService';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ITerminalService, WindowsShellType } from 'vs/workbench/contrib/terminal/browser/terminal';
import { BrowserFeatures } from 'vs/base/browser/canIUse';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ViewPaneContainer } from 'vs/workbench/browser/parts/views/viewPaneContainer';
import { IQuickAccessRegistry, Extensions as QuickAccessExtensions } from 'vs/platform/quickinput/common/quickAccess';
import { TerminalQuickAccessProvider } from 'vs/workbench/contrib/terminal/browser/terminalQuickAccess';
import { terminalConfiguration } from 'vs/workbench/contrib/terminal/common/terminalConfiguration';
import { CONTEXT_ACCESSIBILITY_MODE_ENABLED } from 'vs/platform/accessibility/common/accessibility';

// Register services
registerSingleton(ITerminalService, TerminalService, true);

// Register quick accesses
const quickAccessRegistry = (Registry.as<IQuickAccessRegistry>(QuickAccessExtensions.Quickaccess));
const inTerminalsPicker = 'inTerminalPicker';
quickAccessRegistry.registerQuickAccessProvider({
	ctor: TerminalQuickAccessProvider,
	prefix: TerminalQuickAccessProvider.PREFIX,
	contextKey: inTerminalsPicker,
	placeholder: nls.localize('tasksQuickAccessPlaceholder', "Type the name of a terminal to open."),
	helpEntries: [{ description: nls.localize('tasksQuickAccessHelp', "Show All Opened Terminals"), needsEditor: false }]
});
const quickAccessNavigateNextInTerminalPickerId = 'workbench.action.quickOpenNavigateNextInTerminalPicker';
CommandsRegistry.registerCommand({ id: quickAccessNavigateNextInTerminalPickerId, handler: getQuickNavigateHandler(quickAccessNavigateNextInTerminalPickerId, true) });
const quickAccessNavigatePreviousInTerminalPickerId = 'workbench.action.quickOpenNavigatePreviousInTerminalPicker';
CommandsRegistry.registerCommand({ id: quickAccessNavigatePreviousInTerminalPickerId, handler: getQuickNavigateHandler(quickAccessNavigatePreviousInTerminalPickerId, false) });

// Register configurations
const configurationRegistry = Registry.as<IConfigurationRegistry>(Extensions.Configuration);
configurationRegistry.registerConfiguration(terminalConfiguration);

// Register views
const VIEW_CONTAINER = Registry.as<IViewContainersRegistry>(ViewContainerExtensions.ViewContainersRegistry).registerViewContainer({
	id: TERMINAL_VIEW_ID,
	name: nls.localize('terminal', "Terminal"),
	icon: 'codicon-terminal',
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [TERMINAL_VIEW_ID, { mergeViewWithContainerWhenSingleView: true, donotShowContainerTitleWhenMergedWithContainer: true }]),
	storageId: TERMINAL_VIEW_ID,
	focusCommand: { id: TERMINAL_COMMAND_ID.FOCUS },
	hideIfEmpty: true,
	order: 3
}, ViewContainerLocation.Panel);
Registry.as<panel.PanelRegistry>(panel.Extensions.Panels).setDefaultPanelId(TERMINAL_VIEW_ID);
Registry.as<IViewsRegistry>(ViewContainerExtensions.ViewsRegistry).registerViews([{
	id: TERMINAL_VIEW_ID,
	name: nls.localize('terminal', "Terminal"),
	containerIcon: 'codicon-terminal',
	canToggleVisibility: false,
	canMoveView: true,
	ctorDescriptor: new SyncDescriptor(TerminalViewPane)
}], VIEW_CONTAINER);

// Register actions
const actionRegistry = Registry.as<IWorkbenchActionRegistry>(ActionExtensions.WorkbenchActions);
registerTerminalActions();
const category = TERMINAL_ACTION_CATEGORY;
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(KillTerminalAction), 'Terminal: Kill the Active Terminal Instance', category);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(CreateNewTerminalAction, {
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.US_BACKTICK,
	mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.US_BACKTICK }
}), 'Terminal: Create New Integrated Terminal', category);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(SelectAllTerminalAction, {
	// Don't use ctrl+a by default as that would override the common go to start
	// of prompt shell binding
	primary: 0,
	// Technically this doesn't need to be here as it will fall back to this
	// behavior anyway when handed to xterm.js, having this handled by VS Code
	// makes it easier for users to see how it works though.
	mac: { primary: KeyMod.CtrlCmd | KeyCode.KEY_A }
}, KEYBINDING_CONTEXT_TERMINAL_FOCUS), 'Terminal: Select All', category);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(ToggleTerminalAction, {
	primary: KeyMod.CtrlCmd | KeyCode.US_BACKTICK,
	mac: { primary: KeyMod.WinCtrl | KeyCode.US_BACKTICK }
}), 'View: Toggle Integrated Terminal', nls.localize('viewCategory', "View"));
// Weight is higher than work workbench contributions so the keybinding remains
// highest priority when chords are registered afterwards
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(ClearTerminalAction, {
	primary: 0,
	mac: { primary: KeyMod.CtrlCmd | KeyCode.KEY_K }
}, KEYBINDING_CONTEXT_TERMINAL_FOCUS, KeybindingWeight.WorkbenchContrib + 1), 'Terminal: Clear', category);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(SelectDefaultShellWindowsTerminalAction), 'Terminal: Select Default Shell', category);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(SplitTerminalAction, {
	primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_5,
	mac: {
		primary: KeyMod.CtrlCmd | KeyCode.US_BACKSLASH,
		secondary: [KeyMod.WinCtrl | KeyMod.Shift | KeyCode.KEY_5]
	}
}, KEYBINDING_CONTEXT_TERMINAL_FOCUS), 'Terminal: Split Terminal', category);
actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(SplitInActiveWorkspaceTerminalAction), 'Terminal: Split Terminal (In Active Workspace)', category);

// Commands might be affected by Web restrictons
if (BrowserFeatures.clipboard.writeText) {
	actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(CopyTerminalSelectionAction, {
		primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
		win: { primary: KeyMod.CtrlCmd | KeyCode.KEY_C, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_C] },
		linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_C }
	}, ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_TEXT_SELECTED, KEYBINDING_CONTEXT_TERMINAL_FOCUS)), 'Terminal: Copy Selection', category);
}

function registerSendSequenceKeybinding(text: string, rule: { when?: ContextKeyExpression } & IKeybindings): void {
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: TERMINAL_COMMAND_ID.SEND_SEQUENCE,
		weight: KeybindingWeight.WorkbenchContrib,
		when: rule.when || KEYBINDING_CONTEXT_TERMINAL_FOCUS,
		primary: rule.primary,
		mac: rule.mac,
		linux: rule.linux,
		win: rule.win,
		handler: terminalSendSequenceCommand,
		args: { text }
	});
}

// The text representation of `^<letter>` is `'A'.charCodeAt(0) + 1`.
const CTRL_LETTER_OFFSET = 64;

if (BrowserFeatures.clipboard.readText) {
	actionRegistry.registerWorkbenchAction(SyncActionDescriptor.from(TerminalPasteAction, {
		primary: KeyMod.CtrlCmd | KeyCode.KEY_V,
		win: { primary: KeyMod.CtrlCmd | KeyCode.KEY_V, secondary: [KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_V] },
		linux: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KEY_V }
	}, KEYBINDING_CONTEXT_TERMINAL_FOCUS), 'Terminal: Paste into Active Terminal', category);
	// An extra Windows-only ctrl+v keybinding is used for pwsh that sends ctrl+v directly to the
	// shell, this gets handled by PSReadLine which properly handles multi-line pastes. This is
	// disabled in accessibility mode as PowerShell does not run PSReadLine when it detects a screen
	// reader.
	if (platform.isWindows) {
		registerSendSequenceKeybinding(String.fromCharCode('V'.charCodeAt(0) - CTRL_LETTER_OFFSET), { // ctrl+v
			when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, ContextKeyExpr.equals(KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE_KEY, WindowsShellType.PowerShell), CONTEXT_ACCESSIBILITY_MODE_ENABLED.negate()),
			primary: KeyMod.CtrlCmd | KeyCode.KEY_V
		});
	}
}

// Delete word left: ctrl+w
registerSendSequenceKeybinding(String.fromCharCode('W'.charCodeAt(0) - CTRL_LETTER_OFFSET), {
	primary: KeyMod.CtrlCmd | KeyCode.Backspace,
	mac: { primary: KeyMod.Alt | KeyCode.Backspace }
});
if (platform.isWindows) {
	// Delete word left: ctrl+h
	// Windows cmd.exe requires ^H to delete full word left
	registerSendSequenceKeybinding(String.fromCharCode('H'.charCodeAt(0) - CTRL_LETTER_OFFSET), {
		when: ContextKeyExpr.and(KEYBINDING_CONTEXT_TERMINAL_FOCUS, ContextKeyExpr.equals(KEYBINDING_CONTEXT_TERMINAL_SHELL_TYPE_KEY, WindowsShellType.CommandPrompt)),
		primary: KeyMod.CtrlCmd | KeyCode.Backspace,
	});
}
// Delete word right: alt+d
registerSendSequenceKeybinding('\x1bd', {
	primary: KeyMod.CtrlCmd | KeyCode.Delete,
	mac: { primary: KeyMod.Alt | KeyCode.Delete }
});
// Delete to line start: ctrl+u
registerSendSequenceKeybinding('\u0015', {
	mac: { primary: KeyMod.CtrlCmd | KeyCode.Backspace }
});
// Move to line start: ctrl+A
registerSendSequenceKeybinding(String.fromCharCode('A'.charCodeAt(0) - 64), {
	mac: { primary: KeyMod.CtrlCmd | KeyCode.LeftArrow }
});
// Move to line end: ctrl+E
registerSendSequenceKeybinding(String.fromCharCode('E'.charCodeAt(0) - 64), {
	mac: { primary: KeyMod.CtrlCmd | KeyCode.RightArrow }
});

setupTerminalCommands();
setupTerminalMenu();

registerColors();
