/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { Event } from 'vs/base/common/event';

export class DialogChannel implements IServerChannel {

	constructor(@IDialogService private readonly dialogService: IDialogService) { }

	listen<T>(_: unknown, event: string): Event<T> {
		throw new Error(`Event not found: ${event}`);
	}

	call(_: unknown, command: string, args?: any[]): Promise<any> {
		switch (command) {
			case 'show': return this.dialogService.show(args![0], args![1], args![2]);
			case 'confirm': return this.dialogService.confirm(args![0]);
			case 'about': return this.dialogService.about();
		}
		return Promise.reject(new Error('invalid command'));
	}
}
