/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
/**
 * This code is also used by standalone cli's. Avoid adding dependencies to keep the size of the cli small.
 */
import * as paths from 'vs/base/common/path';
import * as fs from 'fs';
import * as os from 'os';
import { resolveTerminalEncoding } from 'vs/base/node/terminalEncoding';

export function hasStdinWithoutTty() {
	try {
		return !process.stdin.isTTY; // Via https://twitter.com/MylesBorins/status/782009479382626304
	} catch (error) {
		// Windows workaround for https://github.com/nodejs/node/issues/11656
	}
	return false;
}

export function stdinDataListener(durationinMs: number): Promise<boolean> {
	return new Promise(c => {
		const dataListener = () => c(true);

		// wait for 1s maximum...
		setTimeout(() => {
			process.stdin.removeListener('data', dataListener);

			c(false);
		}, durationinMs);

		// ...but finish early if we detect data
		process.stdin.once('data', dataListener);
	});
}

export function getStdinFilePath(): string {
	return paths.join(os.tmpdir(), `code-stdin-${Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 3)}.txt`);
}

export async function readFromStdin(targetPath: string, verbose: boolean): Promise<void> {

	// open tmp file for writing
	const stdinFileStream = fs.createWriteStream(targetPath);

	let encoding = await resolveTerminalEncoding(verbose);

	const iconv = await import('iconv-lite-umd');
	if (!iconv.encodingExists(encoding)) {
		console.log(`Unsupported terminal encoding: ${encoding}, falling back to UTF-8.`);
		encoding = 'utf8';
	}

	// Pipe into tmp file using terminals encoding
	const decoder = iconv.getDecoder(encoding);
	process.stdin.on('data', chunk => stdinFileStream.write(decoder.write(chunk)));
	process.stdin.on('end', () => {
		const end = decoder.end();
		if (typeof end === 'string') {
			stdinFileStream.write(end);
		}
		stdinFileStream.end();
	});
	process.stdin.on('error', error => stdinFileStream.destroy(error));
	process.stdin.on('close', () => stdinFileStream.close());
}
