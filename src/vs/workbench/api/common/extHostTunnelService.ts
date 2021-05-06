/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtHostTunnelServiceShape } from 'vs/workbench/api/common/extHost.protocol';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import * as vscode from 'vscode';
import { ProvidedPortAttributes, RemoteTunnel, TunnelCreationOptions, TunnelOptions } from 'vs/platform/remote/common/tunnel';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { CandidatePort } from 'vs/workbench/services/remote/common/remoteExplorerService';

export interface TunnelDto {
	remoteAddress: { port: number, host: string };
	localAddress: { port: number, host: string } | string;
	public: boolean;
}

export namespace TunnelDto {
	export function fromApiTunnel(tunnel: vscode.Tunnel): TunnelDto {
		return { remoteAddress: tunnel.remoteAddress, localAddress: tunnel.localAddress, public: !!tunnel.public };
	}
	export function fromServiceTunnel(tunnel: RemoteTunnel): TunnelDto {
		return {
			remoteAddress: {
				host: tunnel.tunnelRemoteHost,
				port: tunnel.tunnelRemotePort
			},
			localAddress: tunnel.localAddress,
			public: tunnel.public
		};
	}
}

export interface Tunnel extends vscode.Disposable {
	remote: { port: number, host: string };
	localAddress: string;
}

export interface IExtHostTunnelService extends ExtHostTunnelServiceShape {
	readonly _serviceBrand: undefined;
	openTunnel(extension: IExtensionDescription, forward: TunnelOptions): Promise<vscode.Tunnel | undefined>;
	getTunnels(): Promise<vscode.TunnelDescription[]>;
	onDidChangeTunnels: vscode.Event<void>;
	setTunnelExtensionFunctions(provider: vscode.RemoteAuthorityResolver | undefined): Promise<IDisposable>;
	registerPortsAttributesProvider(portSelector: { pid?: number, portRange?: [number, number], commandMatcher?: RegExp }, provider: vscode.PortAttributesProvider): IDisposable;
}

export const IExtHostTunnelService = createDecorator<IExtHostTunnelService>('IExtHostTunnelService');

export class ExtHostTunnelService implements IExtHostTunnelService {
	declare readonly _serviceBrand: undefined;
	onDidChangeTunnels: vscode.Event<void> = (new Emitter<void>()).event;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
	) {
	}
	async $applyCandidateFilter(candidates: CandidatePort[]): Promise<CandidatePort[]> {
		return candidates;
	}

	async openTunnel(extension: IExtensionDescription, forward: TunnelOptions): Promise<vscode.Tunnel | undefined> {
		return undefined;
	}
	async getTunnels(): Promise<vscode.TunnelDescription[]> {
		return [];
	}
	async setTunnelExtensionFunctions(provider: vscode.RemoteAuthorityResolver | undefined): Promise<IDisposable> {
		return { dispose: () => { } };
	}
	registerPortsAttributesProvider(portSelector: { pid?: number, portRange?: [number, number] }, provider: vscode.PortAttributesProvider) {
		return { dispose: () => { } };
	}

	async $providePortAttributes(handles: number[], ports: number[], pid: number | undefined, commandline: string | undefined, cancellationToken: vscode.CancellationToken): Promise<ProvidedPortAttributes[]> {
		return [];
	}

	async $forwardPort(tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions): Promise<TunnelDto | undefined> { return undefined; }
	async $closeTunnel(remote: { host: string, port: number }): Promise<void> { }
	async $onDidTunnelsChange(): Promise<void> { }
	async $registerCandidateFinder(): Promise<void> { }
}
