/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IShellLaunchConfig, ITerminalChildProcess, ITerminalDimensions, ITerminalDimensionsOverride, ITerminalLaunchError, TerminalShellType } from 'vs/platform/terminal/common/terminal';
import { ITerminalService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { ITerminalProcessExtHostProxy } from 'vs/workbench/contrib/terminal/common/terminal';

export class TerminalProcessExtHostProxy extends Disposable implements ITerminalChildProcess, ITerminalProcessExtHostProxy {
	readonly id = 0;
	readonly shouldPersist = false;

	private readonly _onProcessData = this._register(new Emitter<string>());
	readonly onProcessData: Event<string> = this._onProcessData.event;
	private readonly _onProcessExit = this._register(new Emitter<number | undefined>());
	readonly onProcessExit: Event<number | undefined> = this._onProcessExit.event;
	private readonly _onProcessReady = this._register(new Emitter<{ pid: number, cwd: string }>());
	get onProcessReady(): Event<{ pid: number, cwd: string }> { return this._onProcessReady.event; }
	private readonly _onProcessTitleChanged = this._register(new Emitter<string>());
	readonly onProcessTitleChanged: Event<string> = this._onProcessTitleChanged.event;
	private readonly _onProcessOverrideDimensions = this._register(new Emitter<ITerminalDimensionsOverride | undefined>());
	get onProcessOverrideDimensions(): Event<ITerminalDimensionsOverride | undefined> { return this._onProcessOverrideDimensions.event; }
	private readonly _onProcessResolvedShellLaunchConfig = this._register(new Emitter<IShellLaunchConfig>());
	get onProcessResolvedShellLaunchConfig(): Event<IShellLaunchConfig> { return this._onProcessResolvedShellLaunchConfig.event; }

	private readonly _onStart = this._register(new Emitter<void>());
	readonly onStart: Event<void> = this._onStart.event;
	private readonly _onInput = this._register(new Emitter<string>());
	readonly onInput: Event<string> = this._onInput.event;
	private readonly _onBinary = this._register(new Emitter<string>());
	readonly onBinary: Event<string> = this._onBinary.event;
	private readonly _onResize: Emitter<{ cols: number, rows: number }> = this._register(new Emitter<{ cols: number, rows: number }>());
	readonly onResize: Event<{ cols: number, rows: number }> = this._onResize.event;
	private readonly _onAcknowledgeDataEvent = this._register(new Emitter<number>());
	readonly onAcknowledgeDataEvent: Event<number> = this._onAcknowledgeDataEvent.event;
	private readonly _onShutdown = this._register(new Emitter<boolean>());
	readonly onShutdown: Event<boolean> = this._onShutdown.event;
	private readonly _onRequestInitialCwd = this._register(new Emitter<void>());
	readonly onRequestInitialCwd: Event<void> = this._onRequestInitialCwd.event;
	private readonly _onRequestCwd = this._register(new Emitter<void>());
	readonly onRequestCwd: Event<void> = this._onRequestCwd.event;
	private readonly _onRequestLatency = this._register(new Emitter<void>());
	readonly onRequestLatency: Event<void> = this._onRequestLatency.event;
	private readonly _onProcessShellTypeChanged = this._register(new Emitter<TerminalShellType>());
	readonly onProcessShellTypeChanged = this._onProcessShellTypeChanged.event;


	private _pendingInitialCwdRequests: ((value: string | PromiseLike<string>) => void)[] = [];
	private _pendingCwdRequests: ((value: string | PromiseLike<string>) => void)[] = [];
	private _pendingLatencyRequests: ((value: number | PromiseLike<number>) => void)[] = [];

	constructor(
		public instanceId: number,
		private _cols: number,
		private _rows: number,
		@ITerminalService private readonly _terminalService: ITerminalService,
	) {
		super();
	}

	emitData(data: string): void {
		this._onProcessData.fire(data);
	}

	emitTitle(title: string): void {
		this._onProcessTitleChanged.fire(title);
	}

	emitReady(pid: number, cwd: string): void {
		this._onProcessReady.fire({ pid, cwd });
	}

	emitExit(exitCode: number | undefined): void {
		this._onProcessExit.fire(exitCode);
		this.dispose();
	}

	emitOverrideDimensions(dimensions: ITerminalDimensions | undefined): void {
		this._onProcessOverrideDimensions.fire(dimensions);
	}

	emitResolvedShellLaunchConfig(shellLaunchConfig: IShellLaunchConfig): void {
		this._onProcessResolvedShellLaunchConfig.fire(shellLaunchConfig);
	}

	emitInitialCwd(initialCwd: string): void {
		while (this._pendingInitialCwdRequests.length > 0) {
			this._pendingInitialCwdRequests.pop()!(initialCwd);
		}
	}

	emitCwd(cwd: string): void {
		while (this._pendingCwdRequests.length > 0) {
			this._pendingCwdRequests.pop()!(cwd);
		}
	}

	emitLatency(latency: number): void {
		while (this._pendingLatencyRequests.length > 0) {
			this._pendingLatencyRequests.pop()!(latency);
		}
	}

	async start(): Promise<ITerminalLaunchError | undefined> {
		return this._terminalService.requestStartExtensionTerminal(this, this._cols, this._rows);
	}

	shutdown(immediate: boolean): void {
		this._onShutdown.fire(immediate);
	}

	input(data: string): void {
		this._onInput.fire(data);
	}

	resize(cols: number, rows: number): void {
		this._onResize.fire({ cols, rows });
	}

	acknowledgeDataEvent(): void {
		// Flow control is disabled for extension terminals
	}

	async processBinary(data: string): Promise<void> {
		// Disabled for extension terminals
		this._onBinary.fire(data);
	}

	getInitialCwd(): Promise<string> {
		return new Promise<string>(resolve => {
			this._onRequestInitialCwd.fire();
			this._pendingInitialCwdRequests.push(resolve);
		});
	}

	getCwd(): Promise<string> {
		return new Promise<string>(resolve => {
			this._onRequestCwd.fire();
			this._pendingCwdRequests.push(resolve);
		});
	}

	getLatency(): Promise<number> {
		return new Promise<number>(resolve => {
			this._onRequestLatency.fire();
			this._pendingLatencyRequests.push(resolve);
		});
	}
}
