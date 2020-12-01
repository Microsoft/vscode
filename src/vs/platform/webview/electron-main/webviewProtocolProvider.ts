/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { protocol, session } from 'electron';
import { Readable } from 'stream';
import { bufferToStream, VSBuffer, VSBufferReadableStream } from 'vs/base/common/buffer';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { FileOperationError, FileOperationResult, IFileService } from 'vs/platform/files/common/files';
import { IRemoteConnectionData } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IRequestService } from 'vs/platform/request/common/request';
import { loadLocalResource, webviewPartitionId, WebviewResourceResponse } from 'vs/platform/webview/common/resourceLoader';
import { IWindowsMainService } from 'vs/platform/windows/electron-main/windows';

interface WebviewMetadata {
	readonly windowId: number;
	readonly extensionLocation: URI | undefined;
	readonly localResourceRoots: readonly URI[];
	readonly remoteConnectionData: IRemoteConnectionData | null;
}

export class WebviewProtocolProvider extends Disposable {

	private static validWebviewFilePaths = new Map([
		['/index.html', 'index.html'],
		['/electron-browser/index.html', 'index.html'],
		['/main.js', 'main.js'],
		['/host.js', 'host.js'],
	]);

	private readonly webviewMetadata = new Map<string, WebviewMetadata>();

	private requestIdPool = 1;
	private readonly pendingResourceReads = new Map<number, { resolve: (content: VSBuffer | undefined) => void }>();

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IRequestService private readonly requestService: IRequestService,
		@IWindowsMainService readonly windowsMainService: IWindowsMainService,
	) {
		super();

		const sess = session.fromPartition(webviewPartitionId);

		// Register the protocol loading webview html
		const webviewHandler = this.handleWebviewRequest.bind(this);
		protocol.registerFileProtocol(Schemas.vscodeWebview, webviewHandler);
		sess.protocol.registerFileProtocol(Schemas.vscodeWebview, webviewHandler);

		// Register the protocol loading webview resources both inside the webview and at the top level
		const webviewResourceHandler = this.handleWebviewResourceRequest.bind(this);
		protocol.registerStreamProtocol(Schemas.vscodeWebviewResource, webviewResourceHandler);
		sess.protocol.registerStreamProtocol(Schemas.vscodeWebviewResource, webviewResourceHandler);

		this._register(toDisposable(() => {
			protocol.unregisterProtocol(Schemas.vscodeWebviewResource);
			sess.protocol.unregisterProtocol(Schemas.vscodeWebviewResource);
			protocol.unregisterProtocol(Schemas.vscodeWebview);
			sess.protocol.unregisterProtocol(Schemas.vscodeWebview);
		}));
	}

	private streamToNodeReadable(stream: VSBufferReadableStream): Readable {
		return new class extends Readable {
			private listening = false;

			_read(size?: number): void {
				if (!this.listening) {
					this.listening = true;

					// Data
					stream.on('data', data => {
						try {
							if (!this.push(data.buffer)) {
								stream.pause(); // pause the stream if we should not push anymore
							}
						} catch (error) {
							this.emit(error);
						}
					});

					// End
					stream.on('end', () => {
						try {
							this.push(null); // signal EOS
						} catch (error) {
							this.emit(error);
						}
					});

					// Error
					stream.on('error', error => this.emit('error', error));
				}

				// ensure the stream is flowing
				stream.resume();
			}

			_destroy(error: Error | null, callback: (error: Error | null) => void): void {
				stream.destroy();

				callback(null);
			}
		};
	}

	public async registerWebview(id: string, metadata: WebviewMetadata): Promise<void> {
		this.webviewMetadata.set(id, metadata);
	}

	public unregisterWebview(id: string): void {
		this.webviewMetadata.delete(id);
	}

	public async updateWebviewMetadata(id: string, metadataDelta: Partial<WebviewMetadata>): Promise<void> {
		const entry = this.webviewMetadata.get(id);
		if (entry) {
			this.webviewMetadata.set(id, {
				...entry,
				...metadataDelta,
			});
		}
	}

	private async handleWebviewRequest(request: Electron.Request, callback: any) {
		try {
			const uri = URI.parse(request.url);
			const entry = WebviewProtocolProvider.validWebviewFilePaths.get(uri.path);
			if (typeof entry === 'string') {
				const relativeResourcePath = uri.path.startsWith('/electron-browser')
					? `vs/workbench/contrib/webview/electron-browser/pre/${entry}`
					: `vs/workbench/contrib/webview/browser/pre/${entry}`;

				const url = FileAccess.asFileUri(relativeResourcePath, require);
				return callback(decodeURIComponent(url.fsPath));
			}
		} catch {
			// noop
		}
		callback({ error: -10 /* ACCESS_DENIED - https://cs.chromium.org/chromium/src/net/base/net_error_list.h?l=32 */ });
	}

	private async handleWebviewResourceRequest(
		request: Electron.Request,
		callback: (stream?: NodeJS.ReadableStream | Electron.StreamProtocolResponse | undefined) => void
	) {
		try {
			const uri = URI.parse(request.url);

			const id = uri.authority;
			const metadata = this.webviewMetadata.get(id);
			if (metadata) {

				// Try to further rewrite remote uris so that they go to the resolved server on the main thread
				let rewriteUri: undefined | ((uri: URI) => URI);
				if (metadata.remoteConnectionData) {
					rewriteUri = (uri) => {
						if (metadata.remoteConnectionData) {
							if (uri.scheme === Schemas.vscodeRemote || (metadata.extensionLocation?.scheme === Schemas.vscodeRemote)) {
								return URI.parse(`http://${metadata.remoteConnectionData.host}:${metadata.remoteConnectionData.port}`).with({
									path: '/vscode-remote-resource',
									query: `tkn=${metadata.remoteConnectionData.connectionToken}&path=${encodeURIComponent(uri.path)}`,
								});
							}
						}
						return uri;
					};
				}

				const fileService = {
					readFileStream: async (resource: URI): Promise<VSBufferReadableStream> => {
						if (resource.scheme === Schemas.file) {
							return (await this.fileService.readFileStream(resource)).value;
						}

						// Unknown uri scheme. Try delegating the file read back to the renderer
						// process which should have a file system provider registered for the uri.

						const window = this.windowsMainService.getWindowById(metadata.windowId);
						if (!window) {
							throw new FileOperationError('Could not find window for resource', FileOperationResult.FILE_NOT_FOUND);
						}

						const requestId = this.requestIdPool++;
						const p = new Promise<VSBuffer | undefined>(resolve => {
							this.pendingResourceReads.set(requestId, { resolve });
						});

						window.send(`vscode:loadWebviewResource-${id}`, requestId, uri);

						const result = await p;
						if (!result) {
							throw new FileOperationError('Could not read file', FileOperationResult.FILE_NOT_FOUND);
						}

						return bufferToStream(result);
					}
				};

				const result = await loadLocalResource(uri, {
					extensionLocation: metadata.extensionLocation,
					roots: metadata.localResourceRoots,
					remoteConnectionData: metadata.remoteConnectionData,
					rewriteUri,
				}, fileService, this.requestService);

				if (result.type === WebviewResourceResponse.Type.Success) {
					return callback({
						statusCode: 200,
						data: this.streamToNodeReadable(result.stream),
						headers: {
							'Content-Type': result.mimeType,
							'Access-Control-Allow-Origin': '*',
						}
					});
				}

				if (result.type === WebviewResourceResponse.Type.AccessDenied) {
					console.error('Webview: Cannot load resource outside of protocol root');
					return callback({ data: null, statusCode: 401 });
				}
			}
		} catch {
			// noop
		}

		return callback({ data: null, statusCode: 404 });
	}

	public didLoadResource(requestId: number, content: VSBuffer | undefined) {
		const pendingRead = this.pendingResourceReads.get(requestId);
		if (!pendingRead) {
			throw new Error('Unknown request');
		}
		this.pendingResourceReads.delete(requestId);
		pendingRead.resolve(content);
	}
}
