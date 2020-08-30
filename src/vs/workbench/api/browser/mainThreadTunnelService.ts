/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainThreadTunnelServiceShape, IExtHostContext, MainContext, ExtHostContext, ExtHostTunnelServiceShape } from 'vs/workbench/api/common/extHost.protocol';
import { TunnelDto } from 'vs/workbench/api/common/extHostTunnelService';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { IRemoteExplorerService, MakeAddress } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { ITunnelProvider, ITunnelService, TunnelOptions } from 'vs/platform/remote/common/tunnel';
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

	async $openTunnel(tunnelOptions: TunnelOptions): Promise<TunnelDto | undefined> {
		const tunnel = await this.remoteExplorerService.forward(tunnelOptions.remoteAddress, tunnelOptions.localAddressPort, tunnelOptions.label);
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

	async $registerCandidateFinder(): Promise<void> {
		this.remoteExplorerService.registerCandidateFinder(() => this._proxy.$findCandidatePorts());
	}

	async $tunnelServiceReady(): Promise<void> {
		return this.remoteExplorerService.restore();
	}

	async $setTunnelProvider(): Promise<void> {
		const tunnelProvider: ITunnelProvider = {
			forwardPort: (tunnelOptions: TunnelOptions) => {
				const forward = this._proxy.$forwardPort(tunnelOptions);
				if (forward) {
					return forward.then(tunnel => {
						return {
							tunnelRemotePort: tunnel.remoteAddress.port,
							tunnelRemoteHost: tunnel.remoteAddress.host,
							localAddress: typeof tunnel.localAddress === 'string' ? tunnel.localAddress : MakeAddress(tunnel.localAddress.host, tunnel.localAddress.port),
							tunnelLocalPort: typeof tunnel.localAddress !== 'string' ? tunnel.localAddress.port : undefined,
							dispose: (silent: boolean) => {
								if (!silent) {
									this._proxy.$closeTunnel({ host: tunnel.remoteAddress.host, port: tunnel.remoteAddress.port });
								}
							}
						};
					});
				}
				return undefined;
			}
		};
		this.tunnelService.setTunnelProvider(tunnelProvider);
	}

	async $setCandidateFilter(): Promise<void> {
		this._register(this.remoteExplorerService.setCandidateFilter(async (candidates: { host: string, port: number, detail: string }[]): Promise<{ host: string, port: number, detail: string }[]> => {
			const filters: boolean[] = await this._proxy.$filterCandidates(candidates);
			const filteredCandidates: { host: string, port: number, detail: string }[] = [];
			if (filters.length !== candidates.length) {
				return candidates;
			}
			for (let i = 0; i < candidates.length; i++) {
				if (filters[i]) {
					filteredCandidates.push(candidates[i]);
				}
			}
			return filteredCandidates;
		}));
	}

	dispose(): void {

	}
}
