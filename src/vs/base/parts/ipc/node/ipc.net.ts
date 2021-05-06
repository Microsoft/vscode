/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createHash } from 'crypto';
import { Socket, Server as NetServer, createConnection, createServer } from 'net';
import * as zlib from 'zlib';
import { Event, Emitter } from 'vs/base/common/event';
import { ClientConnectionEvent, IPCServer } from 'vs/base/parts/ipc/common/ipc';
import { join } from 'vs/base/common/path';
import { tmpdir } from 'os';
import { generateUuid } from 'vs/base/common/uuid';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { VSBuffer } from 'vs/base/common/buffer';
import { ISocket, Protocol, Client, ChunkStream } from 'vs/base/parts/ipc/common/ipc.net';
import { onUnexpectedError } from 'vs/base/common/errors';
import { Platform, platform } from 'vs/base/common/platform';

export class NodeSocket implements ISocket {

	public readonly socket: Socket;
	private readonly _errorListener: (err: any) => void;

	constructor(socket: Socket) {
		this.socket = socket;
		this._errorListener = (err: any) => {
			if (err) {
				if (err.code === 'EPIPE') {
					// An EPIPE exception at the wrong time can lead to a renderer process crash
					// so ignore the error since the socket will fire the close event soon anyways:
					// > https://nodejs.org/api/errors.html#errors_common_system_errors
					// > EPIPE (Broken pipe): A write on a pipe, socket, or FIFO for which there is no
					// > process to read the data. Commonly encountered at the net and http layers,
					// > indicative that the remote side of the stream being written to has been closed.
					return;
				}
				onUnexpectedError(err);
			}
		};
		this.socket.on('error', this._errorListener);
	}

	public dispose(): void {
		this.socket.off('error', this._errorListener);
		this.socket.destroy();
	}

	public onData(_listener: (e: VSBuffer) => void): IDisposable {
		const listener = (buff: Buffer) => _listener(VSBuffer.wrap(buff));
		this.socket.on('data', listener);
		return {
			dispose: () => this.socket.off('data', listener)
		};
	}

	public onClose(listener: () => void): IDisposable {
		this.socket.on('close', listener);
		return {
			dispose: () => this.socket.off('close', listener)
		};
	}

	public onEnd(listener: () => void): IDisposable {
		this.socket.on('end', listener);
		return {
			dispose: () => this.socket.off('end', listener)
		};
	}

	public write(buffer: VSBuffer): void {
		// return early if socket has been destroyed in the meantime
		if (this.socket.destroyed) {
			return;
		}

		// we ignore the returned value from `write` because we would have to cached the data
		// anyways and nodejs is already doing that for us:
		// > https://nodejs.org/api/stream.html#stream_writable_write_chunk_encoding_callback
		// > However, the false return value is only advisory and the writable stream will unconditionally
		// > accept and buffer chunk even if it has not been allowed to drain.
		try {
			this.socket.write(<Buffer>buffer.buffer, (err: any) => {
				if (err) {
					if (err.code === 'EPIPE') {
						// An EPIPE exception at the wrong time can lead to a renderer process crash
						// so ignore the error since the socket will fire the close event soon anyways:
						// > https://nodejs.org/api/errors.html#errors_common_system_errors
						// > EPIPE (Broken pipe): A write on a pipe, socket, or FIFO for which there is no
						// > process to read the data. Commonly encountered at the net and http layers,
						// > indicative that the remote side of the stream being written to has been closed.
						return;
					}
					onUnexpectedError(err);
				}
			});
		} catch (err) {
			if (err.code === 'EPIPE') {
				// An EPIPE exception at the wrong time can lead to a renderer process crash
				// so ignore the error since the socket will fire the close event soon anyways:
				// > https://nodejs.org/api/errors.html#errors_common_system_errors
				// > EPIPE (Broken pipe): A write on a pipe, socket, or FIFO for which there is no
				// > process to read the data. Commonly encountered at the net and http layers,
				// > indicative that the remote side of the stream being written to has been closed.
				return;
			}
			onUnexpectedError(err);
		}
	}

	public end(): void {
		this.socket.end();
	}

	public drain(): Promise<void> {
		return new Promise<void>((resolve, reject) => {
			if (this.socket.bufferSize === 0) {
				resolve();
				return;
			}
			const finished = () => {
				this.socket.off('close', finished);
				this.socket.off('end', finished);
				this.socket.off('error', finished);
				this.socket.off('timeout', finished);
				this.socket.off('drain', finished);
				resolve();
			};
			this.socket.on('close', finished);
			this.socket.on('end', finished);
			this.socket.on('error', finished);
			this.socket.on('timeout', finished);
			this.socket.on('drain', finished);
		});
	}
}

const enum Constants {
	MinHeaderByteSize = 2
}

const enum ReadState {
	PeekHeader = 1,
	ReadHeader = 2,
	ReadBody = 3,
	Fin = 4
}

/**
 * See https://tools.ietf.org/html/rfc6455#section-5.2
 */
export class WebSocketNodeSocket extends Disposable implements ISocket {

	public readonly socket: NodeSocket;
	public readonly permessageDeflate: boolean;
	private _totalIncomingWireBytes: number;
	private _totalIncomingDataBytes: number;
	private _totalOutgoingWireBytes: number;
	private _totalOutgoingDataBytes: number;
	private readonly _zlibInflate: zlib.InflateRaw | null;
	private readonly _zlibDeflate: zlib.DeflateRaw | null;
	private _zlibDeflateFlushWaitingCount: number;
	private readonly _onDidZlibFlush = this._register(new Emitter<void>());
	private readonly _recordInflateBytes: boolean;
	private readonly _recordedInflateBytes: Buffer[] = [];
	private readonly _pendingInflateData: Buffer[] = [];
	private readonly _pendingDeflateData: Buffer[] = [];
	private readonly _incomingData: ChunkStream;
	private readonly _onData = this._register(new Emitter<VSBuffer>());
	private readonly _onClose = this._register(new Emitter<void>());
	private _isEnded: boolean = false;

	private readonly _state = {
		state: ReadState.PeekHeader,
		readLen: Constants.MinHeaderByteSize,
		fin: 0,
		mask: 0
	};

	public get totalIncomingWireBytes(): number {
		return this._totalIncomingWireBytes;
	}

	public get totalIncomingDataBytes(): number {
		return this._totalIncomingDataBytes;
	}

	public get totalOutgoingWireBytes(): number {
		return this._totalOutgoingWireBytes;
	}

	public get totalOutgoingDataBytes(): number {
		return this._totalOutgoingDataBytes;
	}

	public get recordedInflateBytes(): VSBuffer {
		if (this._recordInflateBytes) {
			return VSBuffer.wrap(Buffer.concat(this._recordedInflateBytes));
		}
		return VSBuffer.alloc(0);
	}

	/**
	 * Create a socket which can communicate using WebSocket frames.
	 *
	 * **NOTE**: When using the permessage-deflate WebSocket extension, if parts of inflating was done
	 *  in a different zlib instance, we need to pass all those bytes into zlib, otherwise the inflate
	 *  might hit an inflated portion referencing a distance too far back.
	 *
	 * @param socket The underlying socket
	 * @param permessageDeflate Use the permessage-deflate WebSocket extension
	 * @param inflateBytes "Seed" zlib inflate with these bytes.
	 * @param recordInflateBytes Record all bytes sent to inflate
	 */
	constructor(socket: NodeSocket, permessageDeflate: boolean, inflateBytes: VSBuffer | null, recordInflateBytes: boolean) {
		super();
		this.socket = socket;
		this._totalIncomingWireBytes = 0;
		this._totalIncomingDataBytes = 0;
		this._totalOutgoingWireBytes = 0;
		this._totalOutgoingDataBytes = 0;
		this.permessageDeflate = permessageDeflate;
		this._recordInflateBytes = recordInflateBytes;
		if (permessageDeflate) {
			// See https://tools.ietf.org/html/rfc7692#page-16
			// To simplify our logic, we don't negociate the window size
			// and simply dedicate (2^15) / 32kb per web socket
			this._zlibInflate = zlib.createInflateRaw({
				windowBits: 15
			});
			this._zlibInflate.on('error', (err) => {
				// zlib errors are fatal, since we have no idea how to recover
				console.error(err);
				onUnexpectedError(err);
				this._onClose.fire();
			});
			this._zlibInflate.on('data', (data: Buffer) => {
				this._pendingInflateData.push(data);
			});
			if (inflateBytes) {
				this._zlibInflate.write(inflateBytes.buffer);
				this._zlibInflate.flush(() => {
					this._pendingInflateData.length = 0;
				});
			}

			this._zlibDeflate = zlib.createDeflateRaw({
				windowBits: 15
			});
			this._zlibDeflate.on('error', (err) => {
				// zlib errors are fatal, since we have no idea how to recover
				console.error(err);
				onUnexpectedError(err);
				this._onClose.fire();
			});
			this._zlibDeflate.on('data', (data: Buffer) => {
				this._pendingDeflateData.push(data);
			});
		} else {
			this._zlibInflate = null;
			this._zlibDeflate = null;
		}
		this._zlibDeflateFlushWaitingCount = 0;
		this._incomingData = new ChunkStream();
		this._register(this.socket.onData(data => this._acceptChunk(data)));
		this._register(this.socket.onClose(() => this._onClose.fire()));
	}

	public override dispose(): void {
		if (this._zlibDeflateFlushWaitingCount > 0) {
			// Wait for any outstanding writes to finish before disposing
			this._register(this._onDidZlibFlush.event(() => {
				this.dispose();
			}));
		} else {
			this.socket.dispose();
			super.dispose();
		}
	}

	public onData(listener: (e: VSBuffer) => void): IDisposable {
		return this._onData.event(listener);
	}

	public onClose(listener: () => void): IDisposable {
		return this._onClose.event(listener);
	}

	public onEnd(listener: () => void): IDisposable {
		return this.socket.onEnd(listener);
	}

	public write(buffer: VSBuffer): void {
		this._totalOutgoingDataBytes += buffer.byteLength;

		if (this._zlibDeflate) {
			this._zlibDeflate.write(<Buffer>buffer.buffer);

			this._zlibDeflateFlushWaitingCount++;
			// See https://zlib.net/manual.html#Constants
			this._zlibDeflate.flush(/*Z_SYNC_FLUSH*/2, () => {
				this._zlibDeflateFlushWaitingCount--;
				let data = Buffer.concat(this._pendingDeflateData);
				this._pendingDeflateData.length = 0;

				// See https://tools.ietf.org/html/rfc7692#section-7.2.1
				data = data.slice(0, data.length - 4);

				if (!this._isEnded) {
					// Avoid ERR_STREAM_WRITE_AFTER_END
					this._write(VSBuffer.wrap(data), true);
				}

				if (this._zlibDeflateFlushWaitingCount === 0) {
					this._onDidZlibFlush.fire();
				}
			});
		} else {
			this._write(buffer, false);
		}
	}

	private _write(buffer: VSBuffer, compressed: boolean): void {
		let headerLen = Constants.MinHeaderByteSize;
		if (buffer.byteLength < 126) {
			headerLen += 0;
		} else if (buffer.byteLength < 2 ** 16) {
			headerLen += 2;
		} else {
			headerLen += 8;
		}
		const header = VSBuffer.alloc(headerLen);

		if (compressed) {
			// The RSV1 bit indicates a compressed frame
			header.writeUInt8(0b11000010, 0);
		} else {
			header.writeUInt8(0b10000010, 0);
		}
		if (buffer.byteLength < 126) {
			header.writeUInt8(buffer.byteLength, 1);
		} else if (buffer.byteLength < 2 ** 16) {
			header.writeUInt8(126, 1);
			let offset = 1;
			header.writeUInt8((buffer.byteLength >>> 8) & 0b11111111, ++offset);
			header.writeUInt8((buffer.byteLength >>> 0) & 0b11111111, ++offset);
		} else {
			header.writeUInt8(127, 1);
			let offset = 1;
			header.writeUInt8(0, ++offset);
			header.writeUInt8(0, ++offset);
			header.writeUInt8(0, ++offset);
			header.writeUInt8(0, ++offset);
			header.writeUInt8((buffer.byteLength >>> 24) & 0b11111111, ++offset);
			header.writeUInt8((buffer.byteLength >>> 16) & 0b11111111, ++offset);
			header.writeUInt8((buffer.byteLength >>> 8) & 0b11111111, ++offset);
			header.writeUInt8((buffer.byteLength >>> 0) & 0b11111111, ++offset);
		}

		this._totalOutgoingWireBytes += header.byteLength + buffer.byteLength;
		this.socket.write(VSBuffer.concat([header, buffer]));
	}

	public end(): void {
		this._isEnded = true;
		this.socket.end();
	}

	private _acceptChunk(data: VSBuffer): void {
		if (data.byteLength === 0) {
			return;
		}
		this._totalIncomingWireBytes += data.byteLength;

		this._incomingData.acceptChunk(data);

		while (this._incomingData.byteLength >= this._state.readLen) {

			if (this._state.state === ReadState.PeekHeader) {
				// peek to see if we can read the entire header
				const peekHeader = this._incomingData.peek(this._state.readLen);
				const firstByte = peekHeader.readUInt8(0);
				const finBit = (firstByte & 0b10000000) >>> 7;
				const secondByte = peekHeader.readUInt8(1);
				const hasMask = (secondByte & 0b10000000) >>> 7;
				const len = (secondByte & 0b01111111);

				this._state.state = ReadState.ReadHeader;
				this._state.readLen = Constants.MinHeaderByteSize + (hasMask ? 4 : 0) + (len === 126 ? 2 : 0) + (len === 127 ? 8 : 0);
				this._state.fin = finBit;
				this._state.mask = 0;

			} else if (this._state.state === ReadState.ReadHeader) {
				// read entire header
				const header = this._incomingData.read(this._state.readLen);
				const secondByte = header.readUInt8(1);
				const hasMask = (secondByte & 0b10000000) >>> 7;
				let len = (secondByte & 0b01111111);

				let offset = 1;
				if (len === 126) {
					len = (
						header.readUInt8(++offset) * 2 ** 8
						+ header.readUInt8(++offset)
					);
				} else if (len === 127) {
					len = (
						header.readUInt8(++offset) * 0
						+ header.readUInt8(++offset) * 0
						+ header.readUInt8(++offset) * 0
						+ header.readUInt8(++offset) * 0
						+ header.readUInt8(++offset) * 2 ** 24
						+ header.readUInt8(++offset) * 2 ** 16
						+ header.readUInt8(++offset) * 2 ** 8
						+ header.readUInt8(++offset)
					);
				}

				let mask = 0;
				if (hasMask) {
					mask = (
						header.readUInt8(++offset) * 2 ** 24
						+ header.readUInt8(++offset) * 2 ** 16
						+ header.readUInt8(++offset) * 2 ** 8
						+ header.readUInt8(++offset)
					);
				}

				this._state.state = ReadState.ReadBody;
				this._state.readLen = len;
				this._state.mask = mask;

			} else if (this._state.state === ReadState.ReadBody) {
				// read body

				const body = this._incomingData.read(this._state.readLen);
				unmask(body, this._state.mask);

				this._state.state = ReadState.PeekHeader;
				this._state.readLen = Constants.MinHeaderByteSize;
				this._state.mask = 0;

				if (this._zlibInflate) {
					// See https://tools.ietf.org/html/rfc7692#section-7.2.2
					if (this._recordInflateBytes) {
						this._recordedInflateBytes.push(Buffer.from(<Buffer>body.buffer));
					}
					this._zlibInflate.write(<Buffer>body.buffer);
					if (this._state.fin) {
						if (this._recordInflateBytes) {
							this._recordedInflateBytes.push(Buffer.from([0x00, 0x00, 0xff, 0xff]));
						}
						this._zlibInflate.write(Buffer.from([0x00, 0x00, 0xff, 0xff]));
					}
					this._zlibInflate.flush(() => {
						const data = Buffer.concat(this._pendingInflateData);
						this._pendingInflateData.length = 0;
						this._totalIncomingDataBytes += data.length;
						this._onData.fire(VSBuffer.wrap(data));
					});
				} else {
					this._totalIncomingDataBytes += body.byteLength;
					this._onData.fire(body);
				}
			}
		}
	}

	public async drain(): Promise<void> {
		if (this._zlibDeflateFlushWaitingCount > 0) {
			await Event.toPromise(this._onDidZlibFlush.event);
		}
		await this.socket.drain();
	}
}

function unmask(buffer: VSBuffer, mask: number): void {
	if (mask === 0) {
		return;
	}
	let cnt = buffer.byteLength >>> 2;
	for (let i = 0; i < cnt; i++) {
		const v = buffer.readUInt32BE(i * 4);
		buffer.writeUInt32BE(v ^ mask, i * 4);
	}
	let offset = cnt * 4;
	let bytesLeft = buffer.byteLength - offset;
	const m3 = (mask >>> 24) & 0b11111111;
	const m2 = (mask >>> 16) & 0b11111111;
	const m1 = (mask >>> 8) & 0b11111111;
	if (bytesLeft >= 1) {
		buffer.writeUInt8(buffer.readUInt8(offset) ^ m3, offset);
	}
	if (bytesLeft >= 2) {
		buffer.writeUInt8(buffer.readUInt8(offset + 1) ^ m2, offset + 1);
	}
	if (bytesLeft >= 3) {
		buffer.writeUInt8(buffer.readUInt8(offset + 2) ^ m1, offset + 2);
	}
}

// Read this before there's any chance it is overwritten
// Related to https://github.com/microsoft/vscode/issues/30624
export const XDG_RUNTIME_DIR = <string | undefined>process.env['XDG_RUNTIME_DIR'];

const safeIpcPathLengths: { [platform: number]: number } = {
	[Platform.Linux]: 107,
	[Platform.Mac]: 103
};

export function createRandomIPCHandle(): string {
	const randomSuffix = generateUuid();

	// Windows: use named pipe
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\vscode-ipc-${randomSuffix}-sock`;
	}

	// Mac/Unix: use socket file and prefer
	// XDG_RUNTIME_DIR over tmpDir
	let result: string;
	if (XDG_RUNTIME_DIR) {
		result = join(XDG_RUNTIME_DIR, `vscode-ipc-${randomSuffix}.sock`);
	} else {
		result = join(tmpdir(), `vscode-ipc-${randomSuffix}.sock`);
	}

	// Validate length
	validateIPCHandleLength(result);

	return result;
}

export function createStaticIPCHandle(directoryPath: string, type: string, version: string): string {
	const scope = createHash('md5').update(directoryPath).digest('hex');

	// Windows: use named pipe
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\${scope}-${version}-${type}-sock`;
	}

	// Mac/Unix: use socket file and prefer
	// XDG_RUNTIME_DIR over user data path
	// unless portable
	let result: string;
	if (XDG_RUNTIME_DIR && !process.env['VSCODE_PORTABLE']) {
		result = join(XDG_RUNTIME_DIR, `vscode-${scope.substr(0, 8)}-${version}-${type}.sock`);
	} else {
		result = join(directoryPath, `${version}-${type}.sock`);
	}

	// Validate length
	validateIPCHandleLength(result);

	return result;
}

function validateIPCHandleLength(handle: string): void {
	const limit = safeIpcPathLengths[platform];
	if (typeof limit === 'number' && handle.length >= limit) {
		// https://nodejs.org/api/net.html#net_identifying_paths_for_ipc_connections
		console.warn(`WARNING: IPC handle "${handle}" is longer than ${limit} chars, try a shorter --user-data-dir`);
	}
}

export class Server extends IPCServer {

	private static toClientConnectionEvent(server: NetServer): Event<ClientConnectionEvent> {
		const onConnection = Event.fromNodeEventEmitter<Socket>(server, 'connection');

		return Event.map(onConnection, socket => ({
			protocol: new Protocol(new NodeSocket(socket)),
			onDidClientDisconnect: Event.once(Event.fromNodeEventEmitter<void>(socket, 'close'))
		}));
	}

	private server: NetServer | null;

	constructor(server: NetServer) {
		super(Server.toClientConnectionEvent(server));
		this.server = server;
	}

	override dispose(): void {
		super.dispose();
		if (this.server) {
			this.server.close();
			this.server = null;
		}
	}
}

export function serve(port: number): Promise<Server>;
export function serve(namedPipe: string): Promise<Server>;
export function serve(hook: any): Promise<Server> {
	return new Promise<Server>((c, e) => {
		const server = createServer();

		server.on('error', e);
		server.listen(hook, () => {
			server.removeListener('error', e);
			c(new Server(server));
		});
	});
}

export function connect(options: { host: string, port: number }, clientId: string): Promise<Client>;
export function connect(port: number, clientId: string): Promise<Client>;
export function connect(namedPipe: string, clientId: string): Promise<Client>;
export function connect(hook: any, clientId: string): Promise<Client> {
	return new Promise<Client>((c, e) => {
		const socket = createConnection(hook, () => {
			socket.removeListener('error', e);
			c(Client.fromSocket(new NodeSocket(socket), clientId));
		});

		socket.once('error', e);
	});
}
