/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { sep } from 'vs/base/common/path';
import { IdleValue } from 'vs/base/common/async';

// When comparing large numbers of strings, such as in sorting large arrays, is better for
// performance to create an Intl.Collator object and use the function provided by its compare
// property than it is to use String.prototype.localeCompare()

// A collator with numeric sorting enabled, and no sensitivity to case or to accents
const intlFileNameCollatorBaseNumeric: IdleValue<{ collator: Intl.Collator, collatorIsNumeric: boolean }> = new IdleValue(() => {
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
	return {
		collator: collator,
		collatorIsNumeric: collator.resolvedOptions().numeric
	};
});

// A collator with numeric sorting enabled.
const intlFileNameCollatorNumeric: IdleValue<{ collator: Intl.Collator }> = new IdleValue(() => {
	const collator = new Intl.Collator(undefined, { numeric: true });
	return {
		collator: collator
	};
});

// A collator with numeric sorting enabled, and sensitivity to accents and diacritics but not case.
const intlFileNameCollatorNumericCaseInsenstive: IdleValue<{ collator: Intl.Collator }> = new IdleValue(() => {
	const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'accent' });
	return {
		collator: collator
	};
});/** Compares filenames without distinguishing the name from the extension. Disambiguates by unicode comparison. */
export function compareFileNames(one: string | null, other: string | null, caseSensitive = false): number {
	const a = one || '';
	const b = other || '';
	const result = intlFileNameCollatorBaseNumeric.value.collator.compare(a, b);

	// Using the numeric option in the collator will
	// make compare(`foo1`, `foo01`) === 0. We must disambiguate.
	if (intlFileNameCollatorBaseNumeric.value.collatorIsNumeric && result === 0 && a !== b) {
		return a < b ? -1 : 1;
	}

	return result;
}

/** Compares filenames without distinguishing the name from the extension. Disambiguates by length, not unicode comparison. */
export function compareFileNamesDefault(one: string | null, other: string | null): number {
	const collatorNumeric = intlFileNameCollatorNumeric.value.collator;
	one = one || '';
	other = other || '';

	// Compare the entire filename - both name and extension - and disambiguate by length if needed
	return compareAndDisambiguateByLength(collatorNumeric, one, other);
}

export function noIntlCompareFileNames(one: string | null, other: string | null, caseSensitive = false): number {
	if (!caseSensitive) {
		one = one && one.toLowerCase();
		other = other && other.toLowerCase();
	}

	const [oneName, oneExtension] = extractNameAndExtension(one);
	const [otherName, otherExtension] = extractNameAndExtension(other);

	if (oneName !== otherName) {
		return oneName < otherName ? -1 : 1;
	}

	if (oneExtension === otherExtension) {
		return 0;
	}

	return oneExtension < otherExtension ? -1 : 1;
}

export function compareFileExtensions(one: string | null, other: string | null): number {
	const [oneName, oneExtension] = extractNameAndExtension(one);
	const [otherName, otherExtension] = extractNameAndExtension(other);

	let result = intlFileNameCollatorBaseNumeric.value.collator.compare(oneExtension, otherExtension);

	if (result === 0) {
		// Using the numeric option in the collator will
		// make compare(`foo1`, `foo01`) === 0. We must disambiguate.
		if (intlFileNameCollatorBaseNumeric.value.collatorIsNumeric && oneExtension !== otherExtension) {
			return oneExtension < otherExtension ? -1 : 1;
		}

		// Extensions are equal, compare filenames
		result = intlFileNameCollatorBaseNumeric.value.collator.compare(oneName, otherName);

		if (intlFileNameCollatorBaseNumeric.value.collatorIsNumeric && result === 0 && oneName !== otherName) {
			return oneName < otherName ? -1 : 1;
		}
	}

	return result;
}

/** Compares filenames by extenson, then by full filename */
export function compareFileExtensionsDefault(one: string | null, other: string | null): number {
	one = one || '';
	other = other || '';
	const oneExtension = extractExtension(one);
	const otherExtension = extractExtension(other);
	const collatorNumeric = intlFileNameCollatorNumeric.value.collator;
	const collatorNumericCaseInsensitive = intlFileNameCollatorNumericCaseInsenstive.value.collator;
	let result;

	// Check for extension differences, ignoring differences in case and comparing numbers numerically.
	result = compareAndDisambiguateByLength(collatorNumericCaseInsensitive, oneExtension, otherExtension);
	if (result !== 0) {
		return result;
	}

	// Compare full filenames
	return compareAndDisambiguateByLength(collatorNumeric, one, other);
}

const FileNameMatch = /^(.*?)(\.([^.]*))?$/;

/** Extracts the name and extension from a full filename, with optional special handling for dotfiles */
function extractNameAndExtension(str?: string | null, dotfilesAsNames = false): [string, string] {
	const match = str ? FileNameMatch.exec(str) as Array<string> : ([] as Array<string>);

	let result: [string, string] = [(match && match[1]) || '', (match && match[3]) || ''];

	// if the dotfilesAsNames option is selected, treat an empty filename with an extension,
	// or a filename that starts with a dot, as a dotfile name
	if (dotfilesAsNames && (!result[0] && result[1] || result[0] && result[0].charAt(0) === '.')) {
		result = [result[0] + '.' + result[1], ''];
	}

	return result;
}

/** Extracts the extension from a full filename. Treats dotfiles as names, not extensions. */
function extractExtension(str?: string | null): string {
	const match = str ? FileNameMatch.exec(str) as Array<string> : ([] as Array<string>);

	return (match && match[1] && match[1].charAt(0) !== '.' && match[3]) || '';
}

function compareAndDisambiguateByLength(collator: Intl.Collator, one: string, other: string) {
	// Check for differences
	let result = collator.compare(one, other);
	if (result !== 0) {
		return result;
	}

	// In a numeric comparison, `foo1` and `foo01` will compare as equivalent.
	// Disambiguate by sorting the shorter string first.
	if (one.length !== other.length) {
		return one.length < other.length ? -1 : 1;
	}

	return 0;
}

function comparePathComponents(one: string, other: string, caseSensitive = false): number {
	if (!caseSensitive) {
		one = one && one.toLowerCase();
		other = other && other.toLowerCase();
	}

	if (one === other) {
		return 0;
	}

	return one < other ? -1 : 1;
}

export function comparePaths(one: string, other: string, caseSensitive = false): number {
	const oneParts = one.split(sep);
	const otherParts = other.split(sep);

	const lastOne = oneParts.length - 1;
	const lastOther = otherParts.length - 1;
	let endOne: boolean, endOther: boolean;

	for (let i = 0; ; i++) {
		endOne = lastOne === i;
		endOther = lastOther === i;

		if (endOne && endOther) {
			return compareFileNames(oneParts[i], otherParts[i], caseSensitive);
		} else if (endOne) {
			return -1;
		} else if (endOther) {
			return 1;
		}

		const result = comparePathComponents(oneParts[i], otherParts[i], caseSensitive);

		if (result !== 0) {
			return result;
		}
	}
}

export function compareAnything(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();

	// Sort prefix matches over non prefix matches
	const prefixCompare = compareByPrefix(one, other, lookFor);
	if (prefixCompare) {
		return prefixCompare;
	}

	// Sort suffix matches over non suffix matches
	const elementASuffixMatch = elementAName.endsWith(lookFor);
	const elementBSuffixMatch = elementBName.endsWith(lookFor);
	if (elementASuffixMatch !== elementBSuffixMatch) {
		return elementASuffixMatch ? -1 : 1;
	}

	// Understand file names
	const r = compareFileNames(elementAName, elementBName);
	if (r !== 0) {
		return r;
	}

	// Compare by name
	return elementAName.localeCompare(elementBName);
}

export function compareByPrefix(one: string, other: string, lookFor: string): number {
	const elementAName = one.toLowerCase();
	const elementBName = other.toLowerCase();

	// Sort prefix matches over non prefix matches
	const elementAPrefixMatch = elementAName.startsWith(lookFor);
	const elementBPrefixMatch = elementBName.startsWith(lookFor);
	if (elementAPrefixMatch !== elementBPrefixMatch) {
		return elementAPrefixMatch ? -1 : 1;
	}

	// Same prefix: Sort shorter matches to the top to have those on top that match more precisely
	else if (elementAPrefixMatch && elementBPrefixMatch) {
		if (elementAName.length < elementBName.length) {
			return -1;
		}

		if (elementAName.length > elementBName.length) {
			return 1;
		}
	}

	return 0;
}
