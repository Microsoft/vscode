/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This code is also used by standalone cli's. Avoid adding dependencies to keep the size of the cli small.
 */
import { exec } from 'child_process';
import { isWindows } from 'vs/base/common/platform';

const windowsTerminalEncodings = {
	'437': 'cp437', // United States
	'850': 'cp850', // Multilingual(Latin I)
	'852': 'cp852', // Slavic(Latin II)
	'855': 'cp855', // Cyrillic(Russian)
	'857': 'cp857', // Turkish
	'860': 'cp860', // Portuguese
	'861': 'cp861', // Icelandic
	'863': 'cp863', // Canadian - French
	'865': 'cp865', // Nordic
	'866': 'cp866', // Russian
	'869': 'cp869', // Modern Greek
	'936': 'cp936', // Simplified Chinese
	'1252': 'cp1252' // West European Latin
};

function toIconvLiteEncoding(encodingName: string): string {
	const normalizedEncodingName = encodingName.replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
	const mapped = JSCHARDET_TO_ICONV_ENCODINGS[normalizedEncodingName];

	return mapped || normalizedEncodingName;
}

const JSCHARDET_TO_ICONV_ENCODINGS: { [name: string]: string } = {
	'ibm866': 'cp866',
	'big5': 'cp950'
};

const UTF8 = 'utf8';

export async function resolveTerminalEncoding(verbose?: boolean): Promise<string> {
	let rawEncodingPromise: Promise<string>;

	// Support a global environment variable to win over other mechanics
	const cliEncodingEnv = process.env['VSCODE_CLI_ENCODING'];
	if (cliEncodingEnv) {
		if (verbose) {
			console.log(`Found VSCODE_CLI_ENCODING variable: ${cliEncodingEnv}`);
		}

		rawEncodingPromise = Promise.resolve(cliEncodingEnv);
	}

	// Windows: educated guess
	else if (isWindows) {
		rawEncodingPromise = new Promise<string>(resolve => {
			if (verbose) {
				console.log('Running "chcp" to detect terminal encoding...');
			}

			exec('chcp', (err, stdout, stderr) => {
				if (stdout) {
					if (verbose) {
						console.log(`Output from "chcp" command is: ${stdout}`);
					}

					const windowsTerminalEncodingKeys = Object.keys(windowsTerminalEncodings) as Array<keyof typeof windowsTerminalEncodings>;
					for (const key of windowsTerminalEncodingKeys) {
						if (stdout.indexOf(key) >= 0) {
							return resolve(windowsTerminalEncodings[key]);
						}
					}
				}

				return resolve(undefined);
			});
		});
	}
	// Linux/Mac: use "locale charmap" command
	else {
		rawEncodingPromise = new Promise<string>(resolve => {
			if (verbose) {
				console.log('Running "locale charmap" to detect terminal encoding...');
			}

			exec('locale charmap', (err, stdout, stderr) => resolve(stdout));
		});
	}

	const rawEncoding = await rawEncodingPromise;
	if (verbose) {
		console.log(`Detected raw terminal encoding: ${rawEncoding}`);
	}

	if (!rawEncoding || rawEncoding.toLowerCase() === 'utf-8' || rawEncoding.toLowerCase() === UTF8) {
		return UTF8;
	}

	return toIconvLiteEncoding(rawEncoding);
}
