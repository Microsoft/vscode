/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import * as resources from 'vs/base/common/resources';
import * as objects from 'vs/base/common/objects';
import { IFileService, IFileStat, FileKind } from 'vs/platform/files/common/files';
import { IQuickInputService, IQuickPickItem, IQuickPick } from 'vs/platform/quickinput/common/quickInput';
import { URI } from 'vs/base/common/uri';
import { isWindows, OperatingSystem } from 'vs/base/common/platform';
import { ISaveDialogOptions, IOpenDialogOptions, IFileDialogService } from 'vs/platform/dialogs/common/dialogs';
import { ILabelService } from 'vs/platform/label/common/label';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IModelService } from 'vs/editor/common/services/modelService';
import { IModeService } from 'vs/editor/common/services/modeService';
import { getIconClasses } from 'vs/editor/common/services/getIconClasses';
import { Schemas } from 'vs/base/common/network';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IRemoteAgentService } from 'vs/workbench/services/remote/common/remoteAgentService';
import { IContextKeyService, IContextKey, RawContextKey } from 'vs/platform/contextkey/common/contextkey';
import { equalsIgnoreCase, format, startsWithIgnoreCase } from 'vs/base/common/strings';
import { IKeybindingService } from 'vs/platform/keybinding/common/keybinding';
import { IRemoteAgentEnvironment } from 'vs/platform/remote/common/remoteAgentEnvironment';
import { isValidBasename } from 'vs/base/common/extpath';
import { Emitter } from 'vs/base/common/event';
import { IDisposable, dispose } from 'vs/base/common/lifecycle';
import { createCancelablePromise, CancelablePromise } from 'vs/base/common/async';
import { CancellationToken } from 'vs/base/common/cancellation';
import { ICommandHandler } from 'vs/platform/commands/common/commands';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { normalizeDriveLetter } from 'vs/base/common/labels';
import { SaveReason } from 'vs/workbench/common/editor';
import { IPathService } from 'vs/workbench/services/path/common/pathService';

export namespace OpenLocalFileCommand {
	export const ID = 'workbench.action.files.openLocalFile';
	export const LABEL = nls.localize('openLocalFile', "Open Local File...");
	export function handler(): ICommandHandler {
		return accessor => {
			const dialogService = accessor.get(IFileDialogService);
			return dialogService.pickFileAndOpen({ forceNewWindow: false, availableFileSystems: [Schemas.file] });
		};
	}
}

export namespace SaveLocalFileCommand {
	export const ID = 'workbench.action.files.saveLocalFile';
	export const LABEL = nls.localize('saveLocalFile', "Save Local File...");
	export function handler(): ICommandHandler {
		return accessor => {
			const editorService = accessor.get(IEditorService);
			const activeEditorPane = editorService.activeEditorPane;
			if (activeEditorPane) {
				return editorService.save({ groupId: activeEditorPane.group.id, editor: activeEditorPane.input }, { saveAs: true, availableFileSystems: [Schemas.file], reason: SaveReason.EXPLICIT });
			}

			return Promise.resolve(undefined);
		};
	}
}

export namespace OpenLocalFolderCommand {
	export const ID = 'workbench.action.files.openLocalFolder';
	export const LABEL = nls.localize('openLocalFolder', "Open Local Folder...");
	export function handler(): ICommandHandler {
		return accessor => {
			const dialogService = accessor.get(IFileDialogService);
			return dialogService.pickFolderAndOpen({ forceNewWindow: false, availableFileSystems: [Schemas.file] });
		};
	}
}

export namespace OpenLocalFileFolderCommand {
	export const ID = 'workbench.action.files.openLocalFileFolder';
	export const LABEL = nls.localize('openLocalFileFolder', "Open Local...");
	export function handler(): ICommandHandler {
		return accessor => {
			const dialogService = accessor.get(IFileDialogService);
			return dialogService.pickFileFolderAndOpen({ forceNewWindow: false, availableFileSystems: [Schemas.file] });
		};
	}
}

interface FileQuickPickItem extends IQuickPickItem {
	uri: URI;
	isFolder: boolean;
}

enum UpdateResult {
	Updated,
	Updating,
	NotUpdated,
	InvalidPath
}

export const RemoteFileDialogContext = new RawContextKey<boolean>('remoteFileDialogVisible', false);

export class SimpleFileDialog {
	private options!: IOpenDialogOptions;
	private currentFolder!: URI;
	private filePickBox!: IQuickPick<FileQuickPickItem>;
	private hidden: boolean = false;
	private allowFileSelection: boolean = true;
	private allowFolderSelection: boolean = false;
	private remoteAuthority: string | undefined;
	private requiresTrailing: boolean = false;
	private trailing: string | undefined;
	protected scheme: string;
	private contextKey: IContextKey<boolean>;
	private userEnteredPathSegment: string = '';
	private autoCompletePathSegment: string = '';
	private activeItem: FileQuickPickItem | undefined;
	private userHome!: URI;
	private badPath: string | undefined;
	private remoteAgentEnvironment: IRemoteAgentEnvironment | null | undefined;
	private separator: string = '/';
	private readonly onBusyChangeEmitter = new Emitter<boolean>();
	private updatingPromise: CancelablePromise<void> | undefined;

	protected disposables: IDisposable[] = [
		this.onBusyChangeEmitter
	];

	constructor(
		@IFileService private readonly fileService: IFileService,
		@IQuickInputService private readonly quickInputService: IQuickInputService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IModelService private readonly modelService: IModelService,
		@IModeService private readonly modeService: IModeService,
		@IWorkbenchEnvironmentService protected readonly environmentService: IWorkbenchEnvironmentService,
		@IRemoteAgentService private readonly remoteAgentService: IRemoteAgentService,
		@IPathService protected readonly pathService: IPathService,
		@IKeybindingService private readonly keybindingService: IKeybindingService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		this.remoteAuthority = this.environmentService.remoteAuthority;
		this.contextKey = RemoteFileDialogContext.bindTo(contextKeyService);
		this.scheme = this.pathService.defaultUriScheme;
	}

	set busy(busy: boolean) {
		if (this.filePickBox.busy !== busy) {
			this.filePickBox.busy = busy;
			this.onBusyChangeEmitter.fire(busy);
		}
	}

	get busy(): boolean {
		return this.filePickBox.busy;
	}

	public async showOpenDialog(options: IOpenDialogOptions = {}): Promise<URI | undefined> {
		this.scheme = this.getScheme(options.availableFileSystems, options.defaultUri);
		this.userHome = await this.getUserHome();
		const newOptions = this.getOptions(options);
		if (!newOptions) {
			return Promise.resolve(undefined);
		}
		this.options = newOptions;
		return this.pickResource();
	}

	public async showSaveDialog(options: ISaveDialogOptions): Promise<URI | undefined> {
		this.scheme = this.getScheme(options.availableFileSystems, options.defaultUri);
		this.userHome = await this.getUserHome();
		this.requiresTrailing = true;
		const newOptions = this.getOptions(options, true);
		if (!newOptions) {
			return Promise.resolve(undefined);
		}
		this.options = newOptions;
		this.options.canSelectFolders = true;
		this.options.canSelectFiles = true;

		return new Promise<URI | undefined>((resolve) => {
			this.pickResource(true).then(folderUri => {
				resolve(folderUri);
			});
		});
	}

	private getOptions(options: ISaveDialogOptions | IOpenDialogOptions, isSave: boolean = false): IOpenDialogOptions | undefined {
		let defaultUri: URI | undefined = undefined;
		let filename: string | undefined = undefined;
		if (options.defaultUri) {
			defaultUri = (this.scheme === options.defaultUri.scheme) ? options.defaultUri : undefined;
			filename = isSave ? resources.basename(options.defaultUri) : undefined;
		}
		if (!defaultUri) {
			defaultUri = this.userHome;
			if (filename) {
				defaultUri = resources.joinPath(defaultUri, filename);
			}
		}
		if ((this.scheme !== Schemas.file) && !this.fileService.canHandleResource(defaultUri)) {
			this.notificationService.info(nls.localize('remoteFileDialog.notConnectedToRemote', 'File system provider for {0} is not available.', defaultUri.toString()));
			return undefined;
		}
		const newOptions: IOpenDialogOptions = objects.deepClone(options);
		newOptions.defaultUri = defaultUri;
		return newOptions;
	}

	private remoteUriFrom(path: string): URI {
		if (!path.startsWith('\\\\')) {
			path = path.replace(/\\/g, '/');
		}
		const uri: URI = this.scheme === Schemas.file ? URI.file(path) : URI.from({ scheme: this.scheme, path });
		return resources.toLocalResource(uri,
			// If the default scheme is file, then we don't care about the remote authority
			uri.scheme === Schemas.file ? undefined : this.remoteAuthority,
			// If there is a remote authority, then we should use the system's default URI as the local scheme.
			// If there is *no* remote authority, then we should use the default scheme for this dialog as that is already local.
			this.remoteAuthority ? this.pathService.defaultUriScheme : uri.scheme);
	}

	private getScheme(available: readonly string[] | undefined, defaultUri: URI | undefined): string {
		if (available) {
			if (defaultUri && (available.indexOf(defaultUri.scheme) >= 0)) {
				return defaultUri.scheme;
			}
			return available[0];
		} else if (defaultUri) {
			return defaultUri.scheme;
		}
		return Schemas.file;
	}

	private async getRemoteAgentEnvironment(): Promise<IRemoteAgentEnvironment | null> {
		if (this.remoteAgentEnvironment === undefined) {
			this.remoteAgentEnvironment = await this.remoteAgentService.getEnvironment();
		}
		return this.remoteAgentEnvironment;
	}

	protected getUserHome(): Promise<URI> {
		return this.pathService.userHome({ preferLocal: this.scheme === Schemas.file });
	}

	private async pickResource(isSave: boolean = false): Promise<URI | undefined> {
		this.allowFolderSelection = !!this.options.canSelectFolders;
		this.allowFileSelection = !!this.options.canSelectFiles;
		this.separator = this.labelService.getSeparator(this.scheme, this.remoteAuthority);
		this.hidden = false;
		let homedir: URI = this.options.defaultUri ? this.options.defaultUri : this.workspaceContextService.getWorkspace().folders[0].uri;
		let stat: IFileStat | undefined;
		let ext: string = resources.extname(homedir);
		if (this.options.defaultUri) {
			try {
				stat = await this.fileService.resolve(this.options.defaultUri);
			} catch (e) {
				// The file or folder doesn't exist
			}
			if (!stat || !stat.isDirectory) {
				homedir = resources.dirname(this.options.defaultUri);
				this.trailing = resources.basename(this.options.defaultUri);
			}
		}

		return new Promise<URI | undefined>(async (resolve) => {
			this.filePickBox = this.quickInputService.createQuickPick<FileQuickPickItem>();
			this.busy = true;
			this.filePickBox.matchOnLabel = false;
			this.filePickBox.sortByLabel = false;
			this.filePickBox.autoFocusOnList = false;
			this.filePickBox.ignoreFocusOut = true;
			this.filePickBox.ok = true;
			if ((this.scheme !== Schemas.file) && this.options && this.options.availableFileSystems && (this.options.availableFileSystems.length > 1) && (this.options.availableFileSystems.indexOf(Schemas.file) > -1)) {
				this.filePickBox.customButton = true;
				this.filePickBox.customLabel = nls.localize('remoteFileDialog.local', 'Show Local');
				let action;
				if (isSave) {
					action = SaveLocalFileCommand;
				} else {
					action = this.allowFileSelection ? (this.allowFolderSelection ? OpenLocalFileFolderCommand : OpenLocalFileCommand) : OpenLocalFolderCommand;
				}
				const keybinding = this.keybindingService.lookupKeybinding(action.ID);
				if (keybinding) {
					const label = keybinding.getLabel();
					if (label) {
						this.filePickBox.customHover = format('{0} ({1})', action.LABEL, label);
					}
				}
			}

			let isResolving: number = 0;
			let isAcceptHandled = false;
			this.currentFolder = resources.dirname(homedir);
			this.userEnteredPathSegment = '';
			this.autoCompletePathSegment = '';

			this.filePickBox.title = this.options.title;
			this.filePickBox.value = this.pathFromUri(this.currentFolder, true);
			this.filePickBox.valueSelection = [this.filePickBox.value.length, this.filePickBox.value.length];
			this.filePickBox.items = [];

			function doResolve(dialog: SimpleFileDialog, uri: URI | undefined) {
				if (uri) {
					uri = resources.addTrailingPathSeparator(uri, dialog.separator); // Ensures that c: is c:/ since this comes from user input and can be incorrect.
					// To be consistent, we should never have a trailing path separator on directories (or anything else). Will not remove from c:/.
					uri = resources.removeTrailingPathSeparator(uri);
				}
				resolve(uri);
				dialog.contextKey.set(false);
				dialog.filePickBox.dispose();
				dispose(dialog.disposables);
			}

			this.filePickBox.onDidCustom(() => {
				if (isAcceptHandled || this.busy) {
					return;
				}

				isAcceptHandled = true;
				isResolving++;
				if (this.options.availableFileSystems && (this.options.availableFileSystems.length > 1)) {
					this.options.availableFileSystems = this.options.availableFileSystems.slice(1);
				}
				this.filePickBox.hide();
				if (isSave) {
					return this.fileDialogService.showSaveDialog(this.options).then(result => {
						doResolve(this, result);
					});
				} else {
					return this.fileDialogService.showOpenDialog(this.options).then(result => {
						doResolve(this, result ? result[0] : undefined);
					});
				}
			});

			function handleAccept(dialog: SimpleFileDialog) {
				if (dialog.busy) {
					// Save the accept until the file picker is not busy.
					dialog.onBusyChangeEmitter.event((busy: boolean) => {
						if (!busy) {
							handleAccept(dialog);
						}
					});
					return;
				} else if (isAcceptHandled) {
					return;
				}

				isAcceptHandled = true;
				isResolving++;
				dialog.onDidAccept().then(resolveValue => {
					if (resolveValue) {
						dialog.filePickBox.hide();
						doResolve(dialog, resolveValue);
					} else if (dialog.hidden) {
						doResolve(dialog, undefined);
					} else {
						isResolving--;
						isAcceptHandled = false;
					}
				});
			}

			this.filePickBox.onDidAccept(_ => {
				handleAccept(this);
			});

			this.filePickBox.onDidChangeActive(i => {
				isAcceptHandled = false;
				// update input box to match the first selected item
				if ((i.length === 1) && this.isSelectionChangeFromUser()) {
					this.filePickBox.validationMessage = undefined;
					const userPath = this.constructFullUserPath();
					if (!equalsIgnoreCase(this.filePickBox.value.substring(0, userPath.length), userPath)) {
						this.filePickBox.valueSelection = [0, this.filePickBox.value.length];
						this.insertText(userPath, userPath);
					}
					this.setAutoComplete(userPath, this.userEnteredPathSegment, i[0], true);
				}
			});

			this.filePickBox.onDidChangeValue(async value => {
				return this.handleValueChange(value);
			});
			this.filePickBox.onDidHide(() => {
				this.hidden = true;
				if (isResolving === 0) {
					doResolve(this, undefined);
				}
			});

			this.filePickBox.show();
			this.contextKey.set(true);
			await this.updateItems(homedir, true, this.trailing);
			if (this.trailing) {
				this.filePickBox.valueSelection = [this.filePickBox.value.length - this.trailing.length, this.filePickBox.value.length - ext.length];
			} else {
				this.filePickBox.valueSelection = [this.filePickBox.value.length, this.filePickBox.value.length];
			}
			this.busy = false;
		});
	}

	private async handleValueChange(value: string) {
		try {
			// onDidChangeValue can also be triggered by the auto complete, so if it looks like the auto complete, don't do anything
			if (this.isValueChangeFromUser()) {
				// If the user has just entered more bad path, don't change anything
				if (!equalsIgnoreCase(value, this.constructFullUserPath()) && !this.isBadSubpath(value)) {
					this.filePickBox.validationMessage = undefined;
					const filePickBoxUri = this.filePickBoxValue();
					let updated: UpdateResult = UpdateResult.NotUpdated;
					if (!resources.extUriIgnorePathCase.isEqual(this.currentFolder, filePickBoxUri)) {
						updated = await this.tryUpdateItems(value, filePickBoxUri);
					}
					if (updated === UpdateResult.NotUpdated) {
						this.setActiveItems(value);
					}
				} else {
					this.filePickBox.activeItems = [];
					this.userEnteredPathSegment = '';
				}
			}
		} catch {
			// Since any text can be entered in the input box, there is potential for error causing input. If this happens, do nothing.
		}
	}

	private isBadSubpath(value: string) {
		return this.badPath && (value.length > this.badPath.length) && equalsIgnoreCase(value.substring(0, this.badPath.length), this.badPath);
	}

	private isValueChangeFromUser(): boolean {
		if (equalsIgnoreCase(this.filePickBox.value, this.pathAppend(this.currentFolder, this.userEnteredPathSegment + this.autoCompletePathSegment))) {
			return false;
		}
		return true;
	}

	private isSelectionChangeFromUser(): boolean {
		if (this.activeItem === (this.filePickBox.activeItems ? this.filePickBox.activeItems[0] : undefined)) {
			return false;
		}
		return true;
	}

	private constructFullUserPath(): string {
		const currentFolderPath = this.pathFromUri(this.currentFolder);
		if (equalsIgnoreCase(this.filePickBox.value.substr(0, this.userEnteredPathSegment.length), this.userEnteredPathSegment) && equalsIgnoreCase(this.filePickBox.value.substr(0, currentFolderPath.length), currentFolderPath)) {
			return currentFolderPath;
		} else {
			return this.pathAppend(this.currentFolder, this.userEnteredPathSegment);
		}
	}

	private filePickBoxValue(): URI {
		// The file pick box can't render everything, so we use the current folder to create the uri so that it is an existing path.
		const directUri = this.remoteUriFrom(this.filePickBox.value.trimRight());
		const currentPath = this.pathFromUri(this.currentFolder);
		if (equalsIgnoreCase(this.filePickBox.value, currentPath)) {
			return this.currentFolder;
		}
		const currentDisplayUri = this.remoteUriFrom(currentPath);
		const relativePath = resources.relativePath(currentDisplayUri, directUri);
		const isSameRoot = (this.filePickBox.value.length > 1 && currentPath.length > 1) ? equalsIgnoreCase(this.filePickBox.value.substr(0, 2), currentPath.substr(0, 2)) : false;
		if (relativePath && isSameRoot) {
			let path = resources.joinPath(this.currentFolder, relativePath);
			const directBasename = resources.basename(directUri);
			if ((directBasename === '.') || (directBasename === '..')) {
				path = this.remoteUriFrom(this.pathAppend(path, directBasename));
			}
			return resources.hasTrailingPathSeparator(directUri) ? resources.addTrailingPathSeparator(path) : path;
		} else {
			return directUri;
		}
	}

	private async onDidAccept(): Promise<URI | undefined> {
		this.busy = true;
		if (this.filePickBox.activeItems.length === 1) {
			const item = this.filePickBox.selectedItems[0];
			if (item.isFolder) {
				if (this.trailing) {
					await this.updateItems(item.uri, true, this.trailing);
				} else {
					// When possible, cause the update to happen by modifying the input box.
					// This allows all input box updates to happen first, and uses the same code path as the user typing.
					const newPath = this.pathFromUri(item.uri);
					if (startsWithIgnoreCase(newPath, this.filePickBox.value) && (equalsIgnoreCase(item.label, resources.basename(item.uri)))) {
						this.filePickBox.valueSelection = [this.pathFromUri(this.currentFolder).length, this.filePickBox.value.length];
						this.insertText(newPath, this.basenameWithTrailingSlash(item.uri));
					} else if ((item.label === '..') && startsWithIgnoreCase(this.filePickBox.value, newPath)) {
						this.filePickBox.valueSelection = [newPath.length, this.filePickBox.value.length];
						this.insertText(newPath, '');
					} else {
						await this.updateItems(item.uri, true);
					}
				}
				this.filePickBox.busy = false;
				return;
			}
		} else {
			// If the items have updated, don't try to resolve
			if ((await this.tryUpdateItems(this.filePickBox.value, this.filePickBoxValue())) !== UpdateResult.NotUpdated) {
				this.filePickBox.busy = false;
				return;
			}
		}

		let resolveValue: URI | undefined;
		// Find resolve value
		if (this.filePickBox.activeItems.length === 0) {
			resolveValue = this.filePickBoxValue();
		} else if (this.filePickBox.activeItems.length === 1) {
			resolveValue = this.filePickBox.selectedItems[0].uri;
		}
		if (resolveValue) {
			resolveValue = this.addPostfix(resolveValue);
		}
		if (await this.validate(resolveValue)) {
			this.busy = false;
			return resolveValue;
		}
		this.busy = false;
		return undefined;
	}

	private root(value: URI) {
		let lastDir = value;
		let dir = resources.dirname(value);
		while (!resources.isEqual(lastDir, dir)) {
			lastDir = dir;
			dir = resources.dirname(dir);
		}
		return dir;
	}

	private async tryUpdateItems(value: string, valueUri: URI): Promise<UpdateResult> {
		if ((value.length > 0) && ((value[value.length - 1] === '~') || (value[0] === '~'))) {
			let newDir = this.userHome;
			if ((value[0] === '~') && (value.length > 1)) {
				newDir = resources.joinPath(newDir, value.substring(1));
			}
			await this.updateItems(newDir, true);
			return UpdateResult.Updated;
		} else if (value === '\\') {
			valueUri = this.root(this.currentFolder);
			value = this.pathFromUri(valueUri);
			await this.updateItems(valueUri, true);
			return UpdateResult.Updated;
		} else if (!resources.extUriIgnorePathCase.isEqual(this.currentFolder, valueUri) && (this.endsWithSlash(value) || (!resources.extUriIgnorePathCase.isEqual(this.currentFolder, resources.dirname(valueUri)) && resources.extUriIgnorePathCase.isEqualOrParent(this.currentFolder, resources.dirname(valueUri))))) {
			let stat: IFileStat | undefined;
			try {
				stat = await this.fileService.resolve(valueUri);
			} catch (e) {
				// do nothing
			}
			if (stat && stat.isDirectory && (resources.basename(valueUri) !== '.') && this.endsWithSlash(value)) {
				await this.updateItems(valueUri);
				return UpdateResult.Updated;
			} else if (this.endsWithSlash(value)) {
				// The input box contains a path that doesn't exist on the system.
				this.filePickBox.validationMessage = nls.localize('remoteFileDialog.badPath', 'The path does not exist.');
				// Save this bad path. It can take too long to a stat on every user entered character, but once a user enters a bad path they are likely
				// to keep typing more bad path. We can compare against this bad path and see if the user entered path starts with it.
				this.badPath = value;
				return UpdateResult.InvalidPath;
			} else {
				const inputUriDirname = resources.dirname(valueUri);
				if (!resources.extUriIgnorePathCase.isEqual(resources.removeTrailingPathSeparator(this.currentFolder), inputUriDirname)) {
					let statWithoutTrailing: IFileStat | undefined;
					try {
						statWithoutTrailing = await this.fileService.resolve(inputUriDirname);
					} catch (e) {
						// do nothing
					}
					if (statWithoutTrailing && statWithoutTrailing.isDirectory) {
						await this.updateItems(inputUriDirname, false, resources.basename(valueUri));
						this.badPath = undefined;
						return UpdateResult.Updated;
					}
				}
			}
		}
		this.badPath = undefined;
		return UpdateResult.NotUpdated;
	}

	private setActiveItems(value: string) {
		const inputBasename = resources.basename(this.remoteUriFrom(value));
		const userPath = this.constructFullUserPath();
		// Make sure that the folder whose children we are currently viewing matches the path in the input
		const pathsEqual = equalsIgnoreCase(userPath, value.substring(0, userPath.length)) ||
			equalsIgnoreCase(value, userPath.substring(0, value.length));
		if (pathsEqual) {
			let hasMatch = false;
			for (let i = 0; i < this.filePickBox.items.length; i++) {
				const item = <FileQuickPickItem>this.filePickBox.items[i];
				if (this.setAutoComplete(value, inputBasename, item)) {
					hasMatch = true;
					break;
				}
			}
			if (!hasMatch) {
				const userBasename = inputBasename.length >= 2 ? userPath.substring(userPath.length - inputBasename.length + 2) : '';
				this.userEnteredPathSegment = (userBasename === inputBasename) ? inputBasename : '';
				this.autoCompletePathSegment = '';
				this.filePickBox.activeItems = [];
			}
		} else {
			this.userEnteredPathSegment = inputBasename;
			this.autoCompletePathSegment = '';
		}
	}

	private setAutoComplete(startingValue: string, startingBasename: string, quickPickItem: FileQuickPickItem, force: boolean = false): boolean {
		if (this.busy) {
			// We're in the middle of something else. Doing an auto complete now can result jumbled or incorrect autocompletes.
			this.userEnteredPathSegment = startingBasename;
			this.autoCompletePathSegment = '';
			return false;
		}
		const itemBasename = quickPickItem.label;
		// Either force the autocomplete, or the old value should be one smaller than the new value and match the new value.
		if (itemBasename === '..') {
			// Don't match on the up directory item ever.
			this.userEnteredPathSegment = '';
			this.autoCompletePathSegment = '';
			this.activeItem = quickPickItem;
			if (force) {
				// clear any selected text
				document.execCommand('insertText', false, '');
			}
			return false;
		} else if (!force && (itemBasename.length >= startingBasename.length) && equalsIgnoreCase(itemBasename.substr(0, startingBasename.length), startingBasename)) {
			this.userEnteredPathSegment = startingBasename;
			this.activeItem = quickPickItem;
			// Changing the active items will trigger the onDidActiveItemsChanged. Clear the autocomplete first, then set it after.
			this.autoCompletePathSegment = '';
			this.filePickBox.activeItems = [quickPickItem];
			return true;
		} else if (force && (!equalsIgnoreCase(this.basenameWithTrailingSlash(quickPickItem.uri), (this.userEnteredPathSegment + this.autoCompletePathSegment)))) {
			this.userEnteredPathSegment = '';
			this.autoCompletePathSegment = this.trimTrailingSlash(itemBasename);
			this.activeItem = quickPickItem;
			this.filePickBox.valueSelection = [this.pathFromUri(this.currentFolder, true).length, this.filePickBox.value.length];
			// use insert text to preserve undo buffer
			this.insertText(this.pathAppend(this.currentFolder, this.autoCompletePathSegment), this.autoCompletePathSegment);
			this.filePickBox.valueSelection = [this.filePickBox.value.length - this.autoCompletePathSegment.length, this.filePickBox.value.length];
			return true;
		} else {
			this.userEnteredPathSegment = startingBasename;
			this.autoCompletePathSegment = '';
			return false;
		}
	}

	private insertText(wholeValue: string, insertText: string) {
		if (this.filePickBox.inputHasFocus()) {
			document.execCommand('insertText', false, insertText);
			if (this.filePickBox.value !== wholeValue) {
				this.filePickBox.value = wholeValue;
				this.handleValueChange(wholeValue);
			}
		} else {
			this.filePickBox.value = wholeValue;
			this.handleValueChange(wholeValue);
		}
	}

	private addPostfix(uri: URI): URI {
		let result = uri;
		if (this.requiresTrailing && this.options.filters && this.options.filters.length > 0 && !resources.hasTrailingPathSeparator(uri)) {
			// Make sure that the suffix is added. If the user deleted it, we automatically add it here
			let hasExt: boolean = false;
			const currentExt = resources.extname(uri).substr(1);
			for (let i = 0; i < this.options.filters.length; i++) {
				for (let j = 0; j < this.options.filters[i].extensions.length; j++) {
					if ((this.options.filters[i].extensions[j] === '*') || (this.options.filters[i].extensions[j] === currentExt)) {
						hasExt = true;
						break;
					}
				}
				if (hasExt) {
					break;
				}
			}
			if (!hasExt) {
				result = resources.joinPath(resources.dirname(uri), resources.basename(uri) + '.' + this.options.filters[0].extensions[0]);
			}
		}
		return result;
	}

	private trimTrailingSlash(path: string): string {
		return ((path.length > 1) && this.endsWithSlash(path)) ? path.substr(0, path.length - 1) : path;
	}

	private yesNoPrompt(uri: URI, message: string): Promise<boolean> {
		interface YesNoItem extends IQuickPickItem {
			value: boolean;
		}
		const prompt = this.quickInputService.createQuickPick<YesNoItem>();
		prompt.title = message;
		prompt.ignoreFocusOut = true;
		prompt.ok = true;
		prompt.customButton = true;
		prompt.customLabel = nls.localize('remoteFileDialog.cancel', 'Cancel');
		prompt.value = this.pathFromUri(uri);

		let isResolving = false;
		return new Promise<boolean>(resolve => {
			prompt.onDidAccept(() => {
				isResolving = true;
				prompt.hide();
				resolve(true);
			});
			prompt.onDidHide(() => {
				if (!isResolving) {
					resolve(false);
				}
				this.filePickBox.show();
				this.hidden = false;
				this.filePickBox.items = this.filePickBox.items;
				prompt.dispose();
			});
			prompt.onDidChangeValue(() => {
				prompt.hide();
			});
			prompt.onDidCustom(() => {
				prompt.hide();
			});
			prompt.show();
		});
	}

	private async validate(uri: URI | undefined): Promise<boolean> {
		if (uri === undefined) {
			this.filePickBox.validationMessage = nls.localize('remoteFileDialog.invalidPath', 'Please enter a valid path.');
			return Promise.resolve(false);
		}

		let stat: IFileStat | undefined;
		let statDirname: IFileStat | undefined;
		try {
			statDirname = await this.fileService.resolve(resources.dirname(uri));
			stat = await this.fileService.resolve(uri);
		} catch (e) {
			// do nothing
		}

		if (this.requiresTrailing) { // save
			if (stat && stat.isDirectory) {
				// Can't do this
				this.filePickBox.validationMessage = nls.localize('remoteFileDialog.validateFolder', 'The folder already exists. Please use a new file name.');
				return Promise.resolve(false);
			} else if (stat) {
				// Replacing a file.
				// Show a yes/no prompt
				const message = nls.localize('remoteFileDialog.validateExisting', '{0} already exists. Are you sure you want to overwrite it?', resources.basename(uri));
				return this.yesNoPrompt(uri, message);
			} else if (!(isValidBasename(resources.basename(uri), await this.isWindowsOS()))) {
				// Filename not allowed
				this.filePickBox.validationMessage = nls.localize('remoteFileDialog.validateBadFilename', 'Please enter a valid file name.');
				return Promise.resolve(false);
			} else if (!statDirname || !statDirname.isDirectory) {
				// Folder to save in doesn't exist
				this.filePickBox.validationMessage = nls.localize('remoteFileDialog.validateNonexistentDir', 'Please enter a path that exists.');
				return Promise.resolve(false);
			}
		} else { // open
			if (!stat) {
				// File or folder doesn't exist
				this.filePickBox.validationMessage = nls.localize('remoteFileDialog.validateNonexistentDir', 'Please enter a path that exists.');
				return Promise.resolve(false);
			} else if (uri.path === '/' && (await this.isWindowsOS())) {
				this.filePickBox.validationMessage = nls.localize('remoteFileDialog.windowsDriveLetter', 'Please start the path with a drive letter.');
				return Promise.resolve(false);
			} else if (stat.isDirectory && !this.allowFolderSelection) {
				// Folder selected when folder selection not permitted
				this.filePickBox.validationMessage = nls.localize('remoteFileDialog.validateFileOnly', 'Please select a file.');
				return Promise.resolve(false);
			} else if (!stat.isDirectory && !this.allowFileSelection) {
				// File selected when file selection not permitted
				this.filePickBox.validationMessage = nls.localize('remoteFileDialog.validateFolderOnly', 'Please select a folder.');
				return Promise.resolve(false);
			}
		}
		return Promise.resolve(true);
	}

	private async updateItems(newFolder: URI, force: boolean = false, trailing?: string) {
		this.busy = true;
		this.userEnteredPathSegment = trailing ? trailing : '';
		this.autoCompletePathSegment = '';
		const newValue = trailing ? this.pathAppend(newFolder, trailing) : this.pathFromUri(newFolder, true);
		this.currentFolder = resources.addTrailingPathSeparator(newFolder, this.separator);

		const updatingPromise = createCancelablePromise(async token => {
			return this.createItems(this.currentFolder, token).then(items => {
				if (token.isCancellationRequested) {
					this.busy = false;
					return;
				}

				this.filePickBox.items = items;
				this.filePickBox.activeItems = [<FileQuickPickItem>this.filePickBox.items[0]];
				if (this.allowFolderSelection) {
					this.filePickBox.activeItems = [];
				}
				// the user might have continued typing while we were updating. Only update the input box if it doesn't matche directory.
				if (!equalsIgnoreCase(this.filePickBox.value, newValue) && force) {
					this.filePickBox.valueSelection = [0, this.filePickBox.value.length];
					this.insertText(newValue, newValue);
				}
				if (force && trailing) {
					// Keep the cursor position in front of the save as name.
					this.filePickBox.valueSelection = [this.filePickBox.value.length - trailing.length, this.filePickBox.value.length - trailing.length];
				} else if (!trailing) {
					// If there is trailing, we don't move the cursor. If there is no trailing, cursor goes at the end.
					this.filePickBox.valueSelection = [this.filePickBox.value.length, this.filePickBox.value.length];
				}
				this.busy = false;
				this.updatingPromise = undefined;
			});
		});

		if (this.updatingPromise !== undefined) {
			this.updatingPromise.cancel();
		}
		this.updatingPromise = updatingPromise;

		return updatingPromise;
	}

	private pathFromUri(uri: URI, endWithSeparator: boolean = false): string {
		let result: string = normalizeDriveLetter(uri.fsPath).replace(/\n/g, '');
		if (this.separator === '/') {
			result = result.replace(/\\/g, this.separator);
		} else {
			result = result.replace(/\//g, this.separator);
		}
		if (endWithSeparator && !this.endsWithSlash(result)) {
			result = result + this.separator;
		}
		return result;
	}

	private pathAppend(uri: URI, additional: string): string {
		if ((additional === '..') || (additional === '.')) {
			const basePath = this.pathFromUri(uri, true);
			return basePath + additional;
		} else {
			return this.pathFromUri(resources.joinPath(uri, additional));
		}
	}

	private async isWindowsOS(): Promise<boolean> {
		let isWindowsOS = isWindows;
		const env = await this.getRemoteAgentEnvironment();
		if (env) {
			isWindowsOS = env.os === OperatingSystem.Windows;
		}
		return isWindowsOS;
	}

	private endsWithSlash(s: string) {
		return /[\/\\]$/.test(s);
	}

	private basenameWithTrailingSlash(fullPath: URI): string {
		const child = this.pathFromUri(fullPath, true);
		const parent = this.pathFromUri(resources.dirname(fullPath), true);
		return child.substring(parent.length);
	}

	private createBackItem(currFolder: URI): FileQuickPickItem | null {
		const fileRepresentationCurr = this.currentFolder.with({ scheme: Schemas.file });
		const fileRepresentationParent = resources.dirname(fileRepresentationCurr);
		if (!resources.isEqual(fileRepresentationCurr, fileRepresentationParent)) {
			const parentFolder = resources.dirname(currFolder);
			return { label: '..', uri: resources.addTrailingPathSeparator(parentFolder, this.separator), isFolder: true };
		}
		return null;
	}

	private async createItems(currentFolder: URI, token: CancellationToken): Promise<FileQuickPickItem[]> {
		const result: FileQuickPickItem[] = [];

		const backDir = this.createBackItem(currentFolder);
		try {
			const folder = await this.fileService.resolve(currentFolder);
			const items = folder.children ? await Promise.all(folder.children.map(child => this.createItem(child, currentFolder, token))) : [];
			for (let item of items) {
				if (item) {
					result.push(item);
				}
			}
		} catch (e) {
			// ignore
			console.log(e);
		}
		if (token.isCancellationRequested) {
			return [];
		}
		const sorted = result.sort((i1, i2) => {
			if (i1.isFolder !== i2.isFolder) {
				return i1.isFolder ? -1 : 1;
			}
			const trimmed1 = this.endsWithSlash(i1.label) ? i1.label.substr(0, i1.label.length - 1) : i1.label;
			const trimmed2 = this.endsWithSlash(i2.label) ? i2.label.substr(0, i2.label.length - 1) : i2.label;
			return trimmed1.localeCompare(trimmed2);
		});

		if (backDir) {
			sorted.unshift(backDir);
		}
		return sorted;
	}

	private filterFile(file: URI): boolean {
		if (this.options.filters) {
			const ext = resources.extname(file);
			for (let i = 0; i < this.options.filters.length; i++) {
				for (let j = 0; j < this.options.filters[i].extensions.length; j++) {
					const testExt = this.options.filters[i].extensions[j];
					if ((testExt === '*') || (ext === ('.' + testExt))) {
						return true;
					}
				}
			}
			return false;
		}
		return true;
	}

	private async createItem(stat: IFileStat, parent: URI, token: CancellationToken): Promise<FileQuickPickItem | undefined> {
		if (token.isCancellationRequested) {
			return undefined;
		}
		let fullPath = resources.joinPath(parent, stat.name);
		if (stat.isDirectory) {
			const filename = resources.basename(fullPath);
			fullPath = resources.addTrailingPathSeparator(fullPath, this.separator);
			return { label: filename, uri: fullPath, isFolder: true, iconClasses: getIconClasses(this.modelService, this.modeService, fullPath || undefined, FileKind.FOLDER) };
		} else if (!stat.isDirectory && this.allowFileSelection && this.filterFile(fullPath)) {
			return { label: stat.name, uri: fullPath, isFolder: false, iconClasses: getIconClasses(this.modelService, this.modeService, fullPath || undefined) };
		}
		return undefined;
	}
}
