/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService, DelegatedLogService, LogLevel } from 'vs/platform/log/common/log';
import { ExtHostLogServiceShape } from 'vs/workbench/api/common/extHost.protocol';
import { ExtensionHostLogFileName } from 'vs/workbench/services/extensions/common/extensions';
import { IExtHostInitDataService } from 'vs/workbench/api/common/extHostInitDataService';
import { Schemas } from 'vs/base/common/network';
import { SpdLogService } from 'vs/platform/log/node/spdlogService';
import { dirname } from 'vs/base/common/resources';

export class ExtHostLogService extends DelegatedLogService implements ILogService, ExtHostLogServiceShape {

	constructor(
		@IExtHostInitDataService initData: IExtHostInitDataService,
	) {
		if (initData.logFile.scheme !== Schemas.file) { throw new Error('Only file-logging supported'); }
		super(new SpdLogService(ExtensionHostLogFileName, dirname(initData.logFile).fsPath, initData.logLevel));
	}

	$setLevel(level: LogLevel): void {
		this.setLevel(level);
	}
}
