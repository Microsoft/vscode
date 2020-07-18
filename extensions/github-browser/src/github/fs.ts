/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import {
	CancellationToken,
	Disposable,
	Event,
	EventEmitter,
	FileChangeEvent,
	FileSearchOptions,
	FileSearchProvider,
	FileSearchQuery,
	FileStat,
	FileSystemError,
	FileSystemProvider,
	FileType,
	Progress,
	TextSearchComplete,
	TextSearchOptions,
	TextSearchProvider,
	TextSearchQuery,
	TextSearchResult,
	Uri,
	workspace,
} from 'vscode';
import * as fuzzySort from 'fuzzysort';
import fetch from 'node-fetch';
import { GitHubApi } from './api';
import { Iterables } from '../iterables';
import { getRootUri } from '../extension';

const emptyDisposable = { dispose: () => { /* noop */ } };
const replaceBackslashRegex = /(\/|\\)/g;
const textEncoder = new TextEncoder();

interface Fuzzysort extends Fuzzysort.Fuzzysort {
	prepareSlow(target: string): Fuzzysort.Prepared;
	cleanup(): void;
}

export class GitHubFS implements FileSystemProvider, FileSearchProvider, TextSearchProvider, Disposable {
	static scheme = 'github';

	private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
	get onDidChangeFile(): Event<FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}

	private readonly disposable: Disposable;
	private fsCache = new Map<string, Map<string, any>>();

	constructor(private readonly github: GitHubApi) {
		this.disposable = Disposable.from(
			workspace.registerFileSystemProvider(GitHubFS.scheme, this, {
				isCaseSensitive: true,
				isReadonly: true
			}),
			workspace.registerFileSearchProvider(GitHubFS.scheme, this),
			workspace.registerTextSearchProvider(GitHubFS.scheme, this),
			github.onDidChangeContext(e => this.fsCache.delete(e.toString()))
		);
	}

	dispose() {
		this.disposable?.dispose();
	}

	private getCache(uri: Uri) {
		const rootUri = getRootUri(uri);
		if (rootUri === undefined) {
			return undefined;
		}

		let cache = this.fsCache.get(rootUri.toString());
		if (cache === undefined) {
			cache = new Map<string, any>();
			this.fsCache.set(rootUri.toString(), cache);
		}
		return cache;
	}

	//#region FileSystemProvider

	watch(): Disposable {
		return emptyDisposable;
	}

	async stat(uri: Uri): Promise<FileStat> {
		if (uri.path === '' || uri.path.lastIndexOf('/') === 0) {
			const context = await this.github.getContext(uri);
			return { type: FileType.Directory, size: 0, ctime: 0, mtime: context?.timestamp };
		}

		const data = await this.fsQuery<{
			__typename: string;
			byteSize: number | undefined;
		}>(
			uri,
			`__typename
			...on Blob {
				byteSize
			}`,
			this.getCache(uri),
		);

		if (data === undefined) {
			throw FileSystemError.FileNotFound();
		}

		const context = await this.github.getContext(uri);

		return {
			type: typenameToFileType(data.__typename),
			size: data.byteSize ?? 0,
			ctime: 0,
			mtime: context?.timestamp,
		};
	}

	async readDirectory(uri: Uri): Promise<[string, FileType][]> {
		const data = await this.fsQuery<{
			entries: { name: string; type: string }[];
		}>(
			uri,
			`... on Tree {
				entries {
					name
					type
				}
			}`,
			this.getCache(uri),
		);

		return (data?.entries ?? []).map<[string, FileType]>(e => [
			e.name,
			typenameToFileType(e.type),
		]);
	}

	createDirectory(_uri: Uri): void | Thenable<void> {
		throw FileSystemError.NoPermissions();
	}

	async readFile(uri: Uri): Promise<Uint8Array> {
		const data = await this.fsQuery<{
			oid: string;
			isBinary: boolean;
			text: string;
		}>(
			uri,
			`... on Blob {
				oid,
				isBinary,
				text
			}`,
		);

		if (data?.isBinary) {
			const { owner, repo, path } = fromGitHubUri(uri);
			// e.g. https://raw.githubusercontent.com/eamodio/vscode-gitlens/HEAD/images/gitlens-icon.png
			const downloadUri = uri.with({
				scheme: 'https',
				authority: 'raw.githubusercontent.com',
				path: `/${owner}/${repo}/HEAD/${path}`,
			});

			return downloadBinary(downloadUri);
		}

		return textEncoder.encode(data?.text ?? '');
	}

	async writeFile(_uri: Uri, _content: Uint8Array, _options: { create: boolean, overwrite: boolean }): Promise<void> {
		throw FileSystemError.NoPermissions();
	}

	delete(_uri: Uri, _options: { recursive: boolean }): void | Thenable<void> {
		throw FileSystemError.NoPermissions();
	}

	rename(_oldUri: Uri, _newUri: Uri, _options: { overwrite: boolean }): void | Thenable<void> {
		throw FileSystemError.NoPermissions();
	}

	copy(_source: Uri, _destination: Uri, _options: { overwrite: boolean }): void | Thenable<void> {
		throw FileSystemError.NoPermissions();
	}

	//#endregion

	//#region FileSearchProvider

	private fileSearchCache = new Map<string, Fuzzysort.Prepared[]>();

	async provideFileSearchResults(
		query: FileSearchQuery,
		options: FileSearchOptions,
		token: CancellationToken,
	): Promise<Uri[]> {
		let searchable = this.fileSearchCache.get(options.folder.toString(true));
		if (searchable === undefined) {
			const matches = await this.github.filesQuery(options.folder);
			if (matches === undefined || token.isCancellationRequested) {
				return [];
			}

			searchable = [...Iterables.map(matches, m => (fuzzySort as Fuzzysort).prepareSlow(m))];
			this.fileSearchCache.set(options.folder.toString(true), searchable);
		}

		if (options.maxResults === undefined || options.maxResults === 0 || options.maxResults >= searchable.length) {
			const results = searchable.map(m => Uri.joinPath(options.folder, m.target));
			return results;
		}

		const results = fuzzySort
			.go(query.pattern.replace(replaceBackslashRegex, '/'), searchable, {
				allowTypo: true,
				limit: options.maxResults,
			})
			.map(m => Uri.joinPath(options.folder, m.target));

		(fuzzySort as Fuzzysort).cleanup();

		return results;
	}

	//#endregion

	//#region TextSearchProvider

	async provideTextSearchResults(
		query: TextSearchQuery,
		options: TextSearchOptions,
		progress: Progress<TextSearchResult>,
		_token: CancellationToken,
	): Promise<TextSearchComplete> {
		const results = await this.github.searchQuery(
			query.pattern,
			options.folder,
			{ maxResults: options.maxResults, context: { before: options.beforeContext, after: options.afterContext } },
		);
		if (results === undefined) { return { limitHit: true }; }

		let uri;
		for (const m of results.matches) {
			uri = Uri.joinPath(options.folder, m.path);

			progress.report({
				uri: uri,
				ranges: m.ranges,
				preview: {
					text: m.preview,
					matches: m.matches,
				},
			});
		}

		return { limitHit: false };
	}

	//#endregion

	private async fsQuery<T>(uri: Uri, query: string, cache?: Map<string, any>): Promise<T | undefined> {
		const key = `${uri.toString()}:${getHashCode(query)}`;

		let data = cache?.get(key);
		if (data !== undefined) {
			return data as T;
		}

		data = await this.github.fsQuery<T>(uri, query);
		cache?.set(key, data);
		return data;
	}
}

async function downloadBinary(uri: Uri) {
	const resp = await fetch(uri.toString());
	const array = new Uint8Array(await resp.arrayBuffer());
	return array;
}

function typenameToFileType(typename: string | undefined | null) {
	if (typename) {
		typename = typename.toLocaleLowerCase();
	}

	switch (typename) {
		case 'blob':
			return FileType.File;
		case 'tree':
			return FileType.Directory;
		default:
			return FileType.Unknown;
	}
}

type RepoInfo = { owner: string; repo: string; path: string | undefined; ref: string };
export function fromGitHubUri(uri: Uri): RepoInfo {
	const [, owner, repo, ...rest] = uri.path.split('/');

	let ref;
	if (uri.authority) {
		ref = uri.authority;
		// The casing of HEAD is important for the GitHub api to work
		if (/HEAD/i.test(ref)) {
			ref = 'HEAD';
		}
	}
	return { owner: owner, repo: repo, path: rest.join('/'), ref: ref ?? 'HEAD' };
}

function getHashCode(s: string): number {
	let hash = 0;

	if (s.length === 0) {
		return hash;
	}

	let char;
	const len = s.length;
	for (let i = 0; i < len; i++) {
		char = s.charCodeAt(i);
		hash = ((hash << 5) - hash) + char;
		hash |= 0; // Convert to 32bit integer
	}
	return hash;
}
