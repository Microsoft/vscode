/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { MainContext, MainThreadClipboardShape } from '../common/extHost.protocol';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';

@extHostNamedCustomer(MainContext.MainThreadClipboard)
export class MainThreadClipboard implements MainThreadClipboardShape {

	constructor(
		_context: any,
		@IClipboardService private readonly _clipboardService: IClipboardService,
	) { }

	dispose(): void {
		// nothing
	}

	$readText(): Promise<string> {
		return this._clipboardService.readText();
	}

	$writeText(value: string): Promise<void> {
		return this._clipboardService.writeText(value);
	}
}
