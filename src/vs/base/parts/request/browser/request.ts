/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from 'vs/base/common/cancellation';
import { canceled } from 'vs/base/common/errors';
import { assign } from 'vs/base/common/objects';
import { VSBuffer, bufferToStream } from 'vs/base/common/buffer';
import { IRequestOptions, IRequestContext } from 'vs/base/parts/request/common/request';

export function request(options: IRequestOptions, token: CancellationToken): Promise<IRequestContext> {
	if (options.proxyAuthorization) {
		options.headers = assign(options.headers || {}, { 'Proxy-Authorization': options.proxyAuthorization });
	}

	const xhr = new XMLHttpRequest();
	return new Promise<IRequestContext>((resolve, reject) => {

		xhr.open(options.type || 'GET', options.url || '', true, options.user, options.password);
		setRequestHeaders(xhr, options);

		xhr.responseType = 'arraybuffer';
		xhr.onerror = e => reject(new Error(xhr.statusText && ('XHR failed: ' + xhr.statusText) || 'XHR failed'));
		xhr.onload = (e) => {
			resolve({
				res: {
					statusCode: xhr.status,
					headers: getResponseHeaders(xhr)
				},
				stream: bufferToStream(VSBuffer.wrap(new Uint8Array(xhr.response)))
			});
		};
		xhr.ontimeout = e => reject(new Error(`XHR timeout: ${options.timeout}ms`));

		if (options.timeout) {
			xhr.timeout = options.timeout;
		}

		xhr.send(options.data);

		// cancel
		token.onCancellationRequested(() => {
			xhr.abort();
			reject(canceled());
		});
	});
}

function setRequestHeaders(xhr: XMLHttpRequest, options: IRequestOptions): void {
	if (options.headers) {
		outer: for (let k in options.headers) {
			switch (k) {
				case 'User-Agent':
				case 'Accept-Encoding':
				case 'Content-Length':
					// unsafe headers
					continue outer;
			}
			xhr.setRequestHeader(k, options.headers[k]);
		}
	}
}

function getResponseHeaders(xhr: XMLHttpRequest): { [name: string]: string } {
	const headers: { [name: string]: string } = Object.create(null);
	for (const line of xhr.getAllResponseHeaders().split(/\r\n|\n|\r/g)) {
		if (line) {
			const idx = line.indexOf(':');
			headers[line.substr(0, idx).trim().toLowerCase()] = line.substr(idx + 1).trim();
		}
	}
	return headers;
}
