/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

export function escapeNonWindowsPath(path: string): string {
	let newPath = path;
	if (newPath.indexOf('\\') !== 0) {
		newPath = newPath.replace(/\\/g, '\\\\');
	}
	const bannedChars = /[\`\$\|\&\>\~\#\!\^\*\;\<\"\']/g;
	newPath = newPath.replace(bannedChars, '');
	return `'${newPath}'`;
}
