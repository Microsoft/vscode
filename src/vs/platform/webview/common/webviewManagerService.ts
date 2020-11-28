/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { VSBuffer } from 'vs/base/common/buffer';
import { UriComponents } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IRemoteConnectionData } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IWebviewPortMapping } from 'vs/platform/webview/common/webviewPortMapping';

export const IWebviewManagerService = createDecorator<IWebviewManagerService>('webviewManagerService');

export interface WebviewWebContentsId {
	readonly webContentsId: number;
}

export interface WebviewWindowId {
	readonly windowId: number;
}

export interface IWebviewManagerService {
	_serviceBrand: unknown;

	registerWebview(id: string, windowId: number, metadata: RegisterWebviewMetadata): Promise<void>;
	unregisterWebview(id: string): Promise<void>;
	updateWebviewMetadata(id: string, metadataDelta: Partial<RegisterWebviewMetadata>): Promise<void>;

	didLoadResource(requestId: number, content: VSBuffer | undefined): void;

	setIgnoreMenuShortcuts(id: WebviewWebContentsId | WebviewWindowId, enabled: boolean): Promise<void>;
}

export interface RegisterWebviewMetadata {
	readonly extensionLocation: UriComponents | undefined;
	readonly localResourceRoots: readonly UriComponents[];
	readonly remoteConnectionData: IRemoteConnectionData | null;
	readonly portMappings: readonly IWebviewPortMapping[];
}
