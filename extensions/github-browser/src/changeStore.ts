/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';
import { commands, Event, EventEmitter, FileStat, FileType, Memento, TextDocumentShowOptions, Uri, ViewColumn } from 'vscode';
import { getRootUri, getRelativePath, isChild } from './extension';
import { sha1 } from './sha1';

const textDecoder = new TextDecoder();

interface CreateOperation<T extends string | Uri = string> {
	type: 'created';
	size: number;
	timestamp: number;
	uri: T;
	hash: string;
	originalHash: string;
}

interface ChangeOperation<T extends string | Uri = string> {
	type: 'changed';
	size: number;
	timestamp: number;
	uri: T;
	hash: string;
	originalHash: string;
}

interface DeleteOperation<T extends string | Uri = string> {
	type: 'deleted';
	size: undefined;
	timestamp: number;
	uri: T;
	hash: undefined;
	originalHash: undefined;
}

export type Operation = CreateOperation<Uri> | ChangeOperation<Uri> | DeleteOperation<Uri>;
type StoredOperation = CreateOperation | ChangeOperation | DeleteOperation;

const workingOperationsKeyPrefix = 'github.working.changes|';
const workingFileKeyPrefix = 'github.working|';

function fromSerialized(operations: StoredOperation): Operation {
	return { ...operations, uri: Uri.parse(operations.uri) };
}

export interface ChangeStoreEvent {
	type: 'created' | 'changed' | 'deleted';
	rootUri: Uri;
	uri: Uri;
}

function toChangeStoreEvent(operation: Operation | StoredOperation, rootUri: Uri, uri?: Uri): ChangeStoreEvent {
	return {
		type: operation.type,
		rootUri: rootUri,
		uri: uri ?? (typeof operation.uri === 'string' ? Uri.parse(operation.uri) : operation.uri),
	};
}

export interface IChangeStore {
	onDidChange: Event<ChangeStoreEvent>;

	acceptAll(rootUri: Uri): Promise<void>;
	discard(uri: Uri): Promise<void>;
	discardAll(rootUri: Uri): Promise<void>;

	hasChanges(rootUri: Uri): boolean;

	getChanges(rootUri: Uri): Operation[];
	getContent(uri: Uri): string | undefined;

	openChanges(uri: Uri, original: Uri): void;
	openFile(uri: Uri): void;
}

export interface IWritableChangeStore {
	onDidChange: Event<ChangeStoreEvent>;

	hasChanges(rootUri: Uri): boolean;

	getContent(uri: Uri): string | undefined;
	getStat(uri: Uri): FileStat | undefined;
	updateDirectoryEntries(uri: Uri, entries: [string, FileType][]): [string, FileType][];

	onFileChanged(uri: Uri, content: Uint8Array, originalContent: () => Uint8Array | Thenable<Uint8Array>): Promise<void>;
	onFileCreated(uri: Uri, content: Uint8Array): Promise<void>;
	onFileDeleted(uri: Uri): Promise<void>;
}

export class ChangeStore implements IChangeStore, IWritableChangeStore {
	private _onDidChange = new EventEmitter<ChangeStoreEvent>();
	get onDidChange(): Event<ChangeStoreEvent> {
		return this._onDidChange.event;
	}

	constructor(private readonly memento: Memento) { }

	async acceptAll(rootUri: Uri): Promise<void> {
		const operations = this.getChanges(rootUri);

		await this.saveWorkingOperations(rootUri, undefined);

		const events: ChangeStoreEvent[] = [];

		for (const operation of operations) {
			await this.discardWorkingContent(operation.uri);
			events.push(toChangeStoreEvent(operation, rootUri));
		}

		for (const e of events) {
			this._onDidChange.fire(e);
		}
	}

	async discard(uri: Uri): Promise<void> {
		const rootUri = getRootUri(uri);
		if (rootUri === undefined) {
			return;
		}

		const key = uri.toString();

		const operations = this.getWorkingOperations(rootUri);
		const index = operations.findIndex(c => c.uri === key);
		if (index === -1) {
			return;
		}

		const [operation] = operations.splice(index, 1);
		await this.saveWorkingOperations(rootUri, operations);
		await this.discardWorkingContent(uri);

		this._onDidChange.fire({
			type: operation.type === 'created' ? 'deleted' : operation.type === 'deleted' ? 'created' : 'changed',
			rootUri: rootUri,
			uri: uri,
		});
	}

	async discardAll(rootUri: Uri): Promise<void> {
		const operations = this.getChanges(rootUri);

		await this.saveWorkingOperations(rootUri, undefined);

		const events: ChangeStoreEvent[] = [];

		for (const operation of operations) {
			await this.discardWorkingContent(operation.uri);
			events.push(toChangeStoreEvent(operation, rootUri));
		}

		for (const e of events) {
			this._onDidChange.fire(e);
		}
	}

	getChanges(rootUri: Uri) {
		return this.getWorkingOperations(rootUri).map(c => fromSerialized(c));
	}

	getContent(uri: Uri): string | undefined {
		return this.memento.get(`${workingFileKeyPrefix}${uri.toString()}`);
	}

	getStat(uri: Uri): FileStat | undefined {
		const key = uri.toString();
		const operation = this.getChanges(getRootUri(uri)!).find(c => c.uri.toString() === key);
		if (operation === undefined) {
			return undefined;
		}

		return {
			type: FileType.File,
			size: operation.size ?? 0,
			ctime: 0,
			mtime: operation.timestamp
		};
	}

	hasChanges(rootUri: Uri): boolean {
		return this.getWorkingOperations(rootUri).length !== 0;
	}

	updateDirectoryEntries(uri: Uri, entries: [string, FileType][]): [string, FileType][] {
		const rootUri = getRootUri(uri);
		if (rootUri === undefined) {
			return entries;
		}

		const folderPath = getRelativePath(rootUri, uri);

		const operations = this.getChanges(rootUri);
		for (const operation of operations) {
			switch (operation.type) {
				case 'changed':
					continue;

				case 'created': {
					const filePath = getRelativePath(rootUri, operation.uri);
					if (isChild(folderPath, filePath)) {
						entries.push([filePath, FileType.File]);
					}
					break;
				}

				case 'deleted': {
					const filePath = getRelativePath(rootUri, operation.uri);
					if (isChild(folderPath, filePath)) {
						const index = entries.findIndex(([path]) => path === filePath);
						if (index !== -1) {
							entries.splice(index, 1);
						}
					}
					break;
				}
			}
		}

		return entries;
	}

	async onFileChanged(uri: Uri, content: Uint8Array, originalContent: () => Uint8Array | Thenable<Uint8Array>): Promise<void> {
		const rootUri = getRootUri(uri);
		if (rootUri === undefined) {
			return;
		}

		const key = uri.toString();

		const operations = this.getWorkingOperations(rootUri);

		const hash = await sha1(content);

		let operation = operations.find(c => c.uri === key);
		if (operation === undefined) {
			const originalHash = await sha1(await originalContent!());
			if (hash === originalHash) {
				return;
			}

			operation = {
				type: 'changed',
				size: content.byteLength,
				timestamp: Date.now(),
				uri: key,
				hash: hash!,
				originalHash: originalHash
			} as ChangeOperation;
			operations.push(operation);

			await this.saveWorkingOperations(rootUri, operations);
			await this.saveWorkingContent(uri, textDecoder.decode(content));
		} else if (hash! === operation.originalHash) {
			operations.splice(operations.indexOf(operation), 1);

			await this.saveWorkingOperations(rootUri, operations);
			await this.discardWorkingContent(uri);
		} else if (operation.hash !== hash) {
			operation.hash = hash!;
			operation.timestamp = Date.now();

			await this.saveWorkingOperations(rootUri, operations);
			await this.saveWorkingContent(uri, textDecoder.decode(content));
		}

		this._onDidChange.fire(toChangeStoreEvent(operation, rootUri, uri));
	}

	async onFileCreated(uri: Uri, content: Uint8Array): Promise<void> {
		const rootUri = getRootUri(uri);
		if (rootUri === undefined) {
			return;
		}

		const key = uri.toString();

		const operations = this.getWorkingOperations(rootUri);

		const hash = await sha1(content);

		let operation = operations.find(c => c.uri === key);
		if (operation === undefined) {
			operation = {
				type: 'created',
				size: content.byteLength,
				timestamp: Date.now(),
				uri: key,
				hash: hash!,
				originalHash: hash!
			} as CreateOperation;
			operations.push(operation);

			await this.saveWorkingOperations(rootUri, operations);
			await this.saveWorkingContent(uri, textDecoder.decode(content));
		} else {
			// Shouldn't happen, but if it does just update the contents
			operation.hash = hash!;
			operation.timestamp = Date.now();

			await this.saveWorkingOperations(rootUri, operations);
			await this.saveWorkingContent(uri, textDecoder.decode(content));
		}

		this._onDidChange.fire(toChangeStoreEvent(operation, rootUri, uri));
	}

	async onFileDeleted(uri: Uri): Promise<void> {
		const rootUri = getRootUri(uri);
		if (rootUri === undefined) {
			return;
		}

		const key = uri.toString();

		const operations = this.getWorkingOperations(rootUri);

		let operation = operations.find(c => c.uri === key);
		if (operation !== undefined) {
			operations.splice(operations.indexOf(operation), 1);
		}

		const wasCreated = operation?.type === 'created';

		operation = {
			type: 'deleted',
			timestamp: Date.now(),
			uri: key,
		} as DeleteOperation;

		// Only track the delete, if we weren't tracking the create
		if (!wasCreated) {
			operations.push(operation);
		}

		await this.saveWorkingOperations(rootUri, operations);
		await this.discardWorkingContent(uri);

		this._onDidChange.fire(toChangeStoreEvent(operation, rootUri, uri));
	}

	async openChanges(uri: Uri, original: Uri) {
		const opts: TextDocumentShowOptions = {
			preserveFocus: false,
			preview: true,
			viewColumn: ViewColumn.Active
		};

		await commands.executeCommand('vscode.diff', original, uri, `${uri.fsPath} (Working Tree)`, opts);
	}

	async openFile(uri: Uri) {
		const opts: TextDocumentShowOptions = {
			preserveFocus: false,
			preview: false,
			viewColumn: ViewColumn.Active
		};

		await commands.executeCommand('vscode.open', uri, opts);
	}

	private getWorkingOperations(rootUri: Uri): StoredOperation[] {
		return this.memento.get(`${workingOperationsKeyPrefix}${rootUri.toString()}`, []);
	}

	private async saveWorkingOperations(rootUri: Uri, operations: StoredOperation[] | undefined): Promise<void> {
		await this.memento.update(`${workingOperationsKeyPrefix}${rootUri.toString()}`, operations);
	}

	private async saveWorkingContent(uri: Uri, content: string): Promise<void> {
		await this.memento.update(`${workingFileKeyPrefix}${uri.toString()}`, content);
	}

	private async discardWorkingContent(uri: Uri): Promise<void> {
		await this.memento.update(`${workingFileKeyPrefix}${uri.toString()}`, undefined);
	}
}
