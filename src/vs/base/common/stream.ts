/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DisposableStore, toDisposable } from 'vs/base/common/lifecycle';

/**
 * The payload that flows in readable stream events.
 */
export type ReadableStreamEventPayload<T> = T | Error | 'end';

export interface ReadableStreamEvents<T> {

	/**
	 * The 'data' event is emitted whenever the stream is
	 * relinquishing ownership of a chunk of data to a consumer.
	 */
	on(event: 'data', callback: (data: T) => void): void;

	/**
	 * Emitted when any error occurs.
	 */
	on(event: 'error', callback: (err: Error) => void): void;

	/**
	 * The 'end' event is emitted when there is no more data
	 * to be consumed from the stream. The 'end' event will
	 * not be emitted unless the data is completely consumed.
	 */
	on(event: 'end', callback: () => void): void;
}

/**
 * A interface that emulates the API shape of a node.js readable
 * stream for use in desktop and web environments.
 */
export interface ReadableStream<T> extends ReadableStreamEvents<T> {

	/**
	 * Stops emitting any events until resume() is called.
	 */
	pause(): void;

	/**
	 * Starts emitting events again after pause() was called.
	 */
	resume(): void;

	/**
	 * Destroys the stream and stops emitting any event.
	 */
	destroy(): void;

	/**
	 * Allows to remove a listener that was previously added.
	 */
	removeListener(event: string, callback: Function): void;
}

/**
 * A interface that emulates the API shape of a node.js readable
 * for use in desktop and web environments.
 */
export interface Readable<T> {

	/**
	 * Read data from the underlying source. Will return
	 * null to indicate that no more data can be read.
	 */
	read(): T | null;
}

/**
 * A interface that emulates the API shape of a node.js writeable
 * stream for use in desktop and web environments.
 */
export interface WriteableStream<T> extends ReadableStream<T> {

	/**
	 * Writing data to the stream will trigger the on('data')
	 * event listener if the stream is flowing and buffer the
	 * data otherwise until the stream is flowing.
	 *
	 * If a `highWaterMark` is configured and writing to the
	 * stream reaches this mark, a promise will be returned
	 * that should be awaited on before writing more data.
	 * Otherwise there is a risk of buffering a large number
	 * of data chunks without consumer.
	 */
	write(data: T): void | Promise<void>;

	/**
	 * Signals an error to the consumer of the stream via the
	 * on('error') handler if the stream is flowing.
	 */
	error(error: Error): void;

	/**
	 * Signals the end of the stream to the consumer. If the
	 * result is not an error, will trigger the on('data') event
	 * listener if the stream is flowing and buffer the data
	 * otherwise until the stream is flowing.
	 *
	 * In case of an error, the on('error') event will be used
	 * if the stream is flowing.
	 */
	end(result?: T | Error): void;
}

/**
 * A stream that has a buffer already read. Returns the original stream
 * that was read as well as the chunks that got read.
 *
 * The `ended` flag indicates if the stream has been fully consumed.
 */
export interface ReadableBufferedStream<T> {

	/**
	 * The original stream that is being read.
	 */
	stream: ReadableStream<T>;

	/**
	 * An array of chunks already read from this stream.
	 */
	buffer: T[];

	/**
	 * Signals if the stream has ended or not. If not, consumers
	 * should continue to read from the stream until consumed.
	 */
	ended: boolean;
}

export function isReadableStream<T>(obj: unknown): obj is ReadableStream<T> {
	const candidate = obj as ReadableStream<T>;

	return candidate && [candidate.on, candidate.pause, candidate.resume, candidate.destroy].every(fn => typeof fn === 'function');
}

export function isReadableBufferedStream<T>(obj: unknown): obj is ReadableBufferedStream<T> {
	const candidate = obj as ReadableBufferedStream<T>;

	return candidate && isReadableStream(candidate.stream) && Array.isArray(candidate.buffer) && typeof candidate.ended === 'boolean';
}

export interface IReducer<T> {
	(data: T[]): T;
}

export interface IDataTransformer<Original, Transformed> {
	(data: Original): Transformed;
}

export interface IErrorTransformer {
	(error: Error): Error;
}

export interface ITransformer<Original, Transformed> {
	data: IDataTransformer<Original, Transformed>;
	error?: IErrorTransformer;
}

export function newWriteableStream<T>(reducer: IReducer<T>, options?: WriteableStreamOptions): WriteableStream<T> {
	return new WriteableStreamImpl<T>(reducer, options);
}

export interface WriteableStreamOptions {

	/**
	 * The number of objects to buffer before WriteableStream#write()
	 * signals back that the buffer is full. Can be used to reduce
	 * the memory pressure when the stream is not flowing.
	 */
	highWaterMark?: number;
}

class WriteableStreamImpl<T> implements WriteableStream<T> {

	private readonly state = {
		flowing: false,
		ended: false,
		destroyed: false
	};

	private readonly buffer = {
		data: [] as T[],
		error: [] as Error[]
	};

	private readonly listeners = {
		data: [] as { (data: T): void }[],
		error: [] as { (error: Error): void }[],
		end: [] as { (): void }[]
	};

	private readonly pendingWritePromises: Function[] = [];

	constructor(private reducer: IReducer<T>, private options?: WriteableStreamOptions) { }

	pause(): void {
		if (this.state.destroyed) {
			return;
		}

		this.state.flowing = false;
	}

	resume(): void {
		if (this.state.destroyed) {
			return;
		}

		if (!this.state.flowing) {
			this.state.flowing = true;

			// emit buffered events
			this.flowData();
			this.flowErrors();
			this.flowEnd();
		}
	}

	write(data: T): void | Promise<void> {
		if (this.state.destroyed) {
			return;
		}

		// flowing: directly send the data to listeners
		if (this.state.flowing) {
			this.listeners.data.forEach(listener => listener(data));
		}

		// not yet flowing: buffer data until flowing
		else {
			this.buffer.data.push(data);

			// highWaterMark: if configured, signal back when buffer reached limits
			if (typeof this.options?.highWaterMark === 'number' && this.buffer.data.length > this.options.highWaterMark) {
				return new Promise(resolve => this.pendingWritePromises.push(resolve));
			}
		}
	}

	error(error: Error): void {
		if (this.state.destroyed) {
			return;
		}

		// flowing: directly send the error to listeners
		if (this.state.flowing) {
			this.listeners.error.forEach(listener => listener(error));
		}

		// not yet flowing: buffer errors until flowing
		else {
			this.buffer.error.push(error);
		}
	}

	end(result?: T | Error): void {
		if (this.state.destroyed) {
			return;
		}

		// end with data or error if provided
		if (result instanceof Error) {
			this.error(result);
		} else if (result) {
			this.write(result);
		}

		// flowing: send end event to listeners
		if (this.state.flowing) {
			this.listeners.end.forEach(listener => listener());

			this.destroy();
		}

		// not yet flowing: remember state
		else {
			this.state.ended = true;
		}
	}

	on(event: 'data', callback: (data: T) => void): void;
	on(event: 'error', callback: (err: Error) => void): void;
	on(event: 'end', callback: () => void): void;
	on(event: 'data' | 'error' | 'end', callback: (arg0?: any) => void): void {
		if (this.state.destroyed) {
			return;
		}

		switch (event) {
			case 'data':
				this.listeners.data.push(callback);

				// switch into flowing mode as soon as the first 'data'
				// listener is added and we are not yet in flowing mode
				this.resume();

				break;

			case 'end':
				this.listeners.end.push(callback);

				// emit 'end' event directly if we are flowing
				// and the end has already been reached
				//
				// finish() when it went through
				if (this.state.flowing && this.flowEnd()) {
					this.destroy();
				}

				break;

			case 'error':
				this.listeners.error.push(callback);

				// emit buffered 'error' events unless done already
				// now that we know that we have at least one listener
				if (this.state.flowing) {
					this.flowErrors();
				}

				break;
		}
	}

	removeListener(event: string, callback: Function): void {
		if (this.state.destroyed) {
			return;
		}

		let listeners: unknown[] | undefined = undefined;

		switch (event) {
			case 'data':
				listeners = this.listeners.data;
				break;

			case 'end':
				listeners = this.listeners.end;
				break;

			case 'error':
				listeners = this.listeners.error;
				break;
		}

		if (listeners) {
			const index = listeners.indexOf(callback);
			if (index >= 0) {
				listeners.splice(index, 1);
			}
		}
	}

	private flowData(): void {
		if (this.buffer.data.length > 0) {
			const fullDataBuffer = this.reducer(this.buffer.data);

			this.listeners.data.forEach(listener => listener(fullDataBuffer));

			this.buffer.data.length = 0;

			// When the buffer is empty, resolve all pending writers
			const pendingWritePromises = [...this.pendingWritePromises];
			this.pendingWritePromises.length = 0;
			pendingWritePromises.forEach(pendingWritePromise => pendingWritePromise());
		}
	}

	private flowErrors(): void {
		if (this.listeners.error.length > 0) {
			for (const error of this.buffer.error) {
				this.listeners.error.forEach(listener => listener(error));
			}

			this.buffer.error.length = 0;
		}
	}

	private flowEnd(): boolean {
		if (this.state.ended) {
			this.listeners.end.forEach(listener => listener());

			return this.listeners.end.length > 0;
		}

		return false;
	}

	destroy(): void {
		if (!this.state.destroyed) {
			this.state.destroyed = true;
			this.state.ended = true;

			this.buffer.data.length = 0;
			this.buffer.error.length = 0;

			this.listeners.data.length = 0;
			this.listeners.error.length = 0;
			this.listeners.end.length = 0;

			this.pendingWritePromises.length = 0;
		}
	}
}

/**
 * Helper to fully read a T readable into a T.
 */
export function consumeReadable<T>(readable: Readable<T>, reducer: IReducer<T>): T {
	const chunks: T[] = [];

	let chunk: T | null;
	while ((chunk = readable.read()) !== null) {
		chunks.push(chunk);
	}

	return reducer(chunks);
}

/**
 * Helper to read a T readable up to a maximum of chunks. If the limit is
 * reached, will return a readable instead to ensure all data can still
 * be read.
 */
export function peekReadable<T>(readable: Readable<T>, reducer: IReducer<T>, maxChunks: number): T | Readable<T> {
	const chunks: T[] = [];

	let chunk: T | null | undefined = undefined;
	while ((chunk = readable.read()) !== null && chunks.length < maxChunks) {
		chunks.push(chunk);
	}

	// If the last chunk is null, it means we reached the end of
	// the readable and return all the data at once
	if (chunk === null && chunks.length > 0) {
		return reducer(chunks);
	}

	// Otherwise, we still have a chunk, it means we reached the maxChunks
	// value and as such we return a new Readable that first returns
	// the existing read chunks and then continues with reading from
	// the underlying readable.
	return {
		read: () => {

			// First consume chunks from our array
			if (chunks.length > 0) {
				return chunks.shift()!;
			}

			// Then ensure to return our last read chunk
			if (typeof chunk !== 'undefined') {
				const lastReadChunk = chunk;

				// explicitly use undefined here to indicate that we consumed
				// the chunk, which could have either been null or valued.
				chunk = undefined;

				return lastReadChunk;
			}

			// Finally delegate back to the Readable
			return readable.read();
		}
	};
}

/**
 * Helper to fully read a T stream into a T.
 */
export function consumeStream<T>(stream: ReadableStreamEvents<T>, reducer: IReducer<T>): Promise<T> {
	return new Promise((resolve, reject) => {
		const chunks: T[] = [];

		stream.on('data', data => chunks.push(data));
		stream.on('error', error => reject(error));
		stream.on('end', () => resolve(reducer(chunks)));
	});
}

/**
 * Helper to peek up to `maxChunks` into a stream. The return type signals if
 * the stream has ended or not. If not, caller needs to add a `data` listener
 * to continue reading.
 */
export function peekStream<T>(stream: ReadableStream<T>, maxChunks: number): Promise<ReadableBufferedStream<T>> {
	return new Promise((resolve, reject) => {
		const streamListeners = new DisposableStore();

		// Data Listener
		const buffer: T[] = [];
		const dataListener = (chunk: T) => {

			// Add to buffer
			buffer.push(chunk);

			// We reached maxChunks and thus need to return
			if (buffer.length > maxChunks) {

				// Dispose any listeners and ensure to pause the
				// stream so that it can be consumed again by caller
				streamListeners.dispose();
				stream.pause();

				return resolve({ stream, buffer, ended: false });
			}
		};

		streamListeners.add(toDisposable(() => stream.removeListener('data', dataListener)));
		stream.on('data', dataListener);

		// Error Listener
		const errorListener = (error: Error) => {
			return reject(error);
		};

		streamListeners.add(toDisposable(() => stream.removeListener('error', errorListener)));
		stream.on('error', errorListener);

		const endListener = () => {
			return resolve({ stream, buffer, ended: true });
		};

		streamListeners.add(toDisposable(() => stream.removeListener('end', endListener)));
		stream.on('end', endListener);
	});
}

/**
 * Helper to create a readable stream from an existing T.
 */
export function toStream<T>(t: T, reducer: IReducer<T>): ReadableStream<T> {
	const stream = newWriteableStream<T>(reducer);

	stream.end(t);

	return stream;
}

/**
 * Helper to convert a T into a Readable<T>.
 */
export function toReadable<T>(t: T): Readable<T> {
	let consumed = false;

	return {
		read: () => {
			if (consumed) {
				return null;
			}

			consumed = true;

			return t;
		}
	};
}

/**
 * Helper to transform a readable stream into another stream.
 */
export function transform<Original, Transformed>(stream: ReadableStreamEvents<Original>, transformer: ITransformer<Original, Transformed>, reducer: IReducer<Transformed>): ReadableStream<Transformed> {
	const target = newWriteableStream<Transformed>(reducer);

	stream.on('data', data => target.write(transformer.data(data)));
	stream.on('end', () => target.end());
	stream.on('error', error => target.error(transformer.error ? transformer.error(error) : error));

	return target;
}
