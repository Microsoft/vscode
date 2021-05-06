/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MainThreadMessageService } from 'vs/workbench/api/browser/mainThreadMessageService';
import { IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { INotificationService, INotification, NoOpNotification, INotificationHandle, Severity, IPromptChoice, IPromptOptions, IStatusMessageOptions, NotificationsFilter } from 'vs/platform/notification/common/notification';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { mock } from 'vs/base/test/common/mock';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import * as platform from 'vs/base/common/platform';
import { Event } from 'vs/base/common/event';

const emptyDialogService = new class implements IDialogService {
	declare readonly _serviceBrand: undefined;
	show(): never {
		throw new Error('not implemented');
	}

	confirm(): never {
		throw new Error('not implemented');
	}

	about(): never {
		throw new Error('not implemented');
	}

	input(): never {
		throw new Error('not implemented');
	}
};

const emptyCommandService: ICommandService = {
	_serviceBrand: undefined,
	onWillExecuteCommand: () => Disposable.None,
	onDidExecuteCommand: () => Disposable.None,
	executeCommand: (commandId: string, ...args: any[]): Promise<any> => {
		return Promise.resolve(undefined);
	}
};

const emptyNotificationService = new class implements INotificationService {
	declare readonly _serviceBrand: undefined;
	onDidAddNotification: Event<INotification> = Event.None;
	onDidRemoveNotification: Event<INotification> = Event.None;
	notify(...args: any[]): never {
		throw new Error('not implemented');
	}
	info(...args: any[]): never {
		throw new Error('not implemented');
	}
	warn(...args: any[]): never {
		throw new Error('not implemented');
	}
	error(...args: any[]): never {
		throw new Error('not implemented');
	}
	prompt(severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {
		throw new Error('not implemented');
	}
	status(message: string | Error, options?: IStatusMessageOptions): IDisposable {
		return Disposable.None;
	}
	setFilter(filter: NotificationsFilter): void {
		throw new Error('not implemented.');
	}
};

class EmptyNotificationService implements INotificationService {
	declare readonly _serviceBrand: undefined;

	constructor(private withNotify: (notification: INotification) => void) {
	}

	onDidAddNotification: Event<INotification> = Event.None;
	onDidRemoveNotification: Event<INotification> = Event.None;
	notify(notification: INotification): INotificationHandle {
		this.withNotify(notification);

		return new NoOpNotification();
	}
	info(message: any): void {
		throw new Error('Method not implemented.');
	}
	warn(message: any): void {
		throw new Error('Method not implemented.');
	}
	error(message: any): void {
		throw new Error('Method not implemented.');
	}
	prompt(severity: Severity, message: string, choices: IPromptChoice[], options?: IPromptOptions): INotificationHandle {
		throw new Error('Method not implemented');
	}
	status(message: string, options?: IStatusMessageOptions): IDisposable {
		return Disposable.None;
	}
	setFilter(filter: NotificationsFilter): void {
		throw new Error('Method not implemented.');
	}
}

suite('ExtHostMessageService', function () {

	test('propagte handle on select', async function () {

		let service = new MainThreadMessageService(null!, new EmptyNotificationService(notification => {
			assert.strictEqual(notification.actions!.primary!.length, 1);
			platform.setImmediate(() => notification.actions!.primary![0].run());
		}), emptyCommandService, emptyDialogService);

		const handle = await service.$showMessage(1, 'h', {}, [{ handle: 42, title: 'a thing', isCloseAffordance: true }]);
		assert.strictEqual(handle, 42);
	});

	suite('modal', () => {
		test('calls dialog service', async () => {
			const service = new MainThreadMessageService(null!, emptyNotificationService, emptyCommandService, new class extends mock<IDialogService>() {
				override show(severity: Severity, message: string, buttons: string[]) {
					assert.strictEqual(severity, 1);
					assert.strictEqual(message, 'h');
					assert.strictEqual(buttons.length, 2);
					assert.strictEqual(buttons[1], 'Cancel');
					return Promise.resolve({ choice: 0 });
				}
			} as IDialogService);

			const handle = await service.$showMessage(1, 'h', { modal: true }, [{ handle: 42, title: 'a thing', isCloseAffordance: false }]);
			assert.strictEqual(handle, 42);
		});

		test('returns undefined when cancelled', async () => {
			const service = new MainThreadMessageService(null!, emptyNotificationService, emptyCommandService, new class extends mock<IDialogService>() {
				override show() {
					return Promise.resolve({ choice: 1 });
				}
			} as IDialogService);

			const handle = await service.$showMessage(1, 'h', { modal: true }, [{ handle: 42, title: 'a thing', isCloseAffordance: false }]);
			assert.strictEqual(handle, undefined);
		});

		test('hides Cancel button when not needed', async () => {
			const service = new MainThreadMessageService(null!, emptyNotificationService, emptyCommandService, new class extends mock<IDialogService>() {
				override show(severity: Severity, message: string, buttons: string[]) {
					assert.strictEqual(buttons.length, 1);
					return Promise.resolve({ choice: 0 });
				}
			} as IDialogService);

			const handle = await service.$showMessage(1, 'h', { modal: true }, [{ handle: 42, title: 'a thing', isCloseAffordance: true }]);
			assert.strictEqual(handle, 42);
		});
	});
});
