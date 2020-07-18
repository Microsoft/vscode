/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWindowConfiguration, IPath, IOpenFileRequest, IPathData } from 'vs/platform/windows/common/windows';
import { URI, UriComponents } from 'vs/base/common/uri';
import * as platform from 'vs/base/common/platform';
import * as extpath from 'vs/base/common/extpath';
import { IWorkspaceIdentifier, IResolvedWorkspace, ISingleFolderWorkspaceIdentifier, isSingleFolderWorkspaceIdentifier, isWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { extUriBiasedIgnorePathCase } from 'vs/base/common/resources';
import { LogLevel } from 'vs/platform/log/common/log';
import { ExportData } from 'vs/base/common/performance';
import { ParsedArgs } from 'vs/platform/environment/node/argv';

export const enum OpenContext {

	// opening when running from the command line
	CLI,

	// macOS only: opening from the dock (also when opening files to a running instance from desktop)
	DOCK,

	// opening from the main application window
	MENU,

	// opening from a file or folder dialog
	DIALOG,

	// opening from the OS's UI
	DESKTOP,

	// opening through the API
	API
}

export interface IRunActionInWindowRequest {
	id: string;
	from: 'menu' | 'touchbar' | 'mouse';
	args?: any[];
}

export interface IRunKeybindingInWindowRequest {
	userSettingsLabel: string;
}

export interface INativeWindowConfiguration extends IWindowConfiguration, ParsedArgs {
	mainPid: number;

	windowId: number;
	machineId: string;

	appRoot: string;
	execPath: string;
	backupPath?: string;

	nodeCachedDataDir?: string;
	partsSplashPath: string;

	workspace?: IWorkspaceIdentifier;
	folderUri?: ISingleFolderWorkspaceIdentifier;

	isInitialStartup?: boolean;
	logLevel: LogLevel;
	zoomLevel?: number;
	fullscreen?: boolean;
	maximized?: boolean;
	accessibilitySupport?: boolean;
	perfEntries: ExportData;

	userEnv: platform.IProcessEnvironment;
	filesToWait?: IPathsToWaitFor;
}

export interface INativeOpenFileRequest extends IOpenFileRequest {
	termProgram?: string;
	filesToWait?: IPathsToWaitForData;
}

export interface IPathsToWaitFor extends IPathsToWaitForData {
	paths: IPath[];
	waitMarkerFileUri: URI;
}

export interface IPathsToWaitForData {
	paths: IPathData[];
	waitMarkerFileUri: UriComponents;
}

export interface IWindowContext {
	openedWorkspace?: IWorkspaceIdentifier;
	openedFolderUri?: URI;

	extensionDevelopmentPath?: string[];
	lastFocusTime: number;
}

export interface IBestWindowOrFolderOptions<W extends IWindowContext> {
	windows: W[];
	newWindow: boolean;
	context: OpenContext;
	fileUri?: URI;
	userHome?: string;
	codeSettingsFolder?: string;
	localWorkspaceResolver: (workspace: IWorkspaceIdentifier) => IResolvedWorkspace | null;
}

export function findBestWindowOrFolderForFile<W extends IWindowContext>({ windows, newWindow, context, fileUri, localWorkspaceResolver: workspaceResolver }: IBestWindowOrFolderOptions<W>): W | undefined {
	if (!newWindow && fileUri && (context === OpenContext.DESKTOP || context === OpenContext.CLI || context === OpenContext.DOCK)) {
		const windowOnFilePath = findWindowOnFilePath(windows, fileUri, workspaceResolver);
		if (windowOnFilePath) {
			return windowOnFilePath;
		}
	}
	return !newWindow ? getLastActiveWindow(windows) : undefined;
}

function findWindowOnFilePath<W extends IWindowContext>(windows: W[], fileUri: URI, localWorkspaceResolver: (workspace: IWorkspaceIdentifier) => IResolvedWorkspace | null): W | null {

	// First check for windows with workspaces that have a parent folder of the provided path opened
	for (const window of windows) {
		const workspace = window.openedWorkspace;
		if (workspace) {
			const resolvedWorkspace = localWorkspaceResolver(workspace);
			if (resolvedWorkspace) {
				// workspace could be resolved: It's in the local file system
				if (resolvedWorkspace.folders.some(folder => extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, folder.uri))) {
					return window;
				}
			} else {
				// use the config path instead
				if (extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, workspace.configPath)) {
					return window;
				}
			}
		}
	}

	// Then go with single folder windows that are parent of the provided file path
	const singleFolderWindowsOnFilePath = windows.filter(window => window.openedFolderUri && extUriBiasedIgnorePathCase.isEqualOrParent(fileUri, window.openedFolderUri));
	if (singleFolderWindowsOnFilePath.length) {
		return singleFolderWindowsOnFilePath.sort((a, b) => -(a.openedFolderUri!.path.length - b.openedFolderUri!.path.length))[0];
	}

	return null;
}

export function getLastActiveWindow<W extends IWindowContext>(windows: W[]): W | undefined {
	const lastFocusedDate = Math.max.apply(Math, windows.map(window => window.lastFocusTime));

	return windows.find(window => window.lastFocusTime === lastFocusedDate);
}

export function findWindowOnWorkspace<W extends IWindowContext>(windows: W[], workspace: (IWorkspaceIdentifier | ISingleFolderWorkspaceIdentifier)): W | null {
	if (isSingleFolderWorkspaceIdentifier(workspace)) {
		for (const window of windows) {
			// match on folder
			if (isSingleFolderWorkspaceIdentifier(workspace)) {
				if (window.openedFolderUri && extUriBiasedIgnorePathCase.isEqual(window.openedFolderUri, workspace)) {
					return window;
				}
			}
		}
	} else if (isWorkspaceIdentifier(workspace)) {
		for (const window of windows) {
			// match on workspace
			if (window.openedWorkspace && window.openedWorkspace.id === workspace.id) {
				return window;
			}
		}
	}
	return null;
}

export function findWindowOnExtensionDevelopmentPath<W extends IWindowContext>(windows: W[], extensionDevelopmentPaths: string[]): W | null {

	const matches = (uriString: string): boolean => {
		return extensionDevelopmentPaths.some(p => extpath.isEqual(p, uriString, !platform.isLinux /* ignorecase */));
	};

	for (const window of windows) {
		// match on extension development path. The path can be one or more paths or uri strings, using paths.isEqual is not 100% correct but good enough
		const currPaths = window.extensionDevelopmentPath;
		if (currPaths?.some(p => matches(p))) {
			return window;
		}
	}

	return null;
}

export function findWindowOnWorkspaceOrFolderUri<W extends IWindowContext>(windows: W[], uri: URI | undefined): W | null {
	if (!uri) {
		return null;
	}
	for (const window of windows) {
		// check for workspace config path
		if (window.openedWorkspace && extUriBiasedIgnorePathCase.isEqual(window.openedWorkspace.configPath, uri)) {
			return window;
		}

		// check for folder path
		if (window.openedFolderUri && extUriBiasedIgnorePathCase.isEqual(window.openedFolderUri, uri)) {
			return window;
		}
	}
	return null;
}
