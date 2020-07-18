/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import * as assert from 'assert';
import { AppInsightsAppender } from 'vs/platform/telemetry/node/appInsightsAppender';
import { ILogService, AbstractLogService, LogLevel, DEFAULT_LOG_LEVEL } from 'vs/platform/log/common/log';
import { TelemetryClient, Contracts } from 'applicationinsights';

class AppInsightsMock extends TelemetryClient {
	public config: any;
	public channel: any;
	public events: Contracts.EventTelemetry[] = [];
	public IsTrackingPageView: boolean = false;
	public exceptions: any[] = [];

	constructor() {
		super('testKey');
	}

	public trackEvent(event: any) {
		this.events.push(event);
	}

	public flush(options: any): void {
		// called on dispose
	}
}

class TestableLogService extends AbstractLogService implements ILogService {
	declare readonly _serviceBrand: undefined;

	public logs: string[] = [];

	constructor(logLevel: LogLevel = DEFAULT_LOG_LEVEL) {
		super();
		this.setLevel(logLevel);
	}

	trace(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Trace) {
			this.logs.push(message + JSON.stringify(args));
		}
	}

	debug(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Debug) {
			this.logs.push(message);
		}
	}

	info(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Info) {
			this.logs.push(message);
		}
	}

	warn(message: string | Error, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Warning) {
			this.logs.push(message.toString());
		}
	}

	error(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Error) {
			this.logs.push(message);
		}
	}

	critical(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Critical) {
			this.logs.push(message);
		}
	}

	dispose(): void { }
	flush(): void { }
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

		assert.equal(appInsightsMock.events.length, 1);
		assert.equal(appInsightsMock.events[0].name, `${prefix}/testEvent`);
	});

	test('addional data', () => {
		adapter = new AppInsightsAppender(prefix, { first: '1st', second: 2, third: true }, () => appInsightsMock);
		adapter.log('testEvent');

		assert.equal(appInsightsMock.events.length, 1);
		let [first] = appInsightsMock.events;
		assert.equal(first.name, `${prefix}/testEvent`);
		assert.equal(first.properties!['first'], '1st');
		assert.equal(first.measurements!['second'], '2');
		assert.equal(first.measurements!['third'], 1);
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

		assert.equal(appInsightsMock.events.length, 1);

		for (let prop in appInsightsMock.events[0].properties!) {
			assert(prop.length < 150);
			assert(appInsightsMock.events[0].properties![prop].length < 1024);
		}
	});

	test('Different data types', () => {
		let date = new Date();
		adapter.log('testEvent', { favoriteDate: date, likeRed: false, likeBlue: true, favoriteNumber: 1, favoriteColor: 'blue', favoriteCars: ['bmw', 'audi', 'ford'] });

		assert.equal(appInsightsMock.events.length, 1);
		assert.equal(appInsightsMock.events[0].name, `${prefix}/testEvent`);
		assert.equal(appInsightsMock.events[0].properties!['favoriteColor'], 'blue');
		assert.equal(appInsightsMock.events[0].measurements!['likeRed'], 0);
		assert.equal(appInsightsMock.events[0].measurements!['likeBlue'], 1);
		assert.equal(appInsightsMock.events[0].properties!['favoriteDate'], date.toISOString());
		assert.equal(appInsightsMock.events[0].properties!['favoriteCars'], JSON.stringify(['bmw', 'audi', 'ford']));
		assert.equal(appInsightsMock.events[0].measurements!['favoriteNumber'], 1);
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

		assert.equal(appInsightsMock.events.length, 1);
		assert.equal(appInsightsMock.events[0].name, `${prefix}/testEvent`);

		assert.equal(appInsightsMock.events[0].properties!['window.title'], 'some title');
		assert.equal(appInsightsMock.events[0].measurements!['window.measurements.width'], 100);
		assert.equal(appInsightsMock.events[0].measurements!['window.measurements.height'], 200);

		assert.equal(appInsightsMock.events[0].properties!['nestedObj.nestedObj2.nestedObj3'], JSON.stringify({ 'testProperty': 'test' }));
		assert.equal(appInsightsMock.events[0].measurements!['nestedObj.testMeasurement'], 1);
	});

	test('Do not Log Telemetry if log level is not trace', () => {
		const logService = new TestableLogService(LogLevel.Info);
		adapter = new AppInsightsAppender(prefix, { 'common.platform': 'Windows' }, () => appInsightsMock, logService);
		adapter.log('testEvent', { hello: 'world', isTrue: true, numberBetween1And3: 2 });
		assert.equal(logService.logs.length, 0);
	});

	test('Log Telemetry if log level is trace', () => {
		const logService = new TestableLogService(LogLevel.Trace);
		adapter = new AppInsightsAppender(prefix, { 'common.platform': 'Windows' }, () => appInsightsMock, logService);
		adapter.log('testEvent', { hello: 'world', isTrue: true, numberBetween1And3: 2 });
		assert.equal(logService.logs.length, 1);
		assert.equal(logService.logs[0], 'telemetry/testEvent' + JSON.stringify([{
			properties: {
				hello: 'world',
				'common.platform': 'Windows'
			},
			measurements: {
				isTrue: 1, numberBetween1And3: 2
			}
		}]));
	});
});
