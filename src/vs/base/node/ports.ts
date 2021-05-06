/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as net from 'net';

/**
 * Given a start point and a max number of retries, will find a port that
 * is openable. Will return 0 in case no free port can be found.
 */
export function findFreePort(startPort: number, giveUpAfter: number, timeout: number): Promise<number> {
	let done = false;

	return new Promise(resolve => {
		const timeoutHandle = setTimeout(() => {
			if (!done) {
				done = true;
				return resolve(0);
			}
		}, timeout);

		doFindFreePort(startPort, giveUpAfter, (port) => {
			if (!done) {
				done = true;
				clearTimeout(timeoutHandle);
				return resolve(port);
			}
		});
	});
}

function doFindFreePort(startPort: number, giveUpAfter: number, clb: (port: number) => void): void {
	if (giveUpAfter === 0) {
		return clb(0);
	}

	const client = new net.Socket();

	// If we can connect to the port it means the port is already taken so we continue searching
	client.once('connect', () => {
		dispose(client);

		return doFindFreePort(startPort + 1, giveUpAfter - 1, clb);
	});

	client.once('data', () => {
		// this listener is required since node.js 8.x
	});

	client.once('error', (err: Error & { code?: string }) => {
		dispose(client);

		// If we receive any non ECONNREFUSED error, it means the port is used but we cannot connect
		if (err.code !== 'ECONNREFUSED') {
			return doFindFreePort(startPort + 1, giveUpAfter - 1, clb);
		}

		// Otherwise it means the port is free to use!
		return clb(startPort);
	});

	client.connect(startPort, '127.0.0.1');
}

/**
 * Uses listen instead of connect. Is faster, but if there is another listener on 0.0.0.0 then this will take 127.0.0.1 from that listener.
 */
export function findFreePortFaster(startPort: number, giveUpAfter: number, timeout: number): Promise<number> {
	let resolved: boolean = false;
	let timeoutHandle: NodeJS.Timeout | undefined = undefined;
	let countTried: number = 1;
	const server = net.createServer({ pauseOnConnect: true });
	function doResolve(port: number, resolve: (port: number) => void) {
		if (!resolved) {
			resolved = true;
			server.removeAllListeners();
			server.close();
			if (timeoutHandle) {
				clearTimeout(timeoutHandle);
			}
			resolve(port);
		}
	}
	return new Promise<number>(resolve => {
		timeoutHandle = setTimeout(() => {
			doResolve(0, resolve);
		}, timeout);

		server.on('listening', () => {
			doResolve(startPort, resolve);
		});
		server.on('error', err => {
			if (err && ((<any>err).code === 'EADDRINUSE' || (<any>err).code === 'EACCES') && (countTried < giveUpAfter)) {
				startPort++;
				countTried++;
				server.listen(startPort, '127.0.0.1');
			} else {
				doResolve(0, resolve);
			}
		});
		server.on('close', () => {
			doResolve(0, resolve);
		});
		server.listen(startPort, '127.0.0.1');
	});
}

function dispose(socket: net.Socket): void {
	try {
		socket.removeAllListeners('connect');
		socket.removeAllListeners('error');
		socket.end();
		socket.destroy();
		socket.unref();
	} catch (error) {
		console.error(error); // otherwise this error would get lost in the callback chain
	}
}
