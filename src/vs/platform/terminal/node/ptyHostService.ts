/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { IPtyService, IProcessDataEvent, IShellLaunchConfig, ITerminalDimensionsOverride, ITerminalLaunchError, ITerminalsLayoutInfo, TerminalIpcChannels, IHeartbeatService, HeartbeatConstants, TerminalShellType, ITerminalProfile, IRequestResolveVariablesEvent, TitleEventSource, TerminalIcon, IReconnectConstants } from 'vs/platform/terminal/common/terminal';
import { Client } from 'vs/base/parts/ipc/node/ipc.cp';
import { FileAccess } from 'vs/base/common/network';
import { ProxyChannel } from 'vs/base/parts/ipc/common/ipc';
import { IProcessEnvironment, OperatingSystem } from 'vs/base/common/platform';
import { Emitter } from 'vs/base/common/event';
import { LogLevelChannelClient } from 'vs/platform/log/common/logIpc';
import { IGetTerminalLayoutInfoArgs, IProcessDetails, IPtyHostProcessReplayEvent, ISetTerminalLayoutInfoArgs } from 'vs/platform/terminal/common/terminalProcess';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { detectAvailableProfiles } from 'vs/platform/terminal/node/terminalProfiles';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { registerTerminalPlatformConfiguration } from 'vs/platform/terminal/common/terminalPlatformConfiguration';

enum Constants {
	MaxRestarts = 5
}

/**
 * Tracks the last terminal ID from the pty host so we can give it to the new pty host if it's
 * restarted and avoid ID conflicts.
 */
let lastPtyId = 0;

let lastResolveVariablesRequestId = 0;

/**
 * This service implements IPtyService by launching a pty host process, forwarding messages to and
 * from the pty host process and manages the connection.
 */
export class PtyHostService extends Disposable implements IPtyService {
	declare readonly _serviceBrand: undefined;

	private _client: Client;
	// ProxyChannel is not used here because events get lost when forwarding across multiple proxies
	private _proxy: IPtyService;

	private _restartCount = 0;
	private _isResponsive = true;
	private _isDisposed = false;

	private _heartbeatFirstTimeout?: NodeJS.Timeout;
	private _heartbeatSecondTimeout?: NodeJS.Timeout;

	private readonly _onPtyHostExit = this._register(new Emitter<number>());
	readonly onPtyHostExit = this._onPtyHostExit.event;
	private readonly _onPtyHostStart = this._register(new Emitter<void>());
	readonly onPtyHostStart = this._onPtyHostStart.event;
	private readonly _onPtyHostUnresponsive = this._register(new Emitter<void>());
	readonly onPtyHostUnresponsive = this._onPtyHostUnresponsive.event;
	private readonly _onPtyHostResponsive = this._register(new Emitter<void>());
	readonly onPtyHostResponsive = this._onPtyHostResponsive.event;
	private readonly _onPtyHostRequestResolveVariables = this._register(new Emitter<IRequestResolveVariablesEvent>());
	readonly onPtyHostRequestResolveVariables = this._onPtyHostRequestResolveVariables.event;

	private readonly _onProcessData = this._register(new Emitter<{ id: number, event: IProcessDataEvent | string }>());
	readonly onProcessData = this._onProcessData.event;
	private readonly _onProcessExit = this._register(new Emitter<{ id: number, event: number | undefined }>());
	readonly onProcessExit = this._onProcessExit.event;
	private readonly _onProcessReady = this._register(new Emitter<{ id: number, event: { pid: number, cwd: string } }>());
	readonly onProcessReady = this._onProcessReady.event;
	private readonly _onProcessReplay = this._register(new Emitter<{ id: number, event: IPtyHostProcessReplayEvent }>());
	readonly onProcessReplay = this._onProcessReplay.event;
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
	private readonly _onDidRequestDetach = this._register(new Emitter<{ workspaceId: string, instanceId: number }>());
	readonly onDidRequestDetach = this._onDidRequestDetach.event;

	constructor(
		private readonly _reconnectConstants: IReconnectConstants,
		@IConfigurationService private readonly _configurationService: IConfigurationService,
		@ILogService private readonly _logService: ILogService,
		@ITelemetryService private readonly _telemetryService: ITelemetryService
	) {
		super();

		// Platform configuration is required on the process running the pty host (shared process or
		// remote server).
		registerTerminalPlatformConfiguration();

		this._register(toDisposable(() => this._disposePtyHost()));

		[this._client, this._proxy] = this._startPtyHost();
	}

	private _startPtyHost(): [Client, IPtyService] {
		const client = new Client(
			FileAccess.asFileUri('bootstrap-fork', require).fsPath,
			{
				serverName: 'Pty Host',
				args: ['--type=ptyHost'],
				env: {
					VSCODE_LAST_PTY_ID: lastPtyId,
					VSCODE_AMD_ENTRYPOINT: 'vs/platform/terminal/node/ptyHostMain',
					VSCODE_PIPE_LOGGING: 'true',
					VSCODE_VERBOSE_LOGGING: 'true', // transmit console logs from server to client,
					VSCODE_RECONNECT_GRACE_TIME: this._reconnectConstants.GraceTime,
					VSCODE_RECONNECT_SHORT_GRACE_TIME: this._reconnectConstants.ShortGraceTime
				}
			}
		);
		this._onPtyHostStart.fire();

		// Setup heartbeat service and trigger a heartbeat immediately to reset the timeouts
		const heartbeatService = ProxyChannel.toService<IHeartbeatService>(client.getChannel(TerminalIpcChannels.Heartbeat));
		heartbeatService.onBeat(() => this._handleHeartbeat());
		this._handleHeartbeat();

		// Handle exit
		this._register(client.onDidProcessExit(e => {
			/* __GDPR__
				"ptyHost/exit" : {}
			*/
			this._telemetryService.publicLog('ptyHost/exit');
			this._onPtyHostExit.fire(e.code);
			if (!this._isDisposed) {
				if (this._restartCount <= Constants.MaxRestarts) {
					this._logService.error(`ptyHost terminated unexpectedly with code ${e.code}`);
					this._restartCount++;
					this.restartPtyHost();
				} else {
					this._logService.error(`ptyHost terminated unexpectedly with code ${e.code}, giving up`);
				}
			}
		}));

		// Setup logging
		const logChannel = client.getChannel(TerminalIpcChannels.Log);
		LogLevelChannelClient.setLevel(logChannel, this._logService.getLevel());
		this._register(this._logService.onDidChangeLogLevel(() => {
			LogLevelChannelClient.setLevel(logChannel, this._logService.getLevel());
		}));

		// Create proxy and forward events
		const proxy = ProxyChannel.toService<IPtyService>(client.getChannel(TerminalIpcChannels.PtyHost));
		this._register(proxy.onProcessData(e => this._onProcessData.fire(e)));
		this._register(proxy.onProcessExit(e => this._onProcessExit.fire(e)));
		this._register(proxy.onProcessReady(e => this._onProcessReady.fire(e)));
		this._register(proxy.onProcessTitleChanged(e => this._onProcessTitleChanged.fire(e)));
		this._register(proxy.onProcessShellTypeChanged(e => this._onProcessShellTypeChanged.fire(e)));
		this._register(proxy.onProcessOverrideDimensions(e => this._onProcessOverrideDimensions.fire(e)));
		this._register(proxy.onProcessResolvedShellLaunchConfig(e => this._onProcessResolvedShellLaunchConfig.fire(e)));
		this._register(proxy.onProcessReplay(e => this._onProcessReplay.fire(e)));
		this._register(proxy.onProcessOrphanQuestion(e => this._onProcessOrphanQuestion.fire(e)));
		this._register(proxy.onDidRequestDetach(e => this._onDidRequestDetach.fire(e)));

		return [client, proxy];
	}

	override dispose() {
		this._isDisposed = true;
		super.dispose();
	}

	async createProcess(shellLaunchConfig: IShellLaunchConfig, cwd: string, cols: number, rows: number, env: IProcessEnvironment, executableEnv: IProcessEnvironment, windowsEnableConpty: boolean, shouldPersist: boolean, workspaceId: string, workspaceName: string): Promise<number> {
		const timeout = setTimeout(() => this._handleUnresponsiveCreateProcess(), HeartbeatConstants.CreateProcessTimeout);
		const id = await this._proxy.createProcess(shellLaunchConfig, cwd, cols, rows, env, executableEnv, windowsEnableConpty, shouldPersist, workspaceId, workspaceName);
		clearTimeout(timeout);
		lastPtyId = Math.max(lastPtyId, id);
		return id;
	}
	updateTitle(id: number, title: string, titleSource: TitleEventSource): Promise<void> {
		return this._proxy.updateTitle(id, title, titleSource);
	}
	updateIcon(id: number, icon: TerminalIcon, color?: string): Promise<void> {
		return this._proxy.updateIcon(id, icon, color);
	}
	attachToProcess(id: number): Promise<void> {
		return this._proxy.attachToProcess(id);
	}
	detachFromProcess(id: number): Promise<void> {
		return this._proxy.detachFromProcess(id);
	}
	listProcesses(getDetachedInstance?: boolean): Promise<IProcessDetails[]> {
		return this._proxy.listProcesses(getDetachedInstance);
	}
	reduceConnectionGraceTime(): Promise<void> {
		return this._proxy.reduceConnectionGraceTime();
	}
	start(id: number): Promise<ITerminalLaunchError | undefined> {
		return this._proxy.start(id);
	}
	shutdown(id: number, immediate: boolean): Promise<void> {
		return this._proxy.shutdown(id, immediate);
	}
	input(id: number, data: string): Promise<void> {
		return this._proxy.input(id, data);
	}
	processBinary(id: number, data: string): Promise<void> {
		return this._proxy.processBinary(id, data);
	}
	resize(id: number, cols: number, rows: number): Promise<void> {
		return this._proxy.resize(id, cols, rows);
	}
	acknowledgeDataEvent(id: number, charCount: number): Promise<void> {
		return this._proxy.acknowledgeDataEvent(id, charCount);
	}
	getInitialCwd(id: number): Promise<string> {
		return this._proxy.getInitialCwd(id);
	}
	getCwd(id: number): Promise<string> {
		return this._proxy.getCwd(id);
	}
	getLatency(id: number): Promise<number> {
		return this._proxy.getLatency(id);
	}
	orphanQuestionReply(id: number): Promise<void> {
		return this._proxy.orphanQuestionReply(id);
	}

	getDefaultSystemShell(osOverride?: OperatingSystem): Promise<string> {
		return this._proxy.getDefaultSystemShell(osOverride);
	}
	async getProfiles(workspaceId: string, profiles: unknown, defaultProfile: unknown, includeDetectedProfiles: boolean = false): Promise<ITerminalProfile[]> {
		return detectAvailableProfiles(profiles, defaultProfile, includeDetectedProfiles, this._configurationService, undefined, this._logService, this._resolveVariables.bind(this, workspaceId));
	}
	getEnvironment(): Promise<IProcessEnvironment> {
		return this._proxy.getEnvironment();
	}
	getWslPath(original: string): Promise<string> {
		return this._proxy.getWslPath(original);
	}

	setTerminalLayoutInfo(args: ISetTerminalLayoutInfoArgs): Promise<void> {
		return this._proxy.setTerminalLayoutInfo(args);
	}
	async getTerminalLayoutInfo(args: IGetTerminalLayoutInfoArgs): Promise<ITerminalsLayoutInfo | undefined> {
		return await this._proxy.getTerminalLayoutInfo(args);
	}

	async requestDetachInstance(workspaceId: string, instanceId: number): Promise<void> {
		return this._proxy.requestDetachInstance(workspaceId, instanceId);
	}

	async acceptInstanceForAttachment(persistentProcessId: number): Promise<void> {
		return this._proxy.acceptInstanceForAttachment(persistentProcessId);
	}

	async restartPtyHost(): Promise<void> {
		/* __GDPR__
			"ptyHost/restart" : {}
		*/
		this._telemetryService.publicLog('ptyHost/restart');
		this._isResponsive = true;
		this._disposePtyHost();
		[this._client, this._proxy] = this._startPtyHost();
	}

	private _disposePtyHost(): void {
		if (this._proxy.shutdownAll) {
			this._proxy.shutdownAll();
		}
		this._client.dispose();
	}

	private _handleHeartbeat() {
		this._clearHeartbeatTimeouts();
		this._heartbeatFirstTimeout = setTimeout(() => this._handleHeartbeatFirstTimeout(), HeartbeatConstants.BeatInterval * HeartbeatConstants.FirstWaitMultiplier);
		if (!this._isResponsive) {
			/* __GDPR__
				"ptyHost/responsive" : {}
			*/
			this._telemetryService.publicLog('ptyHost/responsive');
			this._isResponsive = true;
		}
		this._onPtyHostResponsive.fire();
	}

	private _handleHeartbeatFirstTimeout() {
		this._logService.warn(`No ptyHost heartbeat after ${HeartbeatConstants.BeatInterval * HeartbeatConstants.FirstWaitMultiplier / 1000} seconds`);
		this._heartbeatFirstTimeout = undefined;
		this._heartbeatSecondTimeout = setTimeout(() => this._handleHeartbeatSecondTimeout(), HeartbeatConstants.BeatInterval * HeartbeatConstants.SecondWaitMultiplier);
	}

	private _handleHeartbeatSecondTimeout() {
		this._logService.error(`No ptyHost heartbeat after ${(HeartbeatConstants.BeatInterval * HeartbeatConstants.FirstWaitMultiplier + HeartbeatConstants.BeatInterval * HeartbeatConstants.FirstWaitMultiplier) / 1000} seconds`);
		this._heartbeatSecondTimeout = undefined;
		if (this._isResponsive) {
			/* __GDPR__
				"ptyHost/responsive" : {}
			*/
			this._telemetryService.publicLog('ptyHost/unresponsive');
			this._isResponsive = false;
		}
		this._onPtyHostUnresponsive.fire();
	}

	private _handleUnresponsiveCreateProcess() {
		this._clearHeartbeatTimeouts();
		this._logService.error(`No ptyHost response to createProcess after ${HeartbeatConstants.CreateProcessTimeout / 1000} seconds`);
		/* __GDPR__
			"ptyHost/responsive" : {}
		*/
		this._telemetryService.publicLog('ptyHost/responsive');
		this._onPtyHostUnresponsive.fire();
	}

	private _clearHeartbeatTimeouts() {
		if (this._heartbeatFirstTimeout) {
			clearTimeout(this._heartbeatFirstTimeout);
			this._heartbeatFirstTimeout = undefined;
		}
		if (this._heartbeatSecondTimeout) {
			clearTimeout(this._heartbeatSecondTimeout);
			this._heartbeatSecondTimeout = undefined;
		}
	}

	private _pendingResolveVariablesRequests: Map<number, (resolved: string[]) => void> = new Map();
	private _resolveVariables(workspaceId: string, text: string[]): Promise<string[]> {
		return new Promise<string[]>(resolve => {
			const id = ++lastResolveVariablesRequestId;
			this._pendingResolveVariablesRequests.set(id, resolve);
			this._onPtyHostRequestResolveVariables.fire({ id, workspaceId, originalText: text });
		});
	}
	async acceptPtyHostResolvedVariables(id: number, resolved: string[]) {
		const request = this._pendingResolveVariablesRequests.get(id);
		if (request) {
			request(resolved);
			this._pendingResolveVariablesRequests.delete(id);
		} else {
			this._logService.warn(`Resolved variables received without matching request ${id}`);
		}
	}
}
