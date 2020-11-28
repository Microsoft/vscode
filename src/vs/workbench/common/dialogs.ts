/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IDialog, IDialogResult } from 'vs/platform/dialogs/common/dialogs';

export interface IDialogViewItem {
	args: IDialog;
	close(result?: IDialogResult): void;
}

export interface IDialogHandle {
	item: IDialogViewItem;
	result: Promise<IDialogResult | undefined>;
}

export interface IDialogsModel {
	readonly onDidShowDialog: Event<void>;

	readonly dialogs: IDialogViewItem[];

	show(dialog: IDialog): IDialogHandle;
}

export class DialogsModel extends Disposable implements IDialogsModel {
	readonly dialogs: IDialogViewItem[] = [];

	private readonly _onDidShowDialog = this._register(new Emitter<void>());
	readonly onDidShowDialog = this._onDidShowDialog.event;

	show(dialog: IDialog): IDialogHandle {
		let resolver: (value?: IDialogResult) => void;

		const item: IDialogViewItem = {
			args: dialog,
			close: (result) => { this.dialogs.splice(0, 1); resolver(result); }
		};

		this.dialogs.push(item);
		this._onDidShowDialog.fire();

		return {
			item,
			result: new Promise(resolve => { resolver = resolve; })
		};
	}
}
