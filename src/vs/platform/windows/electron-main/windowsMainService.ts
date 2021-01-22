/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { statSync, unlink } from 'fs';
import { basename, normalize, join, posix } from 'vs/base/common/path';
import { localize } from 'vs/nls';
import { coalesce, distinct, firstOrDefault } from 'vs/base/common/arrays';
import { IBackupMainService } from 'vs/platform/backup/electron-main/backup';
import { IEmptyWindowBackupInfo } from 'vs/platform/backup/node/backup';
import { IEnvironmentMainService } from 'vs/platform/environment/electron-main/environmentMainService';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { IStateService } from 'vs/platform/state/node/state';
import { CodeWindow } from 'vs/code/electron-main/window';
import { BrowserWindow, MessageBoxOptions, WebContents } from 'electron';
import { ILifecycleMainService, UnloadReason, LifecycleMainService, LifecycleMainPhase } from 'vs/platform/lifecycle/electron-main/lifecycleMainService';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ILogService } from 'vs/platform/log/common/log';
import { IWindowSettings, IPath, isFileToOpen, isWorkspaceToOpen, isFolderToOpen, IWindowOpenable, IOpenEmptyWindowOptions, IAddFoldersRequest, IPathsToWaitFor, INativeWindowConfiguration, INativeOpenFileRequest } from 'vs/platform/windows/common/windows';
import { findWindowOnFile, findWindowOnWorkspaceOrFolder, findWindowOnExtensionDevelopmentPath } from 'vs/platform/windows/electron-main/windowsFinder';
import { Emitter } from 'vs/base/common/event';
import product from 'vs/platform/product/common/product';
import { IWindowsMainService, IOpenConfiguration, IWindowsCountChangedEvent, ICodeWindow, IOpenEmptyConfiguration, OpenContext } from 'vs/platform/windows/electron-main/windows';
import { IWorkspacesHistoryMainService } from 'vs/platform/workspaces/electron-main/workspacesHistoryMainService';
import { IProcessEnvironment, isMacintosh } from 'vs/base/common/platform';
import { IWorkspaceIdentifier, isSingleFolderWorkspaceIdentifier, hasWorkspaceFileExtension, IRecent } from 'vs/platform/workspaces/common/workspaces';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { normalizePath, originalFSPath, removeTrailingPathSeparator, extUriBiasedIgnorePathCase } from 'vs/base/common/resources';
import { getRemoteAuthority } from 'vs/platform/remote/common/remoteHosts';
import { IWindowState, WindowsStateHandler } from 'vs/platform/windows/electron-main/windowsStateHandler';
import { getWorkspaceIdentifier, IWorkspacesMainService } from 'vs/platform/workspaces/electron-main/workspacesMainService';
import { once } from 'vs/base/common/functional';
import { Disposable } from 'vs/base/common/lifecycle';
import { IDialogMainService } from 'vs/platform/dialogs/electron-main/dialogMainService';
import { withNullAsUndefined } from 'vs/base/common/types';
import { isWindowsDriveLetter, toSlashes, parseLineAndColumnAware } from 'vs/base/common/extpath';
import { CharCode } from 'vs/base/common/charCode';
import { getPathLabel } from 'vs/base/common/labels';
import { CancellationToken } from 'vs/base/common/cancellation';

//#region Helper Interfaces

type RestoreWindowsSetting = 'preserve' | 'all' | 'folders' | 'one' | 'none';

interface IOpenBrowserWindowOptions {
	readonly userEnv?: IProcessEnvironment;
	readonly cli?: NativeParsedArgs;

	readonly workspace?: IWorkspaceIdentifier;
	readonly folderUri?: URI;

	readonly remoteAuthority?: string;

	readonly initialStartup?: boolean;

	readonly filesToOpen?: IFilesToOpen;

	readonly forceNewWindow?: boolean;
	readonly forceNewTabbedWindow?: boolean;
	readonly windowToUse?: ICodeWindow;

	readonly emptyWindowBackupInfo?: IEmptyWindowBackupInfo;
}

interface IPathParseOptions {
	readonly ignoreFileNotFound?: boolean;
	readonly gotoLineMode?: boolean;
	readonly remoteAuthority?: string;
}

interface IFilesToOpen {
	readonly remoteAuthority?: string;

	filesToOpenOrCreate: IPath[];
	filesToDiff: IPath[];
	filesToWait?: IPathsToWaitFor;
}

interface IPathToOpen extends IPath {

	// the workspace for a Code instance to open
	readonly workspace?: IWorkspaceIdentifier;

	// the folder path for a Code instance to open
	readonly folderUri?: URI;

	// the backup path for a Code instance to use
	readonly backupPath?: string;

	// the remote authority for the Code instance to open. Undefined if not remote.
	readonly remoteAuthority?: string;

	// optional label for the recent history
	label?: string;
}

function isFolderPathToOpen(path: IPathToOpen): path is IFolderPathToOpen {
	return !!path.folderUri;
}

interface IFolderPathToOpen {

	// the folder path for a Code instance to open
	readonly folderUri: URI;

	// the backup path for a Code instance to use
	readonly backupPath?: string;

	// the remote authority for the Code instance to open. Undefined if not remote.
	readonly remoteAuthority?: string;

	// optional label for the recent history
	readonly label?: string;
}

function isWorkspacePathToOpen(path: IPathToOpen): path is IWorkspacePathToOpen {
	return !!path.workspace;
}

interface IWorkspacePathToOpen {

	// the workspace for a Code instance to open
	readonly workspace: IWorkspaceIdentifier;

	// the backup path for a Code instance to use
	readonly backupPath?: string;

	// the remote authority for the Code instance to open. Undefined if not remote.
	readonly remoteAuthority?: string;

	// optional label for the recent history
	readonly label?: string;
}

//#endregion

export class WindowsMainService extends Disposable implements IWindowsMainService {

	declare readonly _serviceBrand: undefined;

	private static readonly WINDOWS: ICodeWindow[] = [];

	private readonly _onWindowOpened = this._register(new Emitter<ICodeWindow>());
	readonly onWindowOpened = this._onWindowOpened.event;

	private readonly _onWindowReady = this._register(new Emitter<ICodeWindow>());
	readonly onWindowReady = this._onWindowReady.event;

	private readonly _onWindowDestroyed = this._register(new Emitter<ICodeWindow>());
	readonly onWindowDestroyed = this._onWindowDestroyed.event;

	private readonly _onWindowsCountChanged = this._register(new Emitter<IWindowsCountChangedEvent>());
	readonly onWindowsCountChanged = this._onWindowsCountChanged.event;

	private readonly windowsStateHandler = this._register(new WindowsStateHandler(this, this.stateService, this.lifecycleMainService, this.logService, this.configurationService));

	constructor(
		private readonly machineId: string,
		private readonly initialUserEnv: IProcessEnvironment,
		@ILogService private readonly logService: ILogService,
		@IStateService private readonly stateService: IStateService,
		@IEnvironmentMainService private readonly environmentService: IEnvironmentMainService,
		@ILifecycleMainService private readonly lifecycleMainService: ILifecycleMainService,
		@IBackupMainService private readonly backupMainService: IBackupMainService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IWorkspacesHistoryMainService private readonly workspacesHistoryMainService: IWorkspacesHistoryMainService,
		@IWorkspacesMainService private readonly workspacesMainService: IWorkspacesMainService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IDialogMainService private readonly dialogMainService: IDialogMainService
	) {
		super();

		this.lifecycleMainService.when(LifecycleMainPhase.Ready).then(() => this.registerListeners());
	}

	private registerListeners(): void {

		// Signal a window is ready after having entered a workspace
		this._register(this.workspacesMainService.onWorkspaceEntered(event => this._onWindowReady.fire(event.window)));
	}

	openEmptyWindow(openConfig: IOpenEmptyConfiguration, options?: IOpenEmptyWindowOptions): ICodeWindow[] {
		let cli = this.environmentService.args;
		const remote = options?.remoteAuthority;
		if (cli && (cli.remote !== remote)) {
			cli = { ...cli, remote };
		}

		const forceEmpty = true;
		const forceReuseWindow = options?.forceReuseWindow;
		const forceNewWindow = !forceReuseWindow;

		return this.open({ ...openConfig, cli, forceEmpty, forceNewWindow, forceReuseWindow });
	}

	open(openConfig: IOpenConfiguration): ICodeWindow[] {
		this.logService.trace('windowsManager#open');
		openConfig = this.validateOpenConfig(openConfig);

		const foldersToAdd: IFolderPathToOpen[] = [];
		const foldersToOpen: IFolderPathToOpen[] = [];
		const workspacesToOpen: IWorkspacePathToOpen[] = [];
		const workspacesToRestore: IWorkspacePathToOpen[] = [];
		const emptyToRestore: IEmptyWindowBackupInfo[] = [];
		let filesToOpen: IFilesToOpen | undefined;
		let emptyToOpen = 0;

		// If folders are specified to be opened at the command line, delete the current
		// untitled workspaces to avoid opening duplicates. This prevents the bug of
		// old workspaces being restored when a new workspace is generated, resulting
		// in two workspaces being opened when only one was intended.
		if (openConfig.cli._.length) {
			this.workspacesMainService.getUntitledWorkspacesSync().forEach(workspace => this.workspacesMainService.deleteUntitledWorkspaceSync(workspace.workspace));
		}

		// Identify things to open from open config
		const pathsToOpen = this.getPathsToOpen(openConfig);
		this.logService.trace('windowsManager#open pathsToOpen', pathsToOpen);
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
				if (!filesToOpen) {
					filesToOpen = { filesToOpenOrCreate: [], filesToDiff: [], remoteAuthority: path.remoteAuthority };
				}
				filesToOpen.filesToOpenOrCreate.push(path);
			} else if (path.backupPath) {
				emptyToRestore.push({ backupFolder: basename(path.backupPath), remoteAuthority: path.remoteAuthority });
			} else {
				emptyToOpen++;
			}
		}

		// When run with --diff, take the files to open as files to diff
		// if there are exactly two files provided.
		if (openConfig.diffMode && filesToOpen?.filesToOpenOrCreate.length === 2) {
			filesToOpen.filesToDiff = filesToOpen.filesToOpenOrCreate;
			filesToOpen.filesToOpenOrCreate = [];
		}

		// When run with --wait, make sure we keep the paths to wait for
		if (filesToOpen && openConfig.waitMarkerFileURI) {
			filesToOpen.filesToWait = { paths: [...filesToOpen.filesToDiff, ...filesToOpen.filesToOpenOrCreate], waitMarkerFileUri: openConfig.waitMarkerFileURI };
		}

		// These are windows to restore because of hot-exit or from previous session (only performed once on startup!)
		if (openConfig.initialStartup) {

			// Untitled workspaces are always restored
			workspacesToRestore.push(...this.workspacesMainService.getUntitledWorkspacesSync());
			workspacesToOpen.push(...workspacesToRestore);

			// Empty windows with backups are always restored
			emptyToRestore.push(...this.backupMainService.getEmptyWindowBackupPaths());
		} else {
			emptyToRestore.length = 0;
		}

		// Open based on config
		const { windows: usedWindows, filesOpenedInWindow } = this.doOpen(openConfig, workspacesToOpen, foldersToOpen, emptyToRestore, emptyToOpen, filesToOpen, foldersToAdd);

		this.logService.trace(`windowsManager#open used window count ${usedWindows.length} (workspacesToOpen: ${workspacesToOpen.length}, foldersToOpen: ${foldersToOpen.length}, emptyToRestore: ${emptyToRestore.length}, emptyToOpen: ${emptyToOpen})`);

		// Make sure to pass focus to the most relevant of the windows if we open multiple
		if (usedWindows.length > 1) {

			// 1.) focus window we opened files in always with highest priority
			if (filesOpenedInWindow) {
				filesOpenedInWindow.focus();
			}

			// Otherwise, find a good window based on open params
			else {
				const focusLastActive = this.windowsStateHandler.state.lastActiveWindow && !openConfig.forceEmpty && !openConfig.cli._.length && !openConfig.cli['file-uri'] && !openConfig.cli['folder-uri'] && !(openConfig.urisToOpen && openConfig.urisToOpen.length);
				let focusLastOpened = true;
				let focusLastWindow = true;

				// 2.) focus last active window if we are not instructed to open any paths
				if (focusLastActive) {
					const lastActiveWindow = usedWindows.filter(window => this.windowsStateHandler.state.lastActiveWindow && window.backupPath === this.windowsStateHandler.state.lastActiveWindow.backupPath);
					if (lastActiveWindow.length) {
						lastActiveWindow[0].focus();
						focusLastOpened = false;
						focusLastWindow = false;
					}
				}

				// 3.) if instructed to open paths, focus last window which is not restored
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

				// 4.) finally, always ensure to have at least last used window focused
				if (focusLastWindow) {
					usedWindows[usedWindows.length - 1].focus();
				}
			}
		}

		// Remember in recent document list (unless this opens for extension development)
		// Also do not add paths when files are opened for diffing, only if opened individually
		const isDiff = filesToOpen && filesToOpen.filesToDiff.length > 0;
		if (!usedWindows.some(window => window.isExtensionDevelopmentHost) && !isDiff && !openConfig.noRecentEntry) {
			const recents: IRecent[] = [];
			for (const pathToOpen of pathsToOpen) {
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
			usedWindows[0].whenClosedOrLoaded.then(() => unlink(waitMarkerFileURI.fsPath, () => undefined));
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
		filesToOpen: IFilesToOpen | undefined,
		foldersToAdd: IFolderPathToOpen[]
	): { windows: ICodeWindow[], filesOpenedInWindow: ICodeWindow | undefined } {

		// Keep track of used windows and remember
		// if files have been opened in one of them
		const usedWindows: ICodeWindow[] = [];
		let filesOpenedInWindow: ICodeWindow | undefined = undefined;
		function addUsedWindow(window: ICodeWindow, openedFiles?: boolean): void {
			usedWindows.push(window);

			if (openedFiles) {
				filesOpenedInWindow = window;
				filesToOpen = undefined; // reset `filesToOpen` since files have been opened
			}
		}

		// Settings can decide if files/folders open in new window or not
		let { openFolderInNewWindow, openFilesInNewWindow } = this.shouldOpenNewWindow(openConfig);

		// Handle folders to add by looking for the last active workspace (not on initial startup)
		if (!openConfig.initialStartup && foldersToAdd.length > 0) {
			const authority = foldersToAdd[0].remoteAuthority;
			const lastActiveWindow = this.getLastActiveWindowForAuthority(authority);
			if (lastActiveWindow) {
				addUsedWindow(this.doAddFoldersToExistingWindow(lastActiveWindow, foldersToAdd.map(folderToAdd => folderToAdd.folderUri)));
			}
		}

		// Handle files to open/diff or to create when we dont open a folder and we do not restore any
		// folder/untitled from hot-exit by trying to open them in the window that fits best
		const potentialNewWindowsCount = foldersToOpen.length + workspacesToOpen.length + emptyToRestore.length;
		if (filesToOpen && potentialNewWindowsCount === 0) {

			// Find suitable window or folder path to open files in
			const fileToCheck = filesToOpen.filesToOpenOrCreate[0] || filesToOpen.filesToDiff[0];

			// only look at the windows with correct authority
			const windows = this.getWindows().filter(window => filesToOpen && window.remoteAuthority === filesToOpen.remoteAuthority);

			// figure out a good window to open the files in if any
			// with a fallback to the last active window.
			//
			// in case `openFilesInNewWindow` is enforced, we skip
			// this step.
			let windowToUseForFiles: ICodeWindow | undefined = undefined;
			if (fileToCheck?.fileUri && !openFilesInNewWindow) {
				if (openConfig.context === OpenContext.DESKTOP || openConfig.context === OpenContext.CLI || openConfig.context === OpenContext.DOCK) {
					windowToUseForFiles = findWindowOnFile(windows, fileToCheck.fileUri, workspace => workspace.configPath.scheme === Schemas.file ? this.workspacesMainService.resolveLocalWorkspaceSync(workspace.configPath) : null);
				}

				if (!windowToUseForFiles) {
					windowToUseForFiles = this.doGetLastActiveWindow(windows);
				}
			}

			// We found a window to open the files in
			if (windowToUseForFiles) {

				// Window is workspace
				if (windowToUseForFiles.openedWorkspace) {
					workspacesToOpen.push({ workspace: windowToUseForFiles.openedWorkspace, remoteAuthority: windowToUseForFiles.remoteAuthority });
				}

				// Window is single folder
				else if (windowToUseForFiles.openedFolderUri) {
					foldersToOpen.push({ folderUri: windowToUseForFiles.openedFolderUri, remoteAuthority: windowToUseForFiles.remoteAuthority });
				}

				// Window is empty
				else {
					addUsedWindow(this.doOpenFilesInExistingWindow(openConfig, windowToUseForFiles, filesToOpen), true);
				}
			}

			// Finally, if no window or folder is found, just open the files in an empty window
			else {
				addUsedWindow(this.openInBrowserWindow({
					userEnv: openConfig.userEnv,
					cli: openConfig.cli,
					initialStartup: openConfig.initialStartup,
					filesToOpen,
					forceNewWindow: true,
					remoteAuthority: filesToOpen.remoteAuthority,
					forceNewTabbedWindow: openConfig.forceNewTabbedWindow
				}), true);
			}
		}

		// Handle workspaces to open (instructed and to restore)
		const allWorkspacesToOpen = distinct(workspacesToOpen, workspace => workspace.workspace.id); // prevent duplicates
		if (allWorkspacesToOpen.length > 0) {

			// Check for existing instances
			const windowsOnWorkspace = coalesce(allWorkspacesToOpen.map(workspaceToOpen => findWindowOnWorkspaceOrFolder(this.getWindows(), workspaceToOpen.workspace.configPath)));
			if (windowsOnWorkspace.length > 0) {
				const windowOnWorkspace = windowsOnWorkspace[0];
				const filesToOpenInWindow = (filesToOpen?.remoteAuthority === windowOnWorkspace.remoteAuthority) ? filesToOpen : undefined;

				// Do open files
				addUsedWindow(this.doOpenFilesInExistingWindow(openConfig, windowOnWorkspace, filesToOpenInWindow), !!filesToOpenInWindow);

				openFolderInNewWindow = true; // any other folders to open must open in new window then
			}

			// Open remaining ones
			allWorkspacesToOpen.forEach(workspaceToOpen => {
				if (windowsOnWorkspace.some(window => window.openedWorkspace && window.openedWorkspace.id === workspaceToOpen.workspace.id)) {
					return; // ignore folders that are already open
				}

				const remoteAuthority = workspaceToOpen.remoteAuthority;
				const filesToOpenInWindow = (filesToOpen?.remoteAuthority === remoteAuthority) ? filesToOpen : undefined;

				// Do open folder
				addUsedWindow(this.doOpenFolderOrWorkspace(openConfig, workspaceToOpen, openFolderInNewWindow, filesToOpenInWindow), !!filesToOpenInWindow);

				openFolderInNewWindow = true; // any other folders to open must open in new window then
			});
		}

		// Handle folders to open (instructed and to restore)
		const allFoldersToOpen = distinct(foldersToOpen, folder => extUriBiasedIgnorePathCase.getComparisonKey(folder.folderUri)); // prevent duplicates
		if (allFoldersToOpen.length > 0) {

			// Check for existing instances
			const windowsOnFolderPath = coalesce(allFoldersToOpen.map(folderToOpen => findWindowOnWorkspaceOrFolder(this.getWindows(), folderToOpen.folderUri)));
			if (windowsOnFolderPath.length > 0) {
				const windowOnFolderPath = windowsOnFolderPath[0];
				const filesToOpenInWindow = filesToOpen?.remoteAuthority === windowOnFolderPath.remoteAuthority ? filesToOpen : undefined;

				// Do open files
				addUsedWindow(this.doOpenFilesInExistingWindow(openConfig, windowOnFolderPath, filesToOpenInWindow), !!filesToOpenInWindow);

				openFolderInNewWindow = true; // any other folders to open must open in new window then
			}

			// Open remaining ones
			allFoldersToOpen.forEach(folderToOpen => {

				if (windowsOnFolderPath.some(window => extUriBiasedIgnorePathCase.isEqual(window.openedFolderUri, folderToOpen.folderUri))) {
					return; // ignore folders that are already open
				}

				const remoteAuthority = folderToOpen.remoteAuthority;
				const filesToOpenInWindow = (filesToOpen?.remoteAuthority === remoteAuthority) ? filesToOpen : undefined;

				// Do open folder
				addUsedWindow(this.doOpenFolderOrWorkspace(openConfig, folderToOpen, openFolderInNewWindow, filesToOpenInWindow), !!filesToOpenInWindow);

				openFolderInNewWindow = true; // any other folders to open must open in new window then
			});
		}

		// Handle empty to restore
		const allEmptyToRestore = distinct(emptyToRestore, info => info.backupFolder); // prevent duplicates
		if (allEmptyToRestore.length > 0) {
			allEmptyToRestore.forEach(emptyWindowBackupInfo => {
				const remoteAuthority = emptyWindowBackupInfo.remoteAuthority;
				const filesToOpenInWindow = (filesToOpen?.remoteAuthority === remoteAuthority) ? filesToOpen : undefined;

				addUsedWindow(this.openInBrowserWindow({
					userEnv: openConfig.userEnv,
					cli: openConfig.cli,
					initialStartup: openConfig.initialStartup,
					filesToOpen: filesToOpenInWindow,
					remoteAuthority,
					forceNewWindow: true,
					forceNewTabbedWindow: openConfig.forceNewTabbedWindow,
					emptyWindowBackupInfo
				}), !!filesToOpenInWindow);

				openFolderInNewWindow = true; // any other folders to open must open in new window then
			});
		}

		// Handle empty to open (only if no other window opened)
		if (usedWindows.length === 0 || filesToOpen) {
			if (filesToOpen && !emptyToOpen) {
				emptyToOpen++;
			}

			const remoteAuthority = filesToOpen ? filesToOpen.remoteAuthority : (openConfig.cli && openConfig.cli.remote || undefined);

			for (let i = 0; i < emptyToOpen; i++) {
				addUsedWindow(this.doOpenEmpty(openConfig, openFolderInNewWindow, remoteAuthority, filesToOpen), !!filesToOpen);

				// any other window to open must open in new window then
				openFolderInNewWindow = true;
			}
		}

		return { windows: distinct(usedWindows), filesOpenedInWindow };
	}

	private doOpenFilesInExistingWindow(configuration: IOpenConfiguration, window: ICodeWindow, filesToOpen?: IFilesToOpen): ICodeWindow {
		this.logService.trace('windowsManager#doOpenFilesInExistingWindow');

		window.focus(); // make sure window has focus

		const params: INativeOpenFileRequest = {
			filesToOpenOrCreate: filesToOpen?.filesToOpenOrCreate,
			filesToDiff: filesToOpen?.filesToDiff,
			filesToWait: filesToOpen?.filesToWait,
			termProgram: configuration?.userEnv?.['TERM_PROGRAM']
		};

		window.sendWhenReady('vscode:openFiles', CancellationToken.None, params);

		return window;
	}

	private doAddFoldersToExistingWindow(window: ICodeWindow, foldersToAdd: URI[]): ICodeWindow {
		this.logService.trace('windowsManager#doAddFoldersToExistingWindow');

		window.focus(); // make sure window has focus

		const request: IAddFoldersRequest = { foldersToAdd };

		window.sendWhenReady('vscode:addFolders', CancellationToken.None, request);

		return window;
	}

	private doOpenEmpty(openConfig: IOpenConfiguration, forceNewWindow: boolean, remoteAuthority: string | undefined, filesToOpen: IFilesToOpen | undefined, windowToUse?: ICodeWindow): ICodeWindow {
		if (!forceNewWindow && !windowToUse && typeof openConfig.contextWindowId === 'number') {
			windowToUse = this.getWindowById(openConfig.contextWindowId); // fix for https://github.com/microsoft/vscode/issues/97172
		}

		return this.openInBrowserWindow({
			userEnv: openConfig.userEnv,
			cli: openConfig.cli,
			initialStartup: openConfig.initialStartup,
			remoteAuthority,
			forceNewWindow,
			forceNewTabbedWindow: openConfig.forceNewTabbedWindow,
			filesToOpen,
			windowToUse
		});
	}

	private doOpenFolderOrWorkspace(openConfig: IOpenConfiguration, folderOrWorkspace: IPathToOpen, forceNewWindow: boolean, filesToOpen: IFilesToOpen | undefined, windowToUse?: ICodeWindow): ICodeWindow {
		if (!forceNewWindow && !windowToUse && typeof openConfig.contextWindowId === 'number') {
			windowToUse = this.getWindowById(openConfig.contextWindowId); // fix for https://github.com/microsoft/vscode/issues/49587
		}

		return this.openInBrowserWindow({
			workspace: folderOrWorkspace.workspace,
			folderUri: folderOrWorkspace.folderUri,
			userEnv: openConfig.userEnv,
			cli: openConfig.cli,
			initialStartup: openConfig.initialStartup,
			remoteAuthority: folderOrWorkspace.remoteAuthority,
			forceNewWindow,
			forceNewTabbedWindow: openConfig.forceNewTabbedWindow,
			filesToOpen,
			windowToUse
		});
	}

	private getPathsToOpen(openConfig: IOpenConfiguration): IPathToOpen[] {
		let windowsToOpen: IPathToOpen[];
		let isCommandLineOrAPICall = false;
		let restoredWindows = false;

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
			if (windowsToOpen.length === 0) {
				windowsToOpen.push(Object.create(null)); // add an empty window if we did not have windows to open from command line
			}
			isCommandLineOrAPICall = true;
		}

		// Extract windows: from previous session
		else {
			windowsToOpen = this.doGetWindowsFromLastSession();
			if (windowsToOpen.length === 0) {
				windowsToOpen.push(Object.create(null)); // add an empty window if we did not have windows to restore
			}
			restoredWindows = true;
		}

		// Convert multiple folders into workspace (if opened via API or CLI)
		// This will ensure to open these folders in one window instead of multiple
		// If we are in `addMode`, we should not do this because in that case all
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

		// Check for `window.startup` setting to include all windows
		// from the previous session if this is the initial startup and we have
		// not restored windows already otherwise.
		// Use `unshift` to ensure any new window to open comes last
		// for proper focus treatment.
		if (openConfig.initialStartup && !restoredWindows && this.configurationService.getValue<IWindowSettings | undefined>('window')?.restoreWindows === 'preserve') {
			windowsToOpen.unshift(...this.doGetWindowsFromLastSession().filter(window => window.workspace || window.folderUri || window.backupPath));
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
					detail = localize('pathNotExistDetail', "The path '{0}' does not seem to exist anymore on disk.", getPathLabel(uri.fsPath, this.environmentService));
				} else {
					message = localize('uriInvalidTitle', "URI can not be opened");
					detail = localize('uriInvalidDetail', "The URI '{0}' is not valid and can not be opened.", uri.toString());
				}

				const options: MessageBoxOptions = { title: product.nameLong, type: 'info', buttons: [localize('ok', "OK")], message, detail, noLink: true };

				this.dialogMainService.showMessageBox(options, withNullAsUndefined(BrowserWindow.getFocusedWindow()));
			}
		}

		return pathsToOpen;
	}

	private doExtractPathsFromCLI(cli: NativeParsedArgs): IPath[] {
		const pathsToOpen: IPathToOpen[] = [];
		const parseOptions: IPathParseOptions = { ignoreFileNotFound: true, gotoLineMode: cli.goto, remoteAuthority: cli.remote || undefined };

		// folder uris
		const folderUris = cli['folder-uri'];
		if (folderUris) {
			for (const rawFolderUri of folderUris) {
				const folderUri = this.argToUri(rawFolderUri);
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
			for (const rawFileUri of fileUris) {
				const fileUri = this.argToUri(rawFileUri);
				if (fileUri) {
					const path = this.parseUri(hasWorkspaceFileExtension(rawFileUri) ? { workspaceUri: fileUri } : { fileUri }, parseOptions);
					if (path) {
						pathsToOpen.push(path);
					}
				}
			}
		}

		// folder or file paths
		const cliPaths = cli._;
		for (const cliPath of cliPaths) {
			const path = this.parsePath(cliPath, parseOptions);
			if (path) {
				pathsToOpen.push(path);
			}
		}

		if (pathsToOpen.length) {
			return pathsToOpen;
		}

		// No path provided
		return [];
	}

	private doGetWindowsFromLastSession(): IPathToOpen[] {
		const restoreWindowsSetting = this.getRestoreWindowsSetting();

		switch (restoreWindowsSetting) {

			// none: no window to restore
			case 'none':
				return [];

			// one: restore last opened workspace/folder or empty window
			// all: restore all windows
			// folders: restore last opened folders only
			case 'one':
			case 'all':
			case 'preserve':
			case 'folders':

				// Collect previously opened windows
				const openedWindows: IWindowState[] = [];
				if (restoreWindowsSetting !== 'one') {
					openedWindows.push(...this.windowsStateHandler.state.openedWindows);
				}
				if (this.windowsStateHandler.state.lastActiveWindow) {
					openedWindows.push(this.windowsStateHandler.state.lastActiveWindow);
				}

				const windowsToOpen: IPathToOpen[] = [];
				for (const openedWindow of openedWindows) {

					// Workspaces
					if (openedWindow.workspace) {
						const pathToOpen = this.parseUri({ workspaceUri: openedWindow.workspace.configPath }, { remoteAuthority: openedWindow.remoteAuthority });
						if (pathToOpen?.workspace) {
							windowsToOpen.push(pathToOpen);
						}
					}

					// Folders
					else if (openedWindow.folderUri) {
						const pathToOpen = this.parseUri({ folderUri: openedWindow.folderUri }, { remoteAuthority: openedWindow.remoteAuthority });
						if (pathToOpen?.folderUri) {
							windowsToOpen.push(pathToOpen);
						}
					}

					// Empty window, potentially editors open to be restored
					else if (restoreWindowsSetting !== 'folders' && openedWindow.backupPath) {
						windowsToOpen.push({ backupPath: openedWindow.backupPath, remoteAuthority: openedWindow.remoteAuthority });
					}
				}

				return windowsToOpen;
		}
	}

	private getRestoreWindowsSetting(): RestoreWindowsSetting {
		let restoreWindows: RestoreWindowsSetting;
		if (this.lifecycleMainService.wasRestarted) {
			restoreWindows = 'all'; // always reopen all windows when an update was applied
		} else {
			const windowConfig = this.configurationService.getValue<IWindowSettings | undefined>('window');
			restoreWindows = windowConfig?.restoreWindows || 'all'; // by default restore all windows

			if (!['preserve', 'all', 'folders', 'one', 'none'].includes(restoreWindows)) {
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

	private parsePath(path: string, options: IPathParseOptions, forceOpenWorkspaceAsFile?: boolean): IPathToOpen | undefined {
		if (!path) {
			return undefined;
		}

		let lineNumber: number | undefined;
		let columnNumber: number | undefined;

		if (options.gotoLineMode) {
			const parsedPath = parseLineAndColumnAware(path);
			lineNumber = parsedPath.line;
			columnNumber = parsedPath.column;

			path = parsedPath.path;
		}

		// open remote if either specified in the cli even if it is a local file.
		const remoteAuthority = options.remoteAuthority;
		if (remoteAuthority) {
			const first = path.charCodeAt(0);

			// make absolute
			if (first !== CharCode.Slash) {
				if (isWindowsDriveLetter(first) && path.charCodeAt(path.charCodeAt(1)) === CharCode.Colon) {
					path = toSlashes(path);
				}

				path = `/${path}`;
			}

			const uri = URI.from({ scheme: Schemas.vscodeRemote, authority: remoteAuthority, path: path });

			// guess the file type: If it ends with a slash it's a folder. If it has a file extension, it's a file or a workspace. By defaults it's a folder.
			if (path.charCodeAt(path.length - 1) !== CharCode.Slash) {
				if (hasWorkspaceFileExtension(path)) {
					if (forceOpenWorkspaceAsFile) {
						return { fileUri: uri, remoteAuthority };
					}
				} else if (posix.basename(path).indexOf('.') !== -1) { // file name starts with a dot or has an file extension
					return { fileUri: uri, remoteAuthority };
				}
			}

			return { folderUri: uri, remoteAuthority };
		}

		let candidate = normalize(path);

		try {
			const candidateStat = statSync(candidate);
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
		const windowConfig = this.configurationService.getValue<IWindowSettings | undefined>('window');
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

	openExtensionDevelopmentHostWindow(extensionDevelopmentPaths: string[], openConfig: IOpenConfiguration): ICodeWindow[] {

		// Reload an existing extension development host window on the same path
		// We currently do not allow more than one extension development window
		// on the same extension path.
		const existingWindow = findWindowOnExtensionDevelopmentPath(this.getWindows(), extensionDevelopmentPaths);
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
			const extensionDevelopmentWindowState = this.windowsStateHandler.state.lastPluginDevelopmentHostWindow;
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
		for (const extensionDevelopmentPath of extensionDevelopmentPaths) {
			if (extensionDevelopmentPath.match(/^[a-zA-Z][a-zA-Z0-9\+\-\.]+:/)) {
				const url = URI.parse(extensionDevelopmentPath);
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
			if (!!findWindowOnWorkspaceOrFolder(this.getWindows(), uri)) {
				return false;
			}

			return uri.authority === authority;
		});

		folderUris = folderUris.filter(folderUriStr => {
			const folderUri = this.argToUri(folderUriStr);
			if (folderUri && !!findWindowOnWorkspaceOrFolder(this.getWindows(), folderUri)) {
				return false;
			}

			return folderUri ? folderUri.authority === authority : false;
		});

		fileUris = fileUris.filter(fileUriStr => {
			const fileUri = this.argToUri(fileUriStr);
			if (fileUri && !!findWindowOnWorkspaceOrFolder(this.getWindows(), fileUri)) {
				return false;
			}

			return fileUri ? fileUri.authority === authority : false;
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

		// Build `INativeWindowConfiguration` from config and options
		const configuration = { ...options.cli } as INativeWindowConfiguration;
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

		const filesToOpen = options.filesToOpen;
		if (filesToOpen) {
			configuration.filesToOpenOrCreate = filesToOpen.filesToOpenOrCreate;
			configuration.filesToDiff = filesToOpen.filesToDiff;
			configuration.filesToWait = filesToOpen.filesToWait;
		}

		// if we know the backup folder upfront (for empty windows to restore), we can set it
		// directly here which helps for restoring UI state associated with that window.
		// For all other cases we first call into registerEmptyWindowBackupSync() to set it before
		// loading the window.
		if (options.emptyWindowBackupInfo) {
			configuration.backupPath = join(this.environmentService.backupHome, options.emptyWindowBackupInfo.backupFolder);
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
			const state = this.windowsStateHandler.getNewWindowState(configuration);

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
					activeWindow.addTabbedWindow(createdWindow);
				}
			}

			// Add to our list of windows
			WindowsMainService.WINDOWS.push(createdWindow);

			// Indicate new window via event
			this._onWindowOpened.fire(createdWindow);

			// Indicate number change via event
			this._onWindowsCountChanged.fire({ oldCount: this.getWindowCount() - 1, newCount: this.getWindowCount() });

			// Window Events
			once(createdWindow.onReady)(() => this._onWindowReady.fire(createdWindow));
			once(createdWindow.onClose)(() => this.onWindowClosed(createdWindow));
			once(createdWindow.onDestroy)(() => this._onWindowDestroyed.fire(createdWindow));
			createdWindow.win.webContents.removeAllListeners('devtools-reload-page'); // remove built in listener so we can handle this on our own
			createdWindow.win.webContents.on('devtools-reload-page', () => this.lifecycleMainService.reload(createdWindow));

			// Lifecycle
			(this.lifecycleMainService as LifecycleMainService).registerWindow(createdWindow);
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

	private onWindowClosed(window: ICodeWindow): void {

		// Remove from our list so that Electron can clean it up
		const index = WindowsMainService.WINDOWS.indexOf(window);
		WindowsMainService.WINDOWS.splice(index, 1);

		// Emit
		this._onWindowsCountChanged.fire({ oldCount: this.getWindowCount() + 1, newCount: this.getWindowCount() });
	}

	getFocusedWindow(): ICodeWindow | undefined {
		const window = BrowserWindow.getFocusedWindow();
		if (window) {
			return this.getWindowById(window.id);
		}

		return undefined;
	}

	getLastActiveWindow(): ICodeWindow | undefined {
		return this.doGetLastActiveWindow(this.getWindows());
	}

	private getLastActiveWindowForAuthority(remoteAuthority: string | undefined): ICodeWindow | undefined {
		return this.doGetLastActiveWindow(this.getWindows().filter(window => window.remoteAuthority === remoteAuthority));
	}

	private doGetLastActiveWindow(windows: ICodeWindow[]): ICodeWindow | undefined {
		const lastFocusedDate = Math.max.apply(Math, windows.map(window => window.lastFocusTime));

		return windows.find(window => window.lastFocusTime === lastFocusedDate);
	}

	sendToFocused(channel: string, ...args: any[]): void {
		const focusedWindow = this.getFocusedWindow() || this.getLastActiveWindow();

		if (focusedWindow) {
			focusedWindow.sendWhenReady(channel, CancellationToken.None, ...args);
		}
	}

	sendToAll(channel: string, payload?: any, windowIdsToIgnore?: number[]): void {
		for (const window of this.getWindows()) {
			if (windowIdsToIgnore && windowIdsToIgnore.indexOf(window.id) >= 0) {
				continue; // do not send if we are instructed to ignore it
			}

			window.sendWhenReady(channel, CancellationToken.None, payload);
		}
	}

	getWindows(): ICodeWindow[] {
		return WindowsMainService.WINDOWS;
	}

	getWindowCount(): number {
		return WindowsMainService.WINDOWS.length;
	}

	getWindowById(windowId: number): ICodeWindow | undefined {
		const windows = this.getWindows().filter(window => window.id === windowId);

		return firstOrDefault(windows);
	}

	getWindowByWebContents(webContents: WebContents): ICodeWindow | undefined {
		const browserWindow = BrowserWindow.fromWebContents(webContents);
		if (!browserWindow) {
			return undefined;
		}

		return this.getWindowById(browserWindow.id);
	}
}
