/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { UserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataAutoSyncService';
import { IUserDataAutoSyncEnablementService } from 'vs/platform/userDataSync/common/userDataSync';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';

export class WebUserDataAutoSyncEnablementService extends UserDataAutoSyncEnablementService {

	private get workbenchEnvironmentService(): IWorkbenchEnvironmentService { return <IWorkbenchEnvironmentService>this.environmentService; }
	private enabled: boolean | undefined = undefined;

	override canToggleEnablement(): boolean {
		return this.isTrusted() && super.canToggleEnablement();
	}

	override isEnabled(): boolean {
		if (!this.isTrusted()) {
			return false;
		}
		if (this.enabled === undefined) {
			this.enabled = this.workbenchEnvironmentService.options?.settingsSyncOptions?.enabled;
		}
		if (this.enabled === undefined) {
			this.enabled = super.isEnabled(this.workbenchEnvironmentService.options?.enableSyncByDefault);
		}
		return this.enabled;
	}

	override setEnablement(enabled: boolean) {
		if (enabled && !this.canToggleEnablement()) {
			return;
		}
		if (this.enabled !== enabled) {
			this.enabled = enabled;
			super.setEnablement(enabled);
			if (this.workbenchEnvironmentService.options?.settingsSyncOptions?.enablementHandler) {
				this.workbenchEnvironmentService.options.settingsSyncOptions.enablementHandler(this.enabled);
			}
		}
	}

	private isTrusted(): boolean {
		return !!this.workbenchEnvironmentService.options?.workspaceProvider?.trusted;
	}
}

registerSingleton(IUserDataAutoSyncEnablementService, WebUserDataAutoSyncEnablementService);
