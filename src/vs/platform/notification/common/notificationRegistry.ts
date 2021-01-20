/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotificationItem } from 'vs/platform/notification/common/notification';
import { Registry } from 'vs/platform/registry/common/platform';

export class NotificationRegistry {
	static _notifications: INotificationItem[] = [];
	constructor() { }

	static registerNotification(notification: INotificationItem): void {
		this._notifications.push(notification);
	}
}
Registry.add('notifications', this);


