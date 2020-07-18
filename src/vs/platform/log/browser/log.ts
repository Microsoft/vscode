/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ILogService, DEFAULT_LOG_LEVEL, LogLevel, LogServiceAdapter } from 'vs/platform/log/common/log';

interface IAutomatedWindow {
	codeAutomationLog(type: string, args: any[]): void;
}

/**
 * A logger that is used when VSCode is running in the web with
 * an automation such as playwright. We expect a global codeAutomationLog
 * to be defined that we can use to log to.
 */
export class ConsoleLogInAutomationService extends LogServiceAdapter implements ILogService {

	declare codeAutomationLog: any;

	declare readonly _serviceBrand: undefined;

	constructor(logLevel: LogLevel = DEFAULT_LOG_LEVEL) {
		super({ consoleLog: (type, args) => this.consoleLog(type, args) }, logLevel);
	}

	private consoleLog(type: string, args: any[]): void {
		const automatedWindow = window as unknown as IAutomatedWindow;
		if (typeof automatedWindow.codeAutomationLog === 'function') {
			automatedWindow.codeAutomationLog(type, args);
		}
	}
}
