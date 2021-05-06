/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IChannel, IServerChannel } from 'vs/base/parts/ipc/common/ipc';
import { LogLevel, ILogService, LogService, ILoggerService, ILogger, AbstractMessageLogger, ILoggerOptions, AdapterLogger, AbstractLoggerService } from 'vs/platform/log/common/log';
import { Event } from 'vs/base/common/event';
import { URI } from 'vs/base/common/uri';

export class LogLevelChannel implements IServerChannel {

	onDidChangeLogLevel: Event<LogLevel>;

	constructor(private service: ILogService) {
		this.onDidChangeLogLevel = Event.buffer(service.onDidChangeLogLevel, true);
	}

	listen(_: unknown, event: string): Event<any> {
		switch (event) {
			case 'onDidChangeLogLevel': return this.onDidChangeLogLevel;
		}

		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'setLevel': return this.service.setLevel(arg);
		}

		throw new Error(`Call not found: ${command}`);
	}

}

export class LogLevelChannelClient {

	constructor(private channel: IChannel) { }

	get onDidChangeLogLevel(): Event<LogLevel> {
		return this.channel.listen('onDidChangeLogLevel');
	}

	setLevel(level: LogLevel): void {
		LogLevelChannelClient.setLevel(this.channel, level);
	}

	public static setLevel(channel: IChannel, level: LogLevel): Promise<void> {
		return channel.call('setLevel', level);
	}

}

export class LoggerChannel implements IServerChannel {

	private readonly loggers = new Map<string, ILogger>();

	constructor(private readonly loggerService: ILoggerService) { }

	listen(_: unknown, event: string): Event<any> {
		throw new Error(`Event not found: ${event}`);
	}

	async call(_: unknown, command: string, arg?: any): Promise<any> {
		switch (command) {
			case 'createLogger': this.createLogger(URI.revive(arg[0]), arg[1]); return;
			case 'log': return this.log(URI.revive(arg[0]), arg[1]);
			case 'consoleLog': return this.consoleLog(arg[0], arg[1]);
		}

		throw new Error(`Call not found: ${command}`);
	}

	private createLogger(file: URI, options: ILoggerOptions): void {
		this.loggers.set(file.toString(), this.loggerService.createLogger(file, options));
	}

	private consoleLog(level: LogLevel, args: any[]): void {
		let consoleFn = console.log;

		switch (level) {
			case LogLevel.Error:
				consoleFn = console.error;
				break;
			case LogLevel.Warning:
				consoleFn = console.warn;
				break;
			case LogLevel.Info:
				consoleFn = console.info;
				break;
		}

		consoleFn.call(console, ...args);
	}

	private log(file: URI, messages: [LogLevel, string][]): void {
		const logger = this.loggers.get(file.toString());
		if (!logger) {
			throw new Error('Create the logger before logging');
		}
		for (const [level, message] of messages) {
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
	}
}

export class LoggerChannelClient extends AbstractLoggerService implements ILoggerService {

	constructor(logLevel: LogLevel, onDidChangeLogLevel: Event<LogLevel>, private readonly channel: IChannel) {
		super(logLevel, onDidChangeLogLevel);
	}

	createConsoleMainLogger(): ILogger {
		return new AdapterLogger({
			log: (level: LogLevel, args: any[]) => {
				this.channel.call('consoleLog', [level, args]);
			}
		});
	}

	protected doCreateLogger(file: URI, logLevel: LogLevel, options?: ILoggerOptions): ILogger {
		return new Logger(this.channel, file, logLevel, options);
	}

}

class Logger extends AbstractMessageLogger {

	private isLoggerCreated: boolean = false;
	private buffer: [LogLevel, string][] = [];

	constructor(
		private readonly channel: IChannel,
		private readonly file: URI,
		logLevel: LogLevel,
		loggerOptions?: ILoggerOptions,
	) {
		super(loggerOptions?.always);
		this.setLevel(logLevel);
		this.channel.call('createLogger', [file, loggerOptions])
			.then(() => {
				this.doLog(this.buffer);
				this.isLoggerCreated = true;
			});
	}

	protected log(level: LogLevel, message: string) {
		const messages: [LogLevel, string][] = [[level, message]];
		if (this.isLoggerCreated) {
			this.doLog(messages);
		} else {
			this.buffer.push(...messages);
		}
	}

	private doLog(messages: [LogLevel, string][]) {
		this.channel.call('log', [this.file, messages]);
	}
}

export class FollowerLogService extends LogService implements ILogService {

	constructor(private parent: LogLevelChannelClient, logService: ILogService) {
		super(logService);
		this._register(parent.onDidChangeLogLevel(level => logService.setLevel(level)));
	}

	override setLevel(level: LogLevel): void {
		super.setLevel(level);

		this.parent.setLevel(level);
	}
}
