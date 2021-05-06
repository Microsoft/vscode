/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import type { Suite } from 'mocha';
import { join } from 'vs/base/common/path';
import { URI } from 'vs/base/common/uri';
import { generateUuid } from 'vs/base/common/uuid';

export function getRandomTestPath(tmpdir: string, ...segments: string[]): string {
	return join(tmpdir, ...segments, generateUuid());
}

export function getPathFromAmdModule(requirefn: typeof require, relativePath: string): string {
	return URI.parse(requirefn.toUrl(relativePath)).fsPath;
}

export function flakySuite(title: string, fn: (this: Suite) => void): Suite {
	return suite(title, function () {

		// Flaky suites need retries and timeout to complete
		// e.g. because they access the file system which can
		// be unreliable depending on the environment.
		this.retries(3);
		this.timeout(1000 * 20);

		// Invoke suite ensuring that `this` is
		// properly wired in.
		fn.call(this);
	});
}
