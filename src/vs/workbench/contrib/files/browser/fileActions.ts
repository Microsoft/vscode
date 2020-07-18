/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { isWindows, isWeb } from 'vs/base/common/platform';
import * as extpath from 'vs/base/common/extpath';
import { extname, basename } from 'vs/base/common/path';
import * as resources from 'vs/base/common/resources';
import { URI } from 'vs/base/common/uri';
import { toErrorMessage } from 'vs/base/common/errorMessage';
import * as strings from 'vs/base/common/strings';
import { Action } from 'vs/base/common/actions';
import { dispose, IDisposable } from 'vs/base/common/lifecycle';
import { VIEWLET_ID, IExplorerService, IFilesConfiguration, VIEW_ID } from 'vs/workbench/contrib/files/common/files';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IFileService, IFileStatWithMetadata } from 'vs/platform/files/common/files';
import { toResource, SideBySideEditor } from 'vs/workbench/common/editor';
import { ExplorerViewPaneContainer } from 'vs/workbench/contrib/files/browser/explorerViewlet';
import { IQuickInputService, ItemActivation } from 'vs/platform/quickinput/common/quickInput';
import { IViewletService } from 'vs/workbench/services/viewlet/browser/viewlet';
import { IInstantiationService, ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { ITextModel } from 'vs/editor/common/model';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { REVEAL_IN_EXPLORER_COMMAND_ID, SAVE_ALL_COMMAND_ID, SAVE_ALL_LABEL, SAVE_ALL_IN_GROUP_COMMAND_ID } from 'vs/workbench/contrib/files/browser/fileCommands';
import { ITextModelService, ITextModelContentProvider } from 'vs/editor/common/services/resolverService';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { IClipboardService } from 'vs/platform/clipboard/common/clipboardService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { IModelService } from 'vs/editor/common/services/modelService';
import { ICommandService, CommandsRegistry } from 'vs/platform/commands/common/commands';
import { RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { Schemas } from 'vs/base/common/network';
import { IDialogService, IConfirmationResult, getFileNamesMessage, IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { Constants } from 'vs/base/common/uint';
import { CLOSE_EDITORS_AND_GROUP_COMMAND_ID } from 'vs/workbench/browser/parts/editor/editorCommands';
import { coalesce } from 'vs/base/common/arrays';
import { ExplorerItem, NewExplorerItem } from 'vs/workbench/contrib/files/common/explorerModel';
import { getErrorMessage } from 'vs/base/common/errors';
import { triggerDownload, asDomUri } from 'vs/base/browser/dom';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IWorkingCopyService, IWorkingCopy } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { sequence, timeout } from 'vs/base/common/async';
import { IWorkingCopyFileService } from 'vs/workbench/services/workingCopy/common/workingCopyFileService';
import { once } from 'vs/base/common/functional';
import { Codicon } from 'vs/base/common/codicons';
import { IViewsService } from 'vs/workbench/common/views';

export const NEW_FILE_COMMAND_ID = 'explorer.newFile';
export const NEW_FILE_LABEL = nls.localize('newFile', "New File");

export const NEW_FOLDER_COMMAND_ID = 'explorer.newFolder';
export const NEW_FOLDER_LABEL = nls.localize('newFolder', "New Folder");

export const TRIGGER_RENAME_LABEL = nls.localize('rename', "Rename");

export const MOVE_FILE_TO_TRASH_LABEL = nls.localize('delete', "Delete");

export const COPY_FILE_LABEL = nls.localize('copyFile', "Copy");

export const PASTE_FILE_LABEL = nls.localize('pasteFile', "Paste");

export const FileCopiedContext = new RawContextKey<boolean>('fileCopied', false);

export const DOWNLOAD_LABEL = nls.localize('download', "Download");

const CONFIRM_DELETE_SETTING_KEY = 'explorer.confirmDelete';

function onError(notificationService: INotificationService, error: any): void {
	if (error.message === 'string') {
		error = error.message;
	}

	notificationService.error(toErrorMessage(error, false));
}

async function refreshIfSeparator(value: string, explorerService: IExplorerService): Promise<void> {
	if (value && ((value.indexOf('/') >= 0) || (value.indexOf('\\') >= 0))) {
		// New input contains separator, multiple resources will get created workaround for #68204
		await explorerService.refresh();
	}
}

/* New File */
export class NewFileAction extends Action {
	static readonly ID = 'workbench.files.action.createFileFromExplorer';
	static readonly LABEL = nls.localize('createNewFile', "New File");

	constructor(
		@ICommandService private commandService: ICommandService
	) {
		super('explorer.newFile', NEW_FILE_LABEL);
		this.class = 'explorer-action ' + Codicon.newFile.classNames;
	}

	run(): Promise<void> {
		return this.commandService.executeCommand(NEW_FILE_COMMAND_ID);
	}
}

/* New Folder */
export class NewFolderAction extends Action {
	static readonly ID = 'workbench.files.action.createFolderFromExplorer';
	static readonly LABEL = nls.localize('createNewFolder', "New Folder");

	constructor(
		@ICommandService private commandService: ICommandService
	) {
		super('explorer.newFolder', NEW_FOLDER_LABEL);
		this.class = 'explorer-action ' + Codicon.newFolder.classNames;
	}

	run(): Promise<void> {
		return this.commandService.executeCommand(NEW_FOLDER_COMMAND_ID);
	}
}

async function deleteFiles(workingCopyFileService: IWorkingCopyFileService, dialogService: IDialogService, configurationService: IConfigurationService, elements: ExplorerItem[], useTrash: boolean, skipConfirm = false): Promise<void> {
	let primaryButton: string;
	if (useTrash) {
		primaryButton = isWindows ? nls.localize('deleteButtonLabelRecycleBin', "&&Move to Recycle Bin") : nls.localize({ key: 'deleteButtonLabelTrash', comment: ['&& denotes a mnemonic'] }, "&&Move to Trash");
	} else {
		primaryButton = nls.localize({ key: 'deleteButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Delete");
	}

	// Handle dirty
	const distinctElements = resources.distinctParents(elements, e => e.resource);
	const dirtyWorkingCopies = new Set<IWorkingCopy>();
	for (const distinctElement of distinctElements) {
		for (const dirtyWorkingCopy of workingCopyFileService.getDirty(distinctElement.resource)) {
			dirtyWorkingCopies.add(dirtyWorkingCopy);
		}
	}
	let confirmed = true;
	if (dirtyWorkingCopies.size) {
		let message: string;
		if (distinctElements.length > 1) {
			message = nls.localize('dirtyMessageFilesDelete', "You are deleting files with unsaved changes. Do you want to continue?");
		} else if (distinctElements[0].isDirectory) {
			if (dirtyWorkingCopies.size === 1) {
				message = nls.localize('dirtyMessageFolderOneDelete', "You are deleting a folder {0} with unsaved changes in 1 file. Do you want to continue?", distinctElements[0].name);
			} else {
				message = nls.localize('dirtyMessageFolderDelete', "You are deleting a folder {0} with unsaved changes in {1} files. Do you want to continue?", distinctElements[0].name, dirtyWorkingCopies.size);
			}
		} else {
			message = nls.localize('dirtyMessageFileDelete', "You are deleting {0} with unsaved changes. Do you want to continue?", distinctElements[0].name);
		}

		const response = await dialogService.confirm({
			message,
			type: 'warning',
			detail: nls.localize('dirtyWarning', "Your changes will be lost if you don't save them."),
			primaryButton
		});

		if (!response.confirmed) {
			confirmed = false;
		} else {
			skipConfirm = true;
		}
	}

	// Check if file is dirty in editor and save it to avoid data loss
	if (!confirmed) {
		return;
	}

	let confirmation: IConfirmationResult;

	// Check if we need to ask for confirmation at all
	if (skipConfirm || (useTrash && configurationService.getValue<boolean>(CONFIRM_DELETE_SETTING_KEY) === false)) {
		confirmation = { confirmed: true };
	}

	// Confirm for moving to trash
	else if (useTrash) {
		let { message, detail } = getMoveToTrashMessage(distinctElements);
		detail += detail ? '\n' : '';
		if (isWindows) {
			detail += distinctElements.length > 1 ? nls.localize('undoBinFiles', "You can restore these files from the Recycle Bin.") : nls.localize('undoBin', "You can restore this file from the Recycle Bin.");
		} else {
			detail += distinctElements.length > 1 ? nls.localize('undoTrashFiles', "You can restore these files from the Trash.") : nls.localize('undoTrash', "You can restore this file from the Trash.");
		}

		confirmation = await dialogService.confirm({
			message,
			detail,
			primaryButton,
			checkbox: {
				label: nls.localize('doNotAskAgain', "Do not ask me again")
			},
			type: 'question'
		});
	}

	// Confirm for deleting permanently
	else {
		let { message, detail } = getDeleteMessage(distinctElements);
		detail += detail ? '\n' : '';
		detail += nls.localize('irreversible', "This action is irreversible!");
		confirmation = await dialogService.confirm({
			message,
			detail,
			primaryButton,
			type: 'warning'
		});
	}

	// Check for confirmation checkbox
	if (confirmation.confirmed && confirmation.checkboxChecked === true) {
		await configurationService.updateValue(CONFIRM_DELETE_SETTING_KEY, false, ConfigurationTarget.USER);
	}

	// Check for confirmation
	if (!confirmation.confirmed) {
		return;
	}

	// Call function
	try {
		await workingCopyFileService.delete(distinctElements.map(e => e.resource), { useTrash, recursive: true });
	} catch (error) {

		// Handle error to delete file(s) from a modal confirmation dialog
		let errorMessage: string;
		let detailMessage: string | undefined;
		let primaryButton: string;
		if (useTrash) {
			errorMessage = isWindows ? nls.localize('binFailed', "Failed to delete using the Recycle Bin. Do you want to permanently delete instead?") : nls.localize('trashFailed', "Failed to delete using the Trash. Do you want to permanently delete instead?");
			detailMessage = nls.localize('irreversible', "This action is irreversible!");
			primaryButton = nls.localize({ key: 'deletePermanentlyButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Delete Permanently");
		} else {
			errorMessage = toErrorMessage(error, false);
			primaryButton = nls.localize({ key: 'retryButtonLabel', comment: ['&& denotes a mnemonic'] }, "&&Retry");
		}

		const res = await dialogService.confirm({
			message: errorMessage,
			detail: detailMessage,
			type: 'warning',
			primaryButton
		});

		if (res.confirmed) {
			if (useTrash) {
				useTrash = false; // Delete Permanently
			}

			skipConfirm = true;

			return deleteFiles(workingCopyFileService, dialogService, configurationService, elements, useTrash, skipConfirm);
		}
	}
}

function getMoveToTrashMessage(distinctElements: ExplorerItem[]): { message: string, detail: string } {
	if (containsBothDirectoryAndFile(distinctElements)) {
		return {
			message: nls.localize('confirmMoveTrashMessageFilesAndDirectories', "Are you sure you want to delete the following {0} files/directories and their contents?", distinctElements.length),
			detail: getFileNamesMessage(distinctElements.map(e => e.resource))
		};
	}

	if (distinctElements.length > 1) {
		if (distinctElements[0].isDirectory) {
			return {
				message: nls.localize('confirmMoveTrashMessageMultipleDirectories', "Are you sure you want to delete the following {0} directories and their contents?", distinctElements.length),
				detail: getFileNamesMessage(distinctElements.map(e => e.resource))
			};
		}

		return {
			message: nls.localize('confirmMoveTrashMessageMultiple', "Are you sure you want to delete the following {0} files?", distinctElements.length),
			detail: getFileNamesMessage(distinctElements.map(e => e.resource))
		};
	}

	if (distinctElements[0].isDirectory) {
		return { message: nls.localize('confirmMoveTrashMessageFolder', "Are you sure you want to delete '{0}' and its contents?", distinctElements[0].name), detail: '' };
	}

	return { message: nls.localize('confirmMoveTrashMessageFile', "Are you sure you want to delete '{0}'?", distinctElements[0].name), detail: '' };
}

function getDeleteMessage(distinctElements: ExplorerItem[]): { message: string, detail: string } {
	if (containsBothDirectoryAndFile(distinctElements)) {
		return {
			message: nls.localize('confirmDeleteMessageFilesAndDirectories', "Are you sure you want to permanently delete the following {0} files/directories and their contents?", distinctElements.length),
			detail: getFileNamesMessage(distinctElements.map(e => e.resource))
		};
	}

	if (distinctElements.length > 1) {
		if (distinctElements[0].isDirectory) {
			return {
				message: nls.localize('confirmDeleteMessageMultipleDirectories', "Are you sure you want to permanently delete the following {0} directories and their contents?", distinctElements.length),
				detail: getFileNamesMessage(distinctElements.map(e => e.resource))
			};
		}

		return {
			message: nls.localize('confirmDeleteMessageMultiple', "Are you sure you want to permanently delete the following {0} files?", distinctElements.length),
			detail: getFileNamesMessage(distinctElements.map(e => e.resource))
		};
	}

	if (distinctElements[0].isDirectory) {
		return { message: nls.localize('confirmDeleteMessageFolder', "Are you sure you want to permanently delete '{0}' and its contents?", distinctElements[0].name), detail: '' };
	}

	return { message: nls.localize('confirmDeleteMessageFile', "Are you sure you want to permanently delete '{0}'?", distinctElements[0].name), detail: '' };
}

function containsBothDirectoryAndFile(distinctElements: ExplorerItem[]): boolean {
	const directory = distinctElements.find(element => element.isDirectory);
	const file = distinctElements.find(element => !element.isDirectory);

	return !!directory && !!file;
}


export function findValidPasteFileTarget(explorerService: IExplorerService, targetFolder: ExplorerItem, fileToPaste: { resource: URI, isDirectory?: boolean, allowOverwrite: boolean }, incrementalNaming: 'simple' | 'smart'): URI {
	let name = resources.basenameOrAuthority(fileToPaste.resource);

	let candidate = resources.joinPath(targetFolder.resource, name);
	while (true && !fileToPaste.allowOverwrite) {
		if (!explorerService.findClosest(candidate)) {
			break;
		}

		name = incrementFileName(name, !!fileToPaste.isDirectory, incrementalNaming);
		candidate = resources.joinPath(targetFolder.resource, name);
	}

	return candidate;
}

export function incrementFileName(name: string, isFolder: boolean, incrementalNaming: 'simple' | 'smart'): string {
	if (incrementalNaming === 'simple') {
		let namePrefix = name;
		let extSuffix = '';
		if (!isFolder) {
			extSuffix = extname(name);
			namePrefix = basename(name, extSuffix);
		}

		// name copy 5(.txt) => name copy 6(.txt)
		// name copy(.txt) => name copy 2(.txt)
		const suffixRegex = /^(.+ copy)( \d+)?$/;
		if (suffixRegex.test(namePrefix)) {
			return namePrefix.replace(suffixRegex, (match, g1?, g2?) => {
				let number = (g2 ? parseInt(g2) : 1);
				return number === 0
					? `${g1}`
					: (number < Constants.MAX_SAFE_SMALL_INTEGER
						? `${g1} ${number + 1}`
						: `${g1}${g2} copy`);
			}) + extSuffix;
		}

		// name(.txt) => name copy(.txt)
		return `${namePrefix} copy${extSuffix}`;
	}

	const separators = '[\\.\\-_]';
	const maxNumber = Constants.MAX_SAFE_SMALL_INTEGER;

	// file.1.txt=>file.2.txt
	let suffixFileRegex = RegExp('(.*' + separators + ')(\\d+)(\\..*)$');
	if (!isFolder && name.match(suffixFileRegex)) {
		return name.replace(suffixFileRegex, (match, g1?, g2?, g3?) => {
			let number = parseInt(g2);
			return number < maxNumber
				? g1 + strings.pad(number + 1, g2.length) + g3
				: strings.format('{0}{1}.1{2}', g1, g2, g3);
		});
	}

	// 1.file.txt=>2.file.txt
	let prefixFileRegex = RegExp('(\\d+)(' + separators + '.*)(\\..*)$');
	if (!isFolder && name.match(prefixFileRegex)) {
		return name.replace(prefixFileRegex, (match, g1?, g2?, g3?) => {
			let number = parseInt(g1);
			return number < maxNumber
				? strings.pad(number + 1, g1.length) + g2 + g3
				: strings.format('{0}{1}.1{2}', g1, g2, g3);
		});
	}

	// 1.txt=>2.txt
	let prefixFileNoNameRegex = RegExp('(\\d+)(\\..*)$');
	if (!isFolder && name.match(prefixFileNoNameRegex)) {
		return name.replace(prefixFileNoNameRegex, (match, g1?, g2?) => {
			let number = parseInt(g1);
			return number < maxNumber
				? strings.pad(number + 1, g1.length) + g2
				: strings.format('{0}.1{1}', g1, g2);
		});
	}

	// file.txt=>file.1.txt
	const lastIndexOfDot = name.lastIndexOf('.');
	if (!isFolder && lastIndexOfDot >= 0) {
		return strings.format('{0}.1{1}', name.substr(0, lastIndexOfDot), name.substr(lastIndexOfDot));
	}

	// folder.1=>folder.2
	if (isFolder && name.match(/(\d+)$/)) {
		return name.replace(/(\d+)$/, (match, ...groups) => {
			let number = parseInt(groups[0]);
			return number < maxNumber
				? strings.pad(number + 1, groups[0].length)
				: strings.format('{0}.1', groups[0]);
		});
	}

	// 1.folder=>2.folder
	if (isFolder && name.match(/^(\d+)/)) {
		return name.replace(/^(\d+)(.*)$/, (match, ...groups) => {
			let number = parseInt(groups[0]);
			return number < maxNumber
				? strings.pad(number + 1, groups[0].length) + groups[1]
				: strings.format('{0}{1}.1', groups[0], groups[1]);
		});
	}

	// file/folder=>file.1/folder.1
	return strings.format('{0}.1', name);
}

// Global Compare with
export class GlobalCompareResourcesAction extends Action {

	static readonly ID = 'workbench.files.action.compareFileWith';
	static readonly LABEL = nls.localize('globalCompareFile', "Compare Active File With...");

	constructor(
		id: string,
		label: string,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@ITextModelService private readonly textModelService: ITextModelService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		const activeInput = this.editorService.activeEditor;
		const activeResource = activeInput ? activeInput.resource : undefined;
		if (activeResource && this.textModelService.canHandleResource(activeResource)) {

			// Compare with next editor that opens
			const toDispose = this.editorService.overrideOpenEditor({
				open: editor => {

					// Only once!
					toDispose.dispose();

					// Open editor as diff
					const resource = editor.resource;
					if (resource && this.textModelService.canHandleResource(resource)) {
						return {
							override: this.editorService.openEditor({
								leftResource: activeResource,
								rightResource: resource,
								options: { override: false }
							})
						};
					}

					// Otherwise stay on current resource
					this.notificationService.info(nls.localize('fileToCompareNoFile', "Please select a file to compare with."));
					return {
						override: this.editorService.openEditor({
							resource: activeResource,
							options: { override: false }
						})
					};
				}
			});

			once(this.quickInputService.onHide)((async () => {
				await timeout(0); // prevent race condition with editor
				toDispose.dispose();
			}));

			// Bring up quick access
			this.quickInputService.quickAccess.show('', { itemActivation: ItemActivation.SECOND });
		} else {
			this.notificationService.info(nls.localize('openFileToCompare', "Open a file first to compare it with another file."));
		}
	}
}

export class ToggleAutoSaveAction extends Action {
	static readonly ID = 'workbench.action.toggleAutoSave';
	static readonly LABEL = nls.localize('toggleAutoSave', "Toggle Auto Save");

	constructor(
		id: string,
		label: string,
		@IFilesConfigurationService private readonly filesConfigurationService: IFilesConfigurationService
	) {
		super(id, label);
	}

	run(): Promise<void> {
		return this.filesConfigurationService.toggleAutoSave();
	}
}

export abstract class BaseSaveAllAction extends Action {
	private lastDirtyState: boolean;

	constructor(
		id: string,
		label: string,
		@ICommandService protected commandService: ICommandService,
		@INotificationService private notificationService: INotificationService,
		@IWorkingCopyService private readonly workingCopyService: IWorkingCopyService
	) {
		super(id, label);

		this.lastDirtyState = this.workingCopyService.hasDirty;
		this.enabled = this.lastDirtyState;

		this.registerListeners();
	}

	protected abstract doRun(context: unknown): Promise<void>;

	private registerListeners(): void {

		// update enablement based on working copy changes
		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => this.updateEnablement(workingCopy)));
	}

	private updateEnablement(workingCopy: IWorkingCopy): void {
		const hasDirty = workingCopy.isDirty() || this.workingCopyService.hasDirty;
		if (this.lastDirtyState !== hasDirty) {
			this.enabled = hasDirty;
			this.lastDirtyState = this.enabled;
		}
	}

	async run(context?: unknown): Promise<void> {
		try {
			await this.doRun(context);
		} catch (error) {
			onError(this.notificationService, error);
		}
	}
}

export class SaveAllAction extends BaseSaveAllAction {

	static readonly ID = 'workbench.action.files.saveAll';
	static readonly LABEL = SAVE_ALL_LABEL;

	get class(): string {
		return 'explorer-action ' + Codicon.saveAll.classNames;
	}

	protected doRun(): Promise<void> {
		return this.commandService.executeCommand(SAVE_ALL_COMMAND_ID);
	}
}

export class SaveAllInGroupAction extends BaseSaveAllAction {

	static readonly ID = 'workbench.files.action.saveAllInGroup';
	static readonly LABEL = nls.localize('saveAllInGroup', "Save All in Group");

	get class(): string {
		return 'explorer-action ' + Codicon.saveAll.classNames;
	}

	protected doRun(context: unknown): Promise<void> {
		return this.commandService.executeCommand(SAVE_ALL_IN_GROUP_COMMAND_ID, {}, context);
	}
}

export class CloseGroupAction extends Action {

	static readonly ID = 'workbench.files.action.closeGroup';
	static readonly LABEL = nls.localize('closeGroup', "Close Group");

	constructor(id: string, label: string, @ICommandService private readonly commandService: ICommandService) {
		super(id, label, Codicon.closeAll.classNames);
	}

	run(context?: unknown): Promise<void> {
		return this.commandService.executeCommand(CLOSE_EDITORS_AND_GROUP_COMMAND_ID, {}, context);
	}
}

export class FocusFilesExplorer extends Action {

	static readonly ID = 'workbench.files.action.focusFilesExplorer';
	static readonly LABEL = nls.localize('focusFilesExplorer', "Focus on Files Explorer");

	constructor(
		id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		await this.viewletService.openViewlet(VIEWLET_ID, true);
	}
}

export class ShowActiveFileInExplorer extends Action {

	static readonly ID = 'workbench.files.action.showActiveFileInExplorer';
	static readonly LABEL = nls.localize('showInExplorer', "Reveal Active File in Side Bar");

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		const resource = toResource(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (resource) {
			this.commandService.executeCommand(REVEAL_IN_EXPLORER_COMMAND_ID, resource);
		} else {
			this.notificationService.info(nls.localize('openFileToShow', "Open a file first to show it in the explorer"));
		}
	}
}

export class CollapseExplorerView extends Action {

	static readonly ID = 'workbench.files.action.collapseExplorerFolders';
	static readonly LABEL = nls.localize('collapseExplorerFolders', "Collapse Folders in Explorer");

	constructor(id: string,
		label: string,
		@IViewletService private readonly viewletService: IViewletService,
		@IExplorerService readonly explorerService: IExplorerService
	) {
		super(id, label, 'explorer-action ' + Codicon.collapseAll.classNames);
	}

	async run(): Promise<void> {
		const explorerViewlet = (await this.viewletService.openViewlet(VIEWLET_ID))?.getViewPaneContainer() as ExplorerViewPaneContainer;
		const explorerView = explorerViewlet.getExplorerView();
		if (explorerView) {
			explorerView.collapseAll();
		}
	}
}

export class RefreshExplorerView extends Action {

	static readonly ID = 'workbench.files.action.refreshFilesExplorer';
	static readonly LABEL = nls.localize('refreshExplorer', "Refresh Explorer");


	constructor(
		id: string, label: string,
		@IViewletService private readonly viewletService: IViewletService,
		@IExplorerService private readonly explorerService: IExplorerService
	) {
		super(id, label, 'explorer-action ' + Codicon.refresh.classNames);
	}

	async run(): Promise<void> {
		await this.viewletService.openViewlet(VIEWLET_ID);
		await this.explorerService.refresh();
	}
}

export class ShowOpenedFileInNewWindow extends Action {

	static readonly ID = 'workbench.action.files.showOpenedFileInNewWindow';
	static readonly LABEL = nls.localize('openFileInNewWindow', "Open Active File in New Window");

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService,
		@IHostService private readonly hostService: IHostService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileService private readonly fileService: IFileService
	) {
		super(id, label);
	}

	async run(): Promise<void> {
		const fileResource = toResource(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		if (fileResource) {
			if (this.fileService.canHandleResource(fileResource)) {
				this.hostService.openWindow([{ fileUri: fileResource }], { forceNewWindow: true });
			} else {
				this.notificationService.info(nls.localize('openFileToShowInNewWindow.unsupportedschema', "The active editor must contain an openable resource."));
			}
		} else {
			this.notificationService.info(nls.localize('openFileToShowInNewWindow.nofile', "Open a file first to open in new window"));
		}
	}
}

export function validateFileName(item: ExplorerItem, name: string): { content: string, severity: Severity } | null {
	// Produce a well formed file name
	name = getWellFormedFileName(name);

	// Name not provided
	if (!name || name.length === 0 || /^\s+$/.test(name)) {
		return {
			content: nls.localize('emptyFileNameError', "A file or folder name must be provided."),
			severity: Severity.Error
		};
	}

	// Relative paths only
	if (name[0] === '/' || name[0] === '\\') {
		return {
			content: nls.localize('fileNameStartsWithSlashError', "A file or folder name cannot start with a slash."),
			severity: Severity.Error
		};
	}

	const names = coalesce(name.split(/[\\/]/));
	const parent = item.parent;

	if (name !== item.name) {
		// Do not allow to overwrite existing file
		const child = parent?.getChild(name);
		if (child && child !== item) {
			return {
				content: nls.localize('fileNameExistsError', "A file or folder **{0}** already exists at this location. Please choose a different name.", name),
				severity: Severity.Error
			};
		}
	}

	// Invalid File name
	const windowsBasenameValidity = item.resource.scheme === Schemas.file && isWindows;
	if (names.some((folderName) => !extpath.isValidBasename(folderName, windowsBasenameValidity))) {
		return {
			content: nls.localize('invalidFileNameError', "The name **{0}** is not valid as a file or folder name. Please choose a different name.", trimLongName(name)),
			severity: Severity.Error
		};
	}

	if (names.some(name => /^\s|\s$/.test(name))) {
		return {
			content: nls.localize('fileNameWhitespaceWarning', "Leading or trailing whitespace detected in file or folder name."),
			severity: Severity.Warning
		};
	}

	return null;
}

function trimLongName(name: string): string {
	if (name?.length > 255) {
		return `${name.substr(0, 255)}...`;
	}

	return name;
}

export function getWellFormedFileName(filename: string): string {
	if (!filename) {
		return filename;
	}

	// Trim tabs
	filename = strings.trim(filename, '\t');

	// Remove trailing dots and slashes
	filename = strings.rtrim(filename, '.');
	filename = strings.rtrim(filename, '/');
	filename = strings.rtrim(filename, '\\');

	return filename;
}

export class CompareWithClipboardAction extends Action {

	static readonly ID = 'workbench.files.action.compareWithClipboard';
	static readonly LABEL = nls.localize('compareWithClipboard', "Compare Active File with Clipboard");

	private registrationDisposal: IDisposable | undefined;
	private static SCHEME_COUNTER = 0;

	constructor(
		id: string,
		label: string,
		@IEditorService private readonly editorService: IEditorService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IFileService private readonly fileService: IFileService
	) {
		super(id, label);

		this.enabled = true;
	}

	async run(): Promise<void> {
		const resource = toResource(this.editorService.activeEditor, { supportSideBySide: SideBySideEditor.PRIMARY });
		const scheme = `clipboardCompare${CompareWithClipboardAction.SCHEME_COUNTER++}`;
		if (resource && (this.fileService.canHandleResource(resource) || resource.scheme === Schemas.untitled)) {
			if (!this.registrationDisposal) {
				const provider = this.instantiationService.createInstance(ClipboardContentProvider);
				this.registrationDisposal = this.textModelService.registerTextModelContentProvider(scheme, provider);
			}

			const name = resources.basename(resource);
			const editorLabel = nls.localize('clipboardComparisonLabel', "Clipboard ↔ {0}", name);

			await this.editorService.openEditor({ leftResource: resource.with({ scheme }), rightResource: resource, label: editorLabel }).finally(() => {
				dispose(this.registrationDisposal);
				this.registrationDisposal = undefined;
			});
		}
	}

	dispose(): void {
		super.dispose();

		dispose(this.registrationDisposal);
		this.registrationDisposal = undefined;
	}
}

class ClipboardContentProvider implements ITextModelContentProvider {
	constructor(
		@IClipboardService private readonly clipboardService: IClipboardService,
		@IModeService private readonly modeService: IModeService,
		@IModelService private readonly modelService: IModelService
	) { }

	async provideTextContent(resource: URI): Promise<ITextModel> {
		const text = await this.clipboardService.readText();
		const model = this.modelService.createModel(text, this.modeService.createByFilepathOrFirstLine(resource), resource);

		return model;
	}
}

function onErrorWithRetry(notificationService: INotificationService, error: unknown, retry: () => Promise<unknown>): void {
	notificationService.prompt(Severity.Error, toErrorMessage(error, false),
		[{
			label: nls.localize('retry', "Retry"),
			run: () => retry()
		}]
	);
}

async function openExplorerAndCreate(accessor: ServicesAccessor, isFolder: boolean): Promise<void> {
	const explorerService = accessor.get(IExplorerService);
	const fileService = accessor.get(IFileService);
	const textFileService = accessor.get(ITextFileService);
	const editorService = accessor.get(IEditorService);
	const viewsService = accessor.get(IViewsService);
	const notificationService = accessor.get(INotificationService);

	await viewsService.openView(VIEW_ID, true);

	const stats = explorerService.getContext(false);
	const stat = stats.length > 0 ? stats[0] : undefined;
	let folder: ExplorerItem;
	if (stat) {
		folder = stat.isDirectory ? stat : (stat.parent || explorerService.roots[0]);
	} else {
		folder = explorerService.roots[0];
	}

	if (folder.isReadonly) {
		throw new Error('Parent folder is readonly.');
	}

	const newStat = new NewExplorerItem(fileService, folder, isFolder);
	folder.addChild(newStat);

	const onSuccess = async (value: string): Promise<void> => {
		try {
			const created = isFolder ? await fileService.createFolder(resources.joinPath(folder.resource, value)) : await textFileService.create(resources.joinPath(folder.resource, value));
			await refreshIfSeparator(value, explorerService);

			isFolder ?
				await explorerService.select(created.resource, true) :
				await editorService.openEditor({ resource: created.resource, options: { pinned: true } });
		} catch (error) {
			onErrorWithRetry(notificationService, error, () => onSuccess(value));
		}
	};

	await explorerService.setEditable(newStat, {
		validationMessage: value => validateFileName(newStat, value),
		onFinish: async (value, success) => {
			folder.removeChild(newStat);
			await explorerService.setEditable(newStat, null);
			if (success) {
				onSuccess(value);
			}
		}
	});
}

CommandsRegistry.registerCommand({
	id: NEW_FILE_COMMAND_ID,
	handler: async (accessor) => {
		await openExplorerAndCreate(accessor, false);
	}
});

CommandsRegistry.registerCommand({
	id: NEW_FOLDER_COMMAND_ID,
	handler: async (accessor) => {
		await openExplorerAndCreate(accessor, true);
	}
});

export const renameHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const workingCopyFileService = accessor.get(IWorkingCopyFileService);
	const notificationService = accessor.get(INotificationService);

	const stats = explorerService.getContext(false);
	const stat = stats.length > 0 ? stats[0] : undefined;
	if (!stat) {
		return;
	}

	await explorerService.setEditable(stat, {
		validationMessage: value => validateFileName(stat, value),
		onFinish: async (value, success) => {
			if (success) {
				const parentResource = stat.parent!.resource;
				const targetResource = resources.joinPath(parentResource, value);
				if (stat.resource.toString() !== targetResource.toString()) {
					try {
						await workingCopyFileService.move([{ source: stat.resource, target: targetResource }]);
						await refreshIfSeparator(value, explorerService);
					} catch (e) {
						notificationService.error(e);
					}
				}
			}
			await explorerService.setEditable(stat, null);
		}
	});
};

export const moveFileToTrashHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true).filter(s => !s.isRoot);
	if (stats.length) {
		await deleteFiles(accessor.get(IWorkingCopyFileService), accessor.get(IDialogService), accessor.get(IConfigurationService), stats, true);
	}
};

export const deleteFileHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true).filter(s => !s.isRoot);

	if (stats.length) {
		await deleteFiles(accessor.get(IWorkingCopyFileService), accessor.get(IDialogService), accessor.get(IConfigurationService), stats, false);
	}
};

let pasteShouldMove = false;
export const copyFileHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);
	if (stats.length > 0) {
		await explorerService.setToCopy(stats, false);
		pasteShouldMove = false;
	}
};

export const cutFileHandler = async (accessor: ServicesAccessor) => {
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);
	if (stats.length > 0) {
		await explorerService.setToCopy(stats, true);
		pasteShouldMove = true;
	}
};

export const DOWNLOAD_COMMAND_ID = 'explorer.download';
const downloadFileHandler = (accessor: ServicesAccessor) => {
	const fileService = accessor.get(IFileService);
	const workingCopyFileService = accessor.get(IWorkingCopyFileService);
	const fileDialogService = accessor.get(IFileDialogService);
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);

	let canceled = false;
	sequence(stats.map(s => async () => {
		if (canceled) {
			return;
		}

		if (isWeb) {
			if (!s.isDirectory) {
				let bufferOrUri: Uint8Array | URI;
				try {
					bufferOrUri = (await fileService.readFile(s.resource, { limits: { size: 1024 * 1024  /* set a limit to reduce memory pressure */ } })).value.buffer;
				} catch (error) {
					bufferOrUri = asDomUri(s.resource);
				}

				triggerDownload(bufferOrUri, s.name);
			}
		} else {
			let defaultUri = s.isDirectory ? fileDialogService.defaultFolderPath(Schemas.file) : fileDialogService.defaultFilePath(Schemas.file);
			if (defaultUri) {
				defaultUri = resources.joinPath(defaultUri, s.name);
			}

			const destination = await fileDialogService.showSaveDialog({
				availableFileSystems: [Schemas.file],
				saveLabel: mnemonicButtonLabel(nls.localize('download', "Download")),
				title: s.isDirectory ? nls.localize('downloadFolder', "Download Folder") : nls.localize('downloadFile', "Download File"),
				defaultUri
			});
			if (destination) {
				await workingCopyFileService.copy([{ source: s.resource, target: destination }], { overwrite: true });
			} else {
				// User canceled a download. In case there were multiple files selected we should cancel the remainder of the prompts #86100
				canceled = true;
			}
		}
	}));
};

CommandsRegistry.registerCommand({
	id: DOWNLOAD_COMMAND_ID,
	handler: downloadFileHandler
});

export const pasteFileHandler = async (accessor: ServicesAccessor) => {
	const clipboardService = accessor.get(IClipboardService);
	const explorerService = accessor.get(IExplorerService);
	const fileService = accessor.get(IFileService);
	const workingCopyFileService = accessor.get(IWorkingCopyFileService);
	const notificationService = accessor.get(INotificationService);
	const editorService = accessor.get(IEditorService);
	const configurationService = accessor.get(IConfigurationService);

	const context = explorerService.getContext(true);
	const toPaste = resources.distinctParents(await clipboardService.readResources(), r => r);
	const element = context.length ? context[0] : explorerService.roots[0];

	try {
		// Check if target is ancestor of pasted folder
		const sourceTargetPairs = await Promise.all(toPaste.map(async fileToPaste => {

			if (element.resource.toString() !== fileToPaste.toString() && resources.isEqualOrParent(element.resource, fileToPaste)) {
				throw new Error(nls.localize('fileIsAncestor', "File to paste is an ancestor of the destination folder"));
			}
			const fileToPasteStat = await fileService.resolve(fileToPaste);

			// Find target
			let target: ExplorerItem;
			if (element.resource.toString() === fileToPaste.toString()) {
				target = element.parent!;
			} else {
				target = element.isDirectory ? element : element.parent!;
			}

			const incrementalNaming = configurationService.getValue<IFilesConfiguration>().explorer.incrementalNaming;
			const targetFile = findValidPasteFileTarget(explorerService, target, { resource: fileToPaste, isDirectory: fileToPasteStat.isDirectory, allowOverwrite: pasteShouldMove }, incrementalNaming);

			return { source: fileToPaste, target: targetFile };
		}));

		// Move/Copy File
		let stats: IFileStatWithMetadata[] = [];
		if (pasteShouldMove) {
			stats = await workingCopyFileService.move(sourceTargetPairs);
		} else {
			stats = await workingCopyFileService.copy(sourceTargetPairs);
		}

		if (stats.length >= 1) {
			const stat = stats[0];
			if (stat && !stat.isDirectory && stats.length === 1) {
				await editorService.openEditor({ resource: stat.resource, options: { pinned: true, preserveFocus: true } });
			}
			if (stat) {
				await explorerService.select(stat.resource);
			}
		}
	} catch (e) {
		onError(notificationService, new Error(nls.localize('fileDeleted', "The file(s) to paste have been deleted or moved since you copied them. {0}", getErrorMessage(e))));
	} finally {
		if (pasteShouldMove) {
			// Cut is done. Make sure to clear cut state.
			await explorerService.setToCopy([], false);
			pasteShouldMove = false;
		}
	}
};

export const openFilePreserveFocusHandler = async (accessor: ServicesAccessor) => {
	const editorService = accessor.get(IEditorService);
	const explorerService = accessor.get(IExplorerService);
	const stats = explorerService.getContext(true);

	await editorService.openEditors(stats.filter(s => !s.isDirectory).map(s => ({
		resource: s.resource,
		options: { preserveFocus: true }
	})));
};
