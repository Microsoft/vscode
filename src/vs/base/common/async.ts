/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import * as errors from 'vs/base/common/errors';
import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';

export function isThenable<T>(obj: any): obj is Promise<T> {
	return obj && typeof (<Promise<any>>obj).then === 'function';
}

export interface CancelablePromise<T> extends Promise<T> {
	cancel(): void;
}

export function createCancelablePromise<T>(callback: (token: CancellationToken) => Promise<T>): CancelablePromise<T> {
	const source = new CancellationTokenSource();

	const thenable = callback(source.token);
	const promise = new Promise<T>((resolve, reject) => {
		source.token.onCancellationRequested(() => {
			reject(errors.canceled());
		});
		Promise.resolve(thenable).then(value => {
			source.dispose();
			resolve(value);
		}, err => {
			source.dispose();
			reject(err);
		});
	});

	return <CancelablePromise<T>>new class {
		cancel() {
			source.cancel();
		}
		then<TResult1 = T, TResult2 = never>(resolve?: ((value: T) => TResult1 | Promise<TResult1>) | undefined | null, reject?: ((reason: any) => TResult2 | Promise<TResult2>) | undefined | null): Promise<TResult1 | TResult2> {
			return promise.then(resolve, reject);
		}
		catch<TResult = never>(reject?: ((reason: any) => TResult | Promise<TResult>) | undefined | null): Promise<T | TResult> {
			return this.then(undefined, reject);
		}
		finally(onfinally?: (() => void) | undefined | null): Promise<T> {
			return promise.finally(onfinally);
		}
	};
}

export function raceCancellation<T>(promise: Promise<T>, token: CancellationToken): Promise<T | undefined>;
export function raceCancellation<T>(promise: Promise<T>, token: CancellationToken, defaultValue: T): Promise<T>;
export function raceCancellation<T>(promise: Promise<T>, token: CancellationToken, defaultValue?: T): Promise<T | undefined> {
	return Promise.race([promise, new Promise<T | undefined>(resolve => token.onCancellationRequested(() => resolve(defaultValue)))]);
}

/**
 * Returns as soon as one of the promises is resolved and cancels remaining promises
 */
export async function raceCancellablePromises<T>(cancellablePromises: CancelablePromise<T>[]): Promise<T> {
	let resolvedPromiseIndex = -1;
	const promises = cancellablePromises.map((promise, index) => promise.then(result => { resolvedPromiseIndex = index; return result; }));
	const result = await Promise.race(promises);
	cancellablePromises.forEach((cancellablePromise, index) => {
		if (index !== resolvedPromiseIndex) {
			cancellablePromise.cancel();
		}
	});
	return result;
}

export function raceTimeout<T>(promise: Promise<T>, timeout: number, onTimeout?: () => void): Promise<T | undefined> {
	let promiseResolve: ((value: T | undefined) => void) | undefined = undefined;

	const timer = setTimeout(() => {
		promiseResolve?.(undefined);
		onTimeout?.();
	}, timeout);

	return Promise.race([
		promise.finally(() => clearTimeout(timer)),
		new Promise<T | undefined>(resolve => promiseResolve = resolve)
	]);
}

export function asPromise<T>(callback: () => T | Thenable<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		const item = callback();
		if (isThenable<T>(item)) {
			item.then(resolve, reject);
		} else {
			resolve(item);
		}
	});
}

export interface ITask<T> {
	(): T;
}

/**
 * A helper to prevent accumulation of sequential async tasks.
 *
 * Imagine a mail man with the sole task of delivering letters. As soon as
 * a letter submitted for delivery, he drives to the destination, delivers it
 * and returns to his base. Imagine that during the trip, N more letters were submitted.
 * When the mail man returns, he picks those N letters and delivers them all in a
 * single trip. Even though N+1 submissions occurred, only 2 deliveries were made.
 *
 * The throttler implements this via the queue() method, by providing it a task
 * factory. Following the example:
 *
 * 		const throttler = new Throttler();
 * 		const letters = [];
 *
 * 		function deliver() {
 * 			const lettersToDeliver = letters;
 * 			letters = [];
 * 			return makeTheTrip(lettersToDeliver);
 * 		}
 *
 * 		function onLetterReceived(l) {
 * 			letters.push(l);
 * 			throttler.queue(deliver);
 * 		}
 */
export class Throttler {

	private activePromise: Promise<any> | null;
	private queuedPromise: Promise<any> | null;
	private queuedPromiseFactory: ITask<Promise<any>> | null;

	constructor() {
		this.activePromise = null;
		this.queuedPromise = null;
		this.queuedPromiseFactory = null;
	}

	queue<T>(promiseFactory: ITask<Promise<T>>): Promise<T> {
		if (this.activePromise) {
			this.queuedPromiseFactory = promiseFactory;

			if (!this.queuedPromise) {
				const onComplete = () => {
					this.queuedPromise = null;

					const result = this.queue(this.queuedPromiseFactory!);
					this.queuedPromiseFactory = null;

					return result;
				};

				this.queuedPromise = new Promise(c => {
					this.activePromise!.then(onComplete, onComplete).then(c);
				});
			}

			return new Promise((c, e) => {
				this.queuedPromise!.then(c, e);
			});
		}

		this.activePromise = promiseFactory();

		return new Promise((resolve, reject) => {
			this.activePromise!.then((result: any) => {
				this.activePromise = null;
				resolve(result);
			}, (err: any) => {
				this.activePromise = null;
				reject(err);
			});
		});
	}
}

export class Sequencer {

	private current: Promise<any> = Promise.resolve(null);

	queue<T>(promiseTask: ITask<Promise<T>>): Promise<T> {
		return this.current = this.current.then(() => promiseTask());
	}
}

export class SequencerByKey<TKey> {

	private promiseMap = new Map<TKey, Promise<any>>();

	queue<T>(key: TKey, promiseTask: ITask<Promise<T>>): Promise<T> {
		const runningPromise = this.promiseMap.get(key) ?? Promise.resolve();
		const newPromise = runningPromise
			.catch(() => { })
			.then(promiseTask)
			.finally(() => {
				if (this.promiseMap.get(key) === newPromise) {
					this.promiseMap.delete(key);
				}
			});
		this.promiseMap.set(key, newPromise);
		return newPromise;
	}
}

/**
 * A helper to delay execution of a task that is being requested often.
 *
 * Following the throttler, now imagine the mail man wants to optimize the number of
 * trips proactively. The trip itself can be long, so he decides not to make the trip
 * as soon as a letter is submitted. Instead he waits a while, in case more
 * letters are submitted. After said waiting period, if no letters were submitted, he
 * decides to make the trip. Imagine that N more letters were submitted after the first
 * one, all within a short period of time between each other. Even though N+1
 * submissions occurred, only 1 delivery was made.
 *
 * The delayer offers this behavior via the trigger() method, into which both the task
 * to be executed and the waiting period (delay) must be passed in as arguments. Following
 * the example:
 *
 * 		const delayer = new Delayer(WAITING_PERIOD);
 * 		const letters = [];
 *
 * 		function letterReceived(l) {
 * 			letters.push(l);
 * 			delayer.trigger(() => { return makeTheTrip(); });
 * 		}
 */
export class Delayer<T> implements IDisposable {

	private timeout: any;
	private completionPromise: Promise<any> | null;
	private doResolve: ((value?: any | Promise<any>) => void) | null;
	private doReject: ((err: any) => void) | null;
	private task: ITask<T | Promise<T>> | null;

	constructor(public defaultDelay: number) {
		this.timeout = null;
		this.completionPromise = null;
		this.doResolve = null;
		this.doReject = null;
		this.task = null;
	}

	trigger(task: ITask<T | Promise<T>>, delay: number = this.defaultDelay): Promise<T> {
		this.task = task;
		this.cancelTimeout();

		if (!this.completionPromise) {
			this.completionPromise = new Promise((c, e) => {
				this.doResolve = c;
				this.doReject = e;
			}).then(() => {
				this.completionPromise = null;
				this.doResolve = null;
				if (this.task) {
					const task = this.task;
					this.task = null;
					return task();
				}
				return undefined;
			});
		}

		this.timeout = setTimeout(() => {
			this.timeout = null;
			if (this.doResolve) {
				this.doResolve(null);
			}
		}, delay);

		return this.completionPromise;
	}

	isTriggered(): boolean {
		return this.timeout !== null;
	}

	cancel(): void {
		this.cancelTimeout();

		if (this.completionPromise) {
			if (this.doReject) {
				this.doReject(errors.canceled());
			}
			this.completionPromise = null;
		}
	}

	private cancelTimeout(): void {
		if (this.timeout !== null) {
			clearTimeout(this.timeout);
			this.timeout = null;
		}
	}

	dispose(): void {
		this.cancelTimeout();
	}
}

/**
 * A helper to delay execution of a task that is being requested often, while
 * preventing accumulation of consecutive executions, while the task runs.
 *
 * The mail man is clever and waits for a certain amount of time, before going
 * out to deliver letters. While the mail man is going out, more letters arrive
 * and can only be delivered once he is back. Once he is back the mail man will
 * do one more trip to deliver the letters that have accumulated while he was out.
 */
export class ThrottledDelayer<T> {

	private delayer: Delayer<Promise<T>>;
	private throttler: Throttler;

	constructor(defaultDelay: number) {
		this.delayer = new Delayer(defaultDelay);
		this.throttler = new Throttler();
	}

	trigger(promiseFactory: ITask<Promise<T>>, delay?: number): Promise<T> {
		return this.delayer.trigger(() => this.throttler.queue(promiseFactory), delay) as any as Promise<T>;
	}

	isTriggered(): boolean {
		return this.delayer.isTriggered();
	}

	cancel(): void {
		this.delayer.cancel();
	}

	dispose(): void {
		this.delayer.dispose();
	}
}

/**
 * A barrier that is initially closed and then becomes opened permanently.
 */
export class Barrier {

	private _isOpen: boolean;
	private _promise: Promise<boolean>;
	private _completePromise!: (v: boolean) => void;

	constructor() {
		this._isOpen = false;
		this._promise = new Promise<boolean>((c, e) => {
			this._completePromise = c;
		});
	}

	isOpen(): boolean {
		return this._isOpen;
	}

	open(): void {
		this._isOpen = true;
		this._completePromise(true);
	}

	wait(): Promise<boolean> {
		return this._promise;
	}
}

export function timeout(millis: number): CancelablePromise<void>;
export function timeout(millis: number, token: CancellationToken): Promise<void>;
export function timeout(millis: number, token?: CancellationToken): CancelablePromise<void> | Promise<void> {
	if (!token) {
		return createCancelablePromise(token => timeout(millis, token));
	}

	return new Promise((resolve, reject) => {
		const handle = setTimeout(resolve, millis);
		token.onCancellationRequested(() => {
			clearTimeout(handle);
			reject(errors.canceled());
		});
	});
}

export function disposableTimeout(handler: () => void, timeout = 0): IDisposable {
	const timer = setTimeout(handler, timeout);
	return toDisposable(() => clearTimeout(timer));
}

export function ignoreErrors<T>(promise: Promise<T>): Promise<T | undefined> {
	return promise.then(undefined, _ => undefined);
}

/**
 * Runs the provided list of promise factories in sequential order. The returned
 * promise will complete to an array of results from each promise.
 */

export function sequence<T>(promiseFactories: ITask<Promise<T>>[]): Promise<T[]> {
	const results: T[] = [];
	let index = 0;
	const len = promiseFactories.length;

	function next(): Promise<T> | null {
		return index < len ? promiseFactories[index++]() : null;
	}

	function thenHandler(result: any): Promise<any> {
		if (result !== undefined && result !== null) {
			results.push(result);
		}

		const n = next();
		if (n) {
			return n.then(thenHandler);
		}

		return Promise.resolve(results);
	}

	return Promise.resolve(null).then(thenHandler);
}

export function first<T>(promiseFactories: ITask<Promise<T>>[], shouldStop: (t: T) => boolean = t => !!t, defaultValue: T | null = null): Promise<T | null> {
	let index = 0;
	const len = promiseFactories.length;

	const loop: () => Promise<T | null> = () => {
		if (index >= len) {
			return Promise.resolve(defaultValue);
		}

		const factory = promiseFactories[index++];
		const promise = Promise.resolve(factory());

		return promise.then(result => {
			if (shouldStop(result)) {
				return Promise.resolve(result);
			}

			return loop();
		});
	};

	return loop();
}

/**
 * Returns the result of the first promise that matches the "shouldStop",
 * running all promises in parallel. Supports cancelable promises.
 */
export function firstParallel<T>(promiseList: Promise<T>[], shouldStop?: (t: T) => boolean, defaultValue?: T | null): Promise<T | null>;
export function firstParallel<T, R extends T>(promiseList: Promise<T>[], shouldStop: (t: T) => t is R, defaultValue?: R | null): Promise<R | null>;
export function firstParallel<T>(promiseList: Promise<T>[], shouldStop: (t: T) => boolean = t => !!t, defaultValue: T | null = null) {
	if (promiseList.length === 0) {
		return Promise.resolve(defaultValue);
	}

	let todo = promiseList.length;
	const finish = () => {
		todo = -1;
		for (const promise of promiseList) {
			(promise as Partial<CancelablePromise<T>>).cancel?.();
		}
	};

	return new Promise<T | null>((resolve, reject) => {
		for (const promise of promiseList) {
			promise.then(result => {
				if (--todo >= 0 && shouldStop(result)) {
					finish();
					resolve(result);
				} else if (todo === 0) {
					resolve(defaultValue);
				}
			})
				.catch(err => {
					if (--todo >= 0) {
						finish();
						reject(err);
					}
				});
		}
	});
}

interface ILimitedTaskFactory<T> {
	factory: ITask<Promise<T>>;
	c: (value: T | Promise<T>) => void;
	e: (error?: any) => void;
}

/**
 * A helper to queue N promises and run them all with a max degree of parallelism. The helper
 * ensures that at any time no more than M promises are running at the same time.
 */
export class Limiter<T> {

	private _size = 0;
	private runningPromises: number;
	private maxDegreeOfParalellism: number;
	private outstandingPromises: ILimitedTaskFactory<T>[];
	private readonly _onFinished: Emitter<void>;

	constructor(maxDegreeOfParalellism: number) {
		this.maxDegreeOfParalellism = maxDegreeOfParalellism;
		this.outstandingPromises = [];
		this.runningPromises = 0;
		this._onFinished = new Emitter<void>();
	}

	get onFinished(): Event<void> {
		return this._onFinished.event;
	}

	get size(): number {
		return this._size;
		// return this.runningPromises + this.outstandingPromises.length;
	}

	queue(factory: ITask<Promise<T>>): Promise<T> {
		this._size++;

		return new Promise<T>((c, e) => {
			this.outstandingPromises.push({ factory, c, e });
			this.consume();
		});
	}

	private consume(): void {
		while (this.outstandingPromises.length && this.runningPromises < this.maxDegreeOfParalellism) {
			const iLimitedTask = this.outstandingPromises.shift()!;
			this.runningPromises++;

			const promise = iLimitedTask.factory();
			promise.then(iLimitedTask.c, iLimitedTask.e);
			promise.then(() => this.consumed(), () => this.consumed());
		}
	}

	private consumed(): void {
		this._size--;
		this.runningPromises--;

		if (this.outstandingPromises.length > 0) {
			this.consume();
		} else {
			this._onFinished.fire();
		}
	}

	dispose(): void {
		this._onFinished.dispose();
	}
}

/**
 * A queue is handles one promise at a time and guarantees that at any time only one promise is executing.
 */
export class Queue<T> extends Limiter<T> {

	constructor() {
		super(1);
	}
}

/**
 * A helper to organize queues per resource. The ResourceQueue makes sure to manage queues per resource
 * by disposing them once the queue is empty.
 */
export class ResourceQueue implements IDisposable {

	private readonly queues = new Map<string, Queue<void>>();

	queueFor(resource: URI): Queue<void> {
		const key = resource.toString();
		if (!this.queues.has(key)) {
			const queue = new Queue<void>();
			queue.onFinished(() => {
				queue.dispose();
				this.queues.delete(key);
			});

			this.queues.set(key, queue);
		}

		return this.queues.get(key)!;
	}

	dispose(): void {
		this.queues.forEach(queue => queue.dispose());
		this.queues.clear();
	}
}

export class TimeoutTimer implements IDisposable {
	private _token: any;

	constructor();
	constructor(runner: () => void, timeout: number);
	constructor(runner?: () => void, timeout?: number) {
		this._token = -1;

		if (typeof runner === 'function' && typeof timeout === 'number') {
			this.setIfNotSet(runner, timeout);
		}
	}

	dispose(): void {
		this.cancel();
	}

	cancel(): void {
		if (this._token !== -1) {
			clearTimeout(this._token);
			this._token = -1;
		}
	}

	cancelAndSet(runner: () => void, timeout: number): void {
		this.cancel();
		this._token = setTimeout(() => {
			this._token = -1;
			runner();
		}, timeout);
	}

	setIfNotSet(runner: () => void, timeout: number): void {
		if (this._token !== -1) {
			// timer is already set
			return;
		}
		this._token = setTimeout(() => {
			this._token = -1;
			runner();
		}, timeout);
	}
}

export class IntervalTimer implements IDisposable {

	private _token: any;

	constructor() {
		this._token = -1;
	}

	dispose(): void {
		this.cancel();
	}

	cancel(): void {
		if (this._token !== -1) {
			clearInterval(this._token);
			this._token = -1;
		}
	}

	cancelAndSet(runner: () => void, interval: number): void {
		this.cancel();
		this._token = setInterval(() => {
			runner();
		}, interval);
	}
}

export class RunOnceScheduler {

	protected runner: ((...args: any[]) => void) | null;

	private timeoutToken: any;
	private timeout: number;
	private timeoutHandler: () => void;

	constructor(runner: (...args: any[]) => void, delay: number) {
		this.timeoutToken = -1;
		this.runner = runner;
		this.timeout = delay;
		this.timeoutHandler = this.onTimeout.bind(this);
	}

	/**
	 * Dispose RunOnceScheduler
	 */
	dispose(): void {
		this.cancel();
		this.runner = null;
	}

	/**
	 * Cancel current scheduled runner (if any).
	 */
	cancel(): void {
		if (this.isScheduled()) {
			clearTimeout(this.timeoutToken);
			this.timeoutToken = -1;
		}
	}

	/**
	 * Cancel previous runner (if any) & schedule a new runner.
	 */
	schedule(delay = this.timeout): void {
		this.cancel();
		this.timeoutToken = setTimeout(this.timeoutHandler, delay);
	}

	get delay(): number {
		return this.timeout;
	}

	set delay(value: number) {
		this.timeout = value;
	}

	/**
	 * Returns true if scheduled.
	 */
	isScheduled(): boolean {
		return this.timeoutToken !== -1;
	}

	private onTimeout() {
		this.timeoutToken = -1;
		if (this.runner) {
			this.doRun();
		}
	}

	protected doRun(): void {
		if (this.runner) {
			this.runner();
		}
	}
}

export class RunOnceWorker<T> extends RunOnceScheduler {
	private units: T[] = [];

	constructor(runner: (units: T[]) => void, timeout: number) {
		super(runner, timeout);
	}

	work(unit: T): void {
		this.units.push(unit);

		if (!this.isScheduled()) {
			this.schedule();
		}
	}

	protected doRun(): void {
		const units = this.units;
		this.units = [];

		if (this.runner) {
			this.runner(units);
		}
	}

	dispose(): void {
		this.units = [];

		super.dispose();
	}
}

//#region -- run on idle tricks ------------

export interface IdleDeadline {
	readonly didTimeout: boolean;
	timeRemaining(): number;
}
/**
 * Execute the callback the next time the browser is idle
 */
export let runWhenIdle: (callback: (idle: IdleDeadline) => void, timeout?: number) => IDisposable;

declare function requestIdleCallback(callback: (args: IdleDeadline) => void, options?: { timeout: number }): number;
declare function cancelIdleCallback(handle: number): void;

(function () {
	if (typeof requestIdleCallback !== 'function' || typeof cancelIdleCallback !== 'function') {
		const dummyIdle: IdleDeadline = Object.freeze({
			didTimeout: true,
			timeRemaining() { return 15; }
		});
		runWhenIdle = (runner) => {
			const handle = setTimeout(() => runner(dummyIdle));
			let disposed = false;
			return {
				dispose() {
					if (disposed) {
						return;
					}
					disposed = true;
					clearTimeout(handle);
				}
			};
		};
	} else {
		runWhenIdle = (runner, timeout?) => {
			const handle: number = requestIdleCallback(runner, typeof timeout === 'number' ? { timeout } : undefined);
			let disposed = false;
			return {
				dispose() {
					if (disposed) {
						return;
					}
					disposed = true;
					cancelIdleCallback(handle);
				}
			};
		};
	}
})();

/**
 * An implementation of the "idle-until-urgent"-strategy as introduced
 * here: https://philipwalton.com/articles/idle-until-urgent/
 */
export class IdleValue<T> {

	private readonly _executor: () => void;
	private readonly _handle: IDisposable;

	private _didRun: boolean = false;
	private _value?: T;
	private _error: any;

	constructor(executor: () => T) {
		this._executor = () => {
			try {
				this._value = executor();
			} catch (err) {
				this._error = err;
			} finally {
				this._didRun = true;
			}
		};
		this._handle = runWhenIdle(() => this._executor());
	}

	dispose(): void {
		this._handle.dispose();
	}

	get value(): T {
		if (!this._didRun) {
			this._handle.dispose();
			this._executor();
		}
		if (this._error) {
			throw this._error;
		}
		return this._value!;
	}
}

//#endregion

export async function retry<T>(task: ITask<Promise<T>>, delay: number, retries: number): Promise<T> {
	let lastError: Error | undefined;

	for (let i = 0; i < retries; i++) {
		try {
			return await task();
		} catch (error) {
			lastError = error;

			await timeout(delay);
		}
	}

	throw lastError;
}

//#region Task Sequentializer

interface IPendingTask {
	taskId: number;
	cancel: () => void;
	promise: Promise<void>;
}

interface ISequentialTask {
	promise: Promise<void>;
	promiseResolve: () => void;
	promiseReject: (error: Error) => void;
	run: () => Promise<void>;
}

export interface ITaskSequentializerWithPendingTask {
	readonly pending: Promise<void>;
}

export class TaskSequentializer {
	private _pending?: IPendingTask;
	private _next?: ISequentialTask;

	hasPending(taskId?: number): this is ITaskSequentializerWithPendingTask {
		if (!this._pending) {
			return false;
		}

		if (typeof taskId === 'number') {
			return this._pending.taskId === taskId;
		}

		return !!this._pending;
	}

	get pending(): Promise<void> | undefined {
		return this._pending ? this._pending.promise : undefined;
	}

	cancelPending(): void {
		this._pending?.cancel();
	}

	setPending(taskId: number, promise: Promise<void>, onCancel?: () => void,): Promise<void> {
		this._pending = { taskId: taskId, cancel: () => onCancel?.(), promise };

		promise.then(() => this.donePending(taskId), () => this.donePending(taskId));

		return promise;
	}

	private donePending(taskId: number): void {
		if (this._pending && taskId === this._pending.taskId) {

			// only set pending to done if the promise finished that is associated with that taskId
			this._pending = undefined;

			// schedule the next task now that we are free if we have any
			this.triggerNext();
		}
	}

	private triggerNext(): void {
		if (this._next) {
			const next = this._next;
			this._next = undefined;

			// Run next task and complete on the associated promise
			next.run().then(next.promiseResolve, next.promiseReject);
		}
	}

	setNext(run: () => Promise<void>): Promise<void> {

		// this is our first next task, so we create associated promise with it
		// so that we can return a promise that completes when the task has
		// completed.
		if (!this._next) {
			let promiseResolve: () => void;
			let promiseReject: (error: Error) => void;
			const promise = new Promise<void>((resolve, reject) => {
				promiseResolve = resolve;
				promiseReject = reject;
			});

			this._next = {
				run,
				promise,
				promiseResolve: promiseResolve!,
				promiseReject: promiseReject!
			};
		}

		// we have a previous next task, just overwrite it
		else {
			this._next.run = run;
		}

		return this._next.promise;
	}
}

//#endregion

//#region

/**
 * The `IntervalCounter` allows to count the number
 * of calls to `increment()` over a duration of
 * `interval`. This utility can be used to conditionally
 * throttle a frequent task when a certain threshold
 * is reached.
 */
export class IntervalCounter {

	private lastIncrementTime = 0;

	private value = 0;

	constructor(private readonly interval: number) { }

	increment(): number {
		const now = Date.now();

		// We are outside of the range of `interval` and as such
		// start counting from 0 and remember the time
		if (now - this.lastIncrementTime > this.interval) {
			this.lastIncrementTime = now;
			this.value = 0;
		}

		this.value++;

		return this.value;
	}
}

//#endregion
