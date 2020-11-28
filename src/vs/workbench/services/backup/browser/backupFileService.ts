/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IFileService } from 'vs/platform/files/common/files';
import { IWorkbenchEnvironmentService } from 'vs/workbench/services/environment/common/environmentService';
import { ILogService } from 'vs/platform/log/common/log';
import { BackupFileService } from 'vs/workbench/services/backup/common/backupFileService';
import { hash } from 'vs/base/common/hash';
import { Schemas } from 'vs/base/common/network';
import { URI } from 'vs/base/common/uri';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { joinPath } from 'vs/base/common/resources';
import { IWorkspaceContextService } from 'vs/platform/workspace/common/workspace';

export class BrowserBackupFileService extends BackupFileService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IWorkspaceContextService contextService: IWorkspaceContextService,
		@IWorkbenchEnvironmentService environmentService: IWorkbenchEnvironmentService,
		@IFileService fileService: IFileService,
		@ILogService logService: ILogService
	) {
		super(joinPath(environmentService.userRoamingDataHome, 'Backups', contextService.getWorkspace().id), fileService, logService);
	}

	protected hashPath(resource: URI): string {
		const str = resource.scheme === Schemas.file || resource.scheme === Schemas.untitled ? resource.fsPath : resource.toString();

		return hash(str).toString(16);
	}
}

registerSingleton(IBackupFileService, BrowserBackupFileService);
