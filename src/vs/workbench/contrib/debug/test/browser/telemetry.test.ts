/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MockDebugAdapter, createMockDebugModel } from 'vs/workbench/contrib/debug/test/common/mockDebug';
import { DebugModel } from 'vs/workbench/contrib/debug/common/debugModel';
import { DebugSession } from 'vs/workbench/contrib/debug/browser/debugSession';
import { generateUuid } from 'vs/base/common/uuid';
import { NullOpenerService } from 'vs/platform/opener/common/opener';
import { RawDebugSession } from 'vs/workbench/contrib/debug/browser/rawDebugSession';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { stub, SinonStub } from 'sinon';
import { timeout } from 'vs/base/common/async';

suite('Debug - DebugSession telemetry', () => {
	let model: DebugModel;
	let session: DebugSession;
	let adapter: MockDebugAdapter;
	let telemetry: { isOptedIn: boolean; sendErrorTelemetry: boolean; publicLog: SinonStub };

	setup(() => {
		telemetry = { isOptedIn: true, sendErrorTelemetry: true, publicLog: stub() };
		adapter = new MockDebugAdapter();
		model = createMockDebugModel();

		const telemetryService = telemetry as Partial<ITelemetryService> as ITelemetryService;
		session = new DebugSession(generateUuid(), undefined!, undefined!, model, undefined, undefined!, telemetryService, undefined!, undefined!, undefined!, undefined!, undefined!, undefined!, NullOpenerService, undefined!, undefined!);
		session.initializeForTest(new RawDebugSession(adapter, undefined!, undefined!, telemetryService, undefined!, undefined!, undefined!));
	});

	test('does not send telemetry when opted out', async () => {
		telemetry.isOptedIn = false;
		adapter.sendEventBody('output', {
			category: 'telemetry',
			output: 'someEvent',
			data: { foo: 'bar', '!err': 'oh no!' }
		});

		await timeout(0);
		assert.strictEqual(telemetry.publicLog.callCount, 0);
	});

	test('logs telemetry and exceptions when enabled', async () => {
		adapter.sendEventBody('output', {
			category: 'telemetry',
			output: 'someEvent',
			data: { foo: 'bar', '!err': 'oh no!' }
		});

		await timeout(0);
		assert.deepStrictEqual(telemetry.publicLog.args[0], [
			'someEvent',
			{ foo: 'bar', '!err': 'oh no!' }
		]);
	});

	test('filters exceptions when error reporting disabled', async () => {
		telemetry.sendErrorTelemetry = false;

		adapter.sendEventBody('output', {
			category: 'telemetry',
			output: 'someEvent',
			data: { foo: 'bar', '!err': 'oh no!' }
		});

		await timeout(0);
		assert.deepStrictEqual(telemetry.publicLog.args[0], [
			'someEvent',
			{ foo: 'bar' }
		]);
	});
});
