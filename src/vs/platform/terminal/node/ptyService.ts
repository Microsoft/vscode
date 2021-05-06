/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { IProcessEnvironment, isWindows, OperatingSystem, OS } from 'vs/base/common/platform';
import { IPtyService, IProcessDataEvent, IShellLaunchConfig, ITerminalDimensionsOverride, ITerminalLaunchError, LocalReconnectConstants, ITerminalsLayoutInfo, IRawTerminalInstanceLayoutInfo, ITerminalTabLayoutInfoById, ITerminalInstanceLayoutInfoById, TerminalShellType } from 'vs/platform/terminal/common/terminal';
import { AutoOpenBarrier, Queue, RunOnceScheduler } from 'vs/base/common/async';
import { Emitter } from 'vs/base/common/event';
import { TerminalRecorder } from 'vs/platform/terminal/common/terminalRecorder';
import { TerminalProcess } from 'vs/platform/terminal/node/terminalProcess';
import { ISetTerminalLayoutInfoArgs, ITerminalTabLayoutInfoDto, IProcessDetails, IGetTerminalLayoutInfoArgs, IPtyHostProcessReplayEvent } from 'vs/platform/terminal/common/terminalProcess';
import { ILogService } from 'vs/platform/log/common/log';
import { TerminalDataBufferer } from 'vs/platform/terminal/common/terminalDataBuffering';
import { getSystemShell } from 'vs/base/node/shell';
import { getWindowsBuildNumber } from 'vs/platform/terminal/node/terminalEnvironment';
import { execFile } from 'child_process';
import { escapeNonWindowsPath } from 'vs/platform/terminal/common/terminalEnvironment';

type WorkspaceId = string;

export class PtyService extends Disposable implements IPtyService {
	declare readonly _serviceBrand: undefined;

	private readonly _ptys: Map<number, PersistentTerminalProcess> = new Map();
	private readonly _workspaceLayoutInfos = new Map<WorkspaceId, ISetTerminalLayoutInfoArgs>();

	private readonly _onHeartbeat = this._register(new Emitter<void>());
	readonly onHeartbeat = this._onHeartbeat.event;

	private readonly _onProcessData = this._register(new Emitter<{ id: number, event: IProcessDataEvent | string }>());
	readonly onProcessData = this._onProcessData.event;
	private readonly _onProcessReplay = this._register(new Emitter<{ id: number, event: IPtyHostProcessReplayEvent }>());
	readonly onProcessReplay = this._onProcessReplay.event;
	private readonly _onProcessExit = this._register(new Emitter<{ id: number, event: number | undefined }>());
	readonly onProcessExit = this._onProcessExit.event;
	private readonly _onProcessReady = this._register(new Emitter<{ id: number, event: { pid: number, cwd: string } }>());
	readonly onProcessReady = this._onProcessReady.event;
	private readonly _onProcessTitleChanged = this._register(new Emitter<{ id: number, event: string }>());
	readonly onProcessTitleChanged = this._onProcessTitleChanged.event;
	private readonly _onProcessShellTypeChanged = this._register(new Emitter<{ id: number, event: TerminalShellType }>());
	readonly onProcessShellTypeChanged = this._onProcessShellTypeChanged.event;
	private readonly _onProcessOverrideDimensions = this._register(new Emitter<{ id: number, event: ITerminalDimensionsOverride | undefined }>());
	readonly onProcessOverrideDimensions = this._onProcessOverrideDimensions.event;
	private readonly _onProcessResolvedShellLaunchConfig = this._register(new Emitter<{ id: number, event: IShellLaunchConfig }>());
	readonly onProcessResolvedShellLaunchConfig = this._onProcessResolvedShellLaunchConfig.event;
	private readonly _onProcessOrphanQuestion = this._register(new Emitter<{ id: number }>());
	readonly onProcessOrphanQuestion = this._onProcessOrphanQuestion.event;

	constructor(
		private _lastPtyId: number,
		private readonly _logService: ILogService
	) {
		super();

		this._register(toDisposable(() => {
			for (const pty of this._ptys.values()) {
				pty.shutdown(true);
			}
			this._ptys.clear();
		}));
	}

	async shutdownAll(): Promise<void> {
		this.dispose();
	}

	async createProcess(
		shellLaunchConfig: IShellLaunchConfig,
		cwd: string,
		cols: number,
		rows: number,
		env: IProcessEnvironment,
		executableEnv: IProcessEnvironment,
		windowsEnableConpty: boolean,
		shouldPersist: boolean,
		workspaceId: string,
		workspaceName: string
	): Promise<number> {
		if (shellLaunchConfig.attachPersistentProcess) {
			throw new Error('Attempt to create a process when attach object was provided');
		}
		const id = ++this._lastPtyId;
		const process = new TerminalProcess(shellLaunchConfig, cwd, cols, rows, env, executableEnv, windowsEnableConpty, this._logService);
		process.onProcessData(event => this._onProcessData.fire({ id, event }));
		process.onProcessExit(event => this._onProcessExit.fire({ id, event }));
		if (process.onProcessOverrideDimensions) {
			process.onProcessOverrideDimensions(event => this._onProcessOverrideDimensions.fire({ id, event }));
		}
		if (process.onProcessResolvedShellLaunchConfig) {
			process.onProcessResolvedShellLaunchConfig(event => this._onProcessResolvedShellLaunchConfig.fire({ id, event }));
		}
		const persistentProcess = new PersistentTerminalProcess(id, process, workspaceId, workspaceName, shouldPersist, cols, rows, this._logService, shellLaunchConfig.icon);
		process.onProcessExit(() => {
			persistentProcess.dispose();
			this._ptys.delete(id);
		});
		persistentProcess.onProcessReplay(event => this._onProcessReplay.fire({ id, event }));
		persistentProcess.onProcessReady(event => this._onProcessReady.fire({ id, event }));
		persistentProcess.onProcessTitleChanged(event => this._onProcessTitleChanged.fire({ id, event }));
		persistentProcess.onProcessShellTypeChanged(event => this._onProcessShellTypeChanged.fire({ id, event }));
		persistentProcess.onProcessOrphanQuestion(() => this._onProcessOrphanQuestion.fire({ id }));
		this._ptys.set(id, persistentProcess);
		return id;
	}

	async attachToProcess(id: number): Promise<void> {
		try {
			this._throwIfNoPty(id).attach();
			this._logService.trace(`Persistent process reconnection "${id}"`);
		} catch (e) {
			this._logService.trace(`Persistent process reconnection "${id}" failed`, e.message);
		}
	}

	async updateTitle(id: number, title: string): Promise<void> {
		this._throwIfNoPty(id).setTitle(title);
	}

	async updateIcon(id: number, icon: string): Promise<void> {
		this._throwIfNoPty(id).setIcon(icon);
	}

	async detachFromProcess(id: number): Promise<void> {
		this._throwIfNoPty(id).detach();
	}

	async reduceConnectionGraceTime(): Promise<void> {
		for (const pty of this._ptys.values()) {
			pty.reduceGraceTime();
		}
	}

	async listProcesses(): Promise<IProcessDetails[]> {
		const persistentProcesses = Array.from(this._ptys.entries()).filter(([_, pty]) => pty.shouldPersistTerminal);

		this._logService.info(`Listing ${persistentProcesses.length} persistent terminals, ${this._ptys.size} total terminals`);
		const promises = persistentProcesses.map(async ([id, terminalProcessData]) => this._buildProcessDetails(id, terminalProcessData));
		const allTerminals = await Promise.all(promises);
		return allTerminals.filter(entry => entry.isOrphan);
	}

	async start(id: number): Promise<ITerminalLaunchError | undefined> {
		return this._throwIfNoPty(id).start();
	}
	async shutdown(id: number, immediate: boolean): Promise<void> {
		// Don't throw if the pty is already shutdown
		return this._ptys.get(id)?.shutdown(immediate);
	}
	async input(id: number, data: string): Promise<void> {
		return this._throwIfNoPty(id).input(data);
	}
	async processBinary(id: number, data: string): Promise<void> {
		return this._throwIfNoPty(id).writeBinary(data);
	}
	async resize(id: number, cols: number, rows: number): Promise<void> {
		return this._throwIfNoPty(id).resize(cols, rows);
	}
	async getInitialCwd(id: number): Promise<string> {
		return this._throwIfNoPty(id).getInitialCwd();
	}
	async getCwd(id: number): Promise<string> {
		return this._throwIfNoPty(id).getCwd();
	}
	async acknowledgeDataEvent(id: number, charCount: number): Promise<void> {
		return this._throwIfNoPty(id).acknowledgeDataEvent(charCount);
	}
	async getLatency(id: number): Promise<number> {
		return 0;
	}
	async orphanQuestionReply(id: number): Promise<void> {
		return this._throwIfNoPty(id).orphanQuestionReply();
	}

	async getDefaultSystemShell(osOverride: OperatingSystem = OS): Promise<string> {
		return getSystemShell(osOverride, process.env);
	}

	async getEnvironment(): Promise<IProcessEnvironment> {
		return { ...process.env };
	}

	async getWslPath(original: string): Promise<string> {
		if (!isWindows) {
			return original;
		}
		if (getWindowsBuildNumber() < 17063) {
			return original.replace(/\\/g, '/');
		}
		return new Promise<string>(c => {
			const proc = execFile('bash.exe', ['-c', `wslpath ${escapeNonWindowsPath(original)}`], {}, (error, stdout, stderr) => {
				c(escapeNonWindowsPath(stdout.trim()));
			});
			proc.stdin!.end();
		});
	}

	async setTerminalLayoutInfo(args: ISetTerminalLayoutInfoArgs): Promise<void> {
		this._workspaceLayoutInfos.set(args.workspaceId, args);
	}

	async getTerminalLayoutInfo(args: IGetTerminalLayoutInfoArgs): Promise<ITerminalsLayoutInfo | undefined> {
		const layout = this._workspaceLayoutInfos.get(args.workspaceId);
		if (layout) {
			const expandedTabs = await Promise.all(layout.tabs.map(async tab => this._expandTerminalTab(tab)));
			const filtered = expandedTabs.filter(t => t.terminals.length > 0);
			return {
				tabs: filtered
			};
		}
		return undefined;
	}

	private async _expandTerminalTab(tab: ITerminalTabLayoutInfoById): Promise<ITerminalTabLayoutInfoDto> {
		const expandedTerminals = (await Promise.all(tab.terminals.map(t => this._expandTerminalInstance(t))));
		const filtered = expandedTerminals.filter(term => term.terminal !== null) as IRawTerminalInstanceLayoutInfo<IProcessDetails>[];
		return {
			isActive: tab.isActive,
			activePersistentProcessId: tab.activePersistentProcessId,
			terminals: filtered
		};
	}

	private async _expandTerminalInstance(t: ITerminalInstanceLayoutInfoById): Promise<IRawTerminalInstanceLayoutInfo<IProcessDetails | null>> {
		try {
			const persistentProcess = this._throwIfNoPty(t.terminal);
			const processDetails = persistentProcess && await this._buildProcessDetails(t.terminal, persistentProcess);
			return {
				terminal: processDetails ?? null,
				relativeSize: t.relativeSize
			};
		} catch (e) {
			this._logService.trace(`Couldn't get layout info, a terminal was probably disconnected`, e.message);
			// this will be filtered out and not reconnected
			return {
				terminal: null,
				relativeSize: t.relativeSize
			};
		}
	}

	private async _buildProcessDetails(id: number, persistentProcess: PersistentTerminalProcess): Promise<IProcessDetails> {
		const [cwd, isOrphan] = await Promise.all([persistentProcess.getCwd(), persistentProcess.isOrphaned()]);
		return {
			id,
			title: persistentProcess.title,
			pid: persistentProcess.pid,
			workspaceId: persistentProcess.workspaceId,
			workspaceName: persistentProcess.workspaceName,
			cwd,
			isOrphan,
			icon: persistentProcess.icon
		};
	}

	private _throwIfNoPty(id: number): PersistentTerminalProcess {
		const pty = this._ptys.get(id);
		if (!pty) {
			throw new Error(`Could not find pty with id "${id}"`);
		}
		return pty;
	}
}

export class PersistentTerminalProcess extends Disposable {

	private readonly _bufferer: TerminalDataBufferer;

	private readonly _pendingCommands = new Map<number, { resolve: (data: any) => void; reject: (err: any) => void; }>();

	private readonly _recorder: TerminalRecorder;
	private _isStarted: boolean = false;

	private _orphanQuestionBarrier: AutoOpenBarrier | null;
	private _orphanQuestionReplyTime: number;
	private _orphanRequestQueue = new Queue<boolean>();
	private _disconnectRunner1: RunOnceScheduler;
	private _disconnectRunner2: RunOnceScheduler;

	private readonly _onProcessReplay = this._register(new Emitter<IPtyHostProcessReplayEvent>());
	readonly onProcessReplay = this._onProcessReplay.event;
	private readonly _onProcessReady = this._register(new Emitter<{ pid: number, cwd: string }>());
	readonly onProcessReady = this._onProcessReady.event;
	private readonly _onProcessTitleChanged = this._register(new Emitter<string>());
	readonly onProcessTitleChanged = this._onProcessTitleChanged.event;
	private readonly _onProcessShellTypeChanged = this._register(new Emitter<TerminalShellType>());
	readonly onProcessShellTypeChanged = this._onProcessShellTypeChanged.event;
	private readonly _onProcessOverrideDimensions = this._register(new Emitter<ITerminalDimensionsOverride | undefined>());
	readonly onProcessOverrideDimensions = this._onProcessOverrideDimensions.event;
	private readonly _onProcessData = this._register(new Emitter<string>());
	readonly onProcessData = this._onProcessData.event;
	private readonly _onProcessOrphanQuestion = this._register(new Emitter<void>());
	readonly onProcessOrphanQuestion = this._onProcessOrphanQuestion.event;

	private _inReplay = false;

	private _pid = -1;
	private _cwd = '';
	private _title: string | undefined;


	get pid(): number { return this._pid; }
	get title(): string { return this._title || this._terminalProcess.currentTitle; }
	get icon(): string | undefined { return this._icon; }

	setTitle(title: string): void {
		this._title = title;
	}

	setIcon(icon: string): void {
		this._icon = icon;
	}

	constructor(
		private _persistentProcessId: number,
		private readonly _terminalProcess: TerminalProcess,
		readonly workspaceId: string,
		readonly workspaceName: string,
		readonly shouldPersistTerminal: boolean,
		cols: number, rows: number,
		private readonly _logService: ILogService,
		private _icon?: string
	) {
		super();
		this._recorder = new TerminalRecorder(cols, rows);
		this._orphanQuestionBarrier = null;
		this._orphanQuestionReplyTime = 0;
		this._disconnectRunner1 = this._register(new RunOnceScheduler(() => {
			this._logService.info(`Persistent process "${this._persistentProcessId}": The reconnection grace time of ${printTime(LocalReconnectConstants.ReconnectionGraceTime)} has expired, shutting down pid "${this._pid}"`);
			this.shutdown(true);
		}, LocalReconnectConstants.ReconnectionGraceTime));
		this._disconnectRunner2 = this._register(new RunOnceScheduler(() => {
			this._logService.info(`Persistent process "${this._persistentProcessId}": The short reconnection grace time of ${printTime(LocalReconnectConstants.ReconnectionShortGraceTime)} has expired, shutting down pid ${this._pid}`);
			this.shutdown(true);
		}, LocalReconnectConstants.ReconnectionShortGraceTime));

		this._register(this._terminalProcess.onProcessReady(e => {
			this._pid = e.pid;
			this._cwd = e.cwd;
			this._onProcessReady.fire(e);
		}));
		this._register(this._terminalProcess.onProcessTitleChanged(e => this._onProcessTitleChanged.fire(e)));
		this._register(this._terminalProcess.onProcessShellTypeChanged(e => this._onProcessShellTypeChanged.fire(e)));

		// Data buffering to reduce the amount of messages going to the renderer
		this._bufferer = new TerminalDataBufferer((_, data) => this._onProcessData.fire(data));
		this._register(this._bufferer.startBuffering(this._persistentProcessId, this._terminalProcess.onProcessData));
		this._register(this._terminalProcess.onProcessExit(() => this._bufferer.stopBuffering(this._persistentProcessId)));

		// Data recording for reconnect
		this._register(this.onProcessData(e => this._recorder.recordData(e)));
	}

	attach(): void {
		this._disconnectRunner1.cancel();
	}

	async detach(): Promise<void> {
		if (this.shouldPersistTerminal) {
			this._disconnectRunner1.schedule();
		} else {
			this.shutdown(true);
		}
	}

	async start(): Promise<ITerminalLaunchError | undefined> {
		if (!this._isStarted) {
			const result = await this._terminalProcess.start();
			if (result) {
				// it's a terminal launch error
				return result;
			}
			this._isStarted = true;
		} else {
			this._onProcessReady.fire({ pid: this._pid, cwd: this._cwd });
			this._onProcessTitleChanged.fire(this._terminalProcess.currentTitle);
			this._onProcessShellTypeChanged.fire(this._terminalProcess.shellType);
			this.triggerReplay();
		}
		return undefined;
	}
	shutdown(immediate: boolean): void {
		return this._terminalProcess.shutdown(immediate);
	}
	input(data: string): void {
		if (this._inReplay) {
			return;
		}
		return this._terminalProcess.input(data);
	}
	writeBinary(data: string): Promise<void> {
		return this._terminalProcess.processBinary(data);
	}
	resize(cols: number, rows: number): void {
		if (this._inReplay) {
			return;
		}
		this._recorder.recordResize(cols, rows);

		// Buffered events should flush when a resize occurs
		this._bufferer.flushBuffer(this._persistentProcessId);
		return this._terminalProcess.resize(cols, rows);
	}
	acknowledgeDataEvent(charCount: number): void {
		if (this._inReplay) {
			return;
		}
		return this._terminalProcess.acknowledgeDataEvent(charCount);
	}
	getInitialCwd(): Promise<string> {
		return this._terminalProcess.getInitialCwd();
	}
	getCwd(): Promise<string> {
		return this._terminalProcess.getCwd();
	}
	getLatency(): Promise<number> {
		return this._terminalProcess.getLatency();
	}

	triggerReplay(): void {
		const ev = this._recorder.generateReplayEvent();
		let dataLength = 0;
		for (const e of ev.events) {
			dataLength += e.data.length;
		}

		this._logService.info(`Persistent process "${this._persistentProcessId}": Replaying ${dataLength} chars and ${ev.events.length} size events`);
		this._onProcessReplay.fire(ev);
		this._terminalProcess.clearUnacknowledgedChars();
	}

	sendCommandResult(reqId: number, isError: boolean, serializedPayload: any): void {
		const data = this._pendingCommands.get(reqId);
		if (!data) {
			return;
		}
		this._pendingCommands.delete(reqId);
	}

	orphanQuestionReply(): void {
		this._orphanQuestionReplyTime = Date.now();
		if (this._orphanQuestionBarrier) {
			const barrier = this._orphanQuestionBarrier;
			this._orphanQuestionBarrier = null;
			barrier.open();
		}
	}

	reduceGraceTime(): void {
		if (this._disconnectRunner2.isScheduled()) {
			// we are disconnected and already running the short reconnection timer
			return;
		}
		if (this._disconnectRunner1.isScheduled()) {
			// we are disconnected and running the long reconnection timer
			this._disconnectRunner2.schedule();
		}
	}

	async isOrphaned(): Promise<boolean> {
		return await this._orphanRequestQueue.queue(async () => this._isOrphaned());
	}

	private async _isOrphaned(): Promise<boolean> {
		// The process is already known to be orphaned
		if (this._disconnectRunner1.isScheduled() || this._disconnectRunner2.isScheduled()) {
			return true;
		}

		// Ask whether the renderer(s) whether the process is orphaned and await the reply
		if (!this._orphanQuestionBarrier) {
			// the barrier opens after 4 seconds with or without a reply
			this._orphanQuestionBarrier = new AutoOpenBarrier(4000);
			this._orphanQuestionReplyTime = 0;
			this._onProcessOrphanQuestion.fire();
		}

		await this._orphanQuestionBarrier.wait();
		return (Date.now() - this._orphanQuestionReplyTime > 500);
	}
}

function printTime(ms: number): string {
	let h = 0;
	let m = 0;
	let s = 0;
	if (ms >= 1000) {
		s = Math.floor(ms / 1000);
		ms -= s * 1000;
	}
	if (s >= 60) {
		m = Math.floor(s / 60);
		s -= m * 60;
	}
	if (m >= 60) {
		h = Math.floor(m / 60);
		m -= h * 60;
	}
	const _h = h ? `${h}h` : ``;
	const _m = m ? `${m}m` : ``;
	const _s = s ? `${s}s` : ``;
	const _ms = ms ? `${ms}ms` : ``;
	return `${_h}${_m}${_s}${_ms}`;
}
