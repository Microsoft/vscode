/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as array from './arrays';

export function equals(one: any, other: any): boolean {
	if (one === other) {
		return true;
	}
	if (one === null || one === undefined || other === null || other === undefined) {
		return false;
	}
	if (typeof one !== typeof other) {
		return false;
	}
	if (typeof one !== 'object') {
		return false;
	}
	if (Array.isArray(one) !== Array.isArray(other)) {
		return false;
	}

	if (Array.isArray(one)) {
		return array.equals(one, other, equals);
	} else {
		const oneKeys: string[] = [];
		for (const key in one) {
			oneKeys.push(key);
		}
		oneKeys.sort();
		const otherKeys: string[] = [];
		for (const key in other) {
			otherKeys.push(key);
		}
		otherKeys.sort();
		if (!array.equals(oneKeys, otherKeys)) {
			return false;
		}
		return oneKeys.every(key => equals(one[key], other[key]));
	}
}
