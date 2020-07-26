/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event } from 'vs/base/common/event';
import { MessageBoxOptions, MessageBoxReturnValue, OpenDevToolsOptions, SaveDialogOptions, OpenDialogOptions, OpenDialogReturnValue, SaveDialogReturnValue, MouseInputEvent } from 'vs/base/parts/sandbox/common/electronTypes';
import { IOpenedWindow, IWindowOpenable, IOpenEmptyWindowOptions, IOpenWindowOptions } from 'vs/platform/windows/common/windows';
import { INativeOpenDialogOptions } from 'vs/platform/dialogs/common/dialogs';
import { ISerializableCommandAction } from 'vs/platform/actions/common/actions';

export interface ICommonElectronService {

	readonly _serviceBrand: undefined;

	// Properties
	readonly windowId: number;

	// Events
	readonly onWindowOpen: Event<number>;

	readonly onWindowMaximize: Event<number>;
	readonly onWindowUnmaximize: Event<number>;

	readonly onWindowFocus: Event<number>;
	readonly onWindowBlur: Event<number>;

	readonly onOSResume: Event<unknown>;

	// Window
	getWindows(): Promise<IOpenedWindow[]>;
	getWindowCount(): Promise<number>;
	getActiveWindowId(): Promise<number | undefined>;

	openWindow(options?: IOpenEmptyWindowOptions): Promise<void>;
	openWindow(toOpen: IWindowOpenable[], options?: IOpenWindowOptions): Promise<void>;

	toggleFullScreen(): Promise<void>;

	handleTitleDoubleClick(): Promise<void>;

	isMaximized(): Promise<boolean>;
	maximizeWindow(): Promise<void>;
	unmaximizeWindow(): Promise<void>;
	minimizeWindow(): Promise<void>;

	focusWindow(options?: { windowId?: number }): Promise<void>;

	// Dialogs
	showMessageBox(options: MessageBoxOptions): Promise<MessageBoxReturnValue>;
	showSaveDialog(options: SaveDialogOptions): Promise<SaveDialogReturnValue>;
	showOpenDialog(options: OpenDialogOptions): Promise<OpenDialogReturnValue>;

	pickFileFolderAndOpen(options: INativeOpenDialogOptions): Promise<void>;
	pickFileAndOpen(options: INativeOpenDialogOptions): Promise<void>;
	pickFolderAndOpen(options: INativeOpenDialogOptions): Promise<void>;
	pickWorkspaceAndOpen(options: INativeOpenDialogOptions): Promise<void>;

	// OS
	showItemInFolder(path: string): Promise<void>;
	setRepresentedFilename(path: string): Promise<void>;
	setDocumentEdited(edited: boolean): Promise<void>;
	openExternal(url: string): Promise<boolean>;
	updateTouchBar(items: ISerializableCommandAction[][]): Promise<void>;
	moveItemToTrash(fullPath: string, deleteOnFail?: boolean): Promise<boolean>;
	isAdmin(): Promise<boolean>;
	getTotalMem(): Promise<number>;

	// Process
	killProcess(pid: number, code: string): Promise<void>;

	// clipboard
	readClipboardText(type?: 'selection' | 'clipboard'): Promise<string>;
	writeClipboardText(text: string, type?: 'selection' | 'clipboard'): Promise<void>;
	readClipboardFindText(): Promise<string>;
	writeClipboardFindText(text: string): Promise<void>;
	writeClipboardBuffer(format: string, buffer: Uint8Array, type?: 'selection' | 'clipboard'): Promise<void>;
	readClipboardBuffer(format: string): Promise<Uint8Array>;
	hasClipboard(format: string, type?: 'selection' | 'clipboard'): Promise<boolean>;

	// macOS Touchbar
	newWindowTab(): Promise<void>;
	showPreviousWindowTab(): Promise<void>;
	showNextWindowTab(): Promise<void>;
	moveWindowTabToNewWindow(): Promise<void>;
	mergeAllWindowTabs(): Promise<void>;
	toggleWindowTabsBar(): Promise<void>;

	// Lifecycle
	notifyReady(): Promise<void>
	relaunch(options?: { addArgs?: string[], removeArgs?: string[] }): Promise<void>;
	reload(options?: { disableExtensions?: boolean }): Promise<void>;
	closeWindow(): Promise<void>;
	closeWindowById(windowId: number): Promise<void>;
	quit(): Promise<void>;
	exit(code: number): Promise<void>;

	// Development
	openDevTools(options?: OpenDevToolsOptions): Promise<void>;
	toggleDevTools(): Promise<void>;
	sendInputEvent(event: MouseInputEvent): Promise<void>;

	// Connectivity
	resolveProxy(url: string): Promise<string | undefined>;
}
