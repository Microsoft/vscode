/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { WebContents, webContents } from 'electron';
import { VSBuffer } from 'vs/base/common/buffer';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IFileService } from 'vs/platform/files/common/files';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { IRequestService } from 'vs/platform/request/common/request';
import { IWebviewManagerService, RegisterWebviewMetadata, WebviewWebContentsId, WebviewWindowId } from 'vs/platform/webview/common/webviewManagerService';
import { WebviewPortMappingProvider } from 'vs/platform/webview/electron-main/webviewPortMappingProvider';
import { WebviewProtocolProvider } from 'vs/platform/webview/electron-main/webviewProtocolProvider';
import { IWindowsMainService } from 'vs/platform/windows/electron-main/windows';

export class WebviewMainService extends Disposable implements IWebviewManagerService {

	declare readonly _serviceBrand: undefined;

	private readonly protocolProvider: WebviewProtocolProvider;
	private readonly portMappingProvider: WebviewPortMappingProvider;

	constructor(
		@IFileService fileService: IFileService,
		@IRequestService requestService: IRequestService,
		@ITunnelService tunnelService: ITunnelService,
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
	) {
		super();
		this.protocolProvider = this._register(new WebviewProtocolProvider(fileService, requestService, windowsMainService));
		this.portMappingProvider = this._register(new WebviewPortMappingProvider(tunnelService));
	}

	public async registerWebview(id: string, windowId: number, metadata: RegisterWebviewMetadata): Promise<void> {
		const extensionLocation = metadata.extensionLocation ? URI.from(metadata.extensionLocation) : undefined;

		this.protocolProvider.registerWebview(id, {
			...metadata,
			windowId: windowId,
			extensionLocation,
			localResourceRoots: metadata.localResourceRoots.map(x => URI.from(x))
		});

		this.portMappingProvider.registerWebview(id, {
			extensionLocation,
			mappings: metadata.portMappings,
			resolvedAuthority: metadata.remoteConnectionData,
		});
	}

	public async unregisterWebview(id: string): Promise<void> {
		this.protocolProvider.unregisterWebview(id);
		this.portMappingProvider.unregisterWebview(id);
	}

	public async updateWebviewMetadata(id: string, metaDataDelta: Partial<RegisterWebviewMetadata>): Promise<void> {
		const extensionLocation = metaDataDelta.extensionLocation ? URI.from(metaDataDelta.extensionLocation) : undefined;

		this.protocolProvider.updateWebviewMetadata(id, {
			...metaDataDelta,
			extensionLocation,
			localResourceRoots: metaDataDelta.localResourceRoots?.map(x => URI.from(x)),
		});

		this.portMappingProvider.updateWebviewMetadata(id, {
			...metaDataDelta,
			extensionLocation,
		});
	}

	public async setIgnoreMenuShortcuts(id: WebviewWebContentsId | WebviewWindowId, enabled: boolean): Promise<void> {
		let contents: WebContents | undefined;

		if (typeof (id as WebviewWindowId).windowId === 'number') {
			const { windowId } = (id as WebviewWindowId);
			const window = this.windowsMainService.getWindowById(windowId);
			if (!window) {
				throw new Error(`Invalid windowId: ${windowId}`);
			}
			contents = window.win.webContents;
		} else {
			const { webContentsId } = (id as WebviewWebContentsId);
			contents = webContents.fromId(webContentsId);
			if (!contents) {
				throw new Error(`Invalid webContentsId: ${webContentsId}`);
			}
		}

		if (!contents.isDestroyed()) {
			contents.setIgnoreMenuShortcuts(enabled);
		}
	}

	public async didLoadResource(requestId: number, content: VSBuffer | undefined): Promise<void> {
		this.protocolProvider.didLoadResource(requestId, content);
	}
}
