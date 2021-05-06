/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService, ILoggerService, ILogger, ILoggerOptions, AbstractLoggerService, LogLevel } from 'vs/platform/log/common/log';
import { URI } from 'vs/base/common/uri';
import { basename } from 'vs/base/common/resources';
import { Schemas } from 'vs/base/common/network';
import { FileLogger } from 'vs/platform/log/common/fileLog';
import { SpdLogLogger } from 'vs/platform/log/node/spdlogLog';
import { IFileService } from 'vs/platform/files/common/files';
import { generateUuid } from 'vs/base/common/uuid';

export class LoggerService extends AbstractLoggerService implements ILoggerService {

	constructor(
		@ILogService logService: ILogService,
		@IFileService private readonly fileService: IFileService
	) {
		super(logService.getLevel(), logService.onDidChangeLogLevel);
	}

	protected doCreateLogger(resource: URI, logLevel: LogLevel, options?: ILoggerOptions): ILogger {
		if (resource.scheme === Schemas.file) {
			const logger = new SpdLogLogger(options?.name || generateUuid(), resource.fsPath, !options?.donotRotate, logLevel);
			if (options?.donotUseFormatters) {
				(<SpdLogLogger>logger).clearFormatters();
			}
			return logger;
		} else {
			return new FileLogger(options?.name ?? basename(resource), resource, logLevel, this.fileService);
		}
	}
}

