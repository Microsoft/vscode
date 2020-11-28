/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkspaceEditingService } from 'vs/workbench/services/workspaces/common/workspaceEditing';
import { URI } from 'vs/base/common/uri';
import * as nls from 'vs/nls';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { IJSONEditingService } from 'vs/workbench/services/configuration/common/jsonEditing';
import { IWorkspacesService, isUntitledWorkspace, IWorkspaceIdentifier, hasWorkspaceFileExtension } from 'vs/platform/workspaces/common/workspaces';
import { WorkspaceService } from 'vs/workbench/services/configuration/browser/configurationService';
import { IStorageService } from 'vs/platform/storage/common/storage';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { basename } from 'vs/base/common/resources';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { IFileService } from 'vs/platform/files/common/files';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';
import { ILifecycleService, ShutdownReason } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { IFileDialogService, IDialogService } from 'vs/platform/dialogs/common/dialogs';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { ILabelService } from 'vs/platform/label/common/label';
import { ITextFileService } from 'vs/workbench/services/textfile/common/textfiles';
import { IHostService } from 'vs/workbench/services/host/browser/host';
import { AbstractWorkspaceEditingService } from 'vs/workbench/services/workspaces/browser/abstractWorkspaceEditingService';
import { INativeHostService } from 'vs/platform/native/electron-sandbox/native';
import { isMacintosh } from 'vs/base/common/platform';
import { mnemonicButtonLabel } from 'vs/base/common/labels';
import { BackupFileService } from 'vs/workbench/services/backup/common/backupFileService';
import { IUriIdentityService } from 'vs/workbench/services/uriIdentity/common/uriIdentity';

export class NativeWorkspaceEditingService extends AbstractWorkspaceEditingService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IJSONEditingService jsonEditingService: IJSONEditingService,
		@IWorkspaceContextService contextService: WorkspaceService,
		@INativeHostService private nativeHostService: INativeHostService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService private storageService: IStorageService,
		@IExtensionService private extensionService: IExtensionService,
		@IBackupFileService private backupFileService: IBackupFileService,
		@INotificationService notificationService: INotificationService,
		@ICommandService commandService: ICommandService,
		@IFileService fileService: IFileService,
		@ITextFileService textFileService: ITextFileService,
		@IWorkspacesService workspacesService: IWorkspacesService,
		@INativeWorkbenchEnvironmentService protected environmentService: INativeWorkbenchEnvironmentService,
		@IFileDialogService fileDialogService: IFileDialogService,
		@IDialogService protected dialogService: IDialogService,
		@ILifecycleService private readonly lifecycleService: ILifecycleService,
		@ILabelService private readonly labelService: ILabelService,
		@IHostService hostService: IHostService,
		@IUriIdentityService uriIdentityService: IUriIdentityService
	) {
		super(jsonEditingService, contextService, configurationService, notificationService, commandService, fileService, textFileService, workspacesService, environmentService, fileDialogService, dialogService, hostService, uriIdentityService);

		this.registerListeners();
	}

	private registerListeners(): void {
		this.lifecycleService.onBeforeShutdown(e => {
			const saveOperation = this.saveUntitledBeforeShutdown(e.reason);
			if (saveOperation) {
				e.veto(saveOperation);
			}
		});
	}

	private async saveUntitledBeforeShutdown(reason: ShutdownReason): Promise<boolean> {
		if (reason !== ShutdownReason.LOAD && reason !== ShutdownReason.CLOSE) {
			return false; // only interested when window is closing or loading
		}

		const workspaceIdentifier = this.getCurrentWorkspaceIdentifier();
		if (!workspaceIdentifier || !isUntitledWorkspace(workspaceIdentifier.configPath, this.environmentService)) {
			return false; // only care about untitled workspaces to ask for saving
		}

		const windowCount = await this.nativeHostService.getWindowCount();
		if (reason === ShutdownReason.CLOSE && !isMacintosh && windowCount === 1) {
			return false; // Windows/Linux: quits when last window is closed, so do not ask then
		}

		enum ConfirmResult {
			SAVE,
			DONT_SAVE,
			CANCEL
		}

		const buttons: { label: string; result: ConfirmResult; }[] = [
			{ label: mnemonicButtonLabel(nls.localize('save', "Save")), result: ConfirmResult.SAVE },
			{ label: mnemonicButtonLabel(nls.localize('doNotSave', "Don't Save")), result: ConfirmResult.DONT_SAVE },
			{ label: nls.localize('cancel', "Cancel"), result: ConfirmResult.CANCEL }
		];
		const message = nls.localize('saveWorkspaceMessage', "Do you want to save your workspace configuration as a file?");
		const detail = nls.localize('saveWorkspaceDetail', "Save your workspace if you plan to open it again.");
		const cancelId = 2;

		const { choice } = await this.dialogService.show(Severity.Warning, message, buttons.map(button => button.label), { detail, cancelId });

		switch (buttons[choice].result) {

			// Cancel: veto unload
			case ConfirmResult.CANCEL:
				return true;

			// Don't Save: delete workspace
			case ConfirmResult.DONT_SAVE:
				this.workspacesService.deleteUntitledWorkspace(workspaceIdentifier);
				return false;

			// Save: save workspace, but do not veto unload if path provided
			case ConfirmResult.SAVE: {
				const newWorkspacePath = await this.pickNewWorkspacePath();
				if (!newWorkspacePath || !hasWorkspaceFileExtension(newWorkspacePath)) {
					return true; // keep veto if no target was provided
				}

				try {
					await this.saveWorkspaceAs(workspaceIdentifier, newWorkspacePath);

					// Make sure to add the new workspace to the history to find it again
					const newWorkspaceIdentifier = await this.workspacesService.getWorkspaceIdentifier(newWorkspacePath);
					this.workspacesService.addRecentlyOpened([{
						label: this.labelService.getWorkspaceLabel(newWorkspaceIdentifier, { verbose: true }),
						workspace: newWorkspaceIdentifier
					}]);

					// Delete the untitled one
					this.workspacesService.deleteUntitledWorkspace(workspaceIdentifier);
				} catch (error) {
					// ignore
				}

				return false;
			}
		}
	}

	async isValidTargetWorkspacePath(path: URI): Promise<boolean> {
		const windows = await this.nativeHostService.getWindows();

		// Prevent overwriting a workspace that is currently opened in another window
		if (windows.some(window => !!window.workspace && this.uriIdentityService.extUri.isEqual(window.workspace.configPath, path))) {
			await this.dialogService.show(
				Severity.Info,
				nls.localize('workspaceOpenedMessage', "Unable to save workspace '{0}'", basename(path)),
				[nls.localize('ok', "OK")],
				{
					detail: nls.localize('workspaceOpenedDetail', "The workspace is already opened in another window. Please close that window first and then try again.")
				}
			);

			return false;
		}

		return true; // OK
	}

	async enterWorkspace(path: URI): Promise<void> {
		const result = await this.doEnterWorkspace(path);
		if (result) {

			// Migrate storage to new workspace
			await this.migrateStorage(result.workspace);

			// Reinitialize backup service
			if (this.backupFileService instanceof BackupFileService) {
				const newBackupWorkspaceHome = result.backupPath ? URI.file(result.backupPath).with({ scheme: this.environmentService.userRoamingDataHome.scheme }) : undefined;
				this.backupFileService.reinitialize(newBackupWorkspaceHome);
			}
		}

		// TODO@aeschli: workaround until restarting works
		if (this.environmentService.remoteAuthority) {
			this.hostService.reload();
		}

		// Restart the extension host: entering a workspace means a new location for
		// storage and potentially a change in the workspace.rootPath property.
		else {
			this.extensionService.restartExtensionHost();
		}
	}

	private migrateStorage(toWorkspace: IWorkspaceIdentifier): Promise<void> {
		return this.storageService.migrate(toWorkspace);
	}
}

registerSingleton(IWorkspaceEditingService, NativeWorkspaceEditingService, true);
