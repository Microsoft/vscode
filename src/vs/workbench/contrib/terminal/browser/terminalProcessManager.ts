/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as platform from 'vs/base/common/platform';
import * as terminalEnvironment from 'vs/workbench/contrib/terminal/common/terminalEnvironment';
import { env as processEnv } from 'vs/base/common/process';
import { ProcessState, ITerminalProcessManager, IShellLaunchConfig, ITerminalConfigHelper, ITerminalChildProcess, IBeforeProcessDataEvent, ITerminalEnvironment, ITerminalDimensions, ITerminalLaunchError } from 'vs/workbench/contrib/terminal/common/terminal';
import { ILogService } from 'vs/platform/log/common/log';
import { Emitter, Event } from 'vs/base/common/event';
import { IHistoryService } from 'vs/workbench/services/history/common/history';
import { TerminalProcessExtHostProxy } from 'vs/workbench/contrib/terminal/browser/terminalProcessExtHostProxy';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IConfigurationResolverService } from 'vs/workbench/services/configurationResolver/common/configurationResolver';
import { Schemas } from 'vs/base/common/network';
import { getRemoteAuthority } from 'vs/platform/remote/common/remoteHosts';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IProductService } from 'vs/platform/product/common/productService';
import { ITerminalInstanceService } from 'vs/workbench/contrib/terminal/browser/terminal';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { Disposable } from 'vs/base/common/lifecycle';
import { withNullAsUndefined } from 'vs/base/common/types';
import { IEnvironmentVariableService, IMergedEnvironmentVariableCollection, IEnvironmentVariableInfo } from 'vs/workbench/contrib/terminal/common/environmentVariable';
import { EnvironmentVariableInfoStale, EnvironmentVariableInfoChangesActive } from 'vs/workbench/contrib/terminal/browser/environmentVariableInfo';
import { IPathService } from 'vs/workbench/services/path/common/pathService';

/** The amount of time to consider terminal errors to be related to the launch */
const LAUNCHING_DURATION = 500;

/**
 * The minimum amount of time between latency requests.
 */
const LATENCY_MEASURING_INTERVAL = 1000;

enum ProcessType {
	Process,
	ExtensionTerminal
}

/**
 * Holds all state related to the creation and management of terminal processes.
 *
 * Internal definitions:
 * - Process: The process launched with the terminalProcess.ts file, or the pty as a whole
 * - Pty Process: The pseudoterminal parent process (or the conpty/winpty agent process)
 * - Shell Process: The pseudoterminal child process (ie. the shell)
 */
export class TerminalProcessManager extends Disposable implements ITerminalProcessManager {
	public processState: ProcessState = ProcessState.UNINITIALIZED;
	public ptyProcessReady: Promise<void>;
	public shellProcessId: number | undefined;
	public remoteAuthority: string | undefined;
	public os: platform.OperatingSystem | undefined;
	public userHome: string | undefined;

	private _process: ITerminalChildProcess | null = null;
	private _processType: ProcessType = ProcessType.Process;
	private _preLaunchInputQueue: string[] = [];
	private _latency: number = -1;
	private _latencyLastMeasured: number = 0;
	private _initialCwd: string | undefined;
	private _extEnvironmentVariableCollection: IMergedEnvironmentVariableCollection | undefined;
	private _environmentVariableInfo: IEnvironmentVariableInfo | undefined;

	private readonly _onProcessReady = this._register(new Emitter<void>());
	public get onProcessReady(): Event<void> { return this._onProcessReady.event; }
	private readonly _onBeforeProcessData = this._register(new Emitter<IBeforeProcessDataEvent>());
	public get onBeforeProcessData(): Event<IBeforeProcessDataEvent> { return this._onBeforeProcessData.event; }
	private readonly _onProcessData = this._register(new Emitter<string>());
	public get onProcessData(): Event<string> { return this._onProcessData.event; }
	private readonly _onProcessTitle = this._register(new Emitter<string>());
	public get onProcessTitle(): Event<string> { return this._onProcessTitle.event; }
	private readonly _onProcessExit = this._register(new Emitter<number | undefined>());
	public get onProcessExit(): Event<number | undefined> { return this._onProcessExit.event; }
	private readonly _onProcessOverrideDimensions = this._register(new Emitter<ITerminalDimensions | undefined>());
	public get onProcessOverrideDimensions(): Event<ITerminalDimensions | undefined> { return this._onProcessOverrideDimensions.event; }
	private readonly _onProcessOverrideShellLaunchConfig = this._register(new Emitter<IShellLaunchConfig>());
	public get onProcessResolvedShellLaunchConfig(): Event<IShellLaunchConfig> { return this._onProcessOverrideShellLaunchConfig.event; }
	private readonly _onEnvironmentVariableInfoChange = this._register(new Emitter<IEnvironmentVariableInfo>());
	public get onEnvironmentVariableInfoChanged(): Event<IEnvironmentVariableInfo> { return this._onEnvironmentVariableInfoChange.event; }

	public get environmentVariableInfo(): IEnvironmentVariableInfo | undefined { return this._environmentVariableInfo; }

	constructor(
		private readonly _terminalId: number,
		private readonly _configHelper: ITerminalConfigHelper,
		@IHistoryService private readonly _historyService: IHistoryService,
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@ILogService private readonly _logService: ILogService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@IConfigurationResolverService private readonly _configurationResolverService: IConfigurationResolverService,
		@IConfigurationService private readonly _workspaceConfigurationService: IConfigurationService,
		@IWorkbenchEnvironmentService private readonly _environmentService: IWorkbenchEnvironmentService,
		@IProductService private readonly _productService: IProductService,
		@ITerminalInstanceService private readonly _terminalInstanceService: ITerminalInstanceService,
		@IRemoteAgentService private readonly _remoteAgentService: IRemoteAgentService,
		@IPathService private readonly _pathService: IPathService,
		@IEnvironmentVariableService private readonly _environmentVariableService: IEnvironmentVariableService
	) {
		super();
		this.ptyProcessReady = new Promise<void>(c => {
			this.onProcessReady(() => {
				this._logService.debug(`Terminal process ready (shellProcessId: ${this.shellProcessId})`);
				c(undefined);
			});
		});
		this.ptyProcessReady.then(async () => await this.getLatency());
	}

	public dispose(immediate: boolean = false): void {
		if (this._process) {
			// If the process was still connected this dispose came from
			// within VS Code, not the process, so mark the process as
			// killed by the user.
			this.processState = ProcessState.KILLED_BY_USER;
			this._process.shutdown(immediate);
			this._process = null;
		}
		super.dispose();
	}

	public async createProcess(
		shellLaunchConfig: IShellLaunchConfig,
		cols: number,
		rows: number,
		isScreenReaderModeEnabled: boolean
	): Promise<ITerminalLaunchError | undefined> {
		if (shellLaunchConfig.isExtensionTerminal) {
			this._processType = ProcessType.ExtensionTerminal;
			this._process = this._instantiationService.createInstance(TerminalProcessExtHostProxy, this._terminalId, shellLaunchConfig, undefined, cols, rows, this._configHelper);
		} else {
			const forceExtHostProcess = (this._configHelper.config as any).extHostProcess;
			if (shellLaunchConfig.cwd && typeof shellLaunchConfig.cwd === 'object') {
				this.remoteAuthority = getRemoteAuthority(shellLaunchConfig.cwd);
			} else {
				this.remoteAuthority = this._environmentService.configuration.remoteAuthority;
			}
			const hasRemoteAuthority = !!this.remoteAuthority;
			let launchRemotely = hasRemoteAuthority || forceExtHostProcess;

			// resolvedUserHome is needed here as remote resolvers can launch local terminals before
			// they're connected to the remote.
			this.userHome = this._pathService.resolvedUserHome?.fsPath;
			this.os = platform.OS;
			if (launchRemotely) {
				const userHomeUri = await this._pathService.userHome();
				this.userHome = userHomeUri.path;
				if (hasRemoteAuthority) {
					const remoteEnv = await this._remoteAgentService.getEnvironment();
					if (remoteEnv) {
						this.userHome = remoteEnv.userHome.path;
						this.os = remoteEnv.os;
					}
				}

				const activeWorkspaceRootUri = this._historyService.getLastActiveWorkspaceRoot();
				this._process = this._instantiationService.createInstance(TerminalProcessExtHostProxy, this._terminalId, shellLaunchConfig, activeWorkspaceRootUri, cols, rows, this._configHelper);
			} else {
				this._process = await this._launchProcess(shellLaunchConfig, cols, rows, this.userHome, isScreenReaderModeEnabled);
			}
		}

		this.processState = ProcessState.LAUNCHING;

		this._process.onProcessData(data => {
			const beforeProcessDataEvent: IBeforeProcessDataEvent = { data };
			this._onBeforeProcessData.fire(beforeProcessDataEvent);
			if (beforeProcessDataEvent.data && beforeProcessDataEvent.data.length > 0) {
				this._onProcessData.fire(beforeProcessDataEvent.data);
			}
		});

		this._process.onProcessReady((e: { pid: number, cwd: string }) => {
			this.shellProcessId = e.pid;
			this._initialCwd = e.cwd;
			this._onProcessReady.fire();

			// Send any queued data that's waiting
			if (this._preLaunchInputQueue.length > 0 && this._process) {
				this._process.input(this._preLaunchInputQueue.join(''));
				this._preLaunchInputQueue.length = 0;
			}
		});

		this._process.onProcessTitleChanged(title => this._onProcessTitle.fire(title));
		this._process.onProcessExit(exitCode => this._onExit(exitCode));
		if (this._process.onProcessOverrideDimensions) {
			this._process.onProcessOverrideDimensions(e => this._onProcessOverrideDimensions.fire(e));
		}
		if (this._process.onProcessResolvedShellLaunchConfig) {
			this._process.onProcessResolvedShellLaunchConfig(e => this._onProcessOverrideShellLaunchConfig.fire(e));
		}

		setTimeout(() => {
			if (this.processState === ProcessState.LAUNCHING) {
				this.processState = ProcessState.RUNNING;
			}
		}, LAUNCHING_DURATION);

		const error = await this._process.start();
		if (error) {
			return error;
		}

		return undefined;
	}

	private async _launchProcess(
		shellLaunchConfig: IShellLaunchConfig,
		cols: number,
		rows: number,
		userHome: string | undefined,
		isScreenReaderModeEnabled: boolean
	): Promise<ITerminalChildProcess> {
		const activeWorkspaceRootUri = this._historyService.getLastActiveWorkspaceRoot(Schemas.file);
		const platformKey = platform.isWindows ? 'windows' : (platform.isMacintosh ? 'osx' : 'linux');
		const lastActiveWorkspace = activeWorkspaceRootUri ? withNullAsUndefined(this._workspaceContextService.getWorkspaceFolder(activeWorkspaceRootUri)) : undefined;
		if (!shellLaunchConfig.executable) {
			const defaultConfig = await this._terminalInstanceService.getDefaultShellAndArgs(false);
			shellLaunchConfig.executable = defaultConfig.shell;
			shellLaunchConfig.args = defaultConfig.args;
		} else {
			shellLaunchConfig.executable = this._configurationResolverService.resolve(lastActiveWorkspace, shellLaunchConfig.executable);
			if (shellLaunchConfig.args) {
				if (Array.isArray(shellLaunchConfig.args)) {
					const resolvedArgs: string[] = [];
					for (const arg of shellLaunchConfig.args) {
						resolvedArgs.push(this._configurationResolverService.resolve(lastActiveWorkspace, arg));
					}
					shellLaunchConfig.args = resolvedArgs;
				} else {
					shellLaunchConfig.args = this._configurationResolverService.resolve(lastActiveWorkspace, shellLaunchConfig.args);
				}
			}
		}

		const initialCwd = terminalEnvironment.getCwd(
			shellLaunchConfig,
			userHome,
			lastActiveWorkspace,
			this._configurationResolverService,
			activeWorkspaceRootUri,
			this._configHelper.config.cwd,
			this._logService
		);
		const envFromConfigValue = this._workspaceConfigurationService.inspect<ITerminalEnvironment | undefined>(`terminal.integrated.env.${platformKey}`);
		const isWorkspaceShellAllowed = this._configHelper.checkWorkspaceShellPermissions();
		this._configHelper.showRecommendations(shellLaunchConfig);
		const baseEnv = this._configHelper.config.inheritEnv ? processEnv : await this._terminalInstanceService.getMainProcessParentEnv();
		const env = terminalEnvironment.createTerminalEnvironment(shellLaunchConfig, lastActiveWorkspace, envFromConfigValue, this._configurationResolverService, isWorkspaceShellAllowed, this._productService.version, this._configHelper.config.detectLocale, baseEnv);

		// Fetch any extension environment additions and apply them
		if (!shellLaunchConfig.strictEnv) {
			this._extEnvironmentVariableCollection = this._environmentVariableService.mergedCollection;
			this._register(this._environmentVariableService.onDidChangeCollections(newCollection => this._onEnvironmentVariableCollectionChange(newCollection)));
			this._extEnvironmentVariableCollection.applyToProcessEnvironment(env);
			if (this._extEnvironmentVariableCollection.map.size > 0) {
				this._environmentVariableInfo = new EnvironmentVariableInfoChangesActive(this._extEnvironmentVariableCollection);
				this._onEnvironmentVariableInfoChange.fire(this._environmentVariableInfo);
			}
		}

		const useConpty = this._configHelper.config.windowsEnableConpty && !isScreenReaderModeEnabled;
		return this._terminalInstanceService.createTerminalProcess(shellLaunchConfig, initialCwd, cols, rows, env, useConpty);
	}

	public setDimensions(cols: number, rows: number): void {
		if (!this._process) {
			return;
		}

		// The child process could already be terminated
		try {
			this._process.resize(cols, rows);
		} catch (error) {
			// We tried to write to a closed pipe / channel.
			if (error.code !== 'EPIPE' && error.code !== 'ERR_IPC_CHANNEL_CLOSED') {
				throw (error);
			}
		}
	}

	public write(data: string): void {
		if (this.shellProcessId || this._processType === ProcessType.ExtensionTerminal) {
			if (this._process) {
				// Send data if the pty is ready
				this._process.input(data);
			}
		} else {
			// If the pty is not ready, queue the data received to send later
			this._preLaunchInputQueue.push(data);
		}
	}

	public getInitialCwd(): Promise<string> {
		return Promise.resolve(this._initialCwd ? this._initialCwd : '');
	}

	public getCwd(): Promise<string> {
		if (!this._process) {
			return Promise.resolve('');
		}
		return this._process.getCwd();
	}

	public async getLatency(): Promise<number> {
		await this.ptyProcessReady;
		if (!this._process) {
			return Promise.resolve(0);
		}
		if (this._latencyLastMeasured === 0 || this._latencyLastMeasured + LATENCY_MEASURING_INTERVAL < Date.now()) {
			const latencyRequest = this._process.getLatency();
			this._latency = await latencyRequest;
			this._latencyLastMeasured = Date.now();
		}
		return Promise.resolve(this._latency);
	}

	private _onExit(exitCode: number | undefined): void {
		this._process = null;

		// If the process is marked as launching then mark the process as killed
		// during launch. This typically means that there is a problem with the
		// shell and args.
		if (this.processState === ProcessState.LAUNCHING) {
			this.processState = ProcessState.KILLED_DURING_LAUNCH;
		}

		// If TerminalInstance did not know about the process exit then it was
		// triggered by the process, not on VS Code's side.
		if (this.processState === ProcessState.RUNNING) {
			this.processState = ProcessState.KILLED_BY_PROCESS;
		}

		this._onProcessExit.fire(exitCode);
	}

	private _onEnvironmentVariableCollectionChange(newCollection: IMergedEnvironmentVariableCollection): void {
		const diff = this._extEnvironmentVariableCollection!.diff(newCollection);
		if (diff === undefined) {
			return;
		}
		this._environmentVariableInfo = this._instantiationService.createInstance(EnvironmentVariableInfoStale, diff, this._terminalId);
		this._onEnvironmentVariableInfoChange.fire(this._environmentVariableInfo);
	}
}
