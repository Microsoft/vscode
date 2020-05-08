/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import * as objects from 'vs/base/common/objects';
import * as nls from 'vs/nls';
import { Emitter } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';
import { screen, BrowserWindow, systemPreferences, app, TouchBar, nativeImage, Rectangle, Display, TouchBarSegmentedControl, NativeImage, BrowserWindowConstructorOptions, SegmentedControlSegment, nativeTheme } from 'electron';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { ILogService } from 'vs/platform/log/common/log';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { parseArgs, OPTIONS, ParsedArgs } from 'vs/platform/environment/node/argv';
import product from 'vs/platform/product/common/product';
import { IWindowSettings, MenuBarVisibility, getTitleBarStyle, getMenuBarVisibility } from 'vs/platform/windows/common/windows';
import { Disposable, toDisposable } from 'vs/base/common/lifecycle';
import { isLinux, isMacintosh, isWindows } from 'vs/base/common/platform';
import { ICodeWindow, IWindowState, WindowMode } from 'vs/platform/windows/electron-main/windows';
import { INativeWindowConfiguration } from 'vs/platform/windows/node/window';
import { IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { IWorkspacesMainService } from 'vs/platform/workspaces/electron-main/workspacesMainService';
import { IBackupMainService } from 'vs/platform/backup/electron-main/backup';
import { ISerializableCommandAction } from 'vs/platform/actions/common/actions';
import * as perf from 'vs/base/common/performance';
import { resolveMarketplaceHeaders } from 'vs/platform/extensionManagement/common/extensionGalleryService';
import { IThemeMainService } from 'vs/platform/theme/electron-main/themeMainService';
import { RunOnceScheduler } from 'vs/base/common/async';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IDialogMainService } from 'vs/platform/dialogs/electron-main/dialogs';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { ThemeIcon } from 'vs/platform/theme/common/themeService';
import { ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { IStorageMainService } from 'vs/platform/storage/node/storageMainService';
import { IFileService } from 'vs/platform/files/common/files';

const RUN_TEXTMATE_IN_WORKER = false;

export interface IWindowCreationOptions {
	state: IWindowState;
	extensionDevelopmentPath?: string[];
	isExtensionTestHost?: boolean;
}

export const defaultWindowState = function (mode = WindowMode.Normal): IWindowState {
	return {
		width: 1024,
		height: 768,
		mode
	};
};

interface ITouchBarSegment extends SegmentedControlSegment {
	id: string;
}

const enum WindowError {
	UNRESPONSIVE = 1,
	CRASHED = 2
}

const enum ReadyState {

	/**
	 * This window has not loaded any HTML yet
	 */
	NONE,

	/**
	 * This window is loading HTML
	 */
	LOADING,

	/**
	 * This window is navigating to another HTML
	 */
	NAVIGATING,

	/**
	 * This window is done loading HTML
	 */
	READY
}

export class CodeWindow extends Disposable implements ICodeWindow {

	private static readonly MIN_WIDTH = 600;
	private static readonly MIN_HEIGHT = 270;

	private static readonly MAX_URL_LENGTH = 2 * 1024 * 1024; // https://cs.chromium.org/chromium/src/url/url_constants.cc?l=32

	private readonly _onClose = this._register(new Emitter<void>());
	readonly onClose = this._onClose.event;

	private readonly _onDestroy = this._register(new Emitter<void>());
	readonly onDestroy = this._onDestroy.event;

	private readonly _onLoad = this._register(new Emitter<void>());
	readonly onLoad = this._onLoad.event;

	private hiddenTitleBarStyle: boolean | undefined;
	private showTimeoutHandle: NodeJS.Timeout | undefined;
	private _lastFocusTime: number;
	private _readyState: ReadyState;
	private windowState: IWindowState;
	private currentMenuBarVisibility: MenuBarVisibility | undefined;

	private representedFilename: string | undefined;
	private documentEdited: boolean | undefined;

	private readonly whenReadyCallbacks: { (window: ICodeWindow): void }[];

	private pendingLoadConfig?: INativeWindowConfiguration;

	private marketplaceHeadersPromise: Promise<object>;

	private readonly touchBarGroups: TouchBarSegmentedControl[];

	private currentHttpProxy?: string;
	private currentNoProxy?: string;

	constructor(
		config: IWindowCreationOptions,
		@ILogService private readonly logService: ILogService,
		@IEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@IFileService private readonly fileService: IFileService,
		@IStorageMainService private readonly storageService: IStorageMainService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IThemeMainService private readonly themeMainService: IThemeMainService,
		@IWorkspacesMainService private readonly workspacesMainService: IWorkspacesMainService,
		@IBackupMainService private readonly backupMainService: IBackupMainService,
		@ITelemetryService private readonly telemetryService: ITelemetryService,
		@IDialogMainService private readonly dialogMainService: IDialogMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService
	) {
		super();

		this.touchBarGroups = [];
		this._lastFocusTime = -1;
		this._readyState = ReadyState.NONE;
		this.whenReadyCallbacks = [];

		//#region create browser window
		{
			// Load window state
			const [state, hasMultipleDisplays] = this.restoreWindowState(config.state);
			this.windowState = state;
			this.logService.trace('window#ctor: using window state', state);

			// in case we are maximized or fullscreen, only show later after the call to maximize/fullscreen (see below)
			const isFullscreenOrMaximized = (this.windowState.mode === WindowMode.Maximized || this.windowState.mode === WindowMode.Fullscreen);

			const options: BrowserWindowConstructorOptions = {
				width: this.windowState.width,
				height: this.windowState.height,
				x: this.windowState.x,
				y: this.windowState.y,
				backgroundColor: this.themeMainService.getBackgroundColor(),
				minWidth: CodeWindow.MIN_WIDTH,
				minHeight: CodeWindow.MIN_HEIGHT,
				show: !isFullscreenOrMaximized,
				title: product.nameLong,
				webPreferences: {
					nodeIntegration: true,
					nodeIntegrationInWorker: RUN_TEXTMATE_IN_WORKER,
					webviewTag: true
				}
			};

			// Apply icon to window
			// Linux: always
			// Windows: only when running out of sources, otherwise an icon is set by us on the executable
			if (isLinux) {
				options.icon = path.join(this.environmentService.appRoot, 'resources/linux/code.png');
			} else if (isWindows && !this.environmentService.isBuilt) {
				options.icon = path.join(this.environmentService.appRoot, 'resources/win32/code_150x150.png');
			}

			const windowConfig = this.configurationService.getValue<IWindowSettings>('window');

			if (isMacintosh && !this.useNativeFullScreen()) {
				options.fullscreenable = false; // enables simple fullscreen mode
			}

			if (isMacintosh) {
				options.acceptFirstMouse = true; // enabled by default

				if (windowConfig?.clickThroughInactive === false) {
					options.acceptFirstMouse = false;
				}
			}

			const useNativeTabs = isMacintosh && windowConfig?.nativeTabs === true;
			if (useNativeTabs) {
				options.tabbingIdentifier = product.nameShort; // this opts in to sierra tabs
			}

			const useCustomTitleStyle = getTitleBarStyle(this.configurationService, this.environmentService, !!config.extensionDevelopmentPath) === 'custom';
			if (useCustomTitleStyle) {
				options.titleBarStyle = 'hidden';
				this.hiddenTitleBarStyle = true;
				if (!isMacintosh) {
					options.frame = false;
				}
			}

			// Create the browser window.
			this._win = new BrowserWindow(options);
			this._id = this._win.id;

			if (isMacintosh && useCustomTitleStyle) {
				this._win.setSheetOffset(22); // offset dialogs by the height of the custom title bar if we have any
			}

			// TODO@Ben (Electron 4 regression): when running on multiple displays where the target display
			// to open the window has a larger resolution than the primary display, the window will not size
			// correctly unless we set the bounds again (https://github.com/microsoft/vscode/issues/74872)
			//
			// However, when running with native tabs with multiple windows we cannot use this workaround
			// because there is a potential that the new window will be added as native tab instead of being
			// a window on its own. In that case calling setBounds() would cause https://github.com/microsoft/vscode/issues/75830
			if (isMacintosh && hasMultipleDisplays && (!useNativeTabs || BrowserWindow.getAllWindows().length === 1)) {
				if ([this.windowState.width, this.windowState.height, this.windowState.x, this.windowState.y].every(value => typeof value === 'number')) {
					const ensuredWindowState = this.windowState as Required<IWindowState>;
					this._win.setBounds({
						width: ensuredWindowState.width,
						height: ensuredWindowState.height,
						x: ensuredWindowState.x,
						y: ensuredWindowState.y
					});
				}
			}

			if (isFullscreenOrMaximized) {
				this._win.maximize();

				if (this.windowState.mode === WindowMode.Fullscreen) {
					this.setFullScreen(true);
				}

				if (!this._win.isVisible()) {
					this._win.show(); // to reduce flicker from the default window size to maximize, we only show after maximize
				}
			}

			this._lastFocusTime = Date.now(); // since we show directly, we need to set the last focus time too
		}
		//#endregion

		// respect configured menu bar visibility
		this.onConfigurationUpdated();

		// macOS: touch bar support
		this.createTouchBar();

		// Request handling
		const that = this;
		this.marketplaceHeadersPromise = resolveMarketplaceHeaders(product.version, this.environmentService, this.fileService, {
			get(key) { return that.storageService.get(key); },
			store(key, value) { that.storageService.store(key, value); }
		});

		// Eventing
		this.registerListeners();
	}

	private currentConfig: INativeWindowConfiguration | undefined;
	get config(): INativeWindowConfiguration | undefined { return this.currentConfig; }

	private _id: number;
	get id(): number { return this._id; }

	private _win: BrowserWindow;
	get win(): BrowserWindow { return this._win; }

	get hasHiddenTitleBarStyle(): boolean { return !!this.hiddenTitleBarStyle; }

	get isExtensionDevelopmentHost(): boolean { return !!(this.config && this.config.extensionDevelopmentPath); }

	get isExtensionTestHost(): boolean { return !!(this.config && this.config.extensionTestsPath); }

	get isExtensionDevelopmentTestFromCli(): boolean { return this.isExtensionDevelopmentHost && this.isExtensionTestHost && !this.config?.debugId; }

	setRepresentedFilename(filename: string): void {
		if (isMacintosh) {
			this.win.setRepresentedFilename(filename);
		} else {
			this.representedFilename = filename;
		}
	}

	getRepresentedFilename(): string | undefined {
		if (isMacintosh) {
			return this.win.getRepresentedFilename();
		}

		return this.representedFilename;
	}

	setDocumentEdited(edited: boolean): void {
		if (isMacintosh) {
			this._win.setDocumentEdited(edited);
		}

		this.documentEdited = edited;
	}

	isDocumentEdited(): boolean {
		if (isMacintosh) {
			return this._win.isDocumentEdited();
		}

		return !!this.documentEdited;
	}

	focus(): void {
		if (!this._win) {
			return;
		}

		if (this._win.isMinimized()) {
			this._win.restore();
		}

		this._win.focus();
	}

	get lastFocusTime(): number { return this._lastFocusTime; }

	get backupPath(): string | undefined { return this.currentConfig ? this.currentConfig.backupPath : undefined; }

	get openedWorkspace(): IWorkspaceIdentifier | undefined { return this.currentConfig ? this.currentConfig.workspace : undefined; }

	get openedFolderUri(): URI | undefined { return this.currentConfig ? this.currentConfig.folderUri : undefined; }

	get remoteAuthority(): string | undefined { return this.currentConfig ? this.currentConfig.remoteAuthority : undefined; }

	setReady(): void {
		this._readyState = ReadyState.READY;

		// inform all waiting promises that we are ready now
		while (this.whenReadyCallbacks.length) {
			this.whenReadyCallbacks.pop()!(this);
		}
	}

	ready(): Promise<ICodeWindow> {
		return new Promise<ICodeWindow>(resolve => {
			if (this.isReady) {
				return resolve(this);
			}

			// otherwise keep and call later when we are ready
			this.whenReadyCallbacks.push(resolve);
		});
	}

	get isReady(): boolean {
		return this._readyState === ReadyState.READY;
	}

	get whenClosedOrLoaded(): Promise<void> {
		return new Promise<void>(resolve => {

			function handle() {
				closeListener.dispose();
				loadListener.dispose();

				resolve();
			}

			const closeListener = this.onClose(() => handle());
			const loadListener = this.onLoad(() => handle());
		});
	}

	private registerListeners(): void {

		// Crashes & Unrsponsive
		this._win.webContents.on('crashed', () => this.onWindowError(WindowError.CRASHED));
		this._win.on('unresponsive', () => this.onWindowError(WindowError.UNRESPONSIVE));

		// Window close
		this._win.on('closed', () => {
			this._onClose.fire();

			this.dispose();
		});

		// Prevent loading of svgs
		this._win.webContents.session.webRequest.onBeforeRequest(null!, (details, callback) => {
			if (details.url.indexOf('.svg') > 0) {
				const uri = URI.parse(details.url);
				if (uri && !uri.scheme.match(/file/i) && uri.path.endsWith('.svg')) {
					return callback({ cancel: true });
				}
			}

			return callback({});
		});

		this._win.webContents.session.webRequest.onHeadersReceived(null!, (details, callback) => {
			const responseHeaders = details.responseHeaders as Record<string, (string) | (string[])>;

			const contentType = (responseHeaders['content-type'] || responseHeaders['Content-Type']);
			if (contentType && Array.isArray(contentType) && contentType.some(x => x.toLowerCase().indexOf('image/svg') >= 0)) {
				return callback({ cancel: true });
			}

			return callback({ cancel: false });
		});

		// Remember that we loaded
		this._win.webContents.on('did-finish-load', () => {
			this._readyState = ReadyState.LOADING;

			// Associate properties from the load request if provided
			if (this.pendingLoadConfig) {
				this.currentConfig = this.pendingLoadConfig;

				this.pendingLoadConfig = undefined;
			}
		});

		// Window Focus
		this._win.on('focus', () => {
			this._lastFocusTime = Date.now();
		});

		// Simple fullscreen doesn't resize automatically when the resolution changes so as a workaround
		// we need to detect when display metrics change or displays are added/removed and toggle the
		// fullscreen manually.
		if (isMacintosh) {
			const simpleFullScreenScheduler = this._register(new RunOnceScheduler(() => {
				if (!this._win) {
					return; // disposed
				}

				if (!this.useNativeFullScreen() && this.isFullScreen) {
					this.setFullScreen(false);
					this.setFullScreen(true);
				}

				this.sendWhenReady('vscode:displayChanged');
			}, 100));

			const displayChangedListener = () => simpleFullScreenScheduler.schedule();

			screen.on('display-metrics-changed', displayChangedListener);
			this._register(toDisposable(() => screen.removeListener('display-metrics-changed', displayChangedListener)));

			screen.on('display-added', displayChangedListener);
			this._register(toDisposable(() => screen.removeListener('display-added', displayChangedListener)));

			screen.on('display-removed', displayChangedListener);
			this._register(toDisposable(() => screen.removeListener('display-removed', displayChangedListener)));
		}

		// Window (Un)Maximize
		this._win.on('maximize', (e: Event) => {
			if (this.currentConfig) {
				this.currentConfig.maximized = true;
			}

			app.emit('browser-window-maximize', e, this._win);
		});

		this._win.on('unmaximize', (e: Event) => {
			if (this.currentConfig) {
				this.currentConfig.maximized = false;
			}

			app.emit('browser-window-unmaximize', e, this._win);
		});

		// Window Fullscreen
		this._win.on('enter-full-screen', () => {
			this.sendWhenReady('vscode:enterFullScreen');
		});

		this._win.on('leave-full-screen', () => {
			this.sendWhenReady('vscode:leaveFullScreen');
		});

		// Window Failed to load
		this._win.webContents.on('did-fail-load', (event: Event, errorCode: number, errorDescription: string, validatedURL: string, isMainFrame: boolean) => {
			this.logService.warn('[electron event]: fail to load, ', errorDescription);
		});

		// Handle configuration changes
		this._register(this.configurationService.onDidChangeConfiguration(e => this.onConfigurationUpdated()));

		// Handle Workspace events
		this._register(this.workspacesMainService.onUntitledWorkspaceDeleted(e => this.onUntitledWorkspaceDeleted(e)));

		// Inject headers when requests are incoming
		const urls = ['https://marketplace.visualstudio.com/*', 'https://*.vsassets.io/*'];
		this._win.webContents.session.webRequest.onBeforeSendHeaders({ urls }, (details, cb) =>
			this.marketplaceHeadersPromise.then(headers => cb({ cancel: false, requestHeaders: Object.assign(details.requestHeaders, headers) })));
	}

	private onWindowError(error: WindowError): void {
		this.logService.error(error === WindowError.CRASHED ? '[VS Code]: renderer process crashed!' : '[VS Code]: detected unresponsive');

		// If we run extension tests from CLI, showing a dialog is not
		// very helpful in this case. Rather, we bring down the test run
		// to signal back a failing run.
		if (this.isExtensionDevelopmentTestFromCli) {
			this.lifecycleMainService.kill(1);
			return;
		}

		// Telemetry
		type WindowErrorClassification = {
			type: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
		};
		type WindowErrorEvent = {
			type: WindowError;
		};
		this.telemetryService.publicLog2<WindowErrorEvent, WindowErrorClassification>('windowerror', { type: error });

		// Unresponsive
		if (error === WindowError.UNRESPONSIVE) {
			if (this.isExtensionDevelopmentHost || this.isExtensionTestHost || (this._win && this._win.webContents && this._win.webContents.isDevToolsOpened())) {
				// TODO@Ben Workaround for https://github.com/Microsoft/vscode/issues/56994
				// In certain cases the window can report unresponsiveness because a breakpoint was hit
				// and the process is stopped executing. The most typical cases are:
				// - devtools are opened and debugging happens
				// - window is an extensions development host that is being debugged
				// - window is an extension test development host that is being debugged
				return;
			}

			// Show Dialog
			this.dialogMainService.showMessageBox({
				title: product.nameLong,
				type: 'warning',
				buttons: [mnemonicButtonLabel(nls.localize({ key: 'reopen', comment: ['&& denotes a mnemonic'] }, "&&Reopen")), mnemonicButtonLabel(nls.localize({ key: 'wait', comment: ['&& denotes a mnemonic'] }, "&&Keep Waiting")), mnemonicButtonLabel(nls.localize({ key: 'close', comment: ['&& denotes a mnemonic'] }, "&&Close"))],
				message: nls.localize('appStalled', "The window is no longer responding"),
				detail: nls.localize('appStalledDetail', "You can reopen or close the window or keep waiting."),
				noLink: true
			}, this._win).then(result => {
				if (!this._win) {
					return; // Return early if the window has been going down already
				}

				if (result.response === 0) {
					this.reload();
				} else if (result.response === 2) {
					this.destroyWindow();
				}
			});
		}

		// Crashed
		else {
			this.dialogMainService.showMessageBox({
				title: product.nameLong,
				type: 'warning',
				buttons: [mnemonicButtonLabel(nls.localize({ key: 'reopen', comment: ['&& denotes a mnemonic'] }, "&&Reopen")), mnemonicButtonLabel(nls.localize({ key: 'close', comment: ['&& denotes a mnemonic'] }, "&&Close"))],
				message: nls.localize('appCrashed', "The window has crashed"),
				detail: nls.localize('appCrashedDetail', "We are sorry for the inconvenience! You can reopen the window to continue where you left off."),
				noLink: true
			}, this._win).then(result => {
				if (!this._win) {
					return; // Return early if the window has been going down already
				}

				if (result.response === 0) {
					this.reload();
				} else if (result.response === 1) {
					this.destroyWindow();
				}
			});
		}
	}

	private destroyWindow(): void {
		this._onDestroy.fire(); // 'close' event will not be fired on destroy(), so signal crash via explicit event
		this._win.destroy(); 	// make sure to destroy the window as it has crashed
	}

	private onUntitledWorkspaceDeleted(workspace: IWorkspaceIdentifier): void {

		// Make sure to update our workspace config if we detect that it
		// was deleted
		if (this.openedWorkspace && this.openedWorkspace.id === workspace.id && this.currentConfig) {
			this.currentConfig.workspace = undefined;
		}
	}

	private onConfigurationUpdated(): void {
		const newMenuBarVisibility = this.getMenuBarVisibility();
		if (newMenuBarVisibility !== this.currentMenuBarVisibility) {
			this.currentMenuBarVisibility = newMenuBarVisibility;
			this.setMenuBarVisibility(newMenuBarVisibility);
		}
		// Do not set to empty configuration at startup if setting is empty to not override configuration through CLI options:
		const env = process.env;
		const newHttpProxy = (this.configurationService.getValue<string>('http.proxy') || '').trim()
			|| (env.https_proxy || process.env.HTTPS_PROXY || process.env.http_proxy || process.env.HTTP_PROXY || '').trim() // Not standardized.
			|| undefined;
		const newNoProxy = (env.no_proxy || env.NO_PROXY || '').trim() || undefined; // Not standardized.
		if ((newHttpProxy || '').indexOf('@') === -1 && (newHttpProxy !== this.currentHttpProxy || newNoProxy !== this.currentNoProxy)) {
			this.currentHttpProxy = newHttpProxy;
			this.currentNoProxy = newNoProxy;
			const proxyRules = newHttpProxy || '';
			const proxyBypassRules = newNoProxy ? `${newNoProxy},<local>` : '<local>';
			this.logService.trace(`Setting proxy to '${proxyRules}', bypassing '${proxyBypassRules}'`);
			this._win.webContents.session.setProxy({
				proxyRules,
				proxyBypassRules,
				pacScript: '',
			});
		}
	}

	addTabbedWindow(window: ICodeWindow): void {
		if (isMacintosh) {
			this._win.addTabbedWindow(window.win);
		}
	}

	load(config: INativeWindowConfiguration, isReload?: boolean, disableExtensions?: boolean): void {

		// If this is the first time the window is loaded, we associate the paths
		// directly with the window because we assume the loading will just work
		if (this._readyState === ReadyState.NONE) {
			this.currentConfig = config;
		}

		// Otherwise, the window is currently showing a folder and if there is an
		// unload handler preventing the load, we cannot just associate the paths
		// because the loading might be vetoed. Instead we associate it later when
		// the window load event has fired.
		else {
			this.pendingLoadConfig = config;
			this._readyState = ReadyState.NAVIGATING;
		}

		// Add disable-extensions to the config, but do not preserve it on currentConfig or
		// pendingLoadConfig so that it is applied only on this load
		const configuration = { ...config };
		if (disableExtensions !== undefined) {
			configuration['disable-extensions'] = disableExtensions;
		}

		// Clear Document Edited if needed
		if (this.isDocumentEdited()) {
			if (!isReload || !this.backupMainService.isHotExitEnabled()) {
				this.setDocumentEdited(false);
			}
		}

		// Clear Title and Filename if needed
		if (!isReload) {
			if (this.getRepresentedFilename()) {
				this.setRepresentedFilename('');
			}

			this._win.setTitle(product.nameLong);
		}

		// Load URL
		perf.mark('main:loadWindow');
		this._win.loadURL(this.getUrl(configuration));

		// Make window visible if it did not open in N seconds because this indicates an error
		// Only do this when running out of sources and not when running tests
		if (!this.environmentService.isBuilt && !this.environmentService.extensionTestsLocationURI) {
			this.showTimeoutHandle = setTimeout(() => {
				if (this._win && !this._win.isVisible() && !this._win.isMinimized()) {
					this._win.show();
					this._win.focus();
					this._win.webContents.openDevTools();
				}
			}, 10000);
		}

		// Event
		this._onLoad.fire();
	}

	reload(configurationIn?: INativeWindowConfiguration, cli?: ParsedArgs): void {

		// If config is not provided, copy our current one
		const configuration = configurationIn ? configurationIn : objects.mixin({}, this.currentConfig);

		// Delete some properties we do not want during reload
		delete configuration.filesToOpenOrCreate;
		delete configuration.filesToDiff;
		delete configuration.filesToWait;

		// Some configuration things get inherited if the window is being reloaded and we are
		// in extension development mode. These options are all development related.
		if (this.isExtensionDevelopmentHost && cli) {
			configuration.verbose = cli.verbose;
			configuration['inspect-extensions'] = cli['inspect-extensions'];
			configuration['inspect-brk-extensions'] = cli['inspect-brk-extensions'];
			configuration.debugId = cli.debugId;
			configuration['extensions-dir'] = cli['extensions-dir'];
		}

		configuration.isInitialStartup = false; // since this is a reload

		// Load config
		const disableExtensions = cli ? cli['disable-extensions'] : undefined;
		this.load(configuration, true, disableExtensions);
	}

	private getUrl(windowConfiguration: INativeWindowConfiguration): string {

		// Set window ID
		windowConfiguration.windowId = this._win.id;
		windowConfiguration.sessionId = `window:${this._win.id}`;
		windowConfiguration.logLevel = this.logService.getLevel();

		// Set zoomlevel
		const windowConfig = this.configurationService.getValue<IWindowSettings>('window');
		const zoomLevel = windowConfig?.zoomLevel;
		if (typeof zoomLevel === 'number') {
			windowConfiguration.zoomLevel = zoomLevel;
		}

		// Set fullscreen state
		windowConfiguration.fullscreen = this.isFullScreen;

		// Set Accessibility Config
		let autoDetectHighContrast = true;
		if (windowConfig?.autoDetectHighContrast === false) {
			autoDetectHighContrast = false;
		}
		windowConfiguration.highContrast = isWindows && autoDetectHighContrast && nativeTheme.shouldUseInvertedColorScheme;
		windowConfiguration.accessibilitySupport = app.accessibilitySupportEnabled;

		// Title style related
		windowConfiguration.maximized = this._win.isMaximized();

		// Dump Perf Counters
		windowConfiguration.perfEntries = perf.exportEntries();

		// Parts splash
		windowConfiguration.partsSplashPath = path.join(this.environmentService.userDataPath, 'rapid_render.json');

		// Config (combination of process.argv and window configuration)
		const environment = parseArgs(process.argv, OPTIONS);
		const config = Object.assign(environment, windowConfiguration) as unknown as { [key: string]: unknown };
		for (const key in config) {
			const configValue = config[key];
			if (configValue === undefined || configValue === null || configValue === '' || configValue === false) {
				delete config[key]; // only send over properties that have a true value
			}
		}

		// In the unlikely event of the URL becoming larger than 2MB, remove parts of
		// it that are not under our control. Mainly, the user environment can be very
		// large depending on user configuration, so we can only remove it in that case.
		let configUrl = this.doGetUrl(config);
		if (configUrl.length > CodeWindow.MAX_URL_LENGTH) {
			delete config.userEnv;
			this.logService.warn('Application URL exceeds maximum of 2MB and was shortened.');

			configUrl = this.doGetUrl(config);

			if (configUrl.length > CodeWindow.MAX_URL_LENGTH) {
				this.logService.error('Application URL exceeds maximum of 2MB and cannot be loaded.');
			}
		}

		return configUrl;
	}

	private doGetUrl(config: object): string {
		return `${require.toUrl('vs/code/electron-browser/workbench/workbench.html')}?config=${encodeURIComponent(JSON.stringify(config))}`;
	}

	serializeWindowState(): IWindowState {
		if (!this._win) {
			return defaultWindowState();
		}

		// fullscreen gets special treatment
		if (this.isFullScreen) {
			const display = screen.getDisplayMatching(this.getBounds());

			const defaultState = defaultWindowState();

			const res = {
				mode: WindowMode.Fullscreen,
				display: display ? display.id : undefined,

				// Still carry over window dimensions from previous sessions
				// if we can compute it in fullscreen state.
				// does not seem possible in all cases on Linux for example
				// (https://github.com/Microsoft/vscode/issues/58218) so we
				// fallback to the defaults in that case.
				width: this.windowState.width || defaultState.width,
				height: this.windowState.height || defaultState.height,
				x: this.windowState.x || 0,
				y: this.windowState.y || 0
			};

			return res;
		}

		const state: IWindowState = Object.create(null);
		let mode: WindowMode;

		// get window mode
		if (!isMacintosh && this._win.isMaximized()) {
			mode = WindowMode.Maximized;
		} else {
			mode = WindowMode.Normal;
		}

		// we don't want to save minimized state, only maximized or normal
		if (mode === WindowMode.Maximized) {
			state.mode = WindowMode.Maximized;
		} else {
			state.mode = WindowMode.Normal;
		}

		// only consider non-minimized window states
		if (mode === WindowMode.Normal || mode === WindowMode.Maximized) {
			let bounds: Rectangle;
			if (mode === WindowMode.Normal) {
				bounds = this.getBounds();
			} else {
				bounds = this._win.getNormalBounds(); // make sure to persist the normal bounds when maximized to be able to restore them
			}

			state.x = bounds.x;
			state.y = bounds.y;
			state.width = bounds.width;
			state.height = bounds.height;
		}

		return state;
	}

	private restoreWindowState(state?: IWindowState): [IWindowState, boolean? /* has multiple displays */] {
		let hasMultipleDisplays = false;
		if (state) {
			try {
				const displays = screen.getAllDisplays();
				hasMultipleDisplays = displays.length > 1;

				state = this.validateWindowState(state, displays);
			} catch (err) {
				this.logService.warn(`Unexpected error validating window state: ${err}\n${err.stack}`); // somehow display API can be picky about the state to validate
			}
		}

		return [state || defaultWindowState(), hasMultipleDisplays];
	}

	private validateWindowState(state: IWindowState, displays: Display[]): IWindowState | undefined {
		this.logService.trace(`window#validateWindowState: validating window state on ${displays.length} display(s)`, state);

		if (typeof state.x !== 'number'
			|| typeof state.y !== 'number'
			|| typeof state.width !== 'number'
			|| typeof state.height !== 'number'
		) {
			this.logService.trace('window#validateWindowState: unexpected type of state values');
			return undefined;
		}

		if (state.width <= 0 || state.height <= 0) {
			this.logService.trace('window#validateWindowState: unexpected negative values');
			return undefined;
		}

		// Single Monitor: be strict about x/y positioning
		// macOS & Linux: these OS seem to be pretty good in ensuring that a window is never outside of it's bounds.
		// Windows: it is possible to have a window with a size that makes it fall out of the window. our strategy
		//          is to try as much as possible to keep the window in the monitor bounds. we are not as strict as
		//          macOS and Linux and allow the window to exceed the monitor bounds as long as the window is still
		//          some pixels (128) visible on the screen for the user to drag it back.
		if (displays.length === 1) {
			const displayWorkingArea = this.getWorkingArea(displays[0]);
			if (displayWorkingArea) {
				this.logService.trace('window#validateWindowState: 1 monitor working area', displayWorkingArea);

				function ensureStateInDisplayWorkingArea(): void {
					if (!state || typeof state.x !== 'number' || typeof state.y !== 'number' || !displayWorkingArea) {
						return;
					}

					if (state.x < displayWorkingArea.x) {
						// prevent window from falling out of the screen to the left
						state.x = displayWorkingArea.x;
					}

					if (state.y < displayWorkingArea.y) {
						// prevent window from falling out of the screen to the top
						state.y = displayWorkingArea.y;
					}
				}

				// ensure state is not outside display working area (top, left)
				ensureStateInDisplayWorkingArea();

				if (state.width > displayWorkingArea.width) {
					// prevent window from exceeding display bounds width
					state.width = displayWorkingArea.width;
				}

				if (state.height > displayWorkingArea.height) {
					// prevent window from exceeding display bounds height
					state.height = displayWorkingArea.height;
				}

				if (state.x > (displayWorkingArea.x + displayWorkingArea.width - 128)) {
					// prevent window from falling out of the screen to the right with
					// 128px margin by positioning the window to the far right edge of
					// the screen
					state.x = displayWorkingArea.x + displayWorkingArea.width - state.width;
				}

				if (state.y > (displayWorkingArea.y + displayWorkingArea.height - 128)) {
					// prevent window from falling out of the screen to the bottom with
					// 128px margin by positioning the window to the far bottom edge of
					// the screen
					state.y = displayWorkingArea.y + displayWorkingArea.height - state.height;
				}

				// again ensure state is not outside display working area
				// (it may have changed from the previous validation step)
				ensureStateInDisplayWorkingArea();
			}

			return state;
		}

		// Multi Montior (fullscreen): try to find the previously used display
		if (state.display && state.mode === WindowMode.Fullscreen) {
			const display = displays.find(d => d.id === state.display);
			if (display && typeof display.bounds?.x === 'number' && typeof display.bounds?.y === 'number') {
				this.logService.trace('window#validateWindowState: restoring fullscreen to previous display');

				const defaults = defaultWindowState(WindowMode.Fullscreen); // make sure we have good values when the user restores the window
				defaults.x = display.bounds.x; // carefull to use displays x/y position so that the window ends up on the correct monitor
				defaults.y = display.bounds.y;

				return defaults;
			}
		}

		// Multi Monitor (non-fullscreen): ensure window is within display bounds
		const display = screen.getDisplayMatching({ x: state.x, y: state.y, width: state.width, height: state.height });
		const displayWorkingArea = this.getWorkingArea(display);
		if (
			display &&														// we have a display matching the desired bounds
			displayWorkingArea &&											// we have valid working area bounds
			state.x + state.width > displayWorkingArea.x &&					// prevent window from falling out of the screen to the left
			state.y + state.height > displayWorkingArea.y &&				// prevent window from falling out of the screen to the top
			state.x < displayWorkingArea.x + displayWorkingArea.width &&	// prevent window from falling out of the screen to the right
			state.y < displayWorkingArea.y + displayWorkingArea.height		// prevent window from falling out of the screen to the bottom
		) {
			this.logService.trace('window#validateWindowState: multi-monitor working area', displayWorkingArea);

			return state;
		}

		return undefined;
	}

	private getWorkingArea(display: Display): Rectangle | undefined {

		// Prefer the working area of the display to account for taskbars on the
		// desktop being positioned somewhere (https://github.com/Microsoft/vscode/issues/50830).
		//
		// Linux X11 sessions sometimes report wrong display bounds, so we validate
		// the reported sizes are positive.
		if (display.workArea.width > 0 && display.workArea.height > 0) {
			return display.workArea;
		}

		if (display.bounds.width > 0 && display.bounds.height > 0) {
			return display.bounds;
		}

		return undefined;
	}

	getBounds(): Rectangle {
		const pos = this._win.getPosition();
		const dimension = this._win.getSize();

		return { x: pos[0], y: pos[1], width: dimension[0], height: dimension[1] };
	}

	toggleFullScreen(): void {
		this.setFullScreen(!this.isFullScreen);
	}

	private setFullScreen(fullscreen: boolean): void {

		// Set fullscreen state
		if (this.useNativeFullScreen()) {
			this.setNativeFullScreen(fullscreen);
		} else {
			this.setSimpleFullScreen(fullscreen);
		}

		// Events
		this.sendWhenReady(fullscreen ? 'vscode:enterFullScreen' : 'vscode:leaveFullScreen');

		// Respect configured menu bar visibility or default to toggle if not set
		if (this.currentMenuBarVisibility) {
			this.setMenuBarVisibility(this.currentMenuBarVisibility, false);
		}
	}

	get isFullScreen(): boolean { return this._win.isFullScreen() || this._win.isSimpleFullScreen(); }

	private setNativeFullScreen(fullscreen: boolean): void {
		if (this._win.isSimpleFullScreen()) {
			this._win.setSimpleFullScreen(false);
		}

		this._win.setFullScreen(fullscreen);
	}

	private setSimpleFullScreen(fullscreen: boolean): void {
		if (this._win.isFullScreen()) {
			this._win.setFullScreen(false);
		}

		this._win.setSimpleFullScreen(fullscreen);
		this._win.webContents.focus(); // workaround issue where focus is not going into window
	}

	private useNativeFullScreen(): boolean {
		const windowConfig = this.configurationService.getValue<IWindowSettings>('window');
		if (!windowConfig || typeof windowConfig.nativeFullScreen !== 'boolean') {
			return true; // default
		}

		if (windowConfig.nativeTabs) {
			return true; // https://github.com/electron/electron/issues/16142
		}

		return windowConfig.nativeFullScreen !== false;
	}

	isMinimized(): boolean {
		return this._win.isMinimized();
	}

	private getMenuBarVisibility(): MenuBarVisibility {
		let menuBarVisibility = getMenuBarVisibility(this.configurationService, this.environmentService, !!this.config?.extensionDevelopmentPath);
		if (['visible', 'toggle', 'hidden'].indexOf(menuBarVisibility) < 0) {
			menuBarVisibility = 'default';
		}

		return menuBarVisibility;
	}

	private setMenuBarVisibility(visibility: MenuBarVisibility, notify: boolean = true): void {
		if (isMacintosh) {
			return; // ignore for macOS platform
		}

		if (visibility === 'toggle') {
			if (notify) {
				this.send('vscode:showInfoMessage', nls.localize('hiddenMenuBar', "You can still access the menu bar by pressing the Alt-key."));
			}
		}

		if (visibility === 'hidden') {
			// for some weird reason that I have no explanation for, the menu bar is not hiding when calling
			// this without timeout (see https://github.com/Microsoft/vscode/issues/19777). there seems to be
			// a timing issue with us opening the first window and the menu bar getting created. somehow the
			// fact that we want to hide the menu without being able to bring it back via Alt key makes Electron
			// still show the menu. Unable to reproduce from a simple Hello World application though...
			setTimeout(() => {
				this.doSetMenuBarVisibility(visibility);
			});
		} else {
			this.doSetMenuBarVisibility(visibility);
		}
	}

	private doSetMenuBarVisibility(visibility: MenuBarVisibility): void {
		const isFullscreen = this.isFullScreen;

		switch (visibility) {
			case ('default'):
				this._win.setMenuBarVisibility(!isFullscreen);
				this._win.autoHideMenuBar = isFullscreen;
				break;

			case ('visible'):
				this._win.setMenuBarVisibility(true);
				this._win.autoHideMenuBar = false;
				break;

			case ('toggle'):
				this._win.setMenuBarVisibility(false);
				this._win.autoHideMenuBar = true;
				break;

			case ('hidden'):
				this._win.setMenuBarVisibility(false);
				this._win.autoHideMenuBar = false;
				break;
		}
	}

	handleTitleDoubleClick(): void {

		// Respect system settings on mac with regards to title click on windows title
		if (isMacintosh) {
			const action = systemPreferences.getUserDefault('AppleActionOnDoubleClick', 'string');
			switch (action) {
				case 'Minimize':
					this.win.minimize();
					break;
				case 'None':
					break;
				case 'Maximize':
				default:
					if (this.win.isMaximized()) {
						this.win.unmaximize();
					} else {
						this.win.maximize();
					}
			}
		}

		// Linux/Windows: just toggle maximize/minimized state
		else {
			if (this.win.isMaximized()) {
				this.win.unmaximize();
			} else {
				this.win.maximize();
			}
		}
	}

	close(): void {
		if (this._win) {
			this._win.close();
		}
	}

	sendWhenReady(channel: string, ...args: any[]): void {
		if (this.isReady) {
			this.send(channel, ...args);
		} else {
			this.ready().then(() => this.send(channel, ...args));
		}
	}

	send(channel: string, ...args: any[]): void {
		if (this._win) {
			this._win.webContents.send(channel, ...args);
		}
	}

	updateTouchBar(groups: ISerializableCommandAction[][]): void {
		if (!isMacintosh) {
			return; // only supported on macOS
		}

		// Update segments for all groups. Setting the segments property
		// of the group directly prevents ugly flickering from happening
		this.touchBarGroups.forEach((touchBarGroup, index) => {
			const commands = groups[index];
			touchBarGroup.segments = this.createTouchBarGroupSegments(commands);
		});
	}

	private createTouchBar(): void {
		if (!isMacintosh) {
			return; // only supported on macOS
		}

		// To avoid flickering, we try to reuse the touch bar group
		// as much as possible by creating a large number of groups
		// for reusing later.
		for (let i = 0; i < 10; i++) {
			const groupTouchBar = this.createTouchBarGroup();
			this.touchBarGroups.push(groupTouchBar);
		}

		this._win.setTouchBar(new TouchBar({ items: this.touchBarGroups }));
	}

	private createTouchBarGroup(items: ISerializableCommandAction[] = []): TouchBarSegmentedControl {

		// Group Segments
		const segments = this.createTouchBarGroupSegments(items);

		// Group Control
		const control = new TouchBar.TouchBarSegmentedControl({
			segments,
			mode: 'buttons',
			segmentStyle: 'automatic',
			change: (selectedIndex) => {
				this.sendWhenReady('vscode:runAction', { id: (control.segments[selectedIndex] as ITouchBarSegment).id, from: 'touchbar' });
			}
		});

		return control;
	}

	private createTouchBarGroupSegments(items: ISerializableCommandAction[] = []): ITouchBarSegment[] {
		const segments: ITouchBarSegment[] = items.map(item => {
			let icon: NativeImage | undefined;
			if (item.icon && !ThemeIcon.isThemeIcon(item.icon) && item.icon?.dark?.scheme === 'file') {
				icon = nativeImage.createFromPath(URI.revive(item.icon.dark).fsPath);
				if (icon.isEmpty()) {
					icon = undefined;
				}
			}

			let title: string;
			if (typeof item.title === 'string') {
				title = item.title;
			} else {
				title = item.title.value;
			}

			return {
				id: item.id,
				label: !icon ? title : undefined,
				icon
			};
		});

		return segments;
	}

	dispose(): void {
		super.dispose();

		if (this.showTimeoutHandle) {
			clearTimeout(this.showTimeoutHandle);
		}

		this._win = null!; // Important to dereference the window object to allow for GC
	}
}
