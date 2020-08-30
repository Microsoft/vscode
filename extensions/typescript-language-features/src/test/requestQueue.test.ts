/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import { RequestQueue, RequestQueueingType } from '../tsServer/requestQueue';

suite('RequestQueue', () => {
	test('should be empty on creation', async () => {
		const queue = new RequestQueue();
		assert.strictEqual(queue.length, 0);
		assert.strictEqual(queue.dequeue(), undefined);
	});

	suite('RequestQueue.createRequest', () => {
		test('should create items with increasing sequence numbers', async () => {
			const queue = new RequestQueue();

			for (let i = 0; i < 100; ++i) {
				const command = `command-${i}`;
				const request = queue.createRequest(command, i);
				assert.strictEqual(request.seq, i);
				assert.strictEqual(request.command, command);
				assert.strictEqual(request.arguments, i);
			}
		});
	});

	test('should queue normal requests in first in first out order', async () => {
		const queue = new RequestQueue();
		assert.strictEqual(queue.length, 0);

		const request1 = queue.createRequest('a', 1);
		queue.enqueue({ request: request1, expectsResponse: true, isAsync: false, queueingType: RequestQueueingType.Normal });
		assert.strictEqual(queue.length, 1);

		const request2 = queue.createRequest('b', 2);
		queue.enqueue({ request: request2, expectsResponse: true, isAsync: false, queueingType: RequestQueueingType.Normal });
		assert.strictEqual(queue.length, 2);

		{
			const item = queue.dequeue();
			assert.strictEqual(queue.length, 1);
			assert.strictEqual(item!.request.command, 'a');
		}
		{
			const item = queue.dequeue();
			assert.strictEqual(queue.length, 0);
			assert.strictEqual(item!.request.command, 'b');
		}
		{
			const item = queue.dequeue();
			assert.strictEqual(item, undefined);
			assert.strictEqual(queue.length, 0);
		}
	});

	test('should put normal requests in front of low priority requests', async () => {
		const queue = new RequestQueue();
		assert.strictEqual(queue.length, 0);

		queue.enqueue({ request: queue.createRequest('low-1', 1), expectsResponse: true, isAsync: false, queueingType: RequestQueueingType.LowPriority });
		queue.enqueue({ request: queue.createRequest('low-2', 1), expectsResponse: true, isAsync: false, queueingType: RequestQueueingType.LowPriority });
		queue.enqueue({ request: queue.createRequest('normal-1', 2), expectsResponse: true, isAsync: false, queueingType: RequestQueueingType.Normal });
		queue.enqueue({ request: queue.createRequest('normal-2', 2), expectsResponse: true, isAsync: false, queueingType: RequestQueueingType.Normal });

		{
			const item = queue.dequeue();
			assert.strictEqual(queue.length, 3);
			assert.strictEqual(item!.request.command, 'normal-1');
		}
		{
			const item = queue.dequeue();
			assert.strictEqual(queue.length, 2);
			assert.strictEqual(item!.request.command, 'normal-2');
		}
		{
			const item = queue.dequeue();
			assert.strictEqual(queue.length, 1);
			assert.strictEqual(item!.request.command, 'low-1');
		}
		{
			const item = queue.dequeue();
			assert.strictEqual(queue.length, 0);
			assert.strictEqual(item!.request.command, 'low-2');
		}
	});

	test('should not push fence requests front of low priority requests', async () => {
		const queue = new RequestQueue();
		assert.strictEqual(queue.length, 0);

		queue.enqueue({ request: queue.createRequest('low-1', 0), expectsResponse: true, isAsync: false, queueingType: RequestQueueingType.LowPriority });
		queue.enqueue({ request: queue.createRequest('fence', 0), expectsResponse: true, isAsync: false, queueingType: RequestQueueingType.Fence });
		queue.enqueue({ request: queue.createRequest('low-2', 0), expectsResponse: true, isAsync: false, queueingType: RequestQueueingType.LowPriority });
		queue.enqueue({ request: queue.createRequest('normal', 0), expectsResponse: true, isAsync: false, queueingType: RequestQueueingType.Normal });

		{
			const item = queue.dequeue();
			assert.strictEqual(queue.length, 3);
			assert.strictEqual(item!.request.command, 'low-1');
		}
		{
			const item = queue.dequeue();
			assert.strictEqual(queue.length, 2);
			assert.strictEqual(item!.request.command, 'fence');
		}
		{
			const item = queue.dequeue();
			assert.strictEqual(queue.length, 1);
			assert.strictEqual(item!.request.command, 'normal');
		}
		{
			const item = queue.dequeue();
			assert.strictEqual(queue.length, 0);
			assert.strictEqual(item!.request.command, 'low-2');
		}
	});
});

