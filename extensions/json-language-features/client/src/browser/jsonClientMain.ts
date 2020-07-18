/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtensionContext } from 'vscode';
import { LanguageClientOptions } from 'vscode-languageclient';
import { startClient, LanguageClientConstructor } from '../jsonClient';
import { LanguageClient } from 'vscode-languageclient/browser';
import { RequestService } from '../requests';

declare const Worker: {
	new(stringUrl: string): any;
};

declare function fetch(uri: string, options: any): any;

// this method is called when vs code is activated
export function activate(context: ExtensionContext) {
	const serverMain = context.asAbsolutePath('server/dist/browser/jsonServerMain.js');
	try {
		const worker = new Worker(serverMain);
		const newLanguageClient: LanguageClientConstructor = (id: string, name: string, clientOptions: LanguageClientOptions) => {
			return new LanguageClient(id, name, clientOptions, worker);
		};

		const http: RequestService = {
			getContent(uri: string) {
				return fetch(uri, { mode: 'cors' })
					.then(function (response: any) {
						return response.text();
					});
			}
		};
		startClient(context, newLanguageClient, { http });

	} catch (e) {
		console.log(e);
	}
}
