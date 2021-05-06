/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Cache } from 'vs/base/common/cache';
import { timeout } from 'vs/base/common/async';

suite('Cache', () => {

	test('simple value', () => {
		let counter = 0;
		const cache = new Cache(_ => Promise.resolve(counter++));

		return cache.get().promise
			.then(c => assert.strictEqual(c, 0), () => assert.fail('Unexpected assertion error'))
			.then(() => cache.get().promise)
			.then(c => assert.strictEqual(c, 0), () => assert.fail('Unexpected assertion error'));
	});

	test('simple error', () => {
		let counter = 0;
		const cache = new Cache(_ => Promise.reject(new Error(String(counter++))));

		return cache.get().promise
			.then(() => assert.fail('Unexpected assertion error'), err => assert.strictEqual(err.message, '0'))
			.then(() => cache.get().promise)
			.then(() => assert.fail('Unexpected assertion error'), err => assert.strictEqual(err.message, '0'));
	});

	test('should retry cancellations', () => {
		let counter1 = 0, counter2 = 0;

		const cache = new Cache(token => {
			counter1++;
			return Promise.resolve(timeout(2, token).then(() => counter2++));
		});

		assert.strictEqual(counter1, 0);
		assert.strictEqual(counter2, 0);
		let result = cache.get();
		assert.strictEqual(counter1, 1);
		assert.strictEqual(counter2, 0);
		result.promise.then(undefined, () => assert(true));
		result.dispose();
		assert.strictEqual(counter1, 1);
		assert.strictEqual(counter2, 0);

		result = cache.get();
		assert.strictEqual(counter1, 2);
		assert.strictEqual(counter2, 0);

		return result.promise
			.then(c => {
				assert.strictEqual(counter1, 2);
				assert.strictEqual(counter2, 1);
			})
			.then(() => cache.get().promise)
			.then(c => {
				assert.strictEqual(counter1, 2);
				assert.strictEqual(counter2, 1);
			});
	});
});
