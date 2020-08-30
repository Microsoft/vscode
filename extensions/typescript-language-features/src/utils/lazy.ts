/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Lazy<T> {
	value: T;
	hasValue: boolean;
	map<R>(f: (x: T) => R): Lazy<R>;
}

class LazyValue<T> implements Lazy<T> {
	private _hasValue: boolean = false;
	private _value?: T;

	constructor(
		private readonly _getValue: () => T
	) { }

	get value(): T {
		if (!this._hasValue) {
			this._hasValue = true;
			this._value = this._getValue();
		}
		return this._value!;
	}

	get hasValue(): boolean {
		return this._hasValue;
	}

	public map<R>(f: (x: T) => R): Lazy<R> {
		return new LazyValue(() => f(this.value));
	}
}

export function lazy<T>(getValue: () => T): Lazy<T> {
	return new LazyValue<T>(getValue);
}
