/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKeymapInfo } from 'vs/workbench/services/keybinding/common/keymapInfo';

export class KeyboardLayoutContribution {
	public static readonly INSTANCE: KeyboardLayoutContribution = new KeyboardLayoutContribution();

	private _layoutInfos: IKeymapInfo[] = [];

	get layoutInfos() {
		return this._layoutInfos;
	}

	private constructor() {
	}

	registerKeyboardLayout(layout: IKeymapInfo) {
		this._layoutInfos.push(layout);
	}
}
