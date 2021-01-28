/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { IFileSystemProviderWithFileReadWriteCapability, FileSystemProviderCapabilities, IFileChange, IWatchOptions, IStat, FileOverwriteOptions, FileType, FileDeleteOptions, FileWriteOptions, FileChangeType, createFileSystemProviderError, FileSystemProviderErrorCode } from 'vs/platform/files/common/files';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import { VSBuffer } from 'vs/base/common/buffer';
import { Throttler } from 'vs/base/common/async';
import { localize } from 'vs/nls';
import * as browser from 'vs/base/browser/browser';
import { joinPath } from 'vs/base/common/resources';

const INDEXEDDB_VSCODE_DB = 'vscode-web-db';
export const INDEXEDDB_USERDATA_OBJECT_STORE = 'vscode-userdata-store';
export const INDEXEDDB_LOGS_OBJECT_STORE = 'vscode-logs-store';

// Standard FS Errors (expected to be thrown in production when invalid FS operations are requested)
const ERR_FILE_NOT_FOUND = createFileSystemProviderError(localize('fileNotExists', "File does not exist"), FileSystemProviderErrorCode.FileNotFound);
const ERR_FILE_IS_DIR = createFileSystemProviderError(localize('fileIsDirectory', "File is Directory"), FileSystemProviderErrorCode.FileIsADirectory);
const ERR_FILE_NOT_DIR = createFileSystemProviderError(localize('fileNotDirectory', "File is not a directory"), FileSystemProviderErrorCode.FileNotADirectory);
const ERR_DIR_NOT_EMPTY = createFileSystemProviderError(localize('dirIsNotEmpty', "Directory is not empty"), FileSystemProviderErrorCode.Unknown);

// Arbitrary Internal Errors (should never be thrown in production)
const ERR_UNKNOWN_INTERNAL = (message: string) => createFileSystemProviderError(localize('internal', "Internal error occurred in IndexedDB File System Provider. ({0})", message), FileSystemProviderErrorCode.Unknown);

export class IndexedDB {

	private indexedDBPromise: Promise<IDBDatabase | null>;

	constructor() {
		this.indexedDBPromise = this.openIndexedDB(INDEXEDDB_VSCODE_DB, 2, [INDEXEDDB_USERDATA_OBJECT_STORE, INDEXEDDB_LOGS_OBJECT_STORE]);
	}

	async createFileSystemProvider(scheme: string, store: string): Promise<IIndexedDBFileSystemProvider | null> {
		let fsp: IIndexedDBFileSystemProvider | null = null;
		const indexedDB = await this.indexedDBPromise;
		if (indexedDB) {
			if (indexedDB.objectStoreNames.contains(store)) {
				fsp = new IndexedDBFileSystemProvider(scheme, indexedDB, store);
			} else {
				console.error(`Error while creating indexedDB filesystem provider. Could not find ${store} object store`);
			}
		}
		return fsp;
	}

	private openIndexedDB(name: string, version: number, stores: string[]): Promise<IDBDatabase | null> {
		if (browser.isEdgeLegacy) {
			return Promise.resolve(null);
		}
		return new Promise((c, e) => {
			const request = window.indexedDB.open(name, version);
			request.onerror = (err) => e(request.error);
			request.onsuccess = () => {
				const db = request.result;
				for (const store of stores) {
					if (!db.objectStoreNames.contains(store)) {
						console.error(`Error while creating indexedDB. Could not create ${store} object store`);
						c(null);
						return;
					}
				}
				c(db);
			};
			request.onupgradeneeded = () => {
				const db = request.result;
				for (const store of stores) {
					if (!db.objectStoreNames.contains(store)) {
						db.createObjectStore(store);
					}
				}
			};
		});
	}
}

export interface IIndexedDBFileSystemProvider extends Disposable, IFileSystemProviderWithFileReadWriteCapability {
	reset(): Promise<void>;
}

type DirEntry = [string, FileType];

type IndexedDBFileSystemEntry =
	| {
		path: string,
		type: FileType.Directory,
		children: Map<string, IndexedDBFileSystemNode>,
	}
	| {
		path: string,
		type: FileType.File,
		size: number | undefined,
	};

class IndexedDBFileSystemNode {
	public type: FileType;

	constructor(private entry: IndexedDBFileSystemEntry) {
		this.type = entry.type;
	}


	read(path: string) {
		return this.doRead(path.split('/').filter(p => p.length));
	}

	private doRead(pathParts: string[]): IndexedDBFileSystemEntry | undefined {
		if (pathParts.length === 0) { return this.entry; }
		if (this.entry.type !== FileType.Directory) {
			throw ERR_UNKNOWN_INTERNAL('Internal error reading from IndexedDBFSNode -- expected directory at ' + this.entry.path);
		}
		const next = this.entry.children.get(pathParts[0]);

		if (!next) { return undefined; }
		return next.doRead(pathParts.slice(1));
	}

	delete(path: string) {
		const toDelete = path.split('/').filter(p => p.length);
		if (toDelete.length === 0) {
			if (this.entry.type !== FileType.Directory) {
				throw ERR_UNKNOWN_INTERNAL(`Internal error deleting from IndexedDBFSNode. Expected root entry to be directory`);
			}
			this.entry.children.clear();
		} else {
			return this.doDelete(toDelete, path);
		}
	}

	private doDelete = (pathParts: string[], originalPath: string) => {
		if (pathParts.length === 0) {
			throw ERR_UNKNOWN_INTERNAL(`Internal error deleting from IndexedDBFSNode -- got no deletion path parts (encountered while deleting ${originalPath})`);
		}
		else if (this.entry.type !== FileType.Directory) {
			throw ERR_UNKNOWN_INTERNAL('Internal error deleting from IndexedDBFSNode -- expected directory at ' + this.entry.path);
		}
		else if (pathParts.length === 1) {
			this.entry.children.delete(pathParts[0]);
		}
		else {
			const next = this.entry.children.get(pathParts[0]);
			if (!next) {
				throw ERR_UNKNOWN_INTERNAL('Internal error deleting from IndexedDBFSNode -- expected entry at ' + this.entry.path + '/' + next);
			}
			next.doDelete(pathParts.slice(1), originalPath);
		}
	};

	add(path: string, entry: { type: 'file', size?: number } | { type: 'dir' }) {
		this.doAdd(path.split('/').filter(p => p.length), entry, path);
	}

	private doAdd(pathParts: string[], entry: { type: 'file', size?: number } | { type: 'dir' }, originalPath: string) {
		if (pathParts.length === 0) {
			throw ERR_UNKNOWN_INTERNAL(`Internal error creating IndexedDBFSNode -- adding empty path (encountered while adding ${originalPath})`);
		}
		else if (this.entry.type !== FileType.Directory) {
			throw ERR_UNKNOWN_INTERNAL(`Internal error creating IndexedDBFSNode -- parent is not a directory (encountered while adding ${originalPath})`);
		}
		else if (pathParts.length === 1) {
			const next = pathParts[0];
			const existing = this.entry.children.get(next);
			if (entry.type === 'dir') {
				if (existing?.entry.type === FileType.File) {
					throw ERR_UNKNOWN_INTERNAL(`Internal error creating IndexedDBFSNode -- overwriting file with directory: ${this.entry.path}/${next} (encountered while adding ${originalPath})`);
				}
				this.entry.children.set(next, existing ?? new IndexedDBFileSystemNode({
					type: FileType.Directory,
					path: this.entry.path + '/' + next,
					children: new Map(),
				}));
			} else {
				if (existing?.entry.type === FileType.Directory) {
					throw ERR_UNKNOWN_INTERNAL(`Internal error creating IndexedDBFSNode -- overwriting directory with file: ${this.entry.path}/${next} (encountered while adding ${originalPath})`);
				}
				this.entry.children.set(next, new IndexedDBFileSystemNode({
					type: FileType.File,
					path: this.entry.path + '/' + next,
					size: entry.size,
				}));
			}
		}
		else if (pathParts.length > 1) {
			const next = pathParts[0];
			let childNode = this.entry.children.get(next);
			if (!childNode) {
				childNode = new IndexedDBFileSystemNode({
					children: new Map(),
					path: this.entry.path + '/' + next,
					type: FileType.Directory
				});
				this.entry.children.set(next, childNode);
			}
			else if (childNode.type === FileType.File) {
				throw ERR_UNKNOWN_INTERNAL(`Internal error creating IndexedDBFSNode -- overwriting file entry with directory: ${this.entry.path}/${next} (encountered while adding ${originalPath})`);
			}
			childNode.doAdd(pathParts.slice(1), entry, originalPath);
		}
	}

	print(indentation = '') {
		console.log(indentation + this.entry.path);
		if (this.entry.type === FileType.Directory) {
			this.entry.children.forEach(child => child.print(indentation + ' '));
		}
	}
}

class IndexedDBFileSystemProvider extends Disposable implements IIndexedDBFileSystemProvider {

	readonly capabilities: FileSystemProviderCapabilities =
		FileSystemProviderCapabilities.FileReadWrite
		| FileSystemProviderCapabilities.PathCaseSensitive;
	readonly onDidChangeCapabilities: Event<void> = Event.None;

	private readonly _onDidChangeFile = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile: Event<readonly IFileChange[]> = this._onDidChangeFile.event;

	private readonly versions: Map<string, number> = new Map<string, number>();

	private cachedFiletree: Promise<IndexedDBFileSystemNode> | undefined;
	private writeManyThrottler: Throttler;

	constructor(scheme: string, private readonly database: IDBDatabase, private readonly store: string) {
		super();
		this.writeManyThrottler = new Throttler();

	}

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		return Disposable.None;
	}

	async mkdir(resource: URI): Promise<void> {
		try {
			const resourceStat = await this.stat(resource);
			if (resourceStat.type === FileType.File) {
				throw ERR_FILE_NOT_DIR;
			}
		} catch (error) { /* Ignore */ }
		(await this.getFiletree()).add(resource.path, { type: 'dir' });
	}

	async stat(resource: URI): Promise<IStat> {
		const content = (await this.getFiletree()).read(resource.path);
		if (content?.type === FileType.File) {
			return {
				type: FileType.File,
				ctime: 0,
				mtime: this.versions.get(resource.toString()) || 0,
				size: content.size ?? (await this.readFile(resource)).byteLength
			};
		} else if (content?.type === FileType.Directory) {
			return {
				type: FileType.Directory,
				ctime: 0,
				mtime: 0,
				size: 0
			};
		}
		else {
			throw ERR_FILE_NOT_FOUND;
		}
	}

	async readdir(resource: URI): Promise<DirEntry[]> {
		const entry = (await this.getFiletree()).read(resource.path);
		if (!entry) {
			// Dirs aren't saved to disk, so empty dirs will be lost on reload.
			// Thus we have two options for what happens when you try to read a dir and nothing is found:
			// - Throw FileSystemProviderErrorCode.FileNotFound
			// - Return []
			// We choose to return [] as creating a dir then reading it (even after reload) should not throw an error.
			return [];
		}
		if (entry.type !== FileType.Directory) {
			throw ERR_FILE_NOT_DIR;
		}
		else {
			return [...entry.children.entries()].map(([name, node]) => [name, node.type]);
		}
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const buffer = await new Promise<Uint8Array>((c, e) => {
			const transaction = this.database.transaction([this.store]);
			const objectStore = transaction.objectStore(this.store);
			const request = objectStore.get(resource.path);
			request.onerror = () => e(request.error);
			request.onsuccess = () => {
				if (request.result instanceof Uint8Array) {
					c(request.result);
				} else if (typeof request.result === 'string') {
					c(VSBuffer.fromString(request.result).buffer);
				}
				else {
					if (request.result === undefined) {
						e(ERR_FILE_NOT_FOUND);
					} else {
						e(ERR_UNKNOWN_INTERNAL(`IndexedDB entry at "${resource.path}" in unexpected format`));
					}
				}
			};
		});

		(await this.getFiletree()).add(resource.path, { type: 'file', size: buffer.byteLength });
		return buffer;
	}

	async writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
		const existing = await this.stat(resource).catch(() => undefined);
		if (existing?.type === FileType.Directory) {
			throw ERR_FILE_IS_DIR;
		}

		this.fileWriteBatch.push({ content, resource });
		await this.writeManyThrottler.queue(() => this.writeMany());
		(await this.getFiletree()).add(resource.path, { type: 'file', size: content.byteLength });
		this.versions.set(resource.toString(), (this.versions.get(resource.toString()) || 0) + 1);
		this._onDidChangeFile.fire([{ resource, type: FileChangeType.UPDATED }]);
	}

	async delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
		let stat: IStat;
		try {
			stat = await this.stat(resource);
		} catch (e) {
			if (e.code === FileSystemProviderErrorCode.FileNotFound) {
				return;
			}
			throw e;
		}

		let toDelete: string[];
		if (opts.recursive) {
			const tree = (await this.tree(resource));
			toDelete = tree.map(([path]) => path);
		} else {
			if (stat.type === FileType.Directory && (await this.readdir(resource)).length) {
				throw ERR_DIR_NOT_EMPTY;
			}
			toDelete = [resource.path];
		}
		await this.deleteKeys(toDelete);
		(await this.getFiletree()).delete(resource.path);
		toDelete.forEach(key => this.versions.delete(key));
		this._onDidChangeFile.fire(toDelete.map(path => ({ resource: resource.with({ path }), type: FileChangeType.DELETED })));
	}

	private async tree(resource: URI): Promise<DirEntry[]> {
		if ((await this.stat(resource)).type === FileType.Directory) {
			const topLevelEntries = (await this.readdir(resource)).map(([key, type]) => {
				return [joinPath(resource, key).path, type] as [string, FileType];
			});
			let allEntries = topLevelEntries;
			await Promise.all(topLevelEntries.map(
				async ([key, type]) => {
					if (type === FileType.Directory) {
						const childEntries = (await this.tree(resource.with({ path: key })));
						allEntries = allEntries.concat(childEntries);
					}
				}));
			return allEntries;
		} else {
			const entries: DirEntry[] = [[resource.path, FileType.File]];
			return entries;
		}
	}

	rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> {
		return Promise.reject(new Error('Not Supported'));
	}

	private getFiletree(): Promise<IndexedDBFileSystemNode> {
		if (!this.cachedFiletree) {
			this.cachedFiletree = new Promise((c, e) => {
				const transaction = this.database.transaction([this.store]);
				const objectStore = transaction.objectStore(this.store);
				const request = objectStore.getAllKeys();
				request.onerror = () => e(request.error);
				request.onsuccess = () => {
					const rootNode = new IndexedDBFileSystemNode({
						children: new Map(),
						path: '',
						type: FileType.Directory
					});
					const keys = request.result.map(key => key.toString());
					keys.forEach(key => rootNode.add(key, { type: 'file' }));
					c(rootNode);
				};
			});
		}
		return this.cachedFiletree;
	}

	private fileWriteBatch: { resource: URI, content: Uint8Array }[] = [];
	private async writeMany() {
		return new Promise<void>((c, e) => {
			const fileBatch = this.fileWriteBatch;
			this.fileWriteBatch = [];
			if (fileBatch.length === 0) { return c(); }

			const transaction = this.database.transaction([this.store], 'readwrite');
			transaction.onerror = () => e(transaction.error);
			const objectStore = transaction.objectStore(this.store);
			let request: IDBRequest = undefined!;
			for (const entry of fileBatch) {
				request = objectStore.put(entry.content, entry.resource.path);
			}
			request.onsuccess = () => c();
		});
	}

	private deleteKeys(keys: string[]): Promise<void> {
		return new Promise(async (c, e) => {
			if (keys.length === 0) { return c(); }
			const transaction = this.database.transaction([this.store], 'readwrite');
			transaction.onerror = () => e(transaction.error);
			const objectStore = transaction.objectStore(this.store);
			let request: IDBRequest = undefined!;
			for (const key of keys) {
				request = objectStore.delete(key);
			}

			request.onsuccess = () => c();
		});
	}

	reset(): Promise<void> {
		return new Promise(async (c, e) => {
			const transaction = this.database.transaction([this.store], 'readwrite');
			const objectStore = transaction.objectStore(this.store);
			const request = objectStore.clear();
			request.onerror = () => e(request.error);
			request.onsuccess = () => c();
		});
	}
}
