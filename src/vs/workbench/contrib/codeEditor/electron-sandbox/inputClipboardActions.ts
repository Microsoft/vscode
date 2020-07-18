/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { KeybindingsRegistry } from 'vs/platform/keybinding/common/keybindingsRegistry';
import * as platform from 'vs/base/common/platform';
import { KeyCode, KeyMod } from 'vs/base/common/keyCodes';

if (platform.isMacintosh) {

	// On the mac, cmd+x, cmd+c and cmd+v do not result in cut / copy / paste
	// We therefore add a basic keybinding rule that invokes document.execCommand
	// This is to cover <input>s...

	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'execCut',
		primary: KeyMod.CtrlCmd | KeyCode.KEY_X,
		handler: bindExecuteCommand('cut'),
		weight: 0,
		when: undefined,
	});
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'execCopy',
		primary: KeyMod.CtrlCmd | KeyCode.KEY_C,
		handler: bindExecuteCommand('copy'),
		weight: 0,
		when: undefined,
	});
	KeybindingsRegistry.registerCommandAndKeybindingRule({
		id: 'execPaste',
		primary: KeyMod.CtrlCmd | KeyCode.KEY_V,
		handler: bindExecuteCommand('paste'),
		weight: 0,
		when: undefined,
	});

	function bindExecuteCommand(command: 'cut' | 'copy' | 'paste') {
		return () => {
			document.execCommand(command);
		};
	}
}
