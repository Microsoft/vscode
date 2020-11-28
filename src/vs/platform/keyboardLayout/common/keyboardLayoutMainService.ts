/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IKeyboardLayoutInfo, IKeyboardMapping } from 'vs/platform/keyboardLayout/common/keyboardLayout';
import { Event } from 'vs/base/common/event';

export interface IKeyboardLayoutData {
	keyboardLayoutInfo: IKeyboardLayoutInfo;
	keyboardMapping: IKeyboardMapping;
}

export interface IKeyboardLayoutMainService {
	readonly _serviceBrand: undefined;
	readonly onDidChangeKeyboardLayout: Event<IKeyboardLayoutData>;
	getKeyboardLayoutData(): Promise<IKeyboardLayoutData>;
}
