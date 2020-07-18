/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import * as assert from 'assert';
import { ipcRenderer, crashReporter, webFrame } from 'vs/base/parts/sandbox/electron-sandbox/globals';

suite('Sandbox', () => {
	test('globals', () => {
		assert.ok(ipcRenderer);
		assert.ok(crashReporter);
		assert.ok(webFrame);
	});
});
