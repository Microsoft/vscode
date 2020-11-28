/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh } from 'vs/base/common/platform';
import { createChannelSender } from 'vs/base/parts/ipc/common/ipc';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IMainProcessService } from 'vs/platform/ipc/electron-sandbox/mainProcessService';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { IWebviewManagerService } from 'vs/platform/webview/common/webviewManagerService';

export class WindowIgnoreMenuShortcutsManager {

	private readonly _isUsingNativeTitleBars: boolean;

	private readonly webviewMainService: IWebviewManagerService;

	constructor(
		configurationService: IConfigurationService,
		mainProcessService: IMainProcessService,
		private readonly nativeHostService: INativeHostService
	) {
		this._isUsingNativeTitleBars = configurationService.getValue<string>('window.titleBarStyle') === 'native';

		this.webviewMainService = createChannelSender<IWebviewManagerService>(mainProcessService.getChannel('webview'));
	}

	public didFocus(): void {
		this.setIgnoreMenuShortcuts(true);
	}

	public didBlur(): void {
		this.setIgnoreMenuShortcuts(false);
	}

	private get shouldToggleMenuShortcutsEnablement() {
		return isMacintosh || this._isUsingNativeTitleBars;
	}

	protected setIgnoreMenuShortcuts(value: boolean) {
		if (this.shouldToggleMenuShortcutsEnablement) {
			this.webviewMainService.setIgnoreMenuShortcuts({ windowId: this.nativeHostService.windowId }, value);
		}
	}
}
