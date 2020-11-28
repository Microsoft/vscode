/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as appInsights from 'applicationinsights';
import { onUnexpectedError } from 'vs/base/common/errors';
import { mixin } from 'vs/base/common/objects';
import { ITelemetryAppender, validateTelemetryData } from 'vs/platform/telemetry/common/telemetryUtils';

async function getClient(aiKey: string): Promise<appInsights.TelemetryClient> {
	const appInsights = await import('applicationinsights');
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

	private _aiClient: string | appInsights.TelemetryClient | undefined;
	private _asyncAIClient: Promise<appInsights.TelemetryClient> | null;

	constructor(
		private _eventPrefix: string,
		private _defaultData: { [key: string]: any } | null,
		aiKeyOrClientFactory: string | (() => appInsights.TelemetryClient), // allow factory function for testing
	) {
		if (!this._defaultData) {
			this._defaultData = Object.create(null);
		}

		if (typeof aiKeyOrClientFactory === 'function') {
			this._aiClient = aiKeyOrClientFactory();
		} else {
			this._aiClient = aiKeyOrClientFactory;
		}
		this._asyncAIClient = null;
	}

	private _withAIClient(callback: (aiClient: appInsights.TelemetryClient) => void): void {
		if (!this._aiClient) {
			return;
		}

		if (typeof this._aiClient !== 'string') {
			callback(this._aiClient);
			return;
		}

		if (!this._asyncAIClient) {
			this._asyncAIClient = getClient(this._aiClient);
		}

		this._asyncAIClient.then(
			(aiClient) => {
				callback(aiClient);
			},
			(err) => {
				onUnexpectedError(err);
				console.error(err);
			}
		);
	}

	log(eventName: string, data?: any): void {
		if (!this._aiClient) {
			return;
		}
		data = mixin(data, this._defaultData);
		data = validateTelemetryData(data);

		this._withAIClient((aiClient) => aiClient.trackEvent({
			name: this._eventPrefix + '/' + eventName,
			properties: data.properties,
			measurements: data.measurements
		}));
	}

	flush(): Promise<any> {
		if (this._aiClient) {
			return new Promise(resolve => {
				this._withAIClient((aiClient) => {
					aiClient.flush({
						callback: () => {
							// all data flushed
							this._aiClient = undefined;
							resolve(undefined);
						}
					});
				});
			});
		}
		return Promise.resolve(undefined);
	}
}
