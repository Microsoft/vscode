/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { URI } from 'vs/base/common/uri';
import { originalFSPath } from 'vs/base/common/resources';
import { isWindows } from 'vs/base/common/platform';

suite('ExtHost API', function () {
	test('issue #51387: originalFSPath', function () {
		if (isWindows) {
			assert.equal(originalFSPath(URI.file('C:\\test')).charAt(0), 'C');
			assert.equal(originalFSPath(URI.file('c:\\test')).charAt(0), 'c');

			assert.equal(originalFSPath(URI.revive(JSON.parse(JSON.stringify(URI.file('C:\\test'))))).charAt(0), 'C');
			assert.equal(originalFSPath(URI.revive(JSON.parse(JSON.stringify(URI.file('c:\\test'))))).charAt(0), 'c');
		}
	});
});
