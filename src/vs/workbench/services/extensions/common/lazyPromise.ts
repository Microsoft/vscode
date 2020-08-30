/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { onUnexpectedError } from 'vs/base/common/errors';

export class LazyPromise implements Promise<any> {

	private _actual: Promise<any> | null;
	private _actualOk: ((value?: any) => any) | null;
	private _actualErr: ((err?: any) => any) | null;

	private _hasValue: boolean;
	private _value: any;

	private _hasErr: boolean;
	private _err: any;

	constructor() {
		this._actual = null;
		this._actualOk = null;
		this._actualErr = null;
		this._hasValue = false;
		this._value = null;
		this._hasErr = false;
		this._err = null;
	}

	get [Symbol.toStringTag](): string {
		return this.toString();
	}

	private _ensureActual(): Promise<any> {
		if (!this._actual) {
			this._actual = new Promise<any>((c, e) => {
				this._actualOk = c;
				this._actualErr = e;

				if (this._hasValue) {
					this._actualOk(this._value);
				}

				if (this._hasErr) {
					this._actualErr(this._err);
				}
			});
		}
		return this._actual;
	}

	public resolveOk(value: any): void {
		if (this._hasValue || this._hasErr) {
			return;
		}

		this._hasValue = true;
		this._value = value;

		if (this._actual) {
			this._actualOk!(value);
		}
	}

	public resolveErr(err: any): void {
		if (this._hasValue || this._hasErr) {
			return;
		}

		this._hasErr = true;
		this._err = err;

		if (this._actual) {
			this._actualErr!(err);
		} else {
			// If nobody's listening at this point, it is safe to assume they never will,
			// since resolving this promise is always "async"
			onUnexpectedError(err);
		}
	}

	public then(success: any, error: any): any {
		return this._ensureActual().then(success, error);
	}

	public catch(error: any): any {
		return this._ensureActual().then(undefined, error);
	}

	public finally(callback: () => void): any {
		return this._ensureActual().finally(callback);
	}
}
