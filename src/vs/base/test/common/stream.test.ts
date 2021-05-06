/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { isReadableStream, newWriteableStream, Readable, consumeReadable, peekReadable, consumeStream, ReadableStream, toStream, toReadable, transform, peekStream, isReadableBufferedStream, listenStream, prefixedReadable, prefixedStream } from 'vs/base/common/stream';
import { timeout } from 'vs/base/common/async';

suite('Stream', () => {

	test('isReadableStream', () => {
		assert.ok(!isReadableStream(Object.create(null)));
		assert.ok(isReadableStream(newWriteableStream(d => d)));
	});

	test('isReadableBufferedStream', async () => {
		assert.ok(!isReadableBufferedStream(Object.create(null)));

		const stream = newWriteableStream(d => d);
		stream.end();
		const bufferedStream = await peekStream(stream, 1);
		assert.ok(isReadableBufferedStream(bufferedStream));
	});

	test('WriteableStream - basics', () => {
		const stream = newWriteableStream<string>(strings => strings.join());

		let error = false;
		stream.on('error', e => {
			error = true;
		});

		let end = false;
		stream.on('end', () => {
			end = true;
		});

		stream.write('Hello');

		const chunks: string[] = [];
		stream.on('data', data => {
			chunks.push(data);
		});

		assert.strictEqual(chunks[0], 'Hello');

		stream.write('World');
		assert.strictEqual(chunks[1], 'World');

		assert.strictEqual(error, false);
		assert.strictEqual(end, false);

		stream.pause();
		stream.write('1');
		stream.write('2');
		stream.write('3');

		assert.strictEqual(chunks.length, 2);

		stream.resume();

		assert.strictEqual(chunks.length, 3);
		assert.strictEqual(chunks[2], '1,2,3');

		stream.error(new Error());
		assert.strictEqual(error, true);

		error = false;
		stream.error(new Error());
		assert.strictEqual(error, true);

		stream.end('Final Bit');
		assert.strictEqual(chunks.length, 4);
		assert.strictEqual(chunks[3], 'Final Bit');
		assert.strictEqual(end, true);

		stream.destroy();

		stream.write('Unexpected');
		assert.strictEqual(chunks.length, 4);
	});

	test('WriteableStream - end with empty string works', async () => {
		const reducer = (strings: string[]) => strings.length > 0 ? strings.join() : 'error';
		const stream = newWriteableStream<string>(reducer);
		stream.end('');

		const result = await consumeStream(stream, reducer);
		assert.strictEqual(result, '');
	});

	test('WriteableStream - end with error works', async () => {
		const reducer = (errors: Error[]) => errors.length > 0 ? errors[0] : null as unknown as Error;
		const stream = newWriteableStream<Error>(reducer);
		stream.end(new Error('error'));

		const result = await consumeStream(stream, reducer);
		assert.ok(result instanceof Error);
	});

	test('WriteableStream - removeListener', () => {
		const stream = newWriteableStream<string>(strings => strings.join());

		let error = false;
		const errorListener = (e: Error) => {
			error = true;
		};
		stream.on('error', errorListener);

		let data = false;
		const dataListener = () => {
			data = true;
		};
		stream.on('data', dataListener);

		stream.write('Hello');
		assert.strictEqual(data, true);

		data = false;
		stream.removeListener('data', dataListener);

		stream.write('World');
		assert.strictEqual(data, false);

		stream.error(new Error());
		assert.strictEqual(error, true);

		error = false;
		stream.removeListener('error', errorListener);

		// always leave at least one error listener to streams to avoid unexpected errors during test running
		stream.on('error', () => { });
		stream.error(new Error());
		assert.strictEqual(error, false);
	});

	test('WriteableStream - highWaterMark', async () => {
		const stream = newWriteableStream<string>(strings => strings.join(), { highWaterMark: 3 });

		let res = stream.write('1');
		assert.ok(!res);

		res = stream.write('2');
		assert.ok(!res);

		res = stream.write('3');
		assert.ok(!res);

		let promise1 = stream.write('4');
		assert.ok(promise1 instanceof Promise);

		let promise2 = stream.write('5');
		assert.ok(promise2 instanceof Promise);

		let drained1 = false;
		(async () => {
			await promise1;
			drained1 = true;
		})();

		let drained2 = false;
		(async () => {
			await promise2;
			drained2 = true;
		})();

		let data: string | undefined = undefined;
		stream.on('data', chunk => {
			data = chunk;
		});
		assert.ok(data);

		await timeout(0);
		assert.strictEqual(drained1, true);
		assert.strictEqual(drained2, true);
	});

	test('consumeReadable', () => {
		const readable = arrayToReadable(['1', '2', '3', '4', '5']);
		const consumed = consumeReadable(readable, strings => strings.join());
		assert.strictEqual(consumed, '1,2,3,4,5');
	});

	test('peekReadable', () => {
		for (let i = 0; i < 5; i++) {
			const readable = arrayToReadable(['1', '2', '3', '4', '5']);

			const consumedOrReadable = peekReadable(readable, strings => strings.join(), i);
			if (typeof consumedOrReadable === 'string') {
				assert.fail('Unexpected result');
			} else {
				const consumed = consumeReadable(consumedOrReadable, strings => strings.join());
				assert.strictEqual(consumed, '1,2,3,4,5');
			}
		}

		let readable = arrayToReadable(['1', '2', '3', '4', '5']);
		let consumedOrReadable = peekReadable(readable, strings => strings.join(), 5);
		assert.strictEqual(consumedOrReadable, '1,2,3,4,5');

		readable = arrayToReadable(['1', '2', '3', '4', '5']);
		consumedOrReadable = peekReadable(readable, strings => strings.join(), 6);
		assert.strictEqual(consumedOrReadable, '1,2,3,4,5');
	});

	test('peekReadable - error handling', async () => {

		// 0 Chunks
		let stream = newWriteableStream(data => data);

		let error: Error | undefined = undefined;
		let promise = (async () => {
			try {
				await peekStream(stream, 1);
			} catch (err) {
				error = err;
			}
		})();

		stream.error(new Error());
		await promise;

		assert.ok(error);

		// 1 Chunk
		stream = newWriteableStream(data => data);

		error = undefined;
		promise = (async () => {
			try {
				await peekStream(stream, 1);
			} catch (err) {
				error = err;
			}
		})();

		stream.write('foo');
		stream.error(new Error());
		await promise;

		assert.ok(error);

		// 2 Chunks
		stream = newWriteableStream(data => data);

		error = undefined;
		promise = (async () => {
			try {
				await peekStream(stream, 1);
			} catch (err) {
				error = err;
			}
		})();

		stream.write('foo');
		stream.write('bar');
		stream.error(new Error());
		await promise;

		assert.ok(!error);

		stream.on('error', err => error = err);
		stream.on('data', chunk => { });
		assert.ok(error);
	});

	function arrayToReadable<T>(array: T[]): Readable<T> {
		return {
			read: () => array.shift() || null
		};
	}

	function readableToStream(readable: Readable<string>): ReadableStream<string> {
		const stream = newWriteableStream<string>(strings => strings.join());

		// Simulate async behavior
		setTimeout(() => {
			let chunk: string | null = null;
			while ((chunk = readable.read()) !== null) {
				stream.write(chunk);
			}

			stream.end();
		}, 0);

		return stream;
	}

	test('consumeStream', async () => {
		const stream = readableToStream(arrayToReadable(['1', '2', '3', '4', '5']));
		const consumed = await consumeStream(stream, strings => strings.join());
		assert.strictEqual(consumed, '1,2,3,4,5');
	});

	test('consumeStream - without reducer', async () => {
		const stream = readableToStream(arrayToReadable(['1', '2', '3', '4', '5']));
		const consumed = await consumeStream(stream);
		assert.strictEqual(consumed, undefined);
	});

	test('consumeStream - without reducer and error', async () => {
		const stream = newWriteableStream<string>(strings => strings.join());
		stream.error(new Error());

		const consumed = await consumeStream(stream);
		assert.strictEqual(consumed, undefined);
	});

	test('listenStream', () => {
		const stream = newWriteableStream<string>(strings => strings.join());

		let error = false;
		let end = false;
		let data = '';

		listenStream(stream, {
			onData: d => {
				data = d;
			},
			onError: e => {
				error = true;
			},
			onEnd: () => {
				end = true;
			}
		});

		stream.write('Hello');

		assert.strictEqual(data, 'Hello');

		stream.write('World');
		assert.strictEqual(data, 'World');

		assert.strictEqual(error, false);
		assert.strictEqual(end, false);

		stream.error(new Error());
		assert.strictEqual(error, true);

		stream.end('Final Bit');
		assert.strictEqual(end, true);
	});

	test('peekStream', async () => {
		for (let i = 0; i < 5; i++) {
			const stream = readableToStream(arrayToReadable(['1', '2', '3', '4', '5']));

			const result = await peekStream(stream, i);
			assert.strictEqual(stream, result.stream);
			if (result.ended) {
				assert.fail('Unexpected result, stream should not have ended yet');
			} else {
				assert.strictEqual(result.buffer.length, i + 1, `maxChunks: ${i}`);

				const additionalResult: string[] = [];
				await consumeStream(stream, strings => {
					additionalResult.push(...strings);

					return strings.join();
				});

				assert.strictEqual([...result.buffer, ...additionalResult].join(), '1,2,3,4,5');
			}
		}

		let stream = readableToStream(arrayToReadable(['1', '2', '3', '4', '5']));
		let result = await peekStream(stream, 5);
		assert.strictEqual(stream, result.stream);
		assert.strictEqual(result.buffer.join(), '1,2,3,4,5');
		assert.strictEqual(result.ended, true);

		stream = readableToStream(arrayToReadable(['1', '2', '3', '4', '5']));
		result = await peekStream(stream, 6);
		assert.strictEqual(stream, result.stream);
		assert.strictEqual(result.buffer.join(), '1,2,3,4,5');
		assert.strictEqual(result.ended, true);
	});

	test('toStream', async () => {
		const stream = toStream('1,2,3,4,5', strings => strings.join());
		const consumed = await consumeStream(stream, strings => strings.join());
		assert.strictEqual(consumed, '1,2,3,4,5');
	});

	test('toReadable', async () => {
		const readable = toReadable('1,2,3,4,5');
		const consumed = consumeReadable(readable, strings => strings.join());
		assert.strictEqual(consumed, '1,2,3,4,5');
	});

	test('transform', async () => {
		const source = newWriteableStream<string>(strings => strings.join());

		const result = transform(source, { data: string => string + string }, strings => strings.join());

		// Simulate async behavior
		setTimeout(() => {
			source.write('1');
			source.write('2');
			source.write('3');
			source.write('4');
			source.end('5');
		}, 0);

		const consumed = await consumeStream(result, strings => strings.join());
		assert.strictEqual(consumed, '11,22,33,44,55');
	});

	test('events are delivered even if a listener is removed during delivery', () => {
		const stream = newWriteableStream<string>(strings => strings.join());

		let listener1Called = false;
		let listener2Called = false;

		const listener1 = () => { stream.removeListener('end', listener1); listener1Called = true; };
		const listener2 = () => { listener2Called = true; };
		stream.on('end', listener1);
		stream.on('end', listener2);
		stream.on('data', () => { });
		stream.end('');

		assert.strictEqual(listener1Called, true);
		assert.strictEqual(listener2Called, true);
	});

	test('prefixedReadable', () => {

		// Basic
		let readable = prefixedReadable('1,2', arrayToReadable(['3', '4', '5']), val => val.join(','));
		assert.strictEqual(consumeReadable(readable, val => val.join(',')), '1,2,3,4,5');

		// Empty
		readable = prefixedReadable('empty', arrayToReadable<string>([]), val => val.join(','));
		assert.strictEqual(consumeReadable(readable, val => val.join(',')), 'empty');
	});

	test('prefixedStream', async () => {

		// Basic
		let stream = newWriteableStream<string>(strings => strings.join());
		stream.write('3');
		stream.write('4');
		stream.write('5');
		stream.end();

		let prefixStream = prefixedStream<string>('1,2', stream, val => val.join(','));
		assert.strictEqual(await consumeStream(prefixStream, val => val.join(',')), '1,2,3,4,5');

		// Empty
		stream = newWriteableStream<string>(strings => strings.join());
		stream.end();

		prefixStream = prefixedStream<string>('1,2', stream, val => val.join(','));
		assert.strictEqual(await consumeStream(prefixStream, val => val.join(',')), '1,2');

		// Error
		stream = newWriteableStream<string>(strings => strings.join());
		stream.error(new Error('fail'));

		prefixStream = prefixedStream<string>('error', stream, val => val.join(','));

		let error;
		try {
			await consumeStream(prefixStream, val => val.join(','));
		} catch (e) {
			error = e;
		}
		assert.ok(error);
	});
});
