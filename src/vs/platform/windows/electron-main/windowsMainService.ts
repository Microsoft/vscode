/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as fs from 'fs';
import { basename, normalize, join, posix } from 'vs/base/common/path';
import { localize } from 'vs/nls';
import * as arrays from 'vs/base/common/arrays';
import { mixin } from 'vs/base/common/objects';
import { IBackupMainService } from 'vs/platform/backup/electron-main/backup';
import { IEmptyWindowBackupInfo } from 'vs/platform/backup/node/backup';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { ParsedArgs } from 'vs/platform/environment/node/argv';
import { INativeEnvironmentService } from 'vs/platform/environment/node/environmentService';
import { IStateService } from 'vs/platform/state/node/state';
import { CodeWindow, defaultWindowState } from 'vs/code/electron-main/window';
import { ipcMain as ipc, screen, BrowserWindow, MessageBoxOptions, Display, app, nativeTheme } from 'electron';
import { parseLineAndColumnAware } from 'vs/code/node/paths';
import { ILifecycleMainService, UnloadReason, LifecycleMainService, LifecycleMainPhase } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { IWindowSettings, IPath, isFileToOpen, isWorkspaceToOpen, isFolderToOpen, IWindowOpenable, IOpenEmptyWindowOptions } from 'vs/platform/windows/common/windows';
import { getLastActiveWindow, findBestWindowOrFolderForFile, findWindowOnWorkspace, findWindowOnExtensionDevelopmentPath, findWindowOnWorkspaceOrFolderUri, INativeWindowConfiguration, OpenContext, IAddFoldersRequest, IPathsToWaitFor } from 'vs/platform/windows/node/window';
import { Emitter } from 'vs/base/common/event';
import product from 'vs/platform/product/common/product';
import { IWindowsMainService, IOpenConfiguration, IWindowsCountChangedEvent, ICodeWindow, IWindowState as ISingleWindowState, WindowMode } from 'vs/platform/windows/electron-main/windows';
import { IWorkspacesHistoryMainService } from 'vs/platform/workspaces/electron-main/workspacesHistoryMainService';
import { IProcessEnvironment, isMacintosh, isWindows } from 'vs/base/common/platform';
import { IWorkspaceIdentifier, isSingleFolderWorkspaceIdentifier, hasWorkspaceFileExtension, IRecent } from 'vs/platform/workspaces/common/workspaces';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { getComparisonKey, isEqual, normalizePath, originalFSPath, removeTrailingPathSeparator } from 'vs/base/common/resources';
import { getRemoteAuthority } from 'vs/platform/remote/common/remoteHosts';
import { restoreWindowsState, WindowsStateStorageData, getWindowsStateStoreData } from 'vs/platform/windows/electron-main/windowsStateStorage';
import { getWorkspaceIdentifier, IWorkspacesMainService } from 'vs/platform/workspaces/electron-main/workspacesMainService';
import { once } from 'vs/base/common/functional';
import { Disposable } from 'vs/base/common/lifecycle';
import { IDialogMainService } from 'vs/platform/dialogs/electron-main/dialogs';
import { withNullAsUndefined } from 'vs/base/common/types';
import { isWindowsDriveLetter, toSlashes } from 'vs/base/common/extpath';
import { CharCode } from 'vs/base/common/charCode';

export interface IWindowState {
	workspace?: IWorkspaceIdentifier;
	folderUri?: URI;
	backupPath?: string;
	remoteAuthority?: string;
	uiState: ISingleWindowState;
}

export interface IWindowsState {
	lastActiveWindow?: IWindowState;
	lastPluginDevelopmentHostWindow?: IWindowState;
	openedWindows: IWindowState[];
}

interface INewWindowState extends ISingleWindowState {
	hasDefaultState?: boolean;
}

type RestoreWindowsSetting = 'all' | 'folders' | 'one' | 'none';

interface IOpenBrowserWindowOptions {
	userEnv?: IProcessEnvironment;
	cli?: ParsedArgs;

	workspace?: IWorkspaceIdentifier;
	folderUri?: URI;

	remoteAuthority?: string;

	initialStartup?: boolean;

	fileInputs?: IFileInputs;

	forceNewWindow?: boolean;
	forceNewTabbedWindow?: boolean;
	windowToUse?: ICodeWindow;

	emptyWindowBackupInfo?: IEmptyWindowBackupInfo;
}

interface IPathParseOptions {
	ignoreFileNotFound?: boolean;
	gotoLineMode?: boolean;
	remoteAuthority?: string;
}

interface IFileInputs {
	filesToOpenOrCreate: IPath[];
	filesToDiff: IPath[];
	filesToWait?: IPathsToWaitFor;
	remoteAuthority?: string;
}

interface IPathToOpen extends IPath {

	// the workspace for a Code instance to open
	workspace?: IWorkspaceIdentifier;

	// the folder path for a Code instance to open
	folderUri?: URI;

	// the backup path for a Code instance to use
	backupPath?: string;

	// the remote authority for the Code instance to open. Undefined if not remote.
	remoteAuthority?: string;

	// optional label for the recent history
	label?: string;
}

function isFolderPathToOpen(path: IPathToOpen): path is IFolderPathToOpen {
	return !!path.folderUri;
}

interface IFolderPathToOpen {

	// the folder path for a Code instance to open
	folderUri: URI;

	// the backup path for a Code instance to use
	backupPath?: string;

	// the remote authority for the Code instance to open. Undefined if not remote.
	remoteAuthority?: string;

	// optional label for the recent history
	label?: string;
}

function isWorkspacePathToOpen(path: IPathToOpen): path is IWorkspacePathToOpen {
	return !!path.workspace;
}

interface IWorkspacePathToOpen {

	// the workspace for a Code instance to open
	workspace: IWorkspaceIdentifier;

	// the backup path for a Code instance to use
	backupPath?: string;

	// the remote authority for the Code instance to open. Undefined if not remote.
	remoteAuthority?: string;

	// optional label for the recent history
	label?: string;
}

export class WindowsMainService extends Disposable implements IWindowsMainService {

	_serviceBrand: undefined;

	private static readonly windowsStateStorageKey = 'windowsState';

	private static readonly WINDOWS: ICodeWindow[] = [];

	private readonly windowsState: IWindowsState;
	private lastClosedWindowState?: IWindowState;

	private shuttingDown = false;

	private readonly _onWindowReady = this._register(new Emitter<ICodeWindow>());
	readonly onWindowReady = this._onWindowReady.event;

	private readonly _onWindowClose = this._register(new Emitter<number>());
	readonly onWindowClose = this._onWindowClose.event;

	private readonly _onWindowsCountChanged = this._register(new Emitter<IWindowsCountChangedEvent>());
	readonly onWindowsCountChanged = this._onWindowsCountChanged.event;

	constructor(
		private readonly machineId: string,
		private readonly initialUserEnv: IProcessEnvironment,
		@ILogService private readonly logService: ILogService,
		@IStateService private readonly stateService: IStateService,
		@IEnvironmentService private readonly environmentService: INativeEnvironmentService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IBackupMainService private readonly backupMainService: IBackupMainService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspacesHistoryMainService private readonly workspacesHistoryMainService: IWorkspacesHistoryMainService,
		@IWorkspacesMainService private readonly workspacesMainService: IWorkspacesMainService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IDialogMainService private readonly dialogMainService: IDialogMainService
	) {
		super();

		this.windowsState = restoreWindowsState(this.stateService.getItem<WindowsStateStorageData>(WindowsMainService.windowsStateStorageKey));
		if (!Array.isArray(this.windowsState.openedWindows)) {
			this.windowsState.openedWindows = [];
		}

		this.lifecycleMainService.when(LifecycleMainPhase.Ready).then(() => this.registerListeners());
		this.lifecycleMainService.when(LifecycleMainPhase.AfterWindowOpen).then(() => this.installWindowsMutex());
	}

	private installWindowsMutex(): void {
		const win32MutexName = product.win32MutexName;
		if (isWindows && win32MutexName) {
			try {
				const WindowsMutex = (require.__$__nodeRequire('windows-mutex') as typeof import('windows-mutex')).Mutex;
				const mutex = new WindowsMutex(win32MutexName);
				once(this.lifecycleMainService.onWillShutdown)(() => mutex.release());
			} catch (e) {
				this.logService.error(e);
			}
		}
	}

	private registerListeners(): void {

		// React to workbench ready events from windows
		ipc.on('vscode:workbenchReady', (event: Event, windowId: number) => {
			this.logService.trace('IPC#vscode-workbenchReady');

			const win = this.getWindowById(windowId);
			if (win) {
				win.setReady();

				// Event
				this._onWindowReady.fire(win);
			}
		});

		// React to HC color scheme changes (Windows)
		if (isWindows) {
			nativeTheme.on('updated', () => {
				if (nativeTheme.shouldUseInvertedColorScheme || nativeTheme.shouldUseHighContrastColors) {
					this.sendToAll('vscode:enterHighContrast');
				} else {
					this.sendToAll('vscode:leaveHighContrast');
				}
			});
		}

		// When a window looses focus, save all windows state. This allows to
		// prevent loss of window-state data when OS is restarted without properly
		// shutting down the application (https://github.com/microsoft/vscode/issues/87171)
		app.on('browser-window-blur', () => {
			if (!this.shuttingDown) {
				this.saveWindowsState();
			}
		});

		// Handle various lifecycle events around windows
		this.lifecycleMainService.onBeforeWindowClose(window => this.onBeforeWindowClose(window));
		this.lifecycleMainService.onBeforeShutdown(() => this.onBeforeShutdown());
		this.onWindowsCountChanged(e => {
			if (e.newCount - e.oldCount > 0) {
				// clear last closed window state when a new window opens. this helps on macOS where
				// otherwise closing the last window, opening a new window and then quitting would
				// use the state of the previously closed window when restarting.
				this.lastClosedWindowState = undefined;
			}
		});

		// Signal a window is ready after having entered a workspace
		this._register(this.workspacesMainService.onWorkspaceEntered(event => {
			this._onWindowReady.fire(event.window);
		}));
	}

	// Note that onBeforeShutdown() and onBeforeWindowClose() are fired in different order depending on the OS:
	// - macOS: since the app will not quit when closing the last window, you will always first get
	//          the onBeforeShutdown() event followed by N onbeforeWindowClose() events for each window
	// - other: on other OS, closing the last window will quit the app so the order depends on the
	//          user interaction: closing the last window will first trigger onBeforeWindowClose()
	//          and then onBeforeShutdown(). Using the quit action however will first issue onBeforeShutdown()
	//          and then onBeforeWindowClose().
	//
	// Here is the behaviour on different OS dependig on action taken (Electron 1.7.x):
	//
	// Legend
	// -  quit(N): quit application with N windows opened
	// - close(1): close one window via the window close button
	// - closeAll: close all windows via the taskbar command
	// - onBeforeShutdown(N): number of windows reported in this event handler
	// - onBeforeWindowClose(N, M): number of windows reported and quitRequested boolean in this event handler
	//
	// macOS
	// 	-     quit(1): onBeforeShutdown(1), onBeforeWindowClose(1, true)
	// 	-     quit(2): onBeforeShutdown(2), onBeforeWindowClose(2, true), onBeforeWindowClose(2, true)
	// 	-     quit(0): onBeforeShutdown(0)
	// 	-    close(1): onBeforeWindowClose(1, false)
	//
	// Windows
	// 	-     quit(1): onBeforeShutdown(1), onBeforeWindowClose(1, true)
	// 	-     quit(2): onBeforeShutdown(2), onBeforeWindowClose(2, true), onBeforeWindowClose(2, true)
	// 	-    close(1): onBeforeWindowClose(2, false)[not last window]
	// 	-    close(1): onBeforeWindowClose(1, false), onBeforeShutdown(0)[last window]
	// 	- closeAll(2): onBeforeWindowClose(2, false), onBeforeWindowClose(2, false), onBeforeShutdown(0)
	//
	// Linux
	// 	-     quit(1): onBeforeShutdown(1), onBeforeWindowClose(1, true)
	// 	-     quit(2): onBeforeShutdown(2), onBeforeWindowClose(2, true), onBeforeWindowClose(2, true)
	// 	-    close(1): onBeforeWindowClose(2, false)[not last window]
	// 	-    close(1): onBeforeWindowClose(1, false), onBeforeShutdown(0)[last window]
	// 	- closeAll(2): onBeforeWindowClose(2, false), onBeforeWindowClose(2, false), onBeforeShutdown(0)
	//
	private onBeforeShutdown(): void {
		this.shuttingDown = true;

		this.saveWindowsState();
	}

	private saveWindowsState(): void {
		const currentWindowsState: IWindowsState = {
			openedWindows: [],
			lastPluginDevelopmentHostWindow: this.windowsState.lastPluginDevelopmentHostWindow,
			lastActiveWindow: this.lastClosedWindowState
		};

		// 1.) Find a last active window (pick any other first window otherwise)
		if (!currentWindowsState.lastActiveWindow) {
			let activeWindow = this.getLastActiveWindow();
			if (!activeWindow || activeWindow.isExtensionDevelopmentHost) {
				activeWindow = WindowsMainService.WINDOWS.find(window => !window.isExtensionDevelopmentHost);
			}

			if (activeWindow) {
				currentWindowsState.lastActiveWindow = this.toWindowState(activeWindow);
			}
		}

		// 2.) Find extension host window
		const extensionHostWindow = WindowsMainService.WINDOWS.find(window => window.isExtensionDevelopmentHost && !window.isExtensionTestHost);
		if (extensionHostWindow) {
			currentWindowsState.lastPluginDevelopmentHostWindow = this.toWindowState(extensionHostWindow);
		}

		// 3.) All windows (except extension host) for N >= 2 to support restoreWindows: all or for auto update
		//
		// Carefull here: asking a window for its window state after it has been closed returns bogus values (width: 0, height: 0)
		// so if we ever want to persist the UI state of the last closed window (window count === 1), it has
		// to come from the stored lastClosedWindowState on Win/Linux at least
		if (this.getWindowCount() > 1) {
			currentWindowsState.openedWindows = WindowsMainService.WINDOWS.filter(window => !window.isExtensionDevelopmentHost).map(window => this.toWindowState(window));
		}

		// Persist
		const state = getWindowsStateStoreData(currentWindowsState);
		this.stateService.setItem(WindowsMainService.windowsStateStorageKey, state);

		if (this.shuttingDown) {
			this.logService.trace('onBeforeShutdown', state);
		}
	}

	// See note on #onBeforeShutdown() for details how these events are flowing
	private onBeforeWindowClose(win: ICodeWindow): void {
		if (this.lifecycleMainService.quitRequested) {
			return; // during quit, many windows close in parallel so let it be handled in the before-quit handler
		}

		// On Window close, update our stored UI state of this window
		const state: IWindowState = this.toWindowState(win);
		if (win.isExtensionDevelopmentHost && !win.isExtensionTestHost) {
			this.windowsState.lastPluginDevelopmentHostWindow = state; // do not let test run window state overwrite our extension development state
		}

		// Any non extension host window with same workspace or folder
		else if (!win.isExtensionDevelopmentHost && (!!win.openedWorkspace || !!win.openedFolderUri)) {
			this.windowsState.openedWindows.forEach(o => {
				const sameWorkspace = win.openedWorkspace && o.workspace && o.workspace.id === win.openedWorkspace.id;
				const sameFolder = win.openedFolderUri && o.folderUri && isEqual(o.folderUri, win.openedFolderUri);

				if (sameWorkspace || sameFolder) {
					o.uiState = state.uiState;
				}
			});
		}

		// On Windows and Linux closing the last window will trigger quit. Since we are storing all UI state
		// before quitting, we need to remember the UI state of this window to be able to persist it.
		// On macOS we keep the last closed window state ready in case the user wants to quit right after or
		// wants to open another window, in which case we use this state over the persisted one.
		if (this.getWindowCount() === 1) {
			this.lastClosedWindowState = state;
		}
	}

	private toWindowState(win: ICodeWindow): IWindowState {
		return {
			workspace: win.openedWorkspace,
			folderUri: win.openedFolderUri,
			backupPath: win.backupPath,
			remoteAuthority: win.remoteAuthority,
			uiState: win.serializeWindowState()
		};
	}

	openEmptyWindow(context: OpenContext, options?: IOpenEmptyWindowOptions): ICodeWindow[] {
		let cli = this.environmentService.args;
		const remote = options?.remoteAuthority;
		if (cli && (cli.remote !== remote)) {
			cli = { ...cli, remote };
		}

		const forceReuseWindow = options?.forceReuseWindow;
		const forceNewWindow = !forceReuseWindow;

		return this.open({ context, cli, forceEmpty: true, forceNewWindow, forceReuseWindow });
	}

	open(openConfig: IOpenConfiguration): ICodeWindow[] {
		this.logService.trace('windowsManager#open');
		openConfig = this.validateOpenConfig(openConfig);

		const pathsToOpen = this.getPathsToOpen(openConfig);

		const foldersToAdd: IFolderPathToOpen[] = [];
		const foldersToOpen: IFolderPathToOpen[] = [];
		const workspacesToOpen: IWorkspacePathToOpen[] = [];
		const emptyToRestore: IEmptyWindowBackupInfo[] = []; // empty windows with backupPath
		let emptyToOpen: number = 0;
		let fileInputs: IFileInputs | undefined; 		// collect all file inputs
		for (const path of pathsToOpen) {
			if (isFolderPathToOpen(path)) {
				if (openConfig.addMode) {
					// When run with --add, take the folders that are to be opened as
					// folders that should be added to the currently active window.
					foldersToAdd.push(path);
				} else {
					foldersToOpen.push(path);
				}
			} else if (isWorkspacePathToOpen(path)) {
				workspacesToOpen.push(path);
			} else if (path.fileUri) {
				if (!fileInputs) {
					fileInputs = { filesToOpenOrCreate: [], filesToDiff: [], remoteAuthority: path.remoteAuthority };
				}
				fileInputs.filesToOpenOrCreate.push(path);
			} else if (path.backupPath) {
				emptyToRestore.push({ backupFolder: basename(path.backupPath), remoteAuthority: path.remoteAuthority });
			} else {
				emptyToOpen++;
			}
		}

		// When run with --diff, take the files to open as files to diff
		// if there are exactly two files provided.
		if (fileInputs && openConfig.diffMode && fileInputs.filesToOpenOrCreate.length === 2) {
			fileInputs.filesToDiff = fileInputs.filesToOpenOrCreate;
			fileInputs.filesToOpenOrCreate = [];
		}

		// When run with --wait, make sure we keep the paths to wait for
		if (fileInputs && openConfig.waitMarkerFileURI) {
			fileInputs.filesToWait = { paths: [...fileInputs.filesToDiff, ...fileInputs.filesToOpenOrCreate], waitMarkerFileUri: openConfig.waitMarkerFileURI };
		}

		//
		// These are windows to restore because of hot-exit or from previous session (only performed once on startup!)
		//
		let workspacesToRestore: IWorkspacePathToOpen[] = [];
		if (openConfig.initialStartup && !openConfig.cli.extensionDevelopmentPath && !openConfig.cli['disable-restore-windows']) {

			// Untitled workspaces are always restored
			workspacesToRestore = this.workspacesMainService.getUntitledWorkspacesSync();
			workspacesToOpen.push(...workspacesToRestore);

			// Empty windows with backups are always restored
			emptyToRestore.push(...this.backupMainService.getEmptyWindowBackupPaths());
		} else {
			emptyToRestore.length = 0;
		}

		// Open based on config
		const usedWindows = this.doOpen(openConfig, workspacesToOpen, foldersToOpen, emptyToRestore, emptyToOpen, fileInputs, foldersToAdd);

		// Make sure to pass focus to the most relevant of the windows if we open multiple
		if (usedWindows.length > 1) {

			const focusLastActive = this.windowsState.lastActiveWindow && !openConfig.forceEmpty && openConfig.cli._.length && !openConfig.cli['file-uri'] && !openConfig.cli['folder-uri'] && !(openConfig.urisToOpen && openConfig.urisToOpen.length);
			let focusLastOpened = true;
			let focusLastWindow = true;

			// 1.) focus last active window if we are not instructed to open any paths
			if (focusLastActive) {
				const lastActiveWindow = usedWindows.filter(window => this.windowsState.lastActiveWindow && window.backupPath === this.windowsState.lastActiveWindow.backupPath);
				if (lastActiveWindow.length) {
					lastActiveWindow[0].focus();
					focusLastOpened = false;
					focusLastWindow = false;
				}
			}

			// 2.) if instructed to open paths, focus last window which is not restored
			if (focusLastOpened) {
				for (let i = usedWindows.length - 1; i >= 0; i--) {
					const usedWindow = usedWindows[i];
					if (
						(usedWindow.openedWorkspace && workspacesToRestore.some(workspace => usedWindow.openedWorkspace && workspace.workspace.id === usedWindow.openedWorkspace.id)) ||	// skip over restored workspace
						(usedWindow.backupPath && emptyToRestore.some(empty => usedWindow.backupPath && empty.backupFolder === basename(usedWindow.backupPath)))							// skip over restored empty window
					) {
						continue;
					}

					usedWindow.focus();
					focusLastWindow = false;
					break;
				}
			}

			// 3.) finally, always ensure to have at least last used window focused
			if (focusLastWindow) {
				usedWindows[usedWindows.length - 1].focus();
			}
		}

		// Remember in recent document list (unless this opens for extension development)
		// Also do not add paths when files are opened for diffing, only if opened individually
		const isDiff = fileInputs && fileInputs.filesToDiff.length > 0;
		if (!usedWindows.some(window => window.isExtensionDevelopmentHost) && !isDiff && !openConfig.noRecentEntry) {
			const recents: IRecent[] = [];
			for (let pathToOpen of pathsToOpen) {
				if (pathToOpen.workspace) {
					recents.push({ label: pathToOpen.label, workspace: pathToOpen.workspace });
				} else if (pathToOpen.folderUri) {
					recents.push({ label: pathToOpen.label, folderUri: pathToOpen.folderUri });
				} else if (pathToOpen.fileUri) {
					recents.push({ label: pathToOpen.label, fileUri: pathToOpen.fileUri });
				}
			}
			this.workspacesHistoryMainService.addRecentlyOpened(recents);
		}

		// If we got started with --wait from the CLI, we need to signal to the outside when the window
		// used for the edit operation is closed or loaded to a different folder so that the waiting
		// process can continue. We do this by deleting the waitMarkerFilePath.
		const waitMarkerFileURI = openConfig.waitMarkerFileURI;
		if (openConfig.context === OpenContext.CLI && waitMarkerFileURI && usedWindows.length === 1 && usedWindows[0]) {
			usedWindows[0].whenClosedOrLoaded.then(() => fs.unlink(waitMarkerFileURI.fsPath, _error => undefined));
		}

		return usedWindows;
	}

	private validateOpenConfig(config: IOpenConfiguration): IOpenConfiguration {

		// Make sure addMode is only enabled if we have an active window
		if (config.addMode && (config.initialStartup || !this.getLastActiveWindow())) {
			config.addMode = false;
		}

		return config;
	}

	private doOpen(
		openConfig: IOpenConfiguration,
		workspacesToOpen: IWorkspacePathToOpen[],
		foldersToOpen: IFolderPathToOpen[],
		emptyToRestore: IEmptyWindowBackupInfo[],
		emptyToOpen: number,
		fileInputs: IFileInputs | undefined,
		foldersToAdd: IFolderPathToOpen[]
	) {
		const usedWindows: ICodeWindow[] = [];

		// Settings can decide if files/folders open in new window or not
		let { openFolderInNewWindow, openFilesInNewWindow } = this.shouldOpenNewWindow(openConfig);

		// Handle folders to add by looking for the last active workspace (not on initial startup)
		if (!openConfig.initialStartup && foldersToAdd.length > 0) {
			const authority = foldersToAdd[0].remoteAuthority;
			const lastActiveWindow = this.getLastActiveWindowForAuthority(authority);
			if (lastActiveWindow) {
				usedWindows.push(this.doAddFoldersToExistingWindow(lastActiveWindow, foldersToAdd.map(f => f.folderUri)));
			}
		}

		// Handle files to open/diff or to create when we dont open a folder and we do not restore any folder/untitled from hot-exit
		const potentialWindowsCount = foldersToOpen.length + workspacesToOpen.length + emptyToRestore.length;
		if (potentialWindowsCount === 0 && fileInputs) {

			// Find suitable window or folder path to open files in
			const fileToCheck = fileInputs.filesToOpenOrCreate[0] || fileInputs.filesToDiff[0];

			// only look at the windows with correct authority
			const windows = WindowsMainService.WINDOWS.filter(window => fileInputs && window.remoteAuthority === fileInputs.remoteAuthority);

			const bestWindowOrFolder = findBestWindowOrFolderForFile({
				windows,
				newWindow: openFilesInNewWindow,
				context: openConfig.context,
				fileUri: fileToCheck?.fileUri,
				localWorkspaceResolver: workspace => workspace.configPath.scheme === Schemas.file ? this.workspacesMainService.resolveLocalWorkspaceSync(workspace.configPath) : null
			});

			// We found a window to open the files in
			if (bestWindowOrFolder instanceof CodeWindow) {

				// Window is workspace
				if (bestWindowOrFolder.openedWorkspace) {
					workspacesToOpen.push({ workspace: bestWindowOrFolder.openedWorkspace, remoteAuthority: bestWindowOrFolder.remoteAuthority });
				}

				// Window is single folder
				else if (bestWindowOrFolder.openedFolderUri) {
					foldersToOpen.push({ folderUri: bestWindowOrFolder.openedFolderUri, remoteAuthority: bestWindowOrFolder.remoteAuthority });
				}

				// Window is empty
				else {

					// Do open files
					usedWindows.push(this.doOpenFilesInExistingWindow(openConfig, bestWindowOrFolder, fileInputs));

					// Reset these because we handled them
					fileInputs = undefined;
				}
			}

			// Finally, if no window or folder is found, just open the files in an empty window
			else {
				usedWindows.push(this.openInBrowserWindow({
					userEnv: openConfig.userEnv,
					cli: openConfig.cli,
					initialStartup: openConfig.initialStartup,
					fileInputs,
					forceNewWindow: true,
					remoteAuthority: fileInputs.remoteAuthority,
					forceNewTabbedWindow: openConfig.forceNewTabbedWindow
				}));

				// Reset these because we handled them
				fileInputs = undefined;
			}
		}

		// Handle workspaces to open (instructed and to restore)
		const allWorkspacesToOpen = arrays.distinct(workspacesToOpen, workspace => workspace.workspace.id); // prevent duplicates
		if (allWorkspacesToOpen.length > 0) {

			// Check for existing instances
			const windowsOnWorkspace = arrays.coalesce(allWorkspacesToOpen.map(workspaceToOpen => findWindowOnWorkspace(WindowsMainService.WINDOWS, workspaceToOpen.workspace)));
			if (windowsOnWorkspace.length > 0) {
				const windowOnWorkspace = windowsOnWorkspace[0];
				const fileInputsForWindow = (fileInputs?.remoteAuthority === windowOnWorkspace.remoteAuthority) ? fileInputs : undefined;

				// Do open files
				usedWindows.push(this.doOpenFilesInExistingWindow(openConfig, windowOnWorkspace, fileInputsForWindow));

				// Reset these because we handled them
				if (fileInputsForWindow) {
					fileInputs = undefined;
				}

				openFolderInNewWindow = true; // any other folders to open must open in new window then
			}

			// Open remaining ones
			allWorkspacesToOpen.forEach(workspaceToOpen => {
				if (windowsOnWorkspace.some(win => win.openedWorkspace && win.openedWorkspace.id === workspaceToOpen.workspace.id)) {
					return; // ignore folders that are already open
				}

				const remoteAuthority = workspaceToOpen.remoteAuthority;
				const fileInputsForWindow = (fileInputs?.remoteAuthority === remoteAuthority) ? fileInputs : undefined;

				// Do open folder
				usedWindows.push(this.doOpenFolderOrWorkspace(openConfig, workspaceToOpen, openFolderInNewWindow, fileInputsForWindow));

				// Reset these because we handled them
				if (fileInputsForWindow) {
					fileInputs = undefined;
				}

				openFolderInNewWindow = true; // any other folders to open must open in new window then
			});
		}

		// Handle folders to open (instructed and to restore)
		const allFoldersToOpen = arrays.distinct(foldersToOpen, folder => getComparisonKey(folder.folderUri)); // prevent duplicates
		if (allFoldersToOpen.length > 0) {

			// Check for existing instances
			const windowsOnFolderPath = arrays.coalesce(allFoldersToOpen.map(folderToOpen => findWindowOnWorkspace(WindowsMainService.WINDOWS, folderToOpen.folderUri)));
			if (windowsOnFolderPath.length > 0) {
				const windowOnFolderPath = windowsOnFolderPath[0];
				const fileInputsForWindow = fileInputs?.remoteAuthority === windowOnFolderPath.remoteAuthority ? fileInputs : undefined;

				// Do open files
				usedWindows.push(this.doOpenFilesInExistingWindow(openConfig, windowOnFolderPath, fileInputsForWindow));

				// Reset these because we handled them
				if (fileInputsForWindow) {
					fileInputs = undefined;
				}

				openFolderInNewWindow = true; // any other folders to open must open in new window then
			}

			// Open remaining ones
			allFoldersToOpen.forEach(folderToOpen => {

				if (windowsOnFolderPath.some(win => isEqual(win.openedFolderUri, folderToOpen.folderUri))) {
					return; // ignore folders that are already open
				}

				const remoteAuthority = folderToOpen.remoteAuthority;
				const fileInputsForWindow = (fileInputs?.remoteAuthority === remoteAuthority) ? fileInputs : undefined;

				// Do open folder
				usedWindows.push(this.doOpenFolderOrWorkspace(openConfig, folderToOpen, openFolderInNewWindow, fileInputsForWindow));

				// Reset these because we handled them
				if (fileInputsForWindow) {
					fileInputs = undefined;
				}

				openFolderInNewWindow = true; // any other folders to open must open in new window then
			});
		}

		// Handle empty to restore
		const allEmptyToRestore = arrays.distinct(emptyToRestore, info => info.backupFolder); // prevent duplicates
		if (allEmptyToRestore.length > 0) {
			allEmptyToRestore.forEach(emptyWindowBackupInfo => {
				const remoteAuthority = emptyWindowBackupInfo.remoteAuthority;
				const fileInputsForWindow = (fileInputs?.remoteAuthority === remoteAuthority) ? fileInputs : undefined;

				usedWindows.push(this.openInBrowserWindow({
					userEnv: openConfig.userEnv,
					cli: openConfig.cli,
					initialStartup: openConfig.initialStartup,
					fileInputs: fileInputsForWindow,
					remoteAuthority,
					forceNewWindow: true,
					forceNewTabbedWindow: openConfig.forceNewTabbedWindow,
					emptyWindowBackupInfo
				}));

				// Reset these because we handled them
				if (fileInputsForWindow) {
					fileInputs = undefined;
				}

				openFolderInNewWindow = true; // any other folders to open must open in new window then
			});
		}

		// Handle empty to open (only if no other window opened)
		if (usedWindows.length === 0 || fileInputs) {
			if (fileInputs && !emptyToOpen) {
				emptyToOpen++;
			}

			const remoteAuthority = fileInputs ? fileInputs.remoteAuthority : (openConfig.cli && openConfig.cli.remote || undefined);

			for (let i = 0; i < emptyToOpen; i++) {
				usedWindows.push(this.openInBrowserWindow({
					userEnv: openConfig.userEnv,
					cli: openConfig.cli,
					initialStartup: openConfig.initialStartup,
					remoteAuthority,
					forceNewWindow: openFolderInNewWindow,
					forceNewTabbedWindow: openConfig.forceNewTabbedWindow,
					fileInputs
				}));

				// Reset these because we handled them
				fileInputs = undefined;
				openFolderInNewWindow = true; // any other window to open must open in new window then
			}
		}

		return arrays.distinct(usedWindows);
	}

	private doOpenFilesInExistingWindow(configuration: IOpenConfiguration, window: ICodeWindow, fileInputs?: IFileInputs): ICodeWindow {
		window.focus(); // make sure window has focus

		const params: { filesToOpenOrCreate?: IPath[], filesToDiff?: IPath[], filesToWait?: IPathsToWaitFor, termProgram?: string } = {};
		if (fileInputs) {
			params.filesToOpenOrCreate = fileInputs.filesToOpenOrCreate;
			params.filesToDiff = fileInputs.filesToDiff;
			params.filesToWait = fileInputs.filesToWait;
		}

		if (configuration.userEnv) {
			params.termProgram = configuration.userEnv['TERM_PROGRAM'];
		}

		window.sendWhenReady('vscode:openFiles', params);

		return window;
	}

	private doAddFoldersToExistingWindow(window: ICodeWindow, foldersToAdd: URI[]): ICodeWindow {
		window.focus(); // make sure window has focus

		const request: IAddFoldersRequest = { foldersToAdd };

		window.sendWhenReady('vscode:addFolders', request);

		return window;
	}

	private doOpenFolderOrWorkspace(openConfig: IOpenConfiguration, folderOrWorkspace: IPathToOpen, forceNewWindow: boolean, fileInputs: IFileInputs | undefined, windowToUse?: ICodeWindow): ICodeWindow {
		if (!forceNewWindow && !windowToUse && typeof openConfig.contextWindowId === 'number') {
			windowToUse = this.getWindowById(openConfig.contextWindowId); // fix for https://github.com/Microsoft/vscode/issues/49587
		}

		const browserWindow = this.openInBrowserWindow({
			userEnv: openConfig.userEnv,
			cli: openConfig.cli,
			initialStartup: openConfig.initialStartup,
			workspace: folderOrWorkspace.workspace,
			folderUri: folderOrWorkspace.folderUri,
			fileInputs,
			remoteAuthority: folderOrWorkspace.remoteAuthority,
			forceNewWindow,
			forceNewTabbedWindow: openConfig.forceNewTabbedWindow,
			windowToUse
		});

		return browserWindow;
	}

	private getPathsToOpen(openConfig: IOpenConfiguration): IPathToOpen[] {
		let windowsToOpen: IPathToOpen[];
		let isCommandLineOrAPICall = false;

		// Extract paths: from API
		if (openConfig.urisToOpen && openConfig.urisToOpen.length > 0) {
			windowsToOpen = this.doExtractPathsFromAPI(openConfig);
			isCommandLineOrAPICall = true;
		}

		// Check for force empty
		else if (openConfig.forceEmpty) {
			windowsToOpen = [Object.create(null)];
		}

		// Extract paths: from CLI
		else if (openConfig.cli._.length || openConfig.cli['folder-uri'] || openConfig.cli['file-uri']) {
			windowsToOpen = this.doExtractPathsFromCLI(openConfig.cli);
			isCommandLineOrAPICall = true;
		}

		// Extract windows: from previous session
		else {
			windowsToOpen = this.doGetWindowsFromLastSession();
		}

		// Convert multiple folders into workspace (if opened via API or CLI)
		// This will ensure to open these folders in one window instead of multiple
		// If we are in addMode, we should not do this because in that case all
		// folders should be added to the existing window.
		if (!openConfig.addMode && isCommandLineOrAPICall) {
			const foldersToOpen = windowsToOpen.filter(path => !!path.folderUri);
			if (foldersToOpen.length > 1) {
				const remoteAuthority = foldersToOpen[0].remoteAuthority;
				if (foldersToOpen.every(f => f.remoteAuthority === remoteAuthority)) { // only if all folder have the same authority
					const workspace = this.workspacesMainService.createUntitledWorkspaceSync(foldersToOpen.map(folder => ({ uri: folder.folderUri! })));

					// Add workspace and remove folders thereby
					windowsToOpen.push({ workspace, remoteAuthority });
					windowsToOpen = windowsToOpen.filter(path => !path.folderUri);
				}
			}
		}

		return windowsToOpen;
	}

	private doExtractPathsFromAPI(openConfig: IOpenConfiguration): IPathToOpen[] {
		const pathsToOpen: IPathToOpen[] = [];
		const parseOptions: IPathParseOptions = { gotoLineMode: openConfig.gotoLineMode };
		for (const pathToOpen of openConfig.urisToOpen || []) {
			if (!pathToOpen) {
				continue;
			}

			const path = this.parseUri(pathToOpen, parseOptions);
			if (path) {
				path.label = pathToOpen.label;
				pathsToOpen.push(path);
			} else {
				const uri = this.resourceFromURIToOpen(pathToOpen);

				// Warn about the invalid URI or path
				let message, detail;
				if (uri.scheme === Schemas.file) {
					message = localize('pathNotExistTitle', "Path does not exist");
					detail = localize('pathNotExistDetail', "The path '{0}' does not seem to exist anymore on disk.", uri.fsPath);
				} else {
					message = localize('uriInvalidTitle', "URI can not be opened");
					detail = localize('uriInvalidDetail', "The URI '{0}' is not valid and can not be opened.", uri.toString());
				}
				const options: MessageBoxOptions = {
					title: product.nameLong,
					type: 'info',
					buttons: [localize('ok', "OK")],
					message,
					detail,
					noLink: true
				};

				this.dialogMainService.showMessageBox(options, withNullAsUndefined(BrowserWindow.getFocusedWindow()));
			}
		}
		return pathsToOpen;
	}

	private doExtractPathsFromCLI(cli: ParsedArgs): IPath[] {
		const pathsToOpen: IPathToOpen[] = [];
		const parseOptions: IPathParseOptions = { ignoreFileNotFound: true, gotoLineMode: cli.goto, remoteAuthority: cli.remote || undefined };

		// folder uris
		const folderUris = cli['folder-uri'];
		if (folderUris) {
			for (let f of folderUris) {
				const folderUri = this.argToUri(f);
				if (folderUri) {
					const path = this.parseUri({ folderUri }, parseOptions);
					if (path) {
						pathsToOpen.push(path);
					}
				}
			}
		}


		// file uris
		const fileUris = cli['file-uri'];
		if (fileUris) {
			for (let f of fileUris) {
				const fileUri = this.argToUri(f);
				if (fileUri) {
					const path = this.parseUri(hasWorkspaceFileExtension(f) ? { workspaceUri: fileUri } : { fileUri }, parseOptions);
					if (path) {
						pathsToOpen.push(path);
					}
				}
			}
		}

		// folder or file paths
		const cliArgs = cli._;
		for (let cliArg of cliArgs) {
			const path = this.parsePath(cliArg, parseOptions);
			if (path) {
				pathsToOpen.push(path);
			}
		}

		if (pathsToOpen.length) {
			return pathsToOpen;
		}

		// No path provided, return empty to open empty
		return [Object.create(null)];
	}

	private doGetWindowsFromLastSession(): IPathToOpen[] {
		const restoreWindows = this.getRestoreWindowsSetting();

		switch (restoreWindows) {

			// none: we always open an empty window
			case 'none':
				return [Object.create(null)];

			// one: restore last opened workspace/folder or empty window
			// all: restore all windows
			// folders: restore last opened folders only
			case 'one':
			case 'all':
			case 'folders':
				const openedWindows: IWindowState[] = [];
				if (restoreWindows !== 'one') {
					openedWindows.push(...this.windowsState.openedWindows);
				}
				if (this.windowsState.lastActiveWindow) {
					openedWindows.push(this.windowsState.lastActiveWindow);
				}

				const windowsToOpen: IPathToOpen[] = [];
				for (const openedWindow of openedWindows) {
					if (openedWindow.workspace) { // Workspaces
						const pathToOpen = this.parseUri({ workspaceUri: openedWindow.workspace.configPath }, { remoteAuthority: openedWindow.remoteAuthority });
						if (pathToOpen?.workspace) {
							windowsToOpen.push(pathToOpen);
						}
					} else if (openedWindow.folderUri) { // Folders
						const pathToOpen = this.parseUri({ folderUri: openedWindow.folderUri }, { remoteAuthority: openedWindow.remoteAuthority });
						if (pathToOpen?.folderUri) {
							windowsToOpen.push(pathToOpen);
						}
					} else if (restoreWindows !== 'folders' && openedWindow.backupPath && !openedWindow.remoteAuthority) { // Local windows that were empty. Empty windows with backups will always be restored in open()
						windowsToOpen.push({ backupPath: openedWindow.backupPath, remoteAuthority: openedWindow.remoteAuthority });
					}
				}

				if (windowsToOpen.length > 0) {
					return windowsToOpen;
				}

				break;
		}

		// Always fallback to empty window
		return [Object.create(null)];
	}

	private getRestoreWindowsSetting(): RestoreWindowsSetting {
		let restoreWindows: RestoreWindowsSetting;
		if (this.lifecycleMainService.wasRestarted) {
			restoreWindows = 'all'; // always reopen all windows when an update was applied
		} else {
			const windowConfig = this.configurationService.getValue<IWindowSettings>('window');
			restoreWindows = windowConfig?.restoreWindows || 'all'; // by default restore all windows

			if (['all', 'folders', 'one', 'none'].indexOf(restoreWindows) === -1) {
				restoreWindows = 'all'; // by default restore all windows
			}
		}

		return restoreWindows;
	}

	private argToUri(arg: string): URI | undefined {
		try {
			const uri = URI.parse(arg);
			if (!uri.scheme) {
				this.logService.error(`Invalid URI input string, scheme missing: ${arg}`);
				return undefined;
			}

			return uri;
		} catch (e) {
			this.logService.error(`Invalid URI input string: ${arg}, ${e.message}`);
		}

		return undefined;
	}

	private parseUri(toOpen: IWindowOpenable, options: IPathParseOptions = {}): IPathToOpen | undefined {
		if (!toOpen) {
			return undefined;
		}

		let uri = this.resourceFromURIToOpen(toOpen);
		if (uri.scheme === Schemas.file) {
			return this.parsePath(uri.fsPath, options, isFileToOpen(toOpen));
		}

		// open remote if either specified in the cli or if it's a remotehost URI
		const remoteAuthority = options.remoteAuthority || getRemoteAuthority(uri);

		// normalize URI
		uri = normalizePath(uri);

		// remove trailing slash
		uri = removeTrailingPathSeparator(uri);

		// File
		if (isFileToOpen(toOpen)) {
			if (options.gotoLineMode) {
				const parsedPath = parseLineAndColumnAware(uri.path);
				return {
					fileUri: uri.with({ path: parsedPath.path }),
					lineNumber: parsedPath.line,
					columnNumber: parsedPath.column,
					remoteAuthority
				};
			}

			return {
				fileUri: uri,
				remoteAuthority
			};
		}

		// Workspace
		else if (isWorkspaceToOpen(toOpen)) {
			return {
				workspace: getWorkspaceIdentifier(uri),
				remoteAuthority
			};
		}

		// Folder
		return {
			folderUri: uri,
			remoteAuthority
		};
	}

	private resourceFromURIToOpen(openable: IWindowOpenable): URI {
		if (isWorkspaceToOpen(openable)) {
			return openable.workspaceUri;
		}

		if (isFolderToOpen(openable)) {
			return openable.folderUri;
		}

		return openable.fileUri;
	}

	private parsePath(anyPath: string, options: IPathParseOptions, forceOpenWorkspaceAsFile?: boolean): IPathToOpen | undefined {
		if (!anyPath) {
			return undefined;
		}

		let lineNumber, columnNumber: number | undefined;

		if (options.gotoLineMode) {
			const parsedPath = parseLineAndColumnAware(anyPath);
			lineNumber = parsedPath.line;
			columnNumber = parsedPath.column;

			anyPath = parsedPath.path;
		}

		// open remote if either specified in the cli even if it is a local file.
		const remoteAuthority = options.remoteAuthority;

		if (remoteAuthority) {
			const first = anyPath.charCodeAt(0);
			// make absolute
			if (first !== CharCode.Slash) {
				if (isWindowsDriveLetter(first) && anyPath.charCodeAt(anyPath.charCodeAt(1)) === CharCode.Colon) {
					anyPath = toSlashes(anyPath);
				}
				anyPath = '/' + anyPath;
			}

			const uri = URI.from({ scheme: Schemas.vscodeRemote, authority: remoteAuthority, path: anyPath });

			// guess the file type: If it ends with a slash it's a folder. If it has a file extension, it's a file or a workspace. By defaults it's a folder.
			if (anyPath.charCodeAt(anyPath.length - 1) !== CharCode.Slash) {
				if (hasWorkspaceFileExtension(anyPath)) {
					if (forceOpenWorkspaceAsFile) {
						return { fileUri: uri, remoteAuthority };
					}
				} else if (posix.extname(anyPath).length > 0) {
					return { fileUri: uri, remoteAuthority };
				}
			}
			return { folderUri: uri, remoteAuthority };
		}

		let candidate = normalize(anyPath);

		try {

			const candidateStat = fs.statSync(candidate);
			if (candidateStat.isFile()) {

				// Workspace (unless disabled via flag)
				if (!forceOpenWorkspaceAsFile) {
					const workspace = this.workspacesMainService.resolveLocalWorkspaceSync(URI.file(candidate));
					if (workspace) {
						return {
							workspace: { id: workspace.id, configPath: workspace.configPath },
							remoteAuthority: workspace.remoteAuthority,
							exists: true
						};
					}
				}

				// File
				return {
					fileUri: URI.file(candidate),
					lineNumber,
					columnNumber,
					remoteAuthority,
					exists: true
				};
			}

			// Folder (we check for isDirectory() because e.g. paths like /dev/null
			// are neither file nor folder but some external tools might pass them
			// over to us)
			else if (candidateStat.isDirectory()) {
				return {
					folderUri: URI.file(candidate),
					remoteAuthority,
					exists: true
				};
			}
		} catch (error) {
			const fileUri = URI.file(candidate);
			this.workspacesHistoryMainService.removeRecentlyOpened([fileUri]); // since file does not seem to exist anymore, remove from recent

			// assume this is a file that does not yet exist
			if (options?.ignoreFileNotFound) {
				return {
					fileUri,
					remoteAuthority,
					exists: false
				};
			}
		}

		return undefined;
	}

	private shouldOpenNewWindow(openConfig: IOpenConfiguration): { openFolderInNewWindow: boolean; openFilesInNewWindow: boolean; } {

		// let the user settings override how folders are open in a new window or same window unless we are forced
		const windowConfig = this.configurationService.getValue<IWindowSettings>('window');
		const openFolderInNewWindowConfig = windowConfig?.openFoldersInNewWindow || 'default' /* default */;
		const openFilesInNewWindowConfig = windowConfig?.openFilesInNewWindow || 'off' /* default */;

		let openFolderInNewWindow = (openConfig.preferNewWindow || openConfig.forceNewWindow) && !openConfig.forceReuseWindow;
		if (!openConfig.forceNewWindow && !openConfig.forceReuseWindow && (openFolderInNewWindowConfig === 'on' || openFolderInNewWindowConfig === 'off')) {
			openFolderInNewWindow = (openFolderInNewWindowConfig === 'on');
		}

		// let the user settings override how files are open in a new window or same window unless we are forced (not for extension development though)
		let openFilesInNewWindow: boolean = false;
		if (openConfig.forceNewWindow || openConfig.forceReuseWindow) {
			openFilesInNewWindow = !!openConfig.forceNewWindow && !openConfig.forceReuseWindow;
		} else {

			// macOS: by default we open files in a new window if this is triggered via DOCK context
			if (isMacintosh) {
				if (openConfig.context === OpenContext.DOCK) {
					openFilesInNewWindow = true;
				}
			}

			// Linux/Windows: by default we open files in the new window unless triggered via DIALOG / MENU context
			// or from the integrated terminal where we assume the user prefers to open in the current window
			else {
				if (openConfig.context !== OpenContext.DIALOG && openConfig.context !== OpenContext.MENU && !(openConfig.userEnv && openConfig.userEnv['TERM_PROGRAM'] === 'vscode')) {
					openFilesInNewWindow = true;
				}
			}

			// finally check for overrides of default
			if (!openConfig.cli.extensionDevelopmentPath && (openFilesInNewWindowConfig === 'on' || openFilesInNewWindowConfig === 'off')) {
				openFilesInNewWindow = (openFilesInNewWindowConfig === 'on');
			}
		}

		return { openFolderInNewWindow: !!openFolderInNewWindow, openFilesInNewWindow };
	}

	openExtensionDevelopmentHostWindow(extensionDevelopmentPath: string[], openConfig: IOpenConfiguration): ICodeWindow[] {

		// Reload an existing extension development host window on the same path
		// We currently do not allow more than one extension development window
		// on the same extension path.
		const existingWindow = findWindowOnExtensionDevelopmentPath(WindowsMainService.WINDOWS, extensionDevelopmentPath);
		if (existingWindow) {
			this.lifecycleMainService.reload(existingWindow, openConfig.cli);
			existingWindow.focus(); // make sure it gets focus and is restored

			return [existingWindow];
		}
		let folderUris = openConfig.cli['folder-uri'] || [];
		let fileUris = openConfig.cli['file-uri'] || [];
		let cliArgs = openConfig.cli._;

		// Fill in previously opened workspace unless an explicit path is provided and we are not unit testing
		if (!cliArgs.length && !folderUris.length && !fileUris.length && !openConfig.cli.extensionTestsPath) {
			const extensionDevelopmentWindowState = this.windowsState.lastPluginDevelopmentHostWindow;
			const workspaceToOpen = extensionDevelopmentWindowState && (extensionDevelopmentWindowState.workspace || extensionDevelopmentWindowState.folderUri);
			if (workspaceToOpen) {
				if (isSingleFolderWorkspaceIdentifier(workspaceToOpen)) {
					if (workspaceToOpen.scheme === Schemas.file) {
						cliArgs = [workspaceToOpen.fsPath];
					} else {
						folderUris = [workspaceToOpen.toString()];
					}
				} else {
					if (workspaceToOpen.configPath.scheme === Schemas.file) {
						cliArgs = [originalFSPath(workspaceToOpen.configPath)];
					} else {
						fileUris = [workspaceToOpen.configPath.toString()];
					}
				}
			}
		}

		let authority = '';
		for (let p of extensionDevelopmentPath) {
			if (p.match(/^[a-zA-Z][a-zA-Z0-9\+\-\.]+:/)) {
				const url = URI.parse(p);
				if (url.scheme === Schemas.vscodeRemote) {
					if (authority) {
						if (url.authority !== authority) {
							this.logService.error('more than one extension development path authority');
						}
					} else {
						authority = url.authority;
					}
				}
			}
		}

		// Make sure that we do not try to open:
		// - a workspace or folder that is already opened
		// - a workspace or file that has a different authority as the extension development.

		cliArgs = cliArgs.filter(path => {
			const uri = URI.file(path);
			if (!!findWindowOnWorkspaceOrFolderUri(WindowsMainService.WINDOWS, uri)) {
				return false;
			}
			return uri.authority === authority;
		});

		folderUris = folderUris.filter(uri => {
			const u = this.argToUri(uri);
			if (!!findWindowOnWorkspaceOrFolderUri(WindowsMainService.WINDOWS, u)) {
				return false;
			}
			return u ? u.authority === authority : false;
		});

		fileUris = fileUris.filter(uri => {
			const u = this.argToUri(uri);
			if (!!findWindowOnWorkspaceOrFolderUri(WindowsMainService.WINDOWS, u)) {
				return false;
			}
			return u ? u.authority === authority : false;
		});

		openConfig.cli._ = cliArgs;
		openConfig.cli['folder-uri'] = folderUris;
		openConfig.cli['file-uri'] = fileUris;

		// if there are no files or folders cli args left, use the "remote" cli argument
		const noFilesOrFolders = !cliArgs.length && !folderUris.length && !fileUris.length;
		if (noFilesOrFolders && authority) {
			openConfig.cli.remote = authority;
		}

		// Open it
		const openArgs: IOpenConfiguration = {
			context: openConfig.context,
			cli: openConfig.cli,
			forceNewWindow: true,
			forceEmpty: noFilesOrFolders,
			userEnv: openConfig.userEnv,
			noRecentEntry: true,
			waitMarkerFileURI: openConfig.waitMarkerFileURI
		};

		return this.open(openArgs);
	}

	private openInBrowserWindow(options: IOpenBrowserWindowOptions): ICodeWindow {

		// Build INativeWindowConfiguration from config and options
		const configuration: INativeWindowConfiguration = mixin({}, options.cli); // inherit all properties from CLI
		configuration.appRoot = this.environmentService.appRoot;
		configuration.machineId = this.machineId;
		configuration.nodeCachedDataDir = this.environmentService.nodeCachedDataDir;
		configuration.mainPid = process.pid;
		configuration.execPath = process.execPath;
		configuration.userEnv = { ...this.initialUserEnv, ...options.userEnv };
		configuration.isInitialStartup = options.initialStartup;
		configuration.workspace = options.workspace;
		configuration.folderUri = options.folderUri;
		configuration.remoteAuthority = options.remoteAuthority;

		const fileInputs = options.fileInputs;
		if (fileInputs) {
			configuration.filesToOpenOrCreate = fileInputs.filesToOpenOrCreate;
			configuration.filesToDiff = fileInputs.filesToDiff;
			configuration.filesToWait = fileInputs.filesToWait;
		}

		// if we know the backup folder upfront (for empty windows to restore), we can set it
		// directly here which helps for restoring UI state associated with that window.
		// For all other cases we first call into registerEmptyWindowBackupSync() to set it before
		// loading the window.
		if (options.emptyWindowBackupInfo) {
			configuration.backupPath = join(this.environmentService.backupHome.fsPath, options.emptyWindowBackupInfo.backupFolder);
		}

		let window: ICodeWindow | undefined;
		if (!options.forceNewWindow && !options.forceNewTabbedWindow) {
			window = options.windowToUse || this.getLastActiveWindow();
			if (window) {
				window.focus();
			}
		}

		// New window
		if (!window) {
			const windowConfig = this.configurationService.getValue<IWindowSettings>('window');
			const state = this.getNewWindowState(configuration);

			// Window state is not from a previous session: only allow fullscreen if we inherit it or user wants fullscreen
			let allowFullscreen: boolean;
			if (state.hasDefaultState) {
				allowFullscreen = (windowConfig?.newWindowDimensions && ['fullscreen', 'inherit', 'offset'].indexOf(windowConfig.newWindowDimensions) >= 0);
			}

			// Window state is from a previous session: only allow fullscreen when we got updated or user wants to restore
			else {
				allowFullscreen = this.lifecycleMainService.wasRestarted || windowConfig?.restoreFullscreen;

				if (allowFullscreen && isMacintosh && WindowsMainService.WINDOWS.some(win => win.isFullScreen)) {
					// macOS: Electron does not allow to restore multiple windows in
					// fullscreen. As such, if we already restored a window in that
					// state, we cannot allow more fullscreen windows. See
					// https://github.com/microsoft/vscode/issues/41691 and
					// https://github.com/electron/electron/issues/13077
					allowFullscreen = false;
				}
			}

			if (state.mode === WindowMode.Fullscreen && !allowFullscreen) {
				state.mode = WindowMode.Normal;
			}

			// Create the window
			const createdWindow = window = this.instantiationService.createInstance(CodeWindow, {
				state,
				extensionDevelopmentPath: configuration.extensionDevelopmentPath,
				isExtensionTestHost: !!configuration.extensionTestsPath
			});

			// Add as window tab if configured (macOS only)
			if (options.forceNewTabbedWindow) {
				const activeWindow = this.getLastActiveWindow();
				if (activeWindow) {
					activeWindow.addTabbedWindow(window);
				}
			}

			// Add to our list of windows
			WindowsMainService.WINDOWS.push(window);

			// Indicate number change via event
			this._onWindowsCountChanged.fire({ oldCount: WindowsMainService.WINDOWS.length - 1, newCount: WindowsMainService.WINDOWS.length });

			// Window Events
			once(window.onClose)(() => this.onWindowClosed(createdWindow));
			once(window.onDestroy)(() => this.onBeforeWindowClose(createdWindow)); // try to save state before destroy because close will not fire
			window.win.webContents.removeAllListeners('devtools-reload-page'); // remove built in listener so we can handle this on our own
			window.win.webContents.on('devtools-reload-page', () => this.lifecycleMainService.reload(createdWindow));

			// Lifecycle
			(this.lifecycleMainService as LifecycleMainService).registerWindow(window);
		}

		// Existing window
		else {

			// Some configuration things get inherited if the window is being reused and we are
			// in extension development host mode. These options are all development related.
			const currentWindowConfig = window.config;
			if (!configuration.extensionDevelopmentPath && currentWindowConfig && !!currentWindowConfig.extensionDevelopmentPath) {
				configuration.extensionDevelopmentPath = currentWindowConfig.extensionDevelopmentPath;
				configuration.verbose = currentWindowConfig.verbose;
				configuration['inspect-brk-extensions'] = currentWindowConfig['inspect-brk-extensions'];
				configuration.debugId = currentWindowConfig.debugId;
				configuration['inspect-extensions'] = currentWindowConfig['inspect-extensions'];
				configuration['extensions-dir'] = currentWindowConfig['extensions-dir'];
			}
		}

		// If the window was already loaded, make sure to unload it
		// first and only load the new configuration if that was
		// not vetoed
		if (window.isReady) {
			this.lifecycleMainService.unload(window, UnloadReason.LOAD).then(veto => {
				if (!veto) {
					this.doOpenInBrowserWindow(window!, configuration, options);
				}
			});
		} else {
			this.doOpenInBrowserWindow(window, configuration, options);
		}

		return window;
	}

	private doOpenInBrowserWindow(window: ICodeWindow, configuration: INativeWindowConfiguration, options: IOpenBrowserWindowOptions): void {

		// Register window for backups
		if (!configuration.extensionDevelopmentPath) {
			if (configuration.workspace) {
				configuration.backupPath = this.backupMainService.registerWorkspaceBackupSync({ workspace: configuration.workspace, remoteAuthority: configuration.remoteAuthority });
			} else if (configuration.folderUri) {
				configuration.backupPath = this.backupMainService.registerFolderBackupSync(configuration.folderUri);
			} else {
				const backupFolder = options.emptyWindowBackupInfo && options.emptyWindowBackupInfo.backupFolder;
				configuration.backupPath = this.backupMainService.registerEmptyWindowBackupSync(backupFolder, configuration.remoteAuthority);
			}
		}

		// Load it
		window.load(configuration);
	}

	private getNewWindowState(configuration: INativeWindowConfiguration): INewWindowState {
		const lastActive = this.getLastActiveWindow();

		// Restore state unless we are running extension tests
		if (!configuration.extensionTestsPath) {

			// extension development host Window - load from stored settings if any
			if (!!configuration.extensionDevelopmentPath && this.windowsState.lastPluginDevelopmentHostWindow) {
				return this.windowsState.lastPluginDevelopmentHostWindow.uiState;
			}

			// Known Workspace - load from stored settings
			const workspace = configuration.workspace;
			if (workspace) {
				const stateForWorkspace = this.windowsState.openedWindows.filter(o => o.workspace && o.workspace.id === workspace.id).map(o => o.uiState);
				if (stateForWorkspace.length) {
					return stateForWorkspace[0];
				}
			}

			// Known Folder - load from stored settings
			if (configuration.folderUri) {
				const stateForFolder = this.windowsState.openedWindows.filter(o => o.folderUri && isEqual(o.folderUri, configuration.folderUri)).map(o => o.uiState);
				if (stateForFolder.length) {
					return stateForFolder[0];
				}
			}

			// Empty windows with backups
			else if (configuration.backupPath) {
				const stateForEmptyWindow = this.windowsState.openedWindows.filter(o => o.backupPath === configuration.backupPath).map(o => o.uiState);
				if (stateForEmptyWindow.length) {
					return stateForEmptyWindow[0];
				}
			}

			// First Window
			const lastActiveState = this.lastClosedWindowState || this.windowsState.lastActiveWindow;
			if (!lastActive && lastActiveState) {
				return lastActiveState.uiState;
			}
		}

		//
		// In any other case, we do not have any stored settings for the window state, so we come up with something smart
		//

		// We want the new window to open on the same display that the last active one is in
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
			if (!displayToUse && lastActive) {
				displayToUse = screen.getDisplayMatching(lastActive.getBounds());
			}

			// fallback to primary display or first display
			if (!displayToUse) {
				displayToUse = screen.getPrimaryDisplay() || displays[0];
			}
		}

		// Compute x/y based on display bounds
		// Note: important to use Math.round() because Electron does not seem to be too happy about
		// display coordinates that are not absolute numbers.
		let state = defaultWindowState();
		state.x = Math.round(displayToUse.bounds.x + (displayToUse.bounds.width / 2) - (state.width! / 2));
		state.y = Math.round(displayToUse.bounds.y + (displayToUse.bounds.height / 2) - (state.height! / 2));

		// Check for newWindowDimensions setting and adjust accordingly
		const windowConfig = this.configurationService.getValue<IWindowSettings>('window');
		let ensureNoOverlap = true;
		if (windowConfig?.newWindowDimensions) {
			if (windowConfig.newWindowDimensions === 'maximized') {
				state.mode = WindowMode.Maximized;
				ensureNoOverlap = false;
			} else if (windowConfig.newWindowDimensions === 'fullscreen') {
				state.mode = WindowMode.Fullscreen;
				ensureNoOverlap = false;
			} else if ((windowConfig.newWindowDimensions === 'inherit' || windowConfig.newWindowDimensions === 'offset') && lastActive) {
				const lastActiveState = lastActive.serializeWindowState();
				if (lastActiveState.mode === WindowMode.Fullscreen) {
					state.mode = WindowMode.Fullscreen; // only take mode (fixes https://github.com/Microsoft/vscode/issues/19331)
				} else {
					state = lastActiveState;
				}

				ensureNoOverlap = state.mode !== WindowMode.Fullscreen && windowConfig.newWindowDimensions === 'offset';
			}
		}

		if (ensureNoOverlap) {
			state = this.ensureNoOverlap(state);
		}

		(state as INewWindowState).hasDefaultState = true; // flag as default state

		return state;
	}

	private ensureNoOverlap(state: ISingleWindowState): ISingleWindowState {
		if (WindowsMainService.WINDOWS.length === 0) {
			return state;
		}

		state.x = typeof state.x === 'number' ? state.x : 0;
		state.y = typeof state.y === 'number' ? state.y : 0;

		const existingWindowBounds = WindowsMainService.WINDOWS.map(win => win.getBounds());
		while (existingWindowBounds.some(b => b.x === state.x || b.y === state.y)) {
			state.x += 30;
			state.y += 30;
		}

		return state;
	}

	focusLastActive(cli: ParsedArgs, context: OpenContext): ICodeWindow {
		const lastActive = this.getLastActiveWindow();
		if (lastActive) {
			lastActive.focus();

			return lastActive;
		}

		// No window - open new empty one
		return this.open({ context, cli, forceEmpty: true })[0];
	}

	getLastActiveWindow(): ICodeWindow | undefined {
		return getLastActiveWindow(WindowsMainService.WINDOWS);
	}

	private getLastActiveWindowForAuthority(remoteAuthority: string | undefined): ICodeWindow | undefined {
		return getLastActiveWindow(WindowsMainService.WINDOWS.filter(window => window.remoteAuthority === remoteAuthority));
	}

	sendToFocused(channel: string, ...args: any[]): void {
		const focusedWindow = this.getFocusedWindow() || this.getLastActiveWindow();

		if (focusedWindow) {
			focusedWindow.sendWhenReady(channel, ...args);
		}
	}

	sendToAll(channel: string, payload?: any, windowIdsToIgnore?: number[]): void {
		for (const window of WindowsMainService.WINDOWS) {
			if (windowIdsToIgnore && windowIdsToIgnore.indexOf(window.id) >= 0) {
				continue; // do not send if we are instructed to ignore it
			}

			window.sendWhenReady(channel, payload);
		}
	}

	private getFocusedWindow(): ICodeWindow | undefined {
		const win = BrowserWindow.getFocusedWindow();
		if (win) {
			return this.getWindowById(win.id);
		}

		return undefined;
	}

	getWindowById(windowId: number): ICodeWindow | undefined {
		const res = WindowsMainService.WINDOWS.filter(window => window.id === windowId);

		return arrays.firstOrDefault(res);
	}

	getWindows(): ICodeWindow[] {
		return WindowsMainService.WINDOWS;
	}

	getWindowCount(): number {
		return WindowsMainService.WINDOWS.length;
	}

	private onWindowClosed(win: ICodeWindow): void {

		// Remove from our list so that Electron can clean it up
		const index = WindowsMainService.WINDOWS.indexOf(win);
		WindowsMainService.WINDOWS.splice(index, 1);

		// Emit
		this._onWindowsCountChanged.fire({ oldCount: WindowsMainService.WINDOWS.length + 1, newCount: WindowsMainService.WINDOWS.length });
		this._onWindowClose.fire(win.id);
	}
}
