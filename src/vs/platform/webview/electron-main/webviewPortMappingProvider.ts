/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { OnBeforeRequestListenerDetails, session } from 'electron';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IAddress } from 'vs/platform/remote/common/remoteAgentConnection';
import { ITunnelService } from 'vs/platform/remote/common/tunnel';
import { webviewPartitionId } from 'vs/platform/webview/common/resourceLoader';
import { IWebviewPortMapping, WebviewPortMappingManager } from 'vs/platform/webview/common/webviewPortMapping';

interface OnBeforeRequestListenerDetails_Extended extends OnBeforeRequestListenerDetails {
	readonly lastCommittedOrigin?: string;
}

interface PortMappingData {
	readonly extensionLocation: URI | undefined;
	readonly mappings: readonly IWebviewPortMapping[];
	readonly resolvedAuthority: IAddress | null | undefined;
}

export class WebviewPortMappingProvider extends Disposable {

	private readonly _webviewData = new Map<string, {
		readonly manager: WebviewPortMappingManager;
		metadata: PortMappingData;
	}>();

	constructor(
		@ITunnelService private readonly _tunnelService: ITunnelService,
	) {
		super();

		const sess = session.fromPartition(webviewPartitionId);

		sess.webRequest.onBeforeRequest({
			urls: [
				'*://localhost:*/*',
				'*://127.0.0.1:*/*',
				'*://0.0.0.0:*/*',
			]
		}, async (details: OnBeforeRequestListenerDetails_Extended, callback) => {
			let origin: URI;
			try {
				origin = URI.parse(details.lastCommittedOrigin!);
			} catch {
				return callback({});
			}

			const webviewId = origin.authority;
			const entry = this._webviewData.get(webviewId);
			if (!entry) {
				return callback({});
			}

			const redirect = await entry.manager.getRedirect(entry.metadata.resolvedAuthority, details.url);
			return callback(redirect ? { redirectURL: redirect } : {});
		});
	}

	public async registerWebview(id: string, metadata: PortMappingData): Promise<void> {
		const manager = new WebviewPortMappingManager(
			() => this._webviewData.get(id)?.metadata.extensionLocation,
			() => this._webviewData.get(id)?.metadata.mappings || [],
			this._tunnelService);

		this._webviewData.set(id, { metadata, manager });
	}

	public unregisterWebview(id: string): void {
		const existing = this._webviewData.get(id);
		if (existing) {
			existing.manager.dispose();
			this._webviewData.delete(id);
		}
	}

	public async updateWebviewMetadata(id: string, metadataDelta: Partial<PortMappingData>): Promise<void> {
		const entry = this._webviewData.get(id);
		if (entry) {
			this._webviewData.set(id, {
				...entry,
				...metadataDelta,
			});
		}
	}
}
