/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { LogLevel, ILogger, AbstractMessageLogger } from 'vs/platform/log/common/log';
import * as spdlog from 'spdlog';
import { ByteSize } from 'vs/platform/files/common/files';

async function createSpdLogLogger(name: string, logfilePath: string, filesize: number, filecount: number): Promise<spdlog.RotatingLogger | null> {
	// Do not crash if spdlog cannot be loaded
	try {
		const _spdlog = await import('spdlog');
		_spdlog.setAsyncMode(8192, 500);
		return _spdlog.createRotatingLoggerAsync(name, logfilePath, filesize, filecount);
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

export class SpdLogLogger extends AbstractMessageLogger implements ILogger {

	private buffer: ILog[] = [];
	private readonly _loggerCreationPromise: Promise<void>;
	private _logger: spdlog.RotatingLogger | undefined;

	constructor(
		private readonly name: string,
		private readonly filepath: string,
		private readonly rotating: boolean,
		level: LogLevel
	) {
		super();
		this.setLevel(level);
		this._loggerCreationPromise = this._createSpdLogLogger();
		this._register(this.onDidChangeLogLevel(level => {
			if (this._logger) {
				this._logger.setLevel(level);
			}
		}));
	}

	private _createSpdLogLogger(): Promise<void> {
		const filecount = this.rotating ? 6 : 1;
		const filesize = (30 / filecount) * ByteSize.MB;
		return createSpdLogLogger(this.name, this.filepath, filesize, filecount)
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

	protected log(level: LogLevel, message: string): void {
		if (this._logger) {
			log(this._logger, level, message);
		} else if (this.getLevel() <= level) {
			this.buffer.push({ level, message });
		}
	}

	clearFormatters(): void {
		if (this._logger) {
			this._logger.clearFormatters();
		} else {
			this._loggerCreationPromise.then(() => this.clearFormatters());
		}
	}

	override flush(): void {
		if (this._logger) {
			this._logger.flush();
		} else {
			this._loggerCreationPromise.then(() => this.flush());
		}
	}

	override dispose(): void {
		if (this._logger) {
			this.disposeLogger();
		} else {
			this._loggerCreationPromise.then(() => this.disposeLogger());
		}
	}

	private disposeLogger(): void {
		if (this._logger) {
			this._logger.drop();
			this._logger = undefined;
		}
	}
}
