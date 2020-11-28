/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Emitter, Event } from 'vs/base/common/event';
import { IWindowsMainService, ICodeWindow } from 'vs/platform/windows/electron-main/windows';
import { MessageBoxOptions, MessageBoxReturnValue, shell, OpenDevToolsOptions, SaveDialogOptions, SaveDialogReturnValue, OpenDialogOptions, OpenDialogReturnValue, Menu, BrowserWindow, app, clipboard, powerMonitor, nativeTheme } from 'electron';
import { OpenContext } from 'vs/platform/windows/node/window';
import { ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { IOpenedWindow, IOpenWindowOptions, IWindowOpenable, IOpenEmptyWindowOptions, IColorScheme } from 'vs/platform/windows/common/windows';
import { INativeOpenDialogOptions } from 'vs/platform/dialogs/common/dialogs';
import { isMacintosh, isWindows, isLinux } from 'vs/base/common/platform';
import { ICommonNativeHostService, IOSProperties, IOSStatistics } from 'vs/platform/native/common/native';
import { ISerializableCommandAction } from 'vs/platform/actions/common/actions';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { AddFirstParameterToFunctions } from 'vs/base/common/types';
import { IDialogMainService } from 'vs/platform/dialogs/electron-main/dialogs';
import { dirExists } from 'vs/base/node/pfs';
import { URI } from 'vs/base/common/uri';
import { ITelemetryData, ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { MouseInputEvent } from 'vs/base/parts/sandbox/common/electronTypes';
import { arch, totalmem, release, platform, type, loadavg, freemem, cpus } from 'os';
import { virtualMachineHint } from 'vs/base/node/id';
import { ILogService } from 'vs/platform/log/common/log';
import { dirname, join } from 'vs/base/common/path';
import product from 'vs/platform/product/common/product';
import { memoize } from 'vs/base/common/decorators';
import { Disposable } from 'vs/base/common/lifecycle';

export interface INativeHostMainService extends AddFirstParameterToFunctions<ICommonNativeHostService, Promise<unknown> /* only methods, not events */, number | undefined /* window ID */> { }

export const INativeHostMainService = createDecorator<INativeHostMainService>('nativeHostMainService');

interface ChunkedPassword {
	content: string;
	hasNextChunk: boolean;
}

export class NativeHostMainService extends Disposable implements INativeHostMainService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@IDialogMainService private readonly dialogMainService: IDialogMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IEnvironmentMainService private readonly environmentService: IEnvironmentMainService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@ILogService private readonly logService: ILogService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		// Color Scheme changes
		nativeTheme.on('updated', () => {
			this._onDidChangeColorScheme.fire({
				highContrast: nativeTheme.shouldUseInvertedColorScheme || nativeTheme.shouldUseHighContrastColors,
				dark: nativeTheme.shouldUseDarkColors
			});
		});
	}


	//#region Properties

	get windowId(): never { throw new Error('Not implemented in electron-main'); }

	//#endregion

	//#region Events

	readonly onDidOpenWindow = Event.map(this.windowsMainService.onWindowOpened, window => window.id);

	readonly onDidMaximizeWindow = Event.filter(Event.fromNodeEventEmitter(app, 'browser-window-maximize', (event, window: BrowserWindow) => window.id), windowId => !!this.windowsMainService.getWindowById(windowId));
	readonly onDidUnmaximizeWindow = Event.filter(Event.fromNodeEventEmitter(app, 'browser-window-unmaximize', (event, window: BrowserWindow) => window.id), windowId => !!this.windowsMainService.getWindowById(windowId));

	readonly onDidBlurWindow = Event.filter(Event.fromNodeEventEmitter(app, 'browser-window-blur', (event, window: BrowserWindow) => window.id), windowId => !!this.windowsMainService.getWindowById(windowId));
	readonly onDidFocusWindow = Event.any(
		Event.map(Event.filter(Event.map(this.windowsMainService.onWindowsCountChanged, () => this.windowsMainService.getLastActiveWindow()), window => !!window), window => window!.id),
		Event.filter(Event.fromNodeEventEmitter(app, 'browser-window-focus', (event, window: BrowserWindow) => window.id), windowId => !!this.windowsMainService.getWindowById(windowId))
	);

	readonly onDidResumeOS = Event.fromNodeEventEmitter(powerMonitor, 'resume');

	private readonly _onDidChangeColorScheme = this._register(new Emitter<IColorScheme>());
	readonly onDidChangeColorScheme = this._onDidChangeColorScheme.event;

	private readonly _onDidChangePassword = this._register(new Emitter<void>());
	readonly onDidChangePassword = this._onDidChangePassword.event;

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

	async focusWindow(windowId: number | undefined, options?: { windowId?: number; force?: boolean; }): Promise<void> {
		if (options && typeof options.windowId === 'number') {
			windowId = options.windowId;
		}

		const window = this.windowById(windowId);
		if (window) {
			window.focus({ force: options?.force ?? false });
		}
	}

	async setMinimumSize(windowId: number | undefined, width: number | undefined, height: number | undefined): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			const [windowWidth, windowHeight] = window.win.getSize();
			const [minWindowWidth, minWindowHeight] = window.win.getMinimumSize();
			const [newMinWindowWidth, newMinWindowHeight] = [width ?? minWindowWidth, height ?? minWindowHeight];
			const [newWindowWidth, newWindowHeight] = [Math.max(windowWidth, newMinWindowWidth), Math.max(windowHeight, newMinWindowHeight)];

			if (minWindowWidth !== newMinWindowWidth || minWindowHeight !== newMinWindowHeight) {
				window.win.setMinimumSize(newMinWindowWidth, newMinWindowHeight);
			}
			if (windowWidth !== newWindowWidth || windowHeight !== newWindowHeight) {
				window.win.setSize(newWindowWidth, newWindowHeight);
			}
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
		if (isLinux && process.env.SNAP && process.env.SNAP_REVISION) {
			NativeHostMainService._safeSnapOpenExternal(url);
		} else {
			shell.openExternal(url);
		}

		return true;
	}

	private static _safeSnapOpenExternal(url: string): void {
		const gdkPixbufModuleFile = process.env['GDK_PIXBUF_MODULE_FILE'];
		const gdkPixbufModuleDir = process.env['GDK_PIXBUF_MODULEDIR'];
		delete process.env['GDK_PIXBUF_MODULE_FILE'];
		delete process.env['GDK_PIXBUF_MODULEDIR'];

		shell.openExternal(url);

		process.env['GDK_PIXBUF_MODULE_FILE'] = gdkPixbufModuleFile;
		process.env['GDK_PIXBUF_MODULEDIR'] = gdkPixbufModuleDir;
	}

	async moveItemToTrash(windowId: number | undefined, fullPath: string): Promise<boolean> {
		return shell.moveItemToTrash(fullPath);
	}

	async isAdmin(): Promise<boolean> {
		let isAdmin: boolean;
		if (isWindows) {
			isAdmin = (await import('native-is-elevated'))();
		} else {
			isAdmin = process.getuid() === 0;
		}

		return isAdmin;
	}

	async writeElevated(windowId: number | undefined, source: URI, target: URI, options?: { overwriteReadonly?: boolean }): Promise<void> {
		const sudoPrompt = await import('sudo-prompt');

		return new Promise<void>((resolve, reject) => {
			const sudoCommand: string[] = [`"${this.cliPath}"`];
			if (options?.overwriteReadonly) {
				sudoCommand.push('--file-chmod');
			}

			sudoCommand.push('--file-write', `"${source.fsPath}"`, `"${target.fsPath}"`);

			const promptOptions = {
				name: product.nameLong.replace('-', ''),
				icns: (isMacintosh && this.environmentService.isBuilt) ? join(dirname(this.environmentService.appRoot), `${product.nameShort}.icns`) : undefined
			};

			sudoPrompt.exec(sudoCommand.join(' '), promptOptions, (error: string, stdout: string, stderr: string) => {
				if (stdout) {
					this.logService.trace(`[sudo-prompt] received stdout: ${stdout}`);
				}

				if (stderr) {
					this.logService.trace(`[sudo-prompt] received stderr: ${stderr}`);
				}

				if (error) {
					reject(error);
				} else {
					resolve(undefined);
				}
			});
		});
	}

	@memoize
	private get cliPath(): string {

		// Windows
		if (isWindows) {
			if (this.environmentService.isBuilt) {
				return join(dirname(process.execPath), 'bin', `${product.applicationName}.cmd`);
			}

			return join(this.environmentService.appRoot, 'scripts', 'code-cli.bat');
		}

		// Linux
		if (isLinux) {
			if (this.environmentService.isBuilt) {
				return join(dirname(process.execPath), 'bin', `${product.applicationName}`);
			}

			return join(this.environmentService.appRoot, 'scripts', 'code-cli.sh');
		}

		// macOS
		if (this.environmentService.isBuilt) {
			return join(this.environmentService.appRoot, 'bin', 'code');
		}

		return join(this.environmentService.appRoot, 'scripts', 'code-cli.sh');
	}

	async getOSStatistics(): Promise<IOSStatistics> {
		return {
			totalmem: totalmem(),
			freemem: freemem(),
			loadavg: loadavg()
		};
	}

	async getOSProperties(): Promise<IOSProperties> {
		return {
			arch: arch(),
			platform: platform(),
			release: release(),
			type: type(),
			cpus: cpus()
		};
	}

	async getOSVirtualMachineHint(): Promise<number> {
		return virtualMachineHint.value();
	}

	//#endregion


	//#region Process

	async killProcess(windowId: number | undefined, pid: number, code: string): Promise<void> {
		process.kill(pid, code);
	}

	//#endregion


	//#region Clipboard

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

	async updateTouchBar(windowId: number | undefined, items: ISerializableCommandAction[][]): Promise<void> {
		const window = this.windowById(windowId);
		if (window) {
			window.updateTouchBar(items);
		}
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
			return this.lifecycleMainService.reload(window, options?.disableExtensions !== undefined ? { _: [], 'disable-extensions': options?.disableExtensions } : undefined);
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
			contents.toggleDevTools();
		}
	}

	async sendInputEvent(windowId: number | undefined, event: MouseInputEvent): Promise<void> {
		const window = this.windowById(windowId);
		if (window && (event.type === 'mouseDown' || event.type === 'mouseUp')) {
			window.win.webContents.sendInputEvent(event);
		}
	}

	//#endregion

	//#region Registry (windows)

	async windowsGetStringRegKey(windowId: number | undefined, hive: 'HKEY_CURRENT_USER' | 'HKEY_LOCAL_MACHINE' | 'HKEY_CLASSES_ROOT' | 'HKEY_USERS' | 'HKEY_CURRENT_CONFIG', path: string, name: string): Promise<string | undefined> {
		if (!isWindows) {
			return undefined;
		}

		const Registry = await import('vscode-windows-registry');
		try {
			return Registry.GetStringRegKey(hive, path, name);
		} catch {
			return undefined;
		}
	}

	//#endregion

	//#region Credentials

	private static readonly MAX_PASSWORD_LENGTH = 2500;
	private static readonly PASSWORD_CHUNK_SIZE = NativeHostMainService.MAX_PASSWORD_LENGTH - 100;

	async getPassword(windowId: number | undefined, service: string, account: string): Promise<string | null> {
		const keytar = await import('keytar');

		const password = await keytar.getPassword(service, account);
		if (password) {
			try {
				let { content, hasNextChunk }: ChunkedPassword = JSON.parse(password);
				if (!content || !hasNextChunk) {
					return password;
				}

				let index = 1;
				while (hasNextChunk) {
					const nextChunk = await keytar.getPassword(service, `${account}-${index}`);
					const result: ChunkedPassword = JSON.parse(nextChunk!);
					content += result.content;
					hasNextChunk = result.hasNextChunk;
				}

				return content;
			} catch {
				return password;
			}
		}

		return password;
	}

	async setPassword(windowId: number | undefined, service: string, account: string, password: string): Promise<void> {
		const keytar = await import('keytar');

		if (isWindows && password.length > NativeHostMainService.MAX_PASSWORD_LENGTH) {
			let index = 0;
			let chunk = 0;
			let hasNextChunk = true;
			while (hasNextChunk) {
				const passwordChunk = password.substring(index, index + NativeHostMainService.PASSWORD_CHUNK_SIZE);
				index += NativeHostMainService.PASSWORD_CHUNK_SIZE;
				hasNextChunk = password.length - index > 0;

				const content: ChunkedPassword = {
					content: passwordChunk,
					hasNextChunk: hasNextChunk
				};

				await keytar.setPassword(service, chunk ? `${account}-${chunk}` : account, JSON.stringify(content));
				chunk++;
			}

		} else {
			await keytar.setPassword(service, account, password);
		}

		this._onDidChangePassword.fire();
	}

	async deletePassword(windowId: number | undefined, service: string, account: string): Promise<boolean> {
		const keytar = await import('keytar');

		const didDelete = await keytar.deletePassword(service, account);
		if (didDelete) {
			this._onDidChangePassword.fire();
		}

		return didDelete;
	}

	async findPassword(windowId: number | undefined, service: string): Promise<string | null> {
		const keytar = await import('keytar');

		return keytar.findPassword(service);
	}

	async findCredentials(windowId: number | undefined, service: string): Promise<Array<{ account: string, password: string }>> {
		const keytar = await import('keytar');

		return keytar.findCredentials(service);
	}

	//#endregion

	private windowById(windowId: number | undefined): ICodeWindow | undefined {
		if (typeof windowId !== 'number') {
			return undefined;
		}

		return this.windowsMainService.getWindowById(windowId);
	}
}
