/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';

type LogLevel = 'Trace' | 'Info' | 'Error';

enum Level {
	Trace = 'trace',
	Info = 'Info'
}

class Log {
	private output: vscode.OutputChannel;
	private level: Level;

	constructor() {
		this.output = vscode.window.createOutputChannel('Microsoft Authentication');
		this.level = vscode.workspace.getConfiguration('microsoftAccount').get('logLevel') || Level.Info;
		vscode.workspace.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration('microsoftAccount.logLevel')) {
				this.level = vscode.workspace.getConfiguration('microsoftAccount').get('logLevel') || Level.Info;
			}
		});
	}

	private data2String(data: any): string {
		if (data instanceof Error) {
			return data.stack || data.message;
		}
		if (data.success === false && data.message) {
			return data.message;
		}
		return data.toString();
	}

	public info(message: string, data?: any): void {
		this.logLevel('Info', message, data);
	}

	public error(message: string, data?: any): void {
		this.logLevel('Error', message, data);
	}

	public trace(message: string, data?: any): void {
		if (this.level === Level.Trace) {
			this.logLevel('Trace', message, data);
		}
	}

	public logLevel(level: LogLevel, message: string, data?: any): void {
		this.output.appendLine(`[${level}  - ${this.now()}] ${message}`);
		if (data) {
			this.output.appendLine(this.data2String(data));
		}
	}

	private now(): string {
		const now = new Date();
		return padLeft(now.getUTCHours() + '', 2, '0')
			+ ':' + padLeft(now.getMinutes() + '', 2, '0')
			+ ':' + padLeft(now.getUTCSeconds() + '', 2, '0') + '.' + now.getMilliseconds();
	}
}

function padLeft(s: string, n: number, pad = ' ') {
	return pad.repeat(Math.max(0, n - s.length)) + s;
}

const Logger = new Log();
export default Logger;
