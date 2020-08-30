/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';
import { NodeSocket } from 'vs/base/parts/ipc/node/ipc.net';
import { ISocketFactory, IConnectCallback } from 'vs/platform/remote/common/remoteAgentConnection';

export const nodeSocketFactory = new class implements ISocketFactory {
	connect(host: string, port: number, query: string, callback: IConnectCallback): void {
		const errorListener = (err: any) => callback(err, undefined);

		const socket = net.createConnection({ host: host, port: port }, () => {
			socket.removeListener('error', errorListener);

			// https://tools.ietf.org/html/rfc6455#section-4
			const buffer = Buffer.alloc(16);
			for (let i = 0; i < 16; i++) {
				buffer[i] = Math.round(Math.random() * 256);
			}
			const nonce = buffer.toString('base64');

			let headers = [
				`GET ws://${host}:${port}/?${query}&skipWebSocketFrames=true HTTP/1.1`,
				`Connection: Upgrade`,
				`Upgrade: websocket`,
				`Sec-WebSocket-Key: ${nonce}`
			];
			socket.write(headers.join('\r\n') + '\r\n\r\n');

			const onData = (data: Buffer) => {
				const strData = data.toString();
				if (strData.indexOf('\r\n\r\n') >= 0) {
					// headers received OK
					socket.off('data', onData);
					callback(undefined, new NodeSocket(socket));
				}
			};
			socket.on('data', onData);
		});
		socket.once('error', errorListener);
	}
};
