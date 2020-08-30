/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/**
 * This code is also used by standalone cli's. Avoid adding dependencies to keep the size of the cli small.
 */
import * as path from 'vs/base/common/path';
import * as os from 'os';
import * as fs from 'fs';

export function createWaitMarkerFile(verbose?: boolean): string | undefined {
	const randomWaitMarkerPath = path.join(os.tmpdir(), Math.random().toString(36).replace(/[^a-z]+/g, '').substr(0, 10));

	try {
		fs.writeFileSync(randomWaitMarkerPath, ''); // use built-in fs to avoid dragging in more dependencies
		if (verbose) {
			console.log(`Marker file for --wait created: ${randomWaitMarkerPath}`);
		}
		return randomWaitMarkerPath;
	} catch (err) {
		if (verbose) {
			console.error(`Failed to create marker file for --wait: ${err}`);
		}
		return undefined;
	}
}
