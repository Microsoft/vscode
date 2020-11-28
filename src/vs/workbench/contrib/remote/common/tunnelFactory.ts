/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITunnelService, TunnelOptions, RemoteTunnel, TunnelCreationOptions } from 'vs/platform/remote/common/tunnel';
import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IOpenerService } from 'vs/platform/opener/common/opener';
import { URI } from 'vs/base/common/uri';

export class TunnelFactoryContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@ITunnelService tunnelService: ITunnelService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IOpenerService openerService: IOpenerService
	) {
		super();
		const tunnelFactory = environmentService.options?.tunnelProvider?.tunnelFactory;
		if (tunnelFactory) {
			this._register(tunnelService.setTunnelProvider({
				forwardPort: (tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions): Promise<RemoteTunnel> | undefined => {
					const tunnelPromise = tunnelFactory(tunnelOptions, tunnelCreationOptions);
					if (!tunnelPromise) {
						return undefined;
					}
					return new Promise(resolve => {
						tunnelPromise.then(async (tunnel) => {
							const localAddress = tunnel.localAddress.startsWith('http') ? tunnel.localAddress : `http://${tunnel.localAddress}`;
							const remoteTunnel: RemoteTunnel = {
								tunnelRemotePort: tunnel.remoteAddress.port,
								tunnelRemoteHost: tunnel.remoteAddress.host,
								// The tunnel factory may give us an inaccessible local address.
								// To make sure this doesn't happen, resolve the uri immediately.
								localAddress: (await openerService.resolveExternalUri(URI.parse(localAddress))).resolved.toString(),
								dispose: tunnel.dispose
							};
							resolve(remoteTunnel);
						});
					});
				}
			}));
		}
	}
}
