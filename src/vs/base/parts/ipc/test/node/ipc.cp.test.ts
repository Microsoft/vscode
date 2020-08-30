/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Client } from 'vs/base/parts/ipc/node/ipc.cp';
import { TestServiceClient } from './testService';
import { getPathFromAmdModule } from 'vs/base/common/amd';

function createClient(): Client {
	return new Client(getPathFromAmdModule(require, 'bootstrap-fork'), {
		serverName: 'TestServer',
		env: { AMD_ENTRYPOINT: 'vs/base/parts/ipc/test/node/testApp', verbose: true }
	});
}

suite('IPC, Child Process', () => {
	test('createChannel', () => {
		const client = createClient();
		const channel = client.getChannel('test');
		const service = new TestServiceClient(channel);

		const result = service.pong('ping').then(r => {
			assert.equal(r.incoming, 'ping');
			assert.equal(r.outgoing, 'pong');
		});

		return result.finally(() => client.dispose());
	});

	test('events', () => {
		const client = createClient();
		const channel = client.getChannel('test');
		const service = new TestServiceClient(channel);

		const event = new Promise((c, e) => {
			service.onMarco(({ answer }) => {
				try {
					assert.equal(answer, 'polo');
					c(undefined);
				} catch (err) {
					e(err);
				}
			});
		});

		const request = service.marco();
		const result = Promise.all([request, event]);

		return result.finally(() => client.dispose());
	});

	test('event dispose', () => {
		const client = createClient();
		const channel = client.getChannel('test');
		const service = new TestServiceClient(channel);

		let count = 0;
		const disposable = service.onMarco(() => count++);

		const result = service.marco().then(async answer => {
			assert.equal(answer, 'polo');
			assert.equal(count, 1);

			const answer_1 = await service.marco();
			assert.equal(answer_1, 'polo');
			assert.equal(count, 2);
			disposable.dispose();

			const answer_2 = await service.marco();
			assert.equal(answer_2, 'polo');
			assert.equal(count, 2);
		});

		return result.finally(() => client.dispose());
	});
});
