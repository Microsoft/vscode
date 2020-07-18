/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from 'vs/nls';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IFilesConfigurationService, AutoSaveMode } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IWorkingCopyService, IWorkingCopy, WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { ILifecycleService, LifecyclePhase, ShutdownReason } from 'vs/platform/lifecycle/common/lifecycle';
import { ConfirmResult, IFileDialogService, IDialogService } from 'vs/platform/dialogs/common/dialogs';
import Severity from 'vs/base/common/severity';
import { WorkbenchState, IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { isMacintosh } from 'vs/base/common/platform';
import { HotExitConfiguration } from 'vs/platform/files/common/files';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { BackupTracker } from 'vs/workbench/contrib/backup/common/backupTracker';
import { ILogService } from 'vs/platform/log/common/log';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { SaveReason } from 'vs/workbench/common/editor';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';

export class NativeBackupTracker extends BackupTracker implements IWorkbenchContribution {

	constructor(
		@IBackupFileService backupFileService: IBackupFileService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@IFileDialogService private readonly fileDialogService: IFileDialogService,
		@IDialogService private readonly dialogService: IDialogService,
		@IWorkspaceContextService private readonly contextService: IWorkspaceContextService,
		@IElectronService private readonly electronService: IElectronService,
		@ILogService logService: ILogService,
		@IEditorService private readonly editorService: IEditorService,
		@IEnvironmentService private readonly environmentService: IEnvironmentService
	) {
		super(backupFileService, filesConfigurationService, workingCopyService, logService, lifecycleService);
	}

	protected onBeforeShutdown(reason: ShutdownReason): boolean | Promise<boolean> {

		// Dirty working copies need treatment on shutdown
		const dirtyWorkingCopies = this.workingCopyService.dirtyWorkingCopies;
		if (dirtyWorkingCopies.length) {
			return this.onBeforeShutdownWithDirty(reason, dirtyWorkingCopies);
		}

		// No dirty working copies
		return this.onBeforeShutdownWithoutDirty();
	}

	protected async onBeforeShutdownWithDirty(reason: ShutdownReason, workingCopies: IWorkingCopy[]): Promise<boolean> {

		// If auto save is enabled, save all non-untitled working copies
		// and then check again for dirty copies
		if (this.filesConfigurationService.getAutoSaveMode() !== AutoSaveMode.OFF) {

			// Save all files
			await this.doSaveAllBeforeShutdown(false /* not untitled */, SaveReason.AUTO);

			// If we still have dirty working copies, we either have untitled ones or working copies that cannot be saved
			const remainingDirtyWorkingCopies = this.workingCopyService.dirtyWorkingCopies;
			if (remainingDirtyWorkingCopies.length) {
				return this.handleDirtyBeforeShutdown(remainingDirtyWorkingCopies, reason);
			}

			return false; // no veto (there are no remaining dirty working copies)
		}

		// Auto save is not enabled
		return this.handleDirtyBeforeShutdown(workingCopies, reason);
	}

	private async handleDirtyBeforeShutdown(workingCopies: IWorkingCopy[], reason: ShutdownReason): Promise<boolean> {

		// Trigger backup if configured
		let backups: IWorkingCopy[] = [];
		let backupError: Error | undefined = undefined;
		if (this.filesConfigurationService.isHotExitEnabled) {
			try {
				backups = await this.backupBeforeShutdown(workingCopies, reason);
				if (backups.length === workingCopies.length) {
					return false; // no veto (backup was successful for all working copies)
				}
			} catch (error) {
				backupError = error;
			}
		}

		// we ran a backup but received an error that we show to the user
		if (backupError) {
			this.showErrorDialog(localize('backupTrackerBackupFailed', "One or more dirty editors could not be saved to the back up location."), backupError);

			return true; // veto (the backup failed)
		}

		// since a backup did not happen, we have to confirm for
		// the working copies that did not successfully backup
		try {
			return await this.confirmBeforeShutdown(workingCopies.filter(workingCopy => !backups.includes(workingCopy)));
		} catch (error) {
			this.showErrorDialog(localize('backupTrackerConfirmFailed', "One or more dirty editors could not be saved or reverted."), error);

			return true; // veto (save or revert failed)
		}
	}

	private showErrorDialog(msg: string, error?: Error): void {
		this.dialogService.show(Severity.Error, msg, [localize('ok', 'OK')], { detail: localize('backupErrorDetails', "Try saving or reverting the dirty editors first and then try again.") });

		this.logService.error(error ? `[backup tracker] ${msg}: ${error}` : `[backup tracker] ${msg}`);
	}

	private async backupBeforeShutdown(workingCopies: IWorkingCopy[], reason: ShutdownReason): Promise<IWorkingCopy[]> {

		// When quit is requested skip the confirm callback and attempt to backup all workspaces.
		// When quit is not requested the confirm callback should be shown when the window being
		// closed is the only VS Code window open, except for on Mac where hot exit is only
		// ever activated when quit is requested.

		let doBackup: boolean | undefined;
		if (this.environmentService.isExtensionDevelopment) {
			doBackup = true; // always backup closing extension development window without asking to speed up debugging
		} else {
			switch (reason) {
				case ShutdownReason.CLOSE:
					if (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY && this.filesConfigurationService.hotExitConfiguration === HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE) {
						doBackup = true; // backup if a folder is open and onExitAndWindowClose is configured
					} else if (await this.electronService.getWindowCount() > 1 || isMacintosh) {
						doBackup = false; // do not backup if a window is closed that does not cause quitting of the application
					} else {
						doBackup = true; // backup if last window is closed on win/linux where the application quits right after
					}
					break;

				case ShutdownReason.QUIT:
					doBackup = true; // backup because next start we restore all backups
					break;

				case ShutdownReason.RELOAD:
					doBackup = true; // backup because after window reload, backups restore
					break;

				case ShutdownReason.LOAD:
					if (this.contextService.getWorkbenchState() !== WorkbenchState.EMPTY && this.filesConfigurationService.hotExitConfiguration === HotExitConfiguration.ON_EXIT_AND_WINDOW_CLOSE) {
						doBackup = true; // backup if a folder is open and onExitAndWindowClose is configured
					} else {
						doBackup = false; // do not backup because we are switching contexts
					}
					break;
			}
		}

		// Perform a backup of all dirty working copies unless a backup already exists
		const backups: IWorkingCopy[] = [];
		if (doBackup) {
			await Promise.all(workingCopies.map(async workingCopy => {
				const contentVersion = this.getContentVersion(workingCopy);

				// Backup exists
				if (this.backupFileService.hasBackupSync(workingCopy.resource, contentVersion)) {
					backups.push(workingCopy);
				}

				// Backup does not exist
				else {
					const backup = await workingCopy.backup();
					await this.backupFileService.backup(workingCopy.resource, backup.content, contentVersion, backup.meta);

					backups.push(workingCopy);
				}
			}));
		}

		return backups;
	}

	private async confirmBeforeShutdown(workingCopies: IWorkingCopy[]): Promise<boolean> {

		// Save
		const confirm = await this.fileDialogService.showSaveConfirm(workingCopies.map(workingCopy => workingCopy.name));
		if (confirm === ConfirmResult.SAVE) {
			const dirtyCountBeforeSave = this.workingCopyService.dirtyCount;
			await this.doSaveAllBeforeShutdown(workingCopies, SaveReason.EXPLICIT);

			const savedWorkingCopies = dirtyCountBeforeSave - this.workingCopyService.dirtyCount;
			if (savedWorkingCopies < workingCopies.length) {
				return true; // veto (save failed or was canceled)
			}

			return this.noVeto(workingCopies); // no veto (dirty saved)
		}

		// Don't Save
		else if (confirm === ConfirmResult.DONT_SAVE) {
			await this.doRevertAllBeforeShutdown(workingCopies);

			return this.noVeto(workingCopies); // no veto (dirty reverted)
		}

		// Cancel
		return true; // veto (user canceled)
	}

	private async doSaveAllBeforeShutdown(workingCopies: IWorkingCopy[], reason: SaveReason): Promise<void>;
	private async doSaveAllBeforeShutdown(includeUntitled: boolean, reason: SaveReason): Promise<void>;
	private async doSaveAllBeforeShutdown(arg1: IWorkingCopy[] | boolean, reason: SaveReason): Promise<void> {
		const workingCopies = Array.isArray(arg1) ? arg1 : this.workingCopyService.dirtyWorkingCopies.filter(workingCopy => {
			if (arg1 === false && (workingCopy.capabilities & WorkingCopyCapabilities.Untitled)) {
				return false; // skip untitled unless explicitly included
			}

			return true;
		});

		// Skip save participants on shutdown for performance reasons
		const saveOptions = { skipSaveParticipants: true, reason };

		// First save through the editor service if we save all to benefit
		// from some extras like switching to untitled dirty editors before saving.
		let result: boolean | undefined = undefined;
		if (typeof arg1 === 'boolean' || workingCopies.length === this.workingCopyService.dirtyCount) {
			result = await this.editorService.saveAll({ includeUntitled: typeof arg1 === 'boolean' ? arg1 : true, ...saveOptions });
		}

		// If we still have dirty working copies, save those directly
		// unless the save was not successful (e.g. cancelled)
		if (result !== false) {
			await Promise.all(workingCopies.map(workingCopy => workingCopy.isDirty() ? workingCopy.save(saveOptions) : true));
		}
	}

	private async doRevertAllBeforeShutdown(workingCopies: IWorkingCopy[]): Promise<void> {

		// Soft revert is good enough on shutdown
		const revertOptions = { soft: true };

		// First revert through the editor service if we revert all
		if (workingCopies.length === this.workingCopyService.dirtyCount) {
			await this.editorService.revertAll(revertOptions);
		}

		// If we still have dirty working copies, revert those directly
		// unless the revert operation was not successful (e.g. cancelled)
		await Promise.all(workingCopies.map(workingCopy => workingCopy.isDirty() ? workingCopy.revert(revertOptions) : undefined));
	}

	private noVeto(backupsToDiscard: IWorkingCopy[]): boolean | Promise<boolean> {
		if (this.lifecycleService.phase < LifecyclePhase.Restored) {
			return false; // if editors have not restored, we are not up to speed with backups and thus should not discard them
		}

		return Promise.all(backupsToDiscard.map(workingCopy => this.backupFileService.discardBackup(workingCopy.resource))).then(() => false, () => false);
	}

	private async onBeforeShutdownWithoutDirty(): Promise<boolean> {
		// If we have proceeded enough that editors and dirty state
		// has restored, we make sure that no backups lure around
		// given we have no known dirty working copy. This helps
		// to clean up stale backups as for example reported in
		// https://github.com/microsoft/vscode/issues/92962
		if (this.lifecycleService.phase >= LifecyclePhase.Restored) {
			try {
				await this.backupFileService.discardBackups();
			} catch (error) {
				this.logService.error(`[backup tracker] error discarding backups: ${error}`);
			}
		}

		return false; // no veto (no dirty)
	}
}
