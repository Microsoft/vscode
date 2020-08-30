/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { Disposable } from './dispose';

export abstract class PreviewStatusBarEntry extends Disposable {
	private _showOwner: string | undefined;

	protected readonly entry: vscode.StatusBarItem;

	constructor(options: vscode.window.StatusBarItemOptions) {
		super();
		this.entry = this._register(vscode.window.createStatusBarItem(options));
	}

	protected showItem(owner: string, text: string) {
		this._showOwner = owner;
		this.entry.text = text;
		this.entry.show();
	}

	public hide(owner: string) {
		if (owner === this._showOwner) {
			this.entry.hide();
			this._showOwner = undefined;
		}
	}
}
