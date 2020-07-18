/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { createDecorator } from 'vs/platform/instantiation/common/instantiation';
import { MessageBoxOptions, MessageBoxReturnValue, SaveDialogOptions, SaveDialogReturnValue, OpenDialogOptions, OpenDialogReturnValue, dialog, FileFilter, BrowserWindow } from 'electron';
import { Queue } from 'vs/base/common/async';
import { IStateService } from 'vs/platform/state/node/state';
import { isMacintosh } from 'vs/base/common/platform';
import { dirname } from 'vs/base/common/path';
import { normalizeNFC } from 'vs/base/common/normalization';
import { exists } from 'vs/base/node/pfs';
import { INativeOpenDialogOptions } from 'vs/platform/dialogs/common/dialogs';
import { withNullAsUndefined } from 'vs/base/common/types';
import { localize } from 'vs/nls';
import { WORKSPACE_FILTER } from 'vs/platform/workspaces/common/workspaces';
import { mnemonicButtonLabel } from 'vs/base/common/labels';

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

	private readonly mapWindowToDialogQueue: Map<number, Queue<void>>;
	private readonly noWindowDialogQueue: Queue<void>;

	constructor(
		@IStateService private readonly stateService: IStateService
	) {
		this.mapWindowToDialogQueue = new Map<number, Queue<void>>();
		this.noWindowDialogQueue = new Queue<void>();
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
		dialogOptions.defaultPath = options.defaultPath || this.stateService.getItem<string>(DialogMainService.workingDirPickerStorageKey);


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
			this.stateService.setItem(DialogMainService.workingDirPickerStorageKey, dirname(result.filePaths[0]));

			return result.filePaths;
		}

		return;
	}

	private getDialogQueue(window?: BrowserWindow): Queue<any> {
		if (!window) {
			return this.noWindowDialogQueue;
		}

		let windowDialogQueue = this.mapWindowToDialogQueue.get(window.id);
		if (!windowDialogQueue) {
			windowDialogQueue = new Queue<any>();
			this.mapWindowToDialogQueue.set(window.id, windowDialogQueue);
		}

		return windowDialogQueue;
	}

	showMessageBox(options: MessageBoxOptions, window?: BrowserWindow): Promise<MessageBoxReturnValue> {
		return this.getDialogQueue(window).queue(async () => {
			if (window) {
				return dialog.showMessageBox(window, options);
			}

			return dialog.showMessageBox(options);
		});
	}

	showSaveDialog(options: SaveDialogOptions, window?: BrowserWindow): Promise<SaveDialogReturnValue> {

		function normalizePath(path: string | undefined): string | undefined {
			if (path && isMacintosh) {
				path = normalizeNFC(path); // normalize paths returned from the OS
			}

			return path;
		}

		return this.getDialogQueue(window).queue(async () => {
			let result: SaveDialogReturnValue;
			if (window) {
				result = await dialog.showSaveDialog(window, options);
			} else {
				result = await dialog.showSaveDialog(options);
			}

			result.filePath = normalizePath(result.filePath);

			return result;
		});
	}

	showOpenDialog(options: OpenDialogOptions, window?: BrowserWindow): Promise<OpenDialogReturnValue> {

		function normalizePaths(paths: string[]): string[] {
			if (paths && paths.length > 0 && isMacintosh) {
				paths = paths.map(path => normalizeNFC(path)); // normalize paths returned from the OS
			}

			return paths;
		}

		return this.getDialogQueue(window).queue(async () => {

			// Ensure the path exists (if provided)
			if (options.defaultPath) {
				const pathExists = await exists(options.defaultPath);
				if (!pathExists) {
					options.defaultPath = undefined;
				}
			}

			// Show dialog
			let result: OpenDialogReturnValue;
			if (window) {
				result = await dialog.showOpenDialog(window, options);
			} else {
				result = await dialog.showOpenDialog(options);
			}

			result.filePaths = normalizePaths(result.filePaths);

			return result;
		});
	}
}
