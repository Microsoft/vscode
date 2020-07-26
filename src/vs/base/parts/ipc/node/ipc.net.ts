/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Socket, Server as NetServer, createConnection, createServer } from 'net';
import { Event, Emitter } from 'vs/base/common/event';
import { ClientConnectionEvent, IPCServer } from 'vs/base/parts/ipc/common/ipc';
import { join } from 'vs/base/common/path';
import { tmpdir } from 'os';
import { generateUuid } from 'vs/base/common/uuid';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { VSBuffer } from 'vs/base/common/buffer';
import { ISocket, Protocol, Client, ChunkStream } from 'vs/base/parts/ipc/common/ipc.net';
import { onUnexpectedError } from 'vs/base/common/errors';

export class NodeSocket implements ISocket {
	public readonly socket: Socket;

	constructor(socket: Socket) {
		this.socket = socket;
	}

	public dispose(): void {
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
			this.socket.write(<Buffer>buffer.buffer);
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
	private readonly _incomingData: ChunkStream;
	private readonly _onData = this._register(new Emitter<VSBuffer>());

	private readonly _state = {
		state: ReadState.PeekHeader,
		readLen: Constants.MinHeaderByteSize,
		mask: 0
	};

	constructor(socket: NodeSocket) {
		super();
		this.socket = socket;
		this._incomingData = new ChunkStream();
		this._register(this.socket.onData(data => this._acceptChunk(data)));
	}

	public dispose(): void {
		this.socket.dispose();
	}

	public onData(listener: (e: VSBuffer) => void): IDisposable {
		return this._onData.event(listener);
	}

	public onClose(listener: () => void): IDisposable {
		return this.socket.onClose(listener);
	}

	public onEnd(listener: () => void): IDisposable {
		return this.socket.onEnd(listener);
	}

	public write(buffer: VSBuffer): void {
		let headerLen = Constants.MinHeaderByteSize;
		if (buffer.byteLength < 126) {
			headerLen += 0;
		} else if (buffer.byteLength < 2 ** 16) {
			headerLen += 2;
		} else {
			headerLen += 8;
		}
		const header = VSBuffer.alloc(headerLen);

		header.writeUInt8(0b10000010, 0);
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

		this.socket.write(VSBuffer.concat([header, buffer]));
	}

	public end(): void {
		this.socket.end();
	}

	private _acceptChunk(data: VSBuffer): void {
		if (data.byteLength === 0) {
			return;
		}

		this._incomingData.acceptChunk(data);

		while (this._incomingData.byteLength >= this._state.readLen) {

			if (this._state.state === ReadState.PeekHeader) {
				// peek to see if we can read the entire header
				const peekHeader = this._incomingData.peek(this._state.readLen);
				// const firstByte = peekHeader.readUInt8(0);
				// const finBit = (firstByte & 0b10000000) >>> 7;
				const secondByte = peekHeader.readUInt8(1);
				const hasMask = (secondByte & 0b10000000) >>> 7;
				const len = (secondByte & 0b01111111);

				this._state.state = ReadState.ReadHeader;
				this._state.readLen = Constants.MinHeaderByteSize + (hasMask ? 4 : 0) + (len === 126 ? 2 : 0) + (len === 127 ? 8 : 0);
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

				this._onData.fire(body);
			}
		}
	}

	public drain(): Promise<void> {
		return this.socket.drain();
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

export function generateRandomPipeName(): string {
	const randomSuffix = generateUuid();
	if (process.platform === 'win32') {
		return `\\\\.\\pipe\\vscode-ipc-${randomSuffix}-sock`;
	} else {
		// Mac/Unix: use socket file
		return join(tmpdir(), `vscode-ipc-${randomSuffix}.sock`);
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

	dispose(): void {
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
