/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export namespace Iterable {

	export function is<T = any>(thing: any): thing is IterableIterator<T> {
		return thing && typeof thing === 'object' && typeof thing[Symbol.iterator] === 'function';
	}

	const _empty: Iterable<any> = Object.freeze([]);
	export function empty<T = any>(): Iterable<T> {
		return _empty;
	}

	export function* single<T>(element: T): Iterable<T> {
		yield element;
	}

	export function from<T>(iterable: Iterable<T> | undefined | null): Iterable<T> {
		return iterable || _empty;
	}

	export function first<T>(iterable: Iterable<T>): T | undefined {
		return iterable[Symbol.iterator]().next().value;
	}

	export function some<T>(iterable: Iterable<T>, predicate: (t: T) => boolean): boolean {
		for (const element of iterable) {
			if (predicate(element)) {
				return true;
			}
		}
		return false;
	}

	export function* filter<T>(iterable: Iterable<T>, predicate: (t: T) => boolean): Iterable<T> {
		for (const element of iterable) {
			if (predicate(element)) {
				yield element;
			}
		}
	}

	export function* map<T, R>(iterable: Iterable<T>, fn: (t: T) => R): Iterable<R> {
		for (const element of iterable) {
			yield fn(element);
		}
	}

	export function* concat<T>(...iterables: Iterable<T>[]): Iterable<T> {
		for (const iterable of iterables) {
			for (const element of iterable) {
				yield element;
			}
		}
	}

	/**
	 * Consumes `atMost` elements from iterable and returns the consumed elements,
	 * and an iterable for the rest of the elements.
	 */
	export function consume<T>(iterable: Iterable<T>, atMost: number = Number.POSITIVE_INFINITY): [T[], Iterable<T>] {
		const consumed: T[] = [];

		if (atMost === 0) {
			return [consumed, iterable];
		}

		const iterator = iterable[Symbol.iterator]();

		for (let i = 0; i < atMost; i++) {
			const next = iterator.next();

			if (next.done) {
				return [consumed, Iterable.empty()];
			}

			consumed.push(next.value);
		}

		return [consumed, { [Symbol.iterator]() { return iterator; } }];
	}
}
