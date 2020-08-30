/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as es from 'event-stream';
import * as _ from 'underscore';
import * as fancyLog from 'fancy-log';
import * as ansiColors from 'ansi-colors';
import * as fs from 'fs';
import * as path from 'path';

const allErrors: string[][] = [];
let startTime: number | null = null;
let count = 0;

function onStart(): void {
	if (count++ > 0) {
		return;
	}

	startTime = new Date().getTime();
	fancyLog(`Starting ${ansiColors.green('compilation')}...`);
}

function onEnd(): void {
	if (--count > 0) {
		return;
	}

	log();
}

const buildLogPath = path.join(path.dirname(path.dirname(__dirname)), '.build', 'log');

try {
	fs.mkdirSync(path.dirname(buildLogPath));
} catch (err) {
	// ignore
}

function log(): void {
	const errors = _.flatten(allErrors);
	const seen = new Set<string>();

	errors.map(err => {
		if (!seen.has(err)) {
			seen.add(err);
			fancyLog(`${ansiColors.red('Error')}: ${err}`);
		}
	});

	const regex = /^([^(]+)\((\d+),(\d+)\): (.*)$/;
	const messages = errors
		.map(err => regex.exec(err))
		.filter(match => !!match)
		.map(x => x as string[])
		.map(([, path, line, column, message]) => ({ path, line: parseInt(line), column: parseInt(column), message }));

	try {

		fs.writeFileSync(buildLogPath, JSON.stringify(messages));
	} catch (err) {
		//noop
	}

	fancyLog(`Finished ${ansiColors.green('compilation')} with ${errors.length} errors after ${ansiColors.magenta((new Date().getTime() - startTime!) + ' ms')}`);
}

export interface IReporter {
	(err: string): void;
	hasErrors(): boolean;
	end(emitError: boolean): NodeJS.ReadWriteStream;
}

export function createReporter(): IReporter {
	const errors: string[] = [];
	allErrors.push(errors);

	const result = (err: string) => errors.push(err);

	result.hasErrors = () => errors.length > 0;

	result.end = (emitError: boolean): NodeJS.ReadWriteStream => {
		errors.length = 0;
		onStart();

		return es.through(undefined, function () {
			onEnd();

			if (emitError && errors.length > 0) {
				if (!(errors as any).__logged__) {
					log();
				}

				(errors as any).__logged__ = true;

				const err = new Error(`Found ${errors.length} errors`);
				(err as any).__reporter__ = true;
				this.emit('error', err);
			} else {
				this.emit('end');
			}
		});
	};

	return result;
}
