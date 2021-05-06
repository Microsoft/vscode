/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { URI, UriComponents } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';
import { IChannel } from 'vs/base/parts/ipc/common/ipc';
import { FileChangeType, FileDeleteOptions, FileOverwriteOptions, FileSystemProviderCapabilities, FileType, IFileChange, IStat, IWatchOptions, FileOpenOptions, IFileSystemProviderWithFileReadWriteCapability, FileWriteOptions, IFileSystemProviderWithFileReadStreamCapability, IFileSystemProviderWithFileFolderCopyCapability, FileReadStreamOptions, IFileSystemProviderWithOpenReadWriteCloseCapability } from 'vs/platform/files/common/files';
import { VSBuffer } from 'vs/base/common/buffer';
import { newWriteableStream, ReadableStreamEvents, ReadableStreamEventPayload } from 'vs/base/common/stream';
import { CancellationToken } from 'vs/base/common/cancellation';
import { canceled } from 'vs/base/common/errors';
import { toErrorMessage } from 'vs/base/common/errorMessage';

interface IFileChangeDto {
	resource: UriComponents;
	type: FileChangeType;
}

/**
 * An abstract file system provider that delegates all calls to a provided
 * `IChannel` via IPC communication.
 */
export abstract class IPCFileSystemProvider extends Disposable implements
	IFileSystemProviderWithFileReadWriteCapability,
	IFileSystemProviderWithOpenReadWriteCloseCapability,
	IFileSystemProviderWithFileReadStreamCapability,
	IFileSystemProviderWithFileFolderCopyCapability {

	private readonly session: string = generateUuid();

	private readonly _onDidChange = this._register(new Emitter<readonly IFileChange[]>());
	readonly onDidChangeFile = this._onDidChange.event;

	private _onDidWatchErrorOccur = this._register(new Emitter<string>());
	readonly onDidErrorOccur = this._onDidWatchErrorOccur.event;

	private readonly _onDidChangeCapabilities = this._register(new Emitter<void>());
	readonly onDidChangeCapabilities = this._onDidChangeCapabilities.event;

	private _capabilities = FileSystemProviderCapabilities.FileReadWrite
		| FileSystemProviderCapabilities.FileOpenReadWriteClose
		| FileSystemProviderCapabilities.FileReadStream
		| FileSystemProviderCapabilities.FileFolderCopy
		| FileSystemProviderCapabilities.FileWriteUnlock;
	get capabilities(): FileSystemProviderCapabilities { return this._capabilities; }

	constructor(private readonly channel: IChannel) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {
		this._register(this.channel.listen<IFileChangeDto[] | string>('filechange', [this.session])(eventsOrError => {
			if (Array.isArray(eventsOrError)) {
				const events = eventsOrError;
				this._onDidChange.fire(events.map(event => ({ resource: URI.revive(event.resource), type: event.type })));
			} else {
				const error = eventsOrError;
				this._onDidWatchErrorOccur.fire(error);
			}
		}));
	}

	protected setCaseSensitive(isCaseSensitive: boolean) {
		if (isCaseSensitive) {
			this._capabilities |= FileSystemProviderCapabilities.PathCaseSensitive;
		} else {
			this._capabilities &= ~FileSystemProviderCapabilities.PathCaseSensitive;
		}

		this._onDidChangeCapabilities.fire(undefined);
	}

	// --- forwarding calls

	stat(resource: URI): Promise<IStat> {
		return this.channel.call('stat', [resource]);
	}

	open(resource: URI, opts: FileOpenOptions): Promise<number> {
		return this.channel.call('open', [resource, opts]);
	}

	close(fd: number): Promise<void> {
		return this.channel.call('close', [fd]);
	}

	async read(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		const [bytes, bytesRead]: [VSBuffer, number] = await this.channel.call('read', [fd, pos, length]);

		// copy back the data that was written into the buffer on the remote
		// side. we need to do this because buffers are not referenced by
		// pointer, but only by value and as such cannot be directly written
		// to from the other process.
		data.set(bytes.buffer.slice(0, bytesRead), offset);

		return bytesRead;
	}

	async readFile(resource: URI): Promise<Uint8Array> {
		const buff = <VSBuffer>await this.channel.call('readFile', [resource]);

		return buff.buffer;
	}

	readFileStream(resource: URI, opts: FileReadStreamOptions, token: CancellationToken): ReadableStreamEvents<Uint8Array> {
		const stream = newWriteableStream<Uint8Array>(data => VSBuffer.concat(data.map(data => VSBuffer.wrap(data))).buffer);

		// Reading as file stream goes through an event to the remote side
		const listener = this.channel.listen<ReadableStreamEventPayload<VSBuffer>>('readFileStream', [resource, opts])(dataOrErrorOrEnd => {

			// data
			if (dataOrErrorOrEnd instanceof VSBuffer) {
				stream.write(dataOrErrorOrEnd.buffer);
			}

			// end or error
			else {
				if (dataOrErrorOrEnd === 'end') {
					stream.end();
				} else {

					// Since we receive data through a IPC channel, it is likely
					// that the error was not serialized, or only partially. To
					// ensure our API use is correct, we convert the data to an
					// error here to forward it properly.
					let error = dataOrErrorOrEnd;
					if (!(error instanceof Error)) {
						error = new Error(toErrorMessage(error));
					}

					stream.error(error);
					stream.end();
				}

				// Signal to the remote side that we no longer listen
				listener.dispose();
			}
		});

		// Support cancellation
		token.onCancellationRequested(() => {

			// Ensure to end the stream properly with an error
			// to indicate the cancellation.
			stream.error(canceled());
			stream.end();

			// Ensure to dispose the listener upon cancellation. This will
			// bubble through the remote side as event and allows to stop
			// reading the file.
			listener.dispose();
		});

		return stream;
	}

	write(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> {
		return this.channel.call('write', [fd, pos, VSBuffer.wrap(data), offset, length]);
	}

	writeFile(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> {
		return this.channel.call('writeFile', [resource, VSBuffer.wrap(content), opts]);
	}

	delete(resource: URI, opts: FileDeleteOptions): Promise<void> {
		return this.channel.call('delete', [resource, opts]);
	}

	mkdir(resource: URI): Promise<void> {
		return this.channel.call('mkdir', [resource]);
	}

	readdir(resource: URI): Promise<[string, FileType][]> {
		return this.channel.call('readdir', [resource]);
	}

	rename(resource: URI, target: URI, opts: FileOverwriteOptions): Promise<void> {
		return this.channel.call('rename', [resource, target, opts]);
	}

	copy(resource: URI, target: URI, opts: FileOverwriteOptions): Promise<void> {
		return this.channel.call('copy', [resource, target, opts]);
	}

	watch(resource: URI, opts: IWatchOptions): IDisposable {
		const req = Math.random();
		this.channel.call('watch', [this.session, req, resource, opts]);

		return toDisposable(() => this.channel.call('unwatch', [this.session, req]));
	}
}
