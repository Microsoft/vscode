/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IMainContext, MainContext, MainThreadClipboardShape } from 'vs/workbench/api/common/extHost.protocol';
import type * as vscode from 'vscode';

export class ExtHostClipboard implements vscode.Clipboard {

	private readonly _proxy: MainThreadClipboardShape;

	constructor(mainContext: IMainContext) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadClipboard);
	}

	readText(): Promise<string> {
		return this._proxy.$readText();
	}

	writeText(value: string): Promise<void> {
		return this._proxy.$writeText(value);
	}
}
