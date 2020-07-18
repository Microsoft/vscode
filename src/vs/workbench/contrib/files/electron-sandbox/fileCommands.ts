/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as nls from 'vs/nls';
import { URI } from 'vs/base/common/uri';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';
import { sequence } from 'vs/base/common/async';
import { Schemas } from 'vs/base/common/network';
import { INotificationService } from 'vs/platform/notification/common/notification';
import { IElectronService } from 'vs/platform/electron/electron-sandbox/electron';

// Commands

export function revealResourcesInOS(resources: URI[], electronService: IElectronService, notificationService: INotificationService, workspaceContextService: IWorkspaceContextService): void {
	if (resources.length) {
		sequence(resources.map(r => async () => {
			if (r.scheme === Schemas.file || r.scheme === Schemas.userData) {
				electronService.showItemInFolder(r.fsPath);
			}
		}));
	} else if (workspaceContextService.getWorkspace().folders.length) {
		const uri = workspaceContextService.getWorkspace().folders[0].uri;
		if (uri.scheme === Schemas.file) {
			electronService.showItemInFolder(uri.fsPath);
		}
	} else {
		notificationService.info(nls.localize('openFileToReveal', "Open a file first to reveal"));
	}
}
