/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ITunnelService, TunnelOptions, RemoteTunnel } from 'vs/platform/remote/common/tunnel';
import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

export class TunnelFactoryContribution extends Disposable implements IWorkbenchContribution {
	constructor(
		@ITunnelService tunnelService: ITunnelService,
		@IWorkbenchEnvironmentService workbenchEnvironmentService: IWorkbenchEnvironmentService,
	) {
		super();
		const tunnelFactory = workbenchEnvironmentService.options?.tunnelProvider?.tunnelFactory;
		if (tunnelFactory) {
			this._register(tunnelService.setTunnelProvider({
				forwardPort: (tunnelOptions: TunnelOptions): Promise<RemoteTunnel> | undefined => {
					const tunnelPromise = tunnelFactory(tunnelOptions);
					if (!tunnelPromise) {
						return undefined;
					}
					return new Promise(resolve => {
						tunnelPromise.then(tunnel => {
							const remoteTunnel: RemoteTunnel = {
								tunnelRemotePort: tunnel.remoteAddress.port,
								tunnelRemoteHost: tunnel.remoteAddress.host,
								localAddress: tunnel.localAddress,
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
