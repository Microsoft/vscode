/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from 'vs/base/common/uri';

/**
 * @returns whether the provided parameter is a JavaScript Array or not.
 */
export function isArray(array: any): array is any[] {
	return Array.isArray(array);
}

/**
 * @returns whether the provided parameter is a JavaScript String or not.
 */
export function isString(str: unknown): str is string {
	return (typeof str === 'string');
}

/**
 * @returns whether the provided parameter is a JavaScript Array and each element in the array is a string.
 */
export function isStringArray(value: unknown): value is string[] {
	return Array.isArray(value) && (<unknown[]>value).every(elem => isString(elem));
}

/**
 *
 * @returns whether the provided parameter is of type `object` but **not**
 *	`null`, an `array`, a `regexp`, nor a `date`.
 */
export function isObject(obj: unknown): obj is Object {
	// The method can't do a type cast since there are type (like strings) which
	// are subclasses of any put not positvely matched by the function. Hence type
	// narrowing results in wrong results.
	return typeof obj === 'object'
		&& obj !== null
		&& !Array.isArray(obj)
		&& !(obj instanceof RegExp)
		&& !(obj instanceof Date);
}

/**
 * In **contrast** to just checking `typeof` this will return `false` for `NaN`.
 * @returns whether the provided parameter is a JavaScript Number or not.
 */
export function isNumber(obj: unknown): obj is number {
	return (typeof obj === 'number' && !isNaN(obj));
}

/**
 * @returns whether the provided parameter is an Iterable, casting to the given generic
 */
export function isIterable<T>(obj: unknown): obj is Iterable<T> {
	return !!obj && typeof (obj as any)[Symbol.iterator] === 'function';
}

/**
 * @returns whether the provided parameter is a JavaScript Boolean or not.
 */
export function isBoolean(obj: unknown): obj is boolean {
	return (obj === true || obj === false);
}

/**
 * @returns whether the provided parameter is undefined.
 */
export function isUndefined(obj: unknown): obj is undefined {
	return (typeof obj === 'undefined');
}

/**
 * @returns whether the provided parameter is defined.
 */
export function isDefined<T>(arg: T | null | undefined): arg is T {
	return !isUndefinedOrNull(arg);
}

/**
 * @returns whether the provided parameter is undefined or null.
 */
export function isUndefinedOrNull(obj: unknown): obj is undefined | null {
	return (isUndefined(obj) || obj === null);
}


export function assertType(condition: unknown, type?: string): asserts condition {
	if (!condition) {
		throw new Error(type ? `Unexpected type, expected '${type}'` : 'Unexpected type');
	}
}

/**
 * Asserts that the argument passed in is neither undefined nor null.
 */
export function assertIsDefined<T>(arg: T | null | undefined): T {
	if (isUndefinedOrNull(arg)) {
		throw new Error('Assertion Failed: argument is undefined or null');
	}

	return arg;
}

/**
 * Asserts that each argument passed in is neither undefined nor null.
 */
export function assertAllDefined<T1, T2>(t1: T1 | null | undefined, t2: T2 | null | undefined): [T1, T2];
export function assertAllDefined<T1, T2, T3>(t1: T1 | null | undefined, t2: T2 | null | undefined, t3: T3 | null | undefined): [T1, T2, T3];
export function assertAllDefined<T1, T2, T3, T4>(t1: T1 | null | undefined, t2: T2 | null | undefined, t3: T3 | null | undefined, t4: T4 | null | undefined): [T1, T2, T3, T4];
export function assertAllDefined(...args: (unknown | null | undefined)[]): unknown[] {
	const result = [];

	for (let i = 0; i < args.length; i++) {
		const arg = args[i];

		if (isUndefinedOrNull(arg)) {
			throw new Error(`Assertion Failed: argument at index ${i} is undefined or null`);
		}

		result.push(arg);
	}

	return result;
}

const hasOwnProperty = Object.prototype.hasOwnProperty;

/**
 * @returns whether the provided parameter is an empty JavaScript Object or not.
 */
export function isEmptyObject(obj: unknown): obj is object {
	if (!isObject(obj)) {
		return false;
	}

	for (let key in obj) {
		if (hasOwnProperty.call(obj, key)) {
			return false;
		}
	}

	return true;
}

/**
 * @returns whether the provided parameter is a JavaScript Function or not.
 */
export function isFunction(obj: unknown): obj is Function {
	return (typeof obj === 'function');
}

/**
 * @returns whether the provided parameters is are JavaScript Function or not.
 */
export function areFunctions(...objects: unknown[]): boolean {
	return objects.length > 0 && objects.every(isFunction);
}

export type TypeConstraint = string | Function;

export function validateConstraints(args: unknown[], constraints: Array<TypeConstraint | undefined>): void {
	const len = Math.min(args.length, constraints.length);
	for (let i = 0; i < len; i++) {
		validateConstraint(args[i], constraints[i]);
	}
}

export function validateConstraint(arg: unknown, constraint: TypeConstraint | undefined): void {

	if (isString(constraint)) {
		if (typeof arg !== constraint) {
			throw new Error(`argument does not match constraint: typeof ${constraint}`);
		}
	} else if (isFunction(constraint)) {
		try {
			if (arg instanceof constraint) {
				return;
			}
		} catch {
			// ignore
		}
		if (!isUndefinedOrNull(arg) && (arg as any).constructor === constraint) {
			return;
		}
		if (constraint.length === 1 && constraint.call(undefined, arg) === true) {
			return;
		}
		throw new Error(`argument does not match one of these constraints: arg instanceof constraint, arg.constructor === constraint, nor constraint(arg) === true`);
	}
}

export function getAllPropertyNames(obj: object): string[] {
	let res: string[] = [];
	let proto = Object.getPrototypeOf(obj);
	while (Object.prototype !== proto) {
		res = res.concat(Object.getOwnPropertyNames(proto));
		proto = Object.getPrototypeOf(proto);
	}
	return res;
}

export function getAllMethodNames(obj: object): string[] {
	const methods: string[] = [];
	for (const prop of getAllPropertyNames(obj)) {
		if (typeof (obj as any)[prop] === 'function') {
			methods.push(prop);
		}
	}
	return methods;
}

export function createProxyObject<T extends object>(methodNames: string[], invoke: (method: string, args: unknown[]) => unknown): T {
	const createProxyMethod = (method: string): () => unknown => {
		return function () {
			const args = Array.prototype.slice.call(arguments, 0);
			return invoke(method, args);
		};
	};

	let result = {} as T;
	for (const methodName of methodNames) {
		(<any>result)[methodName] = createProxyMethod(methodName);
	}
	return result;
}

/**
 * Converts null to undefined, passes all other values through.
 */
export function withNullAsUndefined<T>(x: T | null): T | undefined {
	return x === null ? undefined : x;
}

/**
 * Converts undefined to null, passes all other values through.
 */
export function withUndefinedAsNull<T>(x: T | undefined): T | null {
	return typeof x === 'undefined' ? null : x;
}

type AddFirstParameterToFunction<T, TargetFunctionsReturnType, FirstParameter> = T extends (...args: any[]) => TargetFunctionsReturnType ?
	// Function: add param to function
	(firstArg: FirstParameter, ...args: Parameters<T>) => ReturnType<T> :

	// Else: just leave as is
	T;

/**
 * Allows to add a first parameter to functions of a type.
 */
export type AddFirstParameterToFunctions<Target, TargetFunctionsReturnType, FirstParameter> = {
	// For every property
	[K in keyof Target]: AddFirstParameterToFunction<Target[K], TargetFunctionsReturnType, FirstParameter>;
};

/**
 * Mapped-type that replaces all occurrences of URI with UriComponents
 */
export type UriDto<T> = { [K in keyof T]: T[K] extends URI
	? UriComponents
	: UriDto<T[K]> };

/**
 * Mapped-type that replaces all occurrences of URI with UriComponents and
 * drops all functions.
 */
export type Dto<T> = T extends { toJSON(): infer U }
	? U
	: T extends object
	? { [k in keyof T]: Dto<T[k]>; }
	: T;

export function NotImplementedProxy<T>(name: string): { new(): T } {
	return <any>class {
		constructor() {
			return new Proxy({}, {
				get(target: any, prop: PropertyKey) {
					if (target[prop]) {
						return target[prop];
					}
					throw new Error(`Not Implemented: ${name}->${String(prop)}`);
				}
			});
		}
	};
}

export function assertNever(value: never) {
	throw new Error('Unreachable');
}
