/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import 'mocha';
import * as vscode from 'vscode';
import type * as Proto from '../protocol';
import { CachedResponse } from '../tsServer/cachedResponse';
import { ServerResponse } from '../typescriptService';

suite('CachedResponse', () => {
	test('should cache simple response for same document', async () => {
		const doc = await createTextDocument();
		const response = new CachedResponse();

		assertResult(await response.execute(doc, respondWith('test-0')), 'test-0');
		assertResult(await response.execute(doc, respondWith('test-1')), 'test-0');
	});

	test('should invalidate cache for new document', async () => {
		const doc1 = await createTextDocument();
		const doc2 = await createTextDocument();
		const response = new CachedResponse();

		assertResult(await response.execute(doc1, respondWith('test-0')), 'test-0');
		assertResult(await response.execute(doc1, respondWith('test-1')), 'test-0');
		assertResult(await response.execute(doc2, respondWith('test-2')), 'test-2');
		assertResult(await response.execute(doc2, respondWith('test-3')), 'test-2');
		assertResult(await response.execute(doc1, respondWith('test-4')), 'test-4');
		assertResult(await response.execute(doc1, respondWith('test-5')), 'test-4');
	});

	test('should not cache cancelled responses', async () => {
		const doc = await createTextDocument();
		const response = new CachedResponse();

		const cancelledResponder = createEventualResponder<ServerResponse.Cancelled>();
		const result1 = response.execute(doc, () => cancelledResponder.promise);
		const result2 = response.execute(doc, respondWith('test-0'));
		const result3 = response.execute(doc, respondWith('test-1'));

		cancelledResponder.resolve(new ServerResponse.Cancelled('cancelled'));

		assert.strictEqual((await result1).type, 'cancelled');
		assertResult(await result2, 'test-0');
		assertResult(await result3, 'test-0');
	});

	test('should not care if subsequent requests are cancelled if first request is resolved ok', async () => {
		const doc = await createTextDocument();
		const response = new CachedResponse();

		const cancelledResponder = createEventualResponder<ServerResponse.Cancelled>();
		const result1 = response.execute(doc, respondWith('test-0'));
		const result2 = response.execute(doc, () => cancelledResponder.promise);
		const result3 = response.execute(doc, respondWith('test-1'));

		cancelledResponder.resolve(new ServerResponse.Cancelled('cancelled'));

		assertResult(await result1, 'test-0');
		assertResult(await result2, 'test-0');
		assertResult(await result3, 'test-0');
	});

	test('should not cache cancelled responses with document changes', async () => {
		const doc1 = await createTextDocument();
		const doc2 = await createTextDocument();
		const response = new CachedResponse();

		const cancelledResponder = createEventualResponder<ServerResponse.Cancelled>();
		const cancelledResponder2 = createEventualResponder<ServerResponse.Cancelled>();

		const result1 = response.execute(doc1, () => cancelledResponder.promise);
		const result2 = response.execute(doc1, respondWith('test-0'));
		const result3 = response.execute(doc1, respondWith('test-1'));
		const result4 = response.execute(doc2, () => cancelledResponder2.promise);
		const result5 = response.execute(doc2, respondWith('test-2'));
		const result6 = response.execute(doc1, respondWith('test-3'));

		cancelledResponder.resolve(new ServerResponse.Cancelled('cancelled'));
		cancelledResponder2.resolve(new ServerResponse.Cancelled('cancelled'));

		assert.strictEqual((await result1).type, 'cancelled');
		assertResult(await result2, 'test-0');
		assertResult(await result3, 'test-0');
		assert.strictEqual((await result4).type, 'cancelled');
		assertResult(await result5, 'test-2');
		assertResult(await result6, 'test-3');
	});
});

function respondWith(command: string) {
	return async () => createResponse(command);
}

function createTextDocument() {
	return vscode.workspace.openTextDocument({ language: 'javascript', content: '' });
}

function assertResult(result: ServerResponse.Response<Proto.Response>, command: string) {
	if (result.type === 'response') {
		assert.strictEqual(result.command, command);
	} else {
		assert.fail('Response failed');
	}
}

function createResponse(command: string): Proto.Response {
	return {
		type: 'response',
		body: {},
		command: command,
		request_seq: 1,
		success: true,
		seq: 1
	};
}

function createEventualResponder<T>(): { promise: Promise<T>, resolve: (x: T) => void } {
	let resolve: (value: T) => void;
	const promise = new Promise<T>(r => { resolve = r; });
	return { promise, resolve: resolve! };
}
