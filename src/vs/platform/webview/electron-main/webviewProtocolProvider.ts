/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { protocol, session } from 'electron';
import { Disposable } from 'vs/base/common/lifecycle';
import { FileAccess, Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { webviewPartitionId } from 'vs/platform/webview/common/webviewManagerService';


export class WebviewProtocolProvider extends Disposable {

	private static validWebviewFilePaths = new Map([
		['/index.html', 'index.html'],
		['/fake.html', 'fake.html'],
		['/electron-browser-index.html', 'index.html'],
		['/main.js', 'main.js'],
		['/host.js', 'host.js'],
		['/service-worker.js', 'service-worker.js'],
	]);

	constructor() {
		super();

		const sess = session.fromPartition(webviewPartitionId);

		// Register the protocol loading webview html
		const webviewHandler = this.handleWebviewRequest.bind(this);
		protocol.registerFileProtocol(Schemas.vscodeWebview, webviewHandler);
		sess.protocol.registerFileProtocol(Schemas.vscodeWebview, webviewHandler);
	}

	private async handleWebviewRequest(
		request: Electron.ProtocolRequest,
		callback: (response: string | Electron.ProtocolResponse) => void
	) {
		try {
			const uri = URI.parse(request.url);
			const entry = WebviewProtocolProvider.validWebviewFilePaths.get(uri.path);
			if (typeof entry === 'string') {
				const relativeResourcePath = uri.path.startsWith('/electron-browser')
					? `vs/workbench/contrib/webview/electron-browser/pre/${entry}`
					: `vs/workbench/contrib/webview/browser/pre/${entry}`;

				const url = FileAccess.asFileUri(relativeResourcePath, require);
				return callback(decodeURIComponent(url.fsPath));
			}
		} catch {
			// noop
		}
		callback({ error: -10 /* ACCESS_DENIED - https://cs.chromium.org/chromium/src/net/base/net_error_list.h?l=32 */ });
	}
}
