/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { Disposable, IDisposable, dispose, toDisposable } from 'vs/base/common/lifecycle';
import { IFilesConfigurationService, IAutoSaveConfiguration } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IWorkingCopyService, IWorkingCopy, WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { ILogService } from 'vs/platform/log/common/log';
import { ShutdownReason, ILifecycleService } from 'vs/platform/lifecycle/common/lifecycle';

export abstract class BackupTracker extends Disposable {

	// Disable backup for when a short auto-save delay is configured with
	// the rationale that the auto save will trigger a save periodically
	// anway and thus creating frequent backups is not useful
	//
	// This will only apply to working copies that are not untitled where
	// auto save is actually saving.
	private static DISABLE_BACKUP_AUTO_SAVE_THRESHOLD = 1500;

	// Delay creation of backups when content changes to avoid too much
	// load on the backup service when the user is typing into the editor
	protected static BACKUP_FROM_CONTENT_CHANGE_DELAY = 1000;

	// A map from working copy to a version ID we compute on each content
	// change. This version ID allows to e.g. ask if a backup for a specific
	// content has been made before closing.
	private readonly mapWorkingCopyToContentVersion = new Map<IWorkingCopy, number>();

	private backupsDisabledForAutoSaveables = false;

	// A map of scheduled pending backups for working copies
	private readonly pendingBackups = new Map<IWorkingCopy, IDisposable>();

	constructor(
		protected readonly backupFileService: IBackupFileService,
		protected readonly filesConfigurationService: IFilesConfigurationService,
		protected readonly workingCopyService: IWorkingCopyService,
		protected readonly logService: ILogService,
		protected readonly lifecycleService: ILifecycleService
	) {
		super();

		// Figure out initial auto save config
		this.onAutoSaveConfigurationChange(filesConfigurationService.getAutoSaveConfiguration());

		// Fill in initial dirty working copies
		this.workingCopyService.dirtyWorkingCopies.forEach(workingCopy => this.onDidRegister(workingCopy));

		this.registerListeners();
	}

	private registerListeners() {

		// Working Copy events
		this._register(this.workingCopyService.onDidRegister(workingCopy => this.onDidRegister(workingCopy)));
		this._register(this.workingCopyService.onDidUnregister(workingCopy => this.onDidUnregister(workingCopy)));
		this._register(this.workingCopyService.onDidChangeDirty(workingCopy => this.onDidChangeDirty(workingCopy)));
		this._register(this.workingCopyService.onDidChangeContent(workingCopy => this.onDidChangeContent(workingCopy)));

		// Listen to auto save config changes
		this._register(this.filesConfigurationService.onAutoSaveConfigurationChange(c => this.onAutoSaveConfigurationChange(c)));

		// Lifecycle (handled in subclasses)
		this.lifecycleService.onBeforeShutdown(event => event.veto(this.onBeforeShutdown(event.reason)));
	}

	private onDidRegister(workingCopy: IWorkingCopy): void {
		if (workingCopy.isDirty()) {
			this.scheduleBackup(workingCopy);
		}
	}

	private onDidUnregister(workingCopy: IWorkingCopy): void {

		// Remove from content version map
		this.mapWorkingCopyToContentVersion.delete(workingCopy);

		// Discard backup
		this.discardBackup(workingCopy);
	}

	private onDidChangeDirty(workingCopy: IWorkingCopy): void {
		if (workingCopy.isDirty()) {
			this.scheduleBackup(workingCopy);
		} else {
			this.discardBackup(workingCopy);
		}
	}

	private onDidChangeContent(workingCopy: IWorkingCopy): void {

		// Increment content version ID
		const contentVersionId = this.getContentVersion(workingCopy);
		this.mapWorkingCopyToContentVersion.set(workingCopy, contentVersionId + 1);

		// Schedule backup if dirty
		if (workingCopy.isDirty()) {
			// this listener will make sure that the backup is
			// pushed out for as long as the user is still changing
			// the content of the working copy.
			this.scheduleBackup(workingCopy);
		}
	}

	private onAutoSaveConfigurationChange(configuration: IAutoSaveConfiguration): void {
		this.backupsDisabledForAutoSaveables = typeof configuration.autoSaveDelay === 'number' && configuration.autoSaveDelay < BackupTracker.DISABLE_BACKUP_AUTO_SAVE_THRESHOLD;
	}

	private scheduleBackup(workingCopy: IWorkingCopy): void {
		if (this.backupsDisabledForAutoSaveables && !(workingCopy.capabilities & WorkingCopyCapabilities.Untitled)) {
			return; // skip if auto save is enabled with a short delay
		}

		// Clear any running backup operation
		dispose(this.pendingBackups.get(workingCopy));
		this.pendingBackups.delete(workingCopy);

		this.logService.trace(`[backup tracker] scheduling backup`, workingCopy.resource.toString());

		// Schedule new backup
		const handle = setTimeout(async () => {

			// Clear disposable
			this.pendingBackups.delete(workingCopy);

			// Backup if dirty
			if (workingCopy.isDirty()) {
				this.logService.trace(`[backup tracker] running backup`, workingCopy.resource.toString());

				const backup = await workingCopy.backup();
				this.backupFileService.backup(workingCopy.resource, backup.content, this.getContentVersion(workingCopy), backup.meta);
			}
		}, BackupTracker.BACKUP_FROM_CONTENT_CHANGE_DELAY);

		// Keep in map for disposal as needed
		this.pendingBackups.set(workingCopy, toDisposable(() => {
			this.logService.trace(`[backup tracker] clearing pending backup`, workingCopy.resource.toString());

			clearTimeout(handle);
		}));
	}

	protected getContentVersion(workingCopy: IWorkingCopy): number {
		return this.mapWorkingCopyToContentVersion.get(workingCopy) || 0;
	}

	private discardBackup(workingCopy: IWorkingCopy): void {
		this.logService.trace(`[backup tracker] discarding backup`, workingCopy.resource.toString());

		// Clear any running backup operation
		dispose(this.pendingBackups.get(workingCopy));
		this.pendingBackups.delete(workingCopy);

		// Forward to backup file service
		this.backupFileService.discardBackup(workingCopy.resource);
	}

	protected abstract onBeforeShutdown(reason: ShutdownReason): boolean | Promise<boolean>;
}
