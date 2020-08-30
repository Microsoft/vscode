/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as errors from 'vs/base/common/errors';
import * as objects from 'vs/base/common/objects';
import { DeferredPromise } from 'vs/base/test/common/utils';
import { QueryType, IFileQuery } from 'vs/workbench/services/search/common/search';
import { FileQueryCacheState } from 'vs/workbench/contrib/search/common/cacheState';

suite('FileQueryCacheState', () => {

	test('reuse old cacheKey until new cache is loaded', async function () {

		const cache = new MockCache();

		const first = createCacheState(cache);
		const firstKey = first.cacheKey;
		assert.strictEqual(first.isLoaded, false);
		assert.strictEqual(first.isUpdating, false);

		first.load();
		assert.strictEqual(first.isLoaded, false);
		assert.strictEqual(first.isUpdating, true);

		await cache.loading[firstKey].complete(null);
		assert.strictEqual(first.isLoaded, true);
		assert.strictEqual(first.isUpdating, false);

		const second = createCacheState(cache, first);
		second.load();
		assert.strictEqual(second.isLoaded, true);
		assert.strictEqual(second.isUpdating, true);
		await cache.awaitDisposal(0);
		assert.strictEqual(second.cacheKey, firstKey); // still using old cacheKey

		const secondKey = cache.cacheKeys[1];
		await cache.loading[secondKey].complete(null);
		assert.strictEqual(second.isLoaded, true);
		assert.strictEqual(second.isUpdating, false);
		await cache.awaitDisposal(1);
		assert.strictEqual(second.cacheKey, secondKey);
	});

	test('do not spawn additional load if previous is still loading', async function () {

		const cache = new MockCache();

		const first = createCacheState(cache);
		const firstKey = first.cacheKey;
		first.load();
		assert.strictEqual(first.isLoaded, false);
		assert.strictEqual(first.isUpdating, true);
		assert.strictEqual(Object.keys(cache.loading).length, 1);

		const second = createCacheState(cache, first);
		second.load();
		assert.strictEqual(second.isLoaded, false);
		assert.strictEqual(second.isUpdating, true);
		assert.strictEqual(cache.cacheKeys.length, 2);
		assert.strictEqual(Object.keys(cache.loading).length, 1); // still only one loading
		assert.strictEqual(second.cacheKey, firstKey);

		await cache.loading[firstKey].complete(null);
		assert.strictEqual(second.isLoaded, true);
		assert.strictEqual(second.isUpdating, false);
		await cache.awaitDisposal(0);
	});

	test('do not use previous cacheKey if query changed', async function () {

		const cache = new MockCache();

		const first = createCacheState(cache);
		const firstKey = first.cacheKey;
		first.load();
		await cache.loading[firstKey].complete(null);
		assert.strictEqual(first.isLoaded, true);
		assert.strictEqual(first.isUpdating, false);
		await cache.awaitDisposal(0);

		cache.baseQuery.excludePattern = { '**/node_modules': true };
		const second = createCacheState(cache, first);
		assert.strictEqual(second.isLoaded, false);
		assert.strictEqual(second.isUpdating, false);
		await cache.awaitDisposal(1);

		second.load();
		assert.strictEqual(second.isLoaded, false);
		assert.strictEqual(second.isUpdating, true);
		assert.notStrictEqual(second.cacheKey, firstKey); // not using old cacheKey
		const secondKey = cache.cacheKeys[1];
		assert.strictEqual(second.cacheKey, secondKey);

		await cache.loading[secondKey].complete(null);
		assert.strictEqual(second.isLoaded, true);
		assert.strictEqual(second.isUpdating, false);
		await cache.awaitDisposal(1);
	});

	test('dispose propagates', async function () {

		const cache = new MockCache();

		const first = createCacheState(cache);
		const firstKey = first.cacheKey;
		first.load();
		await cache.loading[firstKey].complete(null);
		const second = createCacheState(cache, first);
		assert.strictEqual(second.isLoaded, true);
		assert.strictEqual(second.isUpdating, false);
		await cache.awaitDisposal(0);

		second.dispose();
		assert.strictEqual(second.isLoaded, false);
		assert.strictEqual(second.isUpdating, false);
		await cache.awaitDisposal(1);
		assert.ok(cache.disposing[firstKey]);
	});

	test('keep using old cacheKey when loading fails', async function () {

		const cache = new MockCache();

		const first = createCacheState(cache);
		const firstKey = first.cacheKey;
		first.load();
		await cache.loading[firstKey].complete(null);

		const second = createCacheState(cache, first);
		second.load();
		const secondKey = cache.cacheKeys[1];
		const origErrorHandler = errors.errorHandler.getUnexpectedErrorHandler();
		try {
			errors.setUnexpectedErrorHandler(() => null);
			await cache.loading[secondKey].error('loading failed');
		} finally {
			errors.setUnexpectedErrorHandler(origErrorHandler);
		}
		assert.strictEqual(second.isLoaded, true);
		assert.strictEqual(second.isUpdating, false);
		assert.strictEqual(Object.keys(cache.loading).length, 2);
		await cache.awaitDisposal(0);
		assert.strictEqual(second.cacheKey, firstKey); // keep using old cacheKey

		const third = createCacheState(cache, second);
		third.load();
		assert.strictEqual(third.isLoaded, true);
		assert.strictEqual(third.isUpdating, true);
		assert.strictEqual(Object.keys(cache.loading).length, 3);
		await cache.awaitDisposal(0);
		assert.strictEqual(third.cacheKey, firstKey);

		const thirdKey = cache.cacheKeys[2];
		await cache.loading[thirdKey].complete(null);
		assert.strictEqual(third.isLoaded, true);
		assert.strictEqual(third.isUpdating, false);
		assert.strictEqual(Object.keys(cache.loading).length, 3);
		await cache.awaitDisposal(2);
		assert.strictEqual(third.cacheKey, thirdKey); // recover with next successful load
	});

	function createCacheState(cache: MockCache, previous?: FileQueryCacheState): FileQueryCacheState {
		return new FileQueryCacheState(
			cacheKey => cache.query(cacheKey),
			query => cache.load(query),
			cacheKey => cache.dispose(cacheKey),
			previous!
		);
	}

	class MockCache {

		public cacheKeys: string[] = [];
		public loading: { [cacheKey: string]: DeferredPromise<any> } = {};
		public disposing: { [cacheKey: string]: DeferredPromise<void> } = {};

		private _awaitDisposal: (() => void)[][] = [];

		public baseQuery: IFileQuery = {
			type: QueryType.File,
			folderQueries: []
		};

		public query(cacheKey: string): IFileQuery {
			this.cacheKeys.push(cacheKey);
			return objects.assign({ cacheKey: cacheKey }, this.baseQuery);
		}

		public load(query: IFileQuery): Promise<any> {
			const promise = new DeferredPromise<any>();
			this.loading[query.cacheKey!] = promise;
			return promise.p;
		}

		public dispose(cacheKey: string): Promise<void> {
			const promise = new DeferredPromise<void>();
			this.disposing[cacheKey] = promise;
			const n = Object.keys(this.disposing).length;
			for (const done of this._awaitDisposal[n] || []) {
				done();
			}
			delete this._awaitDisposal[n];
			return promise.p;
		}

		public awaitDisposal(n: number) {
			return new Promise(resolve => {
				if (n === Object.keys(this.disposing).length) {
					resolve();
				} else {
					(this._awaitDisposal[n] || (this._awaitDisposal[n] = [])).push(resolve);
				}
			});
		}
	}
});
