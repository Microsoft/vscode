/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import product from 'vs/platform/product/common/product';
import { BrowserWindow, ipcMain, Event as ElectronEvent, MessagePortMain, IpcMainEvent, RenderProcessGoneDetails } from 'electron';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { Barrier } from 'vs/base/common/async';
import { ILogService } from 'vs/platform/log/common/log';
import { ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { IThemeMainService } from 'vs/platform/theme/electron-main/themeMainService';
import { FileAccess } from 'vs/base/common/network';
import { browserCodeLoadingCacheStrategy, IProcessEnvironment } from 'vs/base/common/platform';
import { ISharedProcess, ISharedProcessConfiguration } from 'vs/platform/sharedProcess/node/sharedProcess';
import { Disposable } from 'vs/base/common/lifecycle';
import { connect as connectMessagePort } from 'vs/base/parts/ipc/electron-main/ipc.mp';
import { assertIsDefined } from 'vs/base/common/types';
import { Emitter, Event } from 'vs/base/common/event';
import { WindowError } from 'vs/platform/windows/electron-main/windows';
import { IProtocolMainService } from 'vs/platform/protocol/electron-main/protocol';

export class SharedProcess extends Disposable implements ISharedProcess {

	private readonly firstWindowConnectionBarrier = new Barrier();

	private window: BrowserWindow | undefined = undefined;
	private windowCloseListener: ((event: ElectronEvent) => void) | undefined = undefined;

	private readonly _onDidError = this._register(new Emitter<{ type: WindowError, details: string | RenderProcessGoneDetails }>());
	readonly onDidError = Event.buffer(this._onDidError.event); // buffer until we have a listener!

	constructor(
		private readonly machineId: string,
		private userEnv: IProcessEnvironment,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@ILogService private readonly logService: ILogService,
		@IThemeMainService private readonly themeMainService: IThemeMainService,
		@IProtocolMainService private readonly protocolMainService: IProtocolMainService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		// Lifecycle
		this._register(this.lifecycleMainService.onWillShutdown(() => this.onWillShutdown()));

		// Shared process connections from workbench windows
		ipcMain.on('vscode:createSharedProcessMessageChannel', async (e, nonce: string) => this.onWindowConnection(e, nonce));
	}

	private async onWindowConnection(e: IpcMainEvent, nonce: string): Promise<void> {
		this.logService.trace('SharedProcess: on vscode:createSharedProcessMessageChannel');

		// release barrier if this is the first window connection
		if (!this.firstWindowConnectionBarrier.isOpen()) {
			this.firstWindowConnectionBarrier.open();
		}

		// await the shared process to be overall ready
		// we do not just wait for IPC ready because the
		// workbench window will communicate directly
		await this.whenReady();

		// connect to the shared process window
		const port = await this.connect();

		// Check back if the requesting window meanwhile closed
		// Since shared process is delayed on startup there is
		// a chance that the window close before the shared process
		// was ready for a connection.
		if (e.sender.isDestroyed()) {
			return port.close();
		}

		// send the port back to the requesting window
		e.sender.postMessage('vscode:createSharedProcessMessageChannelResult', nonce, [port]);
	}

	private onWillShutdown(): void {
		const window = this.window;
		if (!window) {
			return; // possibly too early before created
		}

		// Signal exit to shared process when shutting down
		if (!window.isDestroyed() && !window.webContents.isDestroyed()) {
			window.webContents.send('vscode:electron-main->shared-process=exit');
		}

		// Shut the shared process down when we are quitting
		//
		// Note: because we veto the window close, we must first remove our veto.
		// Otherwise the application would never quit because the shared process
		// window is refusing to close!
		//
		if (this.windowCloseListener) {
			window.removeListener('close', this.windowCloseListener);
			this.windowCloseListener = undefined;
		}

		// Electron seems to crash on Windows without this setTimeout :|
		setTimeout(() => {
			try {
				window.close();
			} catch (err) {
				// ignore, as electron is already shutting down
			}

			this.window = undefined;
		}, 0);
	}

	private _whenReady: Promise<void> | undefined = undefined;
	whenReady(): Promise<void> {
		if (!this._whenReady) {
			// Overall signal that the shared process window was loaded and
			// all services within have been created.
			this._whenReady = new Promise<void>(resolve => ipcMain.once('vscode:shared-process->electron-main=init-done', () => {
				this.logService.trace('SharedProcess: Overall ready');

				resolve();
			}));
		}

		return this._whenReady;
	}

	private _whenIpcReady: Promise<void> | undefined = undefined;
	private get whenIpcReady() {
		if (!this._whenIpcReady) {
			this._whenIpcReady = (async () => {

				// Always wait for first window asking for connection
				await this.firstWindowConnectionBarrier.wait();

				// Create window for shared process
				this.createWindow();

				// Listeners
				this.registerWindowListeners();

				// Wait for window indicating that IPC connections are accepted
				await new Promise<void>(resolve => ipcMain.once('vscode:shared-process->electron-main=ipc-ready', () => {
					this.logService.trace('SharedProcess: IPC ready');

					resolve();
				}));
			})();
		}

		return this._whenIpcReady;
	}

	private createWindow(): void {
		const configObjectUrl = this._register(this.protocolMainService.createIPCObjectUrl<ISharedProcessConfiguration>());

		// shared process is a hidden window by default
		this.window = new BrowserWindow({
			show: false,
			backgroundColor: this.themeMainService.getBackgroundColor(),
			webPreferences: {
				preload: FileAccess.asFileUri('vs/base/parts/sandbox/electron-browser/preload.js', require).fsPath,
				additionalArguments: [`--vscode-window-config=${configObjectUrl.resource.toString()}`],
				v8CacheOptions: browserCodeLoadingCacheStrategy,
				nodeIntegration: true,
				contextIsolation: false,
				enableWebSQL: false,
				enableRemoteModule: false,
				spellcheck: false,
				nativeWindowOpen: true,
				images: false,
				webgl: false,
				disableBlinkFeatures: 'Auxclick' // do NOT change, allows us to identify this window as shared-process in the process explorer
			}
		});

		// Store into config object URL
		configObjectUrl.update({
			machineId: this.machineId,
			windowId: this.window.id,
			appRoot: this.environmentMainService.appRoot,
			nodeCachedDataDir: this.environmentMainService.nodeCachedDataDir,
			backupWorkspacesPath: this.environmentMainService.backupWorkspacesPath,
			userEnv: this.userEnv,
			args: this.environmentMainService.args,
			logLevel: this.logService.getLevel(),
			product
		});

		// Load with config
		this.window.loadURL(FileAccess.asBrowserUri('vs/code/electron-browser/sharedProcess/sharedProcess.html', require).toString(true));
	}

	private registerWindowListeners(): void {
		if (!this.window) {
			return;
		}

		// Prevent the window from closing
		this.windowCloseListener = (e: ElectronEvent) => {
			this.logService.trace('SharedProcess#close prevented');

			// We never allow to close the shared process unless we get explicitly disposed()
			e.preventDefault();

			// Still hide the window though if visible
			if (this.window?.isVisible()) {
				this.window.hide();
			}
		};

		this.window.on('close', this.windowCloseListener);

		// Crashes & Unresponsive & Failed to load
		// We use `onUnexpectedError` explicitly because the error handler
		// will send the error to the active window to log in devtools too
		this.window.webContents.on('render-process-gone', (event, details) => this._onDidError.fire({ type: WindowError.CRASHED, details }));
		this.window.on('unresponsive', () => this._onDidError.fire({ type: WindowError.UNRESPONSIVE, details: 'SharedProcess: detected unresponsive window' }));
		this.window.webContents.on('did-fail-load', (event, errorCode, errorDescription) => this._onDidError.fire({ type: WindowError.LOAD, details: `SharedProcess: failed to load: ${errorDescription}` }));
	}

	async connect(): Promise<MessagePortMain> {

		// Wait for shared process being ready to accept connection
		await this.whenIpcReady;

		// Connect and return message port
		const window = assertIsDefined(this.window);
		return connectMessagePort(window);
	}

	async toggle(): Promise<void> {

		// wait for window to be created
		await this.whenIpcReady;

		if (!this.window) {
			return; // possibly disposed already
		}

		if (this.window.isVisible()) {
			this.window.webContents.closeDevTools();
			this.window.hide();
		} else {
			this.window.show();
			this.window.webContents.openDevTools();
		}
	}

	isVisible(): boolean {
		return this.window?.isVisible() ?? false;
	}
}
