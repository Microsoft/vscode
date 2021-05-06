/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewTag } from 'electron';
import * as nls from 'vs/nls';
import { Action2 } from 'vs/platform/actions/common/actions';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { CATEGORIES } from 'vs/workbench/common/actions';

export class OpenWebviewDeveloperToolsAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.webview.openDeveloperTools',
			title: { value: nls.localize('openToolsLabel', "Open Webview Developer Tools"), original: 'Open Webview Developer Tools' },
			category: CATEGORIES.Developer,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const nativeHostService = accessor.get(INativeHostService);

		const webviewElements = document.querySelectorAll('webview.ready');
		for (const element of webviewElements) {
			try {
				(element as WebviewTag).openDevTools();
			} catch (e) {
				console.error(e);
			}
		}

		const iframeWebviewElements = document.querySelectorAll('iframe.webview.ready');
		if (iframeWebviewElements.length) {
			console.info(nls.localize('iframeWebviewAlert', "Using standard dev tools to debug iframe based webview"));
			nativeHostService.openDevTools();
		}
	}
}
