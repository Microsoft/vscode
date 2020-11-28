/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BackupFileService } from 'vs/workbench/services/backup/common/backupFileService';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import * as crypto from 'crypto';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';
import { IFileService } from 'vs/platform/files/common/files';
import { ILogService } from 'vs/platform/log/common/log';
import { INativeWorkbenchEnvironmentService } from 'vs/workbench/services/environment/electron-sandbox/environmentService';

export class NativeBackupFileService extends BackupFileService {

	constructor(
		@INativeWorkbenchEnvironmentService environmentService: INativeWorkbenchEnvironmentService,
		@IFileService fileService: IFileService,
		@ILogService logService: ILogService
	) {
		super(environmentService.configuration.backupPath ? URI.file(environmentService.configuration.backupPath).with({ scheme: environmentService.userRoamingDataHome.scheme }) : undefined, fileService, logService);
	}

	protected hashPath(resource: URI): string {
		return hashPath(resource);
	}
}

/*
 * Exported only for testing
 */
export function hashPath(resource: URI): string {
	const str = resource.scheme === Schemas.file || resource.scheme === Schemas.untitled ? resource.fsPath : resource.toString();

	return crypto.createHash('md5').update(str).digest('hex');
}

registerSingleton(IBackupFileService, NativeBackupFileService);
