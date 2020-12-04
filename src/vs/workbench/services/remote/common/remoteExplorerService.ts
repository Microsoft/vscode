/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ALL_INTERFACES_ADDRESSES, isAllInterfaces, isLocalhost, ITunnelService, LOCALHOST_ADDRESSES, RemoteTunnel } from 'vs/platform/remote/common/tunnel';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IEditableData } from 'vs/workbench/common/views';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TunnelInformation, TunnelDescription, IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IAddressProvider } from 'vs/platform/remote/common/remoteAgentConnection';

export const IRemoteExplorerService = createDecorator<IRemoteExplorerService>('remoteExplorerService');
export const REMOTE_EXPLORER_TYPE_KEY: string = 'remote.explorerType';
const TUNNELS_TO_RESTORE = 'remote.tunnels.toRestore';
export const TUNNEL_VIEW_ID = '~remote.forwardedPorts';

export enum TunnelType {
	Candidate = 'Candidate',
	Detected = 'Detected',
	Forwarded = 'Forwarded',
	Add = 'Add'
}

export interface ITunnelItem {
	tunnelType: TunnelType;
	remoteHost: string;
	remotePort: number;
	localAddress?: string;
	localPort?: number;
	name?: string;
	closeable?: boolean;
	description?: string;
	readonly iconClasses?: string;
	readonly label: string;
}

export interface Tunnel {
	remoteHost: string;
	remotePort: number;
	localAddress: string;
	localPort?: number;
	name?: string;
	description?: string;
	closeable?: boolean;
	runningProcess: string | undefined;
	source?: string;
}

export function makeAddress(host: string, port: number): string {
	return host + ':' + port;
}

export function parseAddress(address: string): { host: string, port: number } | undefined {
	const matches = address.match(/^([0-9]+\.[0-9]+\.[0-9]+\.[0-9]+\:|localhost:)?([0-9]+)$/);
	if (!matches) {
		return undefined;
	}
	return { host: matches[1]?.substring(0, matches[1].length - 1) || 'localhost', port: Number(matches[2]) };
}

export function mapHasAddress<T>(map: Map<string, T>, host: string, port: number): T | undefined {
	const initialAddress = map.get(makeAddress(host, port));
	if (initialAddress) {
		return initialAddress;
	}

	if (isLocalhost(host)) {
		// Do localhost checks
		for (const testHost of LOCALHOST_ADDRESSES) {
			const testAddress = makeAddress(testHost, port);
			if (map.has(testAddress)) {
				return map.get(testAddress);
			}
		}
	} else if (isAllInterfaces(host)) {
		// Do all interfaces checks
		for (const testHost of ALL_INTERFACES_ADDRESSES) {
			const testAddress = makeAddress(testHost, port);
			if (map.has(testAddress)) {
				return map.get(testAddress);
			}
		}
	}

	return undefined;
}

export function mapHasAddressLocalhostOrAllInterfaces<T>(map: Map<string, T>, host: string, port: number): T | undefined {
	const originalAddress = mapHasAddress(map, host, port);
	if (originalAddress) {
		return originalAddress;
	}
	const otherHost = isAllInterfaces(host) ? 'localhost' : (host === 'localhost' ? '0.0.0.0' : undefined);
	if (otherHost) {
		return mapHasAddress(map, otherHost, port);
	}
	return undefined;
}

export class TunnelModel extends Disposable {
	readonly forwarded: Map<string, Tunnel>;
	readonly detected: Map<string, Tunnel>;
	private remoteTunnels: Map<string, RemoteTunnel>;
	private _onForwardPort: Emitter<Tunnel | void> = new Emitter();
	public onForwardPort: Event<Tunnel | void> = this._onForwardPort.event;
	private _onClosePort: Emitter<{ host: string, port: number }> = new Emitter();
	public onClosePort: Event<{ host: string, port: number }> = this._onClosePort.event;
	private _onPortName: Emitter<{ host: string, port: number }> = new Emitter();
	public onPortName: Event<{ host: string, port: number }> = this._onPortName.event;
	private _candidates: Map<string, { host: string, port: number, detail: string }>;
	private _onCandidatesChanged: Emitter<Map<string, { host: string, port: number }>> = new Emitter();
	// onCandidateChanged returns the removed candidates
	public onCandidatesChanged: Event<Map<string, { host: string, port: number }>> = this._onCandidatesChanged.event;
	private _candidateFilter: ((candidates: { host: string, port: number, detail: string }[]) => Promise<{ host: string, port: number, detail: string }[]>) | undefined;
	private tunnelRestoreValue: string | undefined;
	private _onEnvironmentTunnelsSet: Emitter<void> = new Emitter();
	public onEnvironmentTunnelsSet: Event<void> = this._onEnvironmentTunnelsSet.event;
	private _environmentTunnelsSet: boolean = false;

	constructor(
		@ITunnelService private readonly tunnelService: ITunnelService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IRemoteAuthorityResolverService private readonly remoteAuthorityResolverService: IRemoteAuthorityResolverService,
	) {
		super();
		this.tunnelRestoreValue = this.storageService.get(TUNNELS_TO_RESTORE, StorageScope.WORKSPACE);
		this._candidates = new Map();
		this.forwarded = new Map();
		this.remoteTunnels = new Map();
		this.tunnelService.tunnels.then(tunnels => {
			tunnels.forEach(tunnel => {
				if (tunnel.localAddress) {
					const key = makeAddress(tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort);
					this.forwarded.set(key, {
						remotePort: tunnel.tunnelRemotePort,
						remoteHost: tunnel.tunnelRemoteHost,
						localAddress: tunnel.localAddress,
						localPort: tunnel.tunnelLocalPort,
						runningProcess: mapHasAddressLocalhostOrAllInterfaces(this._candidates, tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort)?.detail
					});
					this.remoteTunnels.set(key, tunnel);
				}
			});
		});

		this.detected = new Map();
		this._register(this.tunnelService.onTunnelOpened(tunnel => {
			const key = makeAddress(tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort);
			if ((!this.forwarded.has(key)) && tunnel.localAddress) {
				this.forwarded.set(key, {
					remoteHost: tunnel.tunnelRemoteHost,
					remotePort: tunnel.tunnelRemotePort,
					localAddress: tunnel.localAddress,
					localPort: tunnel.tunnelLocalPort,
					closeable: true,
					runningProcess: mapHasAddressLocalhostOrAllInterfaces(this._candidates, tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort)?.detail
				});
			}
			this.storeForwarded();
			this.remoteTunnels.set(key, tunnel);
			this._onForwardPort.fire(this.forwarded.get(key)!);
		}));
		this._register(this.tunnelService.onTunnelClosed(address => {
			const key = makeAddress(address.host, address.port);
			if (this.forwarded.has(key)) {
				this.forwarded.delete(key);
				this.storeForwarded();
				this._onClosePort.fire(address);
			}
		}));
	}

	async restoreForwarded() {
		if (this.configurationService.getValue('remote.restoreForwardedPorts')) {
			if (this.tunnelRestoreValue) {
				(<Tunnel[] | undefined>JSON.parse(this.tunnelRestoreValue))?.forEach(tunnel => {
					this.forward({ host: tunnel.remoteHost, port: tunnel.remotePort }, tunnel.localPort, tunnel.name);
				});
			}
		}
	}

	private storeForwarded() {
		if (this.configurationService.getValue('remote.restoreForwardedPorts')) {
			this.storageService.store(TUNNELS_TO_RESTORE, JSON.stringify(Array.from(this.forwarded.values())), StorageScope.WORKSPACE, StorageTarget.USER);
		}
	}

	async forward(remote: { host: string, port: number }, local?: number, name?: string, source?: string): Promise<RemoteTunnel | void> {
		const existingTunnel = mapHasAddressLocalhostOrAllInterfaces(this.forwarded, remote.host, remote.port);
		if (!existingTunnel) {
			const authority = this.environmentService.remoteAuthority;
			const addressProvider: IAddressProvider | undefined = authority ? {
				getAddress: async () => { return (await this.remoteAuthorityResolverService.resolveAuthority(authority)).authority; }
			} : undefined;

			const tunnel = await this.tunnelService.openTunnel(addressProvider, remote.host, remote.port, local);
			if (tunnel && tunnel.localAddress) {
				const newForward: Tunnel = {
					remoteHost: tunnel.tunnelRemoteHost,
					remotePort: tunnel.tunnelRemotePort,
					localPort: tunnel.tunnelLocalPort,
					name: name,
					closeable: true,
					localAddress: tunnel.localAddress,
					runningProcess: mapHasAddressLocalhostOrAllInterfaces(this._candidates, remote.host, remote.port)?.detail,
					source
				};
				const key = makeAddress(remote.host, remote.port);
				this.forwarded.set(key, newForward);
				this.remoteTunnels.set(key, tunnel);
				this._onForwardPort.fire(newForward);
				return tunnel;
			}
		} else {
			existingTunnel.name = name;
			this._onForwardPort.fire();
			return mapHasAddressLocalhostOrAllInterfaces(this.remoteTunnels, remote.host, remote.port);
		}
	}

	name(host: string, port: number, name: string) {
		const existingForwarded = mapHasAddressLocalhostOrAllInterfaces(this.forwarded, host, port);
		const key = makeAddress(host, port);
		if (existingForwarded) {
			existingForwarded.name = name;
			this.storeForwarded();
			this._onPortName.fire({ host, port });
			return;
		} else if (this.detected.has(key)) {
			this.detected.get(key)!.name = name;
			this._onPortName.fire({ host, port });
		}
	}

	async close(host: string, port: number): Promise<void> {
		return this.tunnelService.closeTunnel(host, port);
	}

	address(host: string, port: number): string | undefined {
		const key = makeAddress(host, port);
		return (this.forwarded.get(key) || this.detected.get(key))?.localAddress;
	}

	public get environmentTunnelsSet(): boolean {
		return this._environmentTunnelsSet;
	}

	addEnvironmentTunnels(tunnels: TunnelDescription[] | undefined): void {
		if (tunnels) {
			tunnels.forEach(tunnel => {
				this.detected.set(makeAddress(tunnel.remoteAddress.host, tunnel.remoteAddress.port), {
					remoteHost: tunnel.remoteAddress.host,
					remotePort: tunnel.remoteAddress.port,
					localAddress: typeof tunnel.localAddress === 'string' ? tunnel.localAddress : makeAddress(tunnel.localAddress.host, tunnel.localAddress.port),
					closeable: false,
					runningProcess: mapHasAddressLocalhostOrAllInterfaces(this._candidates, tunnel.remoteAddress.host, tunnel.remoteAddress.port)?.detail
				});
			});
		}
		this._environmentTunnelsSet = true;
		this._onEnvironmentTunnelsSet.fire();
		this._onForwardPort.fire();
	}

	setCandidateFilter(filter: ((candidates: { host: string, port: number, detail: string }[]) => Promise<{ host: string, port: number, detail: string }[]>) | undefined): void {
		this._candidateFilter = filter;
	}

	async setCandidates(candidates: { host: string, port: number, detail: string }[]) {
		let processedCandidates = candidates;
		if (this._candidateFilter) {
			// When an extension provides a filter, we do the filtering on the extension host before the candidates are set here.
			// However, when the filter doesn't come from an extension we filter here.
			processedCandidates = await this._candidateFilter(candidates);
		}
		const removedCandidates = this.updateInResponseToCandidates(processedCandidates);
		this._onCandidatesChanged.fire(removedCandidates);
	}

	private polishProcessDetail(detail: string): string {
		const nullIndex = detail.indexOf('\0');
		return detail.substr(0, nullIndex > 0 ? nullIndex : detail.length).trim();
	}

	// Returns removed candidates
	private updateInResponseToCandidates(candidates: { host: string, port: number, detail: string }[]): Map<string, { host: string, port: number }> {
		const removedCandidates = this._candidates;
		this._candidates = new Map();
		candidates.forEach(value => {
			const detail = this.polishProcessDetail(value.detail);
			const addressKey = makeAddress(value.host, value.port);
			this._candidates.set(addressKey, {
				host: value.host,
				port: value.port,
				detail
			});
			if (removedCandidates.has(addressKey)) {
				removedCandidates.delete(addressKey);
			}
			const forwardedValue = mapHasAddressLocalhostOrAllInterfaces(this.forwarded, value.host, value.port);
			if (forwardedValue) {
				forwardedValue.runningProcess = detail;
			}
		});
		removedCandidates.forEach((_value, key) => {
			const parsedAddress = parseAddress(key);
			if (!parsedAddress) {
				return;
			}
			const forwardedValue = mapHasAddressLocalhostOrAllInterfaces(this.forwarded, parsedAddress.host, parsedAddress.port);
			if (forwardedValue) {
				forwardedValue.runningProcess = undefined;
			}
			const detectedValue = mapHasAddressLocalhostOrAllInterfaces(this.detected, parsedAddress.host, parsedAddress.port);
			if (detectedValue) {
				detectedValue.runningProcess = undefined;
			}
		});
		return removedCandidates;
	}

	get candidates(): { host: string, port: number, detail: string }[] {
		return Array.from(this._candidates.values());
	}
}

export interface IRemoteExplorerService {
	readonly _serviceBrand: undefined;
	onDidChangeTargetType: Event<string[]>;
	targetType: string[];
	readonly tunnelModel: TunnelModel;
	onDidChangeEditable: Event<ITunnelItem | undefined>;
	setEditable(tunnelItem: ITunnelItem | undefined, data: IEditableData | null): void;
	getEditableData(tunnelItem: ITunnelItem | undefined): IEditableData | undefined;
	forward(remote: { host: string, port: number }, localPort?: number, name?: string, source?: string): Promise<RemoteTunnel | void>;
	close(remote: { host: string, port: number }): Promise<void>;
	setTunnelInformation(tunnelInformation: TunnelInformation | undefined): void;
	setCandidateFilter(filter: ((candidates: { host: string, port: number, detail: string }[]) => Promise<{ host: string, port: number, detail: string }[]>) | undefined): IDisposable;
	onFoundNewCandidates(candidates: { host: string, port: number, detail: string }[]): void;
	restore(): Promise<void>;
}

class RemoteExplorerService implements IRemoteExplorerService {
	public _serviceBrand: undefined;
	private _targetType: string[] = [];
	private readonly _onDidChangeTargetType: Emitter<string[]> = new Emitter<string[]>();
	public readonly onDidChangeTargetType: Event<string[]> = this._onDidChangeTargetType.event;
	private _tunnelModel: TunnelModel;
	private _editable: { tunnelItem: ITunnelItem | undefined, data: IEditableData } | undefined;
	private readonly _onDidChangeEditable: Emitter<ITunnelItem | undefined> = new Emitter();
	public readonly onDidChangeEditable: Event<ITunnelItem | undefined> = this._onDidChangeEditable.event;

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ITunnelService tunnelService: ITunnelService,
		@IConfigurationService configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IRemoteAuthorityResolverService remoteAuthorityResolverService: IRemoteAuthorityResolverService,
	) {
		this._tunnelModel = new TunnelModel(tunnelService, storageService, configurationService, environmentService, remoteAuthorityResolverService);
	}

	set targetType(name: string[]) {
		// Can just compare the first element of the array since there are no target overlaps
		const current: string = this._targetType.length > 0 ? this._targetType[0] : '';
		const newName: string = name.length > 0 ? name[0] : '';
		if (current !== newName) {
			this._targetType = name;
			this.storageService.store(REMOTE_EXPLORER_TYPE_KEY, this._targetType.toString(), StorageScope.WORKSPACE, StorageTarget.USER);
			this.storageService.store(REMOTE_EXPLORER_TYPE_KEY, this._targetType.toString(), StorageScope.GLOBAL, StorageTarget.USER);
			this._onDidChangeTargetType.fire(this._targetType);
		}
	}
	get targetType(): string[] {
		return this._targetType;
	}

	get tunnelModel(): TunnelModel {
		return this._tunnelModel;
	}

	forward(remote: { host: string, port: number }, local?: number, name?: string, source?: string): Promise<RemoteTunnel | void> {
		return this.tunnelModel.forward(remote, local, name, source);
	}

	close(remote: { host: string, port: number }): Promise<void> {
		return this.tunnelModel.close(remote.host, remote.port);
	}

	setTunnelInformation(tunnelInformation: TunnelInformation | undefined): void {
		this.tunnelModel.addEnvironmentTunnels(tunnelInformation?.environmentTunnels);
	}

	setEditable(tunnelItem: ITunnelItem | undefined, data: IEditableData | null): void {
		if (!data) {
			this._editable = undefined;
		} else {
			this._editable = { tunnelItem, data };
		}
		this._onDidChangeEditable.fire(tunnelItem);
	}

	getEditableData(tunnelItem: ITunnelItem | undefined): IEditableData | undefined {
		return (this._editable &&
			((!tunnelItem && (tunnelItem === this._editable.tunnelItem)) ||
				(tunnelItem && (this._editable.tunnelItem?.remotePort === tunnelItem.remotePort) && (this._editable.tunnelItem.remoteHost === tunnelItem.remoteHost)))) ?
			this._editable.data : undefined;
	}

	setCandidateFilter(filter: (candidates: { host: string, port: number, detail: string }[]) => Promise<{ host: string, port: number, detail: string }[]>): IDisposable {
		if (!filter) {
			return {
				dispose: () => { }
			};
		}
		this.tunnelModel.setCandidateFilter(filter);
		return {
			dispose: () => {
				this.tunnelModel.setCandidateFilter(undefined);
			}
		};
	}

	onFoundNewCandidates(candidates: { host: string, port: number, detail: string }[]): void {
		this.tunnelModel.setCandidates(candidates);
	}

	restore(): Promise<void> {
		return this.tunnelModel.restoreForwarded();
	}
}

registerSingleton(IRemoteExplorerService, RemoteExplorerService, true);
