/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IDisposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { ILogService } from 'vs/platform/log/common/log';
import { IAddressProvider } from 'vs/platform/remote/common/remoteAgentConnection';

export const ITunnelService = createDecorator<ITunnelService>('tunnelService');

export interface RemoteTunnel {
	readonly tunnelRemotePort: number;
	readonly tunnelRemoteHost: string;
	readonly tunnelLocalPort?: number;
	readonly localAddress: string;
	dispose(silent?: boolean): void;
}

export interface TunnelOptions {
	remoteAddress: { port: number, host: string };
	localAddressPort?: number;
	label?: string;
}

export interface TunnelCreationOptions {
	elevationRequired?: boolean;
}

export interface ITunnelProvider {
	forwardPort(tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions): Promise<RemoteTunnel> | undefined;
}

export interface ITunnelService {
	readonly _serviceBrand: undefined;

	readonly tunnels: Promise<readonly RemoteTunnel[]>;
	readonly onTunnelOpened: Event<RemoteTunnel>;
	readonly onTunnelClosed: Event<{ host: string, port: number }>;

	openTunnel(addressProvider: IAddressProvider | undefined, remoteHost: string | undefined, remotePort: number, localPort?: number): Promise<RemoteTunnel> | undefined;
	closeTunnel(remoteHost: string, remotePort: number): Promise<void>;
	setTunnelProvider(provider: ITunnelProvider | undefined): IDisposable;
}

export function extractLocalHostUriMetaDataForPortMapping(uri: URI): { address: string, port: number } | undefined {
	if (uri.scheme !== 'http' && uri.scheme !== 'https') {
		return undefined;
	}
	const localhostMatch = /^(localhost|127\.0\.0\.1|0\.0\.0\.0):(\d+)$/.exec(uri.authority);
	if (!localhostMatch) {
		return undefined;
	}
	return {
		address: localhostMatch[1],
		port: +localhostMatch[2],
	};
}

export const LOCALHOST_ADDRESSES = ['localhost', '127.0.0.1', '0:0:0:0:0:0:0:1', '::1'];
export function isLocalhost(host: string): boolean {
	return LOCALHOST_ADDRESSES.indexOf(host) >= 0;
}

export const ALL_INTERFACES_ADDRESSES = ['0.0.0.0', '0:0:0:0:0:0:0:0', '::'];
export function isAllInterfaces(host: string): boolean {
	return ALL_INTERFACES_ADDRESSES.indexOf(host) >= 0;
}

function getOtherLocalhost(host: string): string | undefined {
	return (host === 'localhost') ? '127.0.0.1' : ((host === '127.0.0.1') ? 'localhost' : undefined);
}

export abstract class AbstractTunnelService implements ITunnelService {
	declare readonly _serviceBrand: undefined;

	private _onTunnelOpened: Emitter<RemoteTunnel> = new Emitter();
	public onTunnelOpened: Event<RemoteTunnel> = this._onTunnelOpened.event;
	private _onTunnelClosed: Emitter<{ host: string, port: number }> = new Emitter();
	public onTunnelClosed: Event<{ host: string, port: number }> = this._onTunnelClosed.event;
	protected readonly _tunnels = new Map</*host*/ string, Map</* port */ number, { refcount: number, readonly value: Promise<RemoteTunnel> }>>();
	protected _tunnelProvider: ITunnelProvider | undefined;

	public constructor(
		@ILogService protected readonly logService: ILogService
	) { }

	setTunnelProvider(provider: ITunnelProvider | undefined): IDisposable {
		if (!provider) {
			return {
				dispose: () => { }
			};
		}
		this._tunnelProvider = provider;
		return {
			dispose: () => {
				this._tunnelProvider = undefined;
			}
		};
	}

	public get tunnels(): Promise<readonly RemoteTunnel[]> {
		const promises: Promise<RemoteTunnel>[] = [];
		Array.from(this._tunnels.values()).forEach(portMap => Array.from(portMap.values()).forEach(x => promises.push(x.value)));
		return Promise.all(promises);
	}

	dispose(): void {
		for (const portMap of this._tunnels.values()) {
			for (const { value } of portMap.values()) {
				value.then(tunnel => tunnel.dispose());
			}
			portMap.clear();
		}
		this._tunnels.clear();
	}

	openTunnel(addressProvider: IAddressProvider | undefined, remoteHost: string | undefined, remotePort: number, localPort: number): Promise<RemoteTunnel> | undefined {
		if (!addressProvider) {
			return undefined;
		}

		if (!remoteHost) {
			remoteHost = 'localhost';
		}

		const resolvedTunnel = this.retainOrCreateTunnel(addressProvider, remoteHost, remotePort, localPort);
		if (!resolvedTunnel) {
			return resolvedTunnel;
		}

		return resolvedTunnel.then(tunnel => {
			const newTunnel = this.makeTunnel(tunnel);
			if (tunnel.tunnelRemoteHost !== remoteHost || tunnel.tunnelRemotePort !== remotePort) {
				this.logService.warn('Created tunnel does not match requirements of requested tunnel. Host or port mismatch.');
			}
			this._onTunnelOpened.fire(newTunnel);
			return newTunnel;
		});
	}

	private makeTunnel(tunnel: RemoteTunnel): RemoteTunnel {
		return {
			tunnelRemotePort: tunnel.tunnelRemotePort,
			tunnelRemoteHost: tunnel.tunnelRemoteHost,
			tunnelLocalPort: tunnel.tunnelLocalPort,
			localAddress: tunnel.localAddress,
			dispose: () => {
				const existingHost = this._tunnels.get(tunnel.tunnelRemoteHost);
				if (existingHost) {
					const existing = existingHost.get(tunnel.tunnelRemotePort);
					if (existing) {
						existing.refcount--;
						this.tryDisposeTunnel(tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort, existing);
					}
				}
			}
		};
	}

	private async tryDisposeTunnel(remoteHost: string, remotePort: number, tunnel: { refcount: number, readonly value: Promise<RemoteTunnel> }): Promise<void> {
		if (tunnel.refcount <= 0) {
			const disposePromise: Promise<void> = tunnel.value.then(tunnel => {
				tunnel.dispose(true);
				this._onTunnelClosed.fire({ host: tunnel.tunnelRemoteHost, port: tunnel.tunnelRemotePort });
			});
			if (this._tunnels.has(remoteHost)) {
				this._tunnels.get(remoteHost)!.delete(remotePort);
			}
			return disposePromise;
		}
	}

	async closeTunnel(remoteHost: string, remotePort: number): Promise<void> {
		const portMap = this._tunnels.get(remoteHost);
		if (portMap && portMap.has(remotePort)) {
			const value = portMap.get(remotePort)!;
			value.refcount = 0;
			await this.tryDisposeTunnel(remoteHost, remotePort, value);
		}
	}

	protected addTunnelToMap(remoteHost: string, remotePort: number, tunnel: Promise<RemoteTunnel>) {
		if (!this._tunnels.has(remoteHost)) {
			this._tunnels.set(remoteHost, new Map());
		}
		this._tunnels.get(remoteHost)!.set(remotePort, { refcount: 1, value: tunnel });
	}

	protected getTunnelFromMap(remoteHost: string, remotePort: number): { refcount: number, readonly value: Promise<RemoteTunnel> } | undefined {
		const otherLocalhost = getOtherLocalhost(remoteHost);
		let portMap: Map<number, { refcount: number, readonly value: Promise<RemoteTunnel> }> | undefined;
		if (otherLocalhost) {
			const firstMap = this._tunnels.get(remoteHost);
			const secondMap = this._tunnels.get(otherLocalhost);
			if (firstMap && secondMap) {
				portMap = new Map([...Array.from(firstMap.entries()), ...Array.from(secondMap.entries())]);
			} else {
				portMap = firstMap ?? secondMap;
			}
		} else {
			portMap = this._tunnels.get(remoteHost);
		}
		return portMap ? portMap.get(remotePort) : undefined;
	}

	protected abstract retainOrCreateTunnel(addressProvider: IAddressProvider, remoteHost: string, remotePort: number, localPort?: number): Promise<RemoteTunnel> | undefined;

	protected isPortPrivileged(port: number): boolean {
		return port < 1024;
	}
}

export class TunnelService extends AbstractTunnelService {
	protected retainOrCreateTunnel(_addressProvider: IAddressProvider, remoteHost: string, remotePort: number, localPort?: number | undefined): Promise<RemoteTunnel> | undefined {
		const existing = this.getTunnelFromMap(remoteHost, remotePort);
		if (existing) {
			++existing.refcount;
			return existing.value;
		}

		if (this._tunnelProvider) {
			const preferredLocalPort = localPort === undefined ? remotePort : localPort;
			const tunnelOptions = { remoteAddress: { host: remoteHost, port: remotePort }, localAddressPort: localPort };
			const creationInfo = { elevationRequired: this.isPortPrivileged(preferredLocalPort) };
			const tunnel = this._tunnelProvider.forwardPort(tunnelOptions, creationInfo);
			if (tunnel) {
				this.addTunnelToMap(remoteHost, remotePort, tunnel);
			}
			return tunnel;
		}
		return undefined;
	}
}
