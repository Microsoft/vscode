/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';

export namespace AccessibilityHelpNLS {
	export const noSelection = nls.localize("noSelection", "No selection");
	export const singleSelectionRange = nls.localize("singleSelectionRange", "Line {0}, Column {1} ({2} selected)");
	export const singleSelection = nls.localize("singleSelection", "Line {0}, Column {1}");
	export const multiSelectionRange = nls.localize("multiSelectionRange", "{0} selections ({1} characters selected)");
	export const multiSelection = nls.localize("multiSelection", "{0} selections");
	export const emergencyConfOn = nls.localize("emergencyConfOn", "Now changing the setting `accessibilitySupport` to 'on'.");
	export const openingDocs = nls.localize("openingDocs", "Now opening the Editor Accessibility documentation page.");
	export const readonlyDiffEditor = nls.localize("readonlyDiffEditor", " in a read-only pane of a diff editor.");
	export const editableDiffEditor = nls.localize("editableDiffEditor", " in a pane of a diff editor.");
	export const readonlyEditor = nls.localize("readonlyEditor", " in a read-only code editor");
	export const editableEditor = nls.localize("editableEditor", " in a code editor");
	export const changeConfigToOnMac = nls.localize("changeConfigToOnMac", "To configure the editor to be optimized for usage with a Screen Reader press Command+E now.");
	export const changeConfigToOnWinLinux = nls.localize("changeConfigToOnWinLinux", "To configure the editor to be optimized for usage with a Screen Reader press Control+E now.");
	export const auto_on = nls.localize("auto_on", "The editor is configured to be optimized for usage with a Screen Reader.");
	export const auto_off = nls.localize("auto_off", "The editor is configured to never be optimized for usage with a Screen Reader, which is not the case at this time.");
	export const tabFocusModeOnMsg = nls.localize("tabFocusModeOnMsg", "Pressing Tab in the current editor will move focus to the next focusable element. Toggle this behavior by pressing {0}.");
	export const tabFocusModeOnMsgNoKb = nls.localize("tabFocusModeOnMsgNoKb", "Pressing Tab in the current editor will move focus to the next focusable element. The command {0} is currently not triggerable by a keybinding.");
	export const tabFocusModeOffMsg = nls.localize("tabFocusModeOffMsg", "Pressing Tab in the current editor will insert the tab character. Toggle this behavior by pressing {0}.");
	export const tabFocusModeOffMsgNoKb = nls.localize("tabFocusModeOffMsgNoKb", "Pressing Tab in the current editor will insert the tab character. The command {0} is currently not triggerable by a keybinding.");
	export const openDocMac = nls.localize("openDocMac", "Press Command+H now to open a browser window with more information related to editor accessibility.");
	export const openDocWinLinux = nls.localize("openDocWinLinux", "Press Control+H now to open a browser window with more information related to editor accessibility.");
	export const outroMsg = nls.localize("outroMsg", "You can dismiss this tooltip and return to the editor by pressing Escape or Shift+Escape.");
	export const showAccessibilityHelpAction = nls.localize("showAccessibilityHelpAction", "Show Accessibility Help");
}

export namespace InspectTokensNLS {
	export const inspectTokensAction = nls.localize('inspectTokens', "Developer: Inspect Tokens");
}

export namespace GoToLineNLS {
	export const gotoLineActionLabel = nls.localize('gotoLineActionLabel', "Go to Line/Column...");
}

export namespace QuickHelpNLS {
	export const helpQuickAccessActionLabel = nls.localize('helpQuickAccess', "Show all Quick Access Providers");
}

export namespace QuickCommandNLS {
	export const quickCommandActionLabel = nls.localize('quickCommandActionLabel', "Command Palette");
	export const quickCommandHelp = nls.localize('quickCommandActionHelp', "Show And Run Commands");
}

export namespace QuickOutlineNLS {
	export const quickOutlineActionLabel = nls.localize('quickOutlineActionLabel', "Go to Symbol...");
	export const quickOutlineByCategoryActionLabel = nls.localize('quickOutlineByCategoryActionLabel', "Go to Symbol by Category...");
}

export namespace StandaloneCodeEditorNLS {
	export const editorViewAccessibleLabel = nls.localize('editorViewAccessibleLabel', "Editor content");
	export const accessibilityHelpMessage = nls.localize('accessibilityHelpMessage', "Press Alt+F1 for Accessibility Options.");
}

export namespace ToggleHighContrastNLS {
	export const toggleHighContrast = nls.localize('toggleHighContrast', "Toggle High Contrast Theme");
}

export namespace SimpleServicesNLS {
	export const bulkEditServiceSummary = nls.localize('bulkEditServiceSummary', "Made {0} edits in {1} files");
}
