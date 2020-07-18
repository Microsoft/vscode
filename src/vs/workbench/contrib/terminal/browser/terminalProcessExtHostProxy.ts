/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, Emitter } from 'vs/base/common/event';
import { ITerminalProcessExtHostProxy, IShellLaunchConfig, ITerminalChildProcess, ITerminalConfigHelper, ITerminalDimensions, ITerminalLaunchError } from 'vs/workbench/contrib/terminal/common/terminal';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import * as nls from 'vs/nls';
import { ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';

let hasReceivedResponseFromRemoteExtHost: boolean = false;

export class TerminalProcessExtHostProxy extends Disposable implements ITerminalChildProcess, ITerminalProcessExtHostProxy {

	private readonly _onProcessData = this._register(new Emitter<string>());
	public readonly onProcessData: Event<string> = this._onProcessData.event;
	private readonly _onProcessExit = this._register(new Emitter<number | undefined>());
	public readonly onProcessExit: Event<number | undefined> = this._onProcessExit.event;
	private readonly _onProcessReady = this._register(new Emitter<{ pid: number, cwd: string }>());
	public get onProcessReady(): Event<{ pid: number, cwd: string }> { return this._onProcessReady.event; }
	private readonly _onProcessTitleChanged = this._register(new Emitter<string>());
	public readonly onProcessTitleChanged: Event<string> = this._onProcessTitleChanged.event;
	private readonly _onProcessOverrideDimensions = this._register(new Emitter<ITerminalDimensions | undefined>());
	public get onProcessOverrideDimensions(): Event<ITerminalDimensions | undefined> { return this._onProcessOverrideDimensions.event; }
	private readonly _onProcessResolvedShellLaunchConfig = this._register(new Emitter<IShellLaunchConfig>());
	public get onProcessResolvedShellLaunchConfig(): Event<IShellLaunchConfig> { return this._onProcessResolvedShellLaunchConfig.event; }

	private readonly _onStart = this._register(new Emitter<void>());
	public readonly onStart: Event<void> = this._onStart.event;
	private readonly _onInput = this._register(new Emitter<string>());
	public readonly onInput: Event<string> = this._onInput.event;
	private readonly _onResize: Emitter<{ cols: number, rows: number }> = this._register(new Emitter<{ cols: number, rows: number }>());
	public readonly onResize: Event<{ cols: number, rows: number }> = this._onResize.event;
	private readonly _onShutdown = this._register(new Emitter<boolean>());
	public readonly onShutdown: Event<boolean> = this._onShutdown.event;
	private readonly _onRequestInitialCwd = this._register(new Emitter<void>());
	public readonly onRequestInitialCwd: Event<void> = this._onRequestInitialCwd.event;
	private readonly _onRequestCwd = this._register(new Emitter<void>());
	public readonly onRequestCwd: Event<void> = this._onRequestCwd.event;
	private readonly _onRequestLatency = this._register(new Emitter<void>());
	public readonly onRequestLatency: Event<void> = this._onRequestLatency.event;

	private _pendingInitialCwdRequests: ((value?: string | Thenable<string>) => void)[] = [];
	private _pendingCwdRequests: ((value?: string | Thenable<string>) => void)[] = [];
	private _pendingLatencyRequests: ((value?: number | Thenable<number>) => void)[] = [];

	constructor(
		public terminalId: number,
		private _shellLaunchConfig: IShellLaunchConfig,
		private _activeWorkspaceRootUri: URI | undefined,
		private _cols: number,
		private _rows: number,
		private _configHelper: ITerminalConfigHelper,
		@ITerminalService private readonly _terminalService: ITerminalService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService
	) {
		super();
	}

	public emitData(data: string): void {
		this._onProcessData.fire(data);
	}

	public emitTitle(title: string): void {
		hasReceivedResponseFromRemoteExtHost = true;
		this._onProcessTitleChanged.fire(title);
	}

	public emitReady(pid: number, cwd: string): void {
		this._onProcessReady.fire({ pid, cwd });
	}

	public emitExit(exitCode: number | undefined): void {
		this._onProcessExit.fire(exitCode);
		this.dispose();
	}

	public emitOverrideDimensions(dimensions: ITerminalDimensions | undefined): void {
		this._onProcessOverrideDimensions.fire(dimensions);
	}

	public emitResolvedShellLaunchConfig(shellLaunchConfig: IShellLaunchConfig): void {
		this._onProcessResolvedShellLaunchConfig.fire(shellLaunchConfig);
	}

	public emitInitialCwd(initialCwd: string): void {
		while (this._pendingInitialCwdRequests.length > 0) {
			this._pendingInitialCwdRequests.pop()!(initialCwd);
		}
	}

	public emitCwd(cwd: string): void {
		while (this._pendingCwdRequests.length > 0) {
			this._pendingCwdRequests.pop()!(cwd);
		}
	}

	public emitLatency(latency: number): void {
		while (this._pendingLatencyRequests.length > 0) {
			this._pendingLatencyRequests.pop()!(latency);
		}
	}

	public async start(): Promise<ITerminalLaunchError | undefined> {
		// Request a process if needed, if this is a virtual process this step can be skipped as
		// there is no real "process" and we know it's ready on the ext host already.
		if (this._shellLaunchConfig.isExtensionTerminal) {
			return this._terminalService.requestStartExtensionTerminal(this, this._cols, this._rows);
		}

		// Add a loading title if the extension host has not started yet as there could be a
		// decent wait for the user
		if (!hasReceivedResponseFromRemoteExtHost) {
			setTimeout(() => this._onProcessTitleChanged.fire(nls.localize('terminal.integrated.starting', "Starting...")), 0);
		}

		// Fetch the environment to check shell permissions
		const env = await this._remoteAgentService.getEnvironment();
		if (!env) {
			// Extension host processes are only allowed in remote extension hosts currently
			throw new Error('Could not fetch remote environment');
		}

		return this._terminalService.requestSpawnExtHostProcess(this, this._shellLaunchConfig, this._activeWorkspaceRootUri, this._cols, this._rows, this._configHelper.checkWorkspaceShellPermissions(env.os));
	}

	public shutdown(immediate: boolean): void {
		this._onShutdown.fire(immediate);
	}

	public input(data: string): void {
		this._onInput.fire(data);
	}

	public resize(cols: number, rows: number): void {
		this._onResize.fire({ cols, rows });
	}

	public getInitialCwd(): Promise<string> {
		return new Promise<string>(resolve => {
			this._onRequestInitialCwd.fire();
			this._pendingInitialCwdRequests.push(resolve);
		});
	}

	public getCwd(): Promise<string> {
		return new Promise<string>(resolve => {
			this._onRequestCwd.fire();
			this._pendingCwdRequests.push(resolve);
		});
	}

	public getLatency(): Promise<number> {
		return new Promise<number>(resolve => {
			this._onRequestLatency.fire();
			this._pendingLatencyRequests.push(resolve);
		});
	}
}
