/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { FileSystemProvider, FileChangeEvent, EventEmitter, Event, Disposable, FileStat, Uri, FileType, workspace, FileSystemError } from 'vscode';
import { EmptyDisposable } from './util';
import { promises as fs } from 'fs';

export class GitCommitFileSystemProvider implements FileSystemProvider {
	private _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
	readonly onDidChangeFile: Event<FileChangeEvent[]> = this._onDidChangeFile.event;

	private disposables: Disposable[] = [];

	private fileCache: Record<string, Uint8Array> = {};

	constructor() {
		this.disposables.push(
			workspace.registerFileSystemProvider('gitcommit', this, { isReadonly: false, isCaseSensitive: true }),
			workspace.registerResourceLabelFormatter({
				scheme: 'gitcommit',
				formatting: {
					label: '${authority} (gitcommit)',
					separator: '/'
				}
			})
		);
	}

	async stat(uri: Uri): Promise<FileStat> {
		// TODO: Should we do error handling here? If so, we may need sth like toFileSystemProviderErrorCode
		if (this.fileCache[uri.authority]) {
			return { type: FileType.File, ctime: 0, mtime: 0, size: this.fileCache[uri.authority].length };
		}

		const { size } = await fs.stat(uri.fsPath);
		return { ctime: 0, mtime: 0, size, type: FileType.File };
	}

	readDirectory(): Thenable<[string, FileType][]> {
		throw new Error('Method not implemented.');
	}

	createDirectory(): void {
		throw new Error('Method not implemented.');
	}

	async readFile(uri: Uri): Promise<Uint8Array> {
		// TODO: Should we do more error handling here? If so, we may need sth like toFileSystemProviderErrorCode
		if (!this.fileCache[uri.authority]) {
			try {
				this.fileCache[uri.authority] = await fs.readFile(uri.fsPath);
			} catch (error) {
				// TODO ingore for now, maybe go for toFileSystemProviderErrorCode
			}
		}
		return this.fileCache[uri.authority];
	}

	async writeFile(uri: Uri, content: Uint8Array): Promise<void> {
		if (this.fileCache[uri.authority]) {
			this.fileCache[uri.authority] = content;
		} else {
			throw FileSystemError.FileNotFound();
		}
	}

	delete(uri: Uri): void {
		if (this.fileCache[uri.authority]) {
			delete this.fileCache[uri.authority];
		} else {
			throw FileSystemError.FileNotFound();
		}
	}

	rename(): void {
		throw new Error('Method not implemented.');
	}

	dispose(): void {
		this.disposables.forEach(d => d.dispose());
	}

	watch(): Disposable {
		return EmptyDisposable;
	}
}
