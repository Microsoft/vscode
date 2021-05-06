/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Disposable, EventEmitter } from 'vscode';
import { dirname, sep } from 'path';
import { Readable } from 'stream';
import { promises as fs, createReadStream } from 'fs';
import * as byline from 'byline';

export function log(...args: any[]): void {
	console.log.apply(console, ['git:', ...args]);
}

export interface IDisposable {
	dispose(): void;
}

export function dispose<T extends IDisposable>(disposables: T[]): T[] {
	disposables.forEach(d => d.dispose());
	return [];
}

export function toDisposable(dispose: () => void): IDisposable {
	return { dispose };
}

export function combinedDisposable(disposables: IDisposable[]): IDisposable {
	return toDisposable(() => dispose(disposables));
}

export const EmptyDisposable = toDisposable(() => null);

export function fireEvent<T>(event: Event<T>): Event<T> {
	return (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => event(_ => (listener as any).call(thisArgs), null, disposables);
}

export function mapEvent<I, O>(event: Event<I>, map: (i: I) => O): Event<O> {
	return (listener: (e: O) => any, thisArgs?: any, disposables?: Disposable[]) => event(i => listener.call(thisArgs, map(i)), null, disposables);
}

export function filterEvent<T>(event: Event<T>, filter: (e: T) => boolean): Event<T> {
	return (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => event(e => filter(e) && listener.call(thisArgs, e), null, disposables);
}

export function anyEvent<T>(...events: Event<T>[]): Event<T> {
	return (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => {
		const result = combinedDisposable(events.map(event => event(i => listener.call(thisArgs, i))));

		if (disposables) {
			disposables.push(result);
		}

		return result;
	};
}

export function done<T>(promise: Promise<T>): Promise<void> {
	return promise.then<void>(() => undefined);
}

export function onceEvent<T>(event: Event<T>): Event<T> {
	return (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => {
		const result = event(e => {
			result.dispose();
			return listener.call(thisArgs, e);
		}, null, disposables);

		return result;
	};
}

export function debounceEvent<T>(event: Event<T>, delay: number): Event<T> {
	return (listener: (e: T) => any, thisArgs?: any, disposables?: Disposable[]) => {
		let timer: NodeJS.Timer;
		return event(e => {
			clearTimeout(timer);
			timer = setTimeout(() => listener.call(thisArgs, e), delay);
		}, null, disposables);
	};
}

export function eventToPromise<T>(event: Event<T>): Promise<T> {
	return new Promise<T>(c => onceEvent(event)(c));
}

export function once(fn: (...args: any[]) => any): (...args: any[]) => any {
	let didRun = false;

	return (...args) => {
		if (didRun) {
			return;
		}

		return fn(...args);
	};
}

export function assign<T>(destination: T, ...sources: any[]): T {
	for (const source of sources) {
		Object.keys(source).forEach(key => (destination as any)[key] = source[key]);
	}

	return destination;
}

export function uniqBy<T>(arr: T[], fn: (el: T) => string): T[] {
	const seen = Object.create(null);

	return arr.filter(el => {
		const key = fn(el);

		if (seen[key]) {
			return false;
		}

		seen[key] = true;
		return true;
	});
}

export function groupBy<T>(arr: T[], fn: (el: T) => string): { [key: string]: T[] } {
	return arr.reduce((result, el) => {
		const key = fn(el);
		result[key] = [...(result[key] || []), el];
		return result;
	}, Object.create(null));
}


export async function mkdirp(path: string, mode?: number): Promise<boolean> {
	const mkdir = async () => {
		try {
			await fs.mkdir(path, mode);
		} catch (err) {
			if (err.code === 'EEXIST') {
				const stat = await fs.stat(path);

				if (stat.isDirectory()) {
					return;
				}

				throw new Error(`'${path}' exists and is not a directory.`);
			}

			throw err;
		}
	};

	// is root?
	if (path === dirname(path)) {
		return true;
	}

	try {
		await mkdir();
	} catch (err) {
		if (err.code !== 'ENOENT') {
			throw err;
		}

		await mkdirp(dirname(path), mode);
		await mkdir();
	}

	return true;
}

export function uniqueFilter<T>(keyFn: (t: T) => string): (t: T) => boolean {
	const seen: { [key: string]: boolean; } = Object.create(null);

	return element => {
		const key = keyFn(element);

		if (seen[key]) {
			return false;
		}

		seen[key] = true;
		return true;
	};
}

export function find<T>(array: T[], fn: (t: T) => boolean): T | undefined {
	let result: T | undefined = undefined;

	array.some(e => {
		if (fn(e)) {
			result = e;
			return true;
		}

		return false;
	});

	return result;
}

export async function grep(filename: string, pattern: RegExp): Promise<boolean> {
	return new Promise<boolean>((c, e) => {
		const fileStream = createReadStream(filename, { encoding: 'utf8' });
		const stream = byline(fileStream);
		stream.on('data', (line: string) => {
			if (pattern.test(line)) {
				fileStream.close();
				c(true);
			}
		});

		stream.on('error', e);
		stream.on('end', () => c(false));
	});
}

export function readBytes(stream: Readable, bytes: number): Promise<Buffer> {
	return new Promise<Buffer>((complete, error) => {
		let done = false;
		let buffer = Buffer.allocUnsafe(bytes);
		let bytesRead = 0;

		stream.on('data', (data: Buffer) => {
			let bytesToRead = Math.min(bytes - bytesRead, data.length);
			data.copy(buffer, bytesRead, 0, bytesToRead);
			bytesRead += bytesToRead;

			if (bytesRead === bytes) {
				(stream as any).destroy(); // Will trigger the close event eventually
			}
		});

		stream.on('error', (e: Error) => {
			if (!done) {
				done = true;
				error(e);
			}
		});

		stream.on('close', () => {
			if (!done) {
				done = true;
				complete(buffer.slice(0, bytesRead));
			}
		});
	});
}

export const enum Encoding {
	UTF8 = 'utf8',
	UTF16be = 'utf16be',
	UTF16le = 'utf16le'
}

export function detectUnicodeEncoding(buffer: Buffer): Encoding | null {
	if (buffer.length < 2) {
		return null;
	}

	const b0 = buffer.readUInt8(0);
	const b1 = buffer.readUInt8(1);

	if (b0 === 0xFE && b1 === 0xFF) {
		return Encoding.UTF16be;
	}

	if (b0 === 0xFF && b1 === 0xFE) {
		return Encoding.UTF16le;
	}

	if (buffer.length < 3) {
		return null;
	}

	const b2 = buffer.readUInt8(2);

	if (b0 === 0xEF && b1 === 0xBB && b2 === 0xBF) {
		return Encoding.UTF8;
	}

	return null;
}

function isWindowsPath(path: string): boolean {
	return /^[a-zA-Z]:\\/.test(path);
}

export function isDescendant(parent: string, descendant: string): boolean {
	if (parent === descendant) {
		return true;
	}

	if (parent.charAt(parent.length - 1) !== sep) {
		parent += sep;
	}

	// Windows is case insensitive
	if (isWindowsPath(parent)) {
		parent = parent.toLowerCase();
		descendant = descendant.toLowerCase();
	}

	return descendant.startsWith(parent);
}

export function pathEquals(a: string, b: string): boolean {
	// Windows is case insensitive
	if (isWindowsPath(a)) {
		a = a.toLowerCase();
		b = b.toLowerCase();
	}

	return a === b;
}

export function* splitInChunks(array: string[], maxChunkLength: number): IterableIterator<string[]> {
	let current: string[] = [];
	let length = 0;

	for (const value of array) {
		let newLength = length + value.length;

		if (newLength > maxChunkLength && current.length > 0) {
			yield current;
			current = [];
			newLength = value.length;
		}

		current.push(value);
		length = newLength;
	}

	if (current.length > 0) {
		yield current;
	}
}

interface ILimitedTaskFactory<T> {
	factory: () => Promise<T>;
	c: (value: T | Promise<T>) => void;
	e: (error?: any) => void;
}

export class Limiter<T> {

	private runningPromises: number;
	private maxDegreeOfParalellism: number;
	private outstandingPromises: ILimitedTaskFactory<T>[];

	constructor(maxDegreeOfParalellism: number) {
		this.maxDegreeOfParalellism = maxDegreeOfParalellism;
		this.outstandingPromises = [];
		this.runningPromises = 0;
	}

	queue(factory: () => Promise<T>): Promise<T> {
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
		this.runningPromises--;

		if (this.outstandingPromises.length > 0) {
			this.consume();
		}
	}
}

type Completion<T> = { success: true, value: T } | { success: false, err: any };

export class PromiseSource<T> {

	private _onDidComplete = new EventEmitter<Completion<T>>();

	private _promise: Promise<T> | undefined;
	get promise(): Promise<T> {
		if (this._promise) {
			return this._promise;
		}

		return eventToPromise(this._onDidComplete.event).then(completion => {
			if (completion.success) {
				return completion.value;
			} else {
				throw completion.err;
			}
		});
	}

	resolve(value: T): void {
		if (!this._promise) {
			this._promise = Promise.resolve(value);
			this._onDidComplete.fire({ success: true, value });
		}
	}

	reject(err: any): void {
		if (!this._promise) {
			this._promise = Promise.reject(err);
			this._onDidComplete.fire({ success: false, err });
		}
	}
}

export namespace Versions {
	declare type VersionComparisonResult = -1 | 0 | 1;

	export interface Version {
		major: number;
		minor: number;
		patch: number;
		pre?: string;
	}

	export function compare(v1: string | Version, v2: string | Version): VersionComparisonResult {
		if (typeof v1 === 'string') {
			v1 = fromString(v1);
		}
		if (typeof v2 === 'string') {
			v2 = fromString(v2);
		}

		if (v1.major > v2.major) { return 1; }
		if (v1.major < v2.major) { return -1; }

		if (v1.minor > v2.minor) { return 1; }
		if (v1.minor < v2.minor) { return -1; }

		if (v1.patch > v2.patch) { return 1; }
		if (v1.patch < v2.patch) { return -1; }

		if (v1.pre === undefined && v2.pre !== undefined) { return 1; }
		if (v1.pre !== undefined && v2.pre === undefined) { return -1; }

		if (v1.pre !== undefined && v2.pre !== undefined) {
			return v1.pre.localeCompare(v2.pre) as VersionComparisonResult;
		}

		return 0;
	}

	export function from(major: string | number, minor: string | number, patch?: string | number, pre?: string): Version {
		return {
			major: typeof major === 'string' ? parseInt(major, 10) : major,
			minor: typeof minor === 'string' ? parseInt(minor, 10) : minor,
			patch: patch === undefined || patch === null ? 0 : typeof patch === 'string' ? parseInt(patch, 10) : patch,
			pre: pre,
		};
	}

	export function fromString(version: string): Version {
		const [ver, pre] = version.split('-');
		const [major, minor, patch] = ver.split('.');
		return from(major, minor, patch, pre);
	}
}
