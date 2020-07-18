/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import * as arrays from 'vs/base/common/arrays';
import * as strings from 'vs/base/common/strings';
import * as extpath from 'vs/base/common/extpath';
import * as platform from 'vs/base/common/platform';
import * as types from 'vs/base/common/types';
import { ParsedArgs } from 'vs/platform/environment/node/argv';

export function validatePaths(args: ParsedArgs): ParsedArgs {

	// Track URLs if they're going to be used
	if (args['open-url']) {
		args._urls = args._;
		args._ = [];
	}

	// Normalize paths and watch out for goto line mode
	if (!args['remote']) {
		const paths = doValidatePaths(args._, args.goto);
		args._ = paths;
	}

	return args;
}

function doValidatePaths(args: string[], gotoLineMode?: boolean): string[] {
	const cwd = process.env['VSCODE_CWD'] || process.cwd();
	const result = args.map(arg => {
		let pathCandidate = String(arg);

		let parsedPath: extpath.IPathWithLineAndColumn | undefined = undefined;
		if (gotoLineMode) {
			parsedPath = extpath.parseLineAndColumnAware(pathCandidate);
			pathCandidate = parsedPath.path;
		}

		if (pathCandidate) {
			pathCandidate = preparePath(cwd, pathCandidate);
		}

		const sanitizedFilePath = extpath.sanitizeFilePath(pathCandidate, cwd);

		const basename = path.basename(sanitizedFilePath);
		if (basename /* can be empty if code is opened on root */ && !extpath.isValidBasename(basename)) {
			return null; // do not allow invalid file names
		}

		if (gotoLineMode && parsedPath) {
			parsedPath.path = sanitizedFilePath;

			return toPath(parsedPath);
		}

		return sanitizedFilePath;
	});

	const caseInsensitive = platform.isWindows || platform.isMacintosh;
	const distinct = arrays.distinct(result, e => e && caseInsensitive ? e.toLowerCase() : (e || ''));

	return arrays.coalesce(distinct);
}

function preparePath(cwd: string, p: string): string {

	// Trim trailing quotes
	if (platform.isWindows) {
		p = strings.rtrim(p, '"'); // https://github.com/Microsoft/vscode/issues/1498
	}

	// Trim whitespaces
	p = strings.trim(strings.trim(p, ' '), '\t');

	if (platform.isWindows) {

		// Resolve the path against cwd if it is relative
		p = path.resolve(cwd, p);

		// Trim trailing '.' chars on Windows to prevent invalid file names
		p = strings.rtrim(p, '.');
	}

	return p;
}

function toPath(p: extpath.IPathWithLineAndColumn): string {
	const segments = [p.path];

	if (types.isNumber(p.line)) {
		segments.push(String(p.line));
	}

	if (types.isNumber(p.column)) {
		segments.push(String(p.column));
	}

	return segments.join(':');
}
