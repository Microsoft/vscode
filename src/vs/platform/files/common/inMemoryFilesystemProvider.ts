/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import * as resources from 'vs/base/common/resources';
import { FileChangeType, FileType, IWatchOptions, IStat, FileSystemProviderErrorCode, FileSystemProviderError, FileWriteOptions, IFileChange, FileDeleteOptions, FileSystemProviderCapabilities, FileOverwriteOptions, IFileSystemProviderWithFileReadWriteCapability } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';

class File implements IStat {

	type: FileType.File;
	ctime: number;
	mtime: number;
	size: number;

	name: string;
	data?: Uint8Array;

	constructor(name: string) {
		this.type = FileType.File;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = 0;
		this.name = name;
	}
}

class Directory implements IStat {

	type: FileType.Directory;
	ctime: number;
	mtime: number;
	size: number;

	name: string;
	entries: Map<string, File | Directory>;

	constructor(name: string) {
		this.type = FileType.Directory;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = 0;
		this.name = name;
		this.entries = new Map();
	}
}

export type Entry = File | Directory;

export class InMemoryFileSystemProvider extends Disposable implements IFileSystemProviderWithFileReadWriteCapability {

	readonly capabilities: FileSystemProviderCapabilities =
		FileSystemProviderCapabilities.FileReadWrite
		| FileSystemProviderCapabilities.PathCaseSensitive;
	readonly onDidChangeCapabilities: Event<void> = Event.None;

	root = new Directory('');

	// --- manage file metadata

	async stat(resource: URI): Promise<IStat> {
		return this._lookup(resource, false);
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		const entry = this._lookupAsDirectory(resource, false);
		let result: [string, FileType][] = [];
		entry.entries.forEach((child, name) => result.push([name, child.type]));
		return result;
	}

	// --- manage file contents

	async readFile(resource: URI): Promise<Uint8Array> {
		const data = this._lookupAsFile(resource, false).data;
		if (data) {
			return data;
		}
		throw new FileSystemProviderError('file not found', FileSystemProviderErrorCode.FileNotFound);
	}

	async writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
		let basename = resources.basename(resource);
		let parent = this._lookupParentDirectory(resource);
		let entry = parent.entries.get(basename);
		if (entry instanceof Directory) {
			throw new FileSystemProviderError('file is directory', FileSystemProviderErrorCode.FileIsADirectory);
		}
		if (!entry && !opts.create) {
			throw new FileSystemProviderError('file not found', FileSystemProviderErrorCode.FileNotFound);
		}
		if (entry && opts.create && !opts.overwrite) {
			throw new FileSystemProviderError('file exists already', FileSystemProviderErrorCode.FileExists);
		}
		if (!entry) {
			entry = new File(basename);
			parent.entries.set(basename, entry);
			this._fireSoon({ type: FileChangeType.ADDED, resource });
		}
		entry.mtime = Date.now();
		entry.size = content.byteLength;
		entry.data = content;

		this._fireSoon({ type: FileChangeType.UPDATED, resource });
	}

	// --- manage files/folders

	async rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
		if (!opts.overwrite && this._lookup(to, true)) {
			throw new FileSystemProviderError('file exists already', FileSystemProviderErrorCode.FileExists);
		}

		let entry = this._lookup(from, false);
		let oldParent = this._lookupParentDirectory(from);

		let newParent = this._lookupParentDirectory(to);
		let newName = resources.basename(to);

		oldParent.entries.delete(entry.name);
		entry.name = newName;
		newParent.entries.set(newName, entry);

		this._fireSoon(
			{ type: FileChangeType.DELETED, resource: from },
			{ type: FileChangeType.ADDED, resource: to }
		);
	}

	async delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
		let dirname = resources.dirname(resource);
		let basename = resources.basename(resource);
		let parent = this._lookupAsDirectory(dirname, false);
		if (parent.entries.has(basename)) {
			parent.entries.delete(basename);
			parent.mtime = Date.now();
			parent.size -= 1;
			this._fireSoon({ type: FileChangeType.UPDATED, resource: dirname }, { resource, type: FileChangeType.DELETED });
		}
	}

	async mkdir(resource: URI): Promise<void> {
		let basename = resources.basename(resource);
		let dirname = resources.dirname(resource);
		let parent = this._lookupAsDirectory(dirname, false);

		let entry = new Directory(basename);
		parent.entries.set(entry.name, entry);
		parent.mtime = Date.now();
		parent.size += 1;
		this._fireSoon({ type: FileChangeType.UPDATED, resource: dirname }, { type: FileChangeType.ADDED, resource });
	}

	// --- lookup

	private _lookup(uri: URI, silent: false): Entry;
	private _lookup(uri: URI, silent: boolean): Entry | undefined;
	private _lookup(uri: URI, silent: boolean): Entry | undefined {
		let parts = uri.path.split('/');
		let entry: Entry = this.root;
		for (const part of parts) {
			if (!part) {
				continue;
			}
			let child: Entry | undefined;
			if (entry instanceof Directory) {
				child = entry.entries.get(part);
			}
			if (!child) {
				if (!silent) {
					throw new FileSystemProviderError('file not found', FileSystemProviderErrorCode.FileNotFound);
				} else {
					return undefined;
				}
			}
			entry = child;
		}
		return entry;
	}

	private _lookupAsDirectory(uri: URI, silent: boolean): Directory {
		let entry = this._lookup(uri, silent);
		if (entry instanceof Directory) {
			return entry;
		}
		throw new FileSystemProviderError('file not a directory', FileSystemProviderErrorCode.FileNotADirectory);
	}

	private _lookupAsFile(uri: URI, silent: boolean): File {
		let entry = this._lookup(uri, silent);
		if (entry instanceof File) {
			return entry;
		}
		throw new FileSystemProviderError('file is a directory', FileSystemProviderErrorCode.FileIsADirectory);
	}

	private _lookupParentDirectory(uri: URI): Directory {
		const dirname = resources.dirname(uri);
		return this._lookupAsDirectory(dirname, false);
	}

	// --- manage file events

	private readonly _onDidChangeFile = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile: Event<readonly IFileChange[]> = this._onDidChangeFile.event;

	private _bufferedChanges: IFileChange[] = [];
	private _fireSoonHandle?: any;

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		// ignore, fires for all changes...
		return Disposable.None;
	}

	private _fireSoon(...changes: IFileChange[]): void {
		this._bufferedChanges.push(...changes);

		if (this._fireSoonHandle) {
			clearTimeout(this._fireSoonHandle);
		}

		this._fireSoonHandle = setTimeout(() => {
			this._onDidChangeFile.fire(this._bufferedChanges);
			this._bufferedChanges.length = 0;
		}, 5);
	}
}
