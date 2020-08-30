/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IWorkbenchContributionsRegistry, Extensions as WorkbenchExtensions, IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { Registry } from 'vs/platform/registry/common/platform';
import { LifecyclePhase } from 'vs/platform/lifecycle/common/lifecycle';
import { UserDataSyncWorkbenchContribution } from 'vs/workbench/contrib/userDataSync/browser/userDataSync';
import { IUserDataAutoSyncService, UserDataSyncError, UserDataSyncErrorCode } from 'vs/platform/userDataSync/common/userDataSync';
import { INotificationService, Severity } from 'vs/platform/notification/common/notification';
import { Disposable } from 'vs/base/common/lifecycle';
import { localize } from 'vs/nls';
import { isWeb } from 'vs/base/common/platform';
import { IConfigurationService, ConfigurationTarget } from 'vs/platform/configuration/common/configuration';
import { UserDataSyncTrigger } from 'vs/workbench/contrib/userDataSync/browser/userDataSyncTrigger';

class UserDataSyncReportIssueContribution extends Disposable implements IWorkbenchContribution {

	constructor(
		@IUserDataAutoSyncService userDataAutoSyncService: IUserDataAutoSyncService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();
		this._register(userDataAutoSyncService.onError(error => this.onAutoSyncError(error)));
	}

	private onAutoSyncError(error: UserDataSyncError): void {
		switch (error.code) {
			case UserDataSyncErrorCode.LocalTooManyRequests:
			case UserDataSyncErrorCode.TooManyRequests:
				const operationId = error.operationId ? localize('operationId', "Operation Id: {0}", error.operationId) : undefined;
				const message = localize('too many requests', "Turned off syncing settings on this device because it is making too many requests.");
				this.notificationService.notify({
					severity: Severity.Error,
					message: operationId ? `${message} ${operationId}` : message,
				});
				return;
		}
	}
}

export class UserDataSyncSettingsMigrationContribution implements IWorkbenchContribution {

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService
	) {
		this.migrateSettings();
	}

	private async migrateSettings(): Promise<void> {
		await this.migrateSetting('sync.keybindingsPerPlatform', 'settingsSync.keybindingsPerPlatform');
		await this.migrateSetting('sync.ignoredExtensions', 'settingsSync.ignoredExtensions');
		await this.migrateSetting('sync.ignoredSettings', 'settingsSync.ignoredSettings');
	}

	private async migrateSetting(oldSetting: string, newSetting: string): Promise<void> {
		const userValue = this.configurationService.inspect(oldSetting).userValue;
		if (userValue !== undefined) {
			// remove the old setting
			await this.configurationService.updateValue(oldSetting, undefined, ConfigurationTarget.USER);
			// add the new setting
			await this.configurationService.updateValue(newSetting, userValue, ConfigurationTarget.USER);
		}
	}
}

const workbenchRegistry = Registry.as<IWorkbenchContributionsRegistry>(WorkbenchExtensions.Workbench);
workbenchRegistry.registerWorkbenchContribution(UserDataSyncWorkbenchContribution, LifecyclePhase.Ready);
workbenchRegistry.registerWorkbenchContribution(UserDataSyncSettingsMigrationContribution, LifecyclePhase.Eventually);
workbenchRegistry.registerWorkbenchContribution(UserDataSyncTrigger, LifecyclePhase.Eventually);

if (isWeb) {
	workbenchRegistry.registerWorkbenchContribution(UserDataSyncReportIssueContribution, LifecyclePhase.Ready);
}
