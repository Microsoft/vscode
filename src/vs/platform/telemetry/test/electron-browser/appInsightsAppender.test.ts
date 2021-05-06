/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { AppInsightsAppender } from 'vs/platform/telemetry/node/appInsightsAppender';
import { TelemetryClient, Contracts } from 'applicationinsights';

class AppInsightsMock extends TelemetryClient {
	public override config: any;
	public override channel: any;
	public events: Contracts.EventTelemetry[] = [];
	public IsTrackingPageView: boolean = false;
	public exceptions: any[] = [];

	constructor() {
		super('testKey');
	}

	public override trackEvent(event: any) {
		this.events.push(event);
	}

	public override flush(options: any): void {
		// called on dispose
	}
}

suite('AIAdapter', () => {
	let appInsightsMock: AppInsightsMock;
	let adapter: AppInsightsAppender;
	let prefix = 'prefix';


	setup(() => {
		appInsightsMock = new AppInsightsMock();
		adapter = new AppInsightsAppender(prefix, undefined!, () => appInsightsMock);
	});

	teardown(() => {
		adapter.flush();
	});

	test('Simple event', () => {
		adapter.log('testEvent');

		assert.strictEqual(appInsightsMock.events.length, 1);
		assert.strictEqual(appInsightsMock.events[0].name, `${prefix}/testEvent`);
	});

	test('addional data', () => {
		adapter = new AppInsightsAppender(prefix, { first: '1st', second: 2, third: true }, () => appInsightsMock);
		adapter.log('testEvent');

		assert.strictEqual(appInsightsMock.events.length, 1);
		let [first] = appInsightsMock.events;
		assert.strictEqual(first.name, `${prefix}/testEvent`);
		assert.strictEqual(first.properties!['first'], '1st');
		assert.strictEqual(first.measurements!['second'], 2);
		assert.strictEqual(first.measurements!['third'], 1);
	});

	test('property limits', () => {
		let reallyLongPropertyName = 'abcdefghijklmnopqrstuvwxyz';
		for (let i = 0; i < 6; i++) {
			reallyLongPropertyName += 'abcdefghijklmnopqrstuvwxyz';
		}
		assert(reallyLongPropertyName.length > 150);

		let reallyLongPropertyValue = 'abcdefghijklmnopqrstuvwxyz012345678901234567890123';
		for (let i = 0; i < 21; i++) {
			reallyLongPropertyValue += 'abcdefghijklmnopqrstuvwxyz012345678901234567890123';
		}
		assert(reallyLongPropertyValue.length > 1024);

		let data = Object.create(null);
		data[reallyLongPropertyName] = '1234';
		data['reallyLongPropertyValue'] = reallyLongPropertyValue;
		adapter.log('testEvent', data);

		assert.strictEqual(appInsightsMock.events.length, 1);

		for (let prop in appInsightsMock.events[0].properties!) {
			assert(prop.length < 150);
			assert(appInsightsMock.events[0].properties![prop].length < 1024);
		}
	});

	test('Different data types', () => {
		let date = new Date();
		adapter.log('testEvent', { favoriteDate: date, likeRed: false, likeBlue: true, favoriteNumber: 1, favoriteColor: 'blue', favoriteCars: ['bmw', 'audi', 'ford'] });

		assert.strictEqual(appInsightsMock.events.length, 1);
		assert.strictEqual(appInsightsMock.events[0].name, `${prefix}/testEvent`);
		assert.strictEqual(appInsightsMock.events[0].properties!['favoriteColor'], 'blue');
		assert.strictEqual(appInsightsMock.events[0].measurements!['likeRed'], 0);
		assert.strictEqual(appInsightsMock.events[0].measurements!['likeBlue'], 1);
		assert.strictEqual(appInsightsMock.events[0].properties!['favoriteDate'], date.toISOString());
		assert.strictEqual(appInsightsMock.events[0].properties!['favoriteCars'], JSON.stringify(['bmw', 'audi', 'ford']));
		assert.strictEqual(appInsightsMock.events[0].measurements!['favoriteNumber'], 1);
	});

	test('Nested data', () => {
		adapter.log('testEvent', {
			window: {
				title: 'some title',
				measurements: {
					width: 100,
					height: 200
				}
			},
			nestedObj: {
				nestedObj2: {
					nestedObj3: {
						testProperty: 'test',
					}
				},
				testMeasurement: 1
			}
		});

		assert.strictEqual(appInsightsMock.events.length, 1);
		assert.strictEqual(appInsightsMock.events[0].name, `${prefix}/testEvent`);

		assert.strictEqual(appInsightsMock.events[0].properties!['window.title'], 'some title');
		assert.strictEqual(appInsightsMock.events[0].measurements!['window.measurements.width'], 100);
		assert.strictEqual(appInsightsMock.events[0].measurements!['window.measurements.height'], 200);

		assert.strictEqual(appInsightsMock.events[0].properties!['nestedObj.nestedObj2.nestedObj3'], JSON.stringify({ 'testProperty': 'test' }));
		assert.strictEqual(appInsightsMock.events[0].measurements!['nestedObj.testMeasurement'], 1);
	});

});
