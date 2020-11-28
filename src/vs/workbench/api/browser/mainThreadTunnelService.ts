/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainThreadTunnelServiceShape, IExtHostContext, MainContext, ExtHostContext, ExtHostTunnelServiceShape } from 'vs/workbench/api/common/extHost.protocol';
import { TunnelDto } from 'vs/workbench/api/common/extHostTunnelService';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IRemoteExplorerService, makeAddress } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { ITunnelProvider, ITunnelService, TunnelCreationOptions, TunnelOptions } from 'vs/platform/remote/common/tunnel';
import { Disposable } from 'vs/base/common/lifecycle';
import type { TunnelDescription } from 'vs/platform/remote/common/remoteAuthorityResolver';

@extHostNamedCustomer(MainContext.MainThreadTunnelService)
export class MainThreadTunnelService extends Disposable implements MainThreadTunnelServiceShape {
	private readonly _proxy: ExtHostTunnelServiceShape;

	constructor(
		extHostContext: IExtHostContext,
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService,
		@ITunnelService private readonly tunnelService: ITunnelService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostTunnelService);
		this._register(tunnelService.onTunnelOpened(() => this._proxy.$onDidTunnelsChange()));
		this._register(tunnelService.onTunnelClosed(() => this._proxy.$onDidTunnelsChange()));
	}

	async $openTunnel(tunnelOptions: TunnelOptions, source: string): Promise<TunnelDto | undefined> {
		const tunnel = await this.remoteExplorerService.forward(tunnelOptions.remoteAddress, tunnelOptions.localAddressPort, tunnelOptions.label, source);
		if (tunnel) {
			return TunnelDto.fromServiceTunnel(tunnel);
		}
		return undefined;
	}

	async $closeTunnel(remote: { host: string, port: number }): Promise<void> {
		return this.remoteExplorerService.close(remote);
	}

	async $getTunnels(): Promise<TunnelDescription[]> {
		return (await this.tunnelService.tunnels).map(tunnel => {
			return {
				remoteAddress: { port: tunnel.tunnelRemotePort, host: tunnel.tunnelRemoteHost },
				localAddress: tunnel.localAddress
			};
		});
	}

	async $onFoundNewCandidates(candidates: { host: string, port: number, detail: string }[]): Promise<void> {
		this.remoteExplorerService.onFoundNewCandidates(candidates);
	}

	async $tunnelServiceReady(): Promise<void> {
		return this.remoteExplorerService.restore();
	}

	async $setTunnelProvider(): Promise<void> {
		const tunnelProvider: ITunnelProvider = {
			forwardPort: (tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions) => {
				const forward = this._proxy.$forwardPort(tunnelOptions, tunnelCreationOptions);
				if (forward) {
					return forward.then(tunnel => {
						return {
							tunnelRemotePort: tunnel.remoteAddress.port,
							tunnelRemoteHost: tunnel.remoteAddress.host,
							localAddress: typeof tunnel.localAddress === 'string' ? tunnel.localAddress : makeAddress(tunnel.localAddress.host, tunnel.localAddress.port),
							tunnelLocalPort: typeof tunnel.localAddress !== 'string' ? tunnel.localAddress.port : undefined,
							dispose: (silent?: boolean) => {
								this._proxy.$closeTunnel({ host: tunnel.remoteAddress.host, port: tunnel.remoteAddress.port }, silent);
							}
						};
					});
				}
				return undefined;
			}
		};
		this.tunnelService.setTunnelProvider(tunnelProvider);
	}

	dispose(): void {

	}
}
