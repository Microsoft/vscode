/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { INotificationService, NotificationMessage } from 'vs/platform/notification/common/notification';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { hash } from 'vs/base/common/hash';

export interface NotificationMetrics {
	id: string;
	silent: boolean;
	source?: string;
}

export type NotificationMetricsClassification = {
	id: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	silent: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
	source?: { classification: 'SystemMetaData', purpose: 'FeatureInsight' };
};

export function notificationToMetrics(message: NotificationMessage, source: string | undefined, silent: boolean): NotificationMetrics {
	return {
		id: hash(message.toString()).toString(),
		silent,
		source: source || 'core'
	};
}

export class NotificationsTelemetry extends Disposable implements IWorkbenchContribution {

	constructor(
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@INotificationService private readonly notificationService: INotificationService
	) {
		super();
		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.notificationService.onDidAddNotification(notification => {
			const source = notification.source && typeof notification.source !== 'string' ? notification.source.id : notification.source;
			this.telemetryService.publicLog2<NotificationMetrics, NotificationMetricsClassification>('notification:show', notificationToMetrics(notification.message, source, !!notification.silent));
		}));

		this._register(this.notificationService.onDidRemoveNotification(notification => {
			const source = notification.source && typeof notification.source !== 'string' ? notification.source.id : notification.source;
			this.telemetryService.publicLog2<NotificationMetrics, NotificationMetricsClassification>('notification:close', notificationToMetrics(notification.message, source, !!notification.silent));
		}));
	}
}
