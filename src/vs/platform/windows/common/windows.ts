/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, isLinux, isWeb, IProcessEnvironment } from 'vs/base/common/platform';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { LogLevel } from 'vs/platform/log/common/log';
import { ExportData } from 'vs/base/common/performance';

export const WindowMinimumSize = {
	WIDTH: 400,
	WIDTH_WITH_VERTICAL_PANEL: 600,
	HEIGHT: 270
};

export interface IBaseOpenWindowsOptions {
	forceReuseWindow?: boolean;
}

export interface IOpenWindowOptions extends IBaseOpenWindowsOptions {
	forceNewWindow?: boolean;
	preferNewWindow?: boolean;

	noRecentEntry?: boolean;

	addMode?: boolean;

	diffMode?: boolean;
	gotoLineMode?: boolean;

	waitMarkerFileURI?: URI;
}

export interface IAddFoldersRequest {
	foldersToAdd: UriComponents[];
}

export interface IOpenedWindow {
	id: number;
	workspace?: IWorkspaceIdentifier;
	folderUri?: ISingleFolderWorkspaceIdentifier;
	title: string;
	filename?: string;
	dirty: boolean;
}

export interface IOpenEmptyWindowOptions extends IBaseOpenWindowsOptions {
	remoteAuthority?: string;
}

export type IWindowOpenable = IWorkspaceToOpen | IFolderToOpen | IFileToOpen;

export interface IBaseWindowOpenable {
	label?: string;
}

export interface IWorkspaceToOpen extends IBaseWindowOpenable {
	workspaceUri: URI;
}

export interface IFolderToOpen extends IBaseWindowOpenable {
	folderUri: URI;
}

export interface IFileToOpen extends IBaseWindowOpenable {
	fileUri: URI;
}

export function isWorkspaceToOpen(uriToOpen: IWindowOpenable): uriToOpen is IWorkspaceToOpen {
	return !!(uriToOpen as IWorkspaceToOpen).workspaceUri;
}

export function isFolderToOpen(uriToOpen: IWindowOpenable): uriToOpen is IFolderToOpen {
	return !!(uriToOpen as IFolderToOpen).folderUri;
}

export function isFileToOpen(uriToOpen: IWindowOpenable): uriToOpen is IFileToOpen {
	return !!(uriToOpen as IFileToOpen).fileUri;
}

export type MenuBarVisibility = 'default' | 'visible' | 'toggle' | 'hidden' | 'compact';

export function getMenuBarVisibility(configurationService: IConfigurationService): MenuBarVisibility {
	const titleBarStyle = getTitleBarStyle(configurationService);
	const menuBarVisibility = configurationService.getValue<MenuBarVisibility>('window.menuBarVisibility');

	if (titleBarStyle === 'native' && menuBarVisibility === 'compact') {
		return 'default';
	} else {
		return menuBarVisibility;
	}
}

export interface IWindowsConfiguration {
	window: IWindowSettings;
}

export interface IWindowSettings {
	openFilesInNewWindow: 'on' | 'off' | 'default';
	openFoldersInNewWindow: 'on' | 'off' | 'default';
	openWithoutArgumentsInNewWindow: 'on' | 'off';
	restoreWindows: 'preserve' | 'all' | 'folders' | 'one' | 'none';
	restoreFullscreen: boolean;
	zoomLevel: number;
	titleBarStyle: 'native' | 'custom';
	autoDetectHighContrast: boolean;
	menuBarVisibility: MenuBarVisibility;
	newWindowDimensions: 'default' | 'inherit' | 'offset' | 'maximized' | 'fullscreen';
	nativeTabs: boolean;
	nativeFullScreen: boolean;
	enableMenuBarMnemonics: boolean;
	closeWhenEmpty: boolean;
	clickThroughInactive: boolean;
	enableExperimentalProxyLoginDialog: boolean;
}

export function getTitleBarStyle(configurationService: IConfigurationService): 'native' | 'custom' {
	if (isWeb) {
		return 'custom';
	}

	const configuration = configurationService.getValue<IWindowSettings | undefined>('window');

	if (configuration) {
		const useNativeTabs = isMacintosh && configuration.nativeTabs === true;
		if (useNativeTabs) {
			return 'native'; // native tabs on sierra do not work with custom title style
		}

		const useSimpleFullScreen = isMacintosh && configuration.nativeFullScreen === false;
		if (useSimpleFullScreen) {
			return 'native'; // simple fullscreen does not work well with custom title style (https://github.com/microsoft/vscode/issues/63291)
		}

		const style = configuration.titleBarStyle;
		if (style === 'native' || style === 'custom') {
			return style;
		}
	}

	return isLinux ? 'native' : 'custom'; // default to custom on all macOS and Windows
}

export interface IPath extends IPathData {

	// the file path to open within the instance
	fileUri?: URI;
}

export interface IPathData {

	// the file path to open within the instance
	fileUri?: UriComponents;

	// the line number in the file path to open
	lineNumber?: number;

	// the column number in the file path to open
	columnNumber?: number;

	// a hint that the file exists. if true, the
	// file exists, if false it does not. with
	// undefined the state is unknown.
	exists?: boolean;

	// Specifies if the file should be only be opened if it exists
	openOnlyIfExists?: boolean;

	// Specifies an optional id to override the editor used to edit the resource, e.g. custom editor.
	overrideId?: string;
}

export interface IPathsToWaitFor extends IPathsToWaitForData {
	paths: IPath[];
	waitMarkerFileUri: URI;
}

interface IPathsToWaitForData {
	paths: IPathData[];
	waitMarkerFileUri: UriComponents;
}

export interface IOpenFileRequest {
	filesToOpenOrCreate?: IPathData[];
	filesToDiff?: IPathData[];
}

/**
 * Additional context for the request on native only.
 */
export interface INativeOpenFileRequest extends IOpenFileRequest {
	termProgram?: string;
	filesToWait?: IPathsToWaitForData;
}

export interface INativeRunActionInWindowRequest {
	id: string;
	from: 'menu' | 'touchbar' | 'mouse';
	args?: any[];
}

export interface INativeRunKeybindingInWindowRequest {
	userSettingsLabel: string;
}

export interface IColorScheme {
	dark: boolean;
	highContrast: boolean;
}

export interface IWindowConfiguration {
	sessionId: string;

	remoteAuthority?: string;

	colorScheme: IColorScheme;
	autoDetectHighContrast?: boolean;

	filesToOpenOrCreate?: IPath[];
	filesToDiff?: IPath[];
}

export interface IOSConfiguration {
	release: string;
}

export interface INativeWindowConfiguration extends IWindowConfiguration, NativeParsedArgs {
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

	userEnv: IProcessEnvironment;
	filesToWait?: IPathsToWaitFor;

	os: IOSConfiguration;
}

/**
 * According to Electron docs: `scale := 1.2 ^ level`.
 * https://github.com/electron/electron/blob/master/docs/api/web-contents.md#contentssetzoomlevellevel
 */
export function zoomLevelToZoomFactor(zoomLevel = 0): number {
	return Math.pow(1.2, zoomLevel);
}
