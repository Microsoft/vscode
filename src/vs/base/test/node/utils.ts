/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from 'vs/base/common/uuid';
import { join } from 'vs/base/common/path';
import { tmpdir } from 'os';
import { mkdirp, rimraf, RimRafMode } from 'vs/base/node/pfs';

export interface ITestFileResult {
	testFile: string;
	cleanUp: () => Promise<void>;
}

export function testFile(folder: string, file: string): Promise<ITestFileResult> {
	const id = generateUuid();
	const parentDir = join(tmpdir(), 'vsctests', id);
	const newDir = join(parentDir, folder, id);
	const testFile = join(newDir, file);

	return mkdirp(newDir, 493).then(() => {
		return {
			testFile,
			cleanUp: () => rimraf(parentDir, RimRafMode.MOVE)
		};
	});
}
