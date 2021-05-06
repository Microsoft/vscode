/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { MainThreadTunnelServiceShape, IExtHostContext, MainContext, ExtHostContext, ExtHostTunnelServiceShape, CandidatePortSource, PortAttributesProviderSelector } from 'vs/workbench/api/common/extHost.protocol';
import { TunnelDto } from 'vs/workbench/api/common/extHostTunnelService';
import { extHostNamedCustomer } from 'vs/workbench/api/common/extHostCustomers';
import { CandidatePort, IRemoteExplorerService, makeAddress, PORT_AUTO_FORWARD_SETTING, PORT_AUTO_SOURCE_SETTING, PORT_AUTO_SOURCE_SETTING_OUTPUT, PORT_AUTO_SOURCE_SETTING_PROCESS } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { ITunnelProvider, ITunnelService, TunnelCreationOptions, TunnelProviderFeatures, TunnelOptions, RemoteTunnel, isPortPrivileged, ProvidedPortAttributes, PortAttributesProvider } from 'vs/platform/remote/common/tunnel';
import { Disposable } from 'vs/base/common/lifecycle';
import type { TunnelDescription } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { CancellationToken } from 'vs/base/common/cancellation';
import { Registry } from 'vs/platform/registry/common/platform';
import { IConfigurationRegistry, Extensions as ConfigurationExtensions } from 'vs/platform/configuration/common/configurationRegistry';

@extHostNamedCustomer(MainContext.MainThreadTunnelService)
export class MainThreadTunnelService extends Disposable implements MainThreadTunnelServiceShape, PortAttributesProvider {
	private readonly _proxy: ExtHostTunnelServiceShape;
	private elevateionRetry: boolean = false;
	private portsAttributesProviders: Map<number, PortAttributesProviderSelector> = new Map();

	constructor(
		extHostContext: IExtHostContext,
		@IRemoteExplorerService private readonly remoteExplorerService: IRemoteExplorerService,
		@ITunnelService private readonly tunnelService: ITunnelService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILogService private readonly logService: ILogService,
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService
	) {
		super();
		this._proxy = extHostContext.getProxy(ExtHostContext.ExtHostTunnelService);
		this._register(tunnelService.onTunnelOpened(() => this._proxy.$onDidTunnelsChange()));
		this._register(tunnelService.onTunnelClosed(() => this._proxy.$onDidTunnelsChange()));
	}

	private processFindingEnabled(): boolean {
		return (!!this.configurationService.getValue(PORT_AUTO_FORWARD_SETTING)) && (this.configurationService.getValue(PORT_AUTO_SOURCE_SETTING) === PORT_AUTO_SOURCE_SETTING_PROCESS);
	}

	async $setRemoteTunnelService(processId: number): Promise<void> {
		this.remoteExplorerService.namedProcesses.set(processId, 'Code Extension Host');
		if (this.remoteExplorerService.portsFeaturesEnabled) {
			this._proxy.$registerCandidateFinder(this.processFindingEnabled());
		} else {
			this._register(this.remoteExplorerService.onEnabledPortsFeatures(() => this._proxy.$registerCandidateFinder(this.configurationService.getValue(PORT_AUTO_FORWARD_SETTING))));
		}
		this._register(this.configurationService.onDidChangeConfiguration(async (e) => {
			if (e.affectsConfiguration(PORT_AUTO_FORWARD_SETTING) || e.affectsConfiguration(PORT_AUTO_SOURCE_SETTING)) {
				return this._proxy.$registerCandidateFinder(this.processFindingEnabled());
			}
		}));
	}

	private _alreadyRegistered: boolean = false;
	async $registerPortsAttributesProvider(selector: PortAttributesProviderSelector, providerHandle: number): Promise<void> {
		this.portsAttributesProviders.set(providerHandle, selector);
		if (!this._alreadyRegistered) {
			this.remoteExplorerService.tunnelModel.addAttributesProvider(this);
			this._alreadyRegistered = true;
		}
	}

	async $unregisterPortsAttributesProvider(providerHandle: number): Promise<void> {
		this.portsAttributesProviders.delete(providerHandle);
	}

	async providePortAttributes(ports: number[], pid: number | undefined, commandLine: string | undefined, token: CancellationToken): Promise<ProvidedPortAttributes[]> {
		if (this.portsAttributesProviders.size === 0) {
			return [];
		}

		// Check all the selectors to make sure it's worth going to the extension host.
		const appropriateHandles = Array.from(this.portsAttributesProviders.entries()).filter(entry => {
			const selector = entry[1];
			const portRange = selector.portRange;
			const portInRange = portRange ? ports.some(port => portRange[0] <= port && port < portRange[1]) : true;
			const pidMatches = !selector.pid || (selector.pid === pid);
			const commandMatches = !selector.commandMatcher || (commandLine && (commandLine.match(selector.commandMatcher)));
			return portInRange && pidMatches && commandMatches;
		}).map(entry => entry[0]);

		if (appropriateHandles.length === 0) {
			return [];
		}
		return this._proxy.$providePortAttributes(appropriateHandles, ports, pid, commandLine, token);
	}

	async $openTunnel(tunnelOptions: TunnelOptions, source: string): Promise<TunnelDto | undefined> {
		const tunnel = await this.remoteExplorerService.forward(tunnelOptions.remoteAddress, tunnelOptions.localAddressPort, tunnelOptions.label, source, false);
		if (tunnel) {
			if (!this.elevateionRetry
				&& (tunnelOptions.localAddressPort !== undefined)
				&& (tunnel.tunnelLocalPort !== undefined)
				&& isPortPrivileged(tunnelOptions.localAddressPort)
				&& (tunnel.tunnelLocalPort !== tunnelOptions.localAddressPort)
				&& this.tunnelService.canElevate) {

				this.elevationPrompt(tunnelOptions, tunnel, source);
			}
			return TunnelDto.fromServiceTunnel(tunnel);
		}
		return undefined;
	}

	private async elevationPrompt(tunnelOptions: TunnelOptions, tunnel: RemoteTunnel, source: string) {
		return this.notificationService.prompt(Severity.Info,
			nls.localize('remote.tunnel.openTunnel', "The extension {0} has forwarded port {1}. You'll need to run as superuser to use port {2} locally.", source, tunnelOptions.remoteAddress.port, tunnelOptions.localAddressPort),
			[{
				label: nls.localize('remote.tunnelsView.elevationButton', "Use Port {0} as Sudo...", tunnel.tunnelRemotePort),
				run: async () => {
					this.elevateionRetry = true;
					await this.remoteExplorerService.close({ host: tunnel.tunnelRemoteHost, port: tunnel.tunnelRemotePort });
					await this.remoteExplorerService.forward(tunnelOptions.remoteAddress, tunnelOptions.localAddressPort, tunnelOptions.label, source, true);
					this.elevateionRetry = false;
				}
			}]);
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

	async $onFoundNewCandidates(candidates: CandidatePort[]): Promise<void> {
		this.remoteExplorerService.onFoundNewCandidates(candidates);
	}

	async $setTunnelProvider(features: TunnelProviderFeatures): Promise<void> {
		const tunnelProvider: ITunnelProvider = {
			forwardPort: (tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions) => {
				const forward = this._proxy.$forwardPort(tunnelOptions, tunnelCreationOptions);
				return forward.then(tunnel => {
					this.logService.trace(`ForwardedPorts: (MainThreadTunnelService) New tunnel established by tunnel provider: ${tunnel?.remoteAddress.host}:${tunnel?.remoteAddress.port}`);
					if (!tunnel) {
						return undefined;
					}
					return {
						tunnelRemotePort: tunnel.remoteAddress.port,
						tunnelRemoteHost: tunnel.remoteAddress.host,
						localAddress: typeof tunnel.localAddress === 'string' ? tunnel.localAddress : makeAddress(tunnel.localAddress.host, tunnel.localAddress.port),
						tunnelLocalPort: typeof tunnel.localAddress !== 'string' ? tunnel.localAddress.port : undefined,
						public: tunnel.public,
						dispose: async (silent?: boolean) => {
							this.logService.trace(`ForwardedPorts: (MainThreadTunnelService) Closing tunnel from tunnel provider: ${tunnel?.remoteAddress.host}:${tunnel?.remoteAddress.port}`);
							return this._proxy.$closeTunnel({ host: tunnel.remoteAddress.host, port: tunnel.remoteAddress.port }, silent);
						}
					};
				});
			}
		};
		this.tunnelService.setTunnelProvider(tunnelProvider, features);
	}

	async $setCandidateFilter(): Promise<void> {
		this.remoteExplorerService.setCandidateFilter((candidates: CandidatePort[]): Promise<CandidatePort[]> => {
			return this._proxy.$applyCandidateFilter(candidates);
		});
	}

	async $setCandidatePortSource(source: CandidatePortSource): Promise<void> {
		// Must wait for the remote environment before trying to set settings there.
		this.remoteAgentService.getEnvironment().then(() => {
			switch (source) {
				case CandidatePortSource.None: {
					Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
						.registerDefaultConfigurations([{ 'remote.autoForwardPorts': false }]);
					break;
				}
				case CandidatePortSource.Output: {
					Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration)
						.registerDefaultConfigurations([{ 'remote.autoForwardPortsSource': PORT_AUTO_SOURCE_SETTING_OUTPUT }]);
					break;
				}
				default: // Do nothing, the defaults for these settings should be used.
			}
		}).catch(() => {
			// The remote failed to get setup. Errors from that area will already be surfaced to the user.
		});
	}
}
