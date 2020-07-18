/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IStorageService, StorageScope } from 'vs/platform/storage/common/storage';
import { ITunnelService, RemoteTunnel } from 'vs/platform/remote/common/tunnel';
import { Disposable, IDisposable } from 'vs/base/common/lifecycle';
import { IEditableData } from 'vs/workbench/common/views';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { TunnelInformation, TunnelDescription, IRemoteAuthorityResolverService } from 'vs/platform/remote/common/remoteAuthorityResolver';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IAddressProvider } from 'vs/platform/remote/common/remoteAgentConnection';

export const IRemoteExplorerService = createDecorator<IRemoteExplorerService>('remoteExplorerService');
export const REMOTE_EXPLORER_TYPE_KEY: string = 'remote.explorerType';
const TUNNELS_TO_RESTORE = 'remote.tunnels.toRestore';

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
}

function ToLocalHost(host: string): string {
	if (host === '127.0.0.1') {
		host = 'localhost';
	}
	return host;
}

export function MakeAddress(host: string, port: number): string {
	return ToLocalHost(host) + ':' + port;
}

export class TunnelModel extends Disposable {
	readonly forwarded: Map<string, Tunnel>;
	readonly detected: Map<string, Tunnel>;
	private _onForwardPort: Emitter<Tunnel> = new Emitter();
	public onForwardPort: Event<Tunnel> = this._onForwardPort.event;
	private _onClosePort: Emitter<{ host: string, port: number }> = new Emitter();
	public onClosePort: Event<{ host: string, port: number }> = this._onClosePort.event;
	private _onPortName: Emitter<{ host: string, port: number }> = new Emitter();
	public onPortName: Event<{ host: string, port: number }> = this._onPortName.event;
	private _candidates: { host: string, port: number, detail: string }[] = [];
	private _candidateFinder: (() => Promise<{ host: string, port: number, detail: string }[]>) | undefined;
	private _onCandidatesChanged: Emitter<void> = new Emitter();
	public onCandidatesChanged: Event<void> = this._onCandidatesChanged.event;
	private _candidateFilter: ((candidates: { host: string, port: number, detail: string }[]) => Promise<{ host: string, port: number, detail: string }[]>) | undefined;

	constructor(
		@ITunnelService private readonly tunnelService: ITunnelService,
		@IStorageService private readonly storageService: IStorageService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkbenchEnvironmentService private readonly environmentService: IWorkbenchEnvironmentService,
		@IRemoteAuthorityResolverService private readonly remoteAuthorityResolverService: IRemoteAuthorityResolverService,
	) {
		super();
		this.forwarded = new Map();
		this.tunnelService.tunnels.then(tunnels => {
			tunnels.forEach(tunnel => {
				if (tunnel.localAddress) {
					this.forwarded.set(MakeAddress(tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort), {
						remotePort: tunnel.tunnelRemotePort,
						remoteHost: tunnel.tunnelRemoteHost,
						localAddress: tunnel.localAddress,
						localPort: tunnel.tunnelLocalPort
					});
				}
			});
		});

		this.detected = new Map();
		this._register(this.tunnelService.onTunnelOpened(tunnel => {
			const key = MakeAddress(tunnel.tunnelRemoteHost, tunnel.tunnelRemotePort);
			if ((!this.forwarded.has(key)) && tunnel.localAddress) {
				this.forwarded.set(key, {
					remoteHost: tunnel.tunnelRemoteHost,
					remotePort: tunnel.tunnelRemotePort,
					localAddress: tunnel.localAddress,
					localPort: tunnel.tunnelLocalPort,
					closeable: true
				});
				this.storeForwarded();
			}
			this._onForwardPort.fire(this.forwarded.get(key)!);
		}));
		this._register(this.tunnelService.onTunnelClosed(address => {
			const key = MakeAddress(address.host, address.port);
			if (this.forwarded.has(key)) {
				this.forwarded.delete(key);
				this.storeForwarded();
				this._onClosePort.fire(address);
			}
		}));
	}

	async restoreForwarded() {
		if (this.configurationService.getValue('remote.restoreForwardedPorts')) {
			const tunnelsString = this.storageService.get(TUNNELS_TO_RESTORE, StorageScope.WORKSPACE);
			if (tunnelsString) {
				(<Tunnel[] | undefined>JSON.parse(tunnelsString))?.forEach(tunnel => {
					this.forward({ host: tunnel.remoteHost, port: tunnel.remotePort }, tunnel.localPort, tunnel.name);
				});
			}
		}
	}

	private storeForwarded() {
		if (this.configurationService.getValue('remote.restoreForwardedPorts')) {
			this.storageService.store(TUNNELS_TO_RESTORE, JSON.stringify(Array.from(this.forwarded.values())), StorageScope.WORKSPACE);
		}
	}

	async forward(remote: { host: string, port: number }, local?: number, name?: string): Promise<RemoteTunnel | void> {
		const key = MakeAddress(remote.host, remote.port);
		if (!this.forwarded.has(key)) {
			const authority = this.environmentService.configuration.remoteAuthority;
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
					localAddress: tunnel.localAddress
				};
				this.forwarded.set(key, newForward);
				this._onForwardPort.fire(newForward);
				return tunnel;
			}
		}
	}

	name(host: string, port: number, name: string) {
		const key = MakeAddress(host, port);
		if (this.forwarded.has(key)) {
			this.forwarded.get(key)!.name = name;
			this.storeForwarded();
			this._onPortName.fire({ host, port });
		} else if (this.detected.has(key)) {
			this.detected.get(key)!.name = name;
			this._onPortName.fire({ host, port });
		}
	}

	async close(host: string, port: number): Promise<void> {
		return this.tunnelService.closeTunnel(host, port);
	}

	address(host: string, port: number): string | undefined {
		const key = MakeAddress(host, port);
		return (this.forwarded.get(key) || this.detected.get(key))?.localAddress;
	}

	addEnvironmentTunnels(tunnels: TunnelDescription[]): void {
		tunnels.forEach(tunnel => {
			this.detected.set(MakeAddress(tunnel.remoteAddress.host, tunnel.remoteAddress.port), {
				remoteHost: tunnel.remoteAddress.host,
				remotePort: tunnel.remoteAddress.port,
				localAddress: typeof tunnel.localAddress === 'string' ? tunnel.localAddress : MakeAddress(tunnel.localAddress.host, tunnel.localAddress.port),
				closeable: false
			});
		});
	}

	registerCandidateFinder(finder: () => Promise<{ host: string, port: number, detail: string }[]>): void {
		this._candidateFinder = finder;
		this._onCandidatesChanged.fire();
	}

	setCandidateFilter(filter: ((candidates: { host: string, port: number, detail: string }[]) => Promise<{ host: string, port: number, detail: string }[]>) | undefined): void {
		this._candidateFilter = filter;
	}

	get candidates(): Promise<{ host: string, port: number, detail: string }[]> {
		return this.updateCandidates().then(() => this._candidates);
	}

	private async updateCandidates(): Promise<void> {
		if (this._candidateFinder) {
			let candidates = await this._candidateFinder();
			if (this._candidateFilter && (candidates.length > 0)) {
				candidates = await this._candidateFilter(candidates);
			}
			this._candidates = candidates.map(value => {
				const nullIndex = value.detail.indexOf('\0');
				const detail = value.detail.substr(0, nullIndex > 0 ? nullIndex : value.detail.length).trim();
				return {
					host: ToLocalHost(value.host),
					port: value.port,
					detail
				};
			});
		}
	}

	async refresh(): Promise<void> {
		await this.updateCandidates();
		this._onCandidatesChanged.fire();
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
	forward(remote: { host: string, port: number }, localPort?: number, name?: string): Promise<RemoteTunnel | void>;
	close(remote: { host: string, port: number }): Promise<void>;
	setTunnelInformation(tunnelInformation: TunnelInformation | undefined): void;
	registerCandidateFinder(finder: () => Promise<{ host: string, port: number, detail: string }[]>): void;
	setCandidateFilter(filter: ((candidates: { host: string, port: number, detail: string }[]) => Promise<{ host: string, port: number, detail: string }[]>) | undefined): IDisposable;
	refresh(): Promise<void>;
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
			this.storageService.store(REMOTE_EXPLORER_TYPE_KEY, this._targetType.toString(), StorageScope.WORKSPACE);
			this.storageService.store(REMOTE_EXPLORER_TYPE_KEY, this._targetType.toString(), StorageScope.GLOBAL);
			this._onDidChangeTargetType.fire(this._targetType);
		}
	}
	get targetType(): string[] {
		return this._targetType;
	}

	get tunnelModel(): TunnelModel {
		return this._tunnelModel;
	}

	forward(remote: { host: string, port: number }, local?: number, name?: string): Promise<RemoteTunnel | void> {
		return this.tunnelModel.forward(remote, local, name);
	}

	close(remote: { host: string, port: number }): Promise<void> {
		return this.tunnelModel.close(remote.host, remote.port);
	}

	setTunnelInformation(tunnelInformation: TunnelInformation | undefined): void {
		if (tunnelInformation && tunnelInformation.environmentTunnels) {
			this.tunnelModel.addEnvironmentTunnels(tunnelInformation.environmentTunnels);
		}
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

	registerCandidateFinder(finder: () => Promise<{ host: string, port: number, detail: string }[]>): void {
		this.tunnelModel.registerCandidateFinder(finder);
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

	refresh(): Promise<void> {
		return this.tunnelModel.refresh();
	}

	restore(): Promise<void> {
		return this.tunnelModel.restoreForwarded();
	}
}

registerSingleton(IRemoteExplorerService, RemoteExplorerService, true);
