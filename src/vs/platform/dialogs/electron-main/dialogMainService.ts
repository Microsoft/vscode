/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { MessageBoxOptions, MessageBoxReturnValue, SaveDialogOptions, SaveDialogReturnValue, OpenDialogOptions, OpenDialogReturnValue, dialog, FileFilter, BrowserWindow } from 'electron';
import { Queue } from 'vs/base/common/async';
import { IStateMainService } from 'vs/platform/state/electron-main/state';
import { isMacintosh } from 'vs/base/common/platform';
import { dirname } from 'vs/base/common/path';
import { normalizeNFC } from 'vs/base/common/normalization';
import { exists } from 'vs/base/node/pfs';
import { INativeOpenDialogOptions } from 'vs/platform/dialogs/common/dialogs';
import { withNullAsUndefined } from 'vs/base/common/types';
import { localize } from 'vs/nls';
import { WORKSPACE_FILTER } from 'vs/platform/workspaces/common/workspaces';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { Disposable, dispose, IDisposable, toDisposable } from 'vs/base/common/lifecycle';
import { hash } from 'vs/base/common/hash';

export const IDialogMainService = createDecorator<IDialogMainService>('dialogMainService');

export interface IDialogMainService {

	readonly _serviceBrand: undefined;

	pickFileFolder(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined>;
	pickFolder(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined>;
	pickFile(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined>;
	pickWorkspace(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined>;

	showMessageBox(options: MessageBoxOptions, window?: BrowserWindow): Promise<MessageBoxReturnValue>;
	showSaveDialog(options: SaveDialogOptions, window?: BrowserWindow): Promise<SaveDialogReturnValue>;
	showOpenDialog(options: OpenDialogOptions, window?: BrowserWindow): Promise<OpenDialogReturnValue>;
}

interface IInternalNativeOpenDialogOptions extends INativeOpenDialogOptions {
	pickFolders?: boolean;
	pickFiles?: boolean;

	title: string;
	buttonLabel?: string;
	filters?: FileFilter[];
}

export class DialogMainService implements IDialogMainService {

	declare readonly _serviceBrand: undefined;

	private static readonly workingDirPickerStorageKey = 'pickerWorkingDir';

	private readonly windowFileDialogLocks = new Map<number, Set<number>>();
	private readonly windowDialogQueues = new Map<number, Queue<MessageBoxReturnValue | SaveDialogReturnValue | OpenDialogReturnValue>>();
	private readonly noWindowDialogueQueue = new Queue<MessageBoxReturnValue | SaveDialogReturnValue | OpenDialogReturnValue>();

	constructor(
		@IStateMainService private readonly stateMainService: IStateMainService
	) {
	}

	pickFileFolder(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined> {
		return this.doPick({ ...options, pickFolders: true, pickFiles: true, title: localize('open', "Open") }, window);
	}

	pickFolder(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined> {
		return this.doPick({ ...options, pickFolders: true, title: localize('openFolder', "Open Folder") }, window);
	}

	pickFile(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined> {
		return this.doPick({ ...options, pickFiles: true, title: localize('openFile', "Open File") }, window);
	}

	pickWorkspace(options: INativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined> {
		const title = localize('openWorkspaceTitle', "Open Workspace");
		const buttonLabel = mnemonicButtonLabel(localize({ key: 'openWorkspace', comment: ['&& denotes a mnemonic'] }, "&&Open"));
		const filters = WORKSPACE_FILTER;

		return this.doPick({ ...options, pickFiles: true, title, filters, buttonLabel }, window);
	}

	private async doPick(options: IInternalNativeOpenDialogOptions, window?: BrowserWindow): Promise<string[] | undefined> {

		// Ensure dialog options
		const dialogOptions: OpenDialogOptions = {
			title: options.title,
			buttonLabel: options.buttonLabel,
			filters: options.filters
		};

		// Ensure defaultPath
		dialogOptions.defaultPath = options.defaultPath || this.stateMainService.getItem<string>(DialogMainService.workingDirPickerStorageKey);

		// Ensure properties
		if (typeof options.pickFiles === 'boolean' || typeof options.pickFolders === 'boolean') {
			dialogOptions.properties = undefined; // let it override based on the booleans

			if (options.pickFiles && options.pickFolders) {
				dialogOptions.properties = ['multiSelections', 'openDirectory', 'openFile', 'createDirectory'];
			}
		}

		if (!dialogOptions.properties) {
			dialogOptions.properties = ['multiSelections', options.pickFolders ? 'openDirectory' : 'openFile', 'createDirectory'];
		}

		if (isMacintosh) {
			dialogOptions.properties.push('treatPackageAsDirectory'); // always drill into .app files
		}

		// Show Dialog
		const windowToUse = window || BrowserWindow.getFocusedWindow();

		const result = await this.showOpenDialog(dialogOptions, withNullAsUndefined(windowToUse));
		if (result && result.filePaths && result.filePaths.length > 0) {

			// Remember path in storage for next time
			this.stateMainService.setItem(DialogMainService.workingDirPickerStorageKey, dirname(result.filePaths[0]));

			return result.filePaths;
		}

		return;
	}

	private getWindowDialogQueue<T extends MessageBoxReturnValue | SaveDialogReturnValue | OpenDialogReturnValue>(window?: BrowserWindow): Queue<T> {

		// Queue message box requests per window so that one can show
		// after the other.
		if (window) {
			let windowDialogQueue = this.windowDialogQueues.get(window.id);
			if (!windowDialogQueue) {
				windowDialogQueue = new Queue<MessageBoxReturnValue | SaveDialogReturnValue | OpenDialogReturnValue>();
				this.windowDialogQueues.set(window.id, windowDialogQueue);
			}

			return windowDialogQueue as unknown as Queue<T>;
		} else {
			return this.noWindowDialogueQueue as unknown as Queue<T>;
		}
	}

	showMessageBox(options: MessageBoxOptions, window?: BrowserWindow): Promise<MessageBoxReturnValue> {
		return this.getWindowDialogQueue<MessageBoxReturnValue>(window).queue(async () => {
			if (window) {
				return dialog.showMessageBox(window, options);
			}

			return dialog.showMessageBox(options);
		});
	}

	async showSaveDialog(options: SaveDialogOptions, window?: BrowserWindow): Promise<SaveDialogReturnValue> {

		// prevent duplicates of the same dialog queueing at the same time
		const fileDialogLock = this.acquireFileDialogLock(options, window);
		if (!fileDialogLock) {
			throw new Error('A file save dialog is already or will be showing for the window with the same configuration');
		}

		try {
			return await this.getWindowDialogQueue<SaveDialogReturnValue>(window).queue(async () => {
				let result: SaveDialogReturnValue;
				if (window) {
					result = await dialog.showSaveDialog(window, options);
				} else {
					result = await dialog.showSaveDialog(options);
				}

				result.filePath = this.normalizePath(result.filePath);

				return result;
			});
		} finally {
			dispose(fileDialogLock);
		}
	}

	private normalizePath(path: string): string;
	private normalizePath(path: string | undefined): string | undefined;
	private normalizePath(path: string | undefined): string | undefined {
		if (path && isMacintosh) {
			path = normalizeNFC(path); // macOS only: normalize paths to NFC form
		}

		return path;
	}

	private normalizePaths(paths: string[]): string[] {
		return paths.map(path => this.normalizePath(path));
	}

	async showOpenDialog(options: OpenDialogOptions, window?: BrowserWindow): Promise<OpenDialogReturnValue> {

		// Ensure the path exists (if provided)
		if (options.defaultPath) {
			const pathExists = await exists(options.defaultPath);
			if (!pathExists) {
				options.defaultPath = undefined;
			}
		}

		// prevent duplicates of the same dialog queueing at the same time
		const fileDialogLock = this.acquireFileDialogLock(options, window);
		if (!fileDialogLock) {
			throw new Error('A file open dialog is already or will be showing for the window with the same configuration');
		}

		try {
			return await this.getWindowDialogQueue<OpenDialogReturnValue>(window).queue(async () => {
				let result: OpenDialogReturnValue;
				if (window) {
					result = await dialog.showOpenDialog(window, options);
				} else {
					result = await dialog.showOpenDialog(options);
				}

				result.filePaths = this.normalizePaths(result.filePaths);

				return result;
			});
		} finally {
			dispose(fileDialogLock);
		}
	}

	private acquireFileDialogLock(options: SaveDialogOptions | OpenDialogOptions, window?: BrowserWindow): IDisposable | undefined {

		// if no window is provided, allow as many dialogs as
		// needed since we consider them not modal per window
		if (!window) {
			return Disposable.None;
		}

		// if a window is provided, only allow a single dialog
		// at the same time because dialogs are modal and we
		// do not want to open one dialog after the other
		// (https://github.com/microsoft/vscode/issues/114432)
		// we figure this out by `hashing` the configuration
		// options for the dialog to prevent duplicates

		let windowFileDialogLocks = this.windowFileDialogLocks.get(window.id);
		if (!windowFileDialogLocks) {
			windowFileDialogLocks = new Set();
			this.windowFileDialogLocks.set(window.id, windowFileDialogLocks);
		}

		const optionsHash = hash(options);
		if (windowFileDialogLocks.has(optionsHash)) {
			return undefined; // prevent duplicates, return
		}

		windowFileDialogLocks.add(optionsHash);

		return toDisposable(() => {
			windowFileDialogLocks?.delete(optionsHash);

			// if the window has no more dialog locks, delete it from the set of locks
			if (windowFileDialogLocks?.size === 0) {
				this.windowFileDialogLocks.delete(window.id);
			}
		});
	}
}
