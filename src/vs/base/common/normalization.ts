/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LRUCache } from 'vs/base/common/map';

/**
 * The normalize() method returns the Unicode Normalization Form of a given string. The form will be
 * the Normalization Form Canonical Composition.
 *
 * @see {@link https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/String/normalize}
 */
export const canNormalize = typeof (String.prototype as any /* standalone editor compilation */).normalize === 'function';

const nfcCache = new LRUCache<string, string>(10000); // bounded to 10000 elements
export function normalizeNFC(str: string): string {
	return normalize(str, 'NFC', nfcCache);
}

const nfdCache = new LRUCache<string, string>(10000); // bounded to 10000 elements
export function normalizeNFD(str: string): string {
	return normalize(str, 'NFD', nfdCache);
}

const nonAsciiCharactersPattern = /[^\u0000-\u0080]/;
function normalize(str: string, form: string, normalizedCache: LRUCache<string, string>): string {
	if (!canNormalize || !str) {
		return str;
	}

	const cached = normalizedCache.get(str);
	if (cached) {
		return cached;
	}

	let res: string;
	if (nonAsciiCharactersPattern.test(str)) {
		res = (<any>str).normalize(form);
	} else {
		res = str;
	}

	// Use the cache for fast lookup
	normalizedCache.set(str, res);

	return res;
}

export const removeAccents: (str: string) => string = (function () {
	if (!canNormalize) {
		// no ES6 features...
		return function (str: string) { return str; };
	} else {
		// transform into NFD form and remove accents
		// see: https://stackoverflow.com/questions/990904/remove-accents-diacritics-in-a-string-in-javascript/37511463#37511463
		const regex = /[\u0300-\u036f]/g;
		return function (str: string) {
			return normalizeNFD(str).replace(regex, '');
		};
	}
})();
