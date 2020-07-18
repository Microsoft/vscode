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
	FileChangeType,
	FileSearchOptions,
	FileSearchProvider,
	FileSearchQuery,
	FileStat,
	FileSystemError,
	FileSystemProvider,
	FileType,
	Progress,
	TextSearchOptions,
	TextSearchProvider,
	TextSearchQuery,
	TextSearchResult,
	Uri,
	workspace,
} from 'vscode';
import { IWritableChangeStore } from './changeStore';
import { ContextStore } from './contextStore';
import { GitHubApiContext } from './github/api';

const emptyDisposable = { dispose: () => { /* noop */ } };
const textEncoder = new TextEncoder();

export class VirtualFS implements FileSystemProvider, FileSearchProvider, TextSearchProvider, Disposable {
	private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
	get onDidChangeFile(): Event<FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}

	private readonly disposable: Disposable;

	constructor(
		readonly scheme: string,
		private readonly contextStore: ContextStore<GitHubApiContext>,
		private readonly changeStore: IWritableChangeStore,
		private readonly fs: FileSystemProvider & FileSearchProvider & TextSearchProvider
	) {
		// TODO@eamodio listen for workspace folder changes
		for (const context of contextStore.getForWorkspace()) {
			// If we have a saved context, but no longer have any changes, reset the context
			// We only do this on startup/reload to keep things consistent
			if (!changeStore.hasChanges(context.folderUri)) {
				console.log('Clear context', context.folderUri.toString());
				contextStore.delete(context.folderUri);
			}
		}

		this.disposable = Disposable.from(
			workspace.registerFileSystemProvider(scheme, this, { isCaseSensitive: true }),
			workspace.registerFileSearchProvider(scheme, this),
			workspace.registerTextSearchProvider(scheme, this),
			changeStore.onDidChange(e => {
				switch (e.type) {
					case 'created':
						this._onDidChangeFile.fire([{ type: FileChangeType.Created, uri: e.uri }]);
						break;
					case 'changed':
						this._onDidChangeFile.fire([{ type: FileChangeType.Changed, uri: e.uri }]);
						break;
					case 'deleted':
						this._onDidChangeFile.fire([{ type: FileChangeType.Deleted, uri: e.uri }]);
						break;
				}
			}),
		);
	}

	dispose() {
		this.disposable?.dispose();
	}

	private getOriginalResource(uri: Uri): Uri {
		return this.contextStore.getOriginalResource(uri);
	}

	private getWorkspaceResource(uri: Uri): Uri {
		return this.contextStore.getWorkspaceResource(uri);
	}

	//#region FileSystemProvider

	watch(): Disposable {
		return emptyDisposable;
	}

	async stat(uri: Uri): Promise<FileStat> {
		let stat = this.changeStore.getStat(uri);
		if (stat !== undefined) {
			return stat;
		}

		stat = await this.fs.stat(this.getOriginalResource(uri));
		return stat;
	}

	async readDirectory(uri: Uri): Promise<[string, FileType][]> {
		let entries = await this.fs.readDirectory(this.getOriginalResource(uri));
		entries = this.changeStore.updateDirectoryEntries(uri, entries);
		return entries;
	}

	createDirectory(_uri: Uri): void | Thenable<void> {
		// TODO@eamodio only support files for now
		throw FileSystemError.NoPermissions();
	}

	async readFile(uri: Uri): Promise<Uint8Array> {
		const content = this.changeStore.getContent(uri);
		if (content !== undefined) {
			return textEncoder.encode(content);
		}

		const data = await this.fs.readFile(this.getOriginalResource(uri));
		return data;
	}

	async writeFile(uri: Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): Promise<void> {
		let stat;
		try {
			stat = await this.stat(uri);
			if (!options.overwrite) {
				throw FileSystemError.FileExists();
			}
		} catch (ex) {
			if (ex instanceof FileSystemError && ex.code === 'FileNotFound') {
				if (!options.create) {
					throw FileSystemError.FileNotFound();
				}
			} else {
				throw ex;
			}
		}

		if (stat === undefined) {
			await this.changeStore.onFileCreated(uri, content);
		} else {
			await this.changeStore.onFileChanged(uri, content, () => this.fs.readFile(this.getOriginalResource(uri)));
		}
	}

	async delete(uri: Uri, _options: { recursive: boolean }): Promise<void> {
		const stat = await this.stat(uri);
		if (stat.type !== FileType.File) {
			throw FileSystemError.NoPermissions();
		}

		await this.changeStore.onFileDeleted(uri);
	}

	async rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): Promise<void> {
		const stat = await this.stat(oldUri);
		// TODO@eamodio only support files for now
		if (stat.type !== FileType.File) {
			throw FileSystemError.NoPermissions();
		}

		const content = await this.readFile(oldUri);
		await this.writeFile(newUri, content, { create: true, overwrite: options.overwrite });
		await this.delete(oldUri, { recursive: false });
	}

	async copy(source: Uri, destination: Uri, options: { overwrite: boolean }): Promise<void> {
		const stat = await this.stat(source);
		// TODO@eamodio only support files for now
		if (stat.type !== FileType.File) {
			throw FileSystemError.NoPermissions();
		}

		const content = await this.readFile(source);
		await this.writeFile(destination, content, { create: true, overwrite: options.overwrite });
	}

	//#endregion

	//#region FileSearchProvider

	provideFileSearchResults(
		query: FileSearchQuery,
		options: FileSearchOptions,
		token: CancellationToken,
	) {
		return this.fs.provideFileSearchResults(query, { ...options, folder: this.getOriginalResource(options.folder) }, token);
	}

	//#endregion

	//#region TextSearchProvider

	provideTextSearchResults(
		query: TextSearchQuery,
		options: TextSearchOptions,
		progress: Progress<TextSearchResult>,
		token: CancellationToken,
	) {
		return this.fs.provideTextSearchResults(
			query,
			{ ...options, folder: this.getOriginalResource(options.folder) },
			{ report: (result: TextSearchResult) => progress.report({ ...result, uri: this.getWorkspaceResource(result.uri) }) },
			token
		);
	}

	//#endregion
}
