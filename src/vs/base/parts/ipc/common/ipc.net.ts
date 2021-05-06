/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { IMessagePassingProtocol, IPCClient, IIPCLogger } from 'vs/base/parts/ipc/common/ipc';
import { IDisposable, Disposable, dispose } from 'vs/base/common/lifecycle';
import { VSBuffer } from 'vs/base/common/buffer';
import * as platform from 'vs/base/common/platform';
import * as process from 'vs/base/common/process';

export interface ISocket extends IDisposable {
	onData(listener: (e: VSBuffer) => void): IDisposable;
	onClose(listener: () => void): IDisposable;
	onEnd(listener: () => void): IDisposable;
	write(buffer: VSBuffer): void;
	end(): void;
	drain(): Promise<void>;
}

let emptyBuffer: VSBuffer | null = null;
function getEmptyBuffer(): VSBuffer {
	if (!emptyBuffer) {
		emptyBuffer = VSBuffer.alloc(0);
	}
	return emptyBuffer;
}

export class ChunkStream {

	private _chunks: VSBuffer[];
	private _totalLength: number;

	public get byteLength() {
		return this._totalLength;
	}

	constructor() {
		this._chunks = [];
		this._totalLength = 0;
	}

	public acceptChunk(buff: VSBuffer) {
		this._chunks.push(buff);
		this._totalLength += buff.byteLength;
	}

	public read(byteCount: number): VSBuffer {
		return this._read(byteCount, true);
	}

	public peek(byteCount: number): VSBuffer {
		return this._read(byteCount, false);
	}

	private _read(byteCount: number, advance: boolean): VSBuffer {

		if (byteCount === 0) {
			return getEmptyBuffer();
		}

		if (byteCount > this._totalLength) {
			throw new Error(`Cannot read so many bytes!`);
		}

		if (this._chunks[0].byteLength === byteCount) {
			// super fast path, precisely first chunk must be returned
			const result = this._chunks[0];
			if (advance) {
				this._chunks.shift();
				this._totalLength -= byteCount;
			}
			return result;
		}

		if (this._chunks[0].byteLength > byteCount) {
			// fast path, the reading is entirely within the first chunk
			const result = this._chunks[0].slice(0, byteCount);
			if (advance) {
				this._chunks[0] = this._chunks[0].slice(byteCount);
				this._totalLength -= byteCount;
			}
			return result;
		}

		let result = VSBuffer.alloc(byteCount);
		let resultOffset = 0;
		let chunkIndex = 0;
		while (byteCount > 0) {
			const chunk = this._chunks[chunkIndex];
			if (chunk.byteLength > byteCount) {
				// this chunk will survive
				const chunkPart = chunk.slice(0, byteCount);
				result.set(chunkPart, resultOffset);
				resultOffset += byteCount;

				if (advance) {
					this._chunks[chunkIndex] = chunk.slice(byteCount);
					this._totalLength -= byteCount;
				}

				byteCount -= byteCount;
			} else {
				// this chunk will be entirely read
				result.set(chunk, resultOffset);
				resultOffset += chunk.byteLength;

				if (advance) {
					this._chunks.shift();
					this._totalLength -= chunk.byteLength;
				} else {
					chunkIndex++;
				}

				byteCount -= chunk.byteLength;
			}
		}
		return result;
	}
}

const enum ProtocolMessageType {
	None = 0,
	Regular = 1,
	Control = 2,
	Ack = 3,
	KeepAlive = 4,
	Disconnect = 5,
	ReplayRequest = 6
}

export const enum ProtocolConstants {
	HeaderLength = 13,
	/**
	 * Send an Acknowledge message at most 2 seconds later...
	 */
	AcknowledgeTime = 2000, // 2 seconds
	/**
	 * If there is a message that has been unacknowledged for 10 seconds, consider the connection closed...
	 */
	AcknowledgeTimeoutTime = 20000, // 20 seconds
	/**
	 * Send at least a message every 5s for keep alive reasons.
	 */
	KeepAliveTime = 5000, // 5 seconds
	/**
	 * If there is no message received for 10 seconds, consider the connection closed...
	 */
	KeepAliveTimeoutTime = 20000, // 20 seconds
	/**
	 * If there is no reconnection within this time-frame, consider the connection permanently closed...
	 */
	ReconnectionGraceTime = 3 * 60 * 60 * 1000, // 3hrs
	/**
	 * Maximal grace time between the first and the last reconnection...
	 */
	ReconnectionShortGraceTime = 5 * 60 * 1000, // 5min
}

class ProtocolMessage {

	public writtenTime: number;

	constructor(
		public readonly type: ProtocolMessageType,
		public readonly id: number,
		public readonly ack: number,
		public readonly data: VSBuffer
	) {
		this.writtenTime = 0;
	}

	public get size(): number {
		return this.data.byteLength;
	}
}

class ProtocolReader extends Disposable {

	private readonly _socket: ISocket;
	private _isDisposed: boolean;
	private readonly _incomingData: ChunkStream;
	public lastReadTime: number;

	private readonly _onMessage = this._register(new Emitter<ProtocolMessage>());
	public readonly onMessage: Event<ProtocolMessage> = this._onMessage.event;

	private readonly _state = {
		readHead: true,
		readLen: ProtocolConstants.HeaderLength,
		messageType: ProtocolMessageType.None,
		id: 0,
		ack: 0
	};

	constructor(socket: ISocket) {
		super();
		this._socket = socket;
		this._isDisposed = false;
		this._incomingData = new ChunkStream();
		this._register(this._socket.onData(data => this.acceptChunk(data)));
		this.lastReadTime = Date.now();
	}

	public acceptChunk(data: VSBuffer | null): void {
		if (!data || data.byteLength === 0) {
			return;
		}

		this.lastReadTime = Date.now();

		this._incomingData.acceptChunk(data);

		while (this._incomingData.byteLength >= this._state.readLen) {

			const buff = this._incomingData.read(this._state.readLen);

			if (this._state.readHead) {
				// buff is the header

				// save new state => next time will read the body
				this._state.readHead = false;
				this._state.readLen = buff.readUInt32BE(9);
				this._state.messageType = buff.readUInt8(0);
				this._state.id = buff.readUInt32BE(1);
				this._state.ack = buff.readUInt32BE(5);
			} else {
				// buff is the body
				const messageType = this._state.messageType;
				const id = this._state.id;
				const ack = this._state.ack;

				// save new state => next time will read the header
				this._state.readHead = true;
				this._state.readLen = ProtocolConstants.HeaderLength;
				this._state.messageType = ProtocolMessageType.None;
				this._state.id = 0;
				this._state.ack = 0;

				this._onMessage.fire(new ProtocolMessage(messageType, id, ack, buff));

				if (this._isDisposed) {
					// check if an event listener lead to our disposal
					break;
				}
			}
		}
	}

	public readEntireBuffer(): VSBuffer {
		return this._incomingData.read(this._incomingData.byteLength);
	}

	public override dispose(): void {
		this._isDisposed = true;
		super.dispose();
	}
}

class ProtocolWriter {

	private _isDisposed: boolean;
	private readonly _socket: ISocket;
	private _data: VSBuffer[];
	private _totalLength: number;
	public lastWriteTime: number;

	constructor(socket: ISocket) {
		this._isDisposed = false;
		this._socket = socket;
		this._data = [];
		this._totalLength = 0;
		this.lastWriteTime = 0;
	}

	public dispose(): void {
		try {
			this.flush();
		} catch (err) {
			// ignore error, since the socket could be already closed
		}
		this._isDisposed = true;
	}

	public drain(): Promise<void> {
		this.flush();
		return this._socket.drain();
	}

	public flush(): void {
		// flush
		this._writeNow();
	}

	public write(msg: ProtocolMessage) {
		if (this._isDisposed) {
			// ignore: there could be left-over promises which complete and then
			// decide to write a response, etc...
			return;
		}
		msg.writtenTime = Date.now();
		this.lastWriteTime = Date.now();
		const header = VSBuffer.alloc(ProtocolConstants.HeaderLength);
		header.writeUInt8(msg.type, 0);
		header.writeUInt32BE(msg.id, 1);
		header.writeUInt32BE(msg.ack, 5);
		header.writeUInt32BE(msg.data.byteLength, 9);
		this._writeSoon(header, msg.data);
	}

	private _bufferAdd(head: VSBuffer, body: VSBuffer): boolean {
		const wasEmpty = this._totalLength === 0;
		this._data.push(head, body);
		this._totalLength += head.byteLength + body.byteLength;
		return wasEmpty;
	}

	private _bufferTake(): VSBuffer {
		const ret = VSBuffer.concat(this._data, this._totalLength);
		this._data.length = 0;
		this._totalLength = 0;
		return ret;
	}

	private _writeSoon(header: VSBuffer, data: VSBuffer): void {
		if (this._bufferAdd(header, data)) {
			platform.setImmediate(() => {
				this._writeNow();
			});
		}
	}

	private _writeNow(): void {
		if (this._totalLength === 0) {
			return;
		}
		this._socket.write(this._bufferTake());
	}
}

/**
 * A message has the following format:
 * ```
 *     /-------------------------------|------\
 *     |             HEADER            |      |
 *     |-------------------------------| DATA |
 *     | TYPE | ID | ACK | DATA_LENGTH |      |
 *     \-------------------------------|------/
 * ```
 * The header is 9 bytes and consists of:
 *  - TYPE is 1 byte (ProtocolMessageType) - the message type
 *  - ID is 4 bytes (u32be) - the message id (can be 0 to indicate to be ignored)
 *  - ACK is 4 bytes (u32be) - the acknowledged message id (can be 0 to indicate to be ignored)
 *  - DATA_LENGTH is 4 bytes (u32be) - the length in bytes of DATA
 *
 * Only Regular messages are counted, other messages are not counted, nor acknowledged.
 */
export class Protocol extends Disposable implements IMessagePassingProtocol {

	private _socket: ISocket;
	private _socketWriter: ProtocolWriter;
	private _socketReader: ProtocolReader;

	private readonly _onMessage = new Emitter<VSBuffer>();
	readonly onMessage: Event<VSBuffer> = this._onMessage.event;

	private readonly _onDidDispose = new Emitter<void>();
	readonly onDidDispose: Event<void> = this._onDidDispose.event;

	constructor(socket: ISocket) {
		super();
		this._socket = socket;
		this._socketWriter = this._register(new ProtocolWriter(this._socket));
		this._socketReader = this._register(new ProtocolReader(this._socket));

		this._register(this._socketReader.onMessage((msg) => {
			if (msg.type === ProtocolMessageType.Regular) {
				this._onMessage.fire(msg.data);
			}
		}));

		this._register(this._socket.onClose(() => this._onDidDispose.fire()));
	}

	drain(): Promise<void> {
		return this._socketWriter.drain();
	}

	getSocket(): ISocket {
		return this._socket;
	}

	sendDisconnect(): void {
		// Nothing to do...
	}

	send(buffer: VSBuffer): void {
		this._socketWriter.write(new ProtocolMessage(ProtocolMessageType.Regular, 0, 0, buffer));
	}
}

export class Client<TContext = string> extends IPCClient<TContext> {

	static fromSocket<TContext = string>(socket: ISocket, id: TContext): Client<TContext> {
		return new Client(new Protocol(socket), id);
	}

	get onDidDispose(): Event<void> { return this.protocol.onDidDispose; }

	constructor(private protocol: Protocol | PersistentProtocol, id: TContext, ipcLogger: IIPCLogger | null = null) {
		super(protocol, id, ipcLogger);
	}

	override dispose(): void {
		super.dispose();
		const socket = this.protocol.getSocket();
		this.protocol.sendDisconnect();
		this.protocol.dispose();
		socket.end();
	}
}

/**
 * Will ensure no messages are lost if there are no event listeners.
 */
export class BufferedEmitter<T> {
	private _emitter: Emitter<T>;
	public readonly event: Event<T>;

	private _hasListeners = false;
	private _isDeliveringMessages = false;
	private _bufferedMessages: T[] = [];

	constructor() {
		this._emitter = new Emitter<T>({
			onFirstListenerAdd: () => {
				this._hasListeners = true;
				// it is important to deliver these messages after this call, but before
				// other messages have a chance to be received (to guarantee in order delivery)
				// that's why we're using here nextTick and not other types of timeouts
				process.nextTick(() => this._deliverMessages());
			},
			onLastListenerRemove: () => {
				this._hasListeners = false;
			}
		});

		this.event = this._emitter.event;
	}

	private _deliverMessages(): void {
		if (this._isDeliveringMessages) {
			return;
		}
		this._isDeliveringMessages = true;
		while (this._hasListeners && this._bufferedMessages.length > 0) {
			this._emitter.fire(this._bufferedMessages.shift()!);
		}
		this._isDeliveringMessages = false;
	}

	public fire(event: T): void {
		if (this._hasListeners) {
			if (this._bufferedMessages.length > 0) {
				this._bufferedMessages.push(event);
			} else {
				this._emitter.fire(event);
			}
		} else {
			this._bufferedMessages.push(event);
		}
	}

	public flushBuffer(): void {
		this._bufferedMessages = [];
	}
}

class QueueElement<T> {
	public readonly data: T;
	public next: QueueElement<T> | null;

	constructor(data: T) {
		this.data = data;
		this.next = null;
	}
}

class Queue<T> {

	private _first: QueueElement<T> | null;
	private _last: QueueElement<T> | null;

	constructor() {
		this._first = null;
		this._last = null;
	}

	public peek(): T | null {
		if (!this._first) {
			return null;
		}
		return this._first.data;
	}

	public toArray(): T[] {
		let result: T[] = [], resultLen = 0;
		let it = this._first;
		while (it) {
			result[resultLen++] = it.data;
			it = it.next;
		}
		return result;
	}

	public pop(): void {
		if (!this._first) {
			return;
		}
		if (this._first === this._last) {
			this._first = null;
			this._last = null;
			return;
		}
		this._first = this._first.next;
	}

	public push(item: T): void {
		const element = new QueueElement(item);
		if (!this._first) {
			this._first = element;
			this._last = element;
			return;
		}
		this._last!.next = element;
		this._last = element;
	}
}

class LoadEstimator {

	private static _HISTORY_LENGTH = 10;
	private static _INSTANCE: LoadEstimator | null = null;
	public static getInstance(): LoadEstimator {
		if (!LoadEstimator._INSTANCE) {
			LoadEstimator._INSTANCE = new LoadEstimator();
		}
		return LoadEstimator._INSTANCE;
	}

	private lastRuns: number[];

	constructor() {
		this.lastRuns = [];
		const now = Date.now();
		for (let i = 0; i < LoadEstimator._HISTORY_LENGTH; i++) {
			this.lastRuns[i] = now - 1000 * i;
		}
		setInterval(() => {
			for (let i = LoadEstimator._HISTORY_LENGTH; i >= 1; i--) {
				this.lastRuns[i] = this.lastRuns[i - 1];
			}
			this.lastRuns[0] = Date.now();
		}, 1000);
	}

	/**
	 * returns an estimative number, from 0 (low load) to 1 (high load)
	 */
	public load(): number {
		const now = Date.now();
		const historyLimit = (1 + LoadEstimator._HISTORY_LENGTH) * 1000;
		let score = 0;
		for (let i = 0; i < LoadEstimator._HISTORY_LENGTH; i++) {
			if (now - this.lastRuns[i] <= historyLimit) {
				score++;
			}
		}
		return 1 - score / LoadEstimator._HISTORY_LENGTH;
	}

	public hasHighLoad(): boolean {
		return this.load() >= 0.5;
	}
}

/**
 * Same as Protocol, but will actually track messages and acks.
 * Moreover, it will ensure no messages are lost if there are no event listeners.
 */
export class PersistentProtocol implements IMessagePassingProtocol {

	private _isReconnecting: boolean;

	private _outgoingUnackMsg: Queue<ProtocolMessage>;
	private _outgoingMsgId: number;
	private _outgoingAckId: number;
	private _outgoingAckTimeout: any | null;

	private _incomingMsgId: number;
	private _incomingAckId: number;
	private _incomingMsgLastTime: number;
	private _incomingAckTimeout: any | null;

	private _outgoingKeepAliveTimeout: any | null;
	private _incomingKeepAliveTimeout: any | null;

	private _lastReplayRequestTime: number;

	private _socket: ISocket;
	private _socketWriter: ProtocolWriter;
	private _socketReader: ProtocolReader;
	private _socketDisposables: IDisposable[];

	private readonly _loadEstimator = LoadEstimator.getInstance();

	private readonly _onControlMessage = new BufferedEmitter<VSBuffer>();
	readonly onControlMessage: Event<VSBuffer> = this._onControlMessage.event;

	private readonly _onMessage = new BufferedEmitter<VSBuffer>();
	readonly onMessage: Event<VSBuffer> = this._onMessage.event;

	private readonly _onDidDispose = new BufferedEmitter<void>();
	readonly onDidDispose: Event<void> = this._onDidDispose.event;

	private readonly _onSocketClose = new BufferedEmitter<void>();
	readonly onSocketClose: Event<void> = this._onSocketClose.event;

	private readonly _onSocketTimeout = new BufferedEmitter<void>();
	readonly onSocketTimeout: Event<void> = this._onSocketTimeout.event;

	public get unacknowledgedCount(): number {
		return this._outgoingMsgId - this._outgoingAckId;
	}

	constructor(socket: ISocket, initialChunk: VSBuffer | null = null) {
		this._isReconnecting = false;
		this._outgoingUnackMsg = new Queue<ProtocolMessage>();
		this._outgoingMsgId = 0;
		this._outgoingAckId = 0;
		this._outgoingAckTimeout = null;

		this._incomingMsgId = 0;
		this._incomingAckId = 0;
		this._incomingMsgLastTime = 0;
		this._incomingAckTimeout = null;

		this._outgoingKeepAliveTimeout = null;
		this._incomingKeepAliveTimeout = null;

		this._lastReplayRequestTime = 0;

		this._socketDisposables = [];
		this._socket = socket;
		this._socketWriter = new ProtocolWriter(this._socket);
		this._socketDisposables.push(this._socketWriter);
		this._socketReader = new ProtocolReader(this._socket);
		this._socketDisposables.push(this._socketReader);
		this._socketDisposables.push(this._socketReader.onMessage(msg => this._receiveMessage(msg)));
		this._socketDisposables.push(this._socket.onClose(() => this._onSocketClose.fire()));
		if (initialChunk) {
			this._socketReader.acceptChunk(initialChunk);
		}

		this._sendKeepAliveCheck();
		this._recvKeepAliveCheck();
	}

	dispose(): void {
		if (this._outgoingAckTimeout) {
			clearTimeout(this._outgoingAckTimeout);
			this._outgoingAckTimeout = null;
		}
		if (this._incomingAckTimeout) {
			clearTimeout(this._incomingAckTimeout);
			this._incomingAckTimeout = null;
		}
		if (this._outgoingKeepAliveTimeout) {
			clearTimeout(this._outgoingKeepAliveTimeout);
			this._outgoingKeepAliveTimeout = null;
		}
		if (this._incomingKeepAliveTimeout) {
			clearTimeout(this._incomingKeepAliveTimeout);
			this._incomingKeepAliveTimeout = null;
		}
		this._socketDisposables = dispose(this._socketDisposables);
	}

	drain(): Promise<void> {
		return this._socketWriter.drain();
	}

	sendDisconnect(): void {
		const msg = new ProtocolMessage(ProtocolMessageType.Disconnect, 0, 0, getEmptyBuffer());
		this._socketWriter.write(msg);
		this._socketWriter.flush();
	}

	private _sendKeepAliveCheck(): void {
		if (this._outgoingKeepAliveTimeout) {
			// there will be a check in the near future
			return;
		}

		const timeSinceLastOutgoingMsg = Date.now() - this._socketWriter.lastWriteTime;
		if (timeSinceLastOutgoingMsg >= ProtocolConstants.KeepAliveTime) {
			// sufficient time has passed since last message was written,
			// and no message from our side needed to be sent in the meantime,
			// so we will send a message containing only a keep alive.
			const msg = new ProtocolMessage(ProtocolMessageType.KeepAlive, 0, 0, getEmptyBuffer());
			this._socketWriter.write(msg);
			this._sendKeepAliveCheck();
			return;
		}

		this._outgoingKeepAliveTimeout = setTimeout(() => {
			this._outgoingKeepAliveTimeout = null;
			this._sendKeepAliveCheck();
		}, ProtocolConstants.KeepAliveTime - timeSinceLastOutgoingMsg + 5);
	}

	private _recvKeepAliveCheck(): void {
		if (this._incomingKeepAliveTimeout) {
			// there will be a check in the near future
			return;
		}

		const timeSinceLastIncomingMsg = Date.now() - this._socketReader.lastReadTime;
		if (timeSinceLastIncomingMsg >= ProtocolConstants.KeepAliveTimeoutTime) {
			// It's been a long time since we received a server message
			// But this might be caused by the event loop being busy and failing to read messages
			if (!this._loadEstimator.hasHighLoad()) {
				// Trash the socket
				this._onSocketTimeout.fire(undefined);
				return;
			}
		}

		this._incomingKeepAliveTimeout = setTimeout(() => {
			this._incomingKeepAliveTimeout = null;
			this._recvKeepAliveCheck();
		}, Math.max(ProtocolConstants.KeepAliveTimeoutTime - timeSinceLastIncomingMsg, 0) + 5);
	}

	public getSocket(): ISocket {
		return this._socket;
	}

	public getMillisSinceLastIncomingData(): number {
		return Date.now() - this._socketReader.lastReadTime;
	}

	public beginAcceptReconnection(socket: ISocket, initialDataChunk: VSBuffer | null): void {
		this._isReconnecting = true;

		this._socketDisposables = dispose(this._socketDisposables);
		this._onControlMessage.flushBuffer();
		this._onSocketClose.flushBuffer();
		this._onSocketTimeout.flushBuffer();
		this._socket.dispose();

		this._lastReplayRequestTime = 0;

		this._socket = socket;
		this._socketWriter = new ProtocolWriter(this._socket);
		this._socketDisposables.push(this._socketWriter);
		this._socketReader = new ProtocolReader(this._socket);
		this._socketDisposables.push(this._socketReader);
		this._socketDisposables.push(this._socketReader.onMessage(msg => this._receiveMessage(msg)));
		this._socketDisposables.push(this._socket.onClose(() => this._onSocketClose.fire()));
		this._socketReader.acceptChunk(initialDataChunk);
	}

	public endAcceptReconnection(): void {
		this._isReconnecting = false;

		// Send again all unacknowledged messages
		const toSend = this._outgoingUnackMsg.toArray();
		for (let i = 0, len = toSend.length; i < len; i++) {
			this._socketWriter.write(toSend[i]);
		}
		this._recvAckCheck();

		this._sendKeepAliveCheck();
		this._recvKeepAliveCheck();
	}

	public acceptDisconnect(): void {
		this._onDidDispose.fire();
	}

	private _receiveMessage(msg: ProtocolMessage): void {
		if (msg.ack > this._outgoingAckId) {
			this._outgoingAckId = msg.ack;
			do {
				const first = this._outgoingUnackMsg.peek();
				if (first && first.id <= msg.ack) {
					// this message has been confirmed, remove it
					this._outgoingUnackMsg.pop();
				} else {
					break;
				}
			} while (true);
		}

		if (msg.type === ProtocolMessageType.Regular) {
			if (msg.id > this._incomingMsgId) {
				if (msg.id !== this._incomingMsgId + 1) {
					// in case we missed some messages we ask the other party to resend them
					const now = Date.now();
					if (now - this._lastReplayRequestTime > 10000) {
						// send a replay request at most once every 10s
						this._lastReplayRequestTime = now;
						this._socketWriter.write(new ProtocolMessage(ProtocolMessageType.ReplayRequest, 0, 0, getEmptyBuffer()));
					}
				} else {
					this._incomingMsgId = msg.id;
					this._incomingMsgLastTime = Date.now();
					this._sendAckCheck();
					this._onMessage.fire(msg.data);
				}
			}
		} else if (msg.type === ProtocolMessageType.Control) {
			this._onControlMessage.fire(msg.data);
		} else if (msg.type === ProtocolMessageType.Disconnect) {
			this._onDidDispose.fire();
		} else if (msg.type === ProtocolMessageType.ReplayRequest) {
			// Send again all unacknowledged messages
			const toSend = this._outgoingUnackMsg.toArray();
			for (let i = 0, len = toSend.length; i < len; i++) {
				this._socketWriter.write(toSend[i]);
			}
			this._recvAckCheck();
		}
	}

	readEntireBuffer(): VSBuffer {
		return this._socketReader.readEntireBuffer();
	}

	flush(): void {
		this._socketWriter.flush();
	}

	send(buffer: VSBuffer): void {
		const myId = ++this._outgoingMsgId;
		this._incomingAckId = this._incomingMsgId;
		const msg = new ProtocolMessage(ProtocolMessageType.Regular, myId, this._incomingAckId, buffer);
		this._outgoingUnackMsg.push(msg);
		if (!this._isReconnecting) {
			this._socketWriter.write(msg);
			this._recvAckCheck();
		}
	}

	/**
	 * Send a message which will not be part of the regular acknowledge flow.
	 * Use this for early control messages which are repeated in case of reconnection.
	 */
	sendControl(buffer: VSBuffer): void {
		const msg = new ProtocolMessage(ProtocolMessageType.Control, 0, 0, buffer);
		this._socketWriter.write(msg);
	}

	private _sendAckCheck(): void {
		if (this._incomingMsgId <= this._incomingAckId) {
			// nothink to acknowledge
			return;
		}

		if (this._incomingAckTimeout) {
			// there will be a check in the near future
			return;
		}

		const timeSinceLastIncomingMsg = Date.now() - this._incomingMsgLastTime;
		if (timeSinceLastIncomingMsg >= ProtocolConstants.AcknowledgeTime) {
			// sufficient time has passed since this message has been received,
			// and no message from our side needed to be sent in the meantime,
			// so we will send a message containing only an ack.
			this._sendAck();
			return;
		}

		this._incomingAckTimeout = setTimeout(() => {
			this._incomingAckTimeout = null;
			this._sendAckCheck();
		}, ProtocolConstants.AcknowledgeTime - timeSinceLastIncomingMsg + 5);
	}

	private _recvAckCheck(): void {
		if (this._outgoingMsgId <= this._outgoingAckId) {
			// everything has been acknowledged
			return;
		}

		if (this._outgoingAckTimeout) {
			// there will be a check in the near future
			return;
		}

		const oldestUnacknowledgedMsg = this._outgoingUnackMsg.peek()!;
		const timeSinceOldestUnacknowledgedMsg = Date.now() - oldestUnacknowledgedMsg.writtenTime;
		if (timeSinceOldestUnacknowledgedMsg >= ProtocolConstants.AcknowledgeTimeoutTime) {
			// It's been a long time since our sent message was acknowledged
			// But this might be caused by the event loop being busy and failing to read messages
			if (!this._loadEstimator.hasHighLoad()) {
				// Trash the socket
				this._onSocketTimeout.fire(undefined);
				return;
			}
		}

		this._outgoingAckTimeout = setTimeout(() => {
			this._outgoingAckTimeout = null;
			this._recvAckCheck();
		}, Math.max(ProtocolConstants.AcknowledgeTimeoutTime - timeSinceOldestUnacknowledgedMsg, 0) + 5);
	}

	private _sendAck(): void {
		if (this._incomingMsgId <= this._incomingAckId) {
			// nothink to acknowledge
			return;
		}

		this._incomingAckId = this._incomingMsgId;
		const msg = new ProtocolMessage(ProtocolMessageType.Ack, 0, this._incomingAckId, getEmptyBuffer());
		this._socketWriter.write(msg);
	}
}
