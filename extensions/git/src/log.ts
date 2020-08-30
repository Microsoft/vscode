/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Event, EventEmitter } from 'vscode';

/**
 * The severity level of a log message
 */
export enum LogLevel {
	Trace = 1,
	Debug = 2,
	Info = 3,
	Warning = 4,
	Error = 5,
	Critical = 6,
	Off = 7
}

let _logLevel: LogLevel = LogLevel.Info;
const _onDidChangeLogLevel = new EventEmitter<LogLevel>();

export const Log = {
	/**
	 * Current logging level.
	 */
	get logLevel(): LogLevel {
		return _logLevel;
	},

	/**
	 * Current logging level.
	 */
	set logLevel(logLevel: LogLevel) {
		if (_logLevel === logLevel) {
			return;
		}

		_logLevel = logLevel;
		_onDidChangeLogLevel.fire(logLevel);
	},

	/**
	 * An [event](#Event) that fires when the log level has changed.
	 */
	get onDidChangeLogLevel(): Event<LogLevel> {
		return _onDidChangeLogLevel.event;
	}
};
