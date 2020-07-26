/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as cp from 'child_process';
import * as path from 'vs/base/common/path';
import * as glob from 'vs/base/common/glob';
import { normalizeNFD } from 'vs/base/common/normalization';
import * as objects from 'vs/base/common/objects';
import * as extpath from 'vs/base/common/extpath';
import { isMacintosh as isMac } from 'vs/base/common/platform';
import * as strings from 'vs/base/common/strings';
import { IFileQuery, IFolderQuery } from 'vs/workbench/services/search/common/search';
import { anchorGlob } from 'vs/workbench/services/search/node/ripgrepSearchUtils';
import { rgPath } from 'vscode-ripgrep';

// If vscode-ripgrep is in an .asar file, then the binary is unpacked.
const rgDiskPath = rgPath.replace(/\bnode_modules\.asar\b/, 'node_modules.asar.unpacked');

export function spawnRipgrepCmd(config: IFileQuery, folderQuery: IFolderQuery, includePattern?: glob.IExpression, excludePattern?: glob.IExpression) {
	const rgArgs = getRgArgs(config, folderQuery, includePattern, excludePattern);
	const cwd = folderQuery.folder.fsPath;
	return {
		cmd: cp.spawn(rgDiskPath, rgArgs.args, { cwd }),
		rgDiskPath,
		siblingClauses: rgArgs.siblingClauses,
		rgArgs,
		cwd
	};
}

function getRgArgs(config: IFileQuery, folderQuery: IFolderQuery, includePattern?: glob.IExpression, excludePattern?: glob.IExpression) {
	const args = ['--files', '--hidden', '--case-sensitive'];

	// includePattern can't have siblingClauses
	foldersToIncludeGlobs([folderQuery], includePattern, false).forEach(globArg => {
		const inclusion = anchorGlob(globArg);
		args.push('-g', inclusion);
		if (isMac) {
			const normalized = normalizeNFD(inclusion);
			if (normalized !== inclusion) {
				args.push('-g', normalized);
			}
		}
	});

	const rgGlobs = foldersToRgExcludeGlobs([folderQuery], excludePattern, undefined, false);
	rgGlobs.globArgs.forEach(globArg => {
		const exclusion = `!${anchorGlob(globArg)}`;
		args.push('-g', exclusion);
		if (isMac) {
			const normalized = normalizeNFD(exclusion);
			if (normalized !== exclusion) {
				args.push('-g', normalized);
			}
		}
	});
	if (folderQuery.disregardIgnoreFiles !== false) {
		// Don't use .gitignore or .ignore
		args.push('--no-ignore');
	} else {
		args.push('--no-ignore-parent');
	}

	// Follow symlinks
	if (!folderQuery.ignoreSymlinks) {
		args.push('--follow');
	}

	if (config.exists) {
		args.push('--quiet');
	}

	args.push('--no-config');
	if (folderQuery.disregardGlobalIgnoreFiles) {
		args.push('--no-ignore-global');
	}

	return {
		args,
		siblingClauses: rgGlobs.siblingClauses
	};
}

export interface IRgGlobResult {
	globArgs: string[];
	siblingClauses: glob.IExpression;
}

export function foldersToRgExcludeGlobs(folderQueries: IFolderQuery[], globalExclude?: glob.IExpression, excludesToSkip?: Set<string>, absoluteGlobs = true): IRgGlobResult {
	const globArgs: string[] = [];
	let siblingClauses: glob.IExpression = {};
	folderQueries.forEach(folderQuery => {
		const totalExcludePattern = objects.assign({}, folderQuery.excludePattern || {}, globalExclude || {});
		const result = globExprsToRgGlobs(totalExcludePattern, absoluteGlobs ? folderQuery.folder.fsPath : undefined, excludesToSkip);
		globArgs.push(...result.globArgs);
		if (result.siblingClauses) {
			siblingClauses = objects.assign(siblingClauses, result.siblingClauses);
		}
	});

	return { globArgs, siblingClauses };
}

export function foldersToIncludeGlobs(folderQueries: IFolderQuery[], globalInclude?: glob.IExpression, absoluteGlobs = true): string[] {
	const globArgs: string[] = [];
	folderQueries.forEach(folderQuery => {
		const totalIncludePattern = objects.assign({}, globalInclude || {}, folderQuery.includePattern || {});
		const result = globExprsToRgGlobs(totalIncludePattern, absoluteGlobs ? folderQuery.folder.fsPath : undefined);
		globArgs.push(...result.globArgs);
	});

	return globArgs;
}

function globExprsToRgGlobs(patterns: glob.IExpression, folder?: string, excludesToSkip?: Set<string>): IRgGlobResult {
	const globArgs: string[] = [];
	const siblingClauses: glob.IExpression = {};
	Object.keys(patterns)
		.forEach(key => {
			if (excludesToSkip && excludesToSkip.has(key)) {
				return;
			}

			if (!key) {
				return;
			}

			const value = patterns[key];
			key = trimTrailingSlash(folder ? getAbsoluteGlob(folder, key) : key);

			// glob.ts requires forward slashes, but a UNC path still must start with \\
			// #38165 and #38151
			if (key.startsWith('\\\\')) {
				key = '\\\\' + key.substr(2).replace(/\\/g, '/');
			} else {
				key = key.replace(/\\/g, '/');
			}

			if (typeof value === 'boolean' && value) {
				if (key.startsWith('\\\\')) {
					// Absolute globs UNC paths don't work properly, see #58758
					key += '**';
				}

				globArgs.push(fixDriveC(key));
			} else if (value && value.when) {
				siblingClauses[key] = value;
			}
		});

	return { globArgs, siblingClauses };
}

/**
 * Resolves a glob like "node_modules/**" in "/foo/bar" to "/foo/bar/node_modules/**".
 * Special cases C:/foo paths to write the glob like /foo instead - see https://github.com/BurntSushi/ripgrep/issues/530.
 *
 * Exported for testing
 */
export function getAbsoluteGlob(folder: string, key: string): string {
	return path.isAbsolute(key) ?
		key :
		path.join(folder, key);
}

function trimTrailingSlash(str: string): string {
	str = strings.rtrim(str, '\\');
	return strings.rtrim(str, '/');
}

export function fixDriveC(path: string): string {
	const root = extpath.getRoot(path);
	return root.toLowerCase() === 'c:/' ?
		path.replace(/^c:[/\\]/i, '/') :
		path;
}
