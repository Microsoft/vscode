/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as path from 'vs/base/common/path';
import { ILogService, LogLevel, AbstractLogService } from 'vs/platform/log/common/log';
import * as spdlog from 'spdlog';

async function createSpdLogLogger(processName: string, logsFolder: string): Promise<spdlog.RotatingLogger | null> {
	// Do not crash if spdlog cannot be loaded
	try {
		const _spdlog = await import('spdlog');
		_spdlog.setAsyncMode(8192, 500);
		const logfilePath = path.join(logsFolder, `${processName}.log`);
		return _spdlog.createRotatingLoggerAsync(processName, logfilePath, 1024 * 1024 * 5, 6);
	} catch (e) {
		console.error(e);
	}
	return null;
}

export function createRotatingLogger(name: string, filename: string, filesize: number, filecount: number): spdlog.RotatingLogger {
	const _spdlog: typeof spdlog = require.__$__nodeRequire('spdlog');
	return _spdlog.createRotatingLogger(name, filename, filesize, filecount);
}

interface ILog {
	level: LogLevel;
	message: string;
}

function log(logger: spdlog.RotatingLogger, level: LogLevel, message: string): void {
	switch (level) {
		case LogLevel.Trace: logger.trace(message); break;
		case LogLevel.Debug: logger.debug(message); break;
		case LogLevel.Info: logger.info(message); break;
		case LogLevel.Warning: logger.warn(message); break;
		case LogLevel.Error: logger.error(message); break;
		case LogLevel.Critical: logger.critical(message); break;
		default: throw new Error('Invalid log level');
	}
}

export class SpdLogService extends AbstractLogService implements ILogService {

	declare readonly _serviceBrand: undefined;

	private buffer: ILog[] = [];
	private _loggerCreationPromise: Promise<void> | undefined = undefined;
	private _logger: spdlog.RotatingLogger | undefined;

	constructor(private readonly name: string, private readonly logsFolder: string, level: LogLevel) {
		super();
		this.setLevel(level);
		this._createSpdLogLogger();
		this._register(this.onDidChangeLogLevel(level => {
			if (this._logger) {
				this._logger.setLevel(level);
			}
		}));
	}

	private _createSpdLogLogger(): Promise<void> {
		if (!this._loggerCreationPromise) {
			this._loggerCreationPromise = createSpdLogLogger(this.name, this.logsFolder)
				.then(logger => {
					if (logger) {
						this._logger = logger;
						this._logger.setLevel(this.getLevel());
						for (const { level, message } of this.buffer) {
							log(this._logger, level, message);
						}
						this.buffer = [];
					}
				});
		}
		return this._loggerCreationPromise;
	}

	private _log(level: LogLevel, message: string): void {
		if (this._logger) {
			log(this._logger, level, message);
		} else if (this.getLevel() <= level) {
			this.buffer.push({ level, message });
		}
	}

	trace(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Trace) {
			this._log(LogLevel.Trace, this.format([message, ...args]));
		}
	}

	debug(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Debug) {
			this._log(LogLevel.Debug, this.format([message, ...args]));
		}
	}

	info(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Info) {
			this._log(LogLevel.Info, this.format([message, ...args]));
		}
	}

	warn(message: string, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Warning) {
			this._log(LogLevel.Warning, this.format([message, ...args]));
		}
	}

	error(message: string | Error, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Error) {

			if (message instanceof Error) {
				const array = Array.prototype.slice.call(arguments) as any[];
				array[0] = message.stack;
				this._log(LogLevel.Error, this.format(array));
			} else {
				this._log(LogLevel.Error, this.format([message, ...args]));
			}
		}
	}

	critical(message: string | Error, ...args: any[]): void {
		if (this.getLevel() <= LogLevel.Critical) {
			this._log(LogLevel.Critical, this.format([message, ...args]));
		}
	}

	flush(): void {
		if (this._logger) {
			this._logger.flush();
		} else if (this._loggerCreationPromise) {
			this._loggerCreationPromise.then(() => this.flush());
		}
	}

	dispose(): void {
		if (this._logger) {
			this.disposeLogger();
		} else if (this._loggerCreationPromise) {
			this._loggerCreationPromise.then(() => this.disposeLogger());
		}
		this._loggerCreationPromise = undefined;
	}

	private disposeLogger(): void {
		if (this._logger) {
			this._logger.drop();
			this._logger = undefined;
		}
	}

	private format(args: any): string {
		let result = '';

		for (let i = 0; i < args.length; i++) {
			let a = args[i];

			if (typeof a === 'object') {
				try {
					a = JSON.stringify(a);
				} catch (e) { }
			}

			result += (i > 0 ? ' ' : '') + a;
		}

		return result;
	}
}
