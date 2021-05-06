/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { NotificationsModel, NotificationViewItem, INotificationChangeEvent, NotificationChangeType, NotificationViewItemContentChangeKind, IStatusMessageChangeEvent, StatusMessageChangeType } from 'vs/workbench/common/notifications';
import { Action } from 'vs/base/common/actions';
import { INotification, Severity, NotificationsFilter } from 'vs/platform/notification/common/notification';
import { createErrorWithActions } from 'vs/base/common/errors';
import { NotificationService } from 'vs/workbench/services/notification/common/notificationService';
import { TestStorageService } from 'vs/workbench/test/common/workbenchTestServices';

suite('Notifications', () => {

	test('Items', () => {

		// Invalid
		assert.ok(!NotificationViewItem.create({ severity: Severity.Error, message: '' }));
		assert.ok(!NotificationViewItem.create({ severity: Severity.Error, message: null! }));

		// Duplicates
		let item1 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message' })!;
		let item2 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message' })!;
		let item3 = NotificationViewItem.create({ severity: Severity.Info, message: 'Info Message' })!;
		let item4 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message', source: 'Source' })!;
		let item5 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message', actions: { primary: [new Action('id', 'label')] } })!;
		let item6 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message', actions: { primary: [new Action('id', 'label')] }, progress: { infinite: true } })!;

		assert.strictEqual(item1.equals(item1), true);
		assert.strictEqual(item2.equals(item2), true);
		assert.strictEqual(item3.equals(item3), true);
		assert.strictEqual(item4.equals(item4), true);
		assert.strictEqual(item5.equals(item5), true);

		assert.strictEqual(item1.equals(item2), true);
		assert.strictEqual(item1.equals(item3), false);
		assert.strictEqual(item1.equals(item4), false);
		assert.strictEqual(item1.equals(item5), false);

		let itemId1 = NotificationViewItem.create({ id: 'same', message: 'Info Message', severity: Severity.Info })!;
		let itemId2 = NotificationViewItem.create({ id: 'same', message: 'Error Message', severity: Severity.Error })!;

		assert.strictEqual(itemId1.equals(itemId2), true);
		assert.strictEqual(itemId1.equals(item3), false);

		// Progress
		assert.strictEqual(item1.hasProgress, false);
		assert.strictEqual(item6.hasProgress, true);

		// Message Box
		assert.strictEqual(item5.canCollapse, false);
		assert.strictEqual(item5.expanded, true);

		// Events
		let called = 0;
		item1.onDidChangeExpansion(() => {
			called++;
		});

		item1.expand();
		item1.expand();
		item1.collapse();
		item1.collapse();

		assert.strictEqual(called, 2);

		called = 0;
		item1.onDidChangeContent(e => {
			if (e.kind === NotificationViewItemContentChangeKind.PROGRESS) {
				called++;
			}
		});

		item1.progress.infinite();
		item1.progress.done();

		assert.strictEqual(called, 2);

		called = 0;
		item1.onDidChangeContent(e => {
			if (e.kind === NotificationViewItemContentChangeKind.MESSAGE) {
				called++;
			}
		});

		item1.updateMessage('message update');

		called = 0;
		item1.onDidChangeContent(e => {
			if (e.kind === NotificationViewItemContentChangeKind.SEVERITY) {
				called++;
			}
		});

		item1.updateSeverity(Severity.Error);

		called = 0;
		item1.onDidChangeContent(e => {
			if (e.kind === NotificationViewItemContentChangeKind.ACTIONS) {
				called++;
			}
		});

		item1.updateActions({ primary: [new Action('id2', 'label')] });

		assert.strictEqual(called, 1);

		called = 0;
		item1.onDidChangeVisibility(e => {
			called++;
		});

		item1.updateVisibility(true);
		item1.updateVisibility(false);
		item1.updateVisibility(false);

		assert.strictEqual(called, 2);

		called = 0;
		item1.onDidClose(() => {
			called++;
		});

		item1.close();
		assert.strictEqual(called, 1);

		// Error with Action
		let item7 = NotificationViewItem.create({ severity: Severity.Error, message: createErrorWithActions('Hello Error', { actions: [new Action('id', 'label')] }) })!;
		assert.strictEqual(item7.actions!.primary!.length, 1);

		// Filter
		let item8 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message' }, NotificationsFilter.SILENT)!;
		assert.strictEqual(item8.silent, true);

		let item9 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message' }, NotificationsFilter.OFF)!;
		assert.strictEqual(item9.silent, false);

		let item10 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message' }, NotificationsFilter.ERROR)!;
		assert.strictEqual(item10.silent, false);

		let item11 = NotificationViewItem.create({ severity: Severity.Warning, message: 'Error Message' }, NotificationsFilter.ERROR)!;
		assert.strictEqual(item11.silent, true);
	});

	test('Model', () => {
		const model = new NotificationsModel();

		let lastNotificationEvent!: INotificationChangeEvent;
		model.onDidChangeNotification(e => {
			lastNotificationEvent = e;
		});

		let lastStatusMessageEvent!: IStatusMessageChangeEvent;
		model.onDidChangeStatusMessage(e => {
			lastStatusMessageEvent = e;
		});

		let item1: INotification = { severity: Severity.Error, message: 'Error Message', actions: { primary: [new Action('id', 'label')] } };
		let item2: INotification = { severity: Severity.Warning, message: 'Warning Message', source: 'Some Source' };
		let item2Duplicate: INotification = { severity: Severity.Warning, message: 'Warning Message', source: 'Some Source' };
		let item3: INotification = { severity: Severity.Info, message: 'Info Message' };

		let item1Handle = model.addNotification(item1);
		assert.strictEqual(lastNotificationEvent.item.severity, item1.severity);
		assert.strictEqual(lastNotificationEvent.item.message.linkedText.toString(), item1.message);
		assert.strictEqual(lastNotificationEvent.index, 0);
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.ADD);

		item1Handle.updateMessage('Error Message');
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.CHANGE);
		assert.strictEqual(lastNotificationEvent.detail, NotificationViewItemContentChangeKind.MESSAGE);

		item1Handle.updateSeverity(Severity.Error);
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.CHANGE);
		assert.strictEqual(lastNotificationEvent.detail, NotificationViewItemContentChangeKind.SEVERITY);

		item1Handle.updateActions({ primary: [], secondary: [] });
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.CHANGE);
		assert.strictEqual(lastNotificationEvent.detail, NotificationViewItemContentChangeKind.ACTIONS);

		item1Handle.progress.infinite();
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.CHANGE);
		assert.strictEqual(lastNotificationEvent.detail, NotificationViewItemContentChangeKind.PROGRESS);

		let item2Handle = model.addNotification(item2);
		assert.strictEqual(lastNotificationEvent.item.severity, item2.severity);
		assert.strictEqual(lastNotificationEvent.item.message.linkedText.toString(), item2.message);
		assert.strictEqual(lastNotificationEvent.index, 0);
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.ADD);

		model.addNotification(item3);
		assert.strictEqual(lastNotificationEvent.item.severity, item3.severity);
		assert.strictEqual(lastNotificationEvent.item.message.linkedText.toString(), item3.message);
		assert.strictEqual(lastNotificationEvent.index, 0);
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.ADD);

		assert.strictEqual(model.notifications.length, 3);

		let called = 0;
		item1Handle.onDidClose(() => {
			called++;
		});

		item1Handle.close();
		assert.strictEqual(called, 1);
		assert.strictEqual(model.notifications.length, 2);
		assert.strictEqual(lastNotificationEvent.item.severity, item1.severity);
		assert.strictEqual(lastNotificationEvent.item.message.linkedText.toString(), item1.message);
		assert.strictEqual(lastNotificationEvent.index, 2);
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.REMOVE);

		model.addNotification(item2Duplicate);
		assert.strictEqual(model.notifications.length, 2);
		assert.strictEqual(lastNotificationEvent.item.severity, item2Duplicate.severity);
		assert.strictEqual(lastNotificationEvent.item.message.linkedText.toString(), item2Duplicate.message);
		assert.strictEqual(lastNotificationEvent.index, 0);
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.ADD);

		item2Handle.close();
		assert.strictEqual(model.notifications.length, 1);
		assert.strictEqual(lastNotificationEvent.item.severity, item2Duplicate.severity);
		assert.strictEqual(lastNotificationEvent.item.message.linkedText.toString(), item2Duplicate.message);
		assert.strictEqual(lastNotificationEvent.index, 0);
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.REMOVE);

		model.notifications[0].expand();
		assert.strictEqual(lastNotificationEvent.item.severity, item3.severity);
		assert.strictEqual(lastNotificationEvent.item.message.linkedText.toString(), item3.message);
		assert.strictEqual(lastNotificationEvent.index, 0);
		assert.strictEqual(lastNotificationEvent.kind, NotificationChangeType.EXPAND_COLLAPSE);

		const disposable = model.showStatusMessage('Hello World');
		assert.strictEqual(model.statusMessage!.message, 'Hello World');
		assert.strictEqual(lastStatusMessageEvent.item.message, model.statusMessage!.message);
		assert.strictEqual(lastStatusMessageEvent.kind, StatusMessageChangeType.ADD);
		disposable.dispose();
		assert.ok(!model.statusMessage);
		assert.strictEqual(lastStatusMessageEvent.kind, StatusMessageChangeType.REMOVE);

		let disposable2 = model.showStatusMessage('Hello World 2');
		const disposable3 = model.showStatusMessage('Hello World 3');

		assert.strictEqual(model.statusMessage!.message, 'Hello World 3');

		disposable2.dispose();
		assert.strictEqual(model.statusMessage!.message, 'Hello World 3');

		disposable3.dispose();
		assert.ok(!model.statusMessage);
	});

	test('Service', async () => {
		const service = new NotificationService(new TestStorageService());

		let addNotificationCount = 0;
		let notification!: INotification;
		service.onDidAddNotification(n => {
			addNotificationCount++;
			notification = n;
		});
		service.info('hello there');
		assert.strictEqual(addNotificationCount, 1);
		assert.strictEqual(notification.message, 'hello there');
		assert.strictEqual(notification.silent, false);
		assert.strictEqual(notification.source, undefined);

		let notificationHandle = service.notify({ message: 'important message', severity: Severity.Warning });
		assert.strictEqual(addNotificationCount, 2);
		assert.strictEqual(notification.message, 'important message');
		assert.strictEqual(notification.severity, Severity.Warning);

		let removeNotificationCount = 0;
		service.onDidRemoveNotification(n => {
			removeNotificationCount++;
			notification = n;
		});
		notificationHandle.close();
		assert.strictEqual(removeNotificationCount, 1);
		assert.strictEqual(notification.message, 'important message');

		notificationHandle = service.notify({ silent: true, message: 'test', severity: Severity.Ignore });
		assert.strictEqual(addNotificationCount, 3);
		assert.strictEqual(notification.message, 'test');
		assert.strictEqual(notification.silent, true);
		notificationHandle.close();
		assert.strictEqual(removeNotificationCount, 2);
	});
});
