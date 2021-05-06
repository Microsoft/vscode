/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { MainThreadTunnelServiceShape, MainContext, PortAttributesProviderSelector } from 'vs/workbench/api/common/extHost.protocol';
import { IExtHostRpcService } from 'vs/workbench/api/common/extHostRpcService';
import type * as vscode from 'vscode';
import { Disposable, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { URI } from 'vs/base/common/uri';
import { exec } from 'child_process';
import * as resources from 'vs/base/common/resources';
import * as fs from 'fs';
import * as pfs from 'vs/base/node/pfs';
import * as types from 'vs/workbench/api/common/extHostTypes';
import { isLinux } from 'vs/base/common/platform';
import { IExtHostTunnelService, TunnelDto } from 'vs/workbench/api/common/extHostTunnelService';
import { Event, Emitter } from 'vs/base/common/event';
import { TunnelOptions, TunnelCreationOptions, ProvidedPortAttributes, ProvidedOnAutoForward } from 'vs/platform/remote/common/tunnel';
import { IExtensionDescription } from 'vs/platform/extensions/common/extensions';
import { MovingAverage } from 'vs/base/common/numbers';
import { CandidatePort } from 'vs/workbench/services/remote/common/remoteExplorerService';
import { ILogService } from 'vs/platform/log/common/log';

class ExtensionTunnel implements vscode.Tunnel {
	private _onDispose: Emitter<void> = new Emitter();
	onDidDispose: Event<void> = this._onDispose.event;

	constructor(
		public readonly remoteAddress: { port: number, host: string },
		public readonly localAddress: { port: number, host: string } | string,
		private readonly _dispose: () => Promise<void>) { }

	dispose(): Promise<void> {
		this._onDispose.fire();
		return this._dispose();
	}
}

export function getSockets(stdout: string): Record<string, { pid: number; socket: number; }> {
	const lines = stdout.trim().split('\n');
	const mapped: { pid: number, socket: number }[] = [];
	lines.forEach(line => {
		const match = /\/proc\/(\d+)\/fd\/\d+ -> socket:\[(\d+)\]/.exec(line)!;
		if (match && match.length >= 3) {
			mapped.push({
				pid: parseInt(match[1], 10),
				socket: parseInt(match[2], 10)
			});
		}
	});
	const socketMap = mapped.reduce((m, socket) => {
		m[socket.socket] = socket;
		return m;
	}, {} as Record<string, typeof mapped[0]>);
	return socketMap;
}

export function loadListeningPorts(...stdouts: string[]): { socket: number, ip: string, port: number }[] {
	const table = ([] as Record<string, string>[]).concat(...stdouts.map(loadConnectionTable));
	return [
		...new Map(
			table.filter(row => row.st === '0A')
				.map(row => {
					const address = row.local_address.split(':');
					return {
						socket: parseInt(row.inode, 10),
						ip: parseIpAddress(address[0]),
						port: parseInt(address[1], 16)
					};
				}).map(port => [port.ip + ':' + port.port, port])
		).values()
	];
}

export function parseIpAddress(hex: string): string {
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

export function loadConnectionTable(stdout: string): Record<string, string>[] {
	const lines = stdout.trim().split('\n');
	const names = lines.shift()!.trim().split(/\s+/)
		.filter(name => name !== 'rx_queue' && name !== 'tm->when');
	const table = lines.map(line => line.trim().split(/\s+/).reduce((obj, value, i) => {
		obj[names[i] || i] = value;
		return obj;
	}, {} as Record<string, string>));
	return table;
}

function knownExcludeCmdline(command: string): boolean {
	return !!command.match(/.*\.vscode-server-[a-zA-Z]+\/bin.*/)
		|| (command.indexOf('out/vs/server/main.js') !== -1)
		|| (command.indexOf('_productName=VSCode') !== -1);
}

export function getRootProcesses(stdout: string) {
	const lines = stdout.trim().split('\n');
	const mapped: { pid: number, cmd: string, ppid: number }[] = [];
	lines.forEach(line => {
		const match = /^\d+\s+\D+\s+root\s+(\d+)\s+(\d+).+\d+\:\d+\:\d+\s+(.+)$/.exec(line)!;
		if (match && match.length >= 4) {
			mapped.push({
				pid: parseInt(match[1], 10),
				ppid: parseInt(match[2]),
				cmd: match[3]
			});
		}
	});
	return mapped;
}

export async function findPorts(connections: { socket: number, ip: string, port: number }[], socketMap: Record<string, { pid: number, socket: number }>, processes: { pid: number, cwd: string, cmd: string }[]): Promise<CandidatePort[]> {
	const processMap = processes.reduce((m, process) => {
		m[process.pid] = process;
		return m;
	}, {} as Record<string, typeof processes[0]>);

	const ports: CandidatePort[] = [];
	connections.forEach(({ socket, ip, port }) => {
		const pid = socketMap[socket] ? socketMap[socket].pid : undefined;
		const command: string | undefined = pid ? processMap[pid]?.cmd : undefined;
		if (pid && command && !knownExcludeCmdline(command)) {
			ports.push({ host: ip, port, detail: command, pid });
		}
	});
	return ports;
}

export function tryFindRootPorts(connections: { socket: number, ip: string, port: number }[], rootProcessesStdout: string, previousPorts: Map<number, CandidatePort & { ppid: number }>): Map<number, CandidatePort & { ppid: number }> {
	const ports: Map<number, CandidatePort & { ppid: number }> = new Map();
	const rootProcesses = getRootProcesses(rootProcessesStdout);

	for (const connection of connections) {
		const previousPort = previousPorts.get(connection.port);
		if (previousPort) {
			ports.set(connection.port, previousPort);
			continue;
		}
		const rootProcessMatch = rootProcesses.find((value) => value.cmd.includes(`${connection.port}`));
		if (rootProcessMatch) {
			let bestMatch = rootProcessMatch;
			// There are often several processes that "look" like they could match the port.
			// The one we want is usually the child of the other. Find the most child process.
			let mostChild: { pid: number, cmd: string, ppid: number } | undefined;
			do {
				mostChild = rootProcesses.find(value => value.ppid === bestMatch.pid);
				if (mostChild) {
					bestMatch = mostChild;
				}
			} while (mostChild);
			ports.set(connection.port, { host: connection.ip, port: connection.port, pid: bestMatch.pid, detail: bestMatch.cmd, ppid: bestMatch.ppid });
		} else {
			ports.set(connection.port, { host: connection.ip, port: connection.port, ppid: Number.MAX_VALUE });
		}
	}

	return ports;
}

export class ExtHostTunnelService extends Disposable implements IExtHostTunnelService {
	readonly _serviceBrand: undefined;
	private readonly _proxy: MainThreadTunnelServiceShape;
	private _forwardPortProvider: ((tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions) => Thenable<vscode.Tunnel> | undefined) | undefined;
	private _showCandidatePort: (host: string, port: number, detail: string) => Thenable<boolean> = () => { return Promise.resolve(true); };
	private _extensionTunnels: Map<string, Map<number, { tunnel: vscode.Tunnel, disposeListener: IDisposable }>> = new Map();
	private _onDidChangeTunnels: Emitter<void> = new Emitter<void>();
	onDidChangeTunnels: vscode.Event<void> = this._onDidChangeTunnels.event;
	private _candidateFindingEnabled: boolean = false;
	private _foundRootPorts: Map<number, CandidatePort & { ppid: number }> = new Map();

	private _providerHandleCounter: number = 0;
	private _portAttributesProviders: Map<number, { provider: vscode.PortAttributesProvider, selector: PortAttributesProviderSelector }> = new Map();

	constructor(
		@IExtHostRpcService extHostRpc: IExtHostRpcService,
		@IExtHostInitDataService initData: IExtHostInitDataService,
		@ILogService private readonly logService: ILogService
	) {
		super();
		this._proxy = extHostRpc.getProxy(MainContext.MainThreadTunnelService);
		if (isLinux && initData.remote.isRemote && initData.remote.authority) {
			this._proxy.$setRemoteTunnelService(process.pid);
		}
	}

	async openTunnel(extension: IExtensionDescription, forward: TunnelOptions): Promise<vscode.Tunnel | undefined> {
		this.logService.trace(`ForwardedPorts: (ExtHostTunnelService) ${extension.identifier.value} called openTunnel API for ${forward.remoteAddress.host}:${forward.remoteAddress.port}.`);
		const tunnel = await this._proxy.$openTunnel(forward, extension.displayName);
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

	private calculateDelay(movingAverage: number) {
		// Some local testing indicated that the moving average might be between 50-100 ms.
		return Math.max(movingAverage * 20, 2000);
	}

	private nextPortAttributesProviderHandle(): number {
		return this._providerHandleCounter++;
	}

	registerPortsAttributesProvider(portSelector: PortAttributesProviderSelector, provider: vscode.PortAttributesProvider): vscode.Disposable {
		const providerHandle = this.nextPortAttributesProviderHandle();
		this._portAttributesProviders.set(providerHandle, { selector: portSelector, provider });

		this._proxy.$registerPortsAttributesProvider(portSelector, providerHandle);
		return new types.Disposable(() => {
			this._portAttributesProviders.delete(providerHandle);
			this._proxy.$unregisterPortsAttributesProvider(providerHandle);
		});
	}

	async $providePortAttributes(handles: number[], ports: number[], pid: number | undefined, commandline: string | undefined, cancellationToken: vscode.CancellationToken): Promise<ProvidedPortAttributes[]> {
		const providedAttributes: vscode.ProviderResult<vscode.PortAttributes>[] = [];
		for (const handle of handles) {
			const provider = this._portAttributesProviders.get(handle);
			if (!provider) {
				return [];
			}
			providedAttributes.push(...(await Promise.all(ports.map(async (port) => {
				return provider.provider.providePortAttributes(port, pid, commandline, cancellationToken);
			}))));
		}

		const allAttributes = <vscode.PortAttributes[]>providedAttributes.filter(attribute => !!attribute);

		return (allAttributes.length > 0) ? allAttributes.map(attributes => {
			return {
				autoForwardAction: <ProvidedOnAutoForward><unknown>attributes.autoForwardAction,
				port: attributes.port
			};
		}) : [];
	}

	async $registerCandidateFinder(enable: boolean): Promise<void> {
		if (enable && this._candidateFindingEnabled) {
			// already enabled
			return;
		}
		this._candidateFindingEnabled = enable;
		// Regularly scan to see if the candidate ports have changed.
		let movingAverage = new MovingAverage();
		let oldPorts: { host: string, port: number, detail?: string }[] | undefined = undefined;
		while (this._candidateFindingEnabled) {
			const startTime = new Date().getTime();
			const newPorts = await this.findCandidatePorts();
			this.logService.trace(`ForwardedPorts: (ExtHostTunnelService) found candidate ports ${newPorts.map(port => port.port).join(', ')}`);
			const timeTaken = new Date().getTime() - startTime;
			movingAverage.update(timeTaken);
			if (!oldPorts || (JSON.stringify(oldPorts) !== JSON.stringify(newPorts))) {
				oldPorts = newPorts;
				await this._proxy.$onFoundNewCandidates(oldPorts);
			}
			await (new Promise<void>(resolve => setTimeout(() => resolve(), this.calculateDelay(movingAverage.value))));
		}
	}

	async setTunnelExtensionFunctions(provider: vscode.RemoteAuthorityResolver | undefined): Promise<IDisposable> {
		// Do not wait for any of the proxy promises here.
		// It will delay startup and there is nothing that needs to be waited for.
		if (provider) {
			if (provider.candidatePortSource !== undefined) {
				this._proxy.$setCandidatePortSource(provider.candidatePortSource);
			}
			if (provider.showCandidatePort) {
				this._showCandidatePort = provider.showCandidatePort;
				this._proxy.$setCandidateFilter();
			}
			if (provider.tunnelFactory) {
				this._forwardPortProvider = provider.tunnelFactory;
				this._proxy.$setTunnelProvider(provider.tunnelFeatures ?? {
					elevation: false,
					public: false
				});
			}
		} else {
			this._forwardPortProvider = undefined;
		}
		return toDisposable(() => {
			this._forwardPortProvider = undefined;
		});
	}

	async $closeTunnel(remote: { host: string, port: number }, silent?: boolean): Promise<void> {
		if (this._extensionTunnels.has(remote.host)) {
			const hostMap = this._extensionTunnels.get(remote.host)!;
			if (hostMap.has(remote.port)) {
				if (silent) {
					hostMap.get(remote.port)!.disposeListener.dispose();
				}
				await hostMap.get(remote.port)!.tunnel.dispose();
				hostMap.delete(remote.port);
			}
		}
	}

	async $onDidTunnelsChange(): Promise<void> {
		this._onDidChangeTunnels.fire();
	}

	async $forwardPort(tunnelOptions: TunnelOptions, tunnelCreationOptions: TunnelCreationOptions): Promise<TunnelDto | undefined> {
		if (this._forwardPortProvider) {
			try {
				this.logService.trace('ForwardedPorts: (ExtHostTunnelService) Getting tunnel from provider.');
				const providedPort = this._forwardPortProvider(tunnelOptions, tunnelCreationOptions);
				this.logService.trace('ForwardedPorts: (ExtHostTunnelService) Got tunnel promise from provider.');
				if (providedPort !== undefined) {
					const tunnel = await providedPort;
					this.logService.trace('ForwardedPorts: (ExtHostTunnelService) Successfully awaited tunnel from provider.');
					if (!this._extensionTunnels.has(tunnelOptions.remoteAddress.host)) {
						this._extensionTunnels.set(tunnelOptions.remoteAddress.host, new Map());
					}
					const disposeListener = this._register(tunnel.onDidDispose(() => {
						this.logService.trace('ForwardedPorts: (ExtHostTunnelService) Extension fired tunnel\'s onDidDispose.');
						return this._proxy.$closeTunnel(tunnel.remoteAddress);
					}));
					this._extensionTunnels.get(tunnelOptions.remoteAddress.host)!.set(tunnelOptions.remoteAddress.port, { tunnel, disposeListener });
					return TunnelDto.fromApiTunnel(tunnel);
				} else {
					this.logService.trace('ForwardedPorts: (ExtHostTunnelService) Tunnel is undefined');
				}
			} catch (e) {
				this.logService.trace('ForwardedPorts: (ExtHostTunnelService) tunnel provider error');
			}
		}
		return undefined;
	}

	async $applyCandidateFilter(candidates: CandidatePort[]): Promise<CandidatePort[]> {
		const filter = await Promise.all(candidates.map(candidate => this._showCandidatePort(candidate.host, candidate.port, candidate.detail ?? '')));
		const result = candidates.filter((candidate, index) => filter[index]);
		this.logService.trace(`ForwardedPorts: (ExtHostTunnelService) filtered from ${candidates.map(port => port.port).join(', ')} to ${result.map(port => port.port).join(', ')}`);
		return result;
	}

	async findCandidatePorts(): Promise<CandidatePort[]> {
		let tcp: string = '';
		let tcp6: string = '';
		try {
			tcp = await fs.promises.readFile('/proc/net/tcp', 'utf8');
			tcp6 = await fs.promises.readFile('/proc/net/tcp6', 'utf8');
		} catch (e) {
			// File reading error. No additional handling needed.
		}
		const connections: { socket: number, ip: string, port: number }[] = loadListeningPorts(tcp, tcp6);

		const procSockets: string = await (new Promise(resolve => {
			exec('ls -l /proc/[0-9]*/fd/[0-9]* | grep socket:', (error, stdout, stderr) => {
				resolve(stdout);
			});
		}));
		const socketMap = getSockets(procSockets);

		const procChildren = await pfs.readdir('/proc');
		const processes: {
			pid: number, cwd: string, cmd: string
		}[] = [];
		for (let childName of procChildren) {
			try {
				const pid: number = Number(childName);
				const childUri = resources.joinPath(URI.file('/proc'), childName);
				const childStat = await fs.promises.stat(childUri.fsPath);
				if (childStat.isDirectory() && !isNaN(pid)) {
					const cwd = await fs.promises.readlink(resources.joinPath(childUri, 'cwd').fsPath);
					const cmd = await fs.promises.readFile(resources.joinPath(childUri, 'cmdline').fsPath, 'utf8');
					processes.push({ pid, cwd, cmd });
				}
			} catch (e) {
				//
			}
		}

		const unFoundConnections: { socket: number, ip: string, port: number }[] = [];
		const filteredConnections = connections.filter((connection => {
			const foundConnection = socketMap[connection.socket];
			if (!foundConnection) {
				unFoundConnections.push(connection);
			}
			return foundConnection;
		}));

		const foundPorts = findPorts(filteredConnections, socketMap, processes);
		let heuristicPorts: CandidatePort[] | undefined;
		this.logService.trace(`ForwardedPorts: (ExtHostTunnelService) number of possible root ports ${unFoundConnections.length}`);
		if (unFoundConnections.length > 0) {
			const rootProcesses: string = await (new Promise(resolve => {
				exec('ps -F -A -l | grep root', (error, stdout, stderr) => {
					resolve(stdout);
				});
			}));
			this._foundRootPorts = tryFindRootPorts(unFoundConnections, rootProcesses, this._foundRootPorts);
			heuristicPorts = Array.from(this._foundRootPorts.values());
			this.logService.trace(`ForwardedPorts: (ExtHostTunnelService) heuristic ports ${heuristicPorts.join(', ')}`);

		}
		return foundPorts.then(foundCandidates => {
			if (heuristicPorts) {
				return foundCandidates.concat(heuristicPorts);
			} else {
				return foundCandidates;
			}
		});
	}
}
