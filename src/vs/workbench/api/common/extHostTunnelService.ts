/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ExtHostTunnelServiceShape, MainContext, MainThreadTunnelServiceShape } from 'vs/workbench/api/common/extHost.protocol';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import * as vscode from 'vscode';
import { RemoteTunnel, TunnelOptions } from 'vs/platform/remote/common/tunnel';
import { IDisposable } from 'vs/base/common/lifecycle';
import { Emitter } from 'vs/base/common/event';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';

export interface TunnelDto {
	remoteAddress: { port: number, host: string };
	localAddress: { port: number, host: string } | string;
}

export namespace TunnelDto {
	export function fromApiTunnel(tunnel: vscode.Tunnel): TunnelDto {
		return { remoteAddress: tunnel.remoteAddress, localAddress: tunnel.localAddress };
	}
	export function fromServiceTunnel(tunnel: RemoteTunnel): TunnelDto {
		return { remoteAddress: { host: tunnel.tunnelRemoteHost, port: tunnel.tunnelRemotePort }, localAddress: tunnel.localAddress };
	}
}

export interface Tunnel extends vscode.Disposable {
	remote: { port: number, host: string };
	localAddress: string;
}

export interface IExtHostTunnelService extends ExtHostTunnelServiceShape {
	readonly _serviceBrand: undefined;
	openTunnel(forward: TunnelOptions): Promise<vscode.Tunnel | undefined>;
	getTunnels(): Promise<vscode.TunnelDescription[]>;
	onDidChangeTunnels: vscode.Event<void>;
	setTunnelExtensionFunctions(provider: vscode.RemoteAuthorityResolver | undefined): Promise<IDisposable>;
}

export const IExtHostTunnelService = createDecorator<IExtHostTunnelService>('IExtHostTunnelService');

export class ExtHostTunnelService implements IExtHostTunnelService {
	declare readonly _serviceBrand: undefined;
	onDidChangeTunnels: vscode.Event<void> = (new Emitter<void>()).event;
	private readonly _proxy: MainThreadTunnelServiceShape;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
	) {
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadTunnelService);
	}

	async openTunnel(forward: TunnelOptions): Promise<vscode.Tunnel | undefined> {
		return undefined;
	}
	async getTunnels(): Promise<vscode.TunnelDescription[]> {
		return [];
	}
	async $findCandidatePorts(): Promise<{ host: string, port: number; detail: string; }[]> {
		return [];
	}
	async $filterCandidates(candidates: { host: string, port: number, detail: string }[]): Promise<boolean[]> {
		return candidates.map(() => true);
	}
	async setTunnelExtensionFunctions(provider: vscode.RemoteAuthorityResolver | undefined): Promise<IDisposable> {
		await this._proxy.$tunnelServiceReady();
		return { dispose: () => { } };
	}
	$forwardPort(tunnelOptions: TunnelOptions): Promise<TunnelDto> | undefined { return undefined; }
	async $closeTunnel(remote: { host: string, port: number }): Promise<void> { }
	async $onDidTunnelsChange(): Promise<void> { }
}
