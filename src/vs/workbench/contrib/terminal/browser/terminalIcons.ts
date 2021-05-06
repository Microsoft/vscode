/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from 'vs/base/common/codicons';
import { localize } from 'vs/nls';
import { registerIcon } from 'vs/platform/theme/common/iconRegistry';

export const terminalViewIcon = registerIcon('terminal-view-icon', Codicon.terminal, localize('terminalViewIcon', 'View icon of the terminal view.'));

export const renameTerminalIcon = registerIcon('terminal-rename', Codicon.gear, localize('renameTerminalIcon', 'Icon for rename in the terminal quick menu.'));
export const killTerminalIcon = registerIcon('terminal-kill', Codicon.trash, localize('killTerminalIcon', 'Icon for killing a terminal instance.'));
export const newTerminalIcon = registerIcon('terminal-new', Codicon.add, localize('newTerminalIcon', 'Icon for creating a new terminal instance.'));

export const configureTerminalProfileIcon = registerIcon('terminal-configure-profile', Codicon.gear, localize('configureTerminalProfileIcon', 'Icon for creating a new terminal profile.'));
