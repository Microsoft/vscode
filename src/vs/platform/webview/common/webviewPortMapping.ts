/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IAddress } from 'vs/platform/remote/common/remoteAgentConnection';
import { REMOTE_HOST_SCHEME } from 'vs/platform/remote/common/remoteHosts';
import { extractLocalHostUriMetaDataForPortMapping, ITunnelService, RemoteTunnel } from 'vs/platform/remote/common/tunnel';

export interface IWebviewPortMapping {
	webviewPort: number;
	extensionHostPort: number;
}

/**
 * Manages port mappings for a single webview.
 */
export class WebviewPortMappingManager implements IDisposable {

	private readonly _tunnels = new Map<number, Promise<RemoteTunnel>>();

	constructor(
		private readonly _getExtensionLocation: () => URI | undefined,
		private readonly _getMappings: () => readonly IWebviewPortMapping[],
		private readonly tunnelService: ITunnelService
	) { }

	public async getRedirect(resolveAuthority: IAddress, url: string): Promise<string | undefined> {
		const uri = URI.parse(url);
		const requestLocalHostInfo = extractLocalHostUriMetaDataForPortMapping(uri);
		if (!requestLocalHostInfo) {
			return undefined;
		}

		for (const mapping of this._getMappings()) {
			if (mapping.webviewPort === requestLocalHostInfo.port) {
				const extensionLocation = this._getExtensionLocation();
				if (extensionLocation && extensionLocation.scheme === REMOTE_HOST_SCHEME) {
					const tunnel = await this.getOrCreateTunnel(resolveAuthority, mapping.extensionHostPort);
					if (tunnel) {
						if (tunnel.tunnelLocalPort === mapping.webviewPort) {
							return undefined;
						}
						return encodeURI(uri.with({
							authority: `127.0.0.1:${tunnel.tunnelLocalPort}`,
						}).toString(true));
					}
				}

				if (mapping.webviewPort !== mapping.extensionHostPort) {
					return encodeURI(uri.with({
						authority: `${requestLocalHostInfo.address}:${mapping.extensionHostPort}`
					}).toString(true));
				}
			}
		}

		return undefined;
	}

	dispose() {
		for (const tunnel of this._tunnels.values()) {
			tunnel.then(tunnel => tunnel.dispose());
		}
		this._tunnels.clear();
	}

	private getOrCreateTunnel(remoteAuthority: IAddress, remotePort: number): Promise<RemoteTunnel> | undefined {
		const existing = this._tunnels.get(remotePort);
		if (existing) {
			return existing;
		}
		const tunnel = this.tunnelService.openTunnel({ getAddress: async () => remoteAuthority }, undefined, remotePort);
		if (tunnel) {
			this._tunnels.set(remotePort, tunnel);
		}
		return tunnel;
	}
}
