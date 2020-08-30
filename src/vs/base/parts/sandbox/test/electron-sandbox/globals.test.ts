/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation.
 *  Licensed under the MIT License. See LICENSE.txt in the project root for license information.
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
