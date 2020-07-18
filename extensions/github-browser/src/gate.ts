/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

const emptyStr = '';

function defaultResolver(...args: any[]): string {
	if (args.length === 1) {
		const arg0 = args[0];
		if (arg0 === undefined || arg0 === null) {
			return emptyStr;
		}
		if (typeof arg0 === 'string') {
			return arg0;
		}
		if (typeof arg0 === 'number' || typeof arg0 === 'boolean') {
			return String(arg0);
		}

		return JSON.stringify(arg0);
	}

	return JSON.stringify(args);
}

function iPromise<T>(obj: T | Promise<T>): obj is Promise<T> {
	return typeof (obj as Promise<T>)?.then === 'function';
}

export function gate<T extends (...arg: any) => any>(resolver?: (...args: Parameters<T>) => string) {
	return (_target: any, key: string, descriptor: PropertyDescriptor) => {
		let fn: Function | undefined;
		if (typeof descriptor.value === 'function') {
			fn = descriptor.value;
		} else if (typeof descriptor.get === 'function') {
			fn = descriptor.get;
		}
		if (fn === undefined || fn === null) {
			throw new Error('Not supported');
		}

		const gateKey = `$gate$${key}`;

		descriptor.value = function (this: any, ...args: any[]) {
			const prop =
				args.length === 0 ? gateKey : `${gateKey}$${(resolver ?? defaultResolver)(...(args as Parameters<T>))}`;

			if (!Object.prototype.hasOwnProperty.call(this, prop)) {
				Object.defineProperty(this, prop, {
					configurable: false,
					enumerable: false,
					writable: true,
					value: undefined,
				});
			}

			let promise = this[prop];
			if (promise === undefined) {
				let result;
				try {
					result = fn!.apply(this, args);
					if (result === undefined || fn === null || !iPromise(result)) {
						return result;
					}

					this[prop] = promise = result
						.then((r: any) => {
							this[prop] = undefined;
							return r;
						})
						.catch(ex => {
							this[prop] = undefined;
							throw ex;
						});
				} catch (ex) {
					this[prop] = undefined;
					throw ex;
				}
			}

			return promise;
		};
	};
}
