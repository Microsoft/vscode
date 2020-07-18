/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createConnection, Connection } from 'vscode-languageserver/node';
import { formatError } from '../utils/runner';
import { startServer } from '../jsonServer';
import { RequestService } from '../requests';

import { xhr, XHRResponse, configure as configureHttpRequests, getErrorStatusDescription } from 'request-light';
import { URI as Uri } from 'vscode-uri';
import * as fs from 'fs';

// Create a connection for the server.
const connection: Connection = createConnection();

console.log = connection.console.log.bind(connection.console);
console.error = connection.console.error.bind(connection.console);

process.on('unhandledRejection', (e: any) => {
	connection.console.error(formatError(`Unhandled exception`, e));
});

function getHTTPRequestService(): RequestService {
	return {
		getContent(uri: string, _encoding?: string) {
			const headers = { 'Accept-Encoding': 'gzip, deflate' };
			return xhr({ url: uri, followRedirects: 5, headers }).then(response => {
				return response.responseText;
			}, (error: XHRResponse) => {
				return Promise.reject(error.responseText || getErrorStatusDescription(error.status) || error.toString());
			});
		}
	};
}

function getFileRequestService(): RequestService {
	return {
		getContent(location: string, encoding?: string) {
			return new Promise((c, e) => {
				const uri = Uri.parse(location);
				fs.readFile(uri.fsPath, encoding, (err, buf) => {
					if (err) {
						return e(err);
					}
					c(buf.toString());
				});
			});
		}
	};
}


startServer(connection, { file: getFileRequestService(), http: getHTTPRequestService(), configureHttpRequests });
