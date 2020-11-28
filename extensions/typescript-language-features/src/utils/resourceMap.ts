/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import * as fileSchemes from '../utils/fileSchemes';

/**
 * Maps of file resources
 *
 * Attempts to handle correct mapping on both case sensitive and case in-sensitive
 * file systems.
 */
export class ResourceMap<T> {

	private static readonly defaultPathNormalizer = (resource: vscode.Uri): string => {
		if (resource.scheme === fileSchemes.file) {
			return resource.fsPath;
		}
		return resource.toString(true);
	};

	private readonly _map = new Map<string, { readonly resource: vscode.Uri, value: T }>();

	constructor(
		protected readonly _normalizePath: (resource: vscode.Uri) => string | undefined = ResourceMap.defaultPathNormalizer,
		protected readonly config: {
			readonly onCaseInsenitiveFileSystem: boolean,
		},
	) { }

	public get size() {
		return this._map.size;
	}

	public has(resource: vscode.Uri): boolean {
		const file = this.toKey(resource);
		return !!file && this._map.has(file);
	}

	public get(resource: vscode.Uri): T | undefined {
		const file = this.toKey(resource);
		if (!file) {
			return undefined;
		}
		const entry = this._map.get(file);
		return entry ? entry.value : undefined;
	}

	public set(resource: vscode.Uri, value: T) {
		const file = this.toKey(resource);
		if (!file) {
			return;
		}
		const entry = this._map.get(file);
		if (entry) {
			entry.value = value;
		} else {
			this._map.set(file, { resource, value });
		}
	}

	public delete(resource: vscode.Uri): void {
		const file = this.toKey(resource);
		if (file) {
			this._map.delete(file);
		}
	}

	public clear(): void {
		this._map.clear();
	}

	public get values(): Iterable<T> {
		return Array.from(this._map.values()).map(x => x.value);
	}

	public get entries(): Iterable<{ resource: vscode.Uri, value: T }> {
		return this._map.values();
	}

	private toKey(resource: vscode.Uri): string | undefined {
		const key = this._normalizePath(resource);
		if (!key) {
			return key;
		}
		return this.isCaseInsensitivePath(key) ? key.toLowerCase() : key;
	}

	private isCaseInsensitivePath(path: string) {
		if (isWindowsPath(path)) {
			return true;
		}
		return path[0] === '/' && this.config.onCaseInsenitiveFileSystem;
	}
}

function isWindowsPath(path: string): boolean {
	return /^[a-zA-Z]:[\/\\]/.test(path);
}
