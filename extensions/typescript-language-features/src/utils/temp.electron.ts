/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as os from 'os';
import * as fs from 'fs';
import * as path from 'path';

function makeRandomHexString(length: number): string {
	const chars = ['0', '1', '2', '3', '4', '5', '6', '7', '8', '9', 'a', 'b', 'c', 'd', 'e', 'f'];
	let result = '';
	for (let i = 0; i < length; i++) {
		const idx = Math.floor(chars.length * Math.random());
		result += chars[idx];
	}
	return result;
}

const getRootTempDir = (() => {
	let dir: string | undefined;
	return () => {
		if (!dir) {
			const filename = `vscode-typescript${process.platform !== 'win32' && process.getuid ? process.getuid() : ''}`;
			dir = path.join(os.tmpdir(), filename);
		}
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir);
		}
		return dir;
	};
})();

export const getInstanceTempDir = (() => {
	let dir: string | undefined;
	return () => {
		if (!dir) {
			dir = path.join(getRootTempDir(), makeRandomHexString(20));
		}
		if (!fs.existsSync(dir)) {
			fs.mkdirSync(dir);
		}
		return dir;
	};
})();

export function getTempFile(prefix: string): string {
	return path.join(getInstanceTempDir(), `${prefix}-${makeRandomHexString(20)}.tmp`);
}
