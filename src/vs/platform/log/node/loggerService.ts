/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService, ILoggerService, ILogger } from 'vs/platform/log/common/log';
import { Disposable } from 'vs/base/common/lifecycle';
import { URI } from 'vs/base/common/uri';
import { basename, extname, dirname } from 'vs/base/common/resources';
import { Schemas } from 'vs/base/common/network';
import { FileLogService } from 'vs/platform/log/common/fileLogService';
import { IInstantiationService } from 'vs/platform/instantiation/common/instantiation';
import { SpdLogService } from 'vs/platform/log/node/spdlogService';

export class LoggerService extends Disposable implements ILoggerService {

	declare readonly _serviceBrand: undefined;

	private readonly loggers = new Map<string, ILogger>();

	constructor(
		@ILogService private logService: ILogService,
		@IInstantiationService private instantiationService: IInstantiationService,
	) {
		super();
		this._register(logService.onDidChangeLogLevel(level => this.loggers.forEach(logger => logger.setLevel(level))));
	}

	getLogger(resource: URI): ILogger {
		let logger = this.loggers.get(resource.toString());
		if (!logger) {
			if (resource.scheme === Schemas.file) {
				const baseName = basename(resource);
				const ext = extname(resource);
				logger = new SpdLogService(baseName.substring(0, baseName.length - ext.length), dirname(resource).fsPath, this.logService.getLevel());
			} else {
				logger = this.instantiationService.createInstance(FileLogService, basename(resource), resource, this.logService.getLevel());
			}
			this.loggers.set(resource.toString(), logger);
		}
		return logger;
	}

	dispose(): void {
		this.loggers.forEach(logger => logger.dispose());
		this.loggers.clear();
		super.dispose();
	}
}

