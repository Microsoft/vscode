/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspaceEditingService } from 'vs/workbench/services/workspaces/common/workspaceEditing';
import { URI } from 'vs/base/common/uri';
import * as nls from 'vs/nls';
import { IWorkspaceContextService, WorkbenchState } from 'vs/platform/workspace/common/workspace';
import { IJSONEditingService, JSONEditingError, JSONEditingErrorCode } from 'vs/workbench/services/configuration/common/jsonEditing';
import { IWorkspaceIdentifier, IWorkspaceFolderCreationData, IWorkspacesService, rewriteWorkspaceFileForNewLocation, WORKSPACE_FILTER, IEnterWorkspaceResult, hasWorkspaceFileExtension, WORKSPACE_EXTENSION, isUntitledWorkspace, IStoredWorkspace } from 'vs/platform/workspaces/common/workspaces';
import { WorkspaceService } from 'vs/workbench/services/configuration/browser/configurationService';
import { ConfigurationScope, IConfigurationRegistry, Extensions as ConfigurationExtensions, IConfigurationPropertySchema } from 'vs/platform/configuration/common/configurationRegistry';
import { Registry } from 'vs/platform/registry/common/platform';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { distinct } from 'vs/base/common/arrays';
import { isEqual, isEqualAuthority } from 'vs/base/common/resources';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IFileService } from 'vs/platform/files/common/files';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { IFileDialogService, IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { Schemas } from 'vs/base/common/network';
import { SaveReason } from 'vs/workbench/common/editor';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

const UNTITLED_WORKSPACE_FILENAME = `workspace.${WORKSPACE_EXTENSION}`;

export abstract class AbstractWorkspaceEditingService implements IWorkspaceEditingService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IJSONEditingService private readonly jsonEditingService: IJSONEditingService,
		@IWorkspaceContextService protected readonly contextService: WorkspaceService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@INotificationService private readonly notificationService: INotificationService,
		@ICommandService private readonly commandService: ICommandService,
		@IFileService private readonly fileService: IFileService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IWorkspacesService protected readonly workspacesService: IWorkspacesService,
		@IWorkbenchEnvironmentService protected readonly environmentService: IWorkbenchEnvironmentService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IDialogService protected readonly dialogService: IDialogService,
		@IHostService protected readonly hostService: IHostService,
		@IUriIdentityService protected readonly uriIdentityService: IUriIdentityService
	) { }

	async pickNewWorkspacePath(): Promise<URI | undefined> {
		let workspacePath = await this.fileDialogService.showSaveDialog({
			saveLabel: mnemonicButtonLabel(nls.localize('save', "Save")),
			title: nls.localize('saveWorkspace', "Save Workspace"),
			filters: WORKSPACE_FILTER,
			defaultUri: await this.fileDialogService.defaultWorkspacePath(undefined, UNTITLED_WORKSPACE_FILENAME)
		});

		if (!workspacePath) {
			return; // canceled
		}

		if (!hasWorkspaceFileExtension(workspacePath)) {
			// Always ensure we have workspace file extension
			// (see https://github.com/microsoft/vscode/issues/84818)
			workspacePath = workspacePath.with({ path: `${workspacePath.path}.${WORKSPACE_EXTENSION}` });
		}

		return workspacePath;
	}

	updateFolders(index: number, deleteCount?: number, foldersToAdd?: IWorkspaceFolderCreationData[], donotNotifyError?: boolean): Promise<void> {
		const folders = this.contextService.getWorkspace().folders;

		let foldersToDelete: URI[] = [];
		if (typeof deleteCount === 'number') {
			foldersToDelete = folders.slice(index, index + deleteCount).map(f => f.uri);
		}

		const wantsToDelete = foldersToDelete.length > 0;
		const wantsToAdd = Array.isArray(foldersToAdd) && foldersToAdd.length > 0;

		if (!wantsToAdd && !wantsToDelete) {
			return Promise.resolve(); // return early if there is nothing to do
		}

		// Add Folders
		if (wantsToAdd && !wantsToDelete && Array.isArray(foldersToAdd)) {
			return this.doAddFolders(foldersToAdd, index, donotNotifyError);
		}

		// Delete Folders
		if (wantsToDelete && !wantsToAdd) {
			return this.removeFolders(foldersToDelete);
		}

		// Add & Delete Folders
		else {

			// if we are in single-folder state and the folder is replaced with
			// other folders, we handle this specially and just enter workspace
			// mode with the folders that are being added.
			if (this.includesSingleFolderWorkspace(foldersToDelete)) {
				return this.createAndEnterWorkspace(foldersToAdd!);
			}

			// if we are not in workspace-state, we just add the folders
			if (this.contextService.getWorkbenchState() !== WorkbenchState.WORKSPACE) {
				return this.doAddFolders(foldersToAdd!, index, donotNotifyError);
			}

			// finally, update folders within the workspace
			return this.doUpdateFolders(foldersToAdd!, foldersToDelete, index, donotNotifyError);
		}
	}

	private async doUpdateFolders(foldersToAdd: IWorkspaceFolderCreationData[], foldersToDelete: URI[], index?: number, donotNotifyError: boolean = false): Promise<void> {
		try {
			await this.contextService.updateFolders(foldersToAdd, foldersToDelete, index);
		} catch (error) {
			if (donotNotifyError) {
				throw error;
			}

			this.handleWorkspaceConfigurationEditingError(error);
		}
	}

	addFolders(foldersToAdd: IWorkspaceFolderCreationData[], donotNotifyError: boolean = false): Promise<void> {
		return this.doAddFolders(foldersToAdd, undefined, donotNotifyError);
	}

	private async doAddFolders(foldersToAdd: IWorkspaceFolderCreationData[], index?: number, donotNotifyError: boolean = false): Promise<void> {
		const state = this.contextService.getWorkbenchState();
		const remoteAuthority = this.environmentService.remoteAuthority;
		if (remoteAuthority) {
			// https://github.com/microsoft/vscode/issues/94191
			foldersToAdd = foldersToAdd.filter(f => f.uri.scheme !== Schemas.file && (f.uri.scheme !== Schemas.vscodeRemote || isEqualAuthority(f.uri.authority, remoteAuthority)));
		}

		// If we are in no-workspace or single-folder workspace, adding folders has to
		// enter a workspace.
		if (state !== WorkbenchState.WORKSPACE) {
			let newWorkspaceFolders = this.contextService.getWorkspace().folders.map(folder => ({ uri: folder.uri }));
			newWorkspaceFolders.splice(typeof index === 'number' ? index : newWorkspaceFolders.length, 0, ...foldersToAdd);
			newWorkspaceFolders = distinct(newWorkspaceFolders, folder => this.uriIdentityService.extUri.getComparisonKey(folder.uri));

			if (state === WorkbenchState.EMPTY && newWorkspaceFolders.length === 0 || state === WorkbenchState.FOLDER && newWorkspaceFolders.length === 1) {
				return; // return if the operation is a no-op for the current state
			}

			return this.createAndEnterWorkspace(newWorkspaceFolders);
		}

		// Delegate addition of folders to workspace service otherwise
		try {
			await this.contextService.addFolders(foldersToAdd, index);
		} catch (error) {
			if (donotNotifyError) {
				throw error;
			}

			this.handleWorkspaceConfigurationEditingError(error);
		}
	}

	async removeFolders(foldersToRemove: URI[], donotNotifyError: boolean = false): Promise<void> {

		// If we are in single-folder state and the opened folder is to be removed,
		// we create an empty workspace and enter it.
		if (this.includesSingleFolderWorkspace(foldersToRemove)) {
			return this.createAndEnterWorkspace([]);
		}

		// Delegate removal of folders to workspace service otherwise
		try {
			await this.contextService.removeFolders(foldersToRemove);
		} catch (error) {
			if (donotNotifyError) {
				throw error;
			}

			this.handleWorkspaceConfigurationEditingError(error);
		}
	}

	private includesSingleFolderWorkspace(folders: URI[]): boolean {
		if (this.contextService.getWorkbenchState() === WorkbenchState.FOLDER) {
			const workspaceFolder = this.contextService.getWorkspace().folders[0];
			return (folders.some(folder => this.uriIdentityService.extUri.isEqual(folder, workspaceFolder.uri)));
		}

		return false;
	}

	async createAndEnterWorkspace(folders: IWorkspaceFolderCreationData[], path?: URI): Promise<void> {
		if (path && !await this.isValidTargetWorkspacePath(path)) {
			return;
		}

		const remoteAuthority = this.environmentService.remoteAuthority;
		const untitledWorkspace = await this.workspacesService.createUntitledWorkspace(folders, remoteAuthority);
		if (path) {
			try {
				await this.saveWorkspaceAs(untitledWorkspace, path);
			} finally {
				await this.workspacesService.deleteUntitledWorkspace(untitledWorkspace); // https://github.com/microsoft/vscode/issues/100276
			}
		} else {
			path = untitledWorkspace.configPath;
		}

		return this.enterWorkspace(path);
	}

	async saveAndEnterWorkspace(path: URI): Promise<void> {
		const workspaceIdentifier = this.getCurrentWorkspaceIdentifier();
		if (!workspaceIdentifier) {
			return;
		}

		// Allow to save the workspace of the current window
		if (isEqual(workspaceIdentifier.configPath, path)) {
			return this.saveWorkspace(workspaceIdentifier);
		}

		// From this moment on we require a valid target that is not opened already
		if (!await this.isValidTargetWorkspacePath(path)) {
			return;
		}

		await this.saveWorkspaceAs(workspaceIdentifier, path);

		return this.enterWorkspace(path);
	}

	async isValidTargetWorkspacePath(path: URI): Promise<boolean> {
		return true; // OK
	}

	protected async saveWorkspaceAs(workspace: IWorkspaceIdentifier, targetConfigPathURI: URI): Promise<void> {
		const configPathURI = workspace.configPath;

		// Return early if target is same as source
		if (this.uriIdentityService.extUri.isEqual(configPathURI, targetConfigPathURI)) {
			return;
		}

		const isFromUntitledWorkspace = isUntitledWorkspace(configPathURI, this.environmentService);

		// Read the contents of the workspace file, update it to new location and save it.
		const raw = await this.fileService.readFile(configPathURI);
		const newRawWorkspaceContents = rewriteWorkspaceFileForNewLocation(raw.value.toString(), configPathURI, isFromUntitledWorkspace, targetConfigPathURI);
		await this.textFileService.create(targetConfigPathURI, newRawWorkspaceContents, { overwrite: true });
	}

	protected async saveWorkspace(workspace: IWorkspaceIdentifier): Promise<void> {
		const configPathURI = workspace.configPath;

		// First: try to save any existing model as it could be dirty
		const existingModel = this.textFileService.files.get(configPathURI);
		if (existingModel) {
			await existingModel.save({ force: true, reason: SaveReason.EXPLICIT });
			return;
		}

		// Second: if the file exists on disk, simply return
		const workspaceFileExists = await this.fileService.exists(configPathURI);
		if (workspaceFileExists) {
			return;
		}

		// Finally, we need to re-create the file as it was deleted
		const newWorkspace: IStoredWorkspace = { folders: [] };
		const newRawWorkspaceContents = rewriteWorkspaceFileForNewLocation(JSON.stringify(newWorkspace, null, '\t'), configPathURI, false, configPathURI);
		await this.textFileService.create(configPathURI, newRawWorkspaceContents);
	}

	private handleWorkspaceConfigurationEditingError(error: JSONEditingError): void {
		switch (error.code) {
			case JSONEditingErrorCode.ERROR_INVALID_FILE:
				this.onInvalidWorkspaceConfigurationFileError();
				break;
			case JSONEditingErrorCode.ERROR_FILE_DIRTY:
				this.onWorkspaceConfigurationFileDirtyError();
				break;
			default:
				this.notificationService.error(error.message);
		}
	}

	private onInvalidWorkspaceConfigurationFileError(): void {
		const message = nls.localize('errorInvalidTaskConfiguration', "Unable to write into workspace configuration file. Please open the file to correct errors/warnings in it and try again.");
		this.askToOpenWorkspaceConfigurationFile(message);
	}

	private onWorkspaceConfigurationFileDirtyError(): void {
		const message = nls.localize('errorWorkspaceConfigurationFileDirty', "Unable to write into workspace configuration file because the file is dirty. Please save it and try again.");
		this.askToOpenWorkspaceConfigurationFile(message);
	}

	private askToOpenWorkspaceConfigurationFile(message: string): void {
		this.notificationService.prompt(Severity.Error, message,
			[{
				label: nls.localize('openWorkspaceConfigurationFile', "Open Workspace Configuration"),
				run: () => this.commandService.executeCommand('workbench.action.openWorkspaceConfigFile')
			}]
		);
	}

	abstract enterWorkspace(path: URI): Promise<void>;

	protected async doEnterWorkspace(path: URI): Promise<IEnterWorkspaceResult | null> {
		if (!!this.environmentService.extensionTestsLocationURI) {
			throw new Error('Entering a new workspace is not possible in tests.');
		}

		const workspace = await this.workspacesService.getWorkspaceIdentifier(path);

		// Settings migration (only if we come from a folder workspace)
		if (this.contextService.getWorkbenchState() === WorkbenchState.FOLDER) {
			await this.migrateWorkspaceSettings(workspace);
		}

		const workspaceImpl = this.contextService as WorkspaceService;
		await workspaceImpl.initialize(workspace);

		return this.workspacesService.enterWorkspace(path);
	}

	private migrateWorkspaceSettings(toWorkspace: IWorkspaceIdentifier): Promise<void> {
		return this.doCopyWorkspaceSettings(toWorkspace, setting => setting.scope === ConfigurationScope.WINDOW);
	}

	copyWorkspaceSettings(toWorkspace: IWorkspaceIdentifier): Promise<void> {
		return this.doCopyWorkspaceSettings(toWorkspace);
	}

	private doCopyWorkspaceSettings(toWorkspace: IWorkspaceIdentifier, filter?: (config: IConfigurationPropertySchema) => boolean): Promise<void> {
		const configurationProperties = Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).getConfigurationProperties();
		const targetWorkspaceConfiguration: any = {};
		for (const key of this.configurationService.keys().workspace) {
			if (configurationProperties[key]) {
				if (filter && !filter(configurationProperties[key])) {
					continue;
				}

				targetWorkspaceConfiguration[key] = this.configurationService.inspect(key).workspaceValue;
			}
		}

		return this.jsonEditingService.write(toWorkspace.configPath, [{ path: ['settings'], value: targetWorkspaceConfiguration }], true);
	}

	protected getCurrentWorkspaceIdentifier(): IWorkspaceIdentifier | undefined {
		const workspace = this.contextService.getWorkspace();
		if (workspace?.configuration) {
			return { id: workspace.id, configPath: workspace.configuration };
		}

		return undefined;
	}
}
