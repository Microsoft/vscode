/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { localize } from 'vs/nls';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

export const settingsGroupExpandedIcon = registerIcon('settings-group-expanded', Codicon.chevronDown, localize('settingsGroupExpandedIcon', 'Icon for an expanded section in the split JSON settings editor.'));
export const settingsGroupCollapsedIcon = registerIcon('settings-group-collapsed', Codicon.chevronRight, localize('settingsGroupCollapsedIcon', 'Icon for an collapsed section in the split JSON settings editor.'));
export const settingsScopeDropDownIcon = registerIcon('settings-folder-dropdown', Codicon.triangleDown, localize('settingsScopeDropDownIcon', 'Icon for the folder dropdown button in the split JSON settings editor.'));
export const settingsMoreActionIcon = registerIcon('settings-more-action', Codicon.gear, localize('settingsMoreActionIcon', 'Icon for the \'more actions\' action in the settings UI.'));

export const keybindingsRecordKeysIcon = registerIcon('keybindings-record-keys', Codicon.recordKeys, localize('keybindingsRecordKeysIcon', 'Icon for the \'record keys\' action in the keybinding UI.'));
export const keybindingsSortIcon = registerIcon('keybindings-sort', Codicon.sortPrecedence, localize('keybindingsSortIcon', 'Icon for the \'sort by precedence\' toggle in the keybinding UI.'));

export const keybindingsEditIcon = registerIcon('keybindings-edit', Codicon.edit, localize('keybindingsEditIcon', 'Icon for the edit action in the keybinding UI.'));
export const keybindingsAddIcon = registerIcon('keybindings-add', Codicon.add, localize('keybindingsAddIcon', 'Icon for the add action in the keybinding UI.'));

export const settingsEditIcon = registerIcon('settings-edit', Codicon.edit, localize('settingsEditIcon', 'Icon for the edit action in the settings UI.'));
export const settingsAddIcon = registerIcon('settings-add', Codicon.add, localize('settingsAddIcon', 'Icon for the add action in the settings UI.'));

export const settingsRemoveIcon = registerIcon('settings-remove', Codicon.close, localize('settingsRemoveIcon', 'Icon for the remove action in the settings UI.'));
export const settingsDiscardIcon = registerIcon('settings-discard', Codicon.discard, localize('preferencesDiscardIcon', 'Icon for the discard action in the settings UI.'));

export const preferencesClearInputIcon = registerIcon('preferences-clear-input', Codicon.clearAll, localize('preferencesClearInput', 'Icon for clear input in the settings and keybinding UI.'));
export const preferencesOpenSettingsIcon = registerIcon('preferences-open-settings', Codicon.goToFile, localize('preferencesOpenSettings', 'Icon for open settings commands.'));
