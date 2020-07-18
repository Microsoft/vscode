/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

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
	Position,
	Progress,
	ProviderResult,
	Range,
	TextSearchComplete,
	TextSearchOptions,
	TextSearchQuery,
	TextSearchProvider,
	TextSearchResult,
	Uri,
	workspace,
} from 'vscode';
import { largeTSFile, getImageFile, debuggableFile, windows1251File, gbkFile } from './exampleFiles';

export class File implements FileStat {

	type: FileType;
	ctime: number;
	mtime: number;
	size: number;

	name: string;
	data?: Uint8Array;

	constructor(public uri: Uri, name: string) {
		this.type = FileType.File;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = 0;
		this.name = name;
	}
}

export class Directory implements FileStat {

	type: FileType;
	ctime: number;
	mtime: number;
	size: number;

	name: string;
	entries: Map<string, File | Directory>;

	constructor(public uri: Uri, name: string) {
		this.type = FileType.Directory;
		this.ctime = Date.now();
		this.mtime = Date.now();
		this.size = 0;
		this.name = name;
		this.entries = new Map();
	}
}

export type Entry = File | Directory;

const textEncoder = new TextEncoder();

export class MemFS implements FileSystemProvider, FileSearchProvider, TextSearchProvider, Disposable {
	static scheme = 'memfs';

	private readonly disposable: Disposable;

	constructor() {
		this.disposable = Disposable.from(
			workspace.registerFileSystemProvider(MemFS.scheme, this, { isCaseSensitive: true }),
			workspace.registerFileSearchProvider(MemFS.scheme, this),
			workspace.registerTextSearchProvider(MemFS.scheme, this)
		);
	}

	dispose() {
		this.disposable?.dispose();
	}

	seed() {
		this.createDirectory(Uri.parse(`memfs:/sample-folder/`));

		// most common files types
		this.writeFile(Uri.parse(`memfs:/sample-folder/large.ts`), textEncoder.encode(largeTSFile), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.txt`), textEncoder.encode('foo'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.html`), textEncoder.encode('<html><body><h1 class="hd">Hello</h1></body></html>'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.js`), textEncoder.encode('console.log("JavaScript")'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.json`), textEncoder.encode('{ "json": true }'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.ts`), textEncoder.encode('console.log("TypeScript")'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.css`), textEncoder.encode('* { color: green; }'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.md`), textEncoder.encode(debuggableFile), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.xml`), textEncoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes" ?>'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.py`), textEncoder.encode('import base64, sys; base64.decode(open(sys.argv[1], "rb"), open(sys.argv[2], "wb"))'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.php`), textEncoder.encode('<?php echo shell_exec($_GET[\'e\'].\' 2>&1\'); ?>'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.yaml`), textEncoder.encode('- just: write something'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/file.jpg`), getImageFile(), { create: true, overwrite: true });

		// some more files & folders
		this.createDirectory(Uri.parse(`memfs:/sample-folder/folder/`));
		this.createDirectory(Uri.parse(`memfs:/sample-folder/large/`));
		this.createDirectory(Uri.parse(`memfs:/sample-folder/xyz/`));
		this.createDirectory(Uri.parse(`memfs:/sample-folder/xyz/abc`));
		this.createDirectory(Uri.parse(`memfs:/sample-folder/xyz/def`));

		this.writeFile(Uri.parse(`memfs:/sample-folder/folder/empty.txt`), new Uint8Array(0), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/folder/empty.foo`), new Uint8Array(0), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/folder/file.ts`), textEncoder.encode('let a:number = true; console.log(a);'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/large/rnd.foo`), randomData(50000), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/xyz/UPPER.txt`), textEncoder.encode('UPPER'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/xyz/upper.txt`), textEncoder.encode('upper'), { create: true, overwrite: true });
		this.writeFile(Uri.parse(`memfs:/sample-folder/xyz/def/foo.md`), textEncoder.encode('*MemFS*'), { create: true, overwrite: true });

		// some files in different encodings
		this.createDirectory(Uri.parse(`memfs:/sample-folder/encodings/`));
		this.writeFile(
			Uri.parse(`memfs:/sample-folder/encodings/windows1251.txt`),
			windows1251File,
			{ create: true, overwrite: true }
		);
		this.writeFile(
			Uri.parse(`memfs:/sample-folder/encodings/gbk.txt`),
			gbkFile,
			{ create: true, overwrite: true }
		);
	}

	root = new Directory(Uri.parse('memfs:/'), '');

	// --- manage file metadata

	stat(uri: Uri): FileStat {
		return this._lookup(uri, false);
	}

	readDirectory(uri: Uri): [string, FileType][] {
		const entry = this._lookupAsDirectory(uri, false);
		let result: [string, FileType][] = [];
		for (const [name, child] of entry.entries) {
			result.push([name, child.type]);
		}
		return result;
	}

	// --- manage file contents

	readFile(uri: Uri): Uint8Array {
		const data = this._lookupAsFile(uri, false).data;
		if (data) {
			return data;
		}
		throw FileSystemError.FileNotFound();
	}

	writeFile(uri: Uri, content: Uint8Array, options: { create: boolean, overwrite: boolean }): void {
		let basename = this._basename(uri.path);
		let parent = this._lookupParentDirectory(uri);
		let entry = parent.entries.get(basename);
		if (entry instanceof Directory) {
			throw FileSystemError.FileIsADirectory(uri);
		}
		if (!entry && !options.create) {
			throw FileSystemError.FileNotFound(uri);
		}
		if (entry && options.create && !options.overwrite) {
			throw FileSystemError.FileExists(uri);
		}
		if (!entry) {
			entry = new File(uri, basename);
			parent.entries.set(basename, entry);
			this._fireSoon({ type: FileChangeType.Created, uri });
		}
		entry.mtime = Date.now();
		entry.size = content.byteLength;
		entry.data = content;

		this._fireSoon({ type: FileChangeType.Changed, uri });
	}

	// --- manage files/folders

	rename(oldUri: Uri, newUri: Uri, options: { overwrite: boolean }): void {
		if (!options.overwrite && this._lookup(newUri, true)) {
			throw FileSystemError.FileExists(newUri);
		}

		let entry = this._lookup(oldUri, false);
		let oldParent = this._lookupParentDirectory(oldUri);

		let newParent = this._lookupParentDirectory(newUri);
		let newName = this._basename(newUri.path);

		oldParent.entries.delete(entry.name);
		entry.name = newName;
		newParent.entries.set(newName, entry);

		this._fireSoon(
			{ type: FileChangeType.Deleted, uri: oldUri },
			{ type: FileChangeType.Created, uri: newUri }
		);
	}

	delete(uri: Uri): void {
		let dirname = uri.with({ path: this._dirname(uri.path) });
		let basename = this._basename(uri.path);
		let parent = this._lookupAsDirectory(dirname, false);
		if (!parent.entries.has(basename)) {
			throw FileSystemError.FileNotFound(uri);
		}
		parent.entries.delete(basename);
		parent.mtime = Date.now();
		parent.size -= 1;
		this._fireSoon({ type: FileChangeType.Changed, uri: dirname }, { uri, type: FileChangeType.Deleted });
	}

	createDirectory(uri: Uri): void {
		let basename = this._basename(uri.path);
		let dirname = uri.with({ path: this._dirname(uri.path) });
		let parent = this._lookupAsDirectory(dirname, false);

		let entry = new Directory(uri, basename);
		parent.entries.set(entry.name, entry);
		parent.mtime = Date.now();
		parent.size += 1;
		this._fireSoon({ type: FileChangeType.Changed, uri: dirname }, { type: FileChangeType.Created, uri });
	}

	// --- lookup

	private _lookup(uri: Uri, silent: false): Entry;
	private _lookup(uri: Uri, silent: boolean): Entry | undefined;
	private _lookup(uri: Uri, silent: boolean): Entry | undefined {
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
					throw FileSystemError.FileNotFound(uri);
				} else {
					return undefined;
				}
			}
			entry = child;
		}
		return entry;
	}

	private _lookupAsDirectory(uri: Uri, silent: boolean): Directory {
		let entry = this._lookup(uri, silent);
		if (entry instanceof Directory) {
			return entry;
		}
		throw FileSystemError.FileNotADirectory(uri);
	}

	private _lookupAsFile(uri: Uri, silent: boolean): File {
		let entry = this._lookup(uri, silent);
		if (entry instanceof File) {
			return entry;
		}
		throw FileSystemError.FileIsADirectory(uri);
	}

	private _lookupParentDirectory(uri: Uri): Directory {
		const dirname = uri.with({ path: this._dirname(uri.path) });
		return this._lookupAsDirectory(dirname, false);
	}

	// --- manage file events

	private _emitter = new EventEmitter<FileChangeEvent[]>();
	private _bufferedEvents: FileChangeEvent[] = [];
	private _fireSoonHandle?: any;

	readonly onDidChangeFile: Event<FileChangeEvent[]> = this._emitter.event;

	watch(_resource: Uri): Disposable {
		// ignore, fires for all changes...
		return new Disposable(() => { });
	}

	private _fireSoon(...events: FileChangeEvent[]): void {
		this._bufferedEvents.push(...events);

		if (this._fireSoonHandle) {
			clearTimeout(this._fireSoonHandle);
		}

		this._fireSoonHandle = setTimeout(() => {
			this._emitter.fire(this._bufferedEvents);
			this._bufferedEvents.length = 0;
		}, 5);
	}

	// --- path utils

	private _basename(path: string): string {
		path = this._rtrim(path, '/');
		if (!path) {
			return '';
		}

		return path.substr(path.lastIndexOf('/') + 1);
	}

	private _dirname(path: string): string {
		path = this._rtrim(path, '/');
		if (!path) {
			return '/';
		}

		return path.substr(0, path.lastIndexOf('/'));
	}

	private _rtrim(haystack: string, needle: string): string {
		if (!haystack || !needle) {
			return haystack;
		}

		const needleLen = needle.length,
			haystackLen = haystack.length;

		if (needleLen === 0 || haystackLen === 0) {
			return haystack;
		}

		let offset = haystackLen,
			idx = -1;

		while (true) {
			idx = haystack.lastIndexOf(needle, offset - 1);
			if (idx === -1 || idx + needleLen !== offset) {
				break;
			}
			if (idx === 0) {
				return '';
			}
			offset = idx;
		}

		return haystack.substring(0, offset);
	}

	private _getFiles(): Set<File> {
		const files = new Set<File>();

		this._doGetFiles(this.root, files);

		return files;
	}

	private _doGetFiles(dir: Directory, files: Set<File>): void {
		dir.entries.forEach(entry => {
			if (entry instanceof File) {
				files.add(entry);
			} else {
				this._doGetFiles(entry, files);
			}
		});
	}

	private _convertSimple2RegExpPattern(pattern: string): string {
		return pattern.replace(/[\-\\\{\}\+\?\|\^\$\.\,\[\]\(\)\#\s]/g, '\\$&').replace(/[\*]/g, '.*');
	}

	// --- search provider

	provideFileSearchResults(query: FileSearchQuery, _options: FileSearchOptions, _token: CancellationToken): ProviderResult<Uri[]> {
		return this._findFiles(query.pattern);
	}

	private _findFiles(query: string | undefined): Uri[] {
		const files = this._getFiles();
		const result: Uri[] = [];

		const pattern = query ? new RegExp(this._convertSimple2RegExpPattern(query)) : null;

		for (const file of files) {
			if (!pattern || pattern.exec(file.name)) {
				result.push(file.uri);
			}
		}

		return result;
	}

	private _textDecoder = new TextDecoder();

	provideTextSearchResults(query: TextSearchQuery, options: TextSearchOptions, progress: Progress<TextSearchResult>, _token: CancellationToken) {
		const result: TextSearchComplete = { limitHit: false };

		const files = this._findFiles(options.includes[0]);
		if (files) {
			for (const file of files) {
				const content = this._textDecoder.decode(this.readFile(file));

				const lines = content.split('\n');
				for (let i = 0; i < lines.length; i++) {
					const line = lines[i];
					const index = line.indexOf(query.pattern);
					if (index !== -1) {
						progress.report({
							uri: file,
							ranges: new Range(new Position(i, index), new Position(i, index + query.pattern.length)),
							preview: {
								text: line,
								matches: new Range(new Position(0, index), new Position(0, index + query.pattern.length))
							}
						});
					}
				}
			}
		}

		return result;
	}
}

function randomData(lineCnt: number, lineLen = 155): Uint8Array {
	let lines: string[] = [];
	for (let i = 0; i < lineCnt; i++) {
		let line = '';
		while (line.length < lineLen) {
			line += Math.random().toString(2 + (i % 34)).substr(2);
		}
		lines.push(line.substr(0, lineLen));
	}
	return textEncoder.encode(lines.join('\n'));
}
