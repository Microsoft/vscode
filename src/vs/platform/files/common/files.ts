/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { sep } from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import * as glob from 'vs/base/common/glob';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { Event } from 'vs/base/common/event';
import { startsWithIgnoreCase } from 'vs/base/common/strings';
import { IDisposable } from 'vs/base/common/lifecycle';
import { isNumber, isUndefinedOrNull } from 'vs/base/common/types';
import { VSBuffer, VSBufferReadable, VSBufferReadableStream } from 'vs/base/common/buffer';
import { ReadableStreamEvents } from 'vs/base/common/stream';
import { CancellationToken } from 'vs/base/common/cancellation';
import { TernarySearchTree } from 'vs/base/common/map';

export const IFileService = createDecorator<IFileService>('fileService');

export interface IFileService {

	readonly _serviceBrand: undefined;

	/**
	 * An event that is fired when a file system provider is added or removed
	 */
	readonly onDidChangeFileSystemProviderRegistrations: Event<IFileSystemProviderRegistrationEvent>;

	/**
	 * An event that is fired when a registered file system provider changes it's capabilities.
	 */
	readonly onDidChangeFileSystemProviderCapabilities: Event<IFileSystemProviderCapabilitiesChangeEvent>;

	/**
	 * An event that is fired when a file system provider is about to be activated. Listeners
	 * can join this event with a long running promise to help in the activation process.
	 */
	readonly onWillActivateFileSystemProvider: Event<IFileSystemProviderActivationEvent>;

	/**
	 * Registers a file system provider for a certain scheme.
	 */
	registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable;

	/**
	 * Tries to activate a provider with the given scheme.
	 */
	activateProvider(scheme: string): Promise<void>;

	/**
	 * Checks if this file service can handle the given resource.
	 */
	canHandleResource(resource: URI): boolean;

	/**
	 * Checks if the provider for the provided resource has the provided file system capability.
	 */
	hasCapability(resource: URI, capability: FileSystemProviderCapabilities): boolean;

	/**
	 * List the schemes and capabilies for registered file system providers
	 */
	listCapabilities(): Iterable<{ scheme: string, capabilities: FileSystemProviderCapabilities }>

	/**
	 * Allows to listen for file changes. The event will fire for every file within the opened workspace
	 * (if any) as well as all files that have been watched explicitly using the #watch() API.
	 */
	readonly onDidFilesChange: Event<FileChangesEvent>;

	/**
	 * An event that is fired upon successful completion of a certain file operation.
	 */
	readonly onDidRunOperation: Event<FileOperationEvent>;

	/**
	 * Resolve the properties of a file/folder identified by the resource.
	 *
	 * If the optional parameter "resolveTo" is specified in options, the stat service is asked
	 * to provide a stat object that should contain the full graph of folders up to all of the
	 * target resources.
	 *
	 * If the optional parameter "resolveSingleChildDescendants" is specified in options,
	 * the stat service is asked to automatically resolve child folders that only
	 * contain a single element.
	 *
	 * If the optional parameter "resolveMetadata" is specified in options,
	 * the stat will contain metadata information such as size, mtime and etag.
	 */
	resolve(resource: URI, options: IResolveMetadataFileOptions): Promise<IFileStatWithMetadata>;
	resolve(resource: URI, options?: IResolveFileOptions): Promise<IFileStat>;

	/**
	 * Same as resolve() but supports resolving multiple resources in parallel.
	 * If one of the resolve targets fails to resolve returns a fake IFileStat instead of making the whole call fail.
	 */
	resolveAll(toResolve: { resource: URI, options: IResolveMetadataFileOptions }[]): Promise<IResolveFileResult[]>;
	resolveAll(toResolve: { resource: URI, options?: IResolveFileOptions }[]): Promise<IResolveFileResult[]>;

	/**
	 * Finds out if a file/folder identified by the resource exists.
	 */
	exists(resource: URI): Promise<boolean>;

	/**
	 * Read the contents of the provided resource unbuffered.
	 */
	readFile(resource: URI, options?: IReadFileOptions): Promise<IFileContent>;

	/**
	 * Read the contents of the provided resource buffered as stream.
	 */
	readFileStream(resource: URI, options?: IReadFileOptions): Promise<IFileStreamContent>;

	/**
	 * Updates the content replacing its previous value.
	 */
	writeFile(resource: URI, bufferOrReadableOrStream: VSBuffer | VSBufferReadable | VSBufferReadableStream, options?: IWriteFileOptions): Promise<IFileStatWithMetadata>;

	/**
	 * Moves the file/folder to a new path identified by the resource.
	 *
	 * The optional parameter overwrite can be set to replace an existing file at the location.
	 */
	move(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata>;

	/**
	 * Find out if a move operation is possible given the arguments. No changes on disk will
	 * be performed. Returns an Error if the operation cannot be done.
	 */
	canMove(source: URI, target: URI, overwrite?: boolean): Promise<Error | true>;

	/**
	 * Copies the file/folder to a path identified by the resource.
	 *
	 * The optional parameter overwrite can be set to replace an existing file at the location.
	 */
	copy(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata>;

	/**
	 * Find out if a copy operation is possible given the arguments. No changes on disk will
	 * be performed. Returns an Error if the operation cannot be done.
	 */
	canCopy(source: URI, target: URI, overwrite?: boolean): Promise<Error | true>;

	/**
	 * Find out if a file create operation is possible given the arguments. No changes on disk will
	 * be performed. Returns an Error if the operation cannot be done.
	 */
	canCreateFile(resource: URI, options?: ICreateFileOptions): Promise<Error | true>;

	/**
	 * Creates a new file with the given path and optional contents. The returned promise
	 * will have the stat model object as a result.
	 *
	 * The optional parameter content can be used as value to fill into the new file.
	 */
	createFile(resource: URI, bufferOrReadableOrStream?: VSBuffer | VSBufferReadable | VSBufferReadableStream, options?: ICreateFileOptions): Promise<IFileStatWithMetadata>;

	/**
	 * Creates a new folder with the given path. The returned promise
	 * will have the stat model object as a result.
	 */
	createFolder(resource: URI): Promise<IFileStatWithMetadata>;

	/**
	 * Deletes the provided file. The optional useTrash parameter allows to
	 * move the file to trash. The optional recursive parameter allows to delete
	 * non-empty folders recursively.
	 */
	del(resource: URI, options?: { useTrash?: boolean, recursive?: boolean }): Promise<void>;

	/**
	 * Find out if a delete operation is possible given the arguments. No changes on disk will
	 * be performed. Returns an Error if the operation cannot be done.
	 */
	canDelete(resource: URI, options?: { useTrash?: boolean, recursive?: boolean }): Promise<Error | true>;

	/**
	 * Allows to start a watcher that reports file/folder change events on the provided resource.
	 *
	 * Note: watching a folder does not report events recursively for child folders yet.
	 */
	watch(resource: URI): IDisposable;

	/**
	 * Frees up any resources occupied by this service.
	 */
	dispose(): void;
}

export interface FileOverwriteOptions {
	overwrite: boolean;
}

export interface FileReadStreamOptions {

	/**
	 * Is an integer specifying where to begin reading from in the file. If position is undefined,
	 * data will be read from the current file position.
	 */
	readonly position?: number;

	/**
	 * Is an integer specifying how many bytes to read from the file. By default, all bytes
	 * will be read.
	 */
	readonly length?: number;

	/**
	 * If provided, the size of the file will be checked against the limits.
	 */
	limits?: {
		readonly size?: number;
		readonly memory?: number;
	};
}

export interface FileWriteOptions {
	overwrite: boolean;
	create: boolean;
}

export interface FileOpenOptions {
	create: boolean;
}

export interface FileDeleteOptions {
	recursive: boolean;
	useTrash: boolean;
}

export enum FileType {
	Unknown = 0,
	File = 1,
	Directory = 2,
	SymbolicLink = 64
}

export interface IStat {
	type: FileType;

	/**
	 * The last modification date represented as millis from unix epoch.
	 */
	mtime: number;

	/**
	 * The creation date represented as millis from unix epoch.
	 */
	ctime: number;

	size: number;
}

export interface IWatchOptions {
	recursive: boolean;
	excludes: string[];
}

export const enum FileSystemProviderCapabilities {
	FileReadWrite = 1 << 1,
	FileOpenReadWriteClose = 1 << 2,
	FileReadStream = 1 << 4,

	FileFolderCopy = 1 << 3,

	PathCaseSensitive = 1 << 10,
	Readonly = 1 << 11,

	Trash = 1 << 12
}

export interface IFileSystemProvider {

	readonly capabilities: FileSystemProviderCapabilities;
	readonly onDidChangeCapabilities: Event<void>;

	readonly onDidErrorOccur?: Event<string>; // TODO@ben remove once file watchers are solid

	readonly onDidChangeFile: Event<readonly IFileChange[]>;
	watch(resource: URI, opts: IWatchOptions): IDisposable;

	stat(resource: URI): Promise<IStat>;
	mkdir(resource: URI): Promise<void>;
	readdir(resource: URI): Promise<[string, FileType][]>;
	delete(resource: URI, opts: FileDeleteOptions): Promise<void>;

	rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void>;
	copy?(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void>;

	readFile?(resource: URI): Promise<Uint8Array>;
	writeFile?(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void>;

	readFileStream?(resource: URI, opts: FileReadStreamOptions, token: CancellationToken): ReadableStreamEvents<Uint8Array>;

	open?(resource: URI, opts: FileOpenOptions): Promise<number>;
	close?(fd: number): Promise<void>;
	read?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
	write?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
}

export interface IFileSystemProviderWithFileReadWriteCapability extends IFileSystemProvider {
	readFile(resource: URI): Promise<Uint8Array>;
	writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void>;
}

export function hasReadWriteCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileReadWriteCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileReadWrite);
}

export interface IFileSystemProviderWithFileFolderCopyCapability extends IFileSystemProvider {
	copy(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void>;
}

export function hasFileFolderCopyCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileFolderCopyCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileFolderCopy);
}

export interface IFileSystemProviderWithOpenReadWriteCloseCapability extends IFileSystemProvider {
	open(resource: URI, opts: FileOpenOptions): Promise<number>;
	close(fd: number): Promise<void>;
	read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
	write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number>;
}

export function hasOpenReadWriteCloseCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithOpenReadWriteCloseCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileOpenReadWriteClose);
}

export interface IFileSystemProviderWithFileReadStreamCapability extends IFileSystemProvider {
	readFileStream(resource: URI, opts: FileReadStreamOptions, token: CancellationToken): ReadableStreamEvents<Uint8Array>;
}

export function hasFileReadStreamCapability(provider: IFileSystemProvider): provider is IFileSystemProviderWithFileReadStreamCapability {
	return !!(provider.capabilities & FileSystemProviderCapabilities.FileReadStream);
}

export enum FileSystemProviderErrorCode {
	FileExists = 'EntryExists',
	FileNotFound = 'EntryNotFound',
	FileNotADirectory = 'EntryNotADirectory',
	FileIsADirectory = 'EntryIsADirectory',
	FileExceedsMemoryLimit = 'EntryExceedsMemoryLimit',
	FileTooLarge = 'EntryTooLarge',
	NoPermissions = 'NoPermissions',
	Unavailable = 'Unavailable',
	Unknown = 'Unknown'
}

export class FileSystemProviderError extends Error {

	constructor(message: string, public readonly code: FileSystemProviderErrorCode) {
		super(message);
	}
}

export function createFileSystemProviderError(error: Error | string, code: FileSystemProviderErrorCode): FileSystemProviderError {
	const providerError = new FileSystemProviderError(error.toString(), code);
	markAsFileSystemProviderError(providerError, code);

	return providerError;
}

export function ensureFileSystemProviderError(error?: Error): Error {
	if (!error) {
		return createFileSystemProviderError(localize('unknownError', "Unknown Error"), FileSystemProviderErrorCode.Unknown); // https://github.com/microsoft/vscode/issues/72798
	}

	return error;
}

export function markAsFileSystemProviderError(error: Error, code: FileSystemProviderErrorCode): Error {
	error.name = code ? `${code} (FileSystemError)` : `FileSystemError`;

	return error;
}

export function toFileSystemProviderErrorCode(error: Error | undefined | null): FileSystemProviderErrorCode {

	// Guard against abuse
	if (!error) {
		return FileSystemProviderErrorCode.Unknown;
	}

	// FileSystemProviderError comes with the code
	if (error instanceof FileSystemProviderError) {
		return error.code;
	}

	// Any other error, check for name match by assuming that the error
	// went through the markAsFileSystemProviderError() method
	const match = /^(.+) \(FileSystemError\)$/.exec(error.name);
	if (!match) {
		return FileSystemProviderErrorCode.Unknown;
	}

	switch (match[1]) {
		case FileSystemProviderErrorCode.FileExists: return FileSystemProviderErrorCode.FileExists;
		case FileSystemProviderErrorCode.FileIsADirectory: return FileSystemProviderErrorCode.FileIsADirectory;
		case FileSystemProviderErrorCode.FileNotADirectory: return FileSystemProviderErrorCode.FileNotADirectory;
		case FileSystemProviderErrorCode.FileNotFound: return FileSystemProviderErrorCode.FileNotFound;
		case FileSystemProviderErrorCode.FileExceedsMemoryLimit: return FileSystemProviderErrorCode.FileExceedsMemoryLimit;
		case FileSystemProviderErrorCode.FileTooLarge: return FileSystemProviderErrorCode.FileTooLarge;
		case FileSystemProviderErrorCode.NoPermissions: return FileSystemProviderErrorCode.NoPermissions;
		case FileSystemProviderErrorCode.Unavailable: return FileSystemProviderErrorCode.Unavailable;
	}

	return FileSystemProviderErrorCode.Unknown;
}

export function toFileOperationResult(error: Error): FileOperationResult {

	// FileSystemProviderError comes with the result already
	if (error instanceof FileOperationError) {
		return error.fileOperationResult;
	}

	// Otherwise try to find from code
	switch (toFileSystemProviderErrorCode(error)) {
		case FileSystemProviderErrorCode.FileNotFound:
			return FileOperationResult.FILE_NOT_FOUND;
		case FileSystemProviderErrorCode.FileIsADirectory:
			return FileOperationResult.FILE_IS_DIRECTORY;
		case FileSystemProviderErrorCode.FileNotADirectory:
			return FileOperationResult.FILE_NOT_DIRECTORY;
		case FileSystemProviderErrorCode.NoPermissions:
			return FileOperationResult.FILE_PERMISSION_DENIED;
		case FileSystemProviderErrorCode.FileExists:
			return FileOperationResult.FILE_MOVE_CONFLICT;
		case FileSystemProviderErrorCode.FileExceedsMemoryLimit:
			return FileOperationResult.FILE_EXCEEDS_MEMORY_LIMIT;
		case FileSystemProviderErrorCode.FileTooLarge:
			return FileOperationResult.FILE_TOO_LARGE;
		default:
			return FileOperationResult.FILE_OTHER_ERROR;
	}
}

export interface IFileSystemProviderRegistrationEvent {
	added: boolean;
	scheme: string;
	provider?: IFileSystemProvider;
}

export interface IFileSystemProviderCapabilitiesChangeEvent {
	provider: IFileSystemProvider;
	scheme: string;
}

export interface IFileSystemProviderActivationEvent {
	scheme: string;
	join(promise: Promise<void>): void;
}

export const enum FileOperation {
	CREATE,
	DELETE,
	MOVE,
	COPY
}

export class FileOperationEvent {

	constructor(resource: URI, operation: FileOperation.DELETE);
	constructor(resource: URI, operation: FileOperation.CREATE | FileOperation.MOVE | FileOperation.COPY, target: IFileStatWithMetadata);
	constructor(public readonly resource: URI, public readonly operation: FileOperation, public readonly target?: IFileStatWithMetadata) { }

	isOperation(operation: FileOperation.DELETE): boolean;
	isOperation(operation: FileOperation.MOVE | FileOperation.COPY | FileOperation.CREATE): this is { readonly target: IFileStatWithMetadata };
	isOperation(operation: FileOperation): boolean {
		return this.operation === operation;
	}
}

/**
 * Possible changes that can occur to a file.
 */
export const enum FileChangeType {
	UPDATED = 0,
	ADDED = 1,
	DELETED = 2
}

/**
 * Identifies a single change in a file.
 */
export interface IFileChange {

	/**
	 * The type of change that occurred to the file.
	 */
	readonly type: FileChangeType;

	/**
	 * The unified resource identifier of the file that changed.
	 */
	readonly resource: URI;
}

export class FileChangesEvent {

	/**
	 * @deprecated use the `contains()` or `affects` method to efficiently find
	 * out if the event relates to a given resource. these methods ensure:
	 * - that there is no expensive lookup needed (by using a `TernarySearchTree`)
	 * - correctly handles `FileChangeType.DELETED` events
	 */
	readonly changes: readonly IFileChange[];

	private readonly added: TernarySearchTree<URI, IFileChange> | undefined = undefined;
	private readonly updated: TernarySearchTree<URI, IFileChange> | undefined = undefined;
	private readonly deleted: TernarySearchTree<URI, IFileChange> | undefined = undefined;

	constructor(changes: readonly IFileChange[], private readonly ignorePathCasing: boolean) {
		this.changes = changes;

		for (const change of changes) {
			switch (change.type) {
				case FileChangeType.ADDED:
					if (!this.added) {
						this.added = TernarySearchTree.forUris<IFileChange>(() => this.ignorePathCasing);
					}
					this.added.set(change.resource, change);
					break;
				case FileChangeType.UPDATED:
					if (!this.updated) {
						this.updated = TernarySearchTree.forUris<IFileChange>(() => this.ignorePathCasing);
					}
					this.updated.set(change.resource, change);
					break;
				case FileChangeType.DELETED:
					if (!this.deleted) {
						this.deleted = TernarySearchTree.forUris<IFileChange>(() => this.ignorePathCasing);
					}
					this.deleted.set(change.resource, change);
					break;
			}
		}
	}

	/**
	 * Find out if the file change events match the provided resource.
	 *
	 * Note: when passing `FileChangeType.DELETED`, we consider a match
	 * also when the parent of the resource got deleted.
	 */
	contains(resource: URI, ...types: FileChangeType[]): boolean {
		return this.doContains(resource, { includeChildren: false }, ...types);
	}

	/**
	 * Find out if the file change events either match the provided
	 * resource, or contain a child of this resource.
	 */
	affects(resource: URI, ...types: FileChangeType[]): boolean {
		return this.doContains(resource, { includeChildren: true }, ...types);
	}

	private doContains(resource: URI, options: { includeChildren: boolean }, ...types: FileChangeType[]): boolean {
		if (!resource) {
			return false;
		}

		const hasTypesFilter = types.length > 0;

		// Added
		if (!hasTypesFilter || types.includes(FileChangeType.ADDED)) {
			if (this.added?.get(resource)) {
				return true;
			}

			if (options.includeChildren && this.added?.findSuperstr(resource)) {
				return true;
			}
		}

		// Updated
		if (!hasTypesFilter || types.includes(FileChangeType.UPDATED)) {
			if (this.updated?.get(resource)) {
				return true;
			}

			if (options.includeChildren && this.updated?.findSuperstr(resource)) {
				return true;
			}
		}

		// Deleted
		if (!hasTypesFilter || types.includes(FileChangeType.DELETED)) {
			if (this.deleted?.findSubstr(resource) /* deleted also considers parent folders */) {
				return true;
			}

			if (options.includeChildren && this.deleted?.findSuperstr(resource)) {
				return true;
			}
		}

		return false;
	}

	/**
	 * @deprecated use the `contains()` method to efficiently find out if the event
	 * relates to a given resource. this method ensures:
	 * - that there is no expensive lookup needed by using a `TernarySearchTree`
	 * - correctly handles `FileChangeType.DELETED` events
	 */
	getAdded(): IFileChange[] {
		return this.getOfType(FileChangeType.ADDED);
	}

	/**
	 * Returns if this event contains added files.
	 */
	gotAdded(): boolean {
		return !!this.added;
	}

	/**
	 * @deprecated use the `contains()` method to efficiently find out if the event
	 * relates to a given resource. this method ensures:
	 * - that there is no expensive lookup needed by using a `TernarySearchTree`
	 * - correctly handles `FileChangeType.DELETED` events
	 */
	getDeleted(): IFileChange[] {
		return this.getOfType(FileChangeType.DELETED);
	}

	/**
	 * Returns if this event contains deleted files.
	 */
	gotDeleted(): boolean {
		return !!this.deleted;
	}

	/**
	 * @deprecated use the `contains()` method to efficiently find out if the event
	 * relates to a given resource. this method ensures:
	 * - that there is no expensive lookup needed by using a `TernarySearchTree`
	 * - correctly handles `FileChangeType.DELETED` events
	 */
	getUpdated(): IFileChange[] {
		return this.getOfType(FileChangeType.UPDATED);
	}

	/**
	 * Returns if this event contains updated files.
	 */
	gotUpdated(): boolean {
		return !!this.updated;
	}

	private getOfType(type: FileChangeType): IFileChange[] {
		const changes: IFileChange[] = [];

		const eventsForType = type === FileChangeType.ADDED ? this.added : type === FileChangeType.UPDATED ? this.updated : this.deleted;
		if (eventsForType) {
			for (const [, change] of eventsForType) {
				changes.push(change);
			}
		}

		return changes;
	}

	/**
	 * @deprecated use the `contains()` method to efficiently find out if the event
	 * relates to a given resource. this method ensures:
	 * - that there is no expensive lookup needed by using a `TernarySearchTree`
	 * - correctly handles `FileChangeType.DELETED` events
	 */
	filter(filterFn: (change: IFileChange) => boolean): FileChangesEvent {
		return new FileChangesEvent(this.changes.filter(change => filterFn(change)), this.ignorePathCasing);
	}
}

export function isParent(path: string, candidate: string, ignoreCase?: boolean): boolean {
	if (!path || !candidate || path === candidate) {
		return false;
	}

	if (candidate.length > path.length) {
		return false;
	}

	if (candidate.charAt(candidate.length - 1) !== sep) {
		candidate += sep;
	}

	if (ignoreCase) {
		return startsWithIgnoreCase(path, candidate);
	}

	return path.indexOf(candidate) === 0;
}

interface IBaseStat {

	/**
	 * The unified resource identifier of this file or folder.
	 */
	resource: URI;

	/**
	 * The name which is the last segment
	 * of the {{path}}.
	 */
	name: string;

	/**
	 * The size of the file.
	 *
	 * The value may or may not be resolved as
	 * it is optional.
	 */
	size?: number;

	/**
	 * The last modification date represented as millis from unix epoch.
	 *
	 * The value may or may not be resolved as
	 * it is optional.
	 */
	mtime?: number;

	/**
	 * The creation date represented as millis from unix epoch.
	 *
	 * The value may or may not be resolved as
	 * it is optional.
	 */
	ctime?: number;

	/**
	 * A unique identifier thet represents the
	 * current state of the file or directory.
	 *
	 * The value may or may not be resolved as
	 * it is optional.
	 */
	etag?: string;
}

export interface IBaseStatWithMetadata extends IBaseStat {
	mtime: number;
	ctime: number;
	etag: string;
	size: number;
}

/**
 * A file resource with meta information.
 */
export interface IFileStat extends IBaseStat {

	/**
	 * The resource is a file.
	 */
	isFile: boolean;

	/**
	 * The resource is a directory.
	 */
	isDirectory: boolean;

	/**
	 * The resource is a symbolic link.
	 */
	isSymbolicLink: boolean;

	/**
	 * The children of the file stat or undefined if none.
	 */
	children?: IFileStat[];
}

export interface IFileStatWithMetadata extends IFileStat, IBaseStatWithMetadata {
	mtime: number;
	ctime: number;
	etag: string;
	size: number;
	children?: IFileStatWithMetadata[];
}

export interface IResolveFileResult {
	stat?: IFileStat;
	success: boolean;
}

export interface IResolveFileResultWithMetadata extends IResolveFileResult {
	stat?: IFileStatWithMetadata;
}

export interface IFileContent extends IBaseStatWithMetadata {

	/**
	 * The content of a file as buffer.
	 */
	value: VSBuffer;
}

export interface IFileStreamContent extends IBaseStatWithMetadata {

	/**
	 * The content of a file as stream.
	 */
	value: VSBufferReadableStream;
}

export interface IReadFileOptions extends FileReadStreamOptions {

	/**
	 * The optional etag parameter allows to return early from resolving the resource if
	 * the contents on disk match the etag. This prevents accumulated reading of resources
	 * that have been read already with the same etag.
	 * It is the task of the caller to makes sure to handle this error case from the promise.
	 */
	readonly etag?: string;
}

export interface IWriteFileOptions {

	/**
	 * The last known modification time of the file. This can be used to prevent dirty writes.
	 */
	readonly mtime?: number;

	/**
	 * The etag of the file. This can be used to prevent dirty writes.
	 */
	readonly etag?: string;
}

export interface IResolveFileOptions {

	/**
	 * Automatically continue resolving children of a directory until the provided resources
	 * are found.
	 */
	readonly resolveTo?: readonly URI[];

	/**
	 * Automatically continue resolving children of a directory if the number of children is 1.
	 */
	readonly resolveSingleChildDescendants?: boolean;

	/**
	 * Will resolve mtime, ctime, size and etag of files if enabled. This can have a negative impact
	 * on performance and thus should only be used when these values are required.
	 */
	readonly resolveMetadata?: boolean;
}

export interface IResolveMetadataFileOptions extends IResolveFileOptions {
	readonly resolveMetadata: true;
}

export interface ICreateFileOptions {

	/**
	 * Overwrite the file to create if it already exists on disk. Otherwise
	 * an error will be thrown (FILE_MODIFIED_SINCE).
	 */
	readonly overwrite?: boolean;
}

export class FileOperationError extends Error {
	constructor(message: string, public fileOperationResult: FileOperationResult, public options?: IReadFileOptions & IWriteFileOptions & ICreateFileOptions) {
		super(message);
	}

	static isFileOperationError(obj: unknown): obj is FileOperationError {
		return obj instanceof Error && !isUndefinedOrNull((obj as FileOperationError).fileOperationResult);
	}
}

export const enum FileOperationResult {
	FILE_IS_DIRECTORY,
	FILE_NOT_FOUND,
	FILE_NOT_MODIFIED_SINCE,
	FILE_MODIFIED_SINCE,
	FILE_MOVE_CONFLICT,
	FILE_READ_ONLY,
	FILE_PERMISSION_DENIED,
	FILE_TOO_LARGE,
	FILE_INVALID_PATH,
	FILE_EXCEEDS_MEMORY_LIMIT,
	FILE_NOT_DIRECTORY,
	FILE_OTHER_ERROR
}

export const AutoSaveConfiguration = {
	OFF: 'off',
	AFTER_DELAY: 'afterDelay',
	ON_FOCUS_CHANGE: 'onFocusChange',
	ON_WINDOW_CHANGE: 'onWindowChange'
};

export const HotExitConfiguration = {
	OFF: 'off',
	ON_EXIT: 'onExit',
	ON_EXIT_AND_WINDOW_CLOSE: 'onExitAndWindowClose'
};

export const FILES_ASSOCIATIONS_CONFIG = 'files.associations';
export const FILES_EXCLUDE_CONFIG = 'files.exclude';

export interface IFilesConfiguration {
	files: {
		associations: { [filepattern: string]: string };
		exclude: glob.IExpression;
		watcherExclude: { [filepattern: string]: boolean };
		encoding: string;
		autoGuessEncoding: boolean;
		defaultLanguage: string;
		trimTrailingWhitespace: boolean;
		autoSave: string;
		autoSaveDelay: number;
		eol: string;
		enableTrash: boolean;
		hotExit: string;
		saveConflictResolution: 'askUser' | 'overwriteFileOnDisk';
	};
}

export enum FileKind {
	FILE,
	FOLDER,
	ROOT_FOLDER
}

/**
 * A hint to disable etag checking for reading/writing.
 */
export const ETAG_DISABLED = '';

export function etag(stat: { mtime: number, size: number }): string;
export function etag(stat: { mtime: number | undefined, size: number | undefined }): string | undefined;
export function etag(stat: { mtime: number | undefined, size: number | undefined }): string | undefined {
	if (typeof stat.size !== 'number' || typeof stat.mtime !== 'number') {
		return undefined;
	}

	return stat.mtime.toString(29) + stat.size.toString(31);
}

export function whenProviderRegistered(file: URI, fileService: IFileService): Promise<void> {
	if (fileService.canHandleResource(URI.from({ scheme: file.scheme }))) {
		return Promise.resolve();
	}

	return new Promise(resolve => {
		const disposable = fileService.onDidChangeFileSystemProviderRegistrations(e => {
			if (e.scheme === file.scheme && e.added) {
				disposable.dispose();
				resolve();
			}
		});
	});
}

/**
 * Native only: limits for memory sizes
 */
export const MIN_MAX_MEMORY_SIZE_MB = 2048;
export const FALLBACK_MAX_MEMORY_SIZE_MB = 4096;

/**
 * Helper to format a raw byte size into a human readable label.
 */
export class ByteSize {
	static readonly KB = 1024;
	static readonly MB = ByteSize.KB * ByteSize.KB;
	static readonly GB = ByteSize.MB * ByteSize.KB;
	static readonly TB = ByteSize.GB * ByteSize.KB;

	static formatSize(size: number): string {
		if (!isNumber(size)) {
			size = 0;
		}

		if (size < ByteSize.KB) {
			return localize('sizeB', "{0}B", size.toFixed(0));
		}

		if (size < ByteSize.MB) {
			return localize('sizeKB', "{0}KB", (size / ByteSize.KB).toFixed(2));
		}

		if (size < ByteSize.GB) {
			return localize('sizeMB', "{0}MB", (size / ByteSize.MB).toFixed(2));
		}

		if (size < ByteSize.TB) {
			return localize('sizeGB', "{0}GB", (size / ByteSize.GB).toFixed(2));
		}

		return localize('sizeTB', "{0}TB", (size / ByteSize.TB).toFixed(2));
	}
}
