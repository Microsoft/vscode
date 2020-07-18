/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewTag } from 'electron';
import { Action2 } from 'vs/platform/actions/common/actions';
import * as nls from 'vs/nls';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { webviewDeveloperCategory } from 'vs/workbench/contrib/webview/browser/webview';

export class OpenWebviewDeveloperToolsAction extends Action2 {

	constructor() {
		super({
			id: 'workbench.action.webview.openDeveloperTools',
			title: { value: nls.localize('openToolsLabel', "Open Webview Developer Tools"), original: 'Open Webview Developer Tools' },
			category: webviewDeveloperCategory,
			f1: true
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const elements = document.querySelectorAll('webview.ready');
		for (let i = 0; i < elements.length; i++) {
			try {
				(elements.item(i) as WebviewTag).openDevTools();
			} catch (e) {
				console.error(e);
			}
		}
	}
}
