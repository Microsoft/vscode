/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { alert } from 'vs/base/browser/ui/aria/aria';
import { localize } from 'vs/nls';
import { INotificationViewItem, INotificationsModel, NotificationChangeType, INotificationChangeEvent, NotificationViewItemContentChangeKind } from 'vs/workbench/common/notifications';
import { Disposable } from 'vs/base/common/lifecycle';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import { Severity } from 'vs/platform/notification/common/notification';
import { Event } from 'vs/base/common/event';

export class NotificationsAlerts extends Disposable {

	constructor(private model: INotificationsModel) {
		super();

		// Alert initial notifications if any
		model.notifications.forEach(n => this.triggerAriaAlert(n));

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.model.onDidChangeNotification(e => this.onDidChangeNotification(e)));
	}

	private onDidChangeNotification(e: INotificationChangeEvent): void {
		if (e.kind === NotificationChangeType.ADD) {

			// ARIA alert for screen readers
			this.triggerAriaAlert(e.item);

			// Always log errors to console with full details
			if (e.item.severity === Severity.Error) {
				if (e.item.message.original instanceof Error) {
					console.error(e.item.message.original);
				} else {
					console.error(toErrorMessage(e.item.message.linkedText.toString(), true));
				}
			}
		}
	}

	private triggerAriaAlert(notifiation: INotificationViewItem): void {
		if (notifiation.silent) {
			return;
		}

		// Trigger the alert again whenever the message changes
		const listener = notifiation.onDidChangeContent(e => {
			if (e.kind === NotificationViewItemContentChangeKind.MESSAGE) {
				this.doTriggerAriaAlert(notifiation);
			}
		});

		Event.once(notifiation.onDidClose)(() => listener.dispose());

		this.doTriggerAriaAlert(notifiation);
	}

	private doTriggerAriaAlert(notifiation: INotificationViewItem): void {
		let alertText: string;
		if (notifiation.severity === Severity.Error) {
			alertText = localize('alertErrorMessage', "Error: {0}", notifiation.message.linkedText.toString());
		} else if (notifiation.severity === Severity.Warning) {
			alertText = localize('alertWarningMessage', "Warning: {0}", notifiation.message.linkedText.toString());
		} else {
			alertText = localize('alertInfoMessage', "Info: {0}", notifiation.message.linkedText.toString());
		}

		alert(alertText);
	}
}
