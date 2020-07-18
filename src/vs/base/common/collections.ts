/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * An interface for a JavaScript object that
 * acts a dictionary. The keys are strings.
 */
export type IStringDictionary<V> = Record<string, V>;


/**
 * An interface for a JavaScript object that
 * acts a dictionary. The keys are numbers.
 */
export type INumberDictionary<V> = Record<number, V>;

const hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * Returns an array which contains all values that reside
 * in the given dictionary.
 */
export function values<T>(from: IStringDictionary<T> | INumberDictionary<T>): T[] {
	const result: T[] = [];
	for (let key in from) {
		if (hasOwnProperty.call(from, key)) {
			result.push((from as any)[key]);
		}
	}
	return result;
}

/**
 * Iterates over each entry in the provided dictionary. The iterator allows
 * to remove elements and will stop when the callback returns {{false}}.
 */
export function forEach<T>(from: IStringDictionary<T> | INumberDictionary<T>, callback: (entry: { key: any; value: T; }, remove: () => void) => any): void {
	for (let key in from) {
		if (hasOwnProperty.call(from, key)) {
			const result = callback({ key: key, value: (from as any)[key] }, function () {
				delete (from as any)[key];
			});
			if (result === false) {
				return;
			}
		}
	}
}

/**
 * Groups the collection into a dictionary based on the provided
 * group function.
 */
export function groupBy<T>(data: T[], groupFn: (element: T) => string): IStringDictionary<T[]> {
	const result: IStringDictionary<T[]> = Object.create(null);
	for (const element of data) {
		const key = groupFn(element);
		let target = result[key];
		if (!target) {
			target = result[key] = [];
		}
		target.push(element);
	}
	return result;
}

export function fromMap<T>(original: Map<string, T>): IStringDictionary<T> {
	const result: IStringDictionary<T> = Object.create(null);
	if (original) {
		original.forEach((value, key) => {
			result[key] = value;
		});
	}
	return result;
}


export class SetMap<K, V> {

	private map = new Map<K, Set<V>>();

	add(key: K, value: V): void {
		let values = this.map.get(key);

		if (!values) {
			values = new Set<V>();
			this.map.set(key, values);
		}

		values.add(value);
	}

	delete(key: K, value: V): void {
		const values = this.map.get(key);

		if (!values) {
			return;
		}

		values.delete(value);

		if (values.size === 0) {
			this.map.delete(key);
		}
	}

	forEach(key: K, fn: (value: V) => void): void {
		const values = this.map.get(key);

		if (!values) {
			return;
		}

		values.forEach(fn);
	}
}
