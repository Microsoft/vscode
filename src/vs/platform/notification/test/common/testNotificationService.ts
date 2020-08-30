/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotificationService, INotificationHandle, NoOpNotification, Severity, INotification, IPromptChoice, IPromptOptions, IStatusMessageOptions, NotificationsFilter } from 'vs/platform/notification/common/notification';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';

export class TestNotificationService implements INotificationService {

	declare readonly _serviceBrand: undefined;

	private static readonly NO_OP: INotificationHandle = new NoOpNotification();

	info(message: string): INotificationHandle {
		return this.notify({ severity: Severity.Info, message });
	}

	warn(message: string): INotificationHandle {
		return this.notify({ severity: Severity.Warning, message });
	}

	error(error: string | Error): INotificationHandle {
		return this.notify({ severity: Severity.Error, message: error });
	}

	notify(notification: INotification): INotificationHandle {
		return TestNotificationService.NO_OP;
	}

	prompt(severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {
		return TestNotificationService.NO_OP;
	}

	status(message: string | Error, options?: IStatusMessageOptions): IDisposable {
		return Disposable.None;
	}

	setFilter(filter: NotificationsFilter): void { }
}
