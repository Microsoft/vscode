/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkingCopyBackupService } from 'vs/workbench/services/workingCopy/common/workingCopyBackup';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IFilesConfigurationService } from 'vs/workbench/services/filesConfiguration/common/filesConfigurationService';
import { IWorkingCopyService } from 'vs/workbench/services/workingCopy/common/workingCopyService';
import { ILifecycleService, ShutdownReason } from 'vs/workbench/services/lifecycle/common/lifecycle';
import { ILogService } from 'vs/platform/log/common/log';
import { WorkingCopyBackupTracker } from 'vs/workbench/services/workingCopy/common/workingCopyBackupTracker';
import { IWorkingCopyEditorService } from 'vs/workbench/services/workingCopy/common/workingCopyEditorService';
import { IEditorService } from 'vs/workbench/services/editor/common/editorService';

export class BrowserWorkingCopyBackupTracker extends WorkingCopyBackupTracker implements IWorkbenchContribution {

	constructor(
		@IWorkingCopyBackupService workingCopyBackupService: IWorkingCopyBackupService,
		@IFilesConfigurationService filesConfigurationService: IFilesConfigurationService,
		@IWorkingCopyService workingCopyService: IWorkingCopyService,
		@ILifecycleService lifecycleService: ILifecycleService,
		@ILogService logService: ILogService,
		@IWorkingCopyEditorService workingCopyEditorService: IWorkingCopyEditorService,
		@IEditorService editorService: IEditorService
	) {
		super(workingCopyBackupService, workingCopyService, logService, lifecycleService, filesConfigurationService, workingCopyEditorService, editorService);
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
			if (!this.workingCopyBackupService.hasBackupSync(dirtyWorkingCopy, this.getContentVersion(dirtyWorkingCopy))) {
				this.logService.warn('Unload veto: pending backups');

				return true; // dirty without backup: veto
			}
		}

		return false; // dirty with backups: no veto
	}
}
