/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import Severity from 'vs/base/common/severity';
import { Disposable } from 'vs/base/common/lifecycle';
import { IConfirmation, IConfirmationResult, IDialogOptions, IDialogService, IInput, IInputResult, IShowResult } from 'vs/platform/dialogs/common/dialogs';
import { DialogsModel, IDialogsModel } from 'vs/workbench/common/dialogs';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';

export class DialogService extends Disposable implements IDialogService {
	_serviceBrand: undefined;

	readonly model: IDialogsModel = this._register(new DialogsModel());

	async confirm(confirmation: IConfirmation): Promise<IConfirmationResult> {
		const handle = this.model.show({ confirmArgs: { confirmation } });
		return await handle.result as IConfirmationResult;
	}

	async show(severity: Severity, message: string, buttons: string[], options?: IDialogOptions): Promise<IShowResult> {
		const handle = this.model.show({ showArgs: { severity, message, buttons, options } });
		return await handle.result as IShowResult;
	}

	async input(severity: Severity, message: string, buttons: string[], inputs: IInput[], options?: IDialogOptions): Promise<IInputResult> {
		const handle = this.model.show({ inputArgs: { severity, message, buttons, inputs, options } });
		return await handle.result as IInputResult;
	}

	async about(): Promise<void> {
		const handle = this.model.show({});
		await handle.result;
	}
}

registerSingleton(IDialogService, DialogService, true);
