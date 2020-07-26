/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { IWindowsMainService, ICodeWindow } from 'vs/platform/windows/electron-main/windows';
import { MessageBoxOptions, MessageBoxReturnValue, shell, OpenDevToolsOptions, SaveDialogOptions, SaveDialogReturnValue, OpenDialogOptions, OpenDialogReturnValue, Menu, BrowserWindow, app, clipboard, powerMonitor } from 'electron';
import { OpenContext } from 'vs/platform/windows/node/window';
import { ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { IOpenedWindow, IOpenWindowOptions, IWindowOpenable, IOpenEmptyWindowOptions } from 'vs/platform/windows/common/windows';
import { INativeOpenDialogOptions } from 'vs/platform/dialogs/common/dialogs';
import { isMacintosh, isWindows, isRootUser } from 'vs/base/common/platform';
import { ICommonElectronService } from 'vs/platform/electron/common/electron';
import { ISerializableCommandAction } from 'vs/platform/actions/common/actions';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { AddFirstParameterToFunctions } from 'vs/base/common/types';
import { IDialogMainService } from 'vs/platform/dialogs/electron-main/dialogs';
import { dirExists } from 'vs/base/node/pfs';
import { URI } from 'vs/base/common/uri';
import { ITelemetryData, ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { MouseInputEvent } from 'vs/base/parts/sandbox/common/electronTypes';
import { totalmem } from 'os';

export interface IElectronMainService extends AddFirstParameterToFunctions<ICommonElectronService, Promise<unknown> /* only methods, not events */, number | undefined /* window ID */> { }

export const IElectronMainService = createDecorator<IElectronMainService>('electronMainService');

export class ElectronMainService implements IElectronMainService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@IDialogMainService private readonly dialogMainService: IDialogMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@ITelemetryService private readonly telemetryService: ITelemetryService
	) {
	}

	//#region Properties

	get windowId(): never { throw new Error('Not implemented in electron-main'); }

	//#endregion

	//#region Events

	readonly onWindowOpen = Event.filter(Event.fromNodeEventEmitter(app, 'browser-window-created', (event, window: BrowserWindow) => window.id), windowId => !!this.windowsMainService.getWindowById(windowId));

	readonly onWindowMaximize = Event.filter(Event.fromNodeEventEmitter(app, 'browser-window-maximize', (event, window: BrowserWindow) => window.id), windowId => !!this.windowsMainService.getWindowById(windowId));
	readonly onWindowUnmaximize = Event.filter(Event.fromNodeEventEmitter(app, 'browser-window-unmaximize', (event, window: BrowserWindow) => window.id), windowId => !!this.windowsMainService.getWindowById(windowId));

	readonly onWindowBlur = Event.filter(Event.fromNodeEventEmitter(app, 'browser-window-blur', (event, window: BrowserWindow) => window.id), windowId => !!this.windowsMainService.getWindowById(windowId));
	readonly onWindowFocus = Event.any(
		Event.map(Event.filter(Event.map(this.windowsMainService.onWindowsCountChanged, () => this.windowsMainService.getLastActiveWindow()), window => !!window), window => window!.id),
		Event.filter(Event.fromNodeEventEmitter(app, 'browser-window-focus', (event, window: BrowserWindow) => window.id), windowId => !!this.windowsMainService.getWindowById(windowId))
	);

	readonly onOSResume = Event.fromNodeEventEmitter(powerMonitor, 'resume');

	//#endregion

	//#region Window

	async getWindows(): Promise<IOpenedWindow[]> {
		const windows = this.windowsMainService.getWindows();

		return windows.map(window => ({
			id: window.id,
			workspace: window.openedWorkspace,
			folderUri: window.openedFolderUri,
			title: window.win.getTitle(),
			filename: window.getRepresentedFilename(),
			dirty: window.isDocumentEdited()
		}));
	}

	async getWindowCount(windowId: number | undefined): Promise<number> {
		return this.windowsMainService.getWindowCount();
	}

	async getActiveWindowId(windowId: number | undefined): Promise<number | undefined> {
		const activeWindow = BrowserWindow.getFocusedWindow() || this.windowsMainService.getLastActiveWindow();
		if (activeWindow) {
			return activeWindow.id;
		}

		return undefined;
	}

	openWindow(windowId: number | undefined, options?: IOpenEmptyWindowOptions): Promise<void>;
	openWindow(windowId: number | undefined, toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void>;
	openWindow(windowId: number | undefined, arg1?: IOpenEmptyWindowOptions | IWindowOpenable[], arg2?: IOpenWindowOptions): Promise<void> {
		if (Array.isArray(arg1)) {
			return this.doOpenWindow(windowId, arg1, arg2);
		}

		return this.doOpenEmptyWindow(windowId, arg1);
	}

	private async doOpenWindow(windowId: number | undefined, toOpen: IWindowOpenable[], options: IOpenWindowOptions = Object.create(null)): Promise<void> {
		if (toOpen.length > 0) {
			this.windowsMainService.open({
				context: OpenContext.API,
				contextWindowId: windowId,
				urisToOpen: toOpen,
				cli: this.environmentService.args,
				forceNewWindow: options.forceNewWindow,
				forceReuseWindow: options.forceReuseWindow,
				preferNewWindow: options.preferNewWindow,
				diffMode: options.diffMode,
				addMode: options.addMode,
				gotoLineMode: options.gotoLineMode,
				noRecentEntry: options.noRecentEntry,
				waitMarkerFileURI: options.waitMarkerFileURI
			});
		}
	}

	private async doOpenEmptyWindow(windowId: number | undefined, options?: IOpenEmptyWindowOptions): Promise<void> {
		this.windowsMainService.openEmptyWindow({
			context: OpenContext.API,
			contextWindowId: windowId
		}, options);
	}

	async toggleFullScreen(windowId: number | undefined): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.toggleFullScreen();
		}
	}

	async handleTitleDoubleClick(windowId: number | undefined): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.handleTitleDoubleClick();
		}
	}

	async isMaximized(windowId: number | undefined): Promise<boolean> {
		const window = this.windowById(windowId);
		if (window) {
			return window.win.isMaximized();
		}

		return false;
	}

	async maximizeWindow(windowId: number | undefined): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.win.maximize();
		}
	}

	async unmaximizeWindow(windowId: number | undefined): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.win.unmaximize();
		}
	}

	async minimizeWindow(windowId: number | undefined): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.win.minimize();
		}
	}

	async focusWindow(windowId: number | undefined, options?: { windowId?: number; }): Promise<void> {
		if (options && typeof options.windowId === 'number') {
			windowId = options.windowId;
		}

		const window = this.windowById(windowId);
		if (window) {
			window.focus();
		}
	}

	//#endregion

	//#region Dialog

	async showMessageBox(windowId: number | undefined, options: MessageBoxOptions): Promise<MessageBoxReturnValue> {
		return this.dialogMainService.showMessageBox(options, this.toBrowserWindow(windowId));
	}

	async showSaveDialog(windowId: number | undefined, options: SaveDialogOptions): Promise<SaveDialogReturnValue> {
		return this.dialogMainService.showSaveDialog(options, this.toBrowserWindow(windowId));
	}

	async showOpenDialog(windowId: number | undefined, options: OpenDialogOptions): Promise<OpenDialogReturnValue> {
		return this.dialogMainService.showOpenDialog(options, this.toBrowserWindow(windowId));
	}

	private toBrowserWindow(windowId: number | undefined): BrowserWindow | undefined {
		const window = this.windowById(windowId);
		if (window) {
			return window.win;
		}

		return undefined;
	}

	async pickFileFolderAndOpen(windowId: number | undefined, options: INativeOpenDialogOptions): Promise<void> {
		const paths = await this.dialogMainService.pickFileFolder(options);
		if (paths) {
			this.sendPickerTelemetry(paths, options.telemetryEventName || 'openFileFolder', options.telemetryExtraData);
			this.doOpenPicked(await Promise.all(paths.map(async path => (await dirExists(path)) ? { folderUri: URI.file(path) } : { fileUri: URI.file(path) })), options, windowId);
		}
	}

	async pickFolderAndOpen(windowId: number | undefined, options: INativeOpenDialogOptions): Promise<void> {
		const paths = await this.dialogMainService.pickFolder(options);
		if (paths) {
			this.sendPickerTelemetry(paths, options.telemetryEventName || 'openFolder', options.telemetryExtraData);
			this.doOpenPicked(paths.map(path => ({ folderUri: URI.file(path) })), options, windowId);
		}
	}

	async pickFileAndOpen(windowId: number | undefined, options: INativeOpenDialogOptions): Promise<void> {
		const paths = await this.dialogMainService.pickFile(options);
		if (paths) {
			this.sendPickerTelemetry(paths, options.telemetryEventName || 'openFile', options.telemetryExtraData);
			this.doOpenPicked(paths.map(path => ({ fileUri: URI.file(path) })), options, windowId);
		}
	}

	async pickWorkspaceAndOpen(windowId: number | undefined, options: INativeOpenDialogOptions): Promise<void> {
		const paths = await this.dialogMainService.pickWorkspace(options);
		if (paths) {
			this.sendPickerTelemetry(paths, options.telemetryEventName || 'openWorkspace', options.telemetryExtraData);
			this.doOpenPicked(paths.map(path => ({ workspaceUri: URI.file(path) })), options, windowId);
		}
	}

	private doOpenPicked(openable: IWindowOpenable[], options: INativeOpenDialogOptions, windowId: number | undefined): void {
		this.windowsMainService.open({
			context: OpenContext.DIALOG,
			contextWindowId: windowId,
			cli: this.environmentService.args,
			urisToOpen: openable,
			forceNewWindow: options.forceNewWindow
		});
	}

	private sendPickerTelemetry(paths: string[], telemetryEventName: string, telemetryExtraData?: ITelemetryData) {
		const numberOfPaths = paths ? paths.length : 0;

		// Telemetry
		// __GDPR__TODO__ Dynamic event names and dynamic properties. Can not be registered statically.
		this.telemetryService.publicLog(telemetryEventName, {
			...telemetryExtraData,
			outcome: numberOfPaths ? 'success' : 'canceled',
			numberOfPaths
		});
	}

	//#endregion

	//#region OS

	async showItemInFolder(windowId: number | undefined, path: string): Promise<void> {
		shell.showItemInFolder(path);
	}

	async setRepresentedFilename(windowId: number | undefined, path: string): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.setRepresentedFilename(path);
		}
	}

	async setDocumentEdited(windowId: number | undefined, edited: boolean): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.setDocumentEdited(edited);
		}
	}

	async openExternal(windowId: number | undefined, url: string): Promise<boolean> {
		shell.openExternal(url);

		return true;
	}

	async updateTouchBar(windowId: number | undefined, items: ISerializableCommandAction[][]): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.updateTouchBar(items);
		}
	}

	async moveItemToTrash(windowId: number | undefined, fullPath: string): Promise<boolean> {
		return shell.moveItemToTrash(fullPath);
	}

	async isAdmin(): Promise<boolean> {
		let isAdmin: boolean;
		if (isWindows) {
			isAdmin = (await import('native-is-elevated'))();
		} else {
			isAdmin = isRootUser();
		}

		return isAdmin;
	}

	async getTotalMem(): Promise<number> {
		return totalmem();
	}

	//#endregion


	//#region Process

	async killProcess(windowId: number | undefined, pid: number, code: string): Promise<void> {
		process.kill(pid, code);
	}

	//#endregion


	//#region clipboard

	async readClipboardText(windowId: number | undefined, type?: 'selection' | 'clipboard'): Promise<string> {
		return clipboard.readText(type);
	}

	async writeClipboardText(windowId: number | undefined, text: string, type?: 'selection' | 'clipboard'): Promise<void> {
		return clipboard.writeText(text, type);
	}

	async readClipboardFindText(windowId: number | undefined,): Promise<string> {
		return clipboard.readFindText();
	}

	async writeClipboardFindText(windowId: number | undefined, text: string): Promise<void> {
		return clipboard.writeFindText(text);
	}

	async writeClipboardBuffer(windowId: number | undefined, format: string, buffer: Uint8Array, type?: 'selection' | 'clipboard'): Promise<void> {
		return clipboard.writeBuffer(format, Buffer.from(buffer), type);
	}

	async readClipboardBuffer(windowId: number | undefined, format: string): Promise<Uint8Array> {
		return clipboard.readBuffer(format);
	}

	async hasClipboard(windowId: number | undefined, format: string, type?: 'selection' | 'clipboard'): Promise<boolean> {
		return clipboard.has(format, type);
	}

	//#endregion

	//#region macOS Touchbar

	async newWindowTab(): Promise<void> {
		this.windowsMainService.open({ context: OpenContext.API, cli: this.environmentService.args, forceNewTabbedWindow: true, forceEmpty: true });
	}

	async showPreviousWindowTab(): Promise<void> {
		Menu.sendActionToFirstResponder('selectPreviousTab:');
	}

	async showNextWindowTab(): Promise<void> {
		Menu.sendActionToFirstResponder('selectNextTab:');
	}

	async moveWindowTabToNewWindow(): Promise<void> {
		Menu.sendActionToFirstResponder('moveTabToNewWindow:');
	}

	async mergeAllWindowTabs(): Promise<void> {
		Menu.sendActionToFirstResponder('mergeAllWindows:');
	}

	async toggleWindowTabsBar(): Promise<void> {
		Menu.sendActionToFirstResponder('toggleTabBar:');
	}

	//#endregion

	//#region Lifecycle

	async notifyReady(windowId: number | undefined): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.setReady();
		}
	}

	async relaunch(windowId: number | undefined, options?: { addArgs?: string[], removeArgs?: string[] }): Promise<void> {
		return this.lifecycleMainService.relaunch(options);
	}

	async reload(windowId: number | undefined, options?: { disableExtensions?: boolean }): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			return this.lifecycleMainService.reload(window, options?.disableExtensions ? { _: [], 'disable-extensions': true } : undefined);
		}
	}

	async closeWindow(windowId: number | undefined): Promise<void> {
		this.closeWindowById(windowId, windowId);
	}

	async closeWindowById(currentWindowId: number | undefined, targetWindowId?: number | undefined): Promise<void> {
		const window = this.windowById(targetWindowId);
		if (window) {
			return window.win.close();
		}
	}

	async quit(windowId: number | undefined): Promise<void> {

		// If the user selected to exit from an extension development host window, do not quit, but just
		// close the window unless this is the last window that is opened.
		const window = this.windowsMainService.getLastActiveWindow();
		if (window?.isExtensionDevelopmentHost && this.windowsMainService.getWindowCount() > 1) {
			window.win.close();
		}

		// Otherwise: normal quit
		else {
			setTimeout(() => {
				this.lifecycleMainService.quit();
			}, 10 /* delay to unwind callback stack (IPC) */);
		}
	}

	async exit(windowId: number | undefined, code: number): Promise<void> {
		await this.lifecycleMainService.kill(code);
	}

	//#endregion

	//#region Connectivity

	async resolveProxy(windowId: number | undefined, url: string): Promise<string | undefined> {
		const window = this.windowById(windowId);
		const session = window?.win?.webContents?.session;
		if (session) {
			return session.resolveProxy(url);
		} else {
			return undefined;
		}
	}

	//#endregion

	//#region Development

	async openDevTools(windowId: number | undefined, options?: OpenDevToolsOptions): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.win.webContents.openDevTools(options);
		}
	}

	async toggleDevTools(windowId: number | undefined): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			const contents = window.win.webContents;
			if (isMacintosh && window.hasHiddenTitleBarStyle && !window.isFullScreen && !contents.isDevToolsOpened()) {
				contents.openDevTools({ mode: 'undocked' }); // due to https://github.com/electron/electron/issues/3647
			} else {
				contents.toggleDevTools();
			}
		}
	}

	async sendInputEvent(windowId: number | undefined, event: MouseInputEvent): Promise<void> {
		const window = this.windowById(windowId);
		if (window && (event.type === 'mouseDown' || event.type === 'mouseUp')) {
			window.win.webContents.sendInputEvent(event);
		}
	}

	//#endregion

	private windowById(windowId: number | undefined): ICodeWindow | undefined {
		if (typeof windowId !== 'number') {
			return undefined;
		}

		return this.windowsMainService.getWindowById(windowId);
	}
}
