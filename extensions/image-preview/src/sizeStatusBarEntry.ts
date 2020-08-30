/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as nls from 'vscode-nls';
import { PreviewStatusBarEntry } from './ownedStatusBarEntry';

const localize = nls.loadMessageBundle();

export class SizeStatusBarEntry extends PreviewStatusBarEntry {

	constructor() {
		super({
			id: 'imagePreview.size',
			name: localize('sizeStatusBar.name', "Image Size"),
			alignment: vscode.StatusBarAlignment.Right,
			priority: 101 /* to the left of editor status (100) */,
		});
	}

	public show(owner: string, text: string) {
		this.showItem(owner, text);
	}
}
