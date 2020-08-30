/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { UriHandler, Uri, window, Disposable, commands } from 'vscode';
import { dispose } from './util';
import * as querystring from 'querystring';

export class GitProtocolHandler implements UriHandler {

	private disposables: Disposable[] = [];

	constructor() {
		this.disposables.push(window.registerUriHandler(this));
	}

	handleUri(uri: Uri): void {
		switch (uri.path) {
			case '/clone': this.clone(uri);
		}
	}

	private clone(uri: Uri): void {
		const data = querystring.parse(uri.query);

		if (!data.url) {
			console.warn('Failed to open URI:', uri);
		}

		commands.executeCommand('git.clone', data.url);
	}

	dispose(): void {
		this.disposables = dispose(this.disposables);
	}
}
