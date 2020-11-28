/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWindowOpenable, IOpenEmptyWindowOptions, INativeWindowConfiguration } from 'vs/platform/windows/common/windows';
import { OpenContext } from 'vs/platform/windows/node/window';
import { NativeParsedArgs } from 'vs/platform/environment/common/argv';
import { Event } from 'vs/base/common/event';
import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { IProcessEnvironment } from 'vs/base/common/platform';
import { IWorkspaceIdentifier } from 'vs/platform/workspaces/common/workspaces';
import { ISerializableCommandAction } from 'vs/platform/actions/common/actions';
import { URI } from 'vs/base/common/uri';
import { Rectangle, BrowserWindow, WebContents } from 'electron';
import { IDisposable } from 'vs/base/common/lifecycle';
import { CancellationToken } from 'vs/base/common/cancellation';

export interface IWindowState {
	width?: number;
	height?: number;
	x?: number;
	y?: number;
	mode?: WindowMode;
	display?: number;
}

export const enum WindowMode {
	Maximized,
	Normal,
	Minimized, // not used anymore, but also cannot remove due to existing stored UI state (needs migration)
	Fullscreen
}

export interface ICodeWindow extends IDisposable {

	readonly onLoad: Event<void>;
	readonly onReady: Event<void>;
	readonly onClose: Event<void>;
	readonly onDestroy: Event<void>;

	readonly whenClosedOrLoaded: Promise<void>;

	readonly id: number;
	readonly win: BrowserWindow;
	readonly config: INativeWindowConfiguration | undefined;

	readonly openedFolderUri?: URI;
	readonly openedWorkspace?: IWorkspaceIdentifier;
	readonly backupPath?: string;

	readonly remoteAuthority?: string;

	readonly isExtensionDevelopmentHost: boolean;
	readonly isExtensionTestHost: boolean;

	readonly lastFocusTime: number;

	readonly isReady: boolean;
	ready(): Promise<ICodeWindow>;
	setReady(): void;

	readonly hasHiddenTitleBarStyle: boolean;

	addTabbedWindow(window: ICodeWindow): void;

	load(config: INativeWindowConfiguration, isReload?: boolean): void;
	reload(cli?: NativeParsedArgs): void;

	focus(options?: { force: boolean }): void;
	close(): void;

	getBounds(): Rectangle;

	send(channel: string, ...args: any[]): void;
	sendWhenReady(channel: string, token: CancellationToken, ...args: any[]): void;

	readonly isFullScreen: boolean;
	toggleFullScreen(): void;

	isMinimized(): boolean;

	setRepresentedFilename(name: string): void;
	getRepresentedFilename(): string | undefined;

	setDocumentEdited(edited: boolean): void;
	isDocumentEdited(): boolean;

	handleTitleDoubleClick(): void;

	updateTouchBar(items: ISerializableCommandAction[][]): void;

	serializeWindowState(): IWindowState;
}

export const IWindowsMainService = createDecorator<IWindowsMainService>('windowsMainService');

export interface IWindowsCountChangedEvent {
	readonly oldCount: number;
	readonly newCount: number;
}

export interface IWindowsMainService {

	readonly _serviceBrand: undefined;

	readonly onWindowOpened: Event<ICodeWindow>;
	readonly onWindowReady: Event<ICodeWindow>;
	readonly onWindowsCountChanged: Event<IWindowsCountChangedEvent>;

	open(openConfig: IOpenConfiguration): ICodeWindow[];
	openEmptyWindow(openConfig: IOpenEmptyConfiguration, options?: IOpenEmptyWindowOptions): ICodeWindow[];
	openExtensionDevelopmentHostWindow(extensionDevelopmentPath: string[], openConfig: IOpenConfiguration): ICodeWindow[];

	sendToFocused(channel: string, ...args: any[]): void;
	sendToAll(channel: string, payload?: any, windowIdsToIgnore?: number[]): void;

	getFocusedWindow(): ICodeWindow | undefined;
	getLastActiveWindow(): ICodeWindow | undefined;

	getWindowById(windowId: number): ICodeWindow | undefined;
	getWindowByWebContents(webContents: WebContents): ICodeWindow | undefined;
	getWindows(): ICodeWindow[];
	getWindowCount(): number;
}

export interface IBaseOpenConfiguration {
	readonly context: OpenContext;
	readonly contextWindowId?: number;
}

export interface IOpenConfiguration extends IBaseOpenConfiguration {
	readonly cli: NativeParsedArgs;
	readonly userEnv?: IProcessEnvironment;
	readonly urisToOpen?: IWindowOpenable[];
	readonly waitMarkerFileURI?: URI;
	readonly preferNewWindow?: boolean;
	readonly forceNewWindow?: boolean;
	readonly forceNewTabbedWindow?: boolean;
	readonly forceReuseWindow?: boolean;
	readonly forceEmpty?: boolean;
	readonly diffMode?: boolean;
	addMode?: boolean;
	readonly gotoLineMode?: boolean;
	readonly initialStartup?: boolean;
	readonly noRecentEntry?: boolean;
}

export interface IOpenEmptyConfiguration extends IBaseOpenConfiguration { }
