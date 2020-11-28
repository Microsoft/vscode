/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import * as os from 'os';
import product from 'vs/platform/product/common/product';
import { parseArgs, OPTIONS } from 'vs/platform/environment/node/argv';
import { ICommonIssueService, IssueReporterData, IssueReporterFeatures, ProcessExplorerData } from 'vs/platform/issue/common/issue';
import { BrowserWindow, ipcMain, screen, IpcMainEvent, Display } from 'electron';
import { ILaunchMainService } from 'vs/platform/launch/electron-main/launchMainService';
import { PerformanceInfo, isRemoteDiagnosticError } from 'vs/platform/diagnostics/common/diagnostics';
import { IDiagnosticsService } from 'vs/platform/diagnostics/node/diagnosticsService';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { isMacintosh, IProcessEnvironment } from 'vs/base/common/platform';
import { ILogService } from 'vs/platform/log/common/log';
import { IWindowState } from 'vs/platform/windows/electron-main/windows';
import { listProcesses } from 'vs/base/node/ps';
import { IDialogMainService } from 'vs/platform/dialogs/electron-main/dialogs';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { zoomLevelToZoomFactor } from 'vs/platform/windows/common/windows';
import { FileAccess } from 'vs/base/common/network';
import { INativeHostMainService } from 'vs/platform/native/electron-main/nativeHostMainService';

const DEFAULT_BACKGROUND_COLOR = '#1E1E1E';

export const IIssueMainService = createDecorator<IIssueMainService>('issueMainService');

export interface IIssueMainService extends ICommonIssueService { }

export class IssueMainService implements ICommonIssueService {
	declare readonly _serviceBrand: undefined;
	_issueWindow: BrowserWindow | null = null;
	_issueParentWindow: BrowserWindow | null = null;
	_processExplorerWindow: BrowserWindow | null = null;
	_processExplorerParentWindow: BrowserWindow | null = null;

	constructor(
		private machineId: string,
		private userEnv: IProcessEnvironment,
		@IEnvironmentMainService private readonly environmentService: IEnvironmentMainService,
		@ILaunchMainService private readonly launchMainService: ILaunchMainService,
		@ILogService private readonly logService: ILogService,
		@IDiagnosticsService private readonly diagnosticsService: IDiagnosticsService,
		@IDialogMainService private readonly dialogMainService: IDialogMainService,
		@INativeHostMainService private readonly nativeHostMainService: INativeHostMainService
	) {
		this.registerListeners();
	}

	private registerListeners(): void {
		ipcMain.on('vscode:issueSystemInfoRequest', async (event: IpcMainEvent) => {
			Promise.all([this.launchMainService.getMainProcessInfo(), this.launchMainService.getRemoteDiagnostics({ includeProcesses: false, includeWorkspaceMetadata: false })])
				.then(result => {
					const [info, remoteData] = result;
					this.diagnosticsService.getSystemInfo(info, remoteData).then(msg => {
						this.safeSend(event, 'vscode:issueSystemInfoResponse', msg);
					});
				});
		});

		ipcMain.on('vscode:listProcesses', async (event: IpcMainEvent) => {
			const processes = [];

			try {
				const mainPid = await this.launchMainService.getMainProcessId();
				processes.push({ name: localize('local', "Local"), rootProcess: await listProcesses(mainPid) });
				(await this.launchMainService.getRemoteDiagnostics({ includeProcesses: true }))
					.forEach(data => {
						if (isRemoteDiagnosticError(data)) {
							processes.push({
								name: data.hostName,
								rootProcess: data
							});
						} else {
							if (data.processes) {
								processes.push({
									name: data.hostName,
									rootProcess: data.processes
								});
							}
						}
					});
			} catch (e) {
				this.logService.error(`Listing processes failed: ${e}`);
			}

			this.safeSend(event, 'vscode:listProcessesResponse', processes);
		});

		ipcMain.on('vscode:issueReporterClipboard', (event: IpcMainEvent) => {
			const messageOptions = {
				message: localize('issueReporterWriteToClipboard', "There is too much data to send to GitHub directly. The data will be copied to the clipboard, please paste it into the GitHub issue page that is opened."),
				type: 'warning',
				buttons: [
					localize('ok', "OK"),
					localize('cancel', "Cancel")
				]
			};

			if (this._issueWindow) {
				this.dialogMainService.showMessageBox(messageOptions, this._issueWindow)
					.then(result => {
						this.safeSend(event, 'vscode:issueReporterClipboardResponse', result.response === 0);
					});
			}
		});

		ipcMain.on('vscode:issuePerformanceInfoRequest', (event: IpcMainEvent) => {
			this.getPerformanceInfo().then(msg => {
				this.safeSend(event, 'vscode:issuePerformanceInfoResponse', msg);
			});
		});

		ipcMain.on('vscode:issueReporterConfirmClose', () => {
			const messageOptions = {
				message: localize('confirmCloseIssueReporter', "Your input will not be saved. Are you sure you want to close this window?"),
				type: 'warning',
				buttons: [
					localize('yes', "Yes"),
					localize('cancel', "Cancel")
				]
			};

			if (this._issueWindow) {
				this.dialogMainService.showMessageBox(messageOptions, this._issueWindow)
					.then(result => {
						if (result.response === 0) {
							if (this._issueWindow) {
								this._issueWindow.destroy();
								this._issueWindow = null;
							}
						}
					});
			}
		});

		ipcMain.on('vscode:workbenchCommand', (_: unknown, commandInfo: { id: any; from: any; args: any; }) => {
			const { id, from, args } = commandInfo;

			let parentWindow: BrowserWindow | null;
			switch (from) {
				case 'issueReporter':
					parentWindow = this._issueParentWindow;
					break;
				case 'processExplorer':
					parentWindow = this._processExplorerParentWindow;
					break;
				default:
					throw new Error(`Unexpected command source: ${from}`);
			}

			if (parentWindow) {
				parentWindow.webContents.send('vscode:runAction', { id, from, args });
			}
		});

		ipcMain.on('vscode:openExternal', (_: unknown, arg: string) => {
			this.nativeHostMainService.openExternal(undefined, arg);
		});

		ipcMain.on('vscode:closeIssueReporter', (event: IpcMainEvent) => {
			if (this._issueWindow) {
				this._issueWindow.close();
			}
		});

		ipcMain.on('vscode:closeProcessExplorer', (event: IpcMainEvent) => {
			if (this._processExplorerWindow) {
				this._processExplorerWindow.close();
			}
		});

		ipcMain.on('vscode:windowsInfoRequest', (event: IpcMainEvent) => {
			this.launchMainService.getMainProcessInfo().then(info => {
				this.safeSend(event, 'vscode:windowsInfoResponse', info.windows);
			});
		});
	}

	private safeSend(event: IpcMainEvent, channel: string, ...args: unknown[]): void {
		if (!event.sender.isDestroyed()) {
			event.sender.send(channel, ...args);
		}
	}

	openReporter(data: IssueReporterData): Promise<void> {
		return new Promise(_ => {
			if (!this._issueWindow) {
				this._issueParentWindow = BrowserWindow.getFocusedWindow();
				if (this._issueParentWindow) {
					const position = this.getWindowPosition(this._issueParentWindow, 700, 800);

					this._issueWindow = new BrowserWindow({
						fullscreen: false,
						width: position.width,
						height: position.height,
						minWidth: 300,
						minHeight: 200,
						x: position.x,
						y: position.y,
						title: localize('issueReporter', "Issue Reporter"),
						backgroundColor: data.styles.backgroundColor || DEFAULT_BACKGROUND_COLOR,
						webPreferences: {
							preload: FileAccess.asFileUri('vs/base/parts/sandbox/electron-browser/preload.js', require).fsPath,
							enableWebSQL: false,
							enableRemoteModule: false,
							spellcheck: false,
							nativeWindowOpen: true,
							zoomFactor: zoomLevelToZoomFactor(data.zoomLevel),
							sandbox: true,
							contextIsolation: true
						}
					});

					this._issueWindow.setMenuBarVisibility(false); // workaround for now, until a menu is implemented

					// Modified when testing UI
					const features: IssueReporterFeatures = {};

					this.logService.trace('issueService#openReporter: opening issue reporter');
					this._issueWindow.loadURL(this.getIssueReporterPath(data, features));

					this._issueWindow.on('close', () => this._issueWindow = null);

					this._issueParentWindow.on('closed', () => {
						if (this._issueWindow) {
							this._issueWindow.close();
							this._issueWindow = null;
						}
					});
				}
			}

			if (this._issueWindow) {
				this._issueWindow.focus();
			}
		});
	}

	openProcessExplorer(data: ProcessExplorerData): Promise<void> {
		return new Promise(_ => {
			// Create as singleton
			if (!this._processExplorerWindow) {
				this._processExplorerParentWindow = BrowserWindow.getFocusedWindow();
				if (this._processExplorerParentWindow) {
					const position = this.getWindowPosition(this._processExplorerParentWindow, 800, 500);
					this._processExplorerWindow = new BrowserWindow({
						skipTaskbar: true,
						resizable: true,
						fullscreen: false,
						width: position.width,
						height: position.height,
						minWidth: 300,
						minHeight: 200,
						x: position.x,
						y: position.y,
						backgroundColor: data.styles.backgroundColor,
						title: localize('processExplorer', "Process Explorer"),
						webPreferences: {
							preload: FileAccess.asFileUri('vs/base/parts/sandbox/electron-browser/preload.js', require).fsPath,
							enableWebSQL: false,
							enableRemoteModule: false,
							spellcheck: false,
							nativeWindowOpen: true,
							zoomFactor: zoomLevelToZoomFactor(data.zoomLevel),
							sandbox: true,
							contextIsolation: true
						}
					});

					this._processExplorerWindow.setMenuBarVisibility(false);

					const windowConfiguration = {
						appRoot: this.environmentService.appRoot,
						windowId: this._processExplorerWindow.id,
						userEnv: this.userEnv,
						machineId: this.machineId,
						data
					};

					this._processExplorerWindow.loadURL(
						toWindowUrl('vs/code/electron-sandbox/processExplorer/processExplorer.html', windowConfiguration));

					this._processExplorerWindow.on('close', () => this._processExplorerWindow = null);

					this._processExplorerParentWindow.on('close', () => {
						if (this._processExplorerWindow) {
							this._processExplorerWindow.close();
							this._processExplorerWindow = null;
						}
					});
				}
			}

			// Focus
			if (this._processExplorerWindow) {
				this._processExplorerWindow.focus();
			}
		});
	}

	public async getSystemStatus(): Promise<string> {
		return Promise.all([this.launchMainService.getMainProcessInfo(), this.launchMainService.getRemoteDiagnostics({ includeProcesses: false, includeWorkspaceMetadata: false })])
			.then(result => {
				const [info, remoteData] = result;
				return this.diagnosticsService.getDiagnostics(info, remoteData);
			});
	}

	private getWindowPosition(parentWindow: BrowserWindow, defaultWidth: number, defaultHeight: number): IWindowState {
		// We want the new window to open on the same display that the parent is in
		let displayToUse: Display | undefined;
		const displays = screen.getAllDisplays();

		// Single Display
		if (displays.length === 1) {
			displayToUse = displays[0];
		}

		// Multi Display
		else {

			// on mac there is 1 menu per window so we need to use the monitor where the cursor currently is
			if (isMacintosh) {
				const cursorPoint = screen.getCursorScreenPoint();
				displayToUse = screen.getDisplayNearestPoint(cursorPoint);
			}

			// if we have a last active window, use that display for the new window
			if (!displayToUse && parentWindow) {
				displayToUse = screen.getDisplayMatching(parentWindow.getBounds());
			}

			// fallback to primary display or first display
			if (!displayToUse) {
				displayToUse = screen.getPrimaryDisplay() || displays[0];
			}
		}

		const state: IWindowState = {
			width: defaultWidth,
			height: defaultHeight
		};

		const displayBounds = displayToUse.bounds;
		state.x = displayBounds.x + (displayBounds.width / 2) - (state.width! / 2);
		state.y = displayBounds.y + (displayBounds.height / 2) - (state.height! / 2);

		if (displayBounds.width > 0 && displayBounds.height > 0 /* Linux X11 sessions sometimes report wrong display bounds */) {
			if (state.x < displayBounds.x) {
				state.x = displayBounds.x; // prevent window from falling out of the screen to the left
			}

			if (state.y < displayBounds.y) {
				state.y = displayBounds.y; // prevent window from falling out of the screen to the top
			}

			if (state.x > (displayBounds.x + displayBounds.width)) {
				state.x = displayBounds.x; // prevent window from falling out of the screen to the right
			}

			if (state.y > (displayBounds.y + displayBounds.height)) {
				state.y = displayBounds.y; // prevent window from falling out of the screen to the bottom
			}

			if (state.width! > displayBounds.width) {
				state.width = displayBounds.width; // prevent window from exceeding display bounds width
			}

			if (state.height! > displayBounds.height) {
				state.height = displayBounds.height; // prevent window from exceeding display bounds height
			}
		}

		return state;
	}

	private getPerformanceInfo(): Promise<PerformanceInfo> {
		return new Promise(async (resolve, reject) => {
			Promise.all([this.launchMainService.getMainProcessInfo(), this.launchMainService.getRemoteDiagnostics({ includeProcesses: true, includeWorkspaceMetadata: true })])
				.then(result => {
					const [info, remoteData] = result;
					this.diagnosticsService.getPerformanceInfo(info, remoteData)
						.then(diagnosticInfo => {
							resolve(diagnosticInfo);
						})
						.catch(err => {
							this.logService.warn('issueService#getPerformanceInfo ', err.message);
							reject(err);
						});
				});
		});
	}

	private getIssueReporterPath(data: IssueReporterData, features: IssueReporterFeatures): string {
		if (!this._issueWindow) {
			throw new Error('Issue window has been disposed');
		}

		const windowConfiguration = {
			appRoot: this.environmentService.appRoot,
			windowId: this._issueWindow.id,
			machineId: this.machineId,
			userEnv: this.userEnv,
			data,
			features,
			disableExtensions: this.environmentService.disableExtensions,
			os: {
				type: os.type(),
				arch: os.arch(),
				release: os.release(),
			},
			product: {
				nameShort: product.nameShort,
				version: product.version,
				commit: product.commit,
				date: product.date,
				reportIssueUrl: product.reportIssueUrl
			}
		};

		return toWindowUrl('vs/code/electron-sandbox/issue/issueReporter.html', windowConfiguration);
	}
}

function toWindowUrl<T>(modulePathToHtml: string, windowConfiguration: T): string {
	const environment = parseArgs(process.argv, OPTIONS);
	const config = Object.assign(environment, windowConfiguration);
	for (const keyValue of Object.keys(config)) {
		const key = keyValue as keyof typeof config;
		if (config[key] === undefined || config[key] === null || config[key] === '') {
			delete config[key]; // only send over properties that have a true value
		}
	}

	return FileAccess
		._asCodeFileUri(modulePathToHtml, require)
		.with({ query: `config=${encodeURIComponent(JSON.stringify(config))}` })
		.toString(true);
}
