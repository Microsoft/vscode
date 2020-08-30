/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { MockDebugAdapter } from 'vs/workbench/contrib/debug/test/common/mockDebug';
import { timeout } from 'vs/base/common/async';

suite('Debug - AbstractDebugAdapter', () => {
	suite('event ordering', () => {
		let adapter: MockDebugAdapter;
		let output: string[];
		setup(() => {
			adapter = new MockDebugAdapter();
			output = [];
			adapter.onEvent(ev => {
				output.push((ev as DebugProtocol.OutputEvent).body.output);
				Promise.resolve().then(() => output.push('--end microtask--'));
			});
		});

		const evaluate = async (expression: string) => {
			await new Promise(resolve => adapter.sendRequest('evaluate', { expression }, resolve));
			output.push(`=${expression}`);
			Promise.resolve().then(() => output.push('--end microtask--'));
		};

		test('inserts task boundary before response', async () => {
			await evaluate('before.foo');
			await timeout(0);

			assert.deepStrictEqual(output, ['before.foo', '--end microtask--', '=before.foo', '--end microtask--']);
		});

		test('inserts task boundary after response', async () => {
			await evaluate('after.foo');
			await timeout(0);

			assert.deepStrictEqual(output, ['=after.foo', '--end microtask--', 'after.foo', '--end microtask--']);
		});

		test('does not insert boundaries between events', async () => {
			adapter.sendEventBody('output', { output: 'a' });
			adapter.sendEventBody('output', { output: 'b' });
			adapter.sendEventBody('output', { output: 'c' });
			await timeout(0);

			assert.deepStrictEqual(output, ['a', 'b', 'c', '--end microtask--', '--end microtask--', '--end microtask--']);
		});
	});
});
