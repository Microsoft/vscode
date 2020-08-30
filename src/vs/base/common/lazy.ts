/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * A value that is resolved synchronously when it is first needed.
 */
export interface Lazy<T> {

	hasValue(): boolean;


	getValue(): T;


	map<R>(f: (x: T) => R): Lazy<R>;
}

export class Lazy<T> {

	private _didRun: boolean = false;
	private _value?: T;
	private _error: Error | undefined;

	constructor(
		private readonly executor: () => T,
	) { }

	/**
	 * True if the lazy value has been resolved.
	 */
	hasValue() { return this._didRun; }

	/**
	 * Get the wrapped value.
	 *
	 * This will force evaluation of the lazy value if it has not been resolved yet. Lazy values are only
	 * resolved once. `getValue` will re-throw exceptions that are hit while resolving the value
	 */
	getValue(): T {
		if (!this._didRun) {
			try {
				this._value = this.executor();
			} catch (err) {
				this._error = err;
			} finally {
				this._didRun = true;
			}
		}
		if (this._error) {
			throw this._error;
		}
		return this._value!;
	}

	/**
	 * Get the wrapped value without forcing evaluation.
	 */
	get rawValue(): T | undefined { return this._value; }

	/**
	 * Create a new lazy value that is the result of applying `f` to the wrapped value.
	 *
	 * This does not force the evaluation of the current lazy value.
	 */
	map<R>(f: (x: T) => R): Lazy<R> {
		return new Lazy<R>(() => f(this.getValue()));
	}
}
