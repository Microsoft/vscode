/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import Severity from 'vs/base/common/severity';
import { Action, IAction } from 'vs/base/common/actions';
import { MainThreadMessageServiceShape, MainContext, IExtHostContext, MainThreadMessageOptions } from '../common/extHost.protocol';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { Event } from 'vs/base/common/event';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { dispose } from 'vs/base/common/lifecycle';
import { ExtensionIdentifier, IExtensionDescription } from 'vs/platform/extensions/common/extensions';

@extHostNamedCustomer(MainContext.MainThreadMessageService)
export class MainThreadMessageService implements MainThreadMessageServiceShape {

	constructor(
		extHostContext: IExtHostContext,
		@INotificationService private readonly _notificationService: INotificationService,
		@ICommandService private readonly _commandService: ICommandService,
		@IDialogService private readonly _dialogService: IDialogService
	) {
		//
	}

	dispose(): void {
		//
	}

	$showMessage(severity: Severity, message: string, options: MainThreadMessageOptions, commands: { title: string; isCloseAffordance: boolean; handle: number; }[]): Promise<number | undefined> {
		if (options.modal) {
			return this._showModalMessage(severity, message, commands, options.useCustom);
		} else {
			return this._showMessage(severity, message, commands, options.extension);
		}
	}

	private _showMessage(severity: Severity, message: string, commands: { title: string; isCloseAffordance: boolean; handle: number; }[], extension: IExtensionDescription | undefined): Promise<number | undefined> {

		return new Promise<number | undefined>(resolve => {

			const primaryActions: MessageItemAction[] = [];

			class MessageItemAction extends Action {
				constructor(id: string, label: string, handle: number) {
					super(id, label, undefined, true, () => {
						resolve(handle);
						return Promise.resolve();
					});
				}
			}

			class ManageExtensionAction extends Action {
				constructor(id: ExtensionIdentifier, label: string, commandService: ICommandService) {
					super(id.value, label, undefined, true, () => {
						return commandService.executeCommand('_extensions.manage', id.value);
					});
				}
			}

			commands.forEach(command => {
				primaryActions.push(new MessageItemAction('_extension_message_handle_' + command.handle, command.title, command.handle));
			});

			let source: string | { label: string, id: string } | undefined;
			if (extension) {
				source = {
					label: nls.localize('extensionSource', "{0} (Extension)", extension.displayName || extension.name),
					id: extension.identifier.value
				};
			}

			if (!source) {
				source = nls.localize('defaultSource', "Extension");
			}

			const secondaryActions: IAction[] = [];
			if (extension && !extension.isUnderDevelopment) {
				secondaryActions.push(new ManageExtensionAction(extension.identifier, nls.localize('manageExtension', "Manage Extension"), this._commandService));
			}

			const messageHandle = this._notificationService.notify({
				severity,
				message,
				actions: { primary: primaryActions, secondary: secondaryActions },
				source
			});

			// if promise has not been resolved yet, now is the time to ensure a return value
			// otherwise if already resolved it means the user clicked one of the buttons
			Event.once(messageHandle.onDidClose)(() => {
				dispose(primaryActions);
				dispose(secondaryActions);
				resolve(undefined);
			});
		});
	}

	private async _showModalMessage(severity: Severity, message: string, commands: { title: string; isCloseAffordance: boolean; handle: number; }[], useCustom?: boolean): Promise<number | undefined> {
		let cancelId: number | undefined = undefined;

		const buttons = commands.map((command, index) => {
			if (command.isCloseAffordance === true) {
				cancelId = index;
			}

			return command.title;
		});

		if (cancelId === undefined) {
			if (buttons.length > 0) {
				buttons.push(nls.localize('cancel', "Cancel"));
			} else {
				buttons.push(nls.localize('ok', "OK"));
			}

			cancelId = buttons.length - 1;
		}

		const { choice } = await this._dialogService.show(severity, message, buttons, { cancelId, custom: useCustom });
		return choice === commands.length ? undefined : commands[choice].handle;
	}
}
