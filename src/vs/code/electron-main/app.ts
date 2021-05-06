/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { release, hostname } from 'os';
import { statSync } from 'fs';
import { app, ipcMain, systemPreferences, contentTracing, protocol, BrowserWindow, dialog, session } from 'electron';
import { IProcessEnvironment, isWindows, isMacintosh, isLinux, isLinuxSnap } from 'vs/base/common/platform';
import { WindowsMainService } from 'vs/platform/windows/electron-main/windowsMainService';
import { IWindowOpenable } from 'vs/platform/windows/common/windows';
import { ILifecycleMainService, LifecycleMainPhase } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { resolveShellEnv } from 'vs/platform/environment/node/shellEnv';
import { IUpdateService } from 'vs/platform/update/common/update';
import { UpdateChannel } from 'vs/platform/update/common/updateIpc';
import { getDelayedChannel, StaticRouter, ProxyChannel } from 'vs/base/parts/ipc/common/ipc';
import { Server as ElectronIPCServer } from 'vs/base/parts/ipc/electron-main/ipc.electron';
import { Server as NodeIPCServer } from 'vs/base/parts/ipc/node/ipc.net';
import { Client as MessagePortClient } from 'vs/base/parts/ipc/electron-main/ipc.mp';
import { SharedProcess } from 'vs/platform/sharedProcess/electron-main/sharedProcess';
import { LaunchMainService, ILaunchMainService } from 'vs/platform/launch/electron-main/launchMainService';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ILoggerService, ILogService } from 'vs/platform/log/common/log';
import { IStateMainService } from 'vs/platform/state/electron-main/state';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IOpenURLOptions, IURLService } from 'vs/platform/url/common/url';
import { URLHandlerChannelClient, URLHandlerRouter } from 'vs/platform/url/common/urlIpc';
import { ITelemetryService, machineIdKey } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { TelemetryAppenderClient } from 'vs/platform/telemetry/common/telemetryIpc';
import { TelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { resolveCommonProperties } from 'vs/platform/telemetry/common/commonProperties';
import { IProductService } from 'vs/platform/product/common/productService';
import { ProxyAuthHandler } from 'vs/code/electron-main/auth';
import { Disposable } from 'vs/base/common/lifecycle';
import { IWindowsMainService, ICodeWindow, OpenContext, WindowError } from 'vs/platform/windows/electron-main/windows';
import { URI } from 'vs/base/common/uri';
import { hasWorkspaceFileExtension, IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { WorkspacesMainService } from 'vs/platform/workspaces/electron-main/workspacesMainService';
import { getMachineId } from 'vs/base/node/id';
import { Win32UpdateService } from 'vs/platform/update/electron-main/updateService.win32';
import { LinuxUpdateService } from 'vs/platform/update/electron-main/updateService.linux';
import { DarwinUpdateService } from 'vs/platform/update/electron-main/updateService.darwin';
import { IssueMainService, IIssueMainService } from 'vs/platform/issue/electron-main/issueMainService';
import { LoggerChannel, LogLevelChannel } from 'vs/platform/log/common/logIpc';
import { setUnexpectedErrorHandler, onUnexpectedError } from 'vs/base/common/errors';
import { ElectronURLListener } from 'vs/platform/url/electron-main/electronUrlListener';
import { serve as serveDriver } from 'vs/platform/driver/electron-main/driver';
import { IMenubarMainService, MenubarMainService } from 'vs/platform/menubar/electron-main/menubarMainService';
import { registerContextMenuListener } from 'vs/base/parts/contextmenu/electron-main/contextmenu';
import { sep, posix, join, isAbsolute } from 'vs/base/common/path';
import { joinPath } from 'vs/base/common/resources';
import { localize } from 'vs/nls';
import { Schemas } from 'vs/base/common/network';
import { SnapUpdateService } from 'vs/platform/update/electron-main/updateService.snap';
import { IStorageMainService, StorageMainService } from 'vs/platform/storage/electron-main/storageMainService';
import { StorageDatabaseChannel } from 'vs/platform/storage/electron-main/storageIpc';
import { BackupMainService } from 'vs/platform/backup/electron-main/backupMainService';
import { IBackupMainService } from 'vs/platform/backup/electron-main/backup';
import { WorkspacesHistoryMainService, IWorkspacesHistoryMainService } from 'vs/platform/workspaces/electron-main/workspacesHistoryMainService';
import { NativeURLService } from 'vs/platform/url/common/urlService';
import { WorkspacesManagementMainService, IWorkspacesManagementMainService } from 'vs/platform/workspaces/electron-main/workspacesManagementMainService';
import { IDiagnosticsService } from 'vs/platform/diagnostics/common/diagnostics';
import { ElectronExtensionHostDebugBroadcastChannel } from 'vs/platform/debug/electron-main/extensionHostDebugIpc';
import { INativeHostMainService, NativeHostMainService } from 'vs/platform/native/electron-main/nativeHostMainService';
import { IDialogMainService, DialogMainService } from 'vs/platform/dialogs/electron-main/dialogMainService';
import { withNullAsUndefined } from 'vs/base/common/types';
import { mnemonicButtonLabel, getPathLabel } from 'vs/base/common/labels';
import { WebviewMainService } from 'vs/platform/webview/electron-main/webviewMainService';
import { IWebviewManagerService } from 'vs/platform/webview/common/webviewManagerService';
import { FileOperationError, FileOperationResult, IFileService } from 'vs/platform/files/common/files';
import { stripComments } from 'vs/base/common/json';
import { generateUuid } from 'vs/base/common/uuid';
import { VSBuffer } from 'vs/base/common/buffer';
import { EncryptionMainService, IEncryptionMainService } from 'vs/platform/encryption/electron-main/encryptionMainService';
import { ActiveWindowManager } from 'vs/platform/windows/node/windowTracker';
import { IKeyboardLayoutMainService, KeyboardLayoutMainService } from 'vs/platform/keyboardLayout/electron-main/keyboardLayoutMainService';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { isLaunchedFromCli } from 'vs/platform/environment/node/argvHelper';
import { isEqualOrParent } from 'vs/base/common/extpath';
import { RunOnceScheduler } from 'vs/base/common/async';
import { IExtensionUrlTrustService } from 'vs/platform/extensionManagement/common/extensionUrlTrust';
import { ExtensionUrlTrustService } from 'vs/platform/extensionManagement/node/extensionUrlTrustService';
import { once } from 'vs/base/common/functional';
import { getRemoteAuthority } from 'vs/platform/remote/common/remoteHosts';
import { ISignService } from 'vs/platform/sign/common/sign';
import { IExternalTerminalMainService } from 'vs/platform/externalTerminal/common/externalTerminal';
import { LinuxExternalTerminalService, MacExternalTerminalService, WindowsExternalTerminalService } from 'vs/platform/externalTerminal/node/externalTerminalService';

/**
 * The main VS Code application. There will only ever be one instance,
 * even if the user starts many instances (e.g. from the command line).
 */
export class CodeApplication extends Disposable {

	private windowsMainService: IWindowsMainService | undefined;
	private nativeHostMainService: INativeHostMainService | undefined;

	constructor(
		private readonly mainProcessNodeIpcServer: NodeIPCServer,
		private readonly userEnv: IProcessEnvironment,
		@IInstantiationService private readonly mainInstantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IEnvironmentMainService private readonly environmentMainService: IEnvironmentMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStateMainService private readonly stateMainService: IStateMainService,
		@IFileService private readonly fileService: IFileService,
		@IProductService private readonly productService: IProductService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		// We handle uncaught exceptions here to prevent electron from opening a dialog to the user
		setUnexpectedErrorHandler(err => this.onUnexpectedError(err));
		process.on('uncaughtException', err => this.onUnexpectedError(err));
		process.on('unhandledRejection', (reason: unknown) => onUnexpectedError(reason));

		// Dispose on shutdown
		this.lifecycleMainService.onWillShutdown(() => this.dispose());

		// Contextmenu via IPC support
		registerContextMenuListener();

		// Accessibility change event
		app.on('accessibility-support-changed', (event, accessibilitySupportEnabled) => {
			this.windowsMainService?.sendToAll('vscode:accessibilitySupportChanged', accessibilitySupportEnabled);
		});

		// macOS dock activate
		app.on('activate', (event, hasVisibleWindows) => {
			this.logService.trace('app#activate');

			// Mac only event: open new window when we get activated
			if (!hasVisibleWindows) {
				this.windowsMainService?.openEmptyWindow({ context: OpenContext.DOCK });
			}
		});

		//#region Security related measures (https://electronjs.org/docs/tutorial/security)
		//
		// !!! DO NOT CHANGE without consulting the documentation !!!
		//
		app.on('remote-require', (event, sender, module) => {
			this.logService.trace('app#on(remote-require): prevented');

			event.preventDefault();
		});
		app.on('remote-get-global', (event, sender, module) => {
			this.logService.trace(`app#on(remote-get-global): prevented on ${module}`);

			event.preventDefault();
		});
		app.on('remote-get-builtin', (event, sender, module) => {
			this.logService.trace(`app#on(remote-get-builtin): prevented on ${module}`);

			if (module !== 'clipboard') {
				event.preventDefault();
			}
		});
		app.on('remote-get-current-window', event => {
			this.logService.trace(`app#on(remote-get-current-window): prevented`);

			event.preventDefault();
		});
		app.on('remote-get-current-web-contents', event => {
			if (this.environmentMainService.args.driver) {
				return; // the driver needs access to web contents
			}

			this.logService.trace(`app#on(remote-get-current-web-contents): prevented`);

			event.preventDefault();
		});
		app.on('web-contents-created', (event, contents) => {
			contents.on('will-attach-webview', (event, webPreferences, params) => {

				const isValidWebviewSource = (source: string | undefined): boolean => {
					if (!source) {
						return false;
					}

					const uri = URI.parse(source);
					if (uri.scheme === Schemas.vscodeWebview) {
						return uri.path === '/index.html' || uri.path === '/electron-browser-index.html';
					}

					const srcUri = uri.fsPath.toLowerCase();
					const rootUri = URI.file(this.environmentMainService.appRoot).fsPath.toLowerCase();

					return srcUri.startsWith(rootUri + sep);
				};

				// Ensure defaults
				delete webPreferences.preload;
				webPreferences.nodeIntegration = false;

				// Verify URLs being loaded
				// https://github.com/electron/electron/issues/21553
				if (isValidWebviewSource(params.src) && isValidWebviewSource((webPreferences as { preloadURL: string }).preloadURL)) {
					return;
				}

				delete (webPreferences as { preloadURL: string | undefined }).preloadURL; // https://github.com/electron/electron/issues/21553

				// Otherwise prevent loading
				this.logService.error('webContents#web-contents-created: Prevented webview attach');

				event.preventDefault();
			});

			contents.on('will-navigate', event => {
				this.logService.error('webContents#will-navigate: Prevented webcontent navigation');

				event.preventDefault();
			});

			contents.on('new-window', (event, url) => {
				event.preventDefault(); // prevent code that wants to open links

				this.nativeHostMainService?.openExternal(undefined, url);
			});

			const isUrlFromWebview = (requestingUrl: string) =>
				requestingUrl.startsWith(`${Schemas.vscodeWebview}://`);

			session.defaultSession.setPermissionRequestHandler((_webContents, permission /* 'media' | 'geolocation' | 'notifications' | 'midiSysex' | 'pointerLock' | 'fullscreen' | 'openExternal' */, callback, details) => {
				if (isUrlFromWebview(details.requestingUrl)) {
					return callback(permission === 'clipboard-read');
				}
				return callback(false);
			});

			session.defaultSession.setPermissionCheckHandler((_webContents, permission /* 'media' */, _origin, details) => {
				if (isUrlFromWebview(details.requestingUrl)) {
					return permission === 'clipboard-read';
				}
				return false;
			});
		});

		//#endregion

		let macOpenFileURIs: IWindowOpenable[] = [];
		let runningTimeout: NodeJS.Timeout | undefined = undefined;
		app.on('open-file', (event, path) => {
			this.logService.trace('app#open-file: ', path);
			event.preventDefault();

			// Keep in array because more might come!
			macOpenFileURIs.push(this.getWindowOpenableFromPathSync(path));

			// Clear previous handler if any
			if (runningTimeout !== undefined) {
				clearTimeout(runningTimeout);
				runningTimeout = undefined;
			}

			// Handle paths delayed in case more are coming!
			runningTimeout = setTimeout(() => {
				this.windowsMainService?.open({
					context: OpenContext.DOCK /* can also be opening from finder while app is running */,
					cli: this.environmentMainService.args,
					urisToOpen: macOpenFileURIs,
					gotoLineMode: false,
					preferNewWindow: true /* dropping on the dock or opening from finder prefers to open in a new window */
				});

				macOpenFileURIs = [];
				runningTimeout = undefined;
			}, 100);
		});

		app.on('new-window-for-tab', () => {
			this.windowsMainService?.openEmptyWindow({ context: OpenContext.DESKTOP }); //macOS native tab "+" button
		});

		//#region Bootstrap IPC Handlers

		ipcMain.handle('vscode:fetchShellEnv', event => {

			// Prefer to use the args and env from the target window
			// when resolving the shell env. It is possible that
			// a first window was opened from the UI but a second
			// from the CLI and that has implications for whether to
			// resolve the shell environment or not.
			//
			// Window can be undefined for e.g. the shared process
			// that is not part of our windows registry!
			const window = this.windowsMainService?.getWindowByWebContents(event.sender); // Note: this can be `undefined` for the shared process
			let args: NativeParsedArgs;
			let env: IProcessEnvironment;
			if (window?.config) {
				args = window.config;
				env = { ...process.env, ...window.config.userEnv };
			} else {
				args = this.environmentMainService.args;
				env = process.env;
			}

			// Resolve shell env
			return resolveShellEnv(this.logService, args, env);
		});

		ipcMain.handle('vscode:writeNlsFile', (event, path: unknown, data: unknown) => {
			const uri = this.validateNlsPath([path]);
			if (!uri || typeof data !== 'string') {
				throw new Error('Invalid operation (vscode:writeNlsFile)');
			}

			return this.fileService.writeFile(uri, VSBuffer.fromString(data));
		});

		ipcMain.handle('vscode:readNlsFile', async (event, ...paths: unknown[]) => {
			const uri = this.validateNlsPath(paths);
			if (!uri) {
				throw new Error('Invalid operation (vscode:readNlsFile)');
			}

			return (await this.fileService.readFile(uri)).value.toString();
		});

		ipcMain.on('vscode:toggleDevTools', event => event.sender.toggleDevTools());
		ipcMain.on('vscode:openDevTools', event => event.sender.openDevTools());

		ipcMain.on('vscode:reloadWindow', event => event.sender.reload());

		//#endregion
	}

	private validateNlsPath(pathSegments: unknown[]): URI | undefined {
		let path: string | undefined = undefined;

		for (const pathSegment of pathSegments) {
			if (typeof pathSegment === 'string') {
				if (typeof path !== 'string') {
					path = pathSegment;
				} else {
					path = join(path, pathSegment);
				}
			}
		}

		if (typeof path !== 'string' || !isAbsolute(path) || !isEqualOrParent(path, this.environmentMainService.cachedLanguagesPath, !isLinux)) {
			return undefined;
		}

		return URI.file(path);
	}

	private onUnexpectedError(err: Error): void {
		if (err) {

			// take only the message and stack property
			const friendlyError = {
				message: `[uncaught exception in main]: ${err.message}`,
				stack: err.stack
			};

			// handle on client side
			this.windowsMainService?.sendToFocused('vscode:reportError', JSON.stringify(friendlyError));
		}

		this.logService.error(`[uncaught exception in main]: ${err}`);
		if (err.stack) {
			this.logService.error(err.stack);
		}
	}

	async startup(): Promise<void> {
		this.logService.debug('Starting VS Code');
		this.logService.debug(`from: ${this.environmentMainService.appRoot}`);
		this.logService.debug('args:', this.environmentMainService.args);

		// TODO@bpasero TODO@deepak1556 workaround for #120655
		try {
			const cachedDataPath = URI.file(this.environmentMainService.chromeCachedDataDir);
			this.logService.trace(`Deleting Chrome cached data path: ${cachedDataPath.fsPath}`);

			await this.fileService.del(cachedDataPath, { recursive: true });
		} catch (error) {
			if ((<FileOperationError>error).fileOperationResult !== FileOperationResult.FILE_NOT_FOUND) {
				this.logService.error(error);
			}
		}

		// Make sure we associate the program with the app user model id
		// This will help Windows to associate the running program with
		// any shortcut that is pinned to the taskbar and prevent showing
		// two icons in the taskbar for the same app.
		const win32AppUserModelId = this.productService.win32AppUserModelId;
		if (isWindows && win32AppUserModelId) {
			app.setAppUserModelId(win32AppUserModelId);
		}

		// Fix native tabs on macOS 10.13
		// macOS enables a compatibility patch for any bundle ID beginning with
		// "com.microsoft.", which breaks native tabs for VS Code when using this
		// identifier (from the official build).
		// Explicitly opt out of the patch here before creating any windows.
		// See: https://github.com/microsoft/vscode/issues/35361#issuecomment-399794085
		try {
			if (isMacintosh && this.configurationService.getValue<boolean>('window.nativeTabs') === true && !systemPreferences.getUserDefault('NSUseImprovedLayoutPass', 'boolean')) {
				systemPreferences.setUserDefault('NSUseImprovedLayoutPass', 'boolean', true as any);
			}
		} catch (error) {
			this.logService.error(error);
		}

		// Main process server (electron IPC based)
		const mainProcessElectronServer = new ElectronIPCServer();

		// Resolve unique machine ID
		this.logService.trace('Resolving machine identifier...');
		const machineId = await this.resolveMachineId();
		this.logService.trace(`Resolved machine identifier: ${machineId}`);

		// Shared process
		const { sharedProcess, sharedProcessReady, sharedProcessClient } = this.setupSharedProcess(machineId);

		// Services
		const appInstantiationService = await this.initServices(machineId, sharedProcess, sharedProcessReady);

		// Create driver
		if (this.environmentMainService.driverHandle) {
			const server = await serveDriver(mainProcessElectronServer, this.environmentMainService.driverHandle, this.environmentMainService, appInstantiationService);

			this.logService.info('Driver started at:', this.environmentMainService.driverHandle);
			this._register(server);
		}

		// Setup Auth Handler
		this._register(appInstantiationService.createInstance(ProxyAuthHandler));

		// Init Channels
		appInstantiationService.invokeFunction(accessor => this.initChannels(accessor, mainProcessElectronServer, sharedProcessClient));

		// Open Windows
		const windows = appInstantiationService.invokeFunction(accessor => this.openFirstWindow(accessor, mainProcessElectronServer));

		// Post Open Windows Tasks
		appInstantiationService.invokeFunction(accessor => this.afterWindowOpen(accessor, sharedProcess));

		// Tracing: Stop tracing after windows are ready if enabled
		if (this.environmentMainService.args.trace) {
			appInstantiationService.invokeFunction(accessor => this.stopTracingEventually(accessor, windows));
		}
	}

	private async resolveMachineId(): Promise<string> {

		// We cache the machineId for faster lookups on startup
		// and resolve it only once initially if not cached or we need to replace the macOS iBridge device
		let machineId = this.stateMainService.getItem<string>(machineIdKey);
		if (!machineId || (isMacintosh && machineId === '6c9d2bc8f91b89624add29c0abeae7fb42bf539fa1cdb2e3e57cd668fa9bcead')) {
			machineId = await getMachineId();

			this.stateMainService.setItem(machineIdKey, machineId);
		}

		return machineId;
	}

	private setupSharedProcess(machineId: string): { sharedProcess: SharedProcess, sharedProcessReady: Promise<MessagePortClient>, sharedProcessClient: Promise<MessagePortClient> } {
		const sharedProcess = this._register(this.mainInstantiationService.createInstance(SharedProcess, machineId, this.userEnv));

		const sharedProcessClient = (async () => {
			this.logService.trace('Main->SharedProcess#connect');

			const port = await sharedProcess.connect();

			this.logService.trace('Main->SharedProcess#connect: connection established');

			return new MessagePortClient(port, 'main');
		})();

		const sharedProcessReady = (async () => {
			await sharedProcess.whenReady();

			return sharedProcessClient;
		})();

		return { sharedProcess, sharedProcessReady, sharedProcessClient };
	}

	private async initServices(machineId: string, sharedProcess: SharedProcess, sharedProcessReady: Promise<MessagePortClient>): Promise<IInstantiationService> {
		const services = new ServiceCollection();

		// Update
		switch (process.platform) {
			case 'win32':
				services.set(IUpdateService, new SyncDescriptor(Win32UpdateService));
				break;

			case 'linux':
				if (isLinuxSnap) {
					services.set(IUpdateService, new SyncDescriptor(SnapUpdateService, [process.env['SNAP'], process.env['SNAP_REVISION']]));
				} else {
					services.set(IUpdateService, new SyncDescriptor(LinuxUpdateService));
				}
				break;

			case 'darwin':
				services.set(IUpdateService, new SyncDescriptor(DarwinUpdateService));
				break;
		}

		// Windows
		services.set(IWindowsMainService, new SyncDescriptor(WindowsMainService, [machineId, this.userEnv]));

		// Dialogs
		services.set(IDialogMainService, new SyncDescriptor(DialogMainService));

		// Launch
		services.set(ILaunchMainService, new SyncDescriptor(LaunchMainService));

		// Diagnostics
		services.set(IDiagnosticsService, ProxyChannel.toService(getDelayedChannel(sharedProcessReady.then(client => client.getChannel('diagnostics')))));

		// Issues
		services.set(IIssueMainService, new SyncDescriptor(IssueMainService, [this.userEnv]));

		// Encryption
		services.set(IEncryptionMainService, new SyncDescriptor(EncryptionMainService, [machineId]));

		// Keyboard Layout
		services.set(IKeyboardLayoutMainService, new SyncDescriptor(KeyboardLayoutMainService));

		// Native Host
		services.set(INativeHostMainService, new SyncDescriptor(NativeHostMainService, [sharedProcess]));

		// Webview Manager
		services.set(IWebviewManagerService, new SyncDescriptor(WebviewMainService));

		// Workspaces
		services.set(IWorkspacesService, new SyncDescriptor(WorkspacesMainService));
		services.set(IWorkspacesManagementMainService, new SyncDescriptor(WorkspacesManagementMainService));
		services.set(IWorkspacesHistoryMainService, new SyncDescriptor(WorkspacesHistoryMainService));

		// Menubar
		services.set(IMenubarMainService, new SyncDescriptor(MenubarMainService));

		// Extension URL Trust
		services.set(IExtensionUrlTrustService, new SyncDescriptor(ExtensionUrlTrustService));

		// Storage
		services.set(IStorageMainService, new SyncDescriptor(StorageMainService));

		// External terminal
		if (isWindows) {
			services.set(IExternalTerminalMainService, new SyncDescriptor(WindowsExternalTerminalService));
		} else if (isMacintosh) {
			services.set(IExternalTerminalMainService, new SyncDescriptor(MacExternalTerminalService));
		} else if (isLinux) {
			services.set(IExternalTerminalMainService, new SyncDescriptor(LinuxExternalTerminalService));
		}

		// Backups
		const backupMainService = new BackupMainService(this.environmentMainService, this.configurationService, this.logService);
		services.set(IBackupMainService, backupMainService);

		// URL handling
		services.set(IURLService, new SyncDescriptor(NativeURLService));

		// Telemetry
		if (!this.environmentMainService.isExtensionDevelopment && !this.environmentMainService.args['disable-telemetry'] && !!this.productService.enableTelemetry) {
			const channel = getDelayedChannel(sharedProcessReady.then(client => client.getChannel('telemetryAppender')));
			const appender = new TelemetryAppenderClient(channel);
			const commonProperties = resolveCommonProperties(this.fileService, release(), hostname(), process.arch, this.productService.commit, this.productService.version, machineId, this.productService.msftInternalDomains, this.environmentMainService.installSourcePath);
			const piiPaths = [this.environmentMainService.appRoot, this.environmentMainService.extensionsPath];
			const config: ITelemetryServiceConfig = { appender, commonProperties, piiPaths, sendErrorTelemetry: true };

			services.set(ITelemetryService, new SyncDescriptor(TelemetryService, [config]));
		} else {
			services.set(ITelemetryService, NullTelemetryService);
		}

		// Init services that require it
		await backupMainService.initialize();

		return this.mainInstantiationService.createChild(services);
	}

	private initChannels(accessor: ServicesAccessor, mainProcessElectronServer: ElectronIPCServer, sharedProcessClient: Promise<MessagePortClient>): void {

		// Launch: this one is explicitly registered to the node.js
		// server because when a second instance starts up, that is
		// the only possible connection between the first and the
		// second instance. Electron IPC does not work across apps.
		const launchChannel = ProxyChannel.fromService(accessor.get(ILaunchMainService), { disableMarshalling: true });
		this.mainProcessNodeIpcServer.registerChannel('launch', launchChannel);

		// Update
		const updateChannel = new UpdateChannel(accessor.get(IUpdateService));
		mainProcessElectronServer.registerChannel('update', updateChannel);

		// Issues
		const issueChannel = ProxyChannel.fromService(accessor.get(IIssueMainService));
		mainProcessElectronServer.registerChannel('issue', issueChannel);

		// Encryption
		const encryptionChannel = ProxyChannel.fromService(accessor.get(IEncryptionMainService));
		mainProcessElectronServer.registerChannel('encryption', encryptionChannel);

		// Signing
		const signChannel = ProxyChannel.fromService(accessor.get(ISignService));
		mainProcessElectronServer.registerChannel('sign', signChannel);

		// Keyboard Layout
		const keyboardLayoutChannel = ProxyChannel.fromService(accessor.get(IKeyboardLayoutMainService));
		mainProcessElectronServer.registerChannel('keyboardLayout', keyboardLayoutChannel);

		// Native host (main & shared process)
		this.nativeHostMainService = accessor.get(INativeHostMainService);
		const nativeHostChannel = ProxyChannel.fromService(this.nativeHostMainService);
		mainProcessElectronServer.registerChannel('nativeHost', nativeHostChannel);
		sharedProcessClient.then(client => client.registerChannel('nativeHost', nativeHostChannel));

		// Workspaces
		const workspacesChannel = ProxyChannel.fromService(accessor.get(IWorkspacesService));
		mainProcessElectronServer.registerChannel('workspaces', workspacesChannel);

		// Menubar
		const menubarChannel = ProxyChannel.fromService(accessor.get(IMenubarMainService));
		mainProcessElectronServer.registerChannel('menubar', menubarChannel);

		// URL handling
		const urlChannel = ProxyChannel.fromService(accessor.get(IURLService));
		mainProcessElectronServer.registerChannel('url', urlChannel);

		// Extension URL Trust
		const extensionUrlTrustChannel = ProxyChannel.fromService(accessor.get(IExtensionUrlTrustService));
		mainProcessElectronServer.registerChannel('extensionUrlTrust', extensionUrlTrustChannel);

		// Webview Manager
		const webviewChannel = ProxyChannel.fromService(accessor.get(IWebviewManagerService));
		mainProcessElectronServer.registerChannel('webview', webviewChannel);

		// Storage (main & shared process)
		const storageChannel = this._register(new StorageDatabaseChannel(this.logService, accessor.get(IStorageMainService)));
		mainProcessElectronServer.registerChannel('storage', storageChannel);
		sharedProcessClient.then(client => client.registerChannel('storage', storageChannel));

		// External Terminal
		const externalTerminalChannel = ProxyChannel.fromService(accessor.get(IExternalTerminalMainService));
		mainProcessElectronServer.registerChannel('externalTerminal', externalTerminalChannel);

		// Log Level (main & shared process)
		const logLevelChannel = new LogLevelChannel(accessor.get(ILogService));
		mainProcessElectronServer.registerChannel('logLevel', logLevelChannel);
		sharedProcessClient.then(client => client.registerChannel('logLevel', logLevelChannel));

		// Logger
		const loggerChannel = new LoggerChannel(accessor.get(ILoggerService),);
		mainProcessElectronServer.registerChannel('logger', loggerChannel);
		sharedProcessClient.then(client => client.registerChannel('logger', loggerChannel));

		// Extension Host Debug Broadcasting
		const electronExtensionHostDebugBroadcastChannel = new ElectronExtensionHostDebugBroadcastChannel(accessor.get(IWindowsMainService));
		mainProcessElectronServer.registerChannel('extensionhostdebugservice', electronExtensionHostDebugBroadcastChannel);
	}

	private openFirstWindow(accessor: ServicesAccessor, mainProcessElectronServer: ElectronIPCServer): ICodeWindow[] {
		const windowsMainService = this.windowsMainService = accessor.get(IWindowsMainService);
		const urlService = accessor.get(IURLService);
		const nativeHostMainService = accessor.get(INativeHostMainService);

		// Signal phase: ready (services set)
		this.lifecycleMainService.phase = LifecycleMainPhase.Ready;

		// Check for initial URLs to handle from protocol link invocations
		const pendingWindowOpenablesFromProtocolLinks: IWindowOpenable[] = [];
		const pendingProtocolLinksToHandle = [
			// Windows/Linux: protocol handler invokes CLI with --open-url
			...this.environmentMainService.args['open-url'] ? this.environmentMainService.args._urls || [] : [],

			// macOS: open-url events
			...((<any>global).getOpenUrls() || []) as string[]
		].map(url => {
			try {
				return { uri: URI.parse(url), url };
			} catch {
				return null;
			}
		}).filter((obj): obj is { uri: URI, url: string } => {
			if (!obj) {
				return false;
			}

			// If URI should be blocked, filter it out
			if (this.shouldBlockURI(obj.uri)) {
				return false;
			}

			// Filter out any protocol link that wants to open as window so that
			// we open the right set of windows on startup and not restore the
			// previous workspace too.
			const windowOpenable = this.getWindowOpenableFromProtocolLink(obj.uri);
			if (windowOpenable) {
				pendingWindowOpenablesFromProtocolLinks.push(windowOpenable);

				return false;
			}

			return true;
		});

		// Create a URL handler to open file URIs in the active window
		// or open new windows. The URL handler will be invoked from
		// protocol invocations outside of VSCode.
		const app = this;
		const environmentService = this.environmentMainService;
		urlService.registerHandler({
			async handleURL(uri: URI, options?: IOpenURLOptions): Promise<boolean> {

				// If URI should be blocked, behave as if it's handled
				if (app.shouldBlockURI(uri)) {
					return true;
				}

				// Check for URIs to open in window
				const windowOpenableFromProtocolLink = app.getWindowOpenableFromProtocolLink(uri);
				if (windowOpenableFromProtocolLink) {
					const [window] = windowsMainService.open({
						context: OpenContext.API,
						cli: { ...environmentService.args },
						urisToOpen: [windowOpenableFromProtocolLink],
						gotoLineMode: true
						/* remoteAuthority will be determined based on windowOpenableFromProtocolLink */
					});

					window.focus(); // this should help ensuring that the right window gets focus when multiple are opened

					return true;
				}

				// If we have not yet handled the URI and we have no window opened (macOS only)
				// we first open a window and then try to open that URI within that window
				if (isMacintosh && windowsMainService.getWindowCount() === 0) {
					const [window] = windowsMainService.open({
						context: OpenContext.API,
						cli: { ...environmentService.args },
						forceEmpty: true,
						gotoLineMode: true,
						remoteAuthority: getRemoteAuthority(uri)
					});

					await window.ready();

					return urlService.open(uri, options);
				}

				return false;
			}
		});

		// Create a URL handler which forwards to the last active window
		const activeWindowManager = this._register(new ActiveWindowManager({
			onDidOpenWindow: nativeHostMainService.onDidOpenWindow,
			onDidFocusWindow: nativeHostMainService.onDidFocusWindow,
			getActiveWindowId: () => nativeHostMainService.getActiveWindowId(-1)
		}));
		const activeWindowRouter = new StaticRouter(ctx => activeWindowManager.getActiveClientId().then(id => ctx === id));
		const urlHandlerRouter = new URLHandlerRouter(activeWindowRouter);
		const urlHandlerChannel = mainProcessElectronServer.getChannel('urlHandler', urlHandlerRouter);
		urlService.registerHandler(new URLHandlerChannelClient(urlHandlerChannel));

		// Watch Electron URLs and forward them to the UrlService
		this._register(new ElectronURLListener(pendingProtocolLinksToHandle, urlService, windowsMainService, this.environmentMainService, this.productService));

		// Open our first window
		const args = this.environmentMainService.args;
		const macOpenFiles: string[] = (<any>global).macOpenFiles;
		const context = isLaunchedFromCli(process.env) ? OpenContext.CLI : OpenContext.DESKTOP;
		const hasCliArgs = args._.length;
		const hasFolderURIs = !!args['folder-uri'];
		const hasFileURIs = !!args['file-uri'];
		const noRecentEntry = args['skip-add-to-recently-opened'] === true;
		const waitMarkerFileURI = args.wait && args.waitMarkerFilePath ? URI.file(args.waitMarkerFilePath) : undefined;
		const remoteAuthority = args.remote || undefined;

		// check for a pending window to open from URI
		// e.g. when running code with --open-uri from
		// a protocol handler
		if (pendingWindowOpenablesFromProtocolLinks.length > 0) {
			return windowsMainService.open({
				context,
				cli: args,
				urisToOpen: pendingWindowOpenablesFromProtocolLinks,
				gotoLineMode: true,
				initialStartup: true
				/* remoteAuthority will be determined based on pendingWindowOpenablesFromProtocolLinks */
			});
		}

		// new window if "-n"
		if (args['new-window'] && !hasCliArgs && !hasFolderURIs && !hasFileURIs) {
			return windowsMainService.open({
				context,
				cli: args,
				forceNewWindow: true,
				forceEmpty: true,
				noRecentEntry,
				waitMarkerFileURI,
				initialStartup: true,
				remoteAuthority
			});
		}

		// mac: open-file event received on startup
		if (macOpenFiles.length && !hasCliArgs && !hasFolderURIs && !hasFileURIs) {
			return windowsMainService.open({
				context: OpenContext.DOCK,
				cli: args,
				urisToOpen: macOpenFiles.map(file => this.getWindowOpenableFromPathSync(file)),
				noRecentEntry,
				waitMarkerFileURI,
				initialStartup: true,
				/* remoteAuthority will be determined based on macOpenFiles */
			});
		}

		// default: read paths from cli
		return windowsMainService.open({
			context,
			cli: args,
			forceNewWindow: args['new-window'] || (!hasCliArgs && args['unity-launch']),
			diffMode: args.diff,
			noRecentEntry,
			waitMarkerFileURI,
			gotoLineMode: args.goto,
			initialStartup: true,
			remoteAuthority
		});
	}

	private shouldBlockURI(uri: URI): boolean {
		if (uri.authority === Schemas.file && isWindows) {
			const res = dialog.showMessageBoxSync({
				title: this.productService.nameLong,
				type: 'question',
				buttons: [
					mnemonicButtonLabel(localize({ key: 'open', comment: ['&& denotes a mnemonic'] }, "&&Yes")),
					mnemonicButtonLabel(localize({ key: 'cancel', comment: ['&& denotes a mnemonic'] }, "&&No")),
				],
				cancelId: 1,
				message: localize('confirmOpenMessage', "An external application wants to open '{0}' in {1}. Do you want to open this file or folder?", getPathLabel(uri.fsPath, this.environmentMainService), this.productService.nameShort),
				detail: localize('confirmOpenDetail', "If you did not initiate this request, it may represent an attempted attack on your system. Unless you took an explicit action to initiate this request, you should press 'No'"),
				noLink: true
			});

			if (res === 1) {
				return true;
			}
		}

		return false;
	}

	private getWindowOpenableFromProtocolLink(uri: URI): IWindowOpenable | undefined {
		if (!uri.path) {
			return undefined;
		}

		// File path
		if (uri.authority === Schemas.file) {
			// we configure as fileUri, but later validation will
			// make sure to open as folder or workspace if possible
			return { fileUri: URI.file(uri.fsPath) };
		}

		// Remote path
		else if (uri.authority === Schemas.vscodeRemote) {
			// Example conversion:
			// From: vscode://vscode-remote/wsl+ubuntu/mnt/c/GitDevelopment/monaco
			//   To: vscode-remote://wsl+ubuntu/mnt/c/GitDevelopment/monaco
			const secondSlash = uri.path.indexOf(posix.sep, 1 /* skip over the leading slash */);
			if (secondSlash !== -1) {
				const authority = uri.path.substring(1, secondSlash);
				const path = uri.path.substring(secondSlash);
				const remoteUri = URI.from({ scheme: Schemas.vscodeRemote, authority, path, query: uri.query, fragment: uri.fragment });

				if (hasWorkspaceFileExtension(path)) {
					return { workspaceUri: remoteUri };
				} else if (/:[\d]+$/.test(path)) { // path with :line:column syntax
					return { fileUri: remoteUri };
				} else {
					return { folderUri: remoteUri };
				}
			}
		}

		return undefined;
	}

	private getWindowOpenableFromPathSync(path: string): IWindowOpenable {
		try {
			const fileStat = statSync(path);
			if (fileStat.isDirectory()) {
				return { folderUri: URI.file(path) };
			}

			if (hasWorkspaceFileExtension(path)) {
				return { workspaceUri: URI.file(path) };
			}
		} catch (error) {
			// ignore errors
		}

		return { fileUri: URI.file(path) };
	}

	private async afterWindowOpen(accessor: ServicesAccessor, sharedProcess: SharedProcess): Promise<void> {

		// Signal phase: after window open
		this.lifecycleMainService.phase = LifecycleMainPhase.AfterWindowOpen;

		// Observe shared process for errors
		let willShutdown = false;
		once(this.lifecycleMainService.onWillShutdown)(() => willShutdown = true);
		const telemetryService = accessor.get(ITelemetryService);
		this._register(sharedProcess.onDidError(({ type, details }) => {

			// Logging
			let message: string;
			if (typeof details === 'string') {
				message = details;
			} else {
				message = `SharedProcess: crashed (detail: ${details.reason}, code: ${details.exitCode})`;
			}
			onUnexpectedError(new Error(message));

			// Telemetry
			type SharedProcessErrorClassification = {
				type: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
				reason: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
				visible: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
				shuttingdown: { classification: 'SystemMetaData', purpose: 'PerformanceAndHealth', isMeasurement: true };
			};
			type SharedProcessErrorEvent = {
				type: WindowError;
				reason: string | undefined;
				visible: boolean;
				shuttingdown: boolean;
			};
			telemetryService.publicLog2<SharedProcessErrorEvent, SharedProcessErrorClassification>('sharedprocesserror', {
				type,
				reason: typeof details !== 'string' ? details?.reason : undefined,
				visible: sharedProcess.isVisible(),
				shuttingdown: willShutdown
			});
		}));

		// Windows: install mutex
		const win32MutexName = this.productService.win32MutexName;
		if (isWindows && win32MutexName) {
			try {
				const WindowsMutex = (require.__$__nodeRequire('windows-mutex') as typeof import('windows-mutex')).Mutex;
				const mutex = new WindowsMutex(win32MutexName);
				once(this.lifecycleMainService.onWillShutdown)(() => mutex.release());
			} catch (error) {
				this.logService.error(error);
			}
		}

		// Remote Authorities
		protocol.registerHttpProtocol(Schemas.vscodeRemoteResource, (request, callback) => {
			callback({
				url: request.url.replace(/^vscode-remote-resource:/, 'http:'),
				method: request.method
			});
		});

		// Initialize update service
		const updateService = accessor.get(IUpdateService);
		if (updateService instanceof Win32UpdateService || updateService instanceof LinuxUpdateService || updateService instanceof DarwinUpdateService) {
			updateService.initialize();
		}

		// Start to fetch shell environment (if needed) after window has opened
		// Since this operation can take a long time, we want to warm it up while
		// the window is opening.
		// We also print a warning if the resolution takes longer than 10s.
		(async () => {
			const slowResolveShellEnvWarning = this._register(new RunOnceScheduler(() => this.logService.warn('Resolving your shell environment is taking more than 10s. Please review your shell configuration. Learn more at https://go.microsoft.com/fwlink/?linkid=2149667.'), 10000));
			slowResolveShellEnvWarning.schedule();

			await resolveShellEnv(this.logService, this.environmentMainService.args, process.env);
			slowResolveShellEnvWarning.dispose();
		})();

		// If enable-crash-reporter argv is undefined then this is a fresh start,
		// based on telemetry.enableCrashreporter settings, generate a UUID which
		// will be used as crash reporter id and also update the json file.
		try {
			const argvContent = await this.fileService.readFile(this.environmentMainService.argvResource);
			const argvString = argvContent.value.toString();
			const argvJSON = JSON.parse(stripComments(argvString));
			if (argvJSON['enable-crash-reporter'] === undefined) {
				const enableCrashReporter = this.configurationService.getValue<boolean>('telemetry.enableCrashReporter') ?? true;
				const additionalArgvContent = [
					'',
					'	// Allows to disable crash reporting.',
					'	// Should restart the app if the value is changed.',
					`	"enable-crash-reporter": ${enableCrashReporter},`,
					'',
					'	// Unique id used for correlating crash reports sent from this instance.',
					'	// Do not edit this value.',
					`	"crash-reporter-id": "${generateUuid()}"`,
					'}'
				];
				const newArgvString = argvString.substring(0, argvString.length - 2).concat(',\n', additionalArgvContent.join('\n'));

				await this.fileService.writeFile(this.environmentMainService.argvResource, VSBuffer.fromString(newArgvString));
			}
		} catch (error) {
			this.logService.error(error);
		}
	}

	private stopTracingEventually(accessor: ServicesAccessor, windows: ICodeWindow[]): void {
		this.logService.info(`Tracing: waiting for windows to get ready...`);

		const dialogMainService = accessor.get(IDialogMainService);

		let recordingStopped = false;
		const stopRecording = async (timeout: boolean) => {
			if (recordingStopped) {
				return;
			}

			recordingStopped = true; // only once

			const path = await contentTracing.stopRecording(joinPath(this.environmentMainService.userHome, `${this.productService.applicationName}-${Math.random().toString(16).slice(-4)}.trace.txt`).fsPath);

			if (!timeout) {
				dialogMainService.showMessageBox({
					type: 'info',
					message: localize('trace.message', "Successfully created trace."),
					detail: localize('trace.detail', "Please create an issue and manually attach the following file:\n{0}", path),
					buttons: [localize('trace.ok', "OK")]
				}, withNullAsUndefined(BrowserWindow.getFocusedWindow()));
			} else {
				this.logService.info(`Tracing: data recorded (after 30s timeout) to ${path}`);
			}
		};

		// Wait up to 30s before creating the trace anyways
		const timeoutHandle = setTimeout(() => stopRecording(true), 30000);

		// Wait for all windows to get ready and stop tracing then
		Promise.all(windows.map(window => window.ready())).then(() => {
			clearTimeout(timeoutHandle);
			stopRecording(false);
		});
	}
}
