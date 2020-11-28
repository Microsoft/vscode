/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { posix, normalize, win32, sep } from 'vs/base/common/path';
import { startsWithIgnoreCase, rtrim } from 'vs/base/common/strings';
import { Schemas } from 'vs/base/common/network';
import { isLinux, isWindows, isMacintosh } from 'vs/base/common/platform';
import { isEqual, basename, relativePath } from 'vs/base/common/resources';

export interface IWorkspaceFolderProvider {
	getWorkspaceFolder(resource: URI): { uri: URI, name?: string } | null;
	getWorkspace(): {
		folders: { uri: URI, name?: string }[];
	};
}

export interface IUserHomeProvider {
	userHome?: URI;
}

/**
 * @deprecated use LabelService instead
 */
export function getPathLabel(resource: URI | string, userHomeProvider?: IUserHomeProvider, rootProvider?: IWorkspaceFolderProvider): string {
	if (typeof resource === 'string') {
		resource = URI.file(resource);
	}

	// return early if we can resolve a relative path label from the root
	if (rootProvider) {
		const baseResource = rootProvider.getWorkspaceFolder(resource);
		if (baseResource) {
			const hasMultipleRoots = rootProvider.getWorkspace().folders.length > 1;

			let pathLabel: string;
			if (isEqual(baseResource.uri, resource)) {
				pathLabel = ''; // no label if paths are identical
			} else {
				pathLabel = relativePath(baseResource.uri, resource)!;
			}

			if (hasMultipleRoots) {
				const rootName = baseResource.name ? baseResource.name : basename(baseResource.uri);
				pathLabel = pathLabel ? (rootName + ' • ' + pathLabel) : rootName; // always show root basename if there are multiple
			}

			return pathLabel;
		}
	}

	// return if the resource is neither file:// nor untitled:// and no baseResource was provided
	if (resource.scheme !== Schemas.file && resource.scheme !== Schemas.untitled) {
		return resource.with({ query: null, fragment: null }).toString(true);
	}

	// convert c:\something => C:\something
	if (hasDriveLetter(resource.fsPath)) {
		return normalize(normalizeDriveLetter(resource.fsPath));
	}

	// normalize and tildify (macOS, Linux only)
	let res = normalize(resource.fsPath);
	if (!isWindows && userHomeProvider?.userHome) {
		res = tildify(res, userHomeProvider.userHome.fsPath);
	}

	return res;
}

export function getBaseLabel(resource: URI | string): string;
export function getBaseLabel(resource: URI | string | undefined): string | undefined;
export function getBaseLabel(resource: URI | string | undefined): string | undefined {
	if (!resource) {
		return undefined;
	}

	if (typeof resource === 'string') {
		resource = URI.file(resource);
	}

	const base = basename(resource) || (resource.scheme === Schemas.file ? resource.fsPath : resource.path) /* can be empty string if '/' is passed in */;

	// convert c: => C:
	if (hasDriveLetter(base)) {
		return normalizeDriveLetter(base);
	}

	return base;
}

function hasDriveLetter(path: string): boolean {
	return !!(isWindows && path && path[1] === ':');
}

export function extractDriveLetter(path: string): string | undefined {
	return hasDriveLetter(path) ? path[0] : undefined;
}

export function normalizeDriveLetter(path: string): string {
	if (hasDriveLetter(path)) {
		return path.charAt(0).toUpperCase() + path.slice(1);
	}

	return path;
}

let normalizedUserHomeCached: { original: string; normalized: string } = Object.create(null);
export function tildify(path: string, userHome: string): string {
	if (isWindows || !path || !userHome) {
		return path; // unsupported
	}

	// Keep a normalized user home path as cache to prevent accumulated string creation
	let normalizedUserHome = normalizedUserHomeCached.original === userHome ? normalizedUserHomeCached.normalized : undefined;
	if (!normalizedUserHome) {
		normalizedUserHome = `${rtrim(userHome, posix.sep)}${posix.sep}`;
		normalizedUserHomeCached = { original: userHome, normalized: normalizedUserHome };
	}

	// Linux: case sensitive, macOS: case insensitive
	if (isLinux ? path.startsWith(normalizedUserHome) : startsWithIgnoreCase(path, normalizedUserHome)) {
		path = `~/${path.substr(normalizedUserHome.length)}`;
	}

	return path;
}

export function untildify(path: string, userHome: string): string {
	return path.replace(/^~($|\/|\\)/, `${userHome}$1`);
}

/**
 * Shortens the paths but keeps them easy to distinguish.
 * Replaces not important parts with ellipsis.
 * Every shorten path matches only one original path and vice versa.
 *
 * Algorithm for shortening paths is as follows:
 * 1. For every path in list, find unique substring of that path.
 * 2. Unique substring along with ellipsis is shortened path of that path.
 * 3. To find unique substring of path, consider every segment of length from 1 to path.length of path from end of string
 *    and if present segment is not substring to any other paths then present segment is unique path,
 *    else check if it is not present as suffix of any other path and present segment is suffix of path itself,
 *    if it is true take present segment as unique path.
 * 4. Apply ellipsis to unique segment according to whether segment is present at start/in-between/end of path.
 *
 * Example 1
 * 1. consider 2 paths i.e. ['a\\b\\c\\d', 'a\\f\\b\\c\\d']
 * 2. find unique path of first path,
 * 	a. 'd' is present in path2 and is suffix of path2, hence not unique of present path.
 * 	b. 'c' is present in path2 and 'c' is not suffix of present path, similarly for 'b' and 'a' also.
 * 	c. 'd\\c' is suffix of path2.
 *  d. 'b\\c' is not suffix of present path.
 *  e. 'a\\b' is not present in path2, hence unique path is 'a\\b...'.
 * 3. for path2, 'f' is not present in path1 hence unique is '...\\f\\...'.
 *
 * Example 2
 * 1. consider 2 paths i.e. ['a\\b', 'a\\b\\c'].
 * 	a. Even if 'b' is present in path2, as 'b' is suffix of path1 and is not suffix of path2, unique path will be '...\\b'.
 * 2. for path2, 'c' is not present in path1 hence unique path is '..\\c'.
 */
const ellipsis = '\u2026';
const unc = '\\\\';
const home = '~';
export function shorten(paths: string[], pathSeparator: string = sep): string[] {
	const shortenedPaths: string[] = new Array(paths.length);

	// for every path
	let match = false;
	for (let pathIndex = 0; pathIndex < paths.length; pathIndex++) {
		let path = paths[pathIndex];

		if (path === '') {
			shortenedPaths[pathIndex] = `.${pathSeparator}`;
			continue;
		}

		if (!path) {
			shortenedPaths[pathIndex] = path;
			continue;
		}

		match = true;

		// trim for now and concatenate unc path (e.g. \\network) or root path (/etc, ~/etc) later
		let prefix = '';
		if (path.indexOf(unc) === 0) {
			prefix = path.substr(0, path.indexOf(unc) + unc.length);
			path = path.substr(path.indexOf(unc) + unc.length);
		} else if (path.indexOf(pathSeparator) === 0) {
			prefix = path.substr(0, path.indexOf(pathSeparator) + pathSeparator.length);
			path = path.substr(path.indexOf(pathSeparator) + pathSeparator.length);
		} else if (path.indexOf(home) === 0) {
			prefix = path.substr(0, path.indexOf(home) + home.length);
			path = path.substr(path.indexOf(home) + home.length);
		}

		// pick the first shortest subpath found
		const segments: string[] = path.split(pathSeparator);
		for (let subpathLength = 1; match && subpathLength <= segments.length; subpathLength++) {
			for (let start = segments.length - subpathLength; match && start >= 0; start--) {
				match = false;
				let subpath = segments.slice(start, start + subpathLength).join(pathSeparator);

				// that is unique to any other path
				for (let otherPathIndex = 0; !match && otherPathIndex < paths.length; otherPathIndex++) {

					// suffix subpath treated specially as we consider no match 'x' and 'x/...'
					if (otherPathIndex !== pathIndex && paths[otherPathIndex] && paths[otherPathIndex].indexOf(subpath) > -1) {
						const isSubpathEnding: boolean = (start + subpathLength === segments.length);

						// Adding separator as prefix for subpath, such that 'endsWith(src, trgt)' considers subpath as directory name instead of plain string.
						// prefix is not added when either subpath is root directory or path[otherPathIndex] does not have multiple directories.
						const subpathWithSep: string = (start > 0 && paths[otherPathIndex].indexOf(pathSeparator) > -1) ? pathSeparator + subpath : subpath;
						const isOtherPathEnding: boolean = paths[otherPathIndex].endsWith(subpathWithSep);

						match = !isSubpathEnding || isOtherPathEnding;
					}
				}

				// found unique subpath
				if (!match) {
					let result = '';

					// preserve disk drive or root prefix
					if (segments[0].endsWith(':') || prefix !== '') {
						if (start === 1) {
							// extend subpath to include disk drive prefix
							start = 0;
							subpathLength++;
							subpath = segments[0] + pathSeparator + subpath;
						}

						if (start > 0) {
							result = segments[0] + pathSeparator;
						}

						result = prefix + result;
					}

					// add ellipsis at the beginning if neeeded
					if (start > 0) {
						result = result + ellipsis + pathSeparator;
					}

					result = result + subpath;

					// add ellipsis at the end if needed
					if (start + subpathLength < segments.length) {
						result = result + pathSeparator + ellipsis;
					}

					shortenedPaths[pathIndex] = result;
				}
			}
		}

		if (match) {
			shortenedPaths[pathIndex] = path; // use full path if no unique subpaths found
		}
	}

	return shortenedPaths;
}

export interface ISeparator {
	label: string;
}

enum Type {
	TEXT,
	VARIABLE,
	SEPARATOR
}

interface ISegment {
	value: string;
	type: Type;
}

/**
 * Helper to insert values for specific template variables into the string. E.g. "this $(is) a $(template)" can be
 * passed to this function together with an object that maps "is" and "template" to strings to have them replaced.
 * @param value string to which templating is applied
 * @param values the values of the templates to use
 */
export function template(template: string, values: { [key: string]: string | ISeparator | undefined | null } = Object.create(null)): string {
	const segments: ISegment[] = [];

	let inVariable = false;
	let curVal = '';
	for (const char of template) {
		// Beginning of variable
		if (char === '$' || (inVariable && char === '{')) {
			if (curVal) {
				segments.push({ value: curVal, type: Type.TEXT });
			}

			curVal = '';
			inVariable = true;
		}

		// End of variable
		else if (char === '}' && inVariable) {
			const resolved = values[curVal];

			// Variable
			if (typeof resolved === 'string') {
				if (resolved.length) {
					segments.push({ value: resolved, type: Type.VARIABLE });
				}
			}

			// Separator
			else if (resolved) {
				const prevSegment = segments[segments.length - 1];
				if (!prevSegment || prevSegment.type !== Type.SEPARATOR) {
					segments.push({ value: resolved.label, type: Type.SEPARATOR }); // prevent duplicate separators
				}
			}

			curVal = '';
			inVariable = false;
		}

		// Text or Variable Name
		else {
			curVal += char;
		}
	}

	// Tail
	if (curVal && !inVariable) {
		segments.push({ value: curVal, type: Type.TEXT });
	}

	return segments.filter((segment, index) => {

		// Only keep separator if we have values to the left and right
		if (segment.type === Type.SEPARATOR) {
			const left = segments[index - 1];
			const right = segments[index + 1];

			return [left, right].every(segment => segment && (segment.type === Type.VARIABLE || segment.type === Type.TEXT) && segment.value.length > 0);
		}

		// accept any TEXT and VARIABLE
		return true;
	}).map(segment => segment.value).join('');
}

/**
 * Handles mnemonics for menu items. Depending on OS:
 * - Windows: Supported via & character (replace && with &)
 * -   Linux: Supported via & character (replace && with &)
 * -   macOS: Unsupported (replace && with empty string)
 */
export function mnemonicMenuLabel(label: string, forceDisableMnemonics?: boolean): string {
	if (isMacintosh || forceDisableMnemonics) {
		return label.replace(/\(&&\w\)|&&/g, '').replace(/&/g, isMacintosh ? '&' : '&&');
	}

	return label.replace(/&&|&/g, m => m === '&' ? '&&' : '&');
}

/**
 * Handles mnemonics for buttons. Depending on OS:
 * - Windows: Supported via & character (replace && with & and & with && for escaping)
 * -   Linux: Supported via _ character (replace && with _)
 * -   macOS: Unsupported (replace && with empty string)
 */
export function mnemonicButtonLabel(label: string, forceDisableMnemonics?: boolean): string {
	if (isMacintosh || forceDisableMnemonics) {
		return label.replace(/\(&&\w\)|&&/g, '');
	}

	if (isWindows) {
		return label.replace(/&&|&/g, m => m === '&' ? '&&' : '&');
	}

	return label.replace(/&&/g, '_');
}

export function unmnemonicLabel(label: string): string {
	return label.replace(/&/g, '&&');
}

/**
 * Splits a path in name and parent path, supporting both '/' and '\'
 */
export function splitName(fullPath: string): { name: string, parentPath: string } {
	const p = fullPath.indexOf('/') !== -1 ? posix : win32;
	const name = p.basename(fullPath);
	const parentPath = p.dirname(fullPath);
	if (name.length) {
		return { name, parentPath };
	}
	// only the root segment
	return { name: parentPath, parentPath: '' };
}
