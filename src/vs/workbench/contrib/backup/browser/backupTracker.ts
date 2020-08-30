/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { ILifecycleService, ShutdownReason } from 'vs/platform/lifecycle/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { BackupTracker } from 'vs/workbench/contrib/backup/common/backupTracker';

export class BrowserBackupTracker extends BackupTracker implements IWorkbenchContribution {

	constructor(
		@IBackupFileService backupFileService: IBackupFileService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILogService logService: ILogService
	) {
		super(backupFileService, filesConfigurationService, workingCopyService, logService, lifecycleService);
	}

	protected onBeforeShutdown(reason: ShutdownReason): boolean | Promise<boolean> {

		// Web: we cannot perform long running in the shutdown phase
		// As such we need to check sync if there are any dirty working
		// copies that have not been backed up yet and then prevent the
		// shutdown if that is the case.

		const dirtyWorkingCopies = this.workingCopyService.dirtyWorkingCopies;
		if (!dirtyWorkingCopies.length) {
			return false; // no dirty: no veto
		}

		if (!this.filesConfigurationService.isHotExitEnabled) {
			return true; // dirty without backup: veto
		}

		for (const dirtyWorkingCopy of dirtyWorkingCopies) {
			if (!this.backupFileService.hasBackupSync(dirtyWorkingCopy.resource, this.getContentVersion(dirtyWorkingCopy))) {
				console.warn('Unload prevented: pending backups');
				return true; // dirty without backup: veto
			}
		}

		return false; // dirty with backups: no veto
	}
}
