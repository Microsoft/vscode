/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { Disposable, IDisposable, dispose, toDisposable } from 'vs/base/common/lifecycle';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { IWorkingCopy, IWorkingCopyIdentifier, WorkingCopyCapabilities } from 'vs/workbench/services/workingCopy/common/workingCopy';
import { ILogService } from 'vs/platform/log/common/log';
import { ShutdownReason, ILifecycleService, LifecyclePhase } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { CancellationTokenSource } from 'vs/base/common/cancellation';
import { AutoSaveMode, IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IWorkingCopyEditorHandler, IWorkingCopyEditorService } from 'vs/workbench/services/workingCopy/common/workingCopyEditorService';
import { Promises } from 'vs/base/common/async';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';
import { IEditorInput } from 'vs/workbench/common/editor';
import { EditorOverride } from 'vs/platform/editor/common/editor';

/**
 * The working copy backup tracker deals with:
 * - restoring backups that exist
 * - creating backups for dirty working copies
 * - deleting backups for saved working copies
 * - handling backups on shutdown
 */
export abstract class WorkingCopyBackupTracker extends Disposable {

	constructor(
		protected readonly workingCopyBackupService: IWorkingCopyBackupService,
		protected readonly workingCopyService: IWorkingCopyService,
		protected readonly logService: ILogService,
		private readonly lifecycleService: ILifecycleService,
		protected readonly filesConfigurationService: IFilesConfigurationService,
		private readonly workingCopyEditorService: IWorkingCopyEditorService,
		protected readonly editorService: IEditorService
	) {
		super();

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

		// Lifecycle (handled in subclasses)
		this.lifecycleService.onBeforeShutdown(event => event.veto(this.onBeforeShutdown(event.reason), 'veto.backups'));

		// Once a handler registers, restore backups
		this._register(this.workingCopyEditorService.onDidRegisterHandler(handler => this.restoreBackups(handler)));
	}


	//#region Backup Creator

	// A map from working copy to a version ID we compute on each content
	// change. This version ID allows to e.g. ask if a backup for a specific
	// content has been made before closing.
	private readonly mapWorkingCopyToContentVersion = new Map<IWorkingCopy, number>();

	// A map of scheduled pending backups for working copies
	protected readonly pendingBackups = new Map<IWorkingCopy, IDisposable>();

	// Delay creation of backups when content changes to avoid too much
	// load on the backup service when the user is typing into the editor
	// Since we always schedule a backup, even when auto save is on, we
	// have different scheduling delays based on auto save. This helps to
	// avoid a (not critical but also not really wanted) race between saving
	// (after 1s per default) and making a backup of the working copy.
	private static readonly BACKUP_SCHEDULE_DELAYS = {
		[AutoSaveMode.OFF]: 1000,
		[AutoSaveMode.ON_FOCUS_CHANGE]: 1000,
		[AutoSaveMode.ON_WINDOW_CHANGE]: 1000,
		[AutoSaveMode.AFTER_SHORT_DELAY]: 2000, // explicitly higher to prevent races
		[AutoSaveMode.AFTER_LONG_DELAY]: 1000
	};

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

	private scheduleBackup(workingCopy: IWorkingCopy): void {

		// Clear any running backup operation
		this.cancelBackup(workingCopy);

		this.logService.trace(`[backup tracker] scheduling backup`, workingCopy.resource.toString(true), workingCopy.typeId);

		// Schedule new backup
		const cts = new CancellationTokenSource();
		const handle = setTimeout(async () => {
			if (cts.token.isCancellationRequested) {
				return;
			}

			// Backup if dirty
			if (workingCopy.isDirty()) {
				this.logService.trace(`[backup tracker] creating backup`, workingCopy.resource.toString(true), workingCopy.typeId);

				try {
					const backup = await workingCopy.backup(cts.token);
					if (cts.token.isCancellationRequested) {
						return;
					}

					if (workingCopy.isDirty()) {
						this.logService.trace(`[backup tracker] storing backup`, workingCopy.resource.toString(true), workingCopy.typeId);

						await this.workingCopyBackupService.backup(workingCopy, backup.content, this.getContentVersion(workingCopy), backup.meta, cts.token);
					}
				} catch (error) {
					this.logService.error(error);
				}
			}

			if (cts.token.isCancellationRequested) {
				return;
			}

			// Clear disposable
			this.pendingBackups.delete(workingCopy);

		}, this.getBackupScheduleDelay(workingCopy));

		// Keep in map for disposal as needed
		this.pendingBackups.set(workingCopy, toDisposable(() => {
			this.logService.trace(`[backup tracker] clearing pending backup`, workingCopy.resource.toString(true), workingCopy.typeId);

			cts.dispose(true);
			clearTimeout(handle);
		}));
	}

	protected getBackupScheduleDelay(workingCopy: IWorkingCopy): number {
		let autoSaveMode = this.filesConfigurationService.getAutoSaveMode();
		if (workingCopy.capabilities & WorkingCopyCapabilities.Untitled) {
			autoSaveMode = AutoSaveMode.OFF; // auto-save is never on for untitled working copies
		}

		return WorkingCopyBackupTracker.BACKUP_SCHEDULE_DELAYS[autoSaveMode];
	}

	protected getContentVersion(workingCopy: IWorkingCopy): number {
		return this.mapWorkingCopyToContentVersion.get(workingCopy) || 0;
	}

	private discardBackup(workingCopy: IWorkingCopy): void {
		this.logService.trace(`[backup tracker] discarding backup`, workingCopy.resource.toString(true), workingCopy.typeId);

		// Clear any running backup operation
		this.cancelBackup(workingCopy);

		// Forward to working copy backup service
		this.workingCopyBackupService.discardBackup(workingCopy);
	}

	private cancelBackup(workingCopy: IWorkingCopy): void {
		dispose(this.pendingBackups.get(workingCopy));
		this.pendingBackups.delete(workingCopy);
	}

	protected abstract onBeforeShutdown(reason: ShutdownReason): boolean | Promise<boolean>;

	//#endregion


	//#region Backup Restorer

	protected readonly unrestoredBackups = new Set<IWorkingCopyIdentifier>();
	private readonly whenReady = this.resolveBackupsToRestore();

	private async resolveBackupsToRestore(): Promise<void> {

		// Wait for resolving backups until we are restored to reduce startup pressure
		await this.lifecycleService.when(LifecyclePhase.Restored);

		// Remember each backup that needs to restore
		for (const backup of await this.workingCopyBackupService.getBackups()) {
			this.unrestoredBackups.add(backup);
		}
	}

	protected async restoreBackups(handler: IWorkingCopyEditorHandler): Promise<void> {

		// Wait for backups to be resolved
		await this.whenReady;

		// Figure out already opened editors for backups vs
		// non-opened.
		const openedEditorsForBackups: IEditorInput[] = [];
		const nonOpenedEditorsForBackups: IEditorInput[] = [];

		// Ensure each backup that can be handled has an
		// associated editor.
		const restoredBackups = new Set<IWorkingCopyIdentifier>();
		for (const unrestoredBackup of this.unrestoredBackups) {
			const canHandleUnrestoredBackup = handler.handles(unrestoredBackup);
			if (!canHandleUnrestoredBackup) {
				continue;
			}

			// Collect already opened editors for backup
			let hasOpenedEditorForBackup = false;
			for (const editor of this.editorService.editors) {
				const isUnrestoredBackupOpened = handler.isOpen(unrestoredBackup, editor);
				if (isUnrestoredBackupOpened) {
					openedEditorsForBackups.push(editor);
					hasOpenedEditorForBackup = true;
				}
			}

			// Otherwise, make sure to create at least one editor
			// for the backup to show
			if (!hasOpenedEditorForBackup) {
				nonOpenedEditorsForBackups.push(handler.createEditor(unrestoredBackup));
			}

			// Remember as (potentially) restored
			restoredBackups.add(unrestoredBackup);
		}

		// Ensure editors are opened for each backup without editor
		// in the background without stealing focus
		if (nonOpenedEditorsForBackups.length > 0) {
			await this.editorService.openEditors(nonOpenedEditorsForBackups.map(nonOpenedEditorForBackup => ({
				editor: nonOpenedEditorForBackup,
				options: {
					pinned: true,
					preserveFocus: true,
					inactive: true,
					override: EditorOverride.DISABLED
				}
			})));

			openedEditorsForBackups.push(...nonOpenedEditorsForBackups);
		}

		// Then, resolve each editor to make sure the working copy
		// is loaded and the dirty editor appears properly
		await Promises.settled(openedEditorsForBackups.map(openedEditorsForBackup => openedEditorsForBackup.resolve()));

		// Finally, remove all handled backups from the list
		for (const restoredBackup of restoredBackups) {
			this.unrestoredBackups.delete(restoredBackup);
		}
	}

	//#endregion
}
