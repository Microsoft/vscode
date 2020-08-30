/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from 'vs/base/common/uri';
import { FileSystemProviderCapabilities, IFileSystemProvider, IWatchOptions, IStat, FileType, FileDeleteOptions, FileOverwriteOptions, FileWriteOptions, FileOpenOptions, IFileChange } from 'vs/platform/files/common/files';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { Emitter, Event } from 'vs/base/common/event';

export class NullFileSystemProvider implements IFileSystemProvider {

	capabilities: FileSystemProviderCapabilities = FileSystemProviderCapabilities.Readonly;

	private readonly _onDidChangeCapabilities = new Emitter<void>();
	readonly onDidChangeCapabilities: Event<void> = this._onDidChangeCapabilities.event;

	setCapabilities(capabilities: FileSystemProviderCapabilities): void {
		this.capabilities = capabilities;

		this._onDidChangeCapabilities.fire();
	}

	readonly onDidChangeFile: Event<readonly IFileChange[]> = Event.None;

	constructor(private disposableFactory: () => IDisposable = () => Disposable.None) { }

	watch(resource: URI, opts: IWatchOptions): IDisposable { return this.disposableFactory(); }
	stat(resource: URI): Promise<IStat> { return Promise.resolve(undefined!); }
	mkdir(resource: URI): Promise<void> { return Promise.resolve(undefined!); }
	readdir(resource: URI): Promise<[string, FileType][]> { return Promise.resolve(undefined!); }
	delete(resource: URI, opts: FileDeleteOptions): Promise<void> { return Promise.resolve(undefined!); }
	rename(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> { return Promise.resolve(undefined!); }
	copy?(from: URI, to: URI, opts: FileOverwriteOptions): Promise<void> { return Promise.resolve(undefined!); }
	readFile?(resource: URI): Promise<Uint8Array> { return Promise.resolve(undefined!); }
	writeFile?(resource: URI, content: Uint8Array, opts: FileWriteOptions): Promise<void> { return Promise.resolve(undefined!); }
	open?(resource: URI, opts: FileOpenOptions): Promise<number> { return Promise.resolve(undefined!); }
	close?(fd: number): Promise<void> { return Promise.resolve(undefined!); }
	read?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> { return Promise.resolve(undefined!); }
	write?(fd: number, pos: number, data: Uint8Array, offset: number, length: number): Promise<number> { return Promise.resolve(undefined!); }
}
