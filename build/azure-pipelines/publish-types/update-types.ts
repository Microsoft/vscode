/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

'use strict';

import * as fs from 'fs';
import * as cp from 'child_process';
import * as path from 'path';

let tag = '';
try {
	tag = cp
		.execSync('git describe --tags `git rev-list --tags --max-count=1`')
		.toString()
		.trim();

	const dtsUri = `https://raw.githubusercontent.com/microsoft/vscode/${tag}/src/vs/vscode.d.ts`;
	const outPath = path.resolve(process.cwd(), 'DefinitelyTyped/types/vscode/index.d.ts');
	cp.execSync(`curl ${dtsUri} --output ${outPath}`);

	updateDTSFile(outPath, tag);

	console.log(`Done updating vscode.d.ts at ${outPath}`);
} catch (err) {
	console.error(err);
	console.error('Failed to update types');
	process.exit(1);
}

function updateDTSFile(outPath: string, tag: string) {
	const oldContent = fs.readFileSync(outPath, 'utf-8');
	const newContent = getNewFileContent(oldContent, tag);

	fs.writeFileSync(outPath, newContent);
}

function repeat(str: string, times: number): string {
	const result = new Array(times);
	for (let i = 0; i < times; i++) {
		result[i] = str;
	}
	return result.join('');
}

function convertTabsToSpaces(str: string): string {
	return str.replace(/\t/gm, value => repeat('    ', value.length));
}

function getNewFileContent(content: string, tag: string) {
	const oldheader = [
		`/*---------------------------------------------------------------------------------------------`,
		` *  Copyright (c) Microsoft Corporation.`,
		` *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.`,
		` *--------------------------------------------------------------------------------------------*/`
	].join('\n');

	return convertTabsToSpaces(getNewFileHeader(tag) + content.slice(oldheader.length));
}

function getNewFileHeader(tag: string) {
	const [major, minor] = tag.split('.');
	const shorttag = `${major}.${minor}`;

	const header = [
		`// Type definitions for Visual Studio Code ${shorttag}`,
		`// Project: https://github.com/microsoft/vscode`,
		`// Definitions by: Visual Studio Code Team, Microsoft <https://github.com/Microsoft>`,
		`// Definitions: https://github.com/DefinitelyTyped/DefinitelyTyped`,
		``,
		`/*---------------------------------------------------------------------------------------------`,
		` *  Copyright (c) Microsoft Corporation. All rights reserved.`,
		` *  Licensed under the MIT License.`,
		` *  See https://github.com/Microsoft/vscode/blob/master/LICENSE.txt for license information.`,
		` *--------------------------------------------------------------------------------------------*/`,
		``,
		`/**`,
		` * Type Definition for Visual Studio Code ${shorttag} Extension API`,
		` * See https://code.visualstudio.com/api for more information`,
		` */`
	].join('\n');

	return header;
}
