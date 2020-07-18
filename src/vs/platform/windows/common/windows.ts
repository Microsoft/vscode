/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { isMacintosh, isLinux, isWeb } from 'vs/base/common/platform';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { URI, UriComponents } from 'vs/base/common/uri';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ThemeType } from 'vs/platform/theme/common/themeService';
import { IWorkspaceIdentifier, ISingleFolderWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';

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

export function getMenuBarVisibility(configurationService: IConfigurationService, environment: IEnvironmentService, isExtensionDevelopment = environment.isExtensionDevelopment): MenuBarVisibility {
	const titleBarStyle = getTitleBarStyle(configurationService, environment, isExtensionDevelopment);
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
	restoreWindows: 'all' | 'folders' | 'one' | 'none';
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
}

export function getTitleBarStyle(configurationService: IConfigurationService, environment: IEnvironmentService, isExtensionDevelopment = environment.isExtensionDevelopment): 'native' | 'custom' {
	if (isWeb) {
		return 'custom';
	}

	const configuration = configurationService.getValue<IWindowSettings>('window');

	const isDev = !environment.isBuilt || isExtensionDevelopment;
	if (isMacintosh && isDev) {
		return 'native'; // not enabled when developing due to https://github.com/electron/electron/issues/3647
	}

	if (configuration) {
		const useNativeTabs = isMacintosh && configuration.nativeTabs === true;
		if (useNativeTabs) {
			return 'native'; // native tabs on sierra do not work with custom title style
		}

		const useSimpleFullScreen = isMacintosh && configuration.nativeFullScreen === false;
		if (useSimpleFullScreen) {
			return 'native'; // simple fullscreen does not work well with custom title style (https://github.com/Microsoft/vscode/issues/63291)
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

export interface IOpenFileRequest {
	filesToOpenOrCreate?: IPathData[];
	filesToDiff?: IPathData[];
}

export interface IWindowConfiguration {
	sessionId: string;

	remoteAuthority?: string;

	highContrast?: boolean;
	defaultThemeType?: ThemeType;

	filesToOpenOrCreate?: IPath[];
	filesToDiff?: IPath[];
}

/**
 * According to Electron docs: `scale := 1.2 ^ level`.
 * https://github.com/electron/electron/blob/master/docs/api/web-contents.md#contentssetzoomlevellevel
 */
export function zoomLevelToZoomFactor(zoomLevel = 0): number {
	return Math.pow(1.2, zoomLevel);
}
