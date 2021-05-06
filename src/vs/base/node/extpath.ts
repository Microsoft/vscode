/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { promisify } from 'util';
import { rtrim } from 'vs/base/common/strings';
import { sep, join, normalize, dirname, basename } from 'vs/base/common/path';
import { readdirSync } from 'vs/base/node/pfs';

/**
 * Copied from: https://github.com/microsoft/vscode-node-debug/blob/master/src/node/pathUtilities.ts#L83
 *
 * Given an absolute, normalized, and existing file path 'realcase' returns the exact path that the file has on disk.
 * On a case insensitive file system, the returned path might differ from the original path by character casing.
 * On a case sensitive file system, the returned path will always be identical to the original path.
 * In case of errors, null is returned. But you cannot use this function to verify that a path exists.
 * realcaseSync does not handle '..' or '.' path segments and it does not take the locale into account.
 */
export function realcaseSync(path: string): string | null {
	const dir = dirname(path);
	if (path === dir) {	// end recursion
		return path;
	}

	const name = (basename(path) /* can be '' for windows drive letters */ || path).toLowerCase();
	try {
		const entries = readdirSync(dir);
		const found = entries.filter(e => e.toLowerCase() === name);	// use a case insensitive search
		if (found.length === 1) {
			// on a case sensitive filesystem we cannot determine here, whether the file exists or not, hence we need the 'file exists' precondition
			const prefix = realcaseSync(dir);   // recurse
			if (prefix) {
				return join(prefix, found[0]);
			}
		} else if (found.length > 1) {
			// must be a case sensitive $filesystem
			const ix = found.indexOf(name);
			if (ix >= 0) {	// case sensitive
				const prefix = realcaseSync(dir);   // recurse
				if (prefix) {
					return join(prefix, found[ix]);
				}
			}
		}
	} catch (error) {
		// silently ignore error
	}

	return null;
}

export async function realpath(path: string): Promise<string> {
	try {
		// DO NOT USE `fs.promises.realpath` here as it internally
		// calls `fs.native.realpath` which will result in subst
		// drives to be resolved to their target on Windows
		// https://github.com/microsoft/vscode/issues/118562
		return await promisify(fs.realpath)(path);
	} catch (error) {

		// We hit an error calling fs.realpath(). Since fs.realpath() is doing some path normalization
		// we now do a similar normalization and then try again if we can access the path with read
		// permissions at least. If that succeeds, we return that path.
		// fs.realpath() is resolving symlinks and that can fail in certain cases. The workaround is
		// to not resolve links but to simply see if the path is read accessible or not.
		const normalizedPath = normalizePath(path);

		await fs.promises.access(normalizedPath, fs.constants.R_OK);

		return normalizedPath;
	}
}

export function realpathSync(path: string): string {
	try {
		return fs.realpathSync(path);
	} catch (error) {

		// We hit an error calling fs.realpathSync(). Since fs.realpathSync() is doing some path normalization
		// we now do a similar normalization and then try again if we can access the path with read
		// permissions at least. If that succeeds, we return that path.
		// fs.realpath() is resolving symlinks and that can fail in certain cases. The workaround is
		// to not resolve links but to simply see if the path is read accessible or not.
		const normalizedPath = normalizePath(path);
		fs.accessSync(normalizedPath, fs.constants.R_OK); // throws in case of an error

		return normalizedPath;
	}
}

function normalizePath(path: string): string {
	return rtrim(normalize(path), sep);
}
