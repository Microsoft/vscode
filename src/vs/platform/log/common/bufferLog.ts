/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService, LogLevel, AbstractLogger, DEFAULT_LOG_LEVEL, ILogger } from 'vs/platform/log/common/log';

interface ILog {
	level: LogLevel;
	args: any[];
}

function getLogFunction(logger: ILogger, level: LogLevel): Function {
	switch (level) {
		case LogLevel.Trace: return logger.trace;
		case LogLevel.Debug: return logger.debug;
		case LogLevel.Info: return logger.info;
		case LogLevel.Warning: return logger.warn;
		case LogLevel.Error: return logger.error;
		case LogLevel.Critical: return logger.critical;
		default: throw new Error('Invalid log level');
	}
}

export class BufferLogService extends AbstractLogger implements ILogService {

	declare readonly _serviceBrand: undefined;
	private buffer: ILog[] = [];
	private _logger: ILogger | undefined = undefined;

	constructor(logLevel: LogLevel = DEFAULT_LOG_LEVEL) {
		super();
		this.setLevel(logLevel);
		this._register(this.onDidChangeLogLevel(level => {
			if (this._logger) {
				this._logger.setLevel(level);
			}
		}));
	}

	set logger(logger: ILogger) {
		this._logger = logger;

		for (const { level, args } of this.buffer) {
			const fn = getLogFunction(logger, level);
			fn.apply(logger, args);
		}

		this.buffer = [];
	}

	private _log(level: LogLevel, ...args: any[]): void {
		if (this._logger) {
			const fn = getLogFunction(this._logger, level);
			fn.apply(this._logger, args);
		} else if (this.getLevel() <= level) {
			this.buffer.push({ level, args });
		}
	}

	trace(message: string, ...args: any[]): void {
		this._log(LogLevel.Trace, message, ...args);
	}

	debug(message: string, ...args: any[]): void {
		this._log(LogLevel.Debug, message, ...args);
	}

	info(message: string, ...args: any[]): void {
		this._log(LogLevel.Info, message, ...args);
	}

	warn(message: string, ...args: any[]): void {
		this._log(LogLevel.Warning, message, ...args);
	}

	error(message: string | Error, ...args: any[]): void {
		this._log(LogLevel.Error, message, ...args);
	}

	critical(message: string | Error, ...args: any[]): void {
		this._log(LogLevel.Critical, message, ...args);
	}

	override dispose(): void {
		if (this._logger) {
			this._logger.dispose();
		}
	}

	flush(): void {
		if (this._logger) {
			this._logger.flush();
		}
	}
}
