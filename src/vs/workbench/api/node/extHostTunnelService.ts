/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainThreadTunnelServiceShape, MainContext } from 'vs/workbench/api/common/extHost.protocol';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import type * as vscode from 'vscode';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { URI } from 'vs/base/common/uri';
import { exec } from 'child_process';
import * as resources from 'vs/base/common/resources';
import * as fs from 'fs';
import { isLinux } from 'vs/base/common/platform';
import { IExtHostTunnelService, TunnelDto } from 'vs/workbench/api/common/extHostTunnelService';
import { asPromise } from 'vs/base/common/async';
import { Event, Emitter } from 'vs/base/common/event';
import { TunnelOptions } from 'vs/platform/remote/common/tunnel';

class ExtensionTunnel implements vscode.Tunnel {
	private _onDispose: Emitter<void> = new Emitter();
	onDidDispose: Event<void> = this._onDispose.event;

	constructor(
		public readonly remoteAddress: { port: number, host: string },
		public readonly localAddress: { port: number, host: string } | string,
		private readonly _dispose: () => void) { }

	dispose(): void {
		this._onDispose.fire();
		this._dispose();
	}
}

export class ExtHostTunnelService extends Disposable implements IExtHostTunnelService {
	readonly _serviceBrand: undefined;
	private readonly _proxy: MainThreadTunnelServiceShape;
	private _forwardPortProvider: ((tunnelOptions: TunnelOptions) => Thenable<vscode.Tunnel> | undefined) | undefined;
	private _showCandidatePort: (host: string, port: number, detail: string) => Thenable<boolean> = () => { return Promise.resolve(true); };
	private _extensionTunnels: Map<string, Map<number, vscode.Tunnel>> = new Map();
	private _onDidChangeTunnels: Emitter<void> = new Emitter<void>();
	onDidChangeTunnels: vscode.Event<void> = this._onDidChangeTunnels.event;

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostInitDataService initData: IExtHostInitDataService
	) {
		super();
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadTunnelService);
		if (initData.remote.isRemote && initData.remote.authority) {
			this.registerCandidateFinder();
		}
	}

	async openTunnel(forward: TunnelOptions): Promise<vscode.Tunnel | undefined> {
		const tunnel = await this._proxy.$openTunnel(forward);
		if (tunnel) {
			const disposableTunnel: vscode.Tunnel = new ExtensionTunnel(tunnel.remoteAddress, tunnel.localAddress, () => {
				return this._proxy.$closeTunnel(tunnel.remoteAddress);
			});
			this._register(disposableTunnel);
			return disposableTunnel;
		}
		return undefined;
	}

	async getTunnels(): Promise<vscode.TunnelDescription[]> {
		return this._proxy.$getTunnels();
	}

	registerCandidateFinder(): Promise<void> {
		return this._proxy.$registerCandidateFinder();
	}

	$filterCandidates(candidates: { host: string, port: number, detail: string }[]): Promise<boolean[]> {
		return Promise.all(candidates.map(candidate => {
			return this._showCandidatePort(candidate.host, candidate.port, candidate.detail);
		}));
	}

	async setTunnelExtensionFunctions(provider: vscode.RemoteAuthorityResolver | undefined): Promise<IDisposable> {
		if (provider) {
			if (provider.showCandidatePort) {
				this._showCandidatePort = provider.showCandidatePort;
				await this._proxy.$setCandidateFilter();
			}
			if (provider.tunnelFactory) {
				this._forwardPortProvider = provider.tunnelFactory;
				await this._proxy.$setTunnelProvider();
			}
		} else {
			this._forwardPortProvider = undefined;
		}
		await this._proxy.$tunnelServiceReady();
		return toDisposable(() => {
			this._forwardPortProvider = undefined;
		});
	}

	async $closeTunnel(remote: { host: string, port: number }): Promise<void> {
		if (this._extensionTunnels.has(remote.host)) {
			const hostMap = this._extensionTunnels.get(remote.host)!;
			if (hostMap.has(remote.port)) {
				hostMap.get(remote.port)!.dispose();
				hostMap.delete(remote.port);
			}
		}
	}

	async $onDidTunnelsChange(): Promise<void> {
		this._onDidChangeTunnels.fire();
	}

	$forwardPort(tunnelOptions: TunnelOptions): Promise<TunnelDto> | undefined {
		if (this._forwardPortProvider) {
			const providedPort = this._forwardPortProvider!(tunnelOptions);
			if (providedPort !== undefined) {
				return asPromise(() => providedPort).then(tunnel => {
					if (!this._extensionTunnels.has(tunnelOptions.remoteAddress.host)) {
						this._extensionTunnels.set(tunnelOptions.remoteAddress.host, new Map());
					}
					this._extensionTunnels.get(tunnelOptions.remoteAddress.host)!.set(tunnelOptions.remoteAddress.port, tunnel);
					this._register(tunnel.onDidDispose(() => this._proxy.$closeTunnel(tunnel.remoteAddress)));
					return Promise.resolve(TunnelDto.fromApiTunnel(tunnel));
				});
			}
		}
		return undefined;
	}


	async $findCandidatePorts(): Promise<{ host: string, port: number, detail: string }[]> {
		if (!isLinux) {
			return [];
		}

		const ports: { host: string, port: number, detail: string }[] = [];
		let tcp: string = '';
		let tcp6: string = '';
		try {
			tcp = fs.readFileSync('/proc/net/tcp', 'utf8');
			tcp6 = fs.readFileSync('/proc/net/tcp6', 'utf8');
		} catch (e) {
			// File reading error. No additional handling needed.
		}
		const procSockets: string = await (new Promise(resolve => {
			exec('ls -l /proc/[0-9]*/fd/[0-9]* | grep socket:', (error, stdout, stderr) => {
				resolve(stdout);
			});
		}));

		const procChildren = fs.readdirSync('/proc');
		const processes: { pid: number, cwd: string, cmd: string }[] = [];
		for (let childName of procChildren) {
			try {
				const pid: number = Number(childName);
				const childUri = resources.joinPath(URI.file('/proc'), childName);
				const childStat = fs.statSync(childUri.fsPath);
				if (childStat.isDirectory() && !isNaN(pid)) {
					const cwd = fs.readlinkSync(resources.joinPath(childUri, 'cwd').fsPath);
					const cmd = fs.readFileSync(resources.joinPath(childUri, 'cmdline').fsPath, 'utf8');
					processes.push({ pid, cwd, cmd });
				}
			} catch (e) {
				//
			}
		}

		const connections: { socket: number, ip: string, port: number }[] = this.loadListeningPorts(tcp, tcp6);
		const sockets = this.getSockets(procSockets);

		const socketMap = sockets.reduce((m, socket) => {
			m[socket.socket] = socket;
			return m;
		}, {} as Record<string, typeof sockets[0]>);
		const processMap = processes.reduce((m, process) => {
			m[process.pid] = process;
			return m;
		}, {} as Record<string, typeof processes[0]>);

		connections.filter((connection => socketMap[connection.socket])).forEach(({ socket, ip, port }) => {
			const command = processMap[socketMap[socket].pid].cmd;
			if (!command.match(/.*\.vscode-server-[a-zA-Z]+\/bin.*/) && (command.indexOf('out/vs/server/main.js') === -1)) {
				ports.push({ host: ip, port, detail: processMap[socketMap[socket].pid].cmd });
			}
		});

		return ports;
	}

	private getSockets(stdout: string) {
		const lines = stdout.trim().split('\n');
		return lines.map(line => {
			const match = /\/proc\/(\d+)\/fd\/\d+ -> socket:\[(\d+)\]/.exec(line)!;
			return {
				pid: parseInt(match[1], 10),
				socket: parseInt(match[2], 10)
			};
		});
	}

	private loadListeningPorts(...stdouts: string[]): { socket: number, ip: string, port: number }[] {
		const table = ([] as Record<string, string>[]).concat(...stdouts.map(this.loadConnectionTable));
		return [
			...new Map(
				table.filter(row => row.st === '0A')
					.map(row => {
						const address = row.local_address.split(':');
						return {
							socket: parseInt(row.inode, 10),
							ip: this.parseIpAddress(address[0]),
							port: parseInt(address[1], 16)
						};
					}).map(port => [port.ip + ':' + port.port, port])
			).values()
		];
	}

	private parseIpAddress(hex: string): string {
		let result = '';
		if (hex.length === 8) {
			for (let i = hex.length - 2; i >= 0; i -= 2) {
				result += parseInt(hex.substr(i, 2), 16);
				if (i !== 0) {
					result += '.';
				}
			}
		} else {
			for (let i = hex.length - 4; i >= 0; i -= 4) {
				result += parseInt(hex.substr(i, 4), 16).toString(16);
				if (i !== 0) {
					result += ':';
				}
			}
		}
		return result;
	}

	private loadConnectionTable(stdout: string): Record<string, string>[] {
		const lines = stdout.trim().split('\n');
		const names = lines.shift()!.trim().split(/\s+/)
			.filter(name => name !== 'rx_queue' && name !== 'tm->when');
		const table = lines.map(line => line.trim().split(/\s+/).reduce((obj, value, i) => {
			obj[names[i] || i] = value;
			return obj;
		}, {} as Record<string, string>));
		return table;
	}
}
