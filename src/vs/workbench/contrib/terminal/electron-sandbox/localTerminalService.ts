/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter } from 'vs/base/common/event';
import { Disposable } from 'vs/base/common/lifecycle';
import { IProcessEnvironment, OperatingSystem } from 'vs/base/common/platform';
import { localize } from 'vs/nls';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { ILabelService } from 'vs/platform/label/common/label';
import { ILogService } from 'vs/platform/log/common/log';
import { INotificationHandle, INotificationService, IPromptChoice, Severity } from 'vs/platform/notification/common/notification';
import { ILocalTerminalService, IShellLaunchConfig, ITerminalChildProcess, ITerminalsLayoutInfo, ITerminalsLayoutInfoById } from 'vs/platform/terminal/common/terminal';
import { IGetTerminalLayoutInfoArgs, IProcessDetails, ISetTerminalLayoutInfoArgs } from 'vs/platform/terminal/common/terminalProcess';
import { ILocalPtyService } from 'vs/platform/terminal/electron-sandbox/terminal';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { LocalPty } from 'vs/workbench/contrib/terminal/electron-sandbox/localPty';
import { IShellEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/shellEnvironmentService';

export class LocalTerminalService extends Disposable implements ILocalTerminalService {
	declare _serviceBrand: undefined;

	private readonly _ptys: Map<number, LocalPty> = new Map();
	private _isPtyHostUnresponsive: boolean = false;

	private readonly _onPtyHostUnresponsive = this._register(new Emitter<void>());
	readonly onPtyHostUnresponsive = this._onPtyHostUnresponsive.event;
	private readonly _onPtyHostResponsive = this._register(new Emitter<void>());
	readonly onPtyHostResponsive = this._onPtyHostResponsive.event;
	private readonly _onPtyHostRestart = this._register(new Emitter<void>());
	readonly onPtyHostRestart = this._onPtyHostRestart.event;

	constructor(
		@IInstantiationService private readonly _instantiationService: IInstantiationService,
		@IWorkspaceContextService private readonly _workspaceContextService: IWorkspaceContextService,
		@ILogService private readonly _logService: ILogService,
		@ILocalPtyService private readonly _localPtyService: ILocalPtyService,
		@ILabelService private readonly _labelService: ILabelService,
		@INotificationService notificationService: INotificationService,
		@IShellEnvironmentService private readonly _shellEnvironmentService: IShellEnvironmentService
	) {
		super();

		// Attach process listeners
		this._localPtyService.onProcessData(e => this._ptys.get(e.id)?.handleData(e.event));
		this._localPtyService.onProcessExit(e => {
			const pty = this._ptys.get(e.id);
			if (pty) {
				pty.handleExit(e.event);
				this._ptys.delete(e.id);
			}
		});
		this._localPtyService.onProcessReady(e => this._ptys.get(e.id)?.handleReady(e.event));
		this._localPtyService.onProcessTitleChanged(e => this._ptys.get(e.id)?.handleTitleChanged(e.event));
		this._localPtyService.onProcessOverrideDimensions(e => this._ptys.get(e.id)?.handleOverrideDimensions(e.event));
		this._localPtyService.onProcessResolvedShellLaunchConfig(e => this._ptys.get(e.id)?.handleResolvedShellLaunchConfig(e.event));
		this._localPtyService.onProcessReplay(e => this._ptys.get(e.id)?.handleReplay(e.event));

		// Attach pty host listeners
		if (this._localPtyService.onPtyHostExit) {
			this._register(this._localPtyService.onPtyHostExit(() => {
				this._logService.error(`The terminal's pty host process exited, the connection to all terminal processes was lost`);
			}));
		}
		let unresponsiveNotification: INotificationHandle | undefined;
		if (this._localPtyService.onPtyHostStart) {
			this._register(this._localPtyService.onPtyHostStart(() => {
				this._logService.info(`ptyHost restarted`);
				this._onPtyHostRestart.fire();
				unresponsiveNotification?.close();
				unresponsiveNotification = undefined;
				this._isPtyHostUnresponsive = false;
			}));
		}
		if (this._localPtyService.onPtyHostUnresponsive) {
			this._register(this._localPtyService.onPtyHostUnresponsive(() => {
				const choices: IPromptChoice[] = [{
					label: localize('restartPtyHost', "Restart pty host"),
					run: () => this._localPtyService.restartPtyHost!()
				}];
				unresponsiveNotification = notificationService.prompt(Severity.Error, localize('nonResponsivePtyHost', "The connection to the terminal's pty host process is unresponsive, the terminals may stop working."), choices);
				this._isPtyHostUnresponsive = true;
				this._onPtyHostUnresponsive.fire();
			}));
		}
		if (this._localPtyService.onPtyHostResponsive) {
			this._register(this._localPtyService.onPtyHostResponsive(() => {
				if (!this._isPtyHostUnresponsive) {
					return;
				}
				this._logService.info('The pty host became responsive again');
				unresponsiveNotification?.close();
				unresponsiveNotification = undefined;
				this._isPtyHostUnresponsive = false;
				this._onPtyHostResponsive.fire();
			}));
		}
	}
	async updateTitle(id: number, title: string): Promise<void> {
		await this._localPtyService.updateTitle(id, title);
	}

	async updateIcon(id: number, icon: string): Promise<void> {
		await this._localPtyService.updateIcon(id, icon);
	}

	async createProcess(shellLaunchConfig: IShellLaunchConfig, cwd: string, cols: number, rows: number, env: IProcessEnvironment, windowsEnableConpty: boolean, shouldPersist: boolean): Promise<ITerminalChildProcess> {
		const executableEnv = await this._shellEnvironmentService.getShellEnv();
		const id = await this._localPtyService.createProcess(shellLaunchConfig, cwd, cols, rows, env, executableEnv, windowsEnableConpty, shouldPersist, this._getWorkspaceId(), this._getWorkspaceName());
		const pty = this._instantiationService.createInstance(LocalPty, id, shouldPersist);
		this._ptys.set(id, pty);
		return pty;
	}

	async attachToProcess(id: number): Promise<ITerminalChildProcess | undefined> {
		try {
			await this._localPtyService.attachToProcess(id);
			const pty = this._instantiationService.createInstance(LocalPty, id, true);
			this._ptys.set(id, pty);
			return pty;
		} catch (e) {
			this._logService.trace(`Couldn't attach to process ${e.message}`);
		}
		return undefined;
	}

	async listProcesses(): Promise<IProcessDetails[]> {
		return this._localPtyService.listProcesses();
	}

	async reduceConnectionGraceTime(): Promise<void> {
		this._localPtyService.reduceConnectionGraceTime();
	}

	async getDefaultSystemShell(osOverride?: OperatingSystem): Promise<string> {
		return this._localPtyService.getDefaultSystemShell(osOverride);
	}

	async getEnvironment(): Promise<IProcessEnvironment> {
		return this._localPtyService.getEnvironment();
	}

	async getWslPath(original: string): Promise<string> {
		return this._localPtyService.getWslPath(original);
	}

	async setTerminalLayoutInfo(layoutInfo?: ITerminalsLayoutInfoById): Promise<void> {
		const args: ISetTerminalLayoutInfoArgs = {
			workspaceId: this._getWorkspaceId(),
			tabs: layoutInfo ? layoutInfo.tabs : []
		};
		await this._localPtyService.setTerminalLayoutInfo(args);
	}

	async getTerminalLayoutInfo(): Promise<ITerminalsLayoutInfo | undefined> {
		const layoutArgs: IGetTerminalLayoutInfoArgs = {
			workspaceId: this._getWorkspaceId()
		};
		return await this._localPtyService.getTerminalLayoutInfo(layoutArgs);
	}

	private _getWorkspaceId(): string {
		return this._workspaceContextService.getWorkspace().id;
	}

	private _getWorkspaceName(): string {
		return this._labelService.getWorkspaceLabel(this._workspaceContextService.getWorkspace());
	}
}
