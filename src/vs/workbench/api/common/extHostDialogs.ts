/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type * as vscode from 'vscode';
import { URI } from 'vs/base/common/uri';
import { MainContext, MainThreadDiaglogsShape, IMainContext } from 'vs/workbench/api/common/extHost.protocol';

export class ExtHostDialogs {

	private readonly _proxy: MainThreadDiaglogsShape;

	constructor(mainContext: IMainContext) {
		this._proxy = mainContext.getProxy(MainContext.MainThreadDialogs);
	}

	showOpenDialog(options?: vscode.OpenDialogOptions): Promise<URI[] | undefined> {
		return this._proxy.$showOpenDialog(options).then(filepaths => {
			return filepaths ? filepaths.map(p => URI.revive(p)) : undefined;
		});
	}

	showSaveDialog(options?: vscode.SaveDialogOptions): Promise<URI | undefined> {
		return this._proxy.$showSaveDialog(options).then(filepath => {
			return filepath ? URI.revive(filepath) : undefined;
		});
	}
}
