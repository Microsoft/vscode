/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI, UriComponents } from 'vs/base/common/uri';
import { IWindowState as IWindowUIState } from 'vs/platform/windows/electron-main/windows';
import { IWindowState, IWindowsState } from 'vs/platform/windows/electron-main/windowsMainService';

export type WindowsStateStorageData = object;

interface ISerializedWindowsState {
	lastActiveWindow?: ISerializedWindowState;
	lastPluginDevelopmentHostWindow?: ISerializedWindowState;
	openedWindows: ISerializedWindowState[];
}

interface ISerializedWindowState {
	workspaceIdentifier?: { id: string; configURIPath: string };
	folder?: string;
	backupPath?: string;
	remoteAuthority?: string;
	uiState: IWindowUIState;

	// deprecated
	folderUri?: UriComponents;
	folderPath?: string;
	workspace?: { id: string; configPath: string };
}

export function restoreWindowsState(data: WindowsStateStorageData | undefined): IWindowsState {
	const result: IWindowsState = { openedWindows: [] };
	const windowsState = data as ISerializedWindowsState || { openedWindows: [] };

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
	} else if (windowState.folderUri) {
		result.folderUri = URI.revive(windowState.folderUri);
	} else if (windowState.folderPath) {
		result.folderUri = URI.file(windowState.folderPath);
	}

	if (windowState.workspaceIdentifier) {
		result.workspace = { id: windowState.workspaceIdentifier.id, configPath: URI.parse(windowState.workspaceIdentifier.configURIPath) };
	} else if (windowState.workspace) {
		result.workspace = { id: windowState.workspace.id, configPath: URI.file(windowState.workspace.configPath) };
	}

	return result;
}

export function getWindowsStateStoreData(windowsState: IWindowsState): WindowsStateStorageData {
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
