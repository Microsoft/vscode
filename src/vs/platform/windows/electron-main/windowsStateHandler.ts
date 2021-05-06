/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { app, Display, screen } from 'electron';
import { Disposable } from 'vs/base/common/lifecycle';
import { isMacintosh } from 'vs/base/common/platform';
import { extUriBiasedIgnorePathCase } from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILifecycleMainService } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { ILogService } from 'vs/platform/log/common/log';
import { IStateMainService } from 'vs/platform/state/electron-main/state';
import { INativeWindowConfiguration, IWindowSettings } from 'vs/platform/windows/common/windows';
import { defaultWindowState, ICodeWindow, IWindowsMainService, IWindowState as IWindowUIState, WindowMode } from 'vs/platform/windows/electron-main/windows';
import { isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier, IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';

export interface IWindowState {
	workspace?: IWorkspaceIdentifier;
	folderUri?: URI;
	backupPath?: string;
	remoteAuthority?: string;
	uiState: IWindowUIState;
}

export interface IWindowsState {
	lastActiveWindow?: IWindowState;
	lastPluginDevelopmentHostWindow?: IWindowState;
	openedWindows: IWindowState[];
}

interface INewWindowState extends IWindowUIState {
	hasDefaultState?: boolean;
}

interface ISerializedWindowsState {
	readonly lastActiveWindow?: ISerializedWindowState;
	readonly lastPluginDevelopmentHostWindow?: ISerializedWindowState;
	readonly openedWindows: ISerializedWindowState[];
}

interface ISerializedWindowState {
	readonly workspaceIdentifier?: { id: string; configURIPath: string };
	readonly folder?: string;
	readonly backupPath?: string;
	readonly remoteAuthority?: string;
	readonly uiState: IWindowUIState;
}

export class WindowsStateHandler extends Disposable {

	private static readonly windowsStateStorageKey = 'windowsState';

	get state() { return this._state; }
	private readonly _state = restoreWindowsState(this.stateMainService.getItem<ISerializedWindowsState>(WindowsStateHandler.windowsStateStorageKey));

	private lastClosedState: IWindowState | undefined = undefined;

	private shuttingDown = false;

	constructor(
		@IWindowsMainService private readonly windowsMainService: IWindowsMainService,
		@IStateMainService private readonly stateMainService: IStateMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@ILogService private readonly logService: ILogService,
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		super();

		this.registerListeners();
	}

	private registerListeners(): void {

		// When a window looses focus, save all windows state. This allows to
		// prevent loss of window-state data when OS is restarted without properly
		// shutting down the application (https://github.com/microsoft/vscode/issues/87171)
		app.on('browser-window-blur', () => {
			if (!this.shuttingDown) {
				this.saveWindowsState();
			}
		});

		// Handle various lifecycle events around windows
		this.lifecycleMainService.onBeforeCloseWindow(window => this.onBeforeCloseWindow(window));
		this.lifecycleMainService.onBeforeShutdown(() => this.onBeforeShutdown());
		this.windowsMainService.onDidChangeWindowsCount(e => {
			if (e.newCount - e.oldCount > 0) {
				// clear last closed window state when a new window opens. this helps on macOS where
				// otherwise closing the last window, opening a new window and then quitting would
				// use the state of the previously closed window when restarting.
				this.lastClosedState = undefined;
			}
		});

		// try to save state before destroy because close will not fire
		this.windowsMainService.onDidDestroyWindow(window => this.onBeforeCloseWindow(window));
	}

	// Note that onBeforeShutdown() and onBeforeCloseWindow() are fired in different order depending on the OS:
	// - macOS: since the app will not quit when closing the last window, you will always first get
	//          the onBeforeShutdown() event followed by N onBeforeCloseWindow() events for each window
	// - other: on other OS, closing the last window will quit the app so the order depends on the
	//          user interaction: closing the last window will first trigger onBeforeCloseWindow()
	//          and then onBeforeShutdown(). Using the quit action however will first issue onBeforeShutdown()
	//          and then onBeforeCloseWindow().
	//
	// Here is the behavior on different OS depending on action taken (Electron 1.7.x):
	//
	// Legend
	// -  quit(N): quit application with N windows opened
	// - close(1): close one window via the window close button
	// - closeAll: close all windows via the taskbar command
	// - onBeforeShutdown(N): number of windows reported in this event handler
	// - onBeforeCloseWindow(N, M): number of windows reported and quitRequested boolean in this event handler
	//
	// macOS
	// 	-     quit(1): onBeforeShutdown(1), onBeforeCloseWindow(1, true)
	// 	-     quit(2): onBeforeShutdown(2), onBeforeCloseWindow(2, true), onBeforeCloseWindow(2, true)
	// 	-     quit(0): onBeforeShutdown(0)
	// 	-    close(1): onBeforeCloseWindow(1, false)
	//
	// Windows
	// 	-     quit(1): onBeforeShutdown(1), onBeforeCloseWindow(1, true)
	// 	-     quit(2): onBeforeShutdown(2), onBeforeCloseWindow(2, true), onBeforeCloseWindow(2, true)
	// 	-    close(1): onBeforeCloseWindow(2, false)[not last window]
	// 	-    close(1): onBeforeCloseWindow(1, false), onBeforeShutdown(0)[last window]
	// 	- closeAll(2): onBeforeCloseWindow(2, false), onBeforeCloseWindow(2, false), onBeforeShutdown(0)
	//
	// Linux
	// 	-     quit(1): onBeforeShutdown(1), onBeforeCloseWindow(1, true)
	// 	-     quit(2): onBeforeShutdown(2), onBeforeCloseWindow(2, true), onBeforeCloseWindow(2, true)
	// 	-    close(1): onBeforeCloseWindow(2, false)[not last window]
	// 	-    close(1): onBeforeCloseWindow(1, false), onBeforeShutdown(0)[last window]
	// 	- closeAll(2): onBeforeCloseWindow(2, false), onBeforeCloseWindow(2, false), onBeforeShutdown(0)
	//
	private onBeforeShutdown(): void {
		this.shuttingDown = true;

		this.saveWindowsState();
	}

	private saveWindowsState(): void {
		const currentWindowsState: IWindowsState = {
			openedWindows: [],
			lastPluginDevelopmentHostWindow: this._state.lastPluginDevelopmentHostWindow,
			lastActiveWindow: this.lastClosedState
		};

		// 1.) Find a last active window (pick any other first window otherwise)
		if (!currentWindowsState.lastActiveWindow) {
			let activeWindow = this.windowsMainService.getLastActiveWindow();
			if (!activeWindow || activeWindow.isExtensionDevelopmentHost) {
				activeWindow = this.windowsMainService.getWindows().find(window => !window.isExtensionDevelopmentHost);
			}

			if (activeWindow) {
				currentWindowsState.lastActiveWindow = this.toWindowState(activeWindow);
			}
		}

		// 2.) Find extension host window
		const extensionHostWindow = this.windowsMainService.getWindows().find(window => window.isExtensionDevelopmentHost && !window.isExtensionTestHost);
		if (extensionHostWindow) {
			currentWindowsState.lastPluginDevelopmentHostWindow = this.toWindowState(extensionHostWindow);
		}

		// 3.) All windows (except extension host) for N >= 2 to support `restoreWindows: all` or for auto update
		//
		// Careful here: asking a window for its window state after it has been closed returns bogus values (width: 0, height: 0)
		// so if we ever want to persist the UI state of the last closed window (window count === 1), it has
		// to come from the stored lastClosedWindowState on Win/Linux at least
		if (this.windowsMainService.getWindowCount() > 1) {
			currentWindowsState.openedWindows = this.windowsMainService.getWindows().filter(window => !window.isExtensionDevelopmentHost).map(window => this.toWindowState(window));
		}

		// Persist
		const state = getWindowsStateStoreData(currentWindowsState);
		this.stateMainService.setItem(WindowsStateHandler.windowsStateStorageKey, state);

		if (this.shuttingDown) {
			this.logService.trace('[WindowsStateHandler] onBeforeShutdown', state);
		}
	}

	// See note on #onBeforeShutdown() for details how these events are flowing
	private onBeforeCloseWindow(window: ICodeWindow): void {
		if (this.lifecycleMainService.quitRequested) {
			return; // during quit, many windows close in parallel so let it be handled in the before-quit handler
		}

		// On Window close, update our stored UI state of this window
		const state: IWindowState = this.toWindowState(window);
		if (window.isExtensionDevelopmentHost && !window.isExtensionTestHost) {
			this._state.lastPluginDevelopmentHostWindow = state; // do not let test run window state overwrite our extension development state
		}

		// Any non extension host window with same workspace or folder
		else if (!window.isExtensionDevelopmentHost && window.openedWorkspace) {
			this._state.openedWindows.forEach(openedWindow => {
				const sameWorkspace = isWorkspaceIdentifier(window.openedWorkspace) && openedWindow.workspace?.id === window.openedWorkspace.id;
				const sameFolder = isSingleFolderWorkspaceIdentifier(window.openedWorkspace) && openedWindow.folderUri && extUriBiasedIgnorePathCase.isEqual(openedWindow.folderUri, window.openedWorkspace.uri);

				if (sameWorkspace || sameFolder) {
					openedWindow.uiState = state.uiState;
				}
			});
		}

		// On Windows and Linux closing the last window will trigger quit. Since we are storing all UI state
		// before quitting, we need to remember the UI state of this window to be able to persist it.
		// On macOS we keep the last closed window state ready in case the user wants to quit right after or
		// wants to open another window, in which case we use this state over the persisted one.
		if (this.windowsMainService.getWindowCount() === 1) {
			this.lastClosedState = state;
		}
	}

	private toWindowState(window: ICodeWindow): IWindowState {
		return {
			workspace: isWorkspaceIdentifier(window.openedWorkspace) ? window.openedWorkspace : undefined,
			folderUri: isSingleFolderWorkspaceIdentifier(window.openedWorkspace) ? window.openedWorkspace.uri : undefined,
			backupPath: window.backupPath,
			remoteAuthority: window.remoteAuthority,
			uiState: window.serializeWindowState()
		};
	}

	getNewWindowState(configuration: INativeWindowConfiguration): INewWindowState {
		const state = this.doGetNewWindowState(configuration);
		const windowConfig = this.configurationService.getValue<IWindowSettings | undefined>('window');

		// Window state is not from a previous session: only allow fullscreen if we inherit it or user wants fullscreen
		let allowFullscreen: boolean;
		if (state.hasDefaultState) {
			allowFullscreen = !!(windowConfig?.newWindowDimensions && ['fullscreen', 'inherit', 'offset'].indexOf(windowConfig.newWindowDimensions) >= 0);
		}

		// Window state is from a previous session: only allow fullscreen when we got updated or user wants to restore
		else {
			allowFullscreen = !!(this.lifecycleMainService.wasRestarted || windowConfig?.restoreFullscreen);

			if (allowFullscreen && isMacintosh && this.windowsMainService.getWindows().some(window => window.isFullScreen)) {
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

		return state;
	}

	private doGetNewWindowState(configuration: INativeWindowConfiguration): INewWindowState {
		const lastActive = this.windowsMainService.getLastActiveWindow();

		// Restore state unless we are running extension tests
		if (!configuration.extensionTestsPath) {

			// extension development host Window - load from stored settings if any
			if (!!configuration.extensionDevelopmentPath && this.state.lastPluginDevelopmentHostWindow) {
				return this.state.lastPluginDevelopmentHostWindow.uiState;
			}

			// Known Workspace - load from stored settings
			const workspace = configuration.workspace;
			if (isWorkspaceIdentifier(workspace)) {
				const stateForWorkspace = this.state.openedWindows.filter(openedWindow => openedWindow.workspace && openedWindow.workspace.id === workspace.id).map(openedWindow => openedWindow.uiState);
				if (stateForWorkspace.length) {
					return stateForWorkspace[0];
				}
			}

			// Known Folder - load from stored settings
			if (isSingleFolderWorkspaceIdentifier(workspace)) {
				const stateForFolder = this.state.openedWindows.filter(openedWindow => openedWindow.folderUri && extUriBiasedIgnorePathCase.isEqual(openedWindow.folderUri, workspace.uri)).map(openedWindow => openedWindow.uiState);
				if (stateForFolder.length) {
					return stateForFolder[0];
				}
			}

			// Empty windows with backups
			else if (configuration.backupPath) {
				const stateForEmptyWindow = this.state.openedWindows.filter(openedWindow => openedWindow.backupPath === configuration.backupPath).map(openedWindow => openedWindow.uiState);
				if (stateForEmptyWindow.length) {
					return stateForEmptyWindow[0];
				}
			}

			// First Window
			const lastActiveState = this.lastClosedState || this.state.lastActiveWindow;
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
		const windowConfig = this.configurationService.getValue<IWindowSettings | undefined>('window');
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
					state.mode = WindowMode.Fullscreen; // only take mode (fixes https://github.com/microsoft/vscode/issues/19331)
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

	private ensureNoOverlap(state: IWindowUIState): IWindowUIState {
		if (this.windowsMainService.getWindows().length === 0) {
			return state;
		}

		state.x = typeof state.x === 'number' ? state.x : 0;
		state.y = typeof state.y === 'number' ? state.y : 0;

		const existingWindowBounds = this.windowsMainService.getWindows().map(window => window.getBounds());
		while (existingWindowBounds.some(bounds => bounds.x === state.x || bounds.y === state.y)) {
			state.x += 30;
			state.y += 30;
		}

		return state;
	}
}

export function restoreWindowsState(data: ISerializedWindowsState | undefined): IWindowsState {
	const result: IWindowsState = { openedWindows: [] };
	const windowsState = data || { openedWindows: [] };

	if (windowsState.lastActiveWindow) {
		result.lastActiveWindow = restoreWindowState(windowsState.lastActiveWindow);
	}

	if (windowsState.lastPluginDevelopmentHostWindow) {
		result.lastPluginDevelopmentHostWindow = restoreWindowState(windowsState.lastPluginDevelopmentHostWindow);
	}

	if (Array.isArray(windowsState.openedWindows)) {
		result.openedWindows = windowsState.openedWindows.map(windowState => restoreWindowState(windowState));
	}

	return result;
}

function restoreWindowState(windowState: ISerializedWindowState): IWindowState {
	const result: IWindowState = { uiState: windowState.uiState };
	if (windowState.backupPath) {
		result.backupPath = windowState.backupPath;
	}

	if (windowState.remoteAuthority) {
		result.remoteAuthority = windowState.remoteAuthority;
	}

	if (windowState.folder) {
		result.folderUri = URI.parse(windowState.folder);
	}

	if (windowState.workspaceIdentifier) {
		result.workspace = { id: windowState.workspaceIdentifier.id, configPath: URI.parse(windowState.workspaceIdentifier.configURIPath) };
	}

	return result;
}

export function getWindowsStateStoreData(windowsState: IWindowsState): IWindowsState {
	return {
		lastActiveWindow: windowsState.lastActiveWindow && serializeWindowState(windowsState.lastActiveWindow),
		lastPluginDevelopmentHostWindow: windowsState.lastPluginDevelopmentHostWindow && serializeWindowState(windowsState.lastPluginDevelopmentHostWindow),
		openedWindows: windowsState.openedWindows.map(ws => serializeWindowState(ws))
	};
}

function serializeWindowState(windowState: IWindowState): ISerializedWindowState {
	return {
		workspaceIdentifier: windowState.workspace && { id: windowState.workspace.id, configURIPath: windowState.workspace.configPath.toString() },
		folder: windowState.folderUri && windowState.folderUri.toString(),
		backupPath: windowState.backupPath,
		remoteAuthority: windowState.remoteAuthority,
		uiState: windowState.uiState
	};
}
