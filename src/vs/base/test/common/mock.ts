/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export interface Ctor<T> {
	new(): T;
}

export function mock<T>(): Ctor<T> {
	return function () { } as any;
}
