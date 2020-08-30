/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as vscode from 'vscode';
import { lazy } from './util/lazy';

enum Trace {
	Off,
	Verbose
}

namespace Trace {
	export function fromString(value: string): Trace {
		value = value.toLowerCase();
		switch (value) {
			case 'off':
				return Trace.Off;
			case 'verbose':
				return Trace.Verbose;
			default:
				return Trace.Off;
		}
	}
}


function isString(value: any): value is string {
	return Object.prototype.toString.call(value) === '[object String]';
}

export class Logger {
	private trace?: Trace;

	private readonly outputChannel = lazy(() => vscode.window.createOutputChannel('Markdown'));

	constructor() {
		this.updateConfiguration();
	}

	public log(message: string, data?: any): void {
		if (this.trace === Trace.Verbose) {
			this.appendLine(`[Log - ${this.now()}] ${message}`);
			if (data) {
				this.appendLine(Logger.data2String(data));
			}
		}
	}


	private now(): string {
		const now = new Date();
		return padLeft(now.getUTCHours() + '', 2, '0')
			+ ':' + padLeft(now.getMinutes() + '', 2, '0')
			+ ':' + padLeft(now.getUTCSeconds() + '', 2, '0') + '.' + now.getMilliseconds();
	}

	public updateConfiguration() {
		this.trace = this.readTrace();
	}

	private appendLine(value: string) {
		return this.outputChannel.value.appendLine(value);
	}

	private readTrace(): Trace {
		return Trace.fromString(vscode.workspace.getConfiguration().get<string>('markdown.trace', 'off'));
	}

	private static data2String(data: any): string {
		if (data instanceof Error) {
			if (isString(data.stack)) {
				return data.stack;
			}
			return (data as Error).message;
		}
		if (isString(data)) {
			return data;
		}
		return JSON.stringify(data, undefined, 2);
	}
}

function padLeft(s: string, n: number, pad = ' ') {
	return pad.repeat(Math.max(0, n - s.length)) + s;
}
