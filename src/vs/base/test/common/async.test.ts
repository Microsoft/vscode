/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import * as async from 'vs/base/common/async';
import { isPromiseCanceledError } from 'vs/base/common/errors';
import { URI } from 'vs/base/common/uri';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';

suite('Async', () => {

	test('cancelablePromise - set token, don\'t wait for inner promise', function () {
		let canceled = 0;
		let promise = async.createCancelablePromise(token => {
			token.onCancellationRequested(_ => { canceled += 1; });
			return new Promise(resolve => { /*never*/ });
		});
		let result = promise.then(_ => assert.ok(false), err => {
			assert.equal(canceled, 1);
			assert.ok(isPromiseCanceledError(err));
		});
		promise.cancel();
		promise.cancel(); // cancel only once
		return result;
	});

	test('cancelablePromise - cancel despite inner promise being resolved', function () {
		let canceled = 0;
		let promise = async.createCancelablePromise(token => {
			token.onCancellationRequested(_ => { canceled += 1; });
			return Promise.resolve(1234);
		});
		let result = promise.then(_ => assert.ok(false), err => {
			assert.equal(canceled, 1);
			assert.ok(isPromiseCanceledError(err));
		});
		promise.cancel();
		return result;
	});

	// Cancelling a sync cancelable promise will fire the cancelled token.
	// Also, every `then` callback runs in another execution frame.
	test('CancelablePromise execution order (sync)', function () {
		const order: string[] = [];

		const cancellablePromise = async.createCancelablePromise(token => {
			order.push('in callback');
			token.onCancellationRequested(_ => order.push('cancelled'));
			return Promise.resolve(1234);
		});

		order.push('afterCreate');

		const promise = cancellablePromise
			.then(undefined, err => null)
			.then(() => order.push('finally'));

		cancellablePromise.cancel();
		order.push('afterCancel');

		return promise.then(() => assert.deepEqual(order, ['in callback', 'afterCreate', 'cancelled', 'afterCancel', 'finally']));
	});

	// Cancelling an async cancelable promise is just the same as a sync cancellable promise.
	test('CancelablePromise execution order (async)', function () {
		const order: string[] = [];

		const cancellablePromise = async.createCancelablePromise(token => {
			order.push('in callback');
			token.onCancellationRequested(_ => order.push('cancelled'));
			return new Promise(c => setTimeout(c.bind(1234), 0));
		});

		order.push('afterCreate');

		const promise = cancellablePromise
			.then(undefined, err => null)
			.then(() => order.push('finally'));

		cancellablePromise.cancel();
		order.push('afterCancel');

		return promise.then(() => assert.deepEqual(order, ['in callback', 'afterCreate', 'cancelled', 'afterCancel', 'finally']));
	});

	test('cancelablePromise - get inner result', async function () {
		let promise = async.createCancelablePromise(token => {
			return async.timeout(12).then(_ => 1234);
		});

		let result = await promise;
		assert.equal(result, 1234);
	});

	test('Throttler - non async', function () {
		let count = 0;
		let factory = () => {
			return Promise.resolve(++count);
		};

		let throttler = new async.Throttler();

		return Promise.all([
			throttler.queue(factory).then((result) => { assert.equal(result, 1); }),
			throttler.queue(factory).then((result) => { assert.equal(result, 2); }),
			throttler.queue(factory).then((result) => { assert.equal(result, 2); }),
			throttler.queue(factory).then((result) => { assert.equal(result, 2); }),
			throttler.queue(factory).then((result) => { assert.equal(result, 2); })
		]).then(() => assert.equal(count, 2));
	});

	test('Throttler', () => {
		let count = 0;
		let factory = () => async.timeout(0).then(() => ++count);

		let throttler = new async.Throttler();

		return Promise.all([
			throttler.queue(factory).then((result) => { assert.equal(result, 1); }),
			throttler.queue(factory).then((result) => { assert.equal(result, 2); }),
			throttler.queue(factory).then((result) => { assert.equal(result, 2); }),
			throttler.queue(factory).then((result) => { assert.equal(result, 2); }),
			throttler.queue(factory).then((result) => { assert.equal(result, 2); })
		]).then(() => {
			return Promise.all([
				throttler.queue(factory).then((result) => { assert.equal(result, 3); }),
				throttler.queue(factory).then((result) => { assert.equal(result, 4); }),
				throttler.queue(factory).then((result) => { assert.equal(result, 4); }),
				throttler.queue(factory).then((result) => { assert.equal(result, 4); }),
				throttler.queue(factory).then((result) => { assert.equal(result, 4); })
			]);
		});
	});

	test('Throttler - last factory should be the one getting called', function () {
		let factoryFactory = (n: number) => () => {
			return async.timeout(0).then(() => n);
		};

		let throttler = new async.Throttler();

		let promises: Promise<any>[] = [];

		promises.push(throttler.queue(factoryFactory(1)).then((n) => { assert.equal(n, 1); }));
		promises.push(throttler.queue(factoryFactory(2)).then((n) => { assert.equal(n, 3); }));
		promises.push(throttler.queue(factoryFactory(3)).then((n) => { assert.equal(n, 3); }));

		return Promise.all(promises);
	});

	test('Delayer', () => {
		let count = 0;
		let factory = () => {
			return Promise.resolve(++count);
		};

		let delayer = new async.Delayer(0);
		let promises: Promise<any>[] = [];

		assert(!delayer.isTriggered());

		promises.push(delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()); }));
		assert(delayer.isTriggered());

		promises.push(delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()); }));
		assert(delayer.isTriggered());

		promises.push(delayer.trigger(factory).then((result) => { assert.equal(result, 1); assert(!delayer.isTriggered()); }));
		assert(delayer.isTriggered());

		return Promise.all(promises).then(() => {
			assert(!delayer.isTriggered());
		});
	});

	test('Delayer - simple cancel', function () {
		let count = 0;
		let factory = () => {
			return Promise.resolve(++count);
		};

		let delayer = new async.Delayer(0);

		assert(!delayer.isTriggered());

		const p = delayer.trigger(factory).then(() => {
			assert(false);
		}, () => {
			assert(true, 'yes, it was cancelled');
		});

		assert(delayer.isTriggered());
		delayer.cancel();
		assert(!delayer.isTriggered());

		return p;
	});

	test('Delayer - cancel should cancel all calls to trigger', function () {
		let count = 0;
		let factory = () => {
			return Promise.resolve(++count);
		};

		let delayer = new async.Delayer(0);
		let promises: Promise<any>[] = [];

		assert(!delayer.isTriggered());

		promises.push(delayer.trigger(factory).then(undefined, () => { assert(true, 'yes, it was cancelled'); }));
		assert(delayer.isTriggered());

		promises.push(delayer.trigger(factory).then(undefined, () => { assert(true, 'yes, it was cancelled'); }));
		assert(delayer.isTriggered());

		promises.push(delayer.trigger(factory).then(undefined, () => { assert(true, 'yes, it was cancelled'); }));
		assert(delayer.isTriggered());

		delayer.cancel();

		return Promise.all(promises).then(() => {
			assert(!delayer.isTriggered());
		});
	});

	test('Delayer - trigger, cancel, then trigger again', function () {
		let count = 0;
		let factory = () => {
			return Promise.resolve(++count);
		};

		let delayer = new async.Delayer(0);
		let promises: Promise<any>[] = [];

		assert(!delayer.isTriggered());

		const p = delayer.trigger(factory).then((result) => {
			assert.equal(result, 1);
			assert(!delayer.isTriggered());

			promises.push(delayer.trigger(factory).then(undefined, () => { assert(true, 'yes, it was cancelled'); }));
			assert(delayer.isTriggered());

			promises.push(delayer.trigger(factory).then(undefined, () => { assert(true, 'yes, it was cancelled'); }));
			assert(delayer.isTriggered());

			delayer.cancel();

			const p = Promise.all(promises).then(() => {
				promises = [];

				assert(!delayer.isTriggered());

				promises.push(delayer.trigger(factory).then(() => { assert.equal(result, 1); assert(!delayer.isTriggered()); }));
				assert(delayer.isTriggered());

				promises.push(delayer.trigger(factory).then(() => { assert.equal(result, 1); assert(!delayer.isTriggered()); }));
				assert(delayer.isTriggered());

				const p = Promise.all(promises).then(() => {
					assert(!delayer.isTriggered());
				});

				assert(delayer.isTriggered());

				return p;
			});

			return p;
		});

		assert(delayer.isTriggered());

		return p;
	});

	test('Delayer - last task should be the one getting called', function () {
		let factoryFactory = (n: number) => () => {
			return Promise.resolve(n);
		};

		let delayer = new async.Delayer(0);
		let promises: Promise<any>[] = [];

		assert(!delayer.isTriggered());

		promises.push(delayer.trigger(factoryFactory(1)).then((n) => { assert.equal(n, 3); }));
		promises.push(delayer.trigger(factoryFactory(2)).then((n) => { assert.equal(n, 3); }));
		promises.push(delayer.trigger(factoryFactory(3)).then((n) => { assert.equal(n, 3); }));

		const p = Promise.all(promises).then(() => {
			assert(!delayer.isTriggered());
		});

		assert(delayer.isTriggered());

		return p;
	});

	test('Sequence', () => {
		let factoryFactory = (n: number) => () => {
			return Promise.resolve(n);
		};

		return async.sequence([
			factoryFactory(1),
			factoryFactory(2),
			factoryFactory(3),
			factoryFactory(4),
			factoryFactory(5),
		]).then((result) => {
			assert.equal(5, result.length);
			assert.equal(1, result[0]);
			assert.equal(2, result[1]);
			assert.equal(3, result[2]);
			assert.equal(4, result[3]);
			assert.equal(5, result[4]);
		});
	});

	test('Limiter - sync', function () {
		let factoryFactory = (n: number) => () => {
			return Promise.resolve(n);
		};

		let limiter = new async.Limiter(1);

		let promises: Promise<any>[] = [];
		[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(n => promises.push(limiter.queue(factoryFactory(n))));

		return Promise.all(promises).then((res) => {
			assert.equal(10, res.length);

			limiter = new async.Limiter(100);

			promises = [];
			[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(n => promises.push(limiter.queue(factoryFactory(n))));

			return Promise.all(promises).then((res) => {
				assert.equal(10, res.length);
			});
		});
	});

	test('Limiter - async', function () {
		let factoryFactory = (n: number) => () => async.timeout(0).then(() => n);

		let limiter = new async.Limiter(1);
		let promises: Promise<any>[] = [];
		[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(n => promises.push(limiter.queue(factoryFactory(n))));

		return Promise.all(promises).then((res) => {
			assert.equal(10, res.length);

			limiter = new async.Limiter(100);

			promises = [];
			[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(n => promises.push(limiter.queue(factoryFactory(n))));

			return Promise.all(promises).then((res) => {
				assert.equal(10, res.length);
			});
		});
	});

	test('Limiter - assert degree of paralellism', function () {
		let activePromises = 0;
		let factoryFactory = (n: number) => () => {
			activePromises++;
			assert(activePromises < 6);
			return async.timeout(0).then(() => { activePromises--; return n; });
		};

		let limiter = new async.Limiter(5);

		let promises: Promise<any>[] = [];
		[0, 1, 2, 3, 4, 5, 6, 7, 8, 9].forEach(n => promises.push(limiter.queue(factoryFactory(n))));

		return Promise.all(promises).then((res) => {
			assert.equal(10, res.length);
			assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], res);
		});
	});

	test('Queue - simple', function () {
		let queue = new async.Queue();

		let syncPromise = false;
		let f1 = () => Promise.resolve(true).then(() => syncPromise = true);

		let asyncPromise = false;
		let f2 = () => async.timeout(10).then(() => asyncPromise = true);

		assert.equal(queue.size, 0);

		queue.queue(f1);
		assert.equal(queue.size, 1);

		const p = queue.queue(f2);
		assert.equal(queue.size, 2);
		return p.then(() => {
			assert.equal(queue.size, 0);
			assert.ok(syncPromise);
			assert.ok(asyncPromise);
		});
	});

	test('Queue - order is kept', function () {
		let queue = new async.Queue();

		let res: number[] = [];

		let f1 = () => Promise.resolve(true).then(() => res.push(1));
		let f2 = () => async.timeout(10).then(() => res.push(2));
		let f3 = () => Promise.resolve(true).then(() => res.push(3));
		let f4 = () => async.timeout(20).then(() => res.push(4));
		let f5 = () => async.timeout(0).then(() => res.push(5));

		queue.queue(f1);
		queue.queue(f2);
		queue.queue(f3);
		queue.queue(f4);
		return queue.queue(f5).then(() => {
			assert.equal(res[0], 1);
			assert.equal(res[1], 2);
			assert.equal(res[2], 3);
			assert.equal(res[3], 4);
			assert.equal(res[4], 5);
		});
	});

	test('Queue - errors bubble individually but not cause stop', function () {
		let queue = new async.Queue();

		let res: number[] = [];
		let error = false;

		let f1 = () => Promise.resolve(true).then(() => res.push(1));
		let f2 = () => async.timeout(10).then(() => res.push(2));
		let f3 = () => Promise.resolve(true).then(() => Promise.reject(new Error('error')));
		let f4 = () => async.timeout(20).then(() => res.push(4));
		let f5 = () => async.timeout(0).then(() => res.push(5));

		queue.queue(f1);
		queue.queue(f2);
		queue.queue(f3).then(undefined, () => error = true);
		queue.queue(f4);
		return queue.queue(f5).then(() => {
			assert.equal(res[0], 1);
			assert.equal(res[1], 2);
			assert.ok(error);
			assert.equal(res[2], 4);
			assert.equal(res[3], 5);
		});
	});

	test('Queue - order is kept (chained)', function () {
		let queue = new async.Queue();

		let res: number[] = [];

		let f1 = () => Promise.resolve(true).then(() => res.push(1));
		let f2 = () => async.timeout(10).then(() => res.push(2));
		let f3 = () => Promise.resolve(true).then(() => res.push(3));
		let f4 = () => async.timeout(20).then(() => res.push(4));
		let f5 = () => async.timeout(0).then(() => res.push(5));

		return queue.queue(f1).then(() => {
			return queue.queue(f2).then(() => {
				return queue.queue(f3).then(() => {
					return queue.queue(f4).then(() => {
						return queue.queue(f5).then(() => {
							assert.equal(res[0], 1);
							assert.equal(res[1], 2);
							assert.equal(res[2], 3);
							assert.equal(res[3], 4);
							assert.equal(res[4], 5);
						});
					});
				});
			});
		});
	});

	test('Queue - events', function (done) {
		let queue = new async.Queue();

		let finished = false;
		queue.onFinished(() => {
			done();
		});

		let res: number[] = [];

		let f1 = () => async.timeout(10).then(() => res.push(2));
		let f2 = () => async.timeout(20).then(() => res.push(4));
		let f3 = () => async.timeout(0).then(() => res.push(5));

		const q1 = queue.queue(f1);
		const q2 = queue.queue(f2);
		queue.queue(f3);

		q1.then(() => {
			assert.ok(!finished);
			q2.then(() => {
				assert.ok(!finished);
			});
		});
	});

	test('ResourceQueue - simple', function () {
		let queue = new async.ResourceQueue();

		const r1Queue = queue.queueFor(URI.file('/some/path'));

		r1Queue.onFinished(() => console.log('DONE'));

		const r2Queue = queue.queueFor(URI.file('/some/other/path'));

		assert.ok(r1Queue);
		assert.ok(r2Queue);
		assert.equal(r1Queue, queue.queueFor(URI.file('/some/path'))); // same queue returned

		let syncPromiseFactory = () => Promise.resolve(undefined);

		r1Queue.queue(syncPromiseFactory);

		return new Promise<void>(c => setTimeout(() => c(), 0)).then(() => {
			const r1Queue2 = queue.queueFor(URI.file('/some/path'));
			assert.notEqual(r1Queue, r1Queue2); // previous one got disposed after finishing
		});
	});

	test('retry - success case', async () => {
		let counter = 0;

		const res = await async.retry(() => {
			counter++;
			if (counter < 2) {
				return Promise.reject(new Error('fail'));
			}

			return Promise.resolve(true);
		}, 10, 3);

		assert.equal(res, true);
	});

	test('retry - error case', async () => {
		let expectedError = new Error('fail');
		try {
			await async.retry(() => {
				return Promise.reject(expectedError);
			}, 10, 3);
		} catch (error) {
			assert.equal(error, error);
		}
	});

	test('TaskSequentializer - pending basics', async function () {
		const sequentializer = new async.TaskSequentializer();

		assert.ok(!sequentializer.hasPending());
		assert.ok(!sequentializer.hasPending(2323));
		assert.ok(!sequentializer.pending);

		// pending removes itself after done
		await sequentializer.setPending(1, Promise.resolve());
		assert.ok(!sequentializer.hasPending());
		assert.ok(!sequentializer.hasPending(1));
		assert.ok(!sequentializer.pending);

		// pending removes itself after done (use async.timeout)
		sequentializer.setPending(2, async.timeout(1));
		assert.ok(sequentializer.hasPending());
		assert.ok(sequentializer.hasPending(2));
		assert.ok(!sequentializer.hasPending(1));
		assert.ok(sequentializer.pending);

		await async.timeout(2);
		assert.ok(!sequentializer.hasPending());
		assert.ok(!sequentializer.hasPending(2));
		assert.ok(!sequentializer.pending);
	});

	test('TaskSequentializer - pending and next (finishes instantly)', async function () {
		const sequentializer = new async.TaskSequentializer();

		let pendingDone = false;
		sequentializer.setPending(1, async.timeout(1).then(() => { pendingDone = true; return; }));

		// next finishes instantly
		let nextDone = false;
		const res = sequentializer.setNext(() => Promise.resolve(null).then(() => { nextDone = true; return; }));

		await res;
		assert.ok(pendingDone);
		assert.ok(nextDone);
	});

	test('TaskSequentializer - pending and next (finishes after timeout)', async function () {
		const sequentializer = new async.TaskSequentializer();

		let pendingDone = false;
		sequentializer.setPending(1, async.timeout(1).then(() => { pendingDone = true; return; }));

		// next finishes after async.timeout
		let nextDone = false;
		const res = sequentializer.setNext(() => async.timeout(1).then(() => { nextDone = true; return; }));

		await res;
		assert.ok(pendingDone);
		assert.ok(nextDone);
	});

	test('TaskSequentializer - pending and multiple next (last one wins)', async function () {
		const sequentializer = new async.TaskSequentializer();

		let pendingDone = false;
		sequentializer.setPending(1, async.timeout(1).then(() => { pendingDone = true; return; }));

		// next finishes after async.timeout
		let firstDone = false;
		let firstRes = sequentializer.setNext(() => async.timeout(2).then(() => { firstDone = true; return; }));

		let secondDone = false;
		let secondRes = sequentializer.setNext(() => async.timeout(3).then(() => { secondDone = true; return; }));

		let thirdDone = false;
		let thirdRes = sequentializer.setNext(() => async.timeout(4).then(() => { thirdDone = true; return; }));

		await Promise.all([firstRes, secondRes, thirdRes]);
		assert.ok(pendingDone);
		assert.ok(!firstDone);
		assert.ok(!secondDone);
		assert.ok(thirdDone);
	});

	test('TaskSequentializer - cancel pending', async function () {
		const sequentializer = new async.TaskSequentializer();

		let pendingCancelled = false;
		sequentializer.setPending(1, async.timeout(1), () => pendingCancelled = true);
		sequentializer.cancelPending();

		assert.ok(pendingCancelled);
	});

	test('raceCancellation', async () => {
		const cts = new CancellationTokenSource();

		let triggered = false;
		const p = async.raceCancellation(async.timeout(100).then(() => triggered = true), cts.token);
		cts.cancel();

		await p;

		assert.ok(!triggered);
	});

	test('raceTimeout', async () => {
		const cts = new CancellationTokenSource();

		// timeout wins
		let timedout = false;
		let triggered = false;

		const p1 = async.raceTimeout(async.timeout(100).then(() => triggered = true), 1, () => timedout = true);
		cts.cancel();

		await p1;

		assert.ok(!triggered);
		assert.equal(timedout, true);

		// promise wins
		timedout = false;

		const p2 = async.raceTimeout(async.timeout(1).then(() => triggered = true), 100, () => timedout = true);
		cts.cancel();

		await p2;

		assert.ok(triggered);
		assert.equal(timedout, false);
	});

	test('SequencerByKey', async () => {
		const s = new async.SequencerByKey<string>();

		const r1 = await s.queue('key1', () => Promise.resolve('hello'));
		assert.equal(r1, 'hello');

		await s.queue('key2', () => Promise.reject(new Error('failed'))).then(() => {
			throw new Error('should not be resolved');
		}, err => {
			// Expected error
			assert.equal(err.message, 'failed');
		});

		// Still works after a queued promise is rejected
		const r3 = await s.queue('key2', () => Promise.resolve('hello'));
		assert.equal(r3, 'hello');
	});

	test('IntervalCounter', async () => {
		const counter = new async.IntervalCounter(10);
		assert.equal(counter.increment(), 1);
		assert.equal(counter.increment(), 2);
		assert.equal(counter.increment(), 3);

		await async.timeout(20);

		assert.equal(counter.increment(), 1);
		assert.equal(counter.increment(), 2);
		assert.equal(counter.increment(), 3);
	});

	test('firstParallel - simple', async () => {
		const a = await async.firstParallel([
			Promise.resolve(1),
			Promise.resolve(2),
			Promise.resolve(3),
		], v => v === 2);
		assert.equal(a, 2);
	});

	test('firstParallel - uses null default', async () => {
		assert.equal(await async.firstParallel([Promise.resolve(1)], v => v === 2), null);
	});

	test('firstParallel - uses value default', async () => {
		assert.equal(await async.firstParallel([Promise.resolve(1)], v => v === 2, 4), 4);
	});

	test('firstParallel - empty', async () => {
		assert.equal(await async.firstParallel([], v => v === 2, 4), 4);
	});

	test('firstParallel - cancels', async () => {
		let ct1: CancellationToken;
		const p1 = async.createCancelablePromise(async (ct) => {
			ct1 = ct;
			await async.timeout(200, ct);
			return 1;
		});
		let ct2: CancellationToken;
		const p2 = async.createCancelablePromise(async (ct) => {
			ct2 = ct;
			await async.timeout(2, ct);
			return 2;
		});

		assert.equal(await async.firstParallel([p1, p2], v => v === 2, 4), 2);
		assert.equal(ct1!.isCancellationRequested, true, 'should cancel a');
		assert.equal(ct2!.isCancellationRequested, true, 'should cancel b');
	});

	test('firstParallel - rejection handling', async () => {
		let ct1: CancellationToken;
		const p1 = async.createCancelablePromise(async (ct) => {
			ct1 = ct;
			await async.timeout(200, ct);
			return 1;
		});
		let ct2: CancellationToken;
		const p2 = async.createCancelablePromise(async (ct) => {
			ct2 = ct;
			await async.timeout(2, ct);
			throw new Error('oh no');
		});

		assert.equal(await async.firstParallel([p1, p2], v => v === 2, 4).catch(() => 'ok'), 'ok');
		assert.equal(ct1!.isCancellationRequested, true, 'should cancel a');
		assert.equal(ct2!.isCancellationRequested, true, 'should cancel b');
	});
});
