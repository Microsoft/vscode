/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { memoize } from 'vs/base/common/decorators';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { BrowserWindow, ipcMain, WebContents, Event as ElectronEvent } from 'electron';
import { ISharedProcess } from 'vs/platform/ipc/electron-main/sharedProcessMainService';
import { Barrier } from 'vs/base/common/async';
import { ILogService } from 'vs/platform/log/common/log';
import { ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { IThemeMainService } from 'vs/platform/theme/electron-main/themeMainService';
import { toDisposable, DisposableStore } from 'vs/base/common/lifecycle';
import { Event } from 'vs/base/common/event';
import { FileAccess } from 'vs/base/common/network';

export class SharedProcess implements ISharedProcess {

	private barrier = new Barrier();

	private window: BrowserWindow | null = null;

	private readonly _whenReady: Promise<void>;

	constructor(
		private readonly machineId: string,
		private userEnv: NodeJS.ProcessEnv,
		@IEnvironmentMainService private readonly environmentService: IEnvironmentMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@ILogService private readonly logService: ILogService,
		@IThemeMainService private readonly themeMainService: IThemeMainService
	) {
		// overall ready promise when shared process signals initialization is done
		this._whenReady = new Promise<void>(c => ipcMain.once('vscode:shared-process->electron-main=init-done', () => c(undefined)));
	}

	@memoize
	private get _whenIpcReady(): Promise<void> {
		this.window = new BrowserWindow({
			show: false,
			backgroundColor: this.themeMainService.getBackgroundColor(),
			webPreferences: {
				preload: FileAccess.asFileUri('vs/base/parts/sandbox/electron-browser/preload.js', require).fsPath,
				nodeIntegration: true,
				enableWebSQL: false,
				enableRemoteModule: false,
				spellcheck: false,
				nativeWindowOpen: true,
				images: false,
				webgl: false,
				disableBlinkFeatures: 'Auxclick' // do NOT change, allows us to identify this window as shared-process in the process explorer
			}
		});
		const config = {
			appRoot: this.environmentService.appRoot,
			machineId: this.machineId,
			nodeCachedDataDir: this.environmentService.nodeCachedDataDir,
			userEnv: this.userEnv,
			windowId: this.window.id
		};

		const windowUrl = (this.environmentService.sandbox ?
			FileAccess._asCodeFileUri('vs/code/electron-browser/sharedProcess/sharedProcess.html', require) :
			FileAccess.asBrowserUri('vs/code/electron-browser/sharedProcess/sharedProcess.html', require))
			.with({ query: `config=${encodeURIComponent(JSON.stringify(config))}` });
		this.window.loadURL(windowUrl.toString(true));

		// Prevent the window from dying
		const onClose = (e: ElectronEvent) => {
			this.logService.trace('SharedProcess#close prevented');

			// We never allow to close the shared process unless we get explicitly disposed()
			e.preventDefault();

			// Still hide the window though if visible
			if (this.window && this.window.isVisible()) {
				this.window.hide();
			}
		};

		this.window.on('close', onClose);

		const disposables = new DisposableStore();

		this.lifecycleMainService.onWillShutdown(() => {
			disposables.dispose();

			// Shut the shared process down when we are quitting
			//
			// Note: because we veto the window close, we must first remove our veto.
			// Otherwise the application would never quit because the shared process
			// window is refusing to close!
			//
			if (this.window) {
				this.window.removeListener('close', onClose);
			}

			// Electron seems to crash on Windows without this setTimeout :|
			setTimeout(() => {
				try {
					if (this.window) {
						this.window.close();
					}
				} catch (err) {
					// ignore, as electron is already shutting down
				}

				this.window = null;
			}, 0);
		});

		return new Promise<void>(c => {
			// send payload once shared process is ready to receive it
			disposables.add(Event.once(Event.fromNodeEventEmitter(ipcMain, 'vscode:shared-process->electron-main=ready-for-payload', ({ sender }: { sender: WebContents }) => sender))(sender => {
				sender.send('vscode:electron-main->shared-process=payload', {
					sharedIPCHandle: this.environmentService.sharedIPCHandle,
					args: this.environmentService.args,
					logLevel: this.logService.getLevel(),
					backupWorkspacesPath: this.environmentService.backupWorkspacesPath,
					nodeCachedDataDir: this.environmentService.nodeCachedDataDir
				});

				// signal exit to shared process when we get disposed
				disposables.add(toDisposable(() => sender.send('vscode:electron-main->shared-process=exit')));

				// complete IPC-ready promise when shared process signals this to us
				ipcMain.once('vscode:shared-process->electron-main=ipc-ready', () => c(undefined));
			}));
		});
	}

	spawn(userEnv: NodeJS.ProcessEnv): void {
		this.userEnv = { ...this.userEnv, ...userEnv };
		this.barrier.open();
	}

	async whenReady(): Promise<void> {
		await this.barrier.wait();
		await this._whenReady;
	}

	async whenIpcReady(): Promise<void> {
		await this.barrier.wait();
		await this._whenIpcReady;
	}

	toggle(): void {
		if (!this.window || this.window.isVisible()) {
			this.hide();
		} else {
			this.show();
		}
	}

	show(): void {
		if (this.window) {
			this.window.show();
			this.window.webContents.openDevTools();
		}
	}

	hide(): void {
		if (this.window) {
			this.window.webContents.closeDevTools();
			this.window.hide();
		}
	}
}
