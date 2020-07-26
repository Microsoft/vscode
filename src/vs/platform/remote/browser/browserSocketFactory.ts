/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ISocketFactory, IConnectCallback } from 'vs/platform/remote/common/remoteAgentConnection';
import { ISocket } from 'vs/base/parts/ipc/common/ipc.net';
import { VSBuffer } from 'vs/base/common/buffer';
import { IDisposable, Disposable } from 'vs/base/common/lifecycle';
import { Event, Emitter } from 'vs/base/common/event';
import * as dom from 'vs/base/browser/dom';
import { RunOnceScheduler } from 'vs/base/common/async';
import { RemoteAuthorityResolverError, RemoteAuthorityResolverErrorCode } from 'vs/platform/remote/common/remoteAuthorityResolver';

export interface IWebSocketFactory {
	create(url: string): IWebSocket;
}

export interface IWebSocket {
	readonly onData: Event<ArrayBuffer>;
	readonly onOpen: Event<void>;
	readonly onClose: Event<void>;
	readonly onError: Event<any>;

	send(data: ArrayBuffer | ArrayBufferView): void;
	close(): void;
}

class BrowserWebSocket extends Disposable implements IWebSocket {

	private readonly _onData = new Emitter<ArrayBuffer>();
	public readonly onData = this._onData.event;

	public readonly onOpen: Event<void>;

	private readonly _onClose = this._register(new Emitter<void>());
	public readonly onClose = this._onClose.event;

	private readonly _onError = this._register(new Emitter<any>());
	public readonly onError = this._onError.event;

	private readonly _socket: WebSocket;
	private readonly _fileReader: FileReader;
	private readonly _queue: Blob[];
	private _isReading: boolean;
	private _isClosed: boolean;

	private readonly _socketMessageListener: (ev: MessageEvent) => void;

	constructor(socket: WebSocket) {
		super();
		this._socket = socket;
		this._fileReader = new FileReader();
		this._queue = [];
		this._isReading = false;
		this._isClosed = false;

		this._fileReader.onload = (event) => {
			this._isReading = false;
			const buff = <ArrayBuffer>(<any>event.target).result;

			this._onData.fire(buff);

			if (this._queue.length > 0) {
				enqueue(this._queue.shift()!);
			}
		};

		const enqueue = (blob: Blob) => {
			if (this._isReading) {
				this._queue.push(blob);
				return;
			}
			this._isReading = true;
			this._fileReader.readAsArrayBuffer(blob);
		};

		this._socketMessageListener = (ev: MessageEvent) => {
			enqueue(<Blob>ev.data);
		};
		this._socket.addEventListener('message', this._socketMessageListener);

		this.onOpen = Event.fromDOMEventEmitter(this._socket, 'open');

		// WebSockets emit error events that do not contain any real information
		// Our only chance of getting to the root cause of an error is to
		// listen to the close event which gives out some real information:
		// - https://www.w3.org/TR/websockets/#closeevent
		// - https://tools.ietf.org/html/rfc6455#section-11.7
		//
		// But the error event is emitted before the close event, so we therefore
		// delay the error event processing in the hope of receiving a close event
		// with more information

		let pendingErrorEvent: any | null = null;

		const sendPendingErrorNow = () => {
			const err = pendingErrorEvent;
			pendingErrorEvent = null;
			this._onError.fire(err);
		};

		const errorRunner = this._register(new RunOnceScheduler(sendPendingErrorNow, 0));

		const sendErrorSoon = (err: any) => {
			errorRunner.cancel();
			pendingErrorEvent = err;
			errorRunner.schedule();
		};

		const sendErrorNow = (err: any) => {
			errorRunner.cancel();
			pendingErrorEvent = err;
			sendPendingErrorNow();
		};

		this._register(dom.addDisposableListener(this._socket, 'close', (e: CloseEvent) => {
			this._isClosed = true;

			if (pendingErrorEvent) {
				if (!window.navigator.onLine) {
					// The browser is offline => this is a temporary error which might resolve itself
					sendErrorNow(new RemoteAuthorityResolverError('Browser is offline', RemoteAuthorityResolverErrorCode.TemporarilyNotAvailable, e));
				} else {
					// An error event is pending
					// The browser appears to be online...
					if (!e.wasClean) {
						// Let's be optimistic and hope that perhaps the server could not be reached or something
						sendErrorNow(new RemoteAuthorityResolverError(e.reason || `WebSocket close with status code ${e.code}`, RemoteAuthorityResolverErrorCode.TemporarilyNotAvailable, e));
					} else {
						// this was a clean close => send existing error
						errorRunner.cancel();
						sendPendingErrorNow();
					}
				}
			}

			this._onClose.fire();
		}));

		this._register(dom.addDisposableListener(this._socket, 'error', sendErrorSoon));
	}

	send(data: ArrayBuffer | ArrayBufferView): void {
		if (this._isClosed) {
			// Refuse to write data to closed WebSocket...
			return;
		}
		this._socket.send(data);
	}

	close(): void {
		this._isClosed = true;
		this._socket.close();
		this._socket.removeEventListener('message', this._socketMessageListener);
		this.dispose();
	}
}

export const defaultWebSocketFactory = new class implements IWebSocketFactory {
	create(url: string): IWebSocket {
		return new BrowserWebSocket(new WebSocket(url));
	}
};

class BrowserSocket implements ISocket {
	public readonly socket: IWebSocket;

	constructor(socket: IWebSocket) {
		this.socket = socket;
	}

	public dispose(): void {
		this.socket.close();
	}

	public onData(listener: (e: VSBuffer) => void): IDisposable {
		return this.socket.onData((data) => listener(VSBuffer.wrap(new Uint8Array(data))));
	}

	public onClose(listener: () => void): IDisposable {
		return this.socket.onClose(listener);
	}

	public onEnd(listener: () => void): IDisposable {
		return Disposable.None;
	}

	public write(buffer: VSBuffer): void {
		this.socket.send(buffer.buffer);
	}

	public end(): void {
		this.socket.close();
	}

	public drain(): Promise<void> {
		return Promise.resolve();
	}
}


export class BrowserSocketFactory implements ISocketFactory {
	private readonly _webSocketFactory: IWebSocketFactory;

	constructor(webSocketFactory: IWebSocketFactory | null | undefined) {
		this._webSocketFactory = webSocketFactory || defaultWebSocketFactory;
	}

	connect(host: string, port: number, query: string, callback: IConnectCallback): void {
		const socket = this._webSocketFactory.create(`ws://${host}:${port}/?${query}&skipWebSocketFrames=false`);
		const errorListener = socket.onError((err) => callback(err, undefined));
		socket.onOpen(() => {
			errorListener.dispose();
			callback(undefined, new BrowserSocket(socket));
		});
	}
}



