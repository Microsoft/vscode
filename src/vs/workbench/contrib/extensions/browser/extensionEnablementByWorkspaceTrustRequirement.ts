/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from 'vs/base/common/lifecycle';
import { IWorkspaceTrustManagementService } from 'vs/platform/workspace/common/workspaceTrust';
import { IWorkbenchContribution } from 'vs/workbench/common/contributions';
import { IWorkbenchExtensionEnablementService } from 'vs/workbench/services/extensionManagement/common/extensionManagement';
import { IExtensionService } from 'vs/workbench/services/extensions/common/extensions';


export class ExtensionEnablementByWorkspaceTrustRequirement extends Disposable implements IWorkbenchContribution {

	constructor(
		@IWorkspaceTrustManagementService workspaceTrustManagementService: IWorkspaceTrustManagementService,
		@IExtensionService private readonly extensionService: IExtensionService,
		@IWorkbenchExtensionEnablementService private readonly extensionEnablementService: IWorkbenchExtensionEnablementService,
	) {
		super();

		this._register(workspaceTrustManagementService.onDidChangeTrust(trusted => this.onDidChangeTrustState(trusted)));
	}

	private async onDidChangeTrustState(trusted: boolean): Promise<void> {
		if (trusted) {
			// Untrusted -> Trusted
			await this.extensionEnablementService.updateEnablementByWorkspaceTrustRequirement();
		} else {
			// Trusted -> Untrusted
			this.extensionService.stopExtensionHosts();
			await this.extensionEnablementService.updateEnablementByWorkspaceTrustRequirement();
			this.extensionService.startExtensionHosts();
		}
	}
}
