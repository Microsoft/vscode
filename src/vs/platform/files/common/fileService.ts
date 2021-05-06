/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { mark } from 'vs/base/common/performance';
import { Disposable, IDisposable, toDisposable, dispose, DisposableStore } from 'vs/base/common/lifecycle';
import { IFileService, IResolveFileOptions, FileChangesEvent, FileOperationEvent, IFileSystemProviderRegistrationEvent, IFileSystemProvider, IFileStat, IResolveFileResult, ICreateFileOptions, IFileSystemProviderActivationEvent, FileOperationError, FileOperationResult, FileOperation, FileSystemProviderCapabilities, FileType, toFileSystemProviderErrorCode, FileSystemProviderErrorCode, IStat, IFileStatWithMetadata, IResolveMetadataFileOptions, etag, hasReadWriteCapability, hasFileFolderCopyCapability, hasOpenReadWriteCloseCapability, toFileOperationResult, IFileSystemProviderWithOpenReadWriteCloseCapability, IFileSystemProviderWithFileReadWriteCapability, IResolveFileResultWithMetadata, IWatchOptions, IWriteFileOptions, IReadFileOptions, IFileStreamContent, IFileContent, ETAG_DISABLED, hasFileReadStreamCapability, IFileSystemProviderWithFileReadStreamCapability, ensureFileSystemProviderError, IFileSystemProviderCapabilitiesChangeEvent, IReadFileStreamOptions, FileDeleteOptions } from 'vs/platform/files/common/files';
import { URI } from 'vs/base/common/uri';
import { Emitter } from 'vs/base/common/event';
import { IExtUri, extUri, extUriIgnorePathCase, isAbsolutePath } from 'vs/base/common/resources';
import { TernarySearchTree } from 'vs/base/common/map';
import { isNonEmptyArray, coalesce } from 'vs/base/common/arrays';
import { ILogService } from 'vs/platform/log/common/log';
import { VSBuffer, VSBufferReadable, readableToBuffer, bufferToReadable, streamToBuffer, VSBufferReadableStream, VSBufferReadableBufferedStream, bufferedStreamToBuffer, newWriteableBufferStream } from 'vs/base/common/buffer';
import { isReadableStream, transform, peekReadable, peekStream, isReadableBufferedStream, newWriteableStream, listenStream, consumeStream } from 'vs/base/common/stream';
import { Promises, ResourceQueue } from 'vs/base/common/async';
import { CancellationTokenSource, CancellationToken } from 'vs/base/common/cancellation';
import { Schemas } from 'vs/base/common/network';
import { readFileIntoStream } from 'vs/platform/files/common/io';
import { Iterable } from 'vs/base/common/iterator';

export class FileService extends Disposable implements IFileService {

	declare readonly _serviceBrand: undefined;

	private readonly BUFFER_SIZE = 64 * 1024;

	constructor(@ILogService private readonly logService: ILogService) {
		super();
	}

	//#region File System Provider

	private readonly _onDidChangeFileSystemProviderRegistrations = this._register(new Emitter<IFileSystemProviderRegistrationEvent>());
	readonly onDidChangeFileSystemProviderRegistrations = this._onDidChangeFileSystemProviderRegistrations.event;

	private readonly _onWillActivateFileSystemProvider = this._register(new Emitter<IFileSystemProviderActivationEvent>());
	readonly onWillActivateFileSystemProvider = this._onWillActivateFileSystemProvider.event;

	private readonly _onDidChangeFileSystemProviderCapabilities = this._register(new Emitter<IFileSystemProviderCapabilitiesChangeEvent>());
	readonly onDidChangeFileSystemProviderCapabilities = this._onDidChangeFileSystemProviderCapabilities.event;

	private readonly provider = new Map<string, IFileSystemProvider>();

	registerProvider(scheme: string, provider: IFileSystemProvider): IDisposable {
		if (this.provider.has(scheme)) {
			throw new Error(`A filesystem provider for the scheme '${scheme}' is already registered.`);
		}

		mark(`code/registerFilesystem/${scheme}`);

		// Add provider with event
		this.provider.set(scheme, provider);
		this._onDidChangeFileSystemProviderRegistrations.fire({ added: true, scheme, provider });

		// Forward events from provider
		const providerDisposables = new DisposableStore();
		providerDisposables.add(provider.onDidChangeFile(changes => this._onDidFilesChange.fire(new FileChangesEvent(changes, !this.isPathCaseSensitive(provider)))));
		providerDisposables.add(provider.onDidChangeCapabilities(() => this._onDidChangeFileSystemProviderCapabilities.fire({ provider, scheme })));
		if (typeof provider.onDidErrorOccur === 'function') {
			providerDisposables.add(provider.onDidErrorOccur(error => this._onError.fire(new Error(error))));
		}

		return toDisposable(() => {
			this._onDidChangeFileSystemProviderRegistrations.fire({ added: false, scheme, provider });
			this.provider.delete(scheme);

			dispose(providerDisposables);
		});
	}

	getProvider(scheme: string): IFileSystemProvider | undefined {
		return this.provider.get(scheme);
	}

	async activateProvider(scheme: string): Promise<void> {

		// Emit an event that we are about to activate a provider with the given scheme.
		// Listeners can participate in the activation by registering a provider for it.
		const joiners: Promise<void>[] = [];
		this._onWillActivateFileSystemProvider.fire({
			scheme,
			join(promise) {
				joiners.push(promise);
			},
		});

		if (this.provider.has(scheme)) {
			return; // provider is already here so we can return directly
		}

		// If the provider is not yet there, make sure to join on the listeners assuming
		// that it takes a bit longer to register the file system provider.
		await Promises.settled(joiners);
	}

	canHandleResource(resource: URI): boolean {
		return this.provider.has(resource.scheme);
	}

	hasCapability(resource: URI, capability: FileSystemProviderCapabilities): boolean {
		const provider = this.provider.get(resource.scheme);

		return !!(provider && (provider.capabilities & capability));
	}

	listCapabilities(): Iterable<{ scheme: string, capabilities: FileSystemProviderCapabilities; }> {
		return Iterable.map(this.provider, ([scheme, provider]) => ({ scheme, capabilities: provider.capabilities }));
	}

	protected async withProvider(resource: URI): Promise<IFileSystemProvider> {

		// Assert path is absolute
		if (!isAbsolutePath(resource)) {
			throw new FileOperationError(localize('invalidPath', "Unable to resolve filesystem provider with relative file path '{0}'", this.resourceForError(resource)), FileOperationResult.FILE_INVALID_PATH);
		}

		// Activate provider
		await this.activateProvider(resource.scheme);

		// Assert provider
		const provider = this.provider.get(resource.scheme);
		if (!provider) {
			const error = new Error();
			error.name = 'ENOPRO';
			error.message = localize('noProviderFound', "No file system provider found for resource '{0}'", resource.toString());

			throw error;
		}

		return provider;
	}

	private async withReadProvider(resource: URI): Promise<IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability | IFileSystemProviderWithFileReadStreamCapability> {
		const provider = await this.withProvider(resource);

		if (hasOpenReadWriteCloseCapability(provider) || hasReadWriteCapability(provider) || hasFileReadStreamCapability(provider)) {
			return provider;
		}

		throw new Error(`Filesystem provider for scheme '${resource.scheme}' neither has FileReadWrite, FileReadStream nor FileOpenReadWriteClose capability which is needed for the read operation.`);
	}

	private async withWriteProvider(resource: URI): Promise<IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability> {
		const provider = await this.withProvider(resource);

		if (hasOpenReadWriteCloseCapability(provider) || hasReadWriteCapability(provider)) {
			return provider;
		}

		throw new Error(`Filesystem provider for scheme '${resource.scheme}' neither has FileReadWrite nor FileOpenReadWriteClose capability which is needed for the write operation.`);
	}

	//#endregion

	private readonly _onDidRunOperation = this._register(new Emitter<FileOperationEvent>());
	readonly onDidRunOperation = this._onDidRunOperation.event;

	private readonly _onError = this._register(new Emitter<Error>());
	readonly onError = this._onError.event;

	//#region File Metadata Resolving

	async resolve(resource: URI, options: IResolveMetadataFileOptions): Promise<IFileStatWithMetadata>;
	async resolve(resource: URI, options?: IResolveFileOptions): Promise<IFileStat>;
	async resolve(resource: URI, options?: IResolveFileOptions): Promise<IFileStat> {
		try {
			return await this.doResolveFile(resource, options);
		} catch (error) {

			// Specially handle file not found case as file operation result
			if (toFileSystemProviderErrorCode(error) === FileSystemProviderErrorCode.FileNotFound) {
				throw new FileOperationError(localize('fileNotFoundError', "Unable to resolve non-existing file '{0}'", this.resourceForError(resource)), FileOperationResult.FILE_NOT_FOUND);
			}

			// Bubble up any other error as is
			throw ensureFileSystemProviderError(error);
		}
	}

	private async doResolveFile(resource: URI, options: IResolveMetadataFileOptions): Promise<IFileStatWithMetadata>;
	private async doResolveFile(resource: URI, options?: IResolveFileOptions): Promise<IFileStat>;
	private async doResolveFile(resource: URI, options?: IResolveFileOptions): Promise<IFileStat> {
		const provider = await this.withProvider(resource);
		const isPathCaseSensitive = this.isPathCaseSensitive(provider);

		const resolveTo = options?.resolveTo;
		const resolveSingleChildDescendants = options?.resolveSingleChildDescendants;
		const resolveMetadata = options?.resolveMetadata;

		const stat = await provider.stat(resource);

		let trie: TernarySearchTree<URI, boolean> | undefined;

		return this.toFileStat(provider, resource, stat, undefined, !!resolveMetadata, (stat, siblings) => {

			// lazy trie to check for recursive resolving
			if (!trie) {
				trie = TernarySearchTree.forUris<true>(() => !isPathCaseSensitive);
				trie.set(resource, true);
				if (isNonEmptyArray(resolveTo)) {
					resolveTo.forEach(uri => trie!.set(uri, true));
				}
			}

			// check for recursive resolving
			if (Boolean(trie.findSuperstr(stat.resource) || trie.get(stat.resource))) {
				return true;
			}

			// check for resolving single child folders
			if (stat.isDirectory && resolveSingleChildDescendants) {
				return siblings === 1;
			}

			return false;
		});
	}

	private async toFileStat(provider: IFileSystemProvider, resource: URI, stat: IStat | { type: FileType; } & Partial<IStat>, siblings: number | undefined, resolveMetadata: boolean, recurse: (stat: IFileStat, siblings?: number) => boolean): Promise<IFileStat>;
	private async toFileStat(provider: IFileSystemProvider, resource: URI, stat: IStat, siblings: number | undefined, resolveMetadata: true, recurse: (stat: IFileStat, siblings?: number) => boolean): Promise<IFileStatWithMetadata>;
	private async toFileStat(provider: IFileSystemProvider, resource: URI, stat: IStat | { type: FileType; } & Partial<IStat>, siblings: number | undefined, resolveMetadata: boolean, recurse: (stat: IFileStat, siblings?: number) => boolean): Promise<IFileStat> {
		const { providerExtUri } = this.getExtUri(provider);

		// convert to file stat
		const fileStat: IFileStat = {
			resource,
			name: providerExtUri.basename(resource),
			isFile: (stat.type & FileType.File) !== 0,
			isDirectory: (stat.type & FileType.Directory) !== 0,
			isSymbolicLink: (stat.type & FileType.SymbolicLink) !== 0,
			mtime: stat.mtime,
			ctime: stat.ctime,
			size: stat.size,
			etag: etag({ mtime: stat.mtime, size: stat.size })
		};

		// check to recurse for directories
		if (fileStat.isDirectory && recurse(fileStat, siblings)) {
			try {
				const entries = await provider.readdir(resource);
				const resolvedEntries = await Promises.settled(entries.map(async ([name, type]) => {
					try {
						const childResource = providerExtUri.joinPath(resource, name);
						const childStat = resolveMetadata ? await provider.stat(childResource) : { type };

						return await this.toFileStat(provider, childResource, childStat, entries.length, resolveMetadata, recurse);
					} catch (error) {
						this.logService.trace(error);

						return null; // can happen e.g. due to permission errors
					}
				}));

				// make sure to get rid of null values that signal a failure to resolve a particular entry
				fileStat.children = coalesce(resolvedEntries);
			} catch (error) {
				this.logService.trace(error);

				fileStat.children = []; // gracefully handle errors, we may not have permissions to read
			}

			return fileStat;
		}

		return fileStat;
	}

	async resolveAll(toResolve: { resource: URI, options?: IResolveFileOptions; }[]): Promise<IResolveFileResult[]>;
	async resolveAll(toResolve: { resource: URI, options: IResolveMetadataFileOptions; }[]): Promise<IResolveFileResultWithMetadata[]>;
	async resolveAll(toResolve: { resource: URI; options?: IResolveFileOptions; }[]): Promise<IResolveFileResult[]> {
		return Promises.settled(toResolve.map(async entry => {
			try {
				return { stat: await this.doResolveFile(entry.resource, entry.options), success: true };
			} catch (error) {
				this.logService.trace(error);

				return { stat: undefined, success: false };
			}
		}));
	}

	async exists(resource: URI): Promise<boolean> {
		const provider = await this.withProvider(resource);

		try {
			const stat = await provider.stat(resource);

			return !!stat;
		} catch (error) {
			return false;
		}
	}

	//#endregion

	//#region File Reading/Writing

	async canCreateFile(resource: URI, options?: ICreateFileOptions): Promise<Error | true> {
		try {
			await this.doValidateCreateFile(resource, options);
		} catch (error) {
			return error;
		}

		return true;
	}

	private async doValidateCreateFile(resource: URI, options?: ICreateFileOptions): Promise<void> {

		// validate overwrite
		if (!options?.overwrite && await this.exists(resource)) {
			throw new FileOperationError(localize('fileExists', "Unable to create file '{0}' that already exists when overwrite flag is not set", this.resourceForError(resource)), FileOperationResult.FILE_MODIFIED_SINCE, options);
		}
	}

	async createFile(resource: URI, bufferOrReadableOrStream: VSBuffer | VSBufferReadable | VSBufferReadableStream = VSBuffer.fromString(''), options?: ICreateFileOptions): Promise<IFileStatWithMetadata> {

		// validate
		await this.doValidateCreateFile(resource, options);

		// do write into file (this will create it too)
		const fileStat = await this.writeFile(resource, bufferOrReadableOrStream);

		// events
		this._onDidRunOperation.fire(new FileOperationEvent(resource, FileOperation.CREATE, fileStat));

		return fileStat;
	}

	async writeFile(resource: URI, bufferOrReadableOrStream: VSBuffer | VSBufferReadable | VSBufferReadableStream, options?: IWriteFileOptions): Promise<IFileStatWithMetadata> {
		const provider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(resource), resource);
		const { providerExtUri } = this.getExtUri(provider);

		try {

			// validate write
			const stat = await this.validateWriteFile(provider, resource, options);

			// mkdir recursively as needed
			if (!stat) {
				await this.mkdirp(provider, providerExtUri.dirname(resource));
			}

			// optimization: if the provider has unbuffered write capability and the data
			// to write is a Readable, we consume up to 3 chunks and try to write the data
			// unbuffered to reduce the overhead. If the Readable has more data to provide
			// we continue to write buffered.
			let bufferOrReadableOrStreamOrBufferedStream: VSBuffer | VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream;
			if (hasReadWriteCapability(provider) && !(bufferOrReadableOrStream instanceof VSBuffer)) {
				if (isReadableStream(bufferOrReadableOrStream)) {
					const bufferedStream = await peekStream(bufferOrReadableOrStream, 3);
					if (bufferedStream.ended) {
						bufferOrReadableOrStreamOrBufferedStream = VSBuffer.concat(bufferedStream.buffer);
					} else {
						bufferOrReadableOrStreamOrBufferedStream = bufferedStream;
					}
				} else {
					bufferOrReadableOrStreamOrBufferedStream = peekReadable(bufferOrReadableOrStream, data => VSBuffer.concat(data), 3);
				}
			} else {
				bufferOrReadableOrStreamOrBufferedStream = bufferOrReadableOrStream;
			}

			// write file: unbuffered (only if data to write is a buffer, or the provider has no buffered write capability)
			if (!hasOpenReadWriteCloseCapability(provider) || (hasReadWriteCapability(provider) && bufferOrReadableOrStreamOrBufferedStream instanceof VSBuffer)) {
				await this.doWriteUnbuffered(provider, resource, options, bufferOrReadableOrStreamOrBufferedStream);
			}

			// write file: buffered
			else {
				await this.doWriteBuffered(provider, resource, options, bufferOrReadableOrStreamOrBufferedStream instanceof VSBuffer ? bufferToReadable(bufferOrReadableOrStreamOrBufferedStream) : bufferOrReadableOrStreamOrBufferedStream);
			}
		} catch (error) {
			throw new FileOperationError(localize('err.write', "Unable to write file '{0}' ({1})", this.resourceForError(resource), ensureFileSystemProviderError(error).toString()), toFileOperationResult(error), options);
		}

		return this.resolve(resource, { resolveMetadata: true });
	}

	private async validateWriteFile(provider: IFileSystemProvider, resource: URI, options?: IWriteFileOptions): Promise<IStat | undefined> {

		// Validate unlock support
		const unlock = !!options?.unlock;
		if (unlock && !(provider.capabilities & FileSystemProviderCapabilities.FileWriteUnlock)) {
			throw new Error(localize('writeFailedUnlockUnsupported', "Unable to unlock file '{0}' because provider does not support it.", this.resourceForError(resource)));
		}

		// Validate via file stat meta data
		let stat: IStat | undefined = undefined;
		try {
			stat = await provider.stat(resource);
		} catch (error) {
			return undefined; // file might not exist
		}

		// File cannot be directory
		if ((stat.type & FileType.Directory) !== 0) {
			throw new FileOperationError(localize('fileIsDirectoryWriteError', "Unable to write file '{0}' that is actually a directory", this.resourceForError(resource)), FileOperationResult.FILE_IS_DIRECTORY, options);
		}

		// Dirty write prevention: if the file on disk has been changed and does not match our expected
		// mtime and etag, we bail out to prevent dirty writing.
		//
		// First, we check for a mtime that is in the future before we do more checks. The assumption is
		// that only the mtime is an indicator for a file that has changed on disk.
		//
		// Second, if the mtime has advanced, we compare the size of the file on disk with our previous
		// one using the etag() function. Relying only on the mtime check has prooven to produce false
		// positives due to file system weirdness (especially around remote file systems). As such, the
		// check for size is a weaker check because it can return a false negative if the file has changed
		// but to the same length. This is a compromise we take to avoid having to produce checksums of
		// the file content for comparison which would be much slower to compute.
		if (
			options && typeof options.mtime === 'number' && typeof options.etag === 'string' && options.etag !== ETAG_DISABLED &&
			typeof stat.mtime === 'number' && typeof stat.size === 'number' &&
			options.mtime < stat.mtime && options.etag !== etag({ mtime: options.mtime /* not using stat.mtime for a reason, see above */, size: stat.size })
		) {
			throw new FileOperationError(localize('fileModifiedError', "File Modified Since"), FileOperationResult.FILE_MODIFIED_SINCE, options);
		}

		return stat;
	}

	async readFile(resource: URI, options?: IReadFileOptions): Promise<IFileContent> {
		const provider = await this.withReadProvider(resource);

		if (options?.atomic) {
			return this.doReadFileAtomic(provider, resource, options);
		}

		return this.doReadFile(provider, resource, options);
	}

	private async doReadFileAtomic(provider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability | IFileSystemProviderWithFileReadStreamCapability, resource: URI, options?: IReadFileOptions): Promise<IFileContent> {
		return new Promise<IFileContent>((resolve, reject) => {
			this.writeQueue.queueFor(resource, this.getExtUri(provider).providerExtUri).queue(async () => {
				try {
					const content = await this.doReadFile(provider, resource, options);
					resolve(content);
				} catch (error) {
					reject(error);
				}
			});
		});
	}

	private async doReadFile(provider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability | IFileSystemProviderWithFileReadStreamCapability, resource: URI, options?: IReadFileOptions): Promise<IFileContent> {
		const stream = await this.doReadFileStream(provider, resource, {
			...options,
			// optimization: since we know that the caller does not
			// care about buffering, we indicate this to the reader.
			// this reduces all the overhead the buffered reading
			// has (open, read, close) if the provider supports
			// unbuffered reading.
			preferUnbuffered: true
		});

		return {
			...stream,
			value: await streamToBuffer(stream.value)
		};
	}

	async readFileStream(resource: URI, options?: IReadFileStreamOptions): Promise<IFileStreamContent> {
		const provider = await this.withReadProvider(resource);

		return this.doReadFileStream(provider, resource, options);
	}

	private async doReadFileStream(provider: IFileSystemProviderWithFileReadWriteCapability | IFileSystemProviderWithOpenReadWriteCloseCapability | IFileSystemProviderWithFileReadStreamCapability, resource: URI, options?: IReadFileStreamOptions & { preferUnbuffered?: boolean; }): Promise<IFileStreamContent> {

		// install a cancellation token that gets cancelled
		// when any error occurs. this allows us to resolve
		// the content of the file while resolving metadata
		// but still cancel the operation in certain cases.
		const cancellableSource = new CancellationTokenSource();

		// validate read operation
		const statPromise = this.validateReadFile(resource, options).then(stat => stat, error => {
			cancellableSource.cancel();

			throw error;
		});

		let fileStream: VSBufferReadableStream | undefined = undefined;
		try {

			// if the etag is provided, we await the result of the validation
			// due to the likelihood of hitting a NOT_MODIFIED_SINCE result.
			// otherwise, we let it run in parallel to the file reading for
			// optimal startup performance.
			if (options && typeof options.etag === 'string' && options.etag !== ETAG_DISABLED) {
				await statPromise;
			}

			// read unbuffered (only if either preferred, or the provider has no buffered read capability)
			if (!(hasOpenReadWriteCloseCapability(provider) || hasFileReadStreamCapability(provider)) || (hasReadWriteCapability(provider) && options?.preferUnbuffered)) {
				fileStream = this.readFileUnbuffered(provider, resource, options);
			}

			// read streamed (always prefer over primitive buffered read)
			else if (hasFileReadStreamCapability(provider)) {
				fileStream = this.readFileStreamed(provider, resource, cancellableSource.token, options);
			}

			// read buffered
			else {
				fileStream = this.readFileBuffered(provider, resource, cancellableSource.token, options);
			}

			const fileStat = await statPromise;

			return {
				...fileStat,
				value: fileStream
			};
		} catch (error) {

			// Await the stream to finish so that we exit this method
			// in a consistent state with file handles closed
			// (https://github.com/microsoft/vscode/issues/114024)
			if (fileStream) {
				await consumeStream(fileStream);
			}

			throw new FileOperationError(localize('err.read', "Unable to read file '{0}' ({1})", this.resourceForError(resource), ensureFileSystemProviderError(error).toString()), toFileOperationResult(error), options);
		}
	}

	private readFileStreamed(provider: IFileSystemProviderWithFileReadStreamCapability, resource: URI, token: CancellationToken, options: IReadFileStreamOptions = Object.create(null)): VSBufferReadableStream {
		const fileStream = provider.readFileStream(resource, options, token);

		return transform(fileStream, {
			data: data => data instanceof VSBuffer ? data : VSBuffer.wrap(data),
			error: error => new FileOperationError(localize('err.read', "Unable to read file '{0}' ({1})", this.resourceForError(resource), ensureFileSystemProviderError(error).toString()), toFileOperationResult(error), options)
		}, data => VSBuffer.concat(data));
	}

	private readFileBuffered(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, resource: URI, token: CancellationToken, options: IReadFileStreamOptions = Object.create(null)): VSBufferReadableStream {
		const stream = newWriteableBufferStream();

		readFileIntoStream(provider, resource, stream, data => data, {
			...options,
			bufferSize: this.BUFFER_SIZE,
			errorTransformer: error => new FileOperationError(localize('err.read', "Unable to read file '{0}' ({1})", this.resourceForError(resource), ensureFileSystemProviderError(error).toString()), toFileOperationResult(error), options)
		}, token);

		return stream;
	}

	private readFileUnbuffered(provider: IFileSystemProviderWithFileReadWriteCapability, resource: URI, options?: IReadFileStreamOptions): VSBufferReadableStream {
		const stream = newWriteableStream<VSBuffer>(data => VSBuffer.concat(data));

		// Read the file into the stream async but do not wait for
		// this to complete because streams work via events
		(async () => {
			try {
				let buffer = await provider.readFile(resource);

				// respect position option
				if (options && typeof options.position === 'number') {
					buffer = buffer.slice(options.position);
				}

				// respect length option
				if (options && typeof options.length === 'number') {
					buffer = buffer.slice(0, options.length);
				}

				// Throw if file is too large to load
				this.validateReadFileLimits(resource, buffer.byteLength, options);

				// End stream with data
				stream.end(VSBuffer.wrap(buffer));
			} catch (err) {
				stream.error(err);
				stream.end();
			}
		})();

		return stream;
	}

	private async validateReadFile(resource: URI, options?: IReadFileStreamOptions): Promise<IFileStatWithMetadata> {
		const stat = await this.resolve(resource, { resolveMetadata: true });

		// Throw if resource is a directory
		if (stat.isDirectory) {
			throw new FileOperationError(localize('fileIsDirectoryReadError', "Unable to read file '{0}' that is actually a directory", this.resourceForError(resource)), FileOperationResult.FILE_IS_DIRECTORY, options);
		}

		// Throw if file not modified since (unless disabled)
		if (options && typeof options.etag === 'string' && options.etag !== ETAG_DISABLED && options.etag === stat.etag) {
			throw new FileOperationError(localize('fileNotModifiedError', "File not modified since"), FileOperationResult.FILE_NOT_MODIFIED_SINCE, options);
		}

		// Throw if file is too large to load
		this.validateReadFileLimits(resource, stat.size, options);

		return stat;
	}

	private validateReadFileLimits(resource: URI, size: number, options?: IReadFileStreamOptions): void {
		if (options?.limits) {
			let tooLargeErrorResult: FileOperationResult | undefined = undefined;

			if (typeof options.limits.memory === 'number' && size > options.limits.memory) {
				tooLargeErrorResult = FileOperationResult.FILE_EXCEEDS_MEMORY_LIMIT;
			}

			if (typeof options.limits.size === 'number' && size > options.limits.size) {
				tooLargeErrorResult = FileOperationResult.FILE_TOO_LARGE;
			}

			if (typeof tooLargeErrorResult === 'number') {
				throw new FileOperationError(localize('fileTooLargeError', "Unable to read file '{0}' that is too large to open", this.resourceForError(resource)), tooLargeErrorResult);
			}
		}
	}

	//#endregion

	//#region Move/Copy/Delete/Create Folder

	async canMove(source: URI, target: URI, overwrite?: boolean): Promise<Error | true> {
		return this.doCanMoveCopy(source, target, 'move', overwrite);
	}

	async canCopy(source: URI, target: URI, overwrite?: boolean): Promise<Error | true> {
		return this.doCanMoveCopy(source, target, 'copy', overwrite);
	}

	private async doCanMoveCopy(source: URI, target: URI, mode: 'move' | 'copy', overwrite?: boolean): Promise<Error | true> {
		if (source.toString() !== target.toString()) {
			try {
				const sourceProvider = mode === 'move' ? this.throwIfFileSystemIsReadonly(await this.withWriteProvider(source), source) : await this.withReadProvider(source);
				const targetProvider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(target), target);

				await this.doValidateMoveCopy(sourceProvider, source, targetProvider, target, mode, overwrite);
			} catch (error) {
				return error;
			}
		}

		return true;
	}

	async move(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata> {
		const sourceProvider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(source), source);
		const targetProvider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(target), target);

		// move
		const mode = await this.doMoveCopy(sourceProvider, source, targetProvider, target, 'move', !!overwrite);

		// resolve and send events
		const fileStat = await this.resolve(target, { resolveMetadata: true });
		this._onDidRunOperation.fire(new FileOperationEvent(source, mode === 'move' ? FileOperation.MOVE : FileOperation.COPY, fileStat));

		return fileStat;
	}

	async copy(source: URI, target: URI, overwrite?: boolean): Promise<IFileStatWithMetadata> {
		const sourceProvider = await this.withReadProvider(source);
		const targetProvider = this.throwIfFileSystemIsReadonly(await this.withWriteProvider(target), target);

		// copy
		const mode = await this.doMoveCopy(sourceProvider, source, targetProvider, target, 'copy', !!overwrite);

		// resolve and send events
		const fileStat = await this.resolve(target, { resolveMetadata: true });
		this._onDidRunOperation.fire(new FileOperationEvent(source, mode === 'copy' ? FileOperation.COPY : FileOperation.MOVE, fileStat));

		return fileStat;
	}

	private async doMoveCopy(sourceProvider: IFileSystemProvider, source: URI, targetProvider: IFileSystemProvider, target: URI, mode: 'move' | 'copy', overwrite: boolean): Promise<'move' | 'copy'> {
		if (source.toString() === target.toString()) {
			return mode; // simulate node.js behaviour here and do a no-op if paths match
		}

		// validation
		const { exists, isSameResourceWithDifferentPathCase } = await this.doValidateMoveCopy(sourceProvider, source, targetProvider, target, mode, overwrite);

		// delete as needed (unless target is same resurce with different path case)
		if (exists && !isSameResourceWithDifferentPathCase && overwrite) {
			await this.del(target, { recursive: true });
		}

		// create parent folders
		await this.mkdirp(targetProvider, this.getExtUri(targetProvider).providerExtUri.dirname(target));

		// copy source => target
		if (mode === 'copy') {

			// same provider with fast copy: leverage copy() functionality
			if (sourceProvider === targetProvider && hasFileFolderCopyCapability(sourceProvider)) {
				await sourceProvider.copy(source, target, { overwrite });
			}

			// when copying via buffer/unbuffered, we have to manually
			// traverse the source if it is a folder and not a file
			else {
				const sourceFile = await this.resolve(source);
				if (sourceFile.isDirectory) {
					await this.doCopyFolder(sourceProvider, sourceFile, targetProvider, target);
				} else {
					await this.doCopyFile(sourceProvider, source, targetProvider, target);
				}
			}

			return mode;
		}

		// move source => target
		else {

			// same provider: leverage rename() functionality
			if (sourceProvider === targetProvider) {
				await sourceProvider.rename(source, target, { overwrite });

				return mode;
			}

			// across providers: copy to target & delete at source
			else {
				await this.doMoveCopy(sourceProvider, source, targetProvider, target, 'copy', overwrite);
				await this.del(source, { recursive: true });

				return 'copy';
			}
		}
	}

	private async doCopyFile(sourceProvider: IFileSystemProvider, source: URI, targetProvider: IFileSystemProvider, target: URI): Promise<void> {

		// copy: source (buffered) => target (buffered)
		if (hasOpenReadWriteCloseCapability(sourceProvider) && hasOpenReadWriteCloseCapability(targetProvider)) {
			return this.doPipeBuffered(sourceProvider, source, targetProvider, target);
		}

		// copy: source (buffered) => target (unbuffered)
		if (hasOpenReadWriteCloseCapability(sourceProvider) && hasReadWriteCapability(targetProvider)) {
			return this.doPipeBufferedToUnbuffered(sourceProvider, source, targetProvider, target);
		}

		// copy: source (unbuffered) => target (buffered)
		if (hasReadWriteCapability(sourceProvider) && hasOpenReadWriteCloseCapability(targetProvider)) {
			return this.doPipeUnbufferedToBuffered(sourceProvider, source, targetProvider, target);
		}

		// copy: source (unbuffered) => target (unbuffered)
		if (hasReadWriteCapability(sourceProvider) && hasReadWriteCapability(targetProvider)) {
			return this.doPipeUnbuffered(sourceProvider, source, targetProvider, target);
		}
	}

	private async doCopyFolder(sourceProvider: IFileSystemProvider, sourceFolder: IFileStat, targetProvider: IFileSystemProvider, targetFolder: URI): Promise<void> {

		// create folder in target
		await targetProvider.mkdir(targetFolder);

		// create children in target
		if (Array.isArray(sourceFolder.children)) {
			await Promises.settled(sourceFolder.children.map(async sourceChild => {
				const targetChild = this.getExtUri(targetProvider).providerExtUri.joinPath(targetFolder, sourceChild.name);
				if (sourceChild.isDirectory) {
					return this.doCopyFolder(sourceProvider, await this.resolve(sourceChild.resource), targetProvider, targetChild);
				} else {
					return this.doCopyFile(sourceProvider, sourceChild.resource, targetProvider, targetChild);
				}
			}));
		}
	}

	private async doValidateMoveCopy(sourceProvider: IFileSystemProvider, source: URI, targetProvider: IFileSystemProvider, target: URI, mode: 'move' | 'copy', overwrite?: boolean): Promise<{ exists: boolean, isSameResourceWithDifferentPathCase: boolean; }> {
		let isSameResourceWithDifferentPathCase = false;

		// Check if source is equal or parent to target (requires providers to be the same)
		if (sourceProvider === targetProvider) {
			const { providerExtUri, isPathCaseSensitive } = this.getExtUri(sourceProvider);
			if (!isPathCaseSensitive) {
				isSameResourceWithDifferentPathCase = providerExtUri.isEqual(source, target);
			}

			if (isSameResourceWithDifferentPathCase && mode === 'copy') {
				throw new Error(localize('unableToMoveCopyError1', "Unable to copy when source '{0}' is same as target '{1}' with different path case on a case insensitive file system", this.resourceForError(source), this.resourceForError(target)));
			}

			if (!isSameResourceWithDifferentPathCase && providerExtUri.isEqualOrParent(target, source)) {
				throw new Error(localize('unableToMoveCopyError2', "Unable to move/copy when source '{0}' is parent of target '{1}'.", this.resourceForError(source), this.resourceForError(target)));
			}
		}

		// Extra checks if target exists and this is not a rename
		const exists = await this.exists(target);
		if (exists && !isSameResourceWithDifferentPathCase) {

			// Bail out if target exists and we are not about to overwrite
			if (!overwrite) {
				throw new FileOperationError(localize('unableToMoveCopyError3', "Unable to move/copy '{0}' because target '{1}' already exists at destination.", this.resourceForError(source), this.resourceForError(target)), FileOperationResult.FILE_MOVE_CONFLICT);
			}

			// Special case: if the target is a parent of the source, we cannot delete
			// it as it would delete the source as well. In this case we have to throw
			if (sourceProvider === targetProvider) {
				const { providerExtUri } = this.getExtUri(sourceProvider);
				if (providerExtUri.isEqualOrParent(source, target)) {
					throw new Error(localize('unableToMoveCopyError4', "Unable to move/copy '{0}' into '{1}' since a file would replace the folder it is contained in.", this.resourceForError(source), this.resourceForError(target)));
				}
			}
		}

		return { exists, isSameResourceWithDifferentPathCase };
	}

	private getExtUri(provider: IFileSystemProvider): { providerExtUri: IExtUri, isPathCaseSensitive: boolean; } {
		const isPathCaseSensitive = this.isPathCaseSensitive(provider);

		return {
			providerExtUri: isPathCaseSensitive ? extUri : extUriIgnorePathCase,
			isPathCaseSensitive
		};
	}

	private isPathCaseSensitive(provider: IFileSystemProvider): boolean {
		return !!(provider.capabilities & FileSystemProviderCapabilities.PathCaseSensitive);
	}

	async createFolder(resource: URI): Promise<IFileStatWithMetadata> {
		const provider = this.throwIfFileSystemIsReadonly(await this.withProvider(resource), resource);

		// mkdir recursively
		await this.mkdirp(provider, resource);

		// events
		const fileStat = await this.resolve(resource, { resolveMetadata: true });
		this._onDidRunOperation.fire(new FileOperationEvent(resource, FileOperation.CREATE, fileStat));

		return fileStat;
	}

	private async mkdirp(provider: IFileSystemProvider, directory: URI): Promise<void> {
		const directoriesToCreate: string[] = [];

		// mkdir until we reach root
		const { providerExtUri } = this.getExtUri(provider);
		while (!providerExtUri.isEqual(directory, providerExtUri.dirname(directory))) {
			try {
				const stat = await provider.stat(directory);
				if ((stat.type & FileType.Directory) === 0) {
					throw new Error(localize('mkdirExistsError', "Unable to create folder '{0}' that already exists but is not a directory", this.resourceForError(directory)));
				}

				break; // we have hit a directory that exists -> good
			} catch (error) {

				// Bubble up any other error that is not file not found
				if (toFileSystemProviderErrorCode(error) !== FileSystemProviderErrorCode.FileNotFound) {
					throw error;
				}

				// Upon error, remember directories that need to be created
				directoriesToCreate.push(providerExtUri.basename(directory));

				// Continue up
				directory = providerExtUri.dirname(directory);
			}
		}

		// Create directories as needed
		for (let i = directoriesToCreate.length - 1; i >= 0; i--) {
			directory = providerExtUri.joinPath(directory, directoriesToCreate[i]);

			try {
				await provider.mkdir(directory);
			} catch (error) {
				if (toFileSystemProviderErrorCode(error) !== FileSystemProviderErrorCode.FileExists) {
					// For mkdirp() we tolerate that the mkdir() call fails
					// in case the folder already exists. This follows node.js
					// own implementation of fs.mkdir({ recursive: true }) and
					// reduces the chances of race conditions leading to errors
					// if multiple calls try to create the same folders
					// As such, we only throw an error here if it is other than
					// the fact that the file already exists.
					// (see also https://github.com/microsoft/vscode/issues/89834)
					throw error;
				}
			}
		}
	}

	async canDelete(resource: URI, options?: Partial<FileDeleteOptions>): Promise<Error | true> {
		try {
			await this.doValidateDelete(resource, options);
		} catch (error) {
			return error;
		}

		return true;
	}

	private async doValidateDelete(resource: URI, options?: Partial<FileDeleteOptions>): Promise<IFileSystemProvider> {
		const provider = this.throwIfFileSystemIsReadonly(await this.withProvider(resource), resource);

		// Validate trash support
		const useTrash = !!options?.useTrash;
		if (useTrash && !(provider.capabilities & FileSystemProviderCapabilities.Trash)) {
			throw new Error(localize('deleteFailedTrashUnsupported', "Unable to delete file '{0}' via trash because provider does not support it.", this.resourceForError(resource)));
		}

		// Validate delete
		const exists = await this.exists(resource);
		if (!exists) {
			throw new FileOperationError(localize('deleteFailedNotFound', "Unable to delete non-existing file '{0}'", this.resourceForError(resource)), FileOperationResult.FILE_NOT_FOUND);
		}

		// Validate recursive
		const recursive = !!options?.recursive;
		if (!recursive && exists) {
			const stat = await this.resolve(resource);
			if (stat.isDirectory && Array.isArray(stat.children) && stat.children.length > 0) {
				throw new Error(localize('deleteFailedNonEmptyFolder', "Unable to delete non-empty folder '{0}'.", this.resourceForError(resource)));
			}
		}

		return provider;
	}

	async del(resource: URI, options?: Partial<FileDeleteOptions>): Promise<void> {
		const provider = await this.doValidateDelete(resource, options);

		const useTrash = !!options?.useTrash;
		const recursive = !!options?.recursive;

		// Delete through provider
		await provider.delete(resource, { recursive, useTrash });

		// Events
		this._onDidRunOperation.fire(new FileOperationEvent(resource, FileOperation.DELETE));
	}

	//#endregion

	//#region File Watching

	private readonly _onDidFilesChange = this._register(new Emitter<FileChangesEvent>());
	readonly onDidFilesChange = this._onDidFilesChange.event;

	private readonly activeWatchers = new Map<string, { disposable: IDisposable, count: number; }>();

	watch(resource: URI, options: IWatchOptions = { recursive: false, excludes: [] }): IDisposable {
		let watchDisposed = false;
		let disposeWatch = () => { watchDisposed = true; };

		// Watch and wire in disposable which is async but
		// check if we got disposed meanwhile and forward
		this.doWatch(resource, options).then(disposable => {
			if (watchDisposed) {
				dispose(disposable);
			} else {
				disposeWatch = () => dispose(disposable);
			}
		}, error => this.logService.error(error));

		return toDisposable(() => disposeWatch());
	}

	async doWatch(resource: URI, options: IWatchOptions): Promise<IDisposable> {
		const provider = await this.withProvider(resource);
		const key = this.toWatchKey(provider, resource, options);

		// Only start watching if we are the first for the given key
		const watcher = this.activeWatchers.get(key) || { count: 0, disposable: provider.watch(resource, options) };
		if (!this.activeWatchers.has(key)) {
			this.activeWatchers.set(key, watcher);
		}

		// Increment usage counter
		watcher.count += 1;

		return toDisposable(() => {

			// Unref
			watcher.count--;

			// Dispose only when last user is reached
			if (watcher.count === 0) {
				dispose(watcher.disposable);
				this.activeWatchers.delete(key);
			}
		});
	}

	private toWatchKey(provider: IFileSystemProvider, resource: URI, options: IWatchOptions): string {
		const { providerExtUri } = this.getExtUri(provider);

		return [
			providerExtUri.getComparisonKey(resource), 	// lowercase path if the provider is case insensitive
			String(options.recursive),					// use recursive: true | false as part of the key
			options.excludes.join()						// use excludes as part of the key
		].join();
	}

	override dispose(): void {
		super.dispose();

		this.activeWatchers.forEach(watcher => dispose(watcher.disposable));
		this.activeWatchers.clear();
	}

	//#endregion

	//#region Helpers

	private readonly writeQueue = this._register(new ResourceQueue());

	private async doWriteBuffered(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, resource: URI, options: IWriteFileOptions | undefined, readableOrStreamOrBufferedStream: VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream): Promise<void> {
		return this.writeQueue.queueFor(resource, this.getExtUri(provider).providerExtUri).queue(async () => {

			// open handle
			const handle = await provider.open(resource, { create: true, unlock: options?.unlock ?? false });

			// write into handle until all bytes from buffer have been written
			try {
				if (isReadableStream(readableOrStreamOrBufferedStream) || isReadableBufferedStream(readableOrStreamOrBufferedStream)) {
					await this.doWriteStreamBufferedQueued(provider, handle, readableOrStreamOrBufferedStream);
				} else {
					await this.doWriteReadableBufferedQueued(provider, handle, readableOrStreamOrBufferedStream);
				}
			} catch (error) {
				throw ensureFileSystemProviderError(error);
			} finally {

				// close handle always
				await provider.close(handle);
			}
		});
	}

	private async doWriteStreamBufferedQueued(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, handle: number, streamOrBufferedStream: VSBufferReadableStream | VSBufferReadableBufferedStream): Promise<void> {
		let posInFile = 0;
		let stream: VSBufferReadableStream;

		// Buffered stream: consume the buffer first by writing
		// it to the target before reading from the stream.
		if (isReadableBufferedStream(streamOrBufferedStream)) {
			if (streamOrBufferedStream.buffer.length > 0) {
				const chunk = VSBuffer.concat(streamOrBufferedStream.buffer);
				await this.doWriteBuffer(provider, handle, chunk, chunk.byteLength, posInFile, 0);

				posInFile += chunk.byteLength;
			}

			// If the stream has been consumed, return early
			if (streamOrBufferedStream.ended) {
				return;
			}

			stream = streamOrBufferedStream.stream;
		}

		// Unbuffered stream - just take as is
		else {
			stream = streamOrBufferedStream;
		}

		return new Promise(async (resolve, reject) => {

			listenStream(stream, {
				onData: async chunk => {

					// pause stream to perform async write operation
					stream.pause();

					try {
						await this.doWriteBuffer(provider, handle, chunk, chunk.byteLength, posInFile, 0);
					} catch (error) {
						return reject(error);
					}

					posInFile += chunk.byteLength;

					// resume stream now that we have successfully written
					// run this on the next tick to prevent increasing the
					// execution stack because resume() may call the event
					// handler again before finishing.
					setTimeout(() => stream.resume());
				},
				onError: error => reject(error),
				onEnd: () => resolve()
			});
		});
	}

	private async doWriteReadableBufferedQueued(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, handle: number, readable: VSBufferReadable): Promise<void> {
		let posInFile = 0;

		let chunk: VSBuffer | null;
		while ((chunk = readable.read()) !== null) {
			await this.doWriteBuffer(provider, handle, chunk, chunk.byteLength, posInFile, 0);

			posInFile += chunk.byteLength;
		}
	}

	private async doWriteBuffer(provider: IFileSystemProviderWithOpenReadWriteCloseCapability, handle: number, buffer: VSBuffer, length: number, posInFile: number, posInBuffer: number): Promise<void> {
		let totalBytesWritten = 0;
		while (totalBytesWritten < length) {

			// Write through the provider
			const bytesWritten = await provider.write(handle, posInFile + totalBytesWritten, buffer.buffer, posInBuffer + totalBytesWritten, length - totalBytesWritten);
			totalBytesWritten += bytesWritten;
		}
	}

	private async doWriteUnbuffered(provider: IFileSystemProviderWithFileReadWriteCapability, resource: URI, options: IWriteFileOptions | undefined, bufferOrReadableOrStreamOrBufferedStream: VSBuffer | VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream): Promise<void> {
		return this.writeQueue.queueFor(resource, this.getExtUri(provider).providerExtUri).queue(() => this.doWriteUnbufferedQueued(provider, resource, options, bufferOrReadableOrStreamOrBufferedStream));
	}

	private async doWriteUnbufferedQueued(provider: IFileSystemProviderWithFileReadWriteCapability, resource: URI, options: IWriteFileOptions | undefined, bufferOrReadableOrStreamOrBufferedStream: VSBuffer | VSBufferReadable | VSBufferReadableStream | VSBufferReadableBufferedStream): Promise<void> {
		let buffer: VSBuffer;
		if (bufferOrReadableOrStreamOrBufferedStream instanceof VSBuffer) {
			buffer = bufferOrReadableOrStreamOrBufferedStream;
		} else if (isReadableStream(bufferOrReadableOrStreamOrBufferedStream)) {
			buffer = await streamToBuffer(bufferOrReadableOrStreamOrBufferedStream);
		} else if (isReadableBufferedStream(bufferOrReadableOrStreamOrBufferedStream)) {
			buffer = await bufferedStreamToBuffer(bufferOrReadableOrStreamOrBufferedStream);
		} else {
			buffer = readableToBuffer(bufferOrReadableOrStreamOrBufferedStream);
		}

		// Write through the provider
		await provider.writeFile(resource, buffer.buffer, { create: true, overwrite: true, unlock: options?.unlock ?? false });
	}

	private async doPipeBuffered(sourceProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {
		return this.writeQueue.queueFor(target, this.getExtUri(targetProvider).providerExtUri).queue(() => this.doPipeBufferedQueued(sourceProvider, source, targetProvider, target));
	}

	private async doPipeBufferedQueued(sourceProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {
		let sourceHandle: number | undefined = undefined;
		let targetHandle: number | undefined = undefined;

		try {

			// Open handles
			sourceHandle = await sourceProvider.open(source, { create: false });
			targetHandle = await targetProvider.open(target, { create: true, unlock: false });

			const buffer = VSBuffer.alloc(this.BUFFER_SIZE);

			let posInFile = 0;
			let posInBuffer = 0;
			let bytesRead = 0;
			do {
				// read from source (sourceHandle) at current position (posInFile) into buffer (buffer) at
				// buffer position (posInBuffer) up to the size of the buffer (buffer.byteLength).
				bytesRead = await sourceProvider.read(sourceHandle, posInFile, buffer.buffer, posInBuffer, buffer.byteLength - posInBuffer);

				// write into target (targetHandle) at current position (posInFile) from buffer (buffer) at
				// buffer position (posInBuffer) all bytes we read (bytesRead).
				await this.doWriteBuffer(targetProvider, targetHandle, buffer, bytesRead, posInFile, posInBuffer);

				posInFile += bytesRead;
				posInBuffer += bytesRead;

				// when buffer full, fill it again from the beginning
				if (posInBuffer === buffer.byteLength) {
					posInBuffer = 0;
				}
			} while (bytesRead > 0);
		} catch (error) {
			throw ensureFileSystemProviderError(error);
		} finally {
			await Promises.settled([
				typeof sourceHandle === 'number' ? sourceProvider.close(sourceHandle) : Promise.resolve(),
				typeof targetHandle === 'number' ? targetProvider.close(targetHandle) : Promise.resolve(),
			]);
		}
	}

	private async doPipeUnbuffered(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithFileReadWriteCapability, target: URI): Promise<void> {
		return this.writeQueue.queueFor(target, this.getExtUri(targetProvider).providerExtUri).queue(() => this.doPipeUnbufferedQueued(sourceProvider, source, targetProvider, target));
	}

	private async doPipeUnbufferedQueued(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithFileReadWriteCapability, target: URI): Promise<void> {
		return targetProvider.writeFile(target, await sourceProvider.readFile(source), { create: true, overwrite: true, unlock: false });
	}

	private async doPipeUnbufferedToBuffered(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {
		return this.writeQueue.queueFor(target, this.getExtUri(targetProvider).providerExtUri).queue(() => this.doPipeUnbufferedToBufferedQueued(sourceProvider, source, targetProvider, target));
	}

	private async doPipeUnbufferedToBufferedQueued(sourceProvider: IFileSystemProviderWithFileReadWriteCapability, source: URI, targetProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, target: URI): Promise<void> {

		// Open handle
		const targetHandle = await targetProvider.open(target, { create: true, unlock: false });

		// Read entire buffer from source and write buffered
		try {
			const buffer = await sourceProvider.readFile(source);
			await this.doWriteBuffer(targetProvider, targetHandle, VSBuffer.wrap(buffer), buffer.byteLength, 0, 0);
		} catch (error) {
			throw ensureFileSystemProviderError(error);
		} finally {
			await targetProvider.close(targetHandle);
		}
	}

	private async doPipeBufferedToUnbuffered(sourceProvider: IFileSystemProviderWithOpenReadWriteCloseCapability, source: URI, targetProvider: IFileSystemProviderWithFileReadWriteCapability, target: URI): Promise<void> {

		// Read buffer via stream buffered
		const buffer = await streamToBuffer(this.readFileBuffered(sourceProvider, source, CancellationToken.None));

		// Write buffer into target at once
		await this.doWriteUnbuffered(targetProvider, target, undefined, buffer);
	}

	protected throwIfFileSystemIsReadonly<T extends IFileSystemProvider>(provider: T, resource: URI): T {
		if (provider.capabilities & FileSystemProviderCapabilities.Readonly) {
			throw new FileOperationError(localize('err.readonly', "Unable to modify readonly file '{0}'", this.resourceForError(resource)), FileOperationResult.FILE_PERMISSION_DENIED);
		}

		return provider;
	}

	private resourceForError(resource: URI): string {
		if (resource.scheme === Schemas.file) {
			return resource.fsPath;
		}

		return resource.toString(true);
	}

	//#endregion
}
