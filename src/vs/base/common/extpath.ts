/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isWindows } from 'vs/base/common/platform';
import { startsWithIgnoreCase, equalsIgnoreCase, rtrim } from 'vs/base/common/strings';
import { CharCode } from 'vs/base/common/charCode';
import { sep, posix, isAbsolute, join, normalize } from 'vs/base/common/path';
import { isNumber } from 'vs/base/common/types';

export function isPathSeparator(code: number) {
	return code === CharCode.Slash || code === CharCode.Backslash;
}

/**
 * Takes a Windows OS path and changes backward slashes to forward slashes.
 * This should only be done for OS paths from Windows (or user provided paths potentially from Windows).
 * Using it on a Linux or MaxOS path might change it.
 */
export function toSlashes(osPath: string) {
	return osPath.replace(/[\\/]/g, posix.sep);
}

/**
 * Computes the _root_ this path, like `getRoot('c:\files') === c:\`,
 * `getRoot('files:///files/path') === files:///`,
 * or `getRoot('\\server\shares\path') === \\server\shares\`
 */
export function getRoot(path: string, sep: string = posix.sep): string {

	if (!path) {
		return '';
	}

	const len = path.length;
	const firstLetter = path.charCodeAt(0);
	if (isPathSeparator(firstLetter)) {
		if (isPathSeparator(path.charCodeAt(1))) {
			// UNC candidate \\localhost\shares\ddd
			//               ^^^^^^^^^^^^^^^^^^^
			if (!isPathSeparator(path.charCodeAt(2))) {
				let pos = 3;
				const start = pos;
				for (; pos < len; pos++) {
					if (isPathSeparator(path.charCodeAt(pos))) {
						break;
					}
				}
				if (start !== pos && !isPathSeparator(path.charCodeAt(pos + 1))) {
					pos += 1;
					for (; pos < len; pos++) {
						if (isPathSeparator(path.charCodeAt(pos))) {
							return path.slice(0, pos + 1) // consume this separator
								.replace(/[\\/]/g, sep);
						}
					}
				}
			}
		}

		// /user/far
		// ^
		return sep;

	} else if (isWindowsDriveLetter(firstLetter)) {
		// check for windows drive letter c:\ or c:

		if (path.charCodeAt(1) === CharCode.Colon) {
			if (isPathSeparator(path.charCodeAt(2))) {
				// C:\fff
				// ^^^
				return path.slice(0, 2) + sep;
			} else {
				// C:
				// ^^
				return path.slice(0, 2);
			}
		}
	}

	// check for URI
	// scheme://authority/path
	// ^^^^^^^^^^^^^^^^^^^
	let pos = path.indexOf('://');
	if (pos !== -1) {
		pos += 3; // 3 -> "://".length
		for (; pos < len; pos++) {
			if (isPathSeparator(path.charCodeAt(pos))) {
				return path.slice(0, pos + 1); // consume this separator
			}
		}
	}

	return '';
}

/**
 * Check if the path follows this pattern: `\\hostname\sharename`.
 *
 * @see https://msdn.microsoft.com/en-us/library/gg465305.aspx
 * @return A boolean indication if the path is a UNC path, on none-windows
 * always false.
 */
export function isUNC(path: string): boolean {
	if (!isWindows) {
		// UNC is a windows concept
		return false;
	}

	if (!path || path.length < 5) {
		// at least \\a\b
		return false;
	}

	let code = path.charCodeAt(0);
	if (code !== CharCode.Backslash) {
		return false;
	}
	code = path.charCodeAt(1);
	if (code !== CharCode.Backslash) {
		return false;
	}
	let pos = 2;
	const start = pos;
	for (; pos < path.length; pos++) {
		code = path.charCodeAt(pos);
		if (code === CharCode.Backslash) {
			break;
		}
	}
	if (start === pos) {
		return false;
	}
	code = path.charCodeAt(pos + 1);
	if (isNaN(code) || code === CharCode.Backslash) {
		return false;
	}
	return true;
}

// Reference: https://en.wikipedia.org/wiki/Filename
const WINDOWS_INVALID_FILE_CHARS = /[\\/:\*\?"<>\|]/g;
const UNIX_INVALID_FILE_CHARS = /[\\/]/g;
const WINDOWS_FORBIDDEN_NAMES = /^(con|prn|aux|clock\$|nul|lpt[0-9]|com[0-9])$/i;
export function isValidBasename(name: string | null | undefined, isWindowsOS: boolean = isWindows): boolean {
	const invalidFileChars = isWindowsOS ? WINDOWS_INVALID_FILE_CHARS : UNIX_INVALID_FILE_CHARS;

	if (!name || name.length === 0 || /^\s+$/.test(name)) {
		return false; // require a name that is not just whitespace
	}

	invalidFileChars.lastIndex = 0; // the holy grail of software development
	if (invalidFileChars.test(name)) {
		return false; // check for certain invalid file characters
	}

	if (isWindowsOS && WINDOWS_FORBIDDEN_NAMES.test(name)) {
		return false; // check for certain invalid file names
	}

	if (name === '.' || name === '..') {
		return false; // check for reserved values
	}

	if (isWindowsOS && name[name.length - 1] === '.') {
		return false; // Windows: file cannot end with a "."
	}

	if (isWindowsOS && name.length !== name.trim().length) {
		return false; // Windows: file cannot end with a whitespace
	}

	if (name.length > 255) {
		return false; // most file systems do not allow files > 255 length
	}

	return true;
}

export function isEqual(pathA: string, pathB: string, ignoreCase?: boolean): boolean {
	const identityEquals = (pathA === pathB);
	if (!ignoreCase || identityEquals) {
		return identityEquals;
	}

	if (!pathA || !pathB) {
		return false;
	}

	return equalsIgnoreCase(pathA, pathB);
}

export function isEqualOrParent(path: string, candidate: string, ignoreCase?: boolean, separator = sep): boolean {
	if (path === candidate) {
		return true;
	}

	if (!path || !candidate) {
		return false;
	}

	if (candidate.length > path.length) {
		return false;
	}

	if (ignoreCase) {
		const beginsWith = startsWithIgnoreCase(path, candidate);
		if (!beginsWith) {
			return false;
		}

		if (candidate.length === path.length) {
			return true; // same path, different casing
		}

		let sepOffset = candidate.length;
		if (candidate.charAt(candidate.length - 1) === separator) {
			sepOffset--; // adjust the expected sep offset in case our candidate already ends in separator character
		}

		return path.charAt(sepOffset) === separator;
	}

	if (candidate.charAt(candidate.length - 1) !== separator) {
		candidate += separator;
	}

	return path.indexOf(candidate) === 0;
}

export function isWindowsDriveLetter(char0: number): boolean {
	return char0 >= CharCode.A && char0 <= CharCode.Z || char0 >= CharCode.a && char0 <= CharCode.z;
}

export function sanitizeFilePath(candidate: string, cwd: string): string {

	// Special case: allow to open a drive letter without trailing backslash
	if (isWindows && candidate.endsWith(':')) {
		candidate += sep;
	}

	// Ensure absolute
	if (!isAbsolute(candidate)) {
		candidate = join(cwd, candidate);
	}

	// Ensure normalized
	candidate = normalize(candidate);

	// Ensure no trailing slash/backslash
	if (isWindows) {
		candidate = rtrim(candidate, sep);

		// Special case: allow to open drive root ('C:\')
		if (candidate.endsWith(':')) {
			candidate += sep;
		}

	} else {
		candidate = rtrim(candidate, sep);

		// Special case: allow to open root ('/')
		if (!candidate) {
			candidate = sep;
		}
	}

	return candidate;
}

export function isRootOrDriveLetter(path: string): boolean {
	const pathNormalized = normalize(path);

	if (isWindows) {
		if (path.length > 3) {
			return false;
		}

		return isWindowsDriveLetter(pathNormalized.charCodeAt(0))
			&& pathNormalized.charCodeAt(1) === CharCode.Colon
			&& (path.length === 2 || pathNormalized.charCodeAt(2) === CharCode.Backslash);
	}

	return pathNormalized === posix.sep;
}

export function indexOfPath(path: string, candidate: string, ignoreCase?: boolean): number {
	if (candidate.length > path.length) {
		return -1;
	}

	if (path === candidate) {
		return 0;
	}

	if (ignoreCase) {
		path = path.toLowerCase();
		candidate = candidate.toLowerCase();
	}

	return path.indexOf(candidate);
}

export interface IPathWithLineAndColumn {
	path: string;
	line?: number;
	column?: number;
}

export function parseLineAndColumnAware(rawPath: string): IPathWithLineAndColumn {
	const segments = rawPath.split(':'); // C:\file.txt:<line>:<column>

	let path: string | undefined = undefined;
	let line: number | undefined = undefined;
	let column: number | undefined = undefined;

	segments.forEach(segment => {
		const segmentAsNumber = Number(segment);
		if (!isNumber(segmentAsNumber)) {
			path = !!path ? [path, segment].join(':') : segment; // a colon can well be part of a path (e.g. C:\...)
		} else if (line === undefined) {
			line = segmentAsNumber;
		} else if (column === undefined) {
			column = segmentAsNumber;
		}
	});

	if (!path) {
		throw new Error('Format for `--goto` should be: `FILE:LINE(:COLUMN)`');
	}

	return {
		path,
		line: line !== undefined ? line : undefined,
		column: column !== undefined ? column : line !== undefined ? 1 : undefined // if we have a line, make sure column is also set
	};
}
