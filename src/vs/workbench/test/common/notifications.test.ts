/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { NotificationsModel, NotificationViewItem, INotificationChangeEvent, NotificationChangeType, NotificationViewItemContentChangeKind, IStatusMessageChangeEvent, StatusMessageChangeType } from 'vs/workbench/common/notifications';
import { Action } from 'vs/base/common/actions';
import { INotification, Severity, NotificationsFilter } from 'vs/platform/notification/common/notification';
import { createErrorWithActions } from 'vs/base/common/errorsWithActions';

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

		assert.equal(item1.equals(item1), true);
		assert.equal(item2.equals(item2), true);
		assert.equal(item3.equals(item3), true);
		assert.equal(item4.equals(item4), true);
		assert.equal(item5.equals(item5), true);

		assert.equal(item1.equals(item2), true);
		assert.equal(item1.equals(item3), false);
		assert.equal(item1.equals(item4), false);
		assert.equal(item1.equals(item5), false);

		// Progress
		assert.equal(item1.hasProgress, false);
		assert.equal(item6.hasProgress, true);

		// Message Box
		assert.equal(item5.canCollapse, false);
		assert.equal(item5.expanded, true);

		// Events
		let called = 0;
		item1.onDidChangeExpansion(() => {
			called++;
		});

		item1.expand();
		item1.expand();
		item1.collapse();
		item1.collapse();

		assert.equal(called, 2);

		called = 0;
		item1.onDidChangeContent(e => {
			if (e.kind === NotificationViewItemContentChangeKind.PROGRESS) {
				called++;
			}
		});

		item1.progress.infinite();
		item1.progress.done();

		assert.equal(called, 2);

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

		assert.equal(called, 1);

		called = 0;
		item1.onDidChangeVisibility(e => {
			called++;
		});

		item1.updateVisibility(true);
		item1.updateVisibility(false);
		item1.updateVisibility(false);

		assert.equal(called, 2);

		called = 0;
		item1.onDidClose(() => {
			called++;
		});

		item1.close();
		assert.equal(called, 1);

		// Error with Action
		let item7 = NotificationViewItem.create({ severity: Severity.Error, message: createErrorWithActions('Hello Error', { actions: [new Action('id', 'label')] }) })!;
		assert.equal(item7.actions!.primary!.length, 1);

		// Filter
		let item8 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message' }, NotificationsFilter.SILENT)!;
		assert.equal(item8.silent, true);

		let item9 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message' }, NotificationsFilter.OFF)!;
		assert.equal(item9.silent, false);

		let item10 = NotificationViewItem.create({ severity: Severity.Error, message: 'Error Message' }, NotificationsFilter.ERROR)!;
		assert.equal(item10.silent, false);

		let item11 = NotificationViewItem.create({ severity: Severity.Warning, message: 'Error Message' }, NotificationsFilter.ERROR)!;
		assert.equal(item11.silent, true);
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
		assert.equal(lastNotificationEvent.item.severity, item1.severity);
		assert.equal(lastNotificationEvent.item.message.linkedText.toString(), item1.message);
		assert.equal(lastNotificationEvent.index, 0);
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.ADD);

		item1Handle.updateMessage('Error Message');
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.CHANGE);
		assert.equal(lastNotificationEvent.detail, NotificationViewItemContentChangeKind.MESSAGE);

		item1Handle.updateSeverity(Severity.Error);
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.CHANGE);
		assert.equal(lastNotificationEvent.detail, NotificationViewItemContentChangeKind.SEVERITY);

		item1Handle.updateActions({ primary: [], secondary: [] });
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.CHANGE);
		assert.equal(lastNotificationEvent.detail, NotificationViewItemContentChangeKind.ACTIONS);

		item1Handle.progress.infinite();
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.CHANGE);
		assert.equal(lastNotificationEvent.detail, NotificationViewItemContentChangeKind.PROGRESS);

		let item2Handle = model.addNotification(item2);
		assert.equal(lastNotificationEvent.item.severity, item2.severity);
		assert.equal(lastNotificationEvent.item.message.linkedText.toString(), item2.message);
		assert.equal(lastNotificationEvent.index, 0);
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.ADD);

		model.addNotification(item3);
		assert.equal(lastNotificationEvent.item.severity, item3.severity);
		assert.equal(lastNotificationEvent.item.message.linkedText.toString(), item3.message);
		assert.equal(lastNotificationEvent.index, 0);
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.ADD);

		assert.equal(model.notifications.length, 3);

		let called = 0;
		item1Handle.onDidClose(() => {
			called++;
		});

		item1Handle.close();
		assert.equal(called, 1);
		assert.equal(model.notifications.length, 2);
		assert.equal(lastNotificationEvent.item.severity, item1.severity);
		assert.equal(lastNotificationEvent.item.message.linkedText.toString(), item1.message);
		assert.equal(lastNotificationEvent.index, 2);
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.REMOVE);

		model.addNotification(item2Duplicate);
		assert.equal(model.notifications.length, 2);
		assert.equal(lastNotificationEvent.item.severity, item2Duplicate.severity);
		assert.equal(lastNotificationEvent.item.message.linkedText.toString(), item2Duplicate.message);
		assert.equal(lastNotificationEvent.index, 0);
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.ADD);

		item2Handle.close();
		assert.equal(model.notifications.length, 1);
		assert.equal(lastNotificationEvent.item.severity, item2Duplicate.severity);
		assert.equal(lastNotificationEvent.item.message.linkedText.toString(), item2Duplicate.message);
		assert.equal(lastNotificationEvent.index, 0);
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.REMOVE);

		model.notifications[0].expand();
		assert.equal(lastNotificationEvent.item.severity, item3.severity);
		assert.equal(lastNotificationEvent.item.message.linkedText.toString(), item3.message);
		assert.equal(lastNotificationEvent.index, 0);
		assert.equal(lastNotificationEvent.kind, NotificationChangeType.EXPAND_COLLAPSE);

		const disposable = model.showStatusMessage('Hello World');
		assert.equal(model.statusMessage!.message, 'Hello World');
		assert.equal(lastStatusMessageEvent.item.message, model.statusMessage!.message);
		assert.equal(lastStatusMessageEvent.kind, StatusMessageChangeType.ADD);
		disposable.dispose();
		assert.ok(!model.statusMessage);
		assert.equal(lastStatusMessageEvent.kind, StatusMessageChangeType.REMOVE);

		let disposable2 = model.showStatusMessage('Hello World 2');
		const disposable3 = model.showStatusMessage('Hello World 3');

		assert.equal(model.statusMessage!.message, 'Hello World 3');

		disposable2.dispose();
		assert.equal(model.statusMessage!.message, 'Hello World 3');

		disposable3.dispose();
		assert.ok(!model.statusMessage);
	});
});
