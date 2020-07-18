/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vscode-uri';

export interface RequestService {
	getContent(uri: string, encoding?: string): Promise<string>;
}

export function getScheme(uri: string) {
	return uri.substr(0, uri.indexOf(':'));
}

export function dirname(uri: string) {
	const lastIndexOfSlash = uri.lastIndexOf('/');
	return lastIndexOfSlash !== -1 ? uri.substr(0, lastIndexOfSlash) : '';
}

export function basename(uri: string) {
	const lastIndexOfSlash = uri.lastIndexOf('/');
	return uri.substr(lastIndexOfSlash + 1);
}


const Slash = '/'.charCodeAt(0);
const Dot = '.'.charCodeAt(0);

export function extname(uri: string) {
	for (let i = uri.length - 1; i >= 0; i--) {
		const ch = uri.charCodeAt(i);
		if (ch === Dot) {
			if (i > 0 && uri.charCodeAt(i - 1) !== Slash) {
				return uri.substr(i);
			} else {
				break;
			}
		} else if (ch === Slash) {
			break;
		}
	}
	return '';
}

export function isAbsolutePath(path: string) {
	return path.charCodeAt(0) === Slash;
}

export function resolvePath(uriString: string, path: string): string {
	if (isAbsolutePath(path)) {
		const uri = URI.parse(uriString);
		const parts = path.split('/');
		return uri.with({ path: normalizePath(parts) }).toString();
	}
	return joinPath(uriString, path);
}

export function normalizePath(parts: string[]): string {
	const newParts: string[] = [];
	for (const part of parts) {
		if (part.length === 0 || part.length === 1 && part.charCodeAt(0) === Dot) {
			// ignore
		} else if (part.length === 2 && part.charCodeAt(0) === Dot && part.charCodeAt(1) === Dot) {
			newParts.pop();
		} else {
			newParts.push(part);
		}
	}
	if (parts.length > 1 && parts[parts.length - 1].length === 0) {
		newParts.push('');
	}
	let res = newParts.join('/');
	if (parts[0].length === 0) {
		res = '/' + res;
	}
	return res;
}

export function joinPath(uriString: string, ...paths: string[]): string {
	const uri = URI.parse(uriString);
	const parts = uri.path.split('/');
	for (let path of paths) {
		parts.push(...path.split('/'));
	}
	return uri.with({ path: normalizePath(parts) }).toString();
}
