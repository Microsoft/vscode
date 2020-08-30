/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IUserDataSyncUtilService, SyncStatus, UserDataSyncError, UserDataSyncErrorCode, IUserDataAutoSyncService } from 'vs/platform/userDataSync/common/userDataSync';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { ISharedProcessService } from 'vs/platform/ipc/electron-browser/sharedProcessService';
import { UserDataSycnUtilServiceChannel } from 'vs/platform/userDataSync/common/userDataSyncIpc';
import { registerAction2, Action2, MenuId } from 'vs/platform/actions/common/actions';
import { localize } from 'vs/nls';
import { ServicesAccessor } from 'vs/platform/instantiation/common/instantiation';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { Action } from 'vs/base/common/actions';
import { IWorkbenchIssueService } from 'vs/workbench/contrib/issue/electron-browser/issue';
import { Disposable } from 'vs/base/common/lifecycle';
import { ICommandService } from 'vs/platform/commands/common/commands';
import { CONTEXT_SYNC_STATE, SHOW_SYNC_LOG_COMMAND_ID, SYNC_TITLE } from 'vs/workbench/services/userDataSync/common/userDataSync';

class UserDataSyncServicesContribution implements IWorkbenchContribution {

	constructor(
		@IUserDataSyncUtilService userDataSyncUtilService: IUserDataSyncUtilService,
		@ISharedProcessService sharedProcessService: ISharedProcessService,
	) {
		sharedProcessService.registerChannel('userDataSyncUtil', new UserDataSycnUtilServiceChannel(userDataSyncUtilService));
	}
}

class UserDataSyncReportIssueContribution extends Disposable implements IWorkbenchContribution {

	constructor(
		@IUserDataAutoSyncService userDataAutoSyncService: IUserDataAutoSyncService,
		@INotificationService private readonly notificationService: INotificationService,
		@IWorkbenchIssueService private readonly workbenchIssueService: IWorkbenchIssueService,
		@ICommandService private readonly commandService: ICommandService,
	) {
		super();
		this._register(userDataAutoSyncService.onError(error => this.onAutoSyncError(error)));
	}

	private onAutoSyncError(error: UserDataSyncError): void {
		switch (error.code) {
			case UserDataSyncErrorCode.LocalTooManyRequests:
			case UserDataSyncErrorCode.TooManyRequests:
				const operationId = error.operationId ? localize('operationId', "Operation Id: {0}", error.operationId) : undefined;
				const message = localize({ key: 'too many requests', comment: ['Settings Sync is the name of the feature'] }, "Settings sync is disabled because the current device is making too many requests. Please report an issue by providing the sync logs.");
				this.notificationService.notify({
					severity: Severity.Error,
					message: operationId ? `${message} ${operationId}` : message,
					source: error.operationId ? localize('settings sync', "Settings Sync. Operation Id: {0}", error.operationId) : undefined,
					actions: {
						primary: [
							new Action('Show Sync Logs', localize('show sync logs', "Show Log"), undefined, true, () => this.commandService.executeCommand(SHOW_SYNC_LOG_COMMAND_ID)),
							new Action('Report Issue', localize('report issue', "Report Issue"), undefined, true, () => this.workbenchIssueService.openReporter())
						]
					}
				});
				return;
		}
	}
}

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(UserDataSyncServicesContribution, LifecyclePhase.Starting);
workbenchRegistry.registerWorkbenchContribution(UserDataSyncReportIssueContribution, LifecyclePhase.Restored);

registerAction2(class OpenSyncBackupsFolder extends Action2 {
	constructor() {
		super({
			id: 'workbench.userData.actions.openSyncBackupsFolder',
			title: { value: localize('Open Backup folder', "Open Local Backups Folder"), original: 'Open Local Backups Folder' },
			category: { value: SYNC_TITLE, original: `Settings Sync` },
			menu: {
				id: MenuId.CommandPalette,
				when: CONTEXT_SYNC_STATE.notEqualsTo(SyncStatus.Uninitialized),
			}
		});
	}
	async run(accessor: ServicesAccessor): Promise<void> {
		const syncHome = accessor.get(IEnvironmentService).userDataSyncHome;
		const electronService = accessor.get(IElectronService);
		const fileService = accessor.get(IFileService);
		const notificationService = accessor.get(INotificationService);
		if (await fileService.exists(syncHome)) {
			const folderStat = await fileService.resolve(syncHome);
			const item = folderStat.children && folderStat.children[0] ? folderStat.children[0].resource : syncHome;
			return electronService.showItemInFolder(item.fsPath);
		} else {
			notificationService.info(localize('no backups', "Local backups folder does not exist"));
		}
	}
});
