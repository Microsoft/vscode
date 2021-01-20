/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { INotificationItem } from 'vs/platform/notification/common/notification';
import { NotificationRegistry } from 'vs/platform/notification/common/notificationRegistry';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { EditorModel } from 'vs/workbench/common/editor';

export class NotificationsEditorModel extends EditorModel {
	constructor(
		@IStorageService private readonly storageService: IStorageService
	) {
		super();
	}
	get notificationItems(): INotificationItem[] {
		return NotificationRegistry._notifications.filter(notification => this.storageService.getBoolean(notification.id, StorageScope.GLOBAL));
	}
	resolve(): Promise<EditorModel> {
		return Promise.resolve(this);
	}
}
