/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebviewTag } from 'electron';
import { addDisposableListener } from 'vs/base/browser/dom';
import { DisposableStore, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { isMacintosh } from 'vs/base/common/platform';
import { createChannelSender } from 'vs/base/parts/ipc/common/ipc';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { IWebviewManagerService } from 'vs/platform/webview/common/webviewManagerService';
import { WebviewMessageChannels } from 'vs/workbench/contrib/webview/browser/baseWebviewElement';

export class WebviewIgnoreMenuShortcutsManager {

	private readonly _webviews = new Set<WebviewTag>();
	private readonly _isUsingNativeTitleBars: boolean;

	private readonly webviewMainService: IWebviewManagerService;

	constructor(
		configurationService: IConfigurationService,
		mainProcessService: IMainProcessService,
	) {
		this._isUsingNativeTitleBars = configurationService.getValue<string>('window.titleBarStyle') === 'native';

		this.webviewMainService = createChannelSender<IWebviewManagerService>(mainProcessService.getChannel('webview'));
	}

	public add(webview: WebviewTag): IDisposable {
		this._webviews.add(webview);

		const disposables = new DisposableStore();

		if (this.shouldToggleMenuShortcutsEnablement) {
			this.setIgnoreMenuShortcutsForWebview(webview, true);
		}

		disposables.add(addDisposableListener(webview, 'ipc-message', (event) => {
			switch (event.channel) {
				case WebviewMessageChannels.didFocus:
					this.setIgnoreMenuShortcuts(true);
					break;

				case WebviewMessageChannels.didBlur:
					this.setIgnoreMenuShortcuts(false);
					return;
			}
		}));

		return toDisposable(() => {
			disposables.dispose();
			this._webviews.delete(webview);
		});
	}

	private get shouldToggleMenuShortcutsEnablement() {
		return isMacintosh || this._isUsingNativeTitleBars;
	}

	private setIgnoreMenuShortcuts(value: boolean) {
		for (const webview of this._webviews) {
			this.setIgnoreMenuShortcutsForWebview(webview, value);
		}
	}

	private setIgnoreMenuShortcutsForWebview(webview: WebviewTag, value: boolean) {
		if (this.shouldToggleMenuShortcutsEnablement) {
			this.webviewMainService.setIgnoreMenuShortcuts({ webContentsId: webview.getWebContentsId() }, value);
		}
	}
}
