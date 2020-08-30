/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as http from 'http';

export class IPCClient {

	private ipcHandlePath: string;

	constructor(private handlerName: string) {
		const ipcHandlePath = process.env['VSCODE_GIT_IPC_HANDLE'];

		if (!ipcHandlePath) {
			throw new Error('Missing VSCODE_GIT_IPC_HANDLE');
		}

		this.ipcHandlePath = ipcHandlePath;
	}

	call(request: any): Promise<any> {
		const opts: http.RequestOptions = {
			socketPath: this.ipcHandlePath,
			path: `/${this.handlerName}`,
			method: 'POST'
		};

		return new Promise((c, e) => {
			const req = http.request(opts, res => {
				if (res.statusCode !== 200) {
					return e(new Error(`Bad status code: ${res.statusCode}`));
				}

				const chunks: Buffer[] = [];
				res.on('data', d => chunks.push(d));
				res.on('end', () => c(JSON.parse(Buffer.concat(chunks).toString('utf8'))));
			});

			req.on('error', err => e(err));
			req.write(JSON.stringify(request));
			req.end();
		});
	}
}
