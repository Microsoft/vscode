/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { Cache } from 'vs/base/common/cache';
import { timeout } from 'vs/base/common/async';

suite('Cache', () => {

	test('simple value', () => {
		let counter = 0;
		const cache = new Cache(_ => Promise.resolve(counter++));

		return cache.get().promise
			.then(c => assert.equal(c, 0), () => assert.fail('Unexpected assertion error'))
			.then(() => cache.get().promise)
			.then(c => assert.equal(c, 0), () => assert.fail('Unexpected assertion error'));
	});

	test('simple error', () => {
		let counter = 0;
		const cache = new Cache(_ => Promise.reject(new Error(String(counter++))));

		return cache.get().promise
			.then(() => assert.fail('Unexpected assertion error'), err => assert.equal(err.message, 0))
			.then(() => cache.get().promise)
			.then(() => assert.fail('Unexpected assertion error'), err => assert.equal(err.message, 0));
	});

	test('should retry cancellations', () => {
		let counter1 = 0, counter2 = 0;

		const cache = new Cache(token => {
			counter1++;
			return Promise.resolve(timeout(2, token).then(() => counter2++));
		});

		assert.equal(counter1, 0);
		assert.equal(counter2, 0);
		let result = cache.get();
		assert.equal(counter1, 1);
		assert.equal(counter2, 0);
		result.promise.then(undefined, () => assert(true));
		result.dispose();
		assert.equal(counter1, 1);
		assert.equal(counter2, 0);

		result = cache.get();
		assert.equal(counter1, 2);
		assert.equal(counter2, 0);

		return result.promise
			.then(c => {
				assert.equal(counter1, 2);
				assert.equal(counter2, 1);
			})
			.then(() => cache.get().promise)
			.then(c => {
				assert.equal(counter1, 2);
				assert.equal(counter2, 1);
			});
	});
});
