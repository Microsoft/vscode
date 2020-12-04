/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, ipcMain, systemPreferences, contentTracing, protocol, BrowserWindow, dialog, session } from 'electron';
import { IProcessEnvironment, isWindows, isMacintosh, isLinux } from 'vs/base/common/platform';
import { WindowsMainService } from 'vs/platform/windows/electron-main/windowsMainService';
import { IWindowOpenable } from 'vs/platform/windows/common/windows';
import { OpenContext } from 'vs/platform/windows/node/window';
import { ILifecycleMainService, LifecycleMainPhase } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { resolveShellEnv } from 'vs/code/node/shellEnv';
import { IUpdateService } from 'vs/platform/update/common/update';
import { UpdateChannel } from 'vs/platform/update/electron-main/updateIpc';
import { Server as ElectronIPCServer } from 'vs/base/parts/ipc/electron-main/ipc.electron-main';
import { Client } from 'vs/base/parts/ipc/common/ipc.net';
import { Server, connect } from 'vs/base/parts/ipc/node/ipc.net';
import { SharedProcess } from 'vs/code/electron-main/sharedProcess';
import { LaunchMainService, ILaunchMainService } from 'vs/platform/launch/electron-main/launchMainService';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ServiceCollection } from 'vs/platform/instantiation/common/serviceCollection';
import { SyncDescriptor } from 'vs/platform/instantiation/common/descriptors';
import { ILogService } from 'vs/platform/log/common/log';
import { IStateService } from 'vs/platform/state/node/state';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IOpenURLOptions, IURLService } from 'vs/platform/url/common/url';
import { URLHandlerChannelClient, URLHandlerRouter } from 'vs/platform/url/common/urlIpc';
import { ITelemetryService, machineIdKey } from 'vs/platform/telemetry/common/telemetry';
import { NullTelemetryService } from 'vs/platform/telemetry/common/telemetryUtils';
import { TelemetryAppenderClient } from 'vs/platform/telemetry/node/telemetryIpc';
import { TelemetryService, ITelemetryServiceConfig } from 'vs/platform/telemetry/common/telemetryService';
import { resolveCommonProperties } from 'vs/platform/telemetry/node/commonProperties';
import { getDelayedChannel, StaticRouter, createChannelReceiver, createChannelSender } from 'vs/base/parts/ipc/common/ipc';
import product from 'vs/platform/product/common/product';
import { ProxyAuthHandler } from 'vs/code/electron-main/auth';
import { ProxyAuthHandler2 } from 'vs/code/electron-main/auth2';
import { FileProtocolHandler } from 'vs/code/electron-main/protocol';
import { Disposable } from 'vs/base/common/lifecycle';
import { IWindowsMainService, ICodeWindow } from 'vs/platform/windows/electron-main/windows';
import { URI } from 'vs/base/common/uri';
import { hasWorkspaceFileExtension, IWorkspacesService } from 'vs/platform/workspaces/common/workspaces';
import { WorkspacesService } from 'vs/platform/workspaces/electron-main/workspacesService';
import { getMachineId } from 'vs/base/node/id';
import { Win32UpdateService } from 'vs/platform/update/electron-main/updateService.win32';
import { LinuxUpdateService } from 'vs/platform/update/electron-main/updateService.linux';
import { DarwinUpdateService } from 'vs/platform/update/electron-main/updateService.darwin';
import { IssueMainService, IIssueMainService } from 'vs/platform/issue/electron-main/issueMainService';
import { LoggerChannel } from 'vs/platform/log/common/logIpc';
import { setUnexpectedErrorHandler, onUnexpectedError } from 'vs/base/common/errors';
import { ElectronURLListener } from 'vs/platform/url/electron-main/electronUrlListener';
import { serve as serveDriver } from 'vs/platform/driver/electron-main/driver';
import { IMenubarMainService, MenubarMainService } from 'vs/platform/menubar/electron-main/menubarMainService';
import { RunOnceScheduler } from 'vs/base/common/async';
import { registerContextMenuListener } from 'vs/base/parts/contextmenu/electron-main/contextmenu';
import { sep, posix, join, isAbsolute } from 'vs/base/common/path';
import { joinPath } from 'vs/base/common/resources';
import { localize } from 'vs/nls';
import { Schemas } from 'vs/base/common/network';
import { SnapUpdateService } from 'vs/platform/update/electron-main/updateService.snap';
import { IStorageMainService, StorageMainService } from 'vs/platform/storage/node/storageMainService';
import { GlobalStorageDatabaseChannel } from 'vs/platform/storage/node/storageIpc';
import { BackupMainService } from 'vs/platform/backup/electron-main/backupMainService';
import { IBackupMainService } from 'vs/platform/backup/electron-main/backup';
import { WorkspacesHistoryMainService, IWorkspacesHistoryMainService } from 'vs/platform/workspaces/electron-main/workspacesHistoryMainService';
import { NativeURLService } from 'vs/platform/url/common/urlService';
import { WorkspacesMainService, IWorkspacesMainService } from 'vs/platform/workspaces/electron-main/workspacesMainService';
import { statSync } from 'fs';
import { IDiagnosticsService } from 'vs/platform/diagnostics/node/diagnosticsService';
import { ExtensionHostDebugBroadcastChannel } from 'vs/platform/debug/common/extensionHostDebugIpc';
import { ElectronExtensionHostDebugBroadcastChannel } from 'vs/platform/debug/electron-main/extensionHostDebugIpc';
import { INativeHostMainService, NativeHostMainService } from 'vs/platform/native/electron-main/nativeHostMainService';
import { ISharedProcessMainService, SharedProcessMainService } from 'vs/platform/ipc/electron-main/sharedProcessMainService';
import { IDialogMainService, DialogMainService } from 'vs/platform/dialogs/electron-main/dialogs';
import { withNullAsUndefined } from 'vs/base/common/types';
import { mnemonicButtonLabel, getPathLabel } from 'vs/base/common/labels';
import { WebviewMainService } from 'vs/platform/webview/electron-main/webviewMainService';
import { IWebviewManagerService } from 'vs/platform/webview/common/webviewManagerService';
import { IFileService } from 'vs/platform/files/common/files';
import { stripComments } from 'vs/base/common/json';
import { generateUuid } from 'vs/base/common/uuid';
import { VSBuffer } from 'vs/base/common/buffer';
import { EncryptionMainService, IEncryptionMainService } from 'vs/platform/encryption/electron-main/encryptionMainService';
import { ActiveWindowManager } from 'vs/platform/windows/common/windowTracker';
import { IKeyboardLayoutMainService, KeyboardLayoutMainService } from 'vs/platform/keyboardLayout/electron-main/keyboardLayoutMainService';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { DisplayMainService, IDisplayMainService } from 'vs/platform/display/electron-main/displayMainService';
import { isLaunchedFromCli } from 'vs/platform/environment/node/argvHelper';
import { isEqualOrParent } from 'vs/base/common/extpath';
import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { IExtensionUrlTrustService } from 'vs/platform/extensionManagement/common/extensionUrlTrust';
import { ExtensionUrlTrustService } from 'vs/platform/extensionManagement/node/extensionUrlTrustService';

export class CodeApplication extends Disposable {
	private windowsMainService: IWindowsMainService | undefined;
	private dialogMainService: IDialogMainService | undefined;
	private nativeHostMainService: INativeHostMainService | undefined;

	constructor(
		private readonly mainIpcServer: Server,
		private readonly userEnv: IProcessEnvironment,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ILogService private readonly logService: ILogService,
		@IEnvironmentMainService private readonly environmentService: IEnvironmentMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStateService private readonly stateService: IStateService,
		@IFileService private readonly fileService: IFileService
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
			this.logService.trace(`App#on(remote-get-global): prevented on ${module}`);

			event.preventDefault();
		});
		app.on('remote-get-builtin', (event, sender, module) => {
			this.logService.trace(`App#on(remote-get-builtin): prevented on ${module}`);

			if (module !== 'clipboard') {
				event.preventDefault();
			}
		});
		app.on('remote-get-current-window', event => {
			this.logService.trace(`App#on(remote-get-current-window): prevented`);

			event.preventDefault();
		});
		app.on('remote-get-current-web-contents', event => {
			if (this.environmentService.args.driver) {
				return; // the driver needs access to web contents
			}

			this.logService.trace(`App#on(remote-get-current-web-contents): prevented`);

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
						return uri.path === '/index.html' || uri.path === '/electron-browser/index.html';
					}

					const srcUri = uri.fsPath.toLowerCase();
					const rootUri = URI.file(this.environmentService.appRoot).fsPath.toLowerCase();

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

			session.defaultSession.setPermissionRequestHandler((webContents, permission /* 'media' | 'geolocation' | 'notifications' | 'midiSysex' | 'pointerLock' | 'fullscreen' | 'openExternal' */, callback) => {
				return callback(false);
			});

			session.defaultSession.setPermissionCheckHandler((webContents, permission /* 'media' */) => {
				return false;
			});
		});

		//#endregion

		let macOpenFileURIs: IWindowOpenable[] = [];
		let runningTimeout: NodeJS.Timeout | null = null;
		app.on('open-file', (event, path) => {
			this.logService.trace('app#open-file: ', path);
			event.preventDefault();

			// Keep in array because more might come!
			macOpenFileURIs.push(this.getWindowOpenableFromPathSync(path));

			// Clear previous handler if any
			if (runningTimeout !== null) {
				clearTimeout(runningTimeout);
				runningTimeout = null;
			}

			// Handle paths delayed in case more are coming!
			runningTimeout = setTimeout(() => {
				this.windowsMainService?.open({
					context: OpenContext.DOCK /* can also be opening from finder while app is running */,
					cli: this.environmentService.args,
					urisToOpen: macOpenFileURIs,
					gotoLineMode: false,
					preferNewWindow: true /* dropping on the dock or opening from finder prefers to open in a new window */
				});

				macOpenFileURIs = [];
				runningTimeout = null;
			}, 100);
		});

		app.on('new-window-for-tab', () => {
			this.windowsMainService?.openEmptyWindow({ context: OpenContext.DESKTOP }); //macOS native tab "+" button
		});

		//#region Bootstrap IPC Handlers

		ipcMain.on('vscode:fetchShellEnv', async event => {
			const webContents = event.sender;
			const window = this.windowsMainService?.getWindowByWebContents(event.sender);

			let replied = false;

			function acceptShellEnv(env: NodeJS.ProcessEnv): void {
				clearTimeout(shellEnvSlowWarningHandle);
				clearTimeout(shellEnvTimeoutErrorHandle);

				if (!replied) {
					replied = true;

					if (!webContents.isDestroyed()) {
						webContents.send('vscode:acceptShellEnv', env);
					}
				}
			}

			// Handle slow shell environment resolve calls:
			// - a warning after 3s but continue to resolve
			// - an error after 10s and stop trying to resolve
			const cts = new CancellationTokenSource();
			const shellEnvSlowWarningHandle = setTimeout(() => window?.sendWhenReady('vscode:showShellEnvSlowWarning', cts.token), 3000);
			const shellEnvTimeoutErrorHandle = setTimeout(function () {
				cts.dispose(true);
				window?.sendWhenReady('vscode:showShellEnvTimeoutError', CancellationToken.None);
				acceptShellEnv({});
			}, 10000);

			// Prefer to use the args and env from the target window
			// when resolving the shell env. It is possible that
			// a first window was opened from the UI but a second
			// from the CLI and that has implications for wether to
			// resolve the shell environment or not.
			let args: NativeParsedArgs;
			let env: NodeJS.ProcessEnv;
			if (window?.config) {
				args = window.config;
				env = { ...process.env, ...window.config.userEnv };
			} else {
				args = this.environmentService.args;
				env = process.env;
			}

			// Resolve shell env
			const shellEnv = await resolveShellEnv(this.logService, args, env);
			acceptShellEnv(shellEnv);
		});

		ipcMain.handle('vscode:writeNlsFile', (event, path: unknown, data: unknown) => {
			const uri = this.validateNlsPath([path]);
			if (!uri || typeof data !== 'string') {
				return Promise.reject('Invalid operation (vscode:writeNlsFile)');
			}

			return this.fileService.writeFile(uri, VSBuffer.fromString(data));
		});

		ipcMain.handle('vscode:readNlsFile', async (event, ...paths: unknown[]) => {
			const uri = this.validateNlsPath(paths);
			if (!uri) {
				return Promise.reject('Invalid operation (vscode:readNlsFile)');
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

		if (typeof path !== 'string' || !isAbsolute(path) || !isEqualOrParent(path, this.environmentService.cachedLanguagesPath, !isLinux)) {
			return undefined;
		}

		return URI.file(path);
	}

	private onUnexpectedError(err: Error): void {
		if (err) {

			// take only the message and stack property
			const friendlyError = {
				message: err.message,
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
		this.logService.debug(`from: ${this.environmentService.appRoot}`);
		this.logService.debug('args:', this.environmentService.args);

		// Make sure we associate the program with the app user model id
		// This will help Windows to associate the running program with
		// any shortcut that is pinned to the taskbar and prevent showing
		// two icons in the taskbar for the same app.
		const win32AppUserModelId = product.win32AppUserModelId;
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

		// Setup Protocol Handler
		const fileProtocolHandler = this._register(this.instantiationService.createInstance(FileProtocolHandler));

		// Create Electron IPC Server
		const electronIpcServer = new ElectronIPCServer();

		// Resolve unique machine ID
		this.logService.trace('Resolving machine identifier...');
		const machineId = await this.resolveMachineId();
		this.logService.trace(`Resolved machine identifier: ${machineId}`);

		// Spawn shared process after the first window has opened and 3s have passed
		const sharedProcess = this.instantiationService.createInstance(SharedProcess, machineId, this.userEnv);
		const sharedProcessClient = sharedProcess.whenIpcReady().then(() => {
			this.logService.trace('Shared process: IPC ready');

			return connect(this.environmentService.sharedIPCHandle, 'main');
		});
		const sharedProcessReady = sharedProcess.whenReady().then(() => {
			this.logService.trace('Shared process: init ready');

			return sharedProcessClient;
		});
		this.lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen).then(() => {
			this._register(new RunOnceScheduler(async () => {
				sharedProcess.spawn(await resolveShellEnv(this.logService, this.environmentService.args, process.env));
			}, 3000)).schedule();
		});

		// Services
		const appInstantiationService = await this.createServices(machineId, sharedProcess, sharedProcessReady);

		// Create driver
		if (this.environmentService.driverHandle) {
			const server = await serveDriver(electronIpcServer, this.environmentService.driverHandle, this.environmentService, appInstantiationService);

			this.logService.info('Driver started at:', this.environmentService.driverHandle);
			this._register(server);
		}

		// Setup Auth Handler (TODO@ben remove old auth handler eventually)
		if (this.configurationService.getValue('window.enableExperimentalProxyLoginDialog') === false) {
			this._register(new ProxyAuthHandler());
		} else {
			this._register(appInstantiationService.createInstance(ProxyAuthHandler2));
		}

		// Open Windows
		const windows = appInstantiationService.invokeFunction(accessor => this.openFirstWindow(accessor, electronIpcServer, sharedProcessClient, fileProtocolHandler));

		// Post Open Windows Tasks
		appInstantiationService.invokeFunction(accessor => this.afterWindowOpen(accessor));

		// Tracing: Stop tracing after windows are ready if enabled
		if (this.environmentService.args.trace) {
			this.stopTracingEventually(windows);
		}
	}

	private async resolveMachineId(): Promise<string> {

		// We cache the machineId for faster lookups on startup
		// and resolve it only once initially if not cached or we need to replace the macOS iBridge device
		let machineId = this.stateService.getItem<string>(machineIdKey);
		if (!machineId || (isMacintosh && machineId === '6c9d2bc8f91b89624add29c0abeae7fb42bf539fa1cdb2e3e57cd668fa9bcead')) {
			machineId = await getMachineId();

			this.stateService.setItem(machineIdKey, machineId);
		}

		return machineId;
	}

	private async createServices(machineId: string, sharedProcess: SharedProcess, sharedProcessReady: Promise<Client<string>>): Promise<IInstantiationService> {
		const services = new ServiceCollection();

		switch (process.platform) {
			case 'win32':
				services.set(IUpdateService, new SyncDescriptor(Win32UpdateService));
				break;

			case 'linux':
				if (process.env.SNAP && process.env.SNAP_REVISION) {
					services.set(IUpdateService, new SyncDescriptor(SnapUpdateService, [process.env.SNAP, process.env.SNAP_REVISION]));
				} else {
					services.set(IUpdateService, new SyncDescriptor(LinuxUpdateService));
				}
				break;

			case 'darwin':
				services.set(IUpdateService, new SyncDescriptor(DarwinUpdateService));
				break;
		}

		services.set(IWindowsMainService, new SyncDescriptor(WindowsMainService, [machineId, this.userEnv]));
		services.set(IDialogMainService, new SyncDescriptor(DialogMainService));
		services.set(ISharedProcessMainService, new SyncDescriptor(SharedProcessMainService, [sharedProcess]));
		services.set(ILaunchMainService, new SyncDescriptor(LaunchMainService));
		services.set(IDiagnosticsService, createChannelSender(getDelayedChannel(sharedProcessReady.then(client => client.getChannel('diagnostics')))));

		services.set(IIssueMainService, new SyncDescriptor(IssueMainService, [machineId, this.userEnv]));
		services.set(IEncryptionMainService, new SyncDescriptor(EncryptionMainService, [machineId]));
		services.set(IKeyboardLayoutMainService, new SyncDescriptor(KeyboardLayoutMainService));
		services.set(IDisplayMainService, new SyncDescriptor(DisplayMainService));
		services.set(INativeHostMainService, new SyncDescriptor(NativeHostMainService));
		services.set(IWebviewManagerService, new SyncDescriptor(WebviewMainService));
		services.set(IWorkspacesService, new SyncDescriptor(WorkspacesService));
		services.set(IMenubarMainService, new SyncDescriptor(MenubarMainService));
		services.set(IExtensionUrlTrustService, new SyncDescriptor(ExtensionUrlTrustService));

		const storageMainService = new StorageMainService(this.logService, this.environmentService);
		services.set(IStorageMainService, storageMainService);
		this.lifecycleMainService.onWillShutdown(e => e.join(storageMainService.close()));

		const backupMainService = new BackupMainService(this.environmentService, this.configurationService, this.logService);
		services.set(IBackupMainService, backupMainService);

		services.set(IWorkspacesHistoryMainService, new SyncDescriptor(WorkspacesHistoryMainService));
		services.set(IURLService, new SyncDescriptor(NativeURLService));
		services.set(IWorkspacesMainService, new SyncDescriptor(WorkspacesMainService));

		// Telemetry
		if (!this.environmentService.isExtensionDevelopment && !this.environmentService.args['disable-telemetry'] && !!product.enableTelemetry) {
			const channel = getDelayedChannel(sharedProcessReady.then(client => client.getChannel('telemetryAppender')));
			const appender = new TelemetryAppenderClient(channel);
			const commonProperties = resolveCommonProperties(product.commit, product.version, machineId, product.msftInternalDomains, this.environmentService.installSourcePath);
			const piiPaths = [this.environmentService.appRoot, this.environmentService.extensionsPath];
			const config: ITelemetryServiceConfig = { appender, commonProperties, piiPaths, sendErrorTelemetry: true };

			services.set(ITelemetryService, new SyncDescriptor(TelemetryService, [config]));
		} else {
			services.set(ITelemetryService, NullTelemetryService);
		}

		// Init services that require it
		await backupMainService.initialize();

		return this.instantiationService.createChild(services);
	}

	private stopTracingEventually(windows: ICodeWindow[]): void {
		this.logService.info(`Tracing: waiting for windows to get ready...`);

		let recordingStopped = false;
		const stopRecording = async (timeout: boolean) => {
			if (recordingStopped) {
				return;
			}

			recordingStopped = true; // only once

			const path = await contentTracing.stopRecording(joinPath(this.environmentService.userHome, `${product.applicationName}-${Math.random().toString(16).slice(-4)}.trace.txt`).fsPath);

			if (!timeout) {
				this.dialogMainService?.showMessageBox({
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

	private openFirstWindow(accessor: ServicesAccessor, electronIpcServer: ElectronIPCServer, sharedProcessClient: Promise<Client<string>>, fileProtocolHandler: FileProtocolHandler): ICodeWindow[] {

		// Register more Main IPC services
		const launchMainService = accessor.get(ILaunchMainService);
		const launchChannel = createChannelReceiver(launchMainService, { disableMarshalling: true });
		this.mainIpcServer.registerChannel('launch', launchChannel);

		// Register more Electron IPC services
		const updateService = accessor.get(IUpdateService);
		const updateChannel = new UpdateChannel(updateService);
		electronIpcServer.registerChannel('update', updateChannel);

		const issueMainService = accessor.get(IIssueMainService);
		const issueChannel = createChannelReceiver(issueMainService);
		electronIpcServer.registerChannel('issue', issueChannel);

		const encryptionMainService = accessor.get(IEncryptionMainService);
		const encryptionChannel = createChannelReceiver(encryptionMainService);
		electronIpcServer.registerChannel('encryption', encryptionChannel);

		const keyboardLayoutMainService = accessor.get(IKeyboardLayoutMainService);
		const keyboardLayoutChannel = createChannelReceiver(keyboardLayoutMainService);
		electronIpcServer.registerChannel('keyboardLayout', keyboardLayoutChannel);

		const displayMainService = accessor.get(IDisplayMainService);
		const displayChannel = createChannelReceiver(displayMainService);
		electronIpcServer.registerChannel('display', displayChannel);

		const nativeHostMainService = this.nativeHostMainService = accessor.get(INativeHostMainService);
		const nativeHostChannel = createChannelReceiver(this.nativeHostMainService);
		electronIpcServer.registerChannel('nativeHost', nativeHostChannel);
		sharedProcessClient.then(client => client.registerChannel('nativeHost', nativeHostChannel));

		const sharedProcessMainService = accessor.get(ISharedProcessMainService);
		const sharedProcessChannel = createChannelReceiver(sharedProcessMainService);
		electronIpcServer.registerChannel('sharedProcess', sharedProcessChannel);

		const workspacesService = accessor.get(IWorkspacesService);
		const workspacesChannel = createChannelReceiver(workspacesService);
		electronIpcServer.registerChannel('workspaces', workspacesChannel);

		const menubarMainService = accessor.get(IMenubarMainService);
		const menubarChannel = createChannelReceiver(menubarMainService);
		electronIpcServer.registerChannel('menubar', menubarChannel);

		const urlService = accessor.get(IURLService);
		const urlChannel = createChannelReceiver(urlService);
		electronIpcServer.registerChannel('url', urlChannel);

		const extensionUrlTrustService = accessor.get(IExtensionUrlTrustService);
		const extensionUrlTrustChannel = createChannelReceiver(extensionUrlTrustService);
		electronIpcServer.registerChannel('extensionUrlTrust', extensionUrlTrustChannel);

		const webviewManagerService = accessor.get(IWebviewManagerService);
		const webviewChannel = createChannelReceiver(webviewManagerService);
		electronIpcServer.registerChannel('webview', webviewChannel);

		const storageMainService = accessor.get(IStorageMainService);
		const storageChannel = this._register(new GlobalStorageDatabaseChannel(this.logService, storageMainService));
		electronIpcServer.registerChannel('storage', storageChannel);
		sharedProcessClient.then(client => client.registerChannel('storage', storageChannel));

		const loggerChannel = new LoggerChannel(accessor.get(ILogService));
		electronIpcServer.registerChannel('logger', loggerChannel);
		sharedProcessClient.then(client => client.registerChannel('logger', loggerChannel));

		const windowsMainService = this.windowsMainService = accessor.get(IWindowsMainService);
		fileProtocolHandler.injectWindowsMainService(windowsMainService);

		// ExtensionHost Debug broadcast service
		electronIpcServer.registerChannel(ExtensionHostDebugBroadcastChannel.ChannelName, new ElectronExtensionHostDebugBroadcastChannel(windowsMainService));

		// Signal phase: ready (services set)
		this.lifecycleMainService.phase = LifecycleMainPhase.Ready;

		// Propagate to clients
		this.dialogMainService = accessor.get(IDialogMainService);

		// Check for initial URLs to handle from protocol link invocations
		const pendingWindowOpenablesFromProtocolLinks: IWindowOpenable[] = [];
		const pendingProtocolLinksToHandle = [
			// Windows/Linux: protocol handler invokes CLI with --open-url
			...this.environmentService.args['open-url'] ? this.environmentService.args._urls || [] : [],

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
		const app = this;
		const environmentService = this.environmentService;
		urlService.registerHandler({
			async handleURL(uri: URI, options?: IOpenURLOptions): Promise<boolean> {

				// If URI should be blocked, behave as if it's handled
				if (app.shouldBlockURI(uri)) {
					return true;
				}

				// Check for URIs to open in window
				const windowOpenableFromProtocolLink = app.getWindowOpenableFromProtocolLink(uri);
				if (windowOpenableFromProtocolLink) {
					windowsMainService.open({
						context: OpenContext.API,
						cli: { ...environmentService.args },
						urisToOpen: [windowOpenableFromProtocolLink],
						gotoLineMode: true
					});

					return true;
				}

				// If we have not yet handled the URI and we have no window opened (macOS only)
				// we first open a window and then try to open that URI within that window
				if (isMacintosh && windowsMainService.getWindowCount() === 0) {
					const [window] = windowsMainService.open({
						context: OpenContext.API,
						cli: { ...environmentService.args },
						forceEmpty: true,
						gotoLineMode: true
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
		const urlHandlerChannel = electronIpcServer.getChannel('urlHandler', urlHandlerRouter);
		urlService.registerHandler(new URLHandlerChannelClient(urlHandlerChannel));

		// Watch Electron URLs and forward them to the UrlService
		this._register(new ElectronURLListener(pendingProtocolLinksToHandle, urlService, windowsMainService, this.environmentService));

		// Open our first window
		const args = this.environmentService.args;
		const macOpenFiles: string[] = (<any>global).macOpenFiles;
		const context = isLaunchedFromCli(process.env) ? OpenContext.CLI : OpenContext.DESKTOP;
		const hasCliArgs = args._.length;
		const hasFolderURIs = !!args['folder-uri'];
		const hasFileURIs = !!args['file-uri'];
		const noRecentEntry = args['skip-add-to-recently-opened'] === true;
		const waitMarkerFileURI = args.wait && args.waitMarkerFilePath ? URI.file(args.waitMarkerFilePath) : undefined;

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
				initialStartup: true
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
				initialStartup: true
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
			initialStartup: true
		});
	}

	private shouldBlockURI(uri: URI): boolean {
		if (uri.authority === Schemas.file && isWindows) {
			const res = dialog.showMessageBoxSync({
				title: product.nameLong,
				type: 'question',
				buttons: [
					mnemonicButtonLabel(localize({ key: 'open', comment: ['&& denotes a mnemonic'] }, "&&Yes")),
					mnemonicButtonLabel(localize({ key: 'cancel', comment: ['&& denotes a mnemonic'] }, "&&No")),
				],
				cancelId: 1,
				message: localize('confirmOpenMessage', "An external application wants to open '{0}' in {1}. Do you want to open this file or folder?", getPathLabel(uri.fsPath), product.nameShort),
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

	private async afterWindowOpen(accessor: ServicesAccessor): Promise<void> {

		// Signal phase: after window open
		this.lifecycleMainService.phase = LifecycleMainPhase.AfterWindowOpen;

		// Remote Authorities
		this.handleRemoteAuthorities();

		// Initialize update service
		const updateService = accessor.get(IUpdateService);
		if (updateService instanceof Win32UpdateService || updateService instanceof LinuxUpdateService || updateService instanceof DarwinUpdateService) {
			updateService.initialize();
		}

		// Start to fetch shell environment (if needed) after window has opened
		resolveShellEnv(this.logService, this.environmentService.args, process.env);

		// If enable-crash-reporter argv is undefined then this is a fresh start,
		// based on telemetry.enableCrashreporter settings, generate a UUID which
		// will be used as crash reporter id and also update the json file.
		try {
			const argvContent = await this.fileService.readFile(this.environmentService.argvResource);
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
				await this.fileService.writeFile(this.environmentService.argvResource, VSBuffer.fromString(newArgvString));
			}
		} catch (error) {
			this.logService.error(error);
		}
	}

	private handleRemoteAuthorities(): void {
		protocol.registerHttpProtocol(Schemas.vscodeRemoteResource, (request, callback) => {
			callback({
				url: request.url.replace(/^vscode-remote-resource:/, 'http:'),
				method: request.method
			});
		});
	}
}
