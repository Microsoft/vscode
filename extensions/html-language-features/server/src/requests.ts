/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vscode-uri';
import { RequestType, Connection } from 'vscode-languageserver';
import { RuntimeEnvironment } from './htmlServer';

export namespace FsContentRequest {
	export const type: RequestType<{ uri: string; encoding?: string; }, string, any, any> = new RequestType('fs/content');
}
export namespace FsStatRequest {
	export const type: RequestType<string, FileStat, any, any> = new RequestType('fs/stat');
}

export namespace FsReadDirRequest {
	export const type: RequestType<string, [string, FileType][], any, any> = new RequestType('fs/readDir');
}

export enum FileType {
	/**
	 * The file type is unknown.
	 */
	Unknown = 0,
	/**
	 * A regular file.
	 */
	File = 1,
	/**
	 * A directory.
	 */
	Directory = 2,
	/**
	 * A symbolic link to a file.
	 */
	SymbolicLink = 64
}
export interface FileStat {
	/**
	 * The type of the file, e.g. is a regular file, a directory, or symbolic link
	 * to a file.
	 */
	type: FileType;
	/**
	 * The creation timestamp in milliseconds elapsed since January 1, 1970 00:00:00 UTC.
	 */
	ctime: number;
	/**
	 * The modification timestamp in milliseconds elapsed since January 1, 1970 00:00:00 UTC.
	 */
	mtime: number;
	/**
	 * The size in bytes.
	 */
	size: number;
}

export interface RequestService {
	getContent(uri: string, encoding?: string): Promise<string>;

	stat(uri: string): Promise<FileStat>;
	readDirectory(uri: string): Promise<[string, FileType][]>;
}


export function getRequestService(handledSchemas: string[], connection: Connection, runtime: RuntimeEnvironment): RequestService {
	const builtInHandlers: { [protocol: string]: RequestService | undefined } = {};
	for (let protocol of handledSchemas) {
		if (protocol === 'file') {
			builtInHandlers[protocol] = runtime.file;
		} else if (protocol === 'http' || protocol === 'https') {
			builtInHandlers[protocol] = runtime.http;
		}
	}
	return {
		async stat(uri: string): Promise<FileStat> {
			const handler = builtInHandlers[getScheme(uri)];
			if (handler) {
				return handler.stat(uri);
			}
			const res = await connection.sendRequest(FsStatRequest.type, uri.toString());
			return res;
		},
		readDirectory(uri: string): Promise<[string, FileType][]> {
			const handler = builtInHandlers[getScheme(uri)];
			if (handler) {
				return handler.readDirectory(uri);
			}
			return connection.sendRequest(FsReadDirRequest.type, uri.toString());
		},
		getContent(uri: string, encoding?: string): Promise<string> {
			const handler = builtInHandlers[getScheme(uri)];
			if (handler) {
				return handler.getContent(uri, encoding);
			}
			return connection.sendRequest(FsContentRequest.type, { uri: uri.toString(), encoding });
		}
	};
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
