/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { appendFileSync, writeFileSync } from 'fs';
import { format } from 'util';
import { EOL } from 'os';

export interface Logger {
	log(message: string, ...args: any[]): void;
}

export class ConsoleLogger implements Logger {

	log(message: string, ...args: any[]): void {
		console.log('**', message, ...args);
	}
}

export class FileLogger implements Logger {

	constructor(private path: string) {
		writeFileSync(path, '');
	}

	log(message: string, ...args: any[]): void {
		const date = new Date().toISOString();
		appendFileSync(this.path, `[${date}] ${format(message, ...args)}${EOL}`);
	}
}

export class MultiLogger implements Logger {

	constructor(private loggers: Logger[]) { }

	log(message: string, ...args: any[]): void {
		for (const logger of this.loggers) {
			logger.log(message, ...args);
		}
	}
}
