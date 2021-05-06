/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IFileSystemProviderWithFileReadWriteCapability, FileSystemProviderCapabilities, IFileChange, IWatchOptions, IStat, FileOverwriteOptions, FileType, FileDeleteOptions, FileWriteOptions } from 'vs/platform/files/common/files';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { extUri } from 'vs/base/common/resources';

function split(path: string): [string, string] | undefined {
	const match = /^(.*)\/([^/]+)$/.exec(path);

	if (!match) {
		return undefined;
	}

	const [, parentPath, name] = match;
	return [parentPath, name];
}

function getRootUUID(uri: URI): string | undefined {
	const match = /^\/([^/]+)\/[^/]+\/?$/.exec(uri.path);

	if (!match) {
		return undefined;
	}

	return match[1];
}

export class HTMLFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {

	private readonly files = new Map<string, FileSystemFileHandle>();
	private readonly directories = new Map<string, FileSystemDirectoryHandle>();

	readonly capabilities: FileSystemProviderCapabilities =
		FileSystemProviderCapabilities.FileReadWrite
		| FileSystemProviderCapabilities.PathCaseSensitive;

	readonly onDidChangeCapabilities = Event.None;

	private readonly _onDidChangeFile = new Emitter<readonly IFileChange[]>();
	readonly onDidChangeFile = this._onDidChangeFile.event;

	private readonly _onDidErrorOccur = new Emitter<string>();
	readonly onDidErrorOccur = this._onDidErrorOccur.event;

	async readFile(resource: URI): Promise<Uint8Array> {
		const handle = await this.getFileHandle(resource);

		if (!handle) {
			throw new Error('File not found.');
		}

		const file = await handle.getFile();
		return new Uint8Array(await file.arrayBuffer());
	}

	async writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
		const handle = await this.getFileHandle(resource);

		if (!handle) {
			throw new Error('File not found.');
		}

		const writable = await handle.createWritable();
		await writable.write(content);
		await writable.close();
	}

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		return Disposable.None;
	}

	async stat(resource: URI): Promise<IStat> {
		const rootUUID = getRootUUID(resource);

		if (rootUUID) {
			const fileHandle = this.files.get(rootUUID);

			if (fileHandle) {
				const file = await fileHandle.getFile();

				return {
					type: FileType.File,
					mtime: file.lastModified,
					ctime: 0,
					size: file.size
				};
			}

			const directoryHandle = this.directories.get(rootUUID);

			if (directoryHandle) {
				return {
					type: FileType.Directory,
					mtime: 0,
					ctime: 0,
					size: 0
				};
			}
		}

		const parent = await this.getParentDirectoryHandle(resource);

		if (!parent) {
			throw new Error('Stat error: no parent found');
		}

		const name = extUri.basename(resource);
		for await (const [childName, child] of parent) {
			if (childName === name) {
				if (child.kind === 'file') {
					const file = await child.getFile();

					return {
						type: FileType.File,
						mtime: file.lastModified,
						ctime: 0,
						size: file.size
					};
				} else {
					return {
						type: FileType.Directory,
						mtime: 0,
						ctime: 0,
						size: 0
					};
				}
			}
		}

		throw new Error('Stat error: entry not found');
	}

	mkdir(resource: URI): Promise<void> {
		throw new Error('Method not implemented.');
	}

	async readdir(resource: URI): Promise<[string, FileType][]> {
		const parent = await this.getDirectoryHandle(resource);

		if (!parent) {
			throw new Error('Stat error: no parent found');
		}

		const result: [string, FileType][] = [];

		for await (const [name, child] of parent) {
			result.push([name, child.kind === 'file' ? FileType.File : FileType.Directory]);
		}

		return result;
	}

	delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
		throw new Error('Method not implemented: delete');
	}

	rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
		throw new Error('Method not implemented: rename');
	}

	private async getDirectoryHandle(uri: URI): Promise<FileSystemDirectoryHandle | undefined> {
		const rootUUID = getRootUUID(uri);

		if (rootUUID) {
			return this.directories.get(rootUUID);
		}

		const splitResult = split(uri.path);

		if (!splitResult) {
			return undefined;
		}

		const parent = await this.getDirectoryHandle(URI.from({ ...uri, path: splitResult[0] }));
		return await parent?.getDirectoryHandle(extUri.basename(uri));
	}

	private async getParentDirectoryHandle(uri: URI): Promise<FileSystemDirectoryHandle | undefined> {
		return this.getDirectoryHandle(URI.from({ ...uri, path: extUri.dirname(uri).path }));
	}

	private async getFileHandle(uri: URI): Promise<FileSystemFileHandle | undefined> {
		const rootUUID = getRootUUID(uri);

		if (rootUUID) {
			return this.files.get(rootUUID);
		}

		const parent = await this.getParentDirectoryHandle(uri);
		const name = extUri.basename(uri);
		return await parent?.getFileHandle(name);
	}

	registerFileHandle(uuid: string, handle: FileSystemFileHandle): void {
		this.files.set(uuid, handle);
	}

	registerDirectoryHandle(uuid: string, handle: FileSystemDirectoryHandle): void {
		this.directories.set(uuid, handle);
	}

	dispose(): void {
		this._onDidChangeFile.dispose();
	}
}
