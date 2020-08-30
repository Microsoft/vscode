/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { BackupFileService as CommonBackupFileService } from 'vs/workbench/services/backup/common/backupFileService';
import { URI } from 'vs/base/common/uri';
import { Schemas } from 'vs/base/common/network';
import * as crypto from 'crypto';
import { registerSingleton } from 'vs/platform/instantiation/common/extensions';
import { IBackupFileService } from 'vs/workbench/services/backup/common/backup';

export class BackupFileService extends CommonBackupFileService {

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

registerSingleton(IBackupFileService, BackupFileService);
