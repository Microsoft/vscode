/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as appInsights from 'applicationinsights';
import { mixin } from 'vs/base/common/objects';
import { ITelemetryAppender, validateTelemetryData } from 'vs/platform/telemetry/common/telemetryUtils';
import { ILogService } from 'vs/platform/log/common/log';

function getClient(aiKey: string): appInsights.TelemetryClient {

	let client: appInsights.TelemetryClient;
	if (appInsights.defaultClient) {
		client = new appInsights.TelemetryClient(aiKey);
		client.channel.setUseDiskRetryCaching(true);
	} else {
		appInsights.setup(aiKey)
			.setAutoCollectRequests(false)
			.setAutoCollectPerformance(false)
			.setAutoCollectExceptions(false)
			.setAutoCollectDependencies(false)
			.setAutoDependencyCorrelation(false)
			.setAutoCollectConsole(false)
			.setInternalLogging(false, false)
			.setUseDiskRetryCaching(true)
			.start();
		client = appInsights.defaultClient;
	}

	if (aiKey.indexOf('AIF-') === 0) {
		client.config.endpointUrl = 'https://vortex.data.microsoft.com/collect/v1';
	}
	return client;
}


export class AppInsightsAppender implements ITelemetryAppender {

	private _aiClient?: appInsights.TelemetryClient;

	constructor(
		private _eventPrefix: string,
		private _defaultData: { [key: string]: any } | null,
		aiKeyOrClientFactory: string | (() => appInsights.TelemetryClient), // allow factory function for testing
		@ILogService private _logService?: ILogService
	) {
		if (!this._defaultData) {
			this._defaultData = Object.create(null);
		}

		if (typeof aiKeyOrClientFactory === 'string') {
			this._aiClient = getClient(aiKeyOrClientFactory);
		} else if (typeof aiKeyOrClientFactory === 'function') {
			this._aiClient = aiKeyOrClientFactory();
		}
	}

	log(eventName: string, data?: any): void {
		if (!this._aiClient) {
			return;
		}
		data = mixin(data, this._defaultData);
		data = validateTelemetryData(data);

		if (this._logService) {
			this._logService.trace(`telemetry/${eventName}`, data);
		}
		this._aiClient.trackEvent({
			name: this._eventPrefix + '/' + eventName,
			properties: data.properties,
			measurements: data.measurements
		});
	}

	flush(): Promise<any> {
		if (this._aiClient) {
			return new Promise(resolve => {
				this._aiClient!.flush({
					callback: () => {
						// all data flushed
						this._aiClient = undefined;
						resolve(undefined);
					}
				});
			});
		}
		return Promise.resolve(undefined);
	}
}
